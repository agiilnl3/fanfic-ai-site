import { Router, type IRouter } from "express";
import { eq, inArray, count, asc, sql } from "drizzle-orm";
import { canEditStory, canReadStory } from "../lib/storyAuthz";
import {
  db,
  tagsTable,
  storyTagsTable,
  storiesTable,
} from "@workspace/db";
import {
  GetStoryTagsParams,
  SetStoryTagsParams,
  SetStoryTagsBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё\s-]/giu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30);
}

router.get("/tags", async (_req, res): Promise<void> => {
  // Public tag cloud — same data for every viewer.
  res.setHeader(
    "Cache-Control",
    "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
  );
  const rows = await db
    .select({
      id: tagsTable.id,
      slug: tagsTable.slug,
      label: tagsTable.label,
      storyCount: sql<number>`coalesce(count(${storiesTable.id}) filter (where ${storiesTable.status} = 'published' and ${storiesTable.isPrivate} = false), 0)::int`,
    })
    .from(tagsTable)
    .leftJoin(storyTagsTable, eq(storyTagsTable.tagId, tagsTable.id))
    .leftJoin(storiesTable, eq(storiesTable.id, storyTagsTable.storyId))
    .groupBy(tagsTable.id)
    .orderBy(asc(tagsTable.label));
  res.json(rows);
});

router.get("/stories/:id/tags", async (req, res): Promise<void> => {
  const params = GetStoryTagsParams.safeParse(req.params);
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
  if (!(await canReadStory(story, req.user ?? null))) {
    res.status(404).json({ error: "Story not found" });
    return;
  }
  const rows = await db
    .select({
      id: tagsTable.id,
      slug: tagsTable.slug,
      label: tagsTable.label,
    })
    .from(storyTagsTable)
    .innerJoin(tagsTable, eq(tagsTable.id, storyTagsTable.tagId))
    .where(eq(storyTagsTable.storyId, params.data.id))
    .orderBy(asc(tagsTable.label));
  res.json(rows.map((r) => ({ ...r, storyCount: 0 })));
});

router.put("/stories/:id/tags", async (req, res): Promise<void> => {
  const params = SetStoryTagsParams.safeParse(req.params);
  const body = SetStoryTagsBody.safeParse(req.body);
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
  if (!canEditStory(story, req.user)) {
    res.status(403).json({ error: "Only the story author can edit tags" });
    return;
  }

  const slugs = Array.from(
    new Set(
      body.data.slugs
        .map((s) => ({ raw: s.trim(), slug: slugify(s) }))
        .filter((s) => s.slug.length > 0)
        .map((s) => JSON.stringify(s)),
    ),
  )
    .map((j) => JSON.parse(j) as { raw: string; slug: string })
    .slice(0, 8);

  let tagIds: number[] = [];
  if (slugs.length > 0) {
    await db
      .insert(tagsTable)
      .values(slugs.map((s) => ({ slug: s.slug, label: s.raw })))
      .onConflictDoNothing();
    const existing = await db
      .select()
      .from(tagsTable)
      .where(
        inArray(
          tagsTable.slug,
          slugs.map((s) => s.slug),
        ),
      );
    tagIds = existing.map((t) => t.id);
  }

  await db.delete(storyTagsTable).where(eq(storyTagsTable.storyId, params.data.id));
  if (tagIds.length > 0) {
    await db
      .insert(storyTagsTable)
      .values(tagIds.map((tagId) => ({ storyId: params.data.id, tagId })))
      .onConflictDoNothing();
  }

  const rows = await db
    .select({
      id: tagsTable.id,
      slug: tagsTable.slug,
      label: tagsTable.label,
    })
    .from(storyTagsTable)
    .innerJoin(tagsTable, eq(tagsTable.id, storyTagsTable.tagId))
    .where(eq(storyTagsTable.storyId, params.data.id))
    .orderBy(asc(tagsTable.label));
  res.json(rows.map((r) => ({ ...r, storyCount: 0 })));
});

export default router;
