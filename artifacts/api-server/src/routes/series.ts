import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, count } from "drizzle-orm";
import {
  db,
  seriesTable,
  seriesStoriesTable,
  storiesTable,
} from "@workspace/db";
import {
  ListSeriesQueryParams,
  CreateSeriesBody,
  GetSeriesParams,
  UpdateSeriesParams,
  UpdateSeriesBody,
  DeleteSeriesParams,
  DeleteSeriesQueryParams,
  AddStoryToSeriesParams,
  AddStoryToSeriesBody,
  RemoveStoryFromSeriesParams,
  RemoveStoryFromSeriesQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function withCounts(rows: { id: number }[]) {
  if (rows.length === 0) return new Map<number, number>();
  const ids = rows.map((r) => r.id);
  const counts = await db
    .select({ seriesId: seriesStoriesTable.seriesId, c: count() })
    .from(seriesStoriesTable)
    .where(inArray(seriesStoriesTable.seriesId, ids))
    .groupBy(seriesStoriesTable.seriesId);
  return new Map(counts.map((r) => [r.seriesId, Number(r.c)]));
}

function shapeSeries(s: typeof seriesTable.$inferSelect, storyCount: number) {
  return {
    id: s.id,
    title: s.title,
    summary: s.summary,
    authorName: s.authorName,
    storyCount,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

router.get("/series", async (req, res): Promise<void> => {
  const query = ListSeriesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const where = query.data.authorName?.trim()
    ? eq(seriesTable.authorName, query.data.authorName.trim())
    : undefined;
  const rows = where
    ? await db.select().from(seriesTable).where(where).orderBy(desc(seriesTable.updatedAt))
    : await db.select().from(seriesTable).orderBy(desc(seriesTable.updatedAt));
  const counts = await withCounts(rows);
  res.json(rows.map((s) => shapeSeries(s, counts.get(s.id) ?? 0)));
});

router.post("/series", async (req, res): Promise<void> => {
  const body = CreateSeriesBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [row] = await db
    .insert(seriesTable)
    .values({
      title: body.data.title,
      summary: body.data.summary ?? null,
      authorName: body.data.authorName.trim(),
    })
    .returning();
  res.status(201).json(shapeSeries(row, 0));
});

router.get("/series/:id", async (req, res): Promise<void> => {
  const params = GetSeriesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [series] = await db
    .select()
    .from(seriesTable)
    .where(eq(seriesTable.id, params.data.id))
    .limit(1);
  if (!series) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const links = await db
    .select()
    .from(seriesStoriesTable)
    .where(eq(seriesStoriesTable.seriesId, params.data.id))
    .orderBy(asc(seriesStoriesTable.position));
  let stories: (typeof storiesTable.$inferSelect & { position: number })[] = [];
  if (links.length > 0) {
    const ids = links.map((l) => l.storyId);
    const sRows = await db
      .select()
      .from(storiesTable)
      .where(inArray(storiesTable.id, ids));
    const sMap = new Map(sRows.map((s) => [s.id, s]));
    stories = links
      .map((l) => {
        const s = sMap.get(l.storyId);
        return s ? { ...s, position: l.position } : null;
      })
      .filter((x): x is typeof storiesTable.$inferSelect & { position: number } => !!x);
  }
  res.json({
    ...shapeSeries(series, stories.length),
    stories: stories.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
  });
});

router.patch("/series/:id", async (req, res): Promise<void> => {
  const params = UpdateSeriesParams.safeParse(req.params);
  const body = UpdateSeriesBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [series] = await db
    .select()
    .from(seriesTable)
    .where(eq(seriesTable.id, params.data.id))
    .limit(1);
  if (!series) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (series.authorName !== body.data.requesterAuthorName.trim()) {
    res.status(403).json({ error: "Only the series author can update it" });
    return;
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.title !== undefined) patch.title = body.data.title;
  if (body.data.summary !== undefined) patch.summary = body.data.summary;
  const [updated] = await db
    .update(seriesTable)
    .set(patch)
    .where(eq(seriesTable.id, params.data.id))
    .returning();
  const counts = await withCounts([{ id: updated.id }]);
  res.json(shapeSeries(updated, counts.get(updated.id) ?? 0));
});

router.delete("/series/:id", async (req, res): Promise<void> => {
  const params = DeleteSeriesParams.safeParse(req.params);
  const query = DeleteSeriesQueryParams.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [series] = await db
    .select()
    .from(seriesTable)
    .where(eq(seriesTable.id, params.data.id))
    .limit(1);
  if (!series) {
    res.sendStatus(204);
    return;
  }
  if (series.authorName !== query.data.requesterAuthorName.trim()) {
    res.status(403).json({ error: "Only the series author can delete it" });
    return;
  }
  await db.delete(seriesTable).where(eq(seriesTable.id, params.data.id));
  res.sendStatus(204);
});

router.post("/series/:id/stories", async (req, res): Promise<void> => {
  const params = AddStoryToSeriesParams.safeParse(req.params);
  const body = AddStoryToSeriesBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [series] = await db
    .select()
    .from(seriesTable)
    .where(eq(seriesTable.id, params.data.id))
    .limit(1);
  if (!series) {
    res.status(404).json({ error: "Series not found" });
    return;
  }
  if (series.authorName !== body.data.requesterAuthorName.trim()) {
    res.status(403).json({ error: "Only the series author can edit it" });
    return;
  }
  await db
    .insert(seriesStoriesTable)
    .values({
      seriesId: params.data.id,
      storyId: body.data.storyId,
      position: body.data.position ?? 0,
    })
    .onConflictDoUpdate({
      target: seriesStoriesTable.storyId,
      set: { seriesId: params.data.id, position: body.data.position ?? 0 },
    });
  // Re-fetch and return the populated series.
  const links = await db
    .select()
    .from(seriesStoriesTable)
    .where(eq(seriesStoriesTable.seriesId, params.data.id))
    .orderBy(asc(seriesStoriesTable.position));
  let stories: (typeof storiesTable.$inferSelect & { position: number })[] = [];
  if (links.length > 0) {
    const ids = links.map((l) => l.storyId);
    const sRows = await db
      .select()
      .from(storiesTable)
      .where(inArray(storiesTable.id, ids));
    const sMap = new Map(sRows.map((s) => [s.id, s]));
    stories = links
      .map((l) => {
        const s = sMap.get(l.storyId);
        return s ? { ...s, position: l.position } : null;
      })
      .filter((x): x is typeof storiesTable.$inferSelect & { position: number } => !!x);
  }
  res.json({
    ...shapeSeries(series, stories.length),
    stories: stories.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
  });
});

router.delete(
  "/series/:id/stories/:storyId",
  async (req, res): Promise<void> => {
    const params = RemoveStoryFromSeriesParams.safeParse(req.params);
    const query = RemoveStoryFromSeriesQueryParams.safeParse(req.query);
    if (!params.success || !query.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const [series] = await db
      .select()
      .from(seriesTable)
      .where(eq(seriesTable.id, params.data.id))
      .limit(1);
    if (!series) {
      res.sendStatus(204);
      return;
    }
    if (series.authorName !== query.data.requesterAuthorName.trim()) {
      res.status(403).json({ error: "Only the series author can edit it" });
      return;
    }
    await db
      .delete(seriesStoriesTable)
      .where(
        and(
          eq(seriesStoriesTable.seriesId, params.data.id),
          eq(seriesStoriesTable.storyId, params.data.storyId),
        ),
      );
    res.sendStatus(204);
  },
);

export default router;
