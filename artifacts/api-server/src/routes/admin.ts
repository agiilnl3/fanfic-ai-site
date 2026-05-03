import { Router, type IRouter } from "express";
import { and, eq, count, countDistinct, desc, inArray, gte, sql } from "drizzle-orm";
import {
  db,
  storiesTable,
  illustrationsTable,
  storyLikesTable,
  tariffsTable,
  authorFollowsTable,
  storyRepostsTable,
  storyCommentsTable,
  usersTable,
  adminsTable,
  featureFlagsTable,
  featureFlagOverridesTable,
} from "@workspace/db";
import { z } from "zod";
import { logAdminAction } from "../lib/admin-audit";
import {
  AdminLoginBody,
  AdminDeleteStoryParams,
  AdminUpdateStoryParams,
  AdminUpdateStoryBody,
  AdminGetTariffParams,
  AdminUpdateTariffParams,
  AdminUpdateTariffBody,
  AdminUpsertFlagBody,
  AdminSetFlagOverrideBody,
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
  await logAdminAction(req, {
    action: "delete_story",
    targetType: "story",
    targetId: deleted.id,
    metadata: { title: deleted.title, authorName: deleted.authorName },
  });
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
  await logAdminAction(req, {
    action: "update_story",
    targetType: "story",
    targetId: updated.id,
    metadata: body.data,
  });
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
    await logAdminAction(req, {
      action: "update_tariff",
      targetType: "tariff",
      targetId: null,
      metadata: { tier: params.data.tier, ...body.data },
    });
    res.json({ ...row, updatedAt: row.updatedAt.toISOString() });
  },
);

