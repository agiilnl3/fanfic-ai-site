import { Router, type IRouter } from "express";
import { eq, count, desc, countDistinct, inArray, gte, sql } from "drizzle-orm";
import {
  db,
  storiesTable,
  illustrationsTable,
  storyLikesTable,
  tariffsTable,
  authorFollowsTable,
  storyRepostsTable,
  storyCommentsTable,
} from "@workspace/db";
import {
  AdminLoginBody,
  AdminDeleteStoryParams,
  AdminUpdateStoryParams,
  AdminUpdateStoryBody,
  AdminGetTariffParams,
  AdminUpdateTariffParams,
  AdminUpdateTariffBody,
} from "@workspace/api-zod";
import { adminAuth } from "../middlewares/admin";
import { getFreeTariff, invalidateTariffCache } from "../lib/usage";

const router: IRouter = Router();

router.post("/admin/login", async (req, res): Promise<void> => {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    res.status(500).json({ error: "ADMIN_PASSWORD not configured on server" });
    return;
  }
  if (parsed.data.password !== expected) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }
  res.json({ token: expected });
});

router.get("/admin/stories", adminAuth, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: storiesTable.id,
      title: storiesTable.title,
      authorName: storiesTable.authorName,
      status: storiesTable.status,
      genre: storiesTable.genre,
      createdAt: storiesTable.createdAt,
      updatedAt: storiesTable.updatedAt,
    })
    .from(storiesTable)
    .orderBy(desc(storiesTable.createdAt));

  if (rows.length === 0) {
    res.json([]);
    return;
  }

  const ids = rows.map((r) => r.id);
  const likeRows = await db
    .select({ storyId: storyLikesTable.storyId, c: count() })
    .from(storyLikesTable)
    .where(inArray(storyLikesTable.storyId, ids))
    .groupBy(storyLikesTable.storyId);
  const illRows = await db
    .select({ storyId: illustrationsTable.storyId, c: count() })
    .from(illustrationsTable)
    .where(inArray(illustrationsTable.storyId, ids))
    .groupBy(illustrationsTable.storyId);

  const likeMap = new Map(likeRows.map((r) => [r.storyId, Number(r.c)]));
  const illMap = new Map(illRows.map((r) => [r.storyId, Number(r.c)]));

  res.json(
    rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      likeCount: likeMap.get(r.id) ?? 0,
      illustrationCount: illMap.get(r.id) ?? 0,
    })),
  );
});

router.delete("/admin/stories/:id", adminAuth, async (req, res): Promise<void> => {
  const params = AdminDeleteStoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.sendStatus(204);
});

