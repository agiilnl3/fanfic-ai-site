import { Router, type IRouter } from "express";
import { and, eq, desc, count, inArray, sql, or, isNull } from "drizzle-orm";
import {
  db,
  storiesTable,
  authorFollowsTable,
  storyLikesTable,
  storyCommentsTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import {
  GetAuthorProfileParams,
  GetAuthorFollowParams,
  GetAuthorFollowQueryParams,
  FollowAuthorParams,
  FollowAuthorBody,
  UnfollowAuthorParams,
  UnfollowAuthorQueryParams,
  SearchAuthorsQueryParams,
} from "@workspace/api-zod";
import { ilike } from "drizzle-orm";
import { writeLimiter } from "../middlewares/rate-limit";
import { logger } from "../lib/logger";
import { notifyRecipient } from "../lib/notification-bus";

const router: IRouter = Router();

async function followCounts(authorName: string, followerName?: string) {
  const [followerRow] = await db
    .select({ value: count() })
    .from(authorFollowsTable)
    .where(eq(authorFollowsTable.authorName, authorName));
  let isFollowing = false;
  if (followerName && followerName.trim()) {
    const [existing] = await db
      .select({ id: authorFollowsTable.id })
      .from(authorFollowsTable)
      .where(
        and(
          eq(authorFollowsTable.authorName, authorName),
          eq(authorFollowsTable.followerName, followerName.trim()),
        ),
      )
      .limit(1);
    isFollowing = Boolean(existing);
  }
  return {
    authorName,
    followerCount: followerRow?.value ?? 0,
    isFollowing,
  };
}

router.get("/authors/search", async (req, res): Promise<void> => {
  const parsed = SearchAuthorsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "q required" });
    return;
  }
  const term = parsed.data.q.trim();
  if (!term) {
    res.json([]);
    return;
  }
  const limit = parsed.data.limit ?? 10;
  const rows = await db
    .select({
      authorName: storiesTable.authorName,
      publishedCount: count(storiesTable.id),
    })
    .from(storiesTable)
    .where(
      and(
        eq(storiesTable.status, "published"),
        ilike(storiesTable.authorName, `%${term}%`),
      ),
    )
    .groupBy(storiesTable.authorName)
    .orderBy(desc(count(storiesTable.id)))
    .limit(limit);

  if (rows.length === 0) {
    res.json([]);
    return;
  }
  const names = rows.map((r) => r.authorName);
  const followerRows = await db
    .select({
      authorName: authorFollowsTable.authorName,
      value: count(authorFollowsTable.id),
    })
    .from(authorFollowsTable)
    .where(inArray(authorFollowsTable.authorName, names))
    .groupBy(authorFollowsTable.authorName);
  const followerMap = new Map(followerRows.map((r) => [r.authorName, Number(r.value)]));

  res.json(
    rows.map((r) => ({
      authorName: r.authorName,
      publishedCount: Number(r.publishedCount),
      followerCount: followerMap.get(r.authorName) ?? 0,
    })),
  );
});

