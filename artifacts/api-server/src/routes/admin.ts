import { Router, type IRouter } from "express";
import { eq, count, desc, countDistinct, inArray } from "drizzle-orm";
import { db, storiesTable, illustrationsTable, storyLikesTable } from "@workspace/db";
import {
  AdminLoginBody,
  AdminDeleteStoryParams,
  AdminUpdateStoryParams,
  AdminUpdateStoryBody,
} from "@workspace/api-zod";
import { adminAuth } from "../middlewares/admin";

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

export default router;
