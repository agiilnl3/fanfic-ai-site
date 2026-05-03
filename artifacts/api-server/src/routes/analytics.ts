import { Router, type IRouter } from "express";
import { and, eq, gte, sql, count, desc } from "drizzle-orm";
import {
  db,
  storyViewsTable,
  storiesTable,
  storyLikesTable,
  storyCommentsTable,
} from "@workspace/db";
import {
  RecordStoryViewParams,
  RecordStoryViewBody,
  GetStoryAnalyticsParams,
  GetStoryAnalyticsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/stories/:id/view", async (req, res): Promise<void> => {
  const params = RecordStoryViewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const body = RecordStoryViewBody.safeParse(req.body ?? {});
  const completed = body.success && body.data.completed ? 1 : 0;
  const viewerName = body.success
    ? (body.data.viewerName ?? null)?.toString().trim() || null
    : null;
  await db.insert(storyViewsTable).values({
    storyId: params.data.id,
    viewerName,
    completed,
  });
  res.sendStatus(204);
});

router.get("/stories/:id/analytics", async (req, res): Promise<void> => {
  const params = GetStoryAnalyticsParams.safeParse(req.params);
  const query = GetStoryAnalyticsQueryParams.safeParse(req.query);
  if (!params.success || !query.success) {
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
  if (story.authorName !== query.data.authorName.trim()) {
    res.status(403).json({ error: "Only the author can view analytics" });
    return;
  }

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const totalRow = await db
    .select({
      total: count(),
      completed: sql<number>`coalesce(sum(${storyViewsTable.completed}), 0)::int`,
    })
    .from(storyViewsTable)
    .where(eq(storyViewsTable.storyId, params.data.id));
  const dailyRows = await db
    .select({
      day: sql<string>`to_char(${storyViewsTable.createdAt}, 'YYYY-MM-DD')`,
      views: count(),
      completed: sql<number>`coalesce(sum(${storyViewsTable.completed}), 0)::int`,
    })
    .from(storyViewsTable)
    .where(
      and(
        eq(storyViewsTable.storyId, params.data.id),
        gte(storyViewsTable.createdAt, since),
      ),
    )
    .groupBy(sql`to_char(${storyViewsTable.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(desc(sql`to_char(${storyViewsTable.createdAt}, 'YYYY-MM-DD')`));
  const [likeAgg] = await db
    .select({ c: count() })
    .from(storyLikesTable)
    .where(eq(storyLikesTable.storyId, params.data.id));
  const [commentAgg] = await db
    .select({ c: count() })
    .from(storyCommentsTable)
    .where(eq(storyCommentsTable.storyId, params.data.id));

  res.json({
    storyId: params.data.id,
    totalViews: Number(totalRow[0]?.total ?? 0),
    totalCompleted: Number(totalRow[0]?.completed ?? 0),
    totalLikes: Number(likeAgg?.c ?? 0),
    totalComments: Number(commentAgg?.c ?? 0),
    daily: dailyRows.map((r) => ({
      day: r.day,
      views: Number(r.views),
      completed: Number(r.completed),
    })),
  });
});

export default router;
