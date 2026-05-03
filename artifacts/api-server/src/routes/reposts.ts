import { Router, type IRouter } from "express";
import { and, eq, count, desc, inArray } from "drizzle-orm";
import {
  db,
  storyRepostsTable,
  storiesTable,
  storyLikesTable,
  storyCommentsTable,
  notificationsTable,
} from "@workspace/db";
import {
  GetStoryRepostParams,
  GetStoryRepostQueryParams,
  RepostStoryParams,
  RepostStoryBody,
  UnrepostStoryParams,
  UnrepostStoryQueryParams,
  ListAuthorRepostsParams,
} from "@workspace/api-zod";
import { writeLimiter } from "../middlewares/rate-limit";
import { logger } from "../lib/logger";
import { notifyRecipient } from "../lib/notification-bus";

const router: IRouter = Router();

async function repostInfo(storyId: number, reposterName?: string) {
  const [row] = await db
    .select({ value: count() })
    .from(storyRepostsTable)
    .where(eq(storyRepostsTable.storyId, storyId));
  let hasReposted = false;
  if (reposterName && reposterName.trim()) {
    const [existing] = await db
      .select({ id: storyRepostsTable.id })
      .from(storyRepostsTable)
      .where(
        and(
          eq(storyRepostsTable.storyId, storyId),
          eq(storyRepostsTable.reposterName, reposterName.trim()),
        ),
      )
      .limit(1);
    hasReposted = !!existing;
  }
  return { storyId, repostCount: row?.value ?? 0, hasReposted };
}

router.get("/stories/:id/repost", async (req, res): Promise<void> => {
  const params = GetStoryRepostParams.safeParse(req.params);
  const query = GetStoryRepostQueryParams.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }
  res.json(await repostInfo(params.data.id, query.data.reposterName));
});

router.post("/stories/:id/repost", writeLimiter, async (req, res): Promise<void> => {
  const params = RepostStoryParams.safeParse(req.params);
  const body = RepostStoryBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }
  const reposter = body.data.reposterName.trim();
  if (!reposter) {
    res.status(400).json({ error: "reposterName required" });
    return;
  }

  const [story] = await db
    .select({ id: storiesTable.id, authorName: storiesTable.authorName, title: storiesTable.title, status: storiesTable.status })
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!story) {
    res.status(404).json({ error: "Story not found" });
    return;
  }
  if (story.status !== "published") {
    res.status(400).json({ error: "Only published stories can be reposted" });
    return;
  }

  const inserted = await db
    .insert(storyRepostsTable)
    .values({ storyId: story.id, reposterName: reposter, note: body.data.note ?? null, userId: req.user?.id ?? null })
    .onConflictDoNothing()
    .returning({ id: storyRepostsTable.id });

  if (inserted.length > 0 && story.authorName !== reposter) {
    try {
      await db.insert(notificationsTable).values({
        recipientName: story.authorName,
        type: "repost",
        actorName: reposter,
        storyId: story.id,
        payload: { storyTitle: story.title, note: body.data.note ?? null },
      });
      notifyRecipient(story.authorName);
    } catch (err) {
      logger.warn({ err }, "failed to insert repost notification");
    }
  }

  res.json(await repostInfo(story.id, reposter));
});

router.delete("/stories/:id/repost", writeLimiter, async (req, res): Promise<void> => {
  const params = UnrepostStoryParams.safeParse(req.params);
  const query = UnrepostStoryQueryParams.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }
  const reposter = query.data.reposterName.trim();
  await db
    .delete(storyRepostsTable)
    .where(
      and(
        eq(storyRepostsTable.storyId, params.data.id),
        eq(storyRepostsTable.reposterName, reposter),
      ),
    );
  res.json(await repostInfo(params.data.id, reposter));
});

router.get("/authors/:name/reposts", async (req, res): Promise<void> => {
  const params = ListAuthorRepostsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }
  const reposts = await db
    .select()
    .from(storyRepostsTable)
    .where(eq(storyRepostsTable.reposterName, params.data.name))
    .orderBy(desc(storyRepostsTable.createdAt))
    .limit(50);
  if (reposts.length === 0) {
    res.json([]);
    return;
  }
  const ids = reposts.map((r) => r.storyId);
  const stories = await db
    .select()
    .from(storiesTable)
    .where(and(inArray(storiesTable.id, ids), eq(storiesTable.status, "published")));
  const likeRows = await db
    .select({ storyId: storyLikesTable.storyId, value: count() })
    .from(storyLikesTable)
    .where(inArray(storyLikesTable.storyId, ids))
    .groupBy(storyLikesTable.storyId);
  const commentRows = await db
    .select({ storyId: storyCommentsTable.storyId, value: count() })
    .from(storyCommentsTable)
    .where(inArray(storyCommentsTable.storyId, ids))
    .groupBy(storyCommentsTable.storyId);
  const likeMap = new Map(likeRows.map((r) => [r.storyId, Number(r.value)]));
  const commentMap = new Map(commentRows.map((r) => [r.storyId, Number(r.value)]));
  const storyMap = new Map(stories.map((s) => [s.id, s]));

  res.json(
    reposts
      .map((r) => {
        const story = storyMap.get(r.storyId);
        if (!story) return null;
        return {
          repostId: r.id,
          reposterName: r.reposterName,
          note: r.note,
          repostedAt: r.createdAt,
          story: {
            ...story,
            likeCount: likeMap.get(story.id) ?? 0,
            commentCount: commentMap.get(story.id) ?? 0,
          },
        };
      })
      .filter(Boolean),
  );
});

export default router;
