import { Router, type IRouter } from "express";
import { traceOpenAI } from "../lib/sentry";
import { and, eq } from "drizzle-orm";
import {
  db,
  chaptersTable,
  storiesTable,
  type Chapter,
} from "@workspace/db";
import {
  GetChapterTreeParams,
  BranchChapterParams,
  BranchChapterBody,
  SetCanonicalChapterParams,
  UpdateChapterParams,
  UpdateChapterBody,
} from "@workspace/api-zod";
import { canEditStory, ownsByUserOrHandle } from "../lib/storyAuthz";
import { checkAndBumpStory } from "../lib/usage";
import { getUserPlan } from "../lib/subscriptions";
import { gateModelForPlan } from "../lib/modelGating";
import {
  backfillStoryToChapters,
  computeCanonicalChapters,
  loadChapterTree,
  lockStoryChapters,
  markChapterCanonical,
  syncStoryFullText,
} from "../lib/chapters";
import { openai } from "@workspace/integrations-openai-ai-server";
import { aiGenerationLimiter, writeLimiter } from "../middlewares/rate-limit";

const router: IRouter = Router();

function serializeChapter(c: Chapter) {
  return {
    id: c.id,
    storyId: c.storyId,
    parentChapterId: c.parentChapterId,
    title: c.title ?? "",
    branchLabel: c.branchLabel ?? "",
    text: c.text ?? "",
    position: c.position ?? 0,
    isCanonical: !!c.isCanonical,
    authorHandle: c.authorHandle ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

async function buildTreeResponse(storyId: number) {
  const chapters = await loadChapterTree(storyId);
  const canonical = await computeCanonicalChapters(storyId);
  return {
    storyId,
    chapters: chapters.map(serializeChapter),
    canonicalPath: canonical.map((c) => c.id),
  };
}

router.get("/stories/:id/chapter-tree", async (req, res): Promise<void> => {
  const params = GetChapterTreeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }
  const [story] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!story) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Drafts are owner-only; published stories are public-readable…
  if (story.status !== "published" && !canEditStory(story, req.user ?? null)) {
    res.status(403).json({ error: "Not authorized" });
    return;
  }
  // …unless the story is marked private (Conjurer-only): even when
  // "published", the chapter content (which is the protected asset) is
  // hidden from non-owners/non-coauthors. 404 to avoid id enumeration.
  if (story.isPrivate && !canEditStory(story, req.user ?? null)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Lazy backfill: synthesize chapter rows from legacy fullText on first
  // read so existing stories transparently support branching.
  await backfillStoryToChapters(story.id);
  res.json(await buildTreeResponse(story.id));
});

router.post(
  "/stories/:id/chapters/:parentId/branch",
  aiGenerationLimiter,
  async (req, res): Promise<void> => {
    const params = BranchChapterParams.safeParse(req.params);
    const body = BranchChapterBody.safeParse(req.body ?? {});
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const [story] = await db
      .select()
      .from(storiesTable)
      .where(eq(storiesTable.id, params.data.id))
      .limit(1);
    if (!story) {
      res.status(404).json({ error: "Story not found" });
      return;
    }
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!canEditStory(story, req.user)) {
      res.status(403).json({ error: "Only the author or a co-author may add branches" });
      return;
    }

    // Make sure the parent chapter exists and belongs to this story.
    // Backfill first so legacy stories can also be branched.
    await backfillStoryToChapters(story.id);
    const [parent] = await db
      .select()
      .from(chaptersTable)
      .where(
        and(
          eq(chaptersTable.id, params.data.parentId),
          eq(chaptersTable.storyId, story.id),
        ),
      )
      .limit(1);
    if (!parent) {
      res.status(404).json({ error: "Parent chapter not found" });
      return;
    }

    // Quota is charged to the authenticated editor, not a client-supplied handle.
    const quota = await checkAndBumpStory(req.user!.handle, req.user!.id);
    if (!quota.ok) {
      res.status(429).json({
        error: "Daily story quota reached",
        remaining: quota.remaining,
        limit: quota.limit,
      });
      return;
    }

    // Build the prefix context: walk from root to the parent so the
    // model knows what canon was established before the fork.
    const ancestors: Chapter[] = [];
    let cursor: Chapter | null = parent;
    while (cursor) {
      ancestors.unshift(cursor);
      if (cursor.parentChapterId == null) break;
      const [next] = await db
        .select()
        .from(chaptersTable)
        .where(eq(chaptersTable.id, cursor.parentChapterId))
        .limit(1);
      cursor = next ?? null;
    }
    const contextText = ancestors
      .map((c) => c.text)
      .join("\n\n")
      .slice(-4000);

    const count = body.data.count ?? 2;
    const userPrompt = `You are writing alternate "What if?" continuations of a ${story.genre} story titled "${story.title}".
Story so far (most recent first):
${contextText}

${body.data.seedPrompt ? `Optional fork hint: "${body.data.seedPrompt}".` : ""}

Generate exactly ${count} DISTINCT alternative next chapters that diverge meaningfully from each other (different choices, twists, or outcomes). Each ~500 words. Keep voice and characters consistent. Return JSON:
{ "branches": [ { "branchLabel": string (short "What if X?" tag, max 60 chars), "title": string, "text": string } ] }`;

    let parsed: { branches?: Array<{ branchLabel?: string; title?: string; text?: string }> };
    try {
      const branchPlan = req.user ? await getUserPlan(req.user.id) : "free";
      const response = await traceOpenAI("chapters.branch", () =>
        openai.chat.completions.create({
          model: gateModelForPlan("gpt-5.1", branchPlan),
          max_completion_tokens: 16000,
          messages: [
            { role: "system", content: `You are continuing an ongoing ${story.genre} story with creative alternate paths. Always respond in valid JSON.` },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
        }),
      );
      const raw = response.choices[0]?.message?.content ?? "{}";
      parsed = JSON.parse(raw);
    } catch (err) {
      req.log.error({ err }, "branch generation failed");
      res.status(502).json({ error: "AI returned malformed output" });
      return;
    }

    const branchesIn = Array.isArray(parsed.branches) ? parsed.branches : [];
    const cleaned = branchesIn
      .filter((b): b is { branchLabel?: string; title?: string; text: string } =>
        typeof b?.text === "string" && b.text.trim().length > 0,
      )
      .slice(0, count);
    if (cleaned.length === 0) {
      res.status(502).json({ error: "AI returned no usable branches" });
      return;
    }

    // Serialize sibling-position + canonical-flag computation against
    // any concurrent /branch or /continue on the same story.
    const inserted: Chapter[] = [];
    await db.transaction(async (tx) => {
      await lockStoryChapters(tx, story.id);
      const siblings = await tx
        .select()
        .from(chaptersTable)
        .where(
          and(
            eq(chaptersTable.storyId, story.id),
            eq(chaptersTable.parentChapterId, parent.id),
          ),
        );
      const startPos = siblings.length;
      for (let i = 0; i < cleaned.length; i++) {
        const b = cleaned[i];
        const [row] = await tx
          .insert(chaptersTable)
          .values({
            storyId: story.id,
            parentChapterId: parent.id,
            title: (b.title ?? "").slice(0, 200) || `Branch ${startPos + i + 1}`,
            branchLabel: (b.branchLabel ?? "").slice(0, 80),
            text: b.text,
            position: startPos + i,
            // Generated branches are always candidates. The author must
            // explicitly call /canonical to promote one, so generation
            // never silently changes what readers/PDFs/audio see.
            isCanonical: false,
            authorUserId: req.user!.id,
            authorHandle: req.user!.handle,
          })
          .returning();
        inserted.push(row);
      }
    });

    res.json({
      parentChapterId: parent.id,
      branches: inserted.map(serializeChapter),
    });
  },
);

router.patch(
  "/stories/:id/chapters/:chapterId",
  writeLimiter,
  async (req, res): Promise<void> => {
    const params = UpdateChapterParams.safeParse(req.params);
    const body = UpdateChapterBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const [story] = await db
      .select()
      .from(storiesTable)
      .where(eq(storiesTable.id, params.data.id))
      .limit(1);
    if (!story) {
      res.status(404).json({ error: "Story not found" });
      return;
    }
    // Authz + mutation must run under the story's chapter advisory
    // lock so we can't read a stale `chapter` and then race a
    // concurrent /branch or /canonical that re-writes canonical state
    // before we call syncStoryFullText.
    let updated: Chapter | null = null;
    let authzError: "forbidden" | "not_found" | null = null;
    await db.transaction(async (tx) => {
      await lockStoryChapters(tx, story.id);
      const [chapter] = await tx
        .select()
        .from(chaptersTable)
        .where(
          and(
            eq(chaptersTable.id, params.data.chapterId),
            eq(chaptersTable.storyId, story.id),
          ),
        )
        .limit(1);
      if (!chapter) {
        authzError = "not_found";
        return;
      }
      // Authz: only the *primary* author can edit any chapter on
      // their story. Everyone else — co-authors included — may only
      // edit a chapter they personally authored (e.g. a /branch
      // contribution). This matches the client's per-chapter gate
      // and prevents a co-author from rewriting another co-author's
      // contribution. canEditStory() (which would also cover
      // co-authors) is intentionally NOT used here.
      const isPrimary = ownsByUserOrHandle(story, req.user!);
      const ownsChapter =
        chapter.authorUserId != null && chapter.authorUserId === req.user!.id;
      if (!isPrimary && !ownsChapter) {
        authzError = "forbidden";
        return;
      }
      const update: Partial<typeof chaptersTable.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (typeof body.data.text === "string") update.text = body.data.text;
      if (typeof body.data.title === "string") update.title = body.data.title;
      const [row] = await tx
        .update(chaptersTable)
        .set(update)
        .where(eq(chaptersTable.id, chapter.id))
        .returning();
      updated = row;
    });
    if (authzError === "not_found") {
      res.status(404).json({ error: "Chapter not found" });
      return;
    }
    if (authzError === "forbidden") {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    if (!updated) {
      res.status(500).json({ error: "Update failed" });
      return;
    }
    // Refresh the denormalized fullText so the reader / PDF / audio
    // paths see the new chapter immediately. Safe to do outside the
    // advisory lock: syncStoryFullText reads canonical state and
    // overwrites stories.full_text in a single statement; the worst
    // case for a concurrent canonical-flip racing us is one extra
    // sync from the next mutation.
    await syncStoryFullText(story.id);
    res.json(serializeChapter(updated));
  },
);

router.post(
  "/stories/:id/chapters/:chapterId/canonical",
  writeLimiter,
  async (req, res): Promise<void> => {
    const params = SetCanonicalChapterParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const [story] = await db
      .select()
      .from(storiesTable)
      .where(eq(storiesTable.id, params.data.id))
      .limit(1);
    if (!story) {
      res.status(404).json({ error: "Story not found" });
      return;
    }
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!canEditStory(story, req.user)) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }

    const [chapter] = await db
      .select()
      .from(chaptersTable)
      .where(
        and(
          eq(chaptersTable.id, params.data.chapterId),
          eq(chaptersTable.storyId, story.id),
        ),
      )
      .limit(1);
    if (!chapter) {
      res.status(404).json({ error: "Chapter not found" });
      return;
    }

    await markChapterCanonical(story.id, chapter.id);
    await syncStoryFullText(story.id);

    res.json(await buildTreeResponse(story.id));
  },
);

export default router;