router.get("/authors/:name", async (req, res): Promise<void> => {
  const params = GetAuthorProfileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  const name = params.data.name;

  const [profile] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.handle, name))
    .limit(1);

  const stories = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.authorName, name))
    .orderBy(desc(storiesTable.createdAt));

  if (stories.length === 0) {
    // still respond — author may have a follow row but no stories
    const [followerRow] = await db
      .select({ value: count() })
      .from(authorFollowsTable)
      .where(eq(authorFollowsTable.authorName, name));
    const [followingRow] = await db
      .select({ value: count() })
      .from(authorFollowsTable)
      .where(eq(authorFollowsTable.followerName, name));
    if (!profile && (followerRow?.value ?? 0) === 0 && (followingRow?.value ?? 0) === 0) {
      res.status(404).json({ error: "Author not found" });
      return;
    }
    res.json({
      authorName: name,
      handle: profile?.handle ?? name,
      displayName: profile?.displayName ?? name,
      bio: profile?.bio ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
      joinedAt: profile?.createdAt ? profile.createdAt.toISOString() : null,
      storyCount: 0,
      publishedCount: 0,
      followerCount: followerRow?.value ?? 0,
      followingCount: followingRow?.value ?? 0,
      totalLikes: 0,
      firstSeenAt: null,
      stories: [],
    });
    return;
  }

  const published = stories.filter((s) => s.status === "published");
  const ids = stories.map((s) => s.id);
  const publishedIds = published.map((s) => s.id);

  const likeRows = publishedIds.length
    ? await db
        .select({ storyId: storyLikesTable.storyId, value: count() })
        .from(storyLikesTable)
        .where(inArray(storyLikesTable.storyId, publishedIds))
        .groupBy(storyLikesTable.storyId)
    : [];
  const commentRows = publishedIds.length
    ? await db
        .select({ storyId: storyCommentsTable.storyId, value: count() })
        .from(storyCommentsTable)
        .where(inArray(storyCommentsTable.storyId, publishedIds))
        .groupBy(storyCommentsTable.storyId)
    : [];
  const likeMap = new Map(likeRows.map((r) => [r.storyId, Number(r.value)]));
  const commentMap = new Map(commentRows.map((r) => [r.storyId, Number(r.value)]));

  const totalLikes = likeRows.reduce((acc, r) => acc + Number(r.value), 0);

  const [followerRow] = await db
    .select({ value: count() })
    .from(authorFollowsTable)
    .where(eq(authorFollowsTable.authorName, name));
  const [followingRow] = await db
    .select({ value: count() })
    .from(authorFollowsTable)
    .where(eq(authorFollowsTable.followerName, name));

  const firstSeenAt = stories.reduce<Date | null>((acc, s) => {
    const created = s.createdAt as Date;
    if (!acc || (created && created < acc)) return created;
    return acc;
  }, null);

  res.json({
    authorName: name,
    handle: profile?.handle ?? name,
    displayName: profile?.displayName ?? name,
    bio: profile?.bio ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
    joinedAt: profile?.createdAt ? profile.createdAt.toISOString() : null,
    storyCount: stories.length,
    publishedCount: published.length,
    followerCount: followerRow?.value ?? 0,
    followingCount: followingRow?.value ?? 0,
    totalLikes,
    firstSeenAt: firstSeenAt ? firstSeenAt.toISOString() : null,
    stories: published.map((s) => ({
      ...s,
      likeCount: likeMap.get(s.id) ?? 0,
      commentCount: commentMap.get(s.id) ?? 0,
    })),
  });
  void ids;
  void sql;
});

router.get("/authors/:name/follow", async (req, res): Promise<void> => {
  const params = GetAuthorFollowParams.safeParse(req.params);
  const query = GetAuthorFollowQueryParams.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }
  res.json(await followCounts(params.data.name, query.data.followerName));
});

router.post("/authors/:name/follow", writeLimiter, async (req, res): Promise<void> => {
  const params = FollowAuthorParams.safeParse(req.params);
  const body = FollowAuthorBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }
  const author = params.data.name;
  const follower = body.data.followerName.trim();
  if (!follower) {
    res.status(400).json({ error: "followerName required" });
    return;
  }
  if (follower === author) {
    res.status(400).json({ error: "Cannot follow yourself" });
    return;
  }

  let inserted: { id: number }[] = [];
  try {
    inserted = await db
      .insert(authorFollowsTable)
      .values({ authorName: author, followerName: follower, followerUserId: req.user?.id ?? null })
      .onConflictDoNothing()
      .returning({ id: authorFollowsTable.id });
  } catch (err) {
    logger.warn({ err }, "failed to insert follow");
  }

  // notify the author only when a new follow row was actually created
  if (inserted.length > 0) {
    try {
      await db.insert(notificationsTable).values({
        recipientName: author,
        type: "follow",
        actorName: follower,
        payload: {},
      });
      notifyRecipient(author);
    } catch (err) {
      logger.warn({ err }, "failed to insert follow notification");
    }
  }

  res.json(await followCounts(author, follower));
});

router.delete("/authors/:name/follow", writeLimiter, async (req, res): Promise<void> => {
  const params = UnfollowAuthorParams.safeParse(req.params);
  const query = UnfollowAuthorQueryParams.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }
  const author = params.data.name;
  const follower = query.data.followerName.trim();
  const ownership = req.user
    ? or(
        eq(authorFollowsTable.followerUserId, req.user.id),
        and(
          isNull(authorFollowsTable.followerUserId),
          eq(authorFollowsTable.followerName, req.user.handle),
        ),
      )
    : eq(authorFollowsTable.followerName, follower);
  await db
    .delete(authorFollowsTable)
    .where(
      and(eq(authorFollowsTable.authorName, author), ownership!),
    );
  res.json(await followCounts(author, follower));
});

export default router;