router.patch("/admin/stories/:id", adminAuth, async (req, res): Promise<void> => {
  const params = AdminUpdateStoryParams.safeParse(req.params);
  const body = AdminUpdateStoryBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.status !== undefined) patch.status = body.data.status;
  if (body.data.title !== undefined) patch.title = body.data.title;
  const [updated] = await db
    .update(storiesTable)
    .set(patch)
    .where(eq(storiesTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(updated);
});

router.get("/admin/stats", adminAuth, async (_req, res): Promise<void> => {
  const [{ total }] = await db.select({ total: count() }).from(storiesTable);
  const [{ pub }] = await db
    .select({ pub: count() })
    .from(storiesTable)
    .where(eq(storiesTable.status, "published"));
  const [{ ill }] = await db.select({ ill: count() }).from(illustrationsTable);
  const [{ likes }] = await db.select({ likes: count() }).from(storyLikesTable);
  const [{ authors }] = await db
    .select({ authors: countDistinct(storiesTable.authorName) })
    .from(storiesTable);
  res.json({
    totalStories: Number(total),
    publishedStories: Number(pub),
    draftStories: Number(total) - Number(pub),
    totalIllustrations: Number(ill),
    totalLikes: Number(likes),
    totalAuthors: Number(authors),
  });
});

router.get(
  "/admin/tariffs/:tier",
  adminAuth,
  async (req, res): Promise<void> => {
    const params = AdminGetTariffParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    if (params.data.tier === "free") {
      const t = await getFreeTariff();
      res.json({
        tier: t.tier,
        storyDailyLimit: t.storyDailyLimit,
        illustrationDailyLimit: t.illustrationDailyLimit,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    const [row] = await db
      .select()
      .from(tariffsTable)
      .where(eq(tariffsTable.tier, params.data.tier))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Tariff not found" });
      return;
    }
    res.json({ ...row, updatedAt: row.updatedAt.toISOString() });
  },
);

router.put(
  "/admin/tariffs/:tier",
  adminAuth,
  async (req, res): Promise<void> => {
    const params = AdminUpdateTariffParams.safeParse(req.params);
    const body = AdminUpdateTariffBody.safeParse(req.body ?? {});
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.storyDailyLimit !== undefined)
      patch.storyDailyLimit = body.data.storyDailyLimit;
    if (body.data.illustrationDailyLimit !== undefined)
      patch.illustrationDailyLimit = body.data.illustrationDailyLimit;
    const [row] = await db
      .insert(tariffsTable)
      .values({
        tier: params.data.tier,
        storyDailyLimit: body.data.storyDailyLimit ?? 5,
        illustrationDailyLimit: body.data.illustrationDailyLimit ?? 20,
      })
      .onConflictDoUpdate({
        target: tariffsTable.tier,
        set: patch,
      })
      .returning();
    invalidateTariffCache();
    res.json({ ...row, updatedAt: row.updatedAt.toISOString() });
  },
);

router.get("/admin/metrics", adminAuth, async (_req, res): Promise<void> => {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const dailyStories = await db
    .select({
      day: sql<string>`to_char(${storiesTable.createdAt}, 'YYYY-MM-DD')`,
      stories: count(),
      authors: countDistinct(storiesTable.authorName),
    })
    .from(storiesTable)
    .where(gte(storiesTable.createdAt, since))
    .groupBy(sql`to_char(${storiesTable.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(desc(sql`to_char(${storiesTable.createdAt}, 'YYYY-MM-DD')`));

  const topAuthorRows = await db
    .select({
      authorName: storiesTable.authorName,
      storyCount: count(),
    })
    .from(storiesTable)
    .where(eq(storiesTable.status, "published"))
    .groupBy(storiesTable.authorName)
    .orderBy(desc(count()))
    .limit(10);
  const topAuthorNames = topAuthorRows.map((r) => r.authorName);

  const likesPerAuthor = topAuthorNames.length
    ? await db
        .select({
          authorName: storiesTable.authorName,
          likes: count(storyLikesTable.id),
        })
        .from(storiesTable)
        .leftJoin(storyLikesTable, eq(storyLikesTable.storyId, storiesTable.id))
        .where(inArray(storiesTable.authorName, topAuthorNames))
        .groupBy(storiesTable.authorName)
    : [];
  const followersPerAuthor = topAuthorNames.length
    ? await db
        .select({
          authorName: authorFollowsTable.authorName,
          followers: count(),
        })
        .from(authorFollowsTable)
        .where(inArray(authorFollowsTable.authorName, topAuthorNames))
        .groupBy(authorFollowsTable.authorName)
    : [];
  const lMap = new Map(likesPerAuthor.map((r) => [r.authorName, Number(r.likes)]));
  const fMap = new Map(
    followersPerAuthor.map((r) => [r.authorName, Number(r.followers)]),
  );

  const topStoryRows = await db
    .select({
      id: storiesTable.id,
      title: storiesTable.title,
      authorName: storiesTable.authorName,
    })
    .from(storiesTable)
    .where(eq(storiesTable.status, "published"))
    .orderBy(desc(storiesTable.createdAt))
    .limit(50);
  const topIds = topStoryRows.map((r) => r.id);
  const likesByStory = topIds.length
    ? await db
        .select({ storyId: storyLikesTable.storyId, c: count() })
        .from(storyLikesTable)
        .where(inArray(storyLikesTable.storyId, topIds))
        .groupBy(storyLikesTable.storyId)
    : [];
  const repostsByStory = topIds.length
    ? await db
        .select({ storyId: storyRepostsTable.storyId, c: count() })
        .from(storyRepostsTable)
        .where(inArray(storyRepostsTable.storyId, topIds))
        .groupBy(storyRepostsTable.storyId)
    : [];
  const commentsByStory = topIds.length
    ? await db
        .select({ storyId: storyCommentsTable.storyId, c: count() })
        .from(storyCommentsTable)
        .where(inArray(storyCommentsTable.storyId, topIds))
        .groupBy(storyCommentsTable.storyId)
    : [];
  const lkMap = new Map(likesByStory.map((r) => [r.storyId, Number(r.c)]));
  const rpMap = new Map(repostsByStory.map((r) => [r.storyId, Number(r.c)]));
  const cmMap = new Map(commentsByStory.map((r) => [r.storyId, Number(r.c)]));
  const topStories = topStoryRows
    .map((r) => ({
      id: r.id,
      title: r.title,
      authorName: r.authorName,
      likeCount: lkMap.get(r.id) ?? 0,
      repostCount: rpMap.get(r.id) ?? 0,
      commentCount: cmMap.get(r.id) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.likeCount * 3 +
        b.repostCount * 5 +
        b.commentCount * 2 -
        (a.likeCount * 3 + a.repostCount * 5 + a.commentCount * 2),
    )
    .slice(0, 10);

  res.json({
    dailyActive: dailyStories.map((r) => ({
      day: r.day,
      authors: Number(r.authors),
      stories: Number(r.stories),
    })),
    topAuthors: topAuthorRows.map((r) => ({
      authorName: r.authorName,
      storyCount: Number(r.storyCount),
      likeCount: lMap.get(r.authorName) ?? 0,
      followerCount: fMap.get(r.authorName) ?? 0,
    })),
    topStories,
  });
});

export default router;
