import { Router, type IRouter } from "express";
import { eq, and, ne } from "drizzle-orm";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import { requireAuth, invalidateUserCache } from "../middlewares/auth";

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

router.get("/me", requireAuth, (req, res): void => {
  const u = req.user!;
  res.json({
    id: u.id,
    clerkUserId: u.clerkUserId,
    handle: u.handle,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    isAdmin: u.isAdmin,
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
  if (parsed.data.handle && parsed.data.handle !== me.handle) {
    const [conflict] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.handle, parsed.data.handle), ne(usersTable.id, me.id)))
      .limit(1);
    if (conflict) {
      res.status(409).json({ error: "Handle is already taken" });
      return;
    }
    patch.handle = parsed.data.handle;
  }
  if (parsed.data.displayName !== undefined) patch.displayName = parsed.data.displayName;
  if (parsed.data.bio !== undefined) patch.bio = parsed.data.bio;
  if (parsed.data.avatarUrl !== undefined) {
    patch.avatarUrl = parsed.data.avatarUrl === "" ? null : parsed.data.avatarUrl;
  }
  const [updated] = await db
    .update(usersTable)
    .set(patch)
    .where(eq(usersTable.id, me.id))
    .returning();
  invalidateUserCache(me.clerkUserId);
  res.json({
    id: updated.id,
    clerkUserId: updated.clerkUserId,
    handle: updated.handle,
    displayName: updated.displayName,
    avatarUrl: updated.avatarUrl,
    bio: updated.bio,
    isAdmin: updated.isAdmin,
    createdAt: updated.createdAt.toISOString(),
  });
});

export default router;