router.get("/admin/metrics", adminAuth, async (_req, res): Promise<void> => {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  // Daily stories created (kept for the trend bars).
  const dailyStoriesRows = await db
    .select({
      day: sql<string>`to_char(${storiesTable.createdAt}, 'YYYY-MM-DD')`,
      stories: count(),
    })
    .from(storiesTable)
    .where(gte(storiesTable.createdAt, since))
    .groupBy(sql`to_char(${storiesTable.createdAt}, 'YYYY-MM-DD')`);

  // True DAU: union of pen names that did *anything* on a given day —
  // wrote a story, liked, commented, reposted, recorded reading
  // progress, or appeared as a viewer in story_views. We collapse the
  // per-table activity into (day, author) and count distinct authors
  // per day in SQL so the work happens server-side.
  const sinceMs = since.getTime();
  const sinceLit = sql`to_timestamp(${sinceMs / 1000})`;
  const dau = await db.execute<{ day: string; authors: number }>(sql`
    WITH activity AS (
      SELECT to_char(created_at, 'YYYY-MM-DD') AS day, author_name AS who
        FROM stories WHERE created_at >= ${sinceLit}
      UNION ALL
      SELECT to_char(created_at, 'YYYY-MM-DD'), author_name
        FROM story_likes WHERE created_at >= ${sinceLit}
      UNION ALL
      SELECT to_char(created_at, 'YYYY-MM-DD'), author_name
        FROM story_comments WHERE created_at >= ${sinceLit}
      UNION ALL
      SELECT to_char(created_at, 'YYYY-MM-DD'), reposter_name
        FROM story_reposts WHERE created_at >= ${sinceLit}
      UNION ALL
      SELECT to_char(updated_at, 'YYYY-MM-DD'), author_name
        FROM reading_progress WHERE updated_at >= ${sinceLit}
      UNION ALL
      SELECT to_char(created_at, 'YYYY-MM-DD'), viewer_name
        FROM story_views
        WHERE created_at >= ${sinceLit} AND viewer_name IS NOT NULL
    )
    SELECT day, COUNT(DISTINCT who)::int AS authors
      FROM activity
     GROUP BY day
     ORDER BY day DESC
  `);
  const dauRows = (
    dau as unknown as { rows?: Array<{ day: string; authors: number }> }
  ).rows ?? (dau as unknown as Array<{ day: string; authors: number }>);
  const storiesByDay = new Map(
    dailyStoriesRows.map((r) => [r.day, Number(r.stories)]),
  );
  const allDays = new Set<string>([
    ...dauRows.map((r) => r.day),
    ...dailyStoriesRows.map((r) => r.day),
  ]);
  const authorsByDay = new Map(
    dauRows.map((r) => [r.day, Number(r.authors)]),
  );
  const dailyStories = Array.from(allDays)
    .sort((a, b) => (a < b ? 1 : -1))
    .map((day) => ({
      day,
      authors: authorsByDay.get(day) ?? 0,
      stories: storiesByDay.get(day) ?? 0,
    }));

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

  // Top stories: rank globally over the engagement event tables, not over
  // a fixed "newest 50" sample. We aggregate per-storyId scores in SQL
  // (likes*3 + reposts*5 + comments*2), keep only the published top 10,
  // then hydrate titles/authors.
  // Filter to status='published' INSIDE the CTE so the top-N is computed
  // over published stories only — otherwise hidden/draft stories with
  // high engagement could push genuinely top published stories out of
  // the LIMIT window.
  const scored = await db.execute<{
    storyId: number;
    likes: number;
    reposts: number;
    comments: number;
    score: number;
  }>(sql`
    WITH agg AS (
      SELECT ev.story_id,
             COUNT(*) FILTER (WHERE ev.src = 'l') AS likes,
             COUNT(*) FILTER (WHERE ev.src = 'r') AS reposts,
             COUNT(*) FILTER (WHERE ev.src = 'c') AS comments
        FROM (
          SELECT story_id, 'l' AS src FROM story_likes
          UNION ALL
          SELECT story_id, 'r' FROM story_reposts
          UNION ALL
          SELECT story_id, 'c' FROM story_comments
        ) ev
        JOIN stories s ON s.id = ev.story_id
       WHERE s.status = 'published'
       GROUP BY ev.story_id
    )
    SELECT story_id      AS "storyId",
           likes::int    AS likes,
           reposts::int  AS reposts,
           comments::int AS comments,
           (likes * 3 + reposts * 5 + comments * 2)::int AS score
      FROM agg
     ORDER BY score DESC
     LIMIT 50
  `);
  const scoredRows = (
    scored as unknown as {
      rows?: Array<{
        storyId: number;
        likes: number;
        reposts: number;
        comments: number;
        score: number;
      }>;
    }
  ).rows ??
    (scored as unknown as Array<{
      storyId: number;
      likes: number;
      reposts: number;
      comments: number;
      score: number;
    }>);
  const candidateIds = scoredRows.map((r) => r.storyId);
  const publishedTopRows = candidateIds.length
    ? await db
        .select({
          id: storiesTable.id,
          title: storiesTable.title,
          authorName: storiesTable.authorName,
        })
        .from(storiesTable)
        .where(
          and(
            inArray(storiesTable.id, candidateIds),
            eq(storiesTable.status, "published"),
          ),
        )
    : [];
  const pubMap = new Map(publishedTopRows.map((r) => [r.id, r]));
  const topStories = scoredRows
    .filter((r) => pubMap.has(r.storyId))
    .slice(0, 10)
    .map((r) => {
      const meta = pubMap.get(r.storyId)!;
      return {
        id: meta.id,
        title: meta.title,
        authorName: meta.authorName,
        likeCount: r.likes,
        repostCount: r.reposts,
        commentCount: r.comments,
      };
    });

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

// --- Users -----------------------------------------------------------

const ListUsersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const SetBannedParams = z.object({ id: z.coerce.number().int().positive() });
const SetBannedBody = z.object({ banned: z.boolean() });

async function shapeUserRows(
  rows: Array<typeof usersTable.$inferSelect>,
): Promise<Array<Record<string, unknown>>> {
  if (rows.length === 0) return [];
  const handles = rows.map((r) => r.handle);
  const userIds = rows.map((r) => r.id);
  const counts = await db
    .select({ authorName: storiesTable.authorName, c: count() })
    .from(storiesTable)
    .where(inArray(storiesTable.authorName, handles))
    .groupBy(storiesTable.authorName);
  const cMap = new Map(counts.map((r) => [r.authorName, Number(r.c)]));
  // Source `isAdmin` from the canonical allow-list, not the legacy
  // `users.is_admin` column, so the panel reflects actual authz.
  const adminRows = await db
    .select({ userId: adminsTable.userId })
    .from(adminsTable)
    .where(inArray(adminsTable.userId, userIds));
  const adminSet = new Set(adminRows.map((r) => r.userId));
  return rows.map((u) => ({
    id: u.id,
    handle: u.handle,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    isAdmin: adminSet.has(u.id),
    banned: u.banned,
    createdAt: u.createdAt.toISOString(),
    storyCount: cMap.get(u.handle) ?? 0,
  }));
}

router.get("/admin/users", adminAuth, async (req, res): Promise<void> => {
  const q = ListUsersQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const rows = await db
    .select()
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt))
    .limit(q.data.limit ?? 50);
  res.json(await shapeUserRows(rows));
});

