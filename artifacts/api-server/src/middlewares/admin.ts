import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, adminsTable } from "@workspace/db";

const adminCache = new Map<number, { isAdmin: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

export function invalidateAdminCache(userId?: number): void {
  if (userId === undefined) adminCache.clear();
  else adminCache.delete(userId);
}

export async function isUserAdmin(userId: number): Promise<boolean> {
  const cached = adminCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.isAdmin;
  const [row] = await db
    .select({ userId: adminsTable.userId })
    .from(adminsTable)
    .where(eq(adminsTable.userId, userId))
    .limit(1);
  const isAdmin = !!row;
  adminCache.set(userId, { isAdmin, expiresAt: Date.now() + CACHE_TTL_MS });
  return isAdmin;
}

/**
 * Admin auth requires either:
 *   - a Clerk-authenticated user whose id is in the `admins` allow-list
 *     table (the canonical admin gate), or
 *   - the legacy `x-admin-token` header matching ADMIN_PASSWORD as an
 *     emergency fallback (kept per task #11 spec).
 */
export async function adminAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.user && (await isUserAdmin(req.user.id))) {
    next();
    return;
  }
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    res.status(500).json({ error: "ADMIN_PASSWORD not configured on server" });
    return;
  }
  const token = req.header("x-admin-token");
  if (!token || token !== expected) {
    res.status(401).json({ error: "Invalid admin token" });
    return;
  }
  next();
}
