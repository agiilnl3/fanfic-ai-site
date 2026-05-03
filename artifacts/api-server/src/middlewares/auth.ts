import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";

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
 * Routes that are intentionally public (no auth required for writes).
 * Everything else under /api/* requires an authenticated Clerk session
 * for any non-GET request.
 */
const PUBLIC_WRITE_PATTERNS: RegExp[] = [
  /^\/admin\/login\b/, // legacy admin token login
  /^\/stories\/\d+\/view\b/, // anonymous view counter
];

const IDENTITY_BODY_KEYS = [
  "authorName",
  "followerName",
  "requesterAuthorName",
  "reposterName",
  "recipientName",
  "actorName",
  "ownerName",
  "userName",
] as const;

const IDENTITY_QUERY_KEYS = [
  "authorName",
  "followerName",
  "requesterAuthorName",
  "reposterName",
  "recipientName",
  "ownerName",
] as const;

function isPublicWritePath(path: string): boolean {
  return PUBLIC_WRITE_PATTERNS.some((re) => re.test(path));
}

/**
 * Server-side authorization shim:
 *  - Rejects all non-GET requests under /api/* without a Clerk session
 *    (with a small public allowlist).
 *  - When signed in, forces the authoritative handle into common request
 *    body and query fields that legacy routes read so the client cannot
 *    impersonate another user without rewriting every route.
 */
export function overrideClientIdentity(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const isWrite = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";

  // Allow legacy x-admin-token-authenticated writes through to per-route
  // adminAuth middleware, which validates the token. Without this bypass,
  // /admin/* writes would be rejected here before adminAuth runs.
  const adminToken = req.header("x-admin-token");
  const hasAdminToken =
    !!adminToken && !!process.env.ADMIN_PASSWORD && adminToken === process.env.ADMIN_PASSWORD;

  if (isWrite && !req.user && !hasAdminToken && !isPublicWritePath(req.path)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  if (!req.user) return next();
  const handle = req.user.handle;

  const body = req.body as Record<string, unknown> | undefined;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const key of IDENTITY_BODY_KEYS) {
      if (key in body) body[key] = handle;
    }
  }

  // Express's req.query is a getter on Express 5; mutate in place.
  const query = req.query as Record<string, unknown> | undefined;
  if (query && typeof query === "object") {
    for (const key of IDENTITY_QUERY_KEYS) {
      if (key in query) query[key] = handle;
    }
  }

  next();
}

void sql;
