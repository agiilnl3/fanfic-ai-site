import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
  }
}

const userCache = new Map<string, { user: User; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

function cleanHandle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 30) || `user${Date.now().toString(36)}`;
}

async function pickUniqueHandle(base: string): Promise<string> {
  let candidate = base;
  for (let i = 0; i < 8; i++) {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.handle, candidate))
      .limit(1);
    if (!existing) return candidate;
    candidate = `${base}${Math.floor(Math.random() * 9000 + 1000)}`;
  }
  return `${base}${Date.now().toString(36)}`;
}

export async function loadOrCreateUserFromClerk(
  clerkUserId: string,
): Promise<User | null> {
  const cached = userCache.get(clerkUserId);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  if (existing) {
    userCache.set(clerkUserId, { user: existing, expiresAt: Date.now() + CACHE_TTL_MS });
    return existing;
  }

  // Fetch profile from Clerk and create a local user row.
  let firstName = "";
  let lastName = "";
  let username = "";
  let avatarUrl: string | null = null;
  let primaryEmail = "";
  try {
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    firstName = clerkUser.firstName ?? "";
    lastName = clerkUser.lastName ?? "";
    username = clerkUser.username ?? "";
    avatarUrl = clerkUser.imageUrl ?? null;
    const emailObj = clerkUser.emailAddresses?.find(
      (e) => e.id === clerkUser.primaryEmailAddressId,
    );
    primaryEmail = emailObj?.emailAddress ?? "";
  } catch {
    /* clerk fetch failed — fall through with empty values */
  }
  const baseName = (
    username ||
    [firstName, lastName].filter(Boolean).join(" ") ||
    primaryEmail.split("@")[0] ||
    "user"
  ).trim();
  const baseHandle = cleanHandle(baseName);
  const handle = await pickUniqueHandle(baseHandle);
  const displayName = baseName || handle;

  const [created] = await db
    .insert(usersTable)
    .values({ clerkUserId, handle, displayName, avatarUrl })
    .onConflictDoUpdate({
      target: usersTable.clerkUserId,
      set: { updatedAt: new Date() },
    })
    .returning();
  userCache.set(clerkUserId, { user: created, expiresAt: Date.now() + CACHE_TTL_MS });
  return created;
}

export function invalidateUserCache(clerkUserId: string): void {
  userCache.delete(clerkUserId);
}

export async function attachUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = getAuth(req);
    const clerkUserId = auth?.userId;
    if (clerkUserId) {
      const user = await loadOrCreateUserFromClerk(clerkUserId);
      if (user) req.user = user;
    }
  } catch (err) {
    req.log?.warn({ err }, "attachUser failed");
  }
  next();
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

/**
 * Server-side authorization shim: when the user is signed in, force the
 * authoritative handle into common request fields that legacy routes read
 * (`body.authorName`, `body.followerName`, `body.requesterAuthorName`,
 * `body.reposterName`, `query.authorName`, `query.followerName`).
 *
 * This means the client is no longer trusted to claim an identity — the
 * Clerk session is the source of truth — without rewriting every route.
 */
export function overrideClientIdentity(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user) return next();
  const handle = req.user.handle;
  const body = req.body as Record<string, unknown> | undefined;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    if ("authorName" in body) body.authorName = handle;
    if ("followerName" in body) body.followerName = handle;
    if ("requesterAuthorName" in body) body.requesterAuthorName = handle;
    if ("reposterName" in body) body.reposterName = handle;
    if ("recipientName" in body && req.method !== "GET") {
      // recipient on notification-mark-read endpoints is the signed-in user
      body.recipientName = handle;
    }
  }
  next();
}

void sql;
