import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, chaptersTable, storiesTable, type Chapter } from "@workspace/db";

/**
 * Serializes chapter mutations for a single story across concurrent
 * requests. Postgres advisory locks are held for the lifetime of the
 * transaction (`pg_advisory_xact_lock`) so callers must run their
 * mutations inside `db.transaction(async (tx) => { await
 * lockStoryChapters(tx, storyId); ... })`. Without this, two concurrent
 * /continue or /branch requests on the same story can both observe
 * "no canonical leaf" / "no existing canonical sibling" and both insert
 * `is_canonical = true` rows, breaking the one-canonical-per-level
 * invariant.
 *
 * The arbitrary string key namespaces this lock against any other
 * advisory locks elsewhere in the codebase.
 */
export async function lockStoryChapters(
  tx: { execute: typeof db.execute },
  storyId: number,
): Promise<void> {
  // hashtext() takes any text, advisory locks take a bigint key. Pair
  // the namespace hash with the storyId so different stories don't
  // serialize against each other.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('chapters'), ${storyId})`,
  );
}

/**
 * Branching-storyline helpers.
 *
 * The chapters tree is the canonical source of truth: rows form a forest
 * rooted at chapters with `parent_chapter_id IS NULL`. Among siblings
 * sharing the same parent, exactly one is `is_canonical = true`; that
 * chain produces the linear "main" story. Alternative siblings are the
 * "What if?" forks shown in the sidebar.
 *
 * `stories.full_text` is a denormalized mirror of the canonical chain so
 * legacy endpoints (PDF export, audio TTS, share previews, regenerate)
 * keep working without rewrites. After every mutation, callers must
 * `syncStoryFullText(storyId)` to keep them aligned.
 */

const CHAPTER_DELIM = /\n\n## /;

/**
 * Lazily backfill chapter rows for a story whose chapters table is
 * empty (i.e. created before this feature shipped). Splits
 * `stories.full_text` on the legacy `\n\n## Heading` delimiter and
 * inserts each chunk as a canonical-path chapter. Idempotent: if any
 * chapters already exist for the story, this is a no-op.
 *
 * Returns the canonical-path chapters in order.
 */
export async function backfillStoryToChapters(
  storyId: number,
): Promise<Chapter[]> {
  // Fast path: skip the transaction + advisory lock when chapters
  // already exist (the common case after the first read).
  const existing = await db
    .select()
    .from(chaptersTable)
    .where(eq(chaptersTable.storyId, storyId))
    .limit(1);
  if (existing.length > 0) {
    return computeCanonicalChapters(storyId);
  }

  // Cold path: take the per-story advisory lock and re-check inside the
  // transaction so two concurrent first-reads don't both insert duplicate
  // canonical chains.
  await db.transaction(async (tx) => {
    await lockStoryChapters(tx, storyId);
    const inside = await tx
      .select()
      .from(chaptersTable)
      .where(eq(chaptersTable.storyId, storyId))
      .limit(1);
    if (inside.length > 0) return;

    const [story] = await tx
      .select()
      .from(storiesTable)
      .where(eq(storiesTable.id, storyId))
      .limit(1);
    if (!story) return;

    const fullText = story.fullText ?? "";
    const parts = fullText.split(CHAPTER_DELIM);
    // First part is the un-headinged opening; subsequent parts begin
    // with "<title>\n<body>" (the leading "## " was consumed by split).
    let parentId: number | null = null;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      let title = "";
      let text = part;
      if (i > 0) {
        const nl = part.indexOf("\n");
        title = nl > 0 ? part.slice(0, nl).trim() : `Chapter ${i + 1}`;
        text = nl > 0 ? part.slice(nl + 1).replace(/^\n+/, "") : "";
      }
      const rows: Chapter[] = await tx
        .insert(chaptersTable)
        .values({
          storyId,
          parentChapterId: parentId,
          title,
          branchLabel: "",
          text,
          position: 0,
          isCanonical: true,
          authorUserId: story.userId ?? null,
          authorHandle: story.authorName,
        })
        .returning();
      parentId = rows[0].id;
    }
  });
  return computeCanonicalChapters(storyId);
}

/**
 * Walks the canonical chain for a story (root → ... → leaf) and returns
 * the chapters in order. Does NOT auto-backfill — callers that want
 * "always have chapters" should call backfillStoryToChapters first.
 */
export async function computeCanonicalChapters(
  storyId: number,
): Promise<Chapter[]> {
  const all = await db
    .select()
    .from(chaptersTable)
    .where(eq(chaptersTable.storyId, storyId))
    .orderBy(asc(chaptersTable.position), asc(chaptersTable.id));
  if (all.length === 0) return [];

  const byParent = new Map<number | null, Chapter[]>();
  for (const c of all) {
    const key = c.parentChapterId;
    const arr = byParent.get(key) ?? [];
    arr.push(c);
    byParent.set(key, arr);
  }

  const path: Chapter[] = [];
  let parent: number | null = null;
  // Cap depth defensively — branching trees should never exceed a few
  // dozen levels in practice but a corrupt parent chain could otherwise
  // loop forever.
  for (let depth = 0; depth < 1000; depth++) {
    const siblings = byParent.get(parent);
    if (!siblings || siblings.length === 0) break;
    const next =
      siblings.find((c) => c.isCanonical) ?? siblings[0];
    path.push(next);
    parent = next.id;
  }
  return path;
}

/**
 * Render the canonical chapter chain as the legacy "## heading"-
 * delimited fullText, then write it back to the story row. Keeps PDF
 * export / audio / regenerate paths working untouched.
 */
export async function syncStoryFullText(storyId: number): Promise<string> {
  const path = await computeCanonicalChapters(storyId);
  if (path.length === 0) return "";
  const parts: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    if (i === 0) {
      parts.push(c.text);
    } else {
      const heading = c.title?.trim() || `Chapter ${i + 1}`;
      parts.push(`## ${heading}\n\n${c.text}`);
    }
  }
  const fullText = parts.join("\n\n");
  await db
    .update(storiesTable)
    .set({ fullText, updatedAt: new Date() })
    .where(eq(storiesTable.id, storyId));
  return fullText;
}

/**
 * Mark `chapterId` canonical among its siblings. Atomic: any other
 * sibling with `is_canonical = true` is unset in the same transaction.
 */
export async function markChapterCanonical(
  storyId: number,
  chapterId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(chaptersTable)
      .where(
        and(
          eq(chaptersTable.id, chapterId),
          eq(chaptersTable.storyId, storyId),
        ),
      )
      .limit(1);
    if (!target) throw new Error("chapter not found");

    if (target.parentChapterId == null) {
      await tx
        .update(chaptersTable)
        .set({ isCanonical: false })
        .where(
          and(
            eq(chaptersTable.storyId, storyId),
            isNull(chaptersTable.parentChapterId),
          ),
        );
    } else {
      await tx
        .update(chaptersTable)
        .set({ isCanonical: false })
        .where(
          and(
            eq(chaptersTable.storyId, storyId),
            eq(chaptersTable.parentChapterId, target.parentChapterId),
          ),
        );
    }
    await tx
      .update(chaptersTable)
      .set({ isCanonical: true, updatedAt: new Date() })
      .where(eq(chaptersTable.id, chapterId));
  });
}

/**
 * Return every chapter in the story keyed by parent so the frontend can
 * render the tree without making N requests.
 */
export async function loadChapterTree(storyId: number): Promise<Chapter[]> {
  return db
    .select()
    .from(chaptersTable)
    .where(eq(chaptersTable.storyId, storyId))
    .orderBy(asc(chaptersTable.position), asc(chaptersTable.id));
}
