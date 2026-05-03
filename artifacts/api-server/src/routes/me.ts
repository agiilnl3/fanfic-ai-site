import { Router, type IRouter } from "express";
import { eq, and, ne, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  usersTable,
  storiesTable,
  storyCommentsTable,
  storyLikesTable,
  storyRepostsTable,
  authorFollowsTable,
  bookmarksTable,
  readingProgressTable,
  seriesTable,
  notificationPrefsTable,
} from "@workspace/db";
import { requireAuth, invalidateUserCache } from "../middlewares/auth";
import { isUserAdmin } from "../middlewares/admin";
import { getUserPlan } from "../lib/subscriptions";

const router: IRouter = Router();

const UpdateMeBody = z.object({
  handle: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[a-z0-9_]+$/, "Handle may contain lowercase letters, digits, and underscores only")
    .optional(),
  displayName: z.string().min(1).max(80).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional().or(z.literal("")),
});

router.get("/me", requireAuth, async (req, res): Promise<void> => {
  const u = req.user!;
  // Canonical admin marker is membership in the `admins` allow-list table.
  // The legacy `users.is_admin` column is no longer trusted by adminAuth.
  const [isAdmin, plan] = await Promise.all([
    isUserAdmin(u.id),
    getUserPlan(u.id),
  ]);
  res.json({
    id: u.id,
    clerkUserId: u.clerkUserId,
    handle: u.handle,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    isAdmin,
    plan,
    createdAt: u.createdAt.toISOString(),
  });
});

router.put("/me", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateMeBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const me = req.user!;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const newHandle = parsed.data.handle;
  if (newHandle && newHandle !== me.handle) {
    const [conflict] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.handle, newHandle), ne(usersTable.id, me.id)))
      .limit(1);
    if (conflict) {
      res.status(409).json({ error: "Handle is already taken" });
      return;
    }
    // Block claiming a handle that has any orphan legacy rows attributed to
    // it (user_id IS NULL). Otherwise editing one's handle would silently
    // grant edit/delete rights over another author's pre-Clerk content.
    const [legacyStory] = await db
      .select({ id: storiesTable.id })
      .from(storiesTable)
      .where(and(eq(storiesTable.authorName, newHandle), isNull(storiesTable.userId)))
      .limit(1);
    const [legacySeries] = await db
      .select({ id: seriesTable.id })
      .from(seriesTable)
      .where(and(eq(seriesTable.authorName, newHandle), isNull(seriesTable.userId)))
      .limit(1);
    if (legacyStory || legacySeries) {
      res.status(409).json({
        error: "Handle is reserved by legacy content. Choose a different handle.",
      });
      return;
    }
    patch.handle = newHandle;
  }
  if (parsed.data.displayName !== undefined) patch.displayName = parsed.data.displayName;
  if (parsed.data.bio !== undefined) patch.bio = parsed.data.bio;
  if (parsed.data.avatarUrl !== undefined) {
    patch.avatarUrl = parsed.data.avatarUrl === "" ? null : parsed.data.avatarUrl;
  }
  // Run the user update plus all denormalized handle renames in a single
  // transaction so account-keyed lookups stay consistent with users.handle.
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(usersTable)
      .set(patch)
      .where(eq(usersTable.id, me.id))
      .returning();
    if (patch.handle) {
      const oldHandle = me.handle;
      const h = u.handle;
      await tx.update(storiesTable).set({ authorName: h }).where(eq(storiesTable.userId, me.id));
      await tx.update(seriesTable).set({ authorName: h }).where(eq(seriesTable.userId, me.id));
      await tx
        .update(storyCommentsTable)
        .set({ authorName: h })
        .where(eq(storyCommentsTable.userId, me.id));
      await tx
        .update(storyLikesTable)
        .set({ authorName: h })
        .where(eq(storyLikesTable.userId, me.id));
      await tx
        .update(storyRepostsTable)
        .set({ reposterName: h })
        .where(eq(storyRepostsTable.userId, me.id));
      await tx
        .update(authorFollowsTable)
        .set({ followerName: h })
        .where(eq(authorFollowsTable.followerUserId, me.id));
      await tx
        .update(bookmarksTable)
        .set({ authorName: h })
        .where(eq(bookmarksTable.userId, me.id));
      await tx
        .update(readingProgressTable)
        .set({ authorName: h })
        .where(eq(readingProgressTable.userId, me.id));
      if (oldHandle !== h) {
        await tx
          .delete(notificationPrefsTable)
          .where(eq(notificationPrefsTable.authorName, h));
        await tx
          .update(notificationPrefsTable)
          .set({ authorName: h })
          .where(eq(notificationPrefsTable.authorName, oldHandle));
      }
    }
    return u;
  });

  invalidateUserCache(me.clerkUserId);
  const plan = await getUserPlan(updated.id);
  res.json({
    id: updated.id,
    clerkUserId: updated.clerkUserId,
    handle: updated.handle,
    displayName: updated.displayName,
    avatarUrl: updated.avatarUrl,
    bio: updated.bio,
    isAdmin: updated.isAdmin,
    plan,
    createdAt: updated.createdAt.toISOString(),
  });
});

export default router;