router.post(
  "/admin/users/:id/ban",
  adminAuth,
  async (req, res): Promise<void> => {
    const params = SetBannedParams.safeParse(req.params);
    const body = SetBannedBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const [updated] = await db
      .update(usersTable)
      .set({ banned: body.data.banned, updatedAt: new Date() })
      .where(eq(usersTable.id, params.data.id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await logAdminAction(req, {
      action: body.data.banned ? "ban_user" : "unban_user",
      targetType: "user",
      targetId: updated.id,
      metadata: { handle: updated.handle },
    });
    const [shaped] = await shapeUserRows([updated]);
    res.json(shaped);
  },
);

// --- Feature flags --------------------------------------------------

const FLAG_NAME_RE = /^[a-zA-Z0-9_.-]+$/;
const FlagNameParam = z.object({
  name: z.string().min(1).max(128).regex(FLAG_NAME_RE),
});
const FlagOverrideParams = z.object({
  name: z.string().min(1).max(128).regex(FLAG_NAME_RE),
  userId: z.coerce.number().int().positive(),
});

async function shapeFlagRows(
  rows: Array<typeof featureFlagsTable.$inferSelect>,
): Promise<
  Array<{
    name: string;
    enabled: boolean;
    rolloutPercent: number;
    description: string | null;
    updatedAt: string;
    overrideCount: number;
  }>
> {
  if (rows.length === 0) return [];
  const names = rows.map((r) => r.name);
  const counts = await db
    .select({
      flagName: featureFlagOverridesTable.flagName,
      c: count(),
    })
    .from(featureFlagOverridesTable)
    .where(inArray(featureFlagOverridesTable.flagName, names))
    .groupBy(featureFlagOverridesTable.flagName);
  const cMap = new Map(counts.map((r) => [r.flagName, Number(r.c)]));
  return rows.map((f) => ({
    name: f.name,
    enabled: f.enabled,
    rolloutPercent: f.rolloutPercent,
    description: f.description,
    updatedAt: f.updatedAt.toISOString(),
    overrideCount: cMap.get(f.name) ?? 0,
  }));
}

router.get("/admin/flags", adminAuth, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(featureFlagsTable)
    .orderBy(featureFlagsTable.name);
  res.json(await shapeFlagRows(rows));
});

router.put("/admin/flags/:name", adminAuth, async (req, res): Promise<void> => {
  const params = FlagNameParam.safeParse(req.params);
  const body = AdminUpsertFlagBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const description = body.data.description ?? null;
  const [row] = await db
    .insert(featureFlagsTable)
    .values({
      name: params.data.name,
      enabled: body.data.enabled,
      rolloutPercent: body.data.rolloutPercent,
      description,
    })
    .onConflictDoUpdate({
      target: featureFlagsTable.name,
      set: {
        enabled: body.data.enabled,
        rolloutPercent: body.data.rolloutPercent,
        description,
        updatedAt: new Date(),
      },
    })
    .returning();
  await logAdminAction(req, {
    action: "upsert_flag",
    targetType: "feature_flag",
    targetId: null,
    metadata: {
      name: params.data.name,
      enabled: body.data.enabled,
      rolloutPercent: body.data.rolloutPercent,
    },
  });
  const [shaped] = await shapeFlagRows([row]);
  res.json(shaped);
});

router.delete(
  "/admin/flags/:name",
  adminAuth,
  async (req, res): Promise<void> => {
    const params = FlagNameParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const [deleted] = await db
      .delete(featureFlagsTable)
      .where(eq(featureFlagsTable.name, params.data.name))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db
      .delete(featureFlagOverridesTable)
      .where(eq(featureFlagOverridesTable.flagName, params.data.name));
    await logAdminAction(req, {
      action: "delete_flag",
      targetType: "feature_flag",
      targetId: null,
      metadata: { name: params.data.name },
    });
    res.sendStatus(204);
  },
);

router.get(
  "/admin/flags/:name/overrides",
  adminAuth,
  async (req, res): Promise<void> => {
    const params = FlagNameParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const rows = await db
      .select({
        flagName: featureFlagOverridesTable.flagName,
        userId: featureFlagOverridesTable.userId,
        enabled: featureFlagOverridesTable.enabled,
        createdAt: featureFlagOverridesTable.createdAt,
        userHandle: usersTable.handle,
      })
      .from(featureFlagOverridesTable)
      .leftJoin(
        usersTable,
        eq(featureFlagOverridesTable.userId, usersTable.id),
      )
      .where(eq(featureFlagOverridesTable.flagName, params.data.name))
      .orderBy(desc(featureFlagOverridesTable.createdAt));
    res.json(
      rows.map((r) => ({
        flagName: r.flagName,
        userId: r.userId,
        userHandle: r.userHandle,
        enabled: r.enabled,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  },
);

router.post(
  "/admin/flags/:name/overrides",
  adminAuth,
  async (req, res): Promise<void> => {
    const params = FlagNameParam.safeParse(req.params);
    const body = AdminSetFlagOverrideBody.safeParse(req.body ?? {});
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const [flag] = await db
      .select({ name: featureFlagsTable.name })
      .from(featureFlagsTable)
      .where(eq(featureFlagsTable.name, params.data.name))
      .limit(1);
    if (!flag) {
      res.status(404).json({ error: "Flag not found" });
      return;
    }
    const [user] = await db
      .select({ id: usersTable.id, handle: usersTable.handle })
      .from(usersTable)
      .where(eq(usersTable.id, body.data.userId))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const [row] = await db
      .insert(featureFlagOverridesTable)
      .values({
        flagName: params.data.name,
        userId: body.data.userId,
        enabled: body.data.enabled,
      })
      .onConflictDoUpdate({
        target: [
          featureFlagOverridesTable.flagName,
          featureFlagOverridesTable.userId,
        ],
        set: { enabled: body.data.enabled },
      })
      .returning();
    await logAdminAction(req, {
      action: "set_flag_override",
      targetType: "feature_flag",
      targetId: body.data.userId,
      metadata: {
        flagName: params.data.name,
        userId: body.data.userId,
        enabled: body.data.enabled,
      },
    });
    res.json({
      flagName: row.flagName,
      userId: row.userId,
      userHandle: user.handle,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
    });
  },
);

router.delete(
  "/admin/flags/:name/overrides/:userId",
  adminAuth,
  async (req, res): Promise<void> => {
    const params = FlagOverrideParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const [deleted] = await db
      .delete(featureFlagOverridesTable)
      .where(
        and(
          eq(featureFlagOverridesTable.flagName, params.data.name),
          eq(featureFlagOverridesTable.userId, params.data.userId),
        ),
      )
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await logAdminAction(req, {
      action: "delete_flag_override",
      targetType: "feature_flag",
      targetId: params.data.userId,
      metadata: { flagName: params.data.name, userId: params.data.userId },
    });
    res.sendStatus(204);
  },
);

export default router;
