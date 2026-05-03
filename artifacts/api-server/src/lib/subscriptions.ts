// Per-user subscription / plan resolution.
// Local `subscriptions` table denormalizes Stripe state for fast tier lookups
// in hot paths (quota checks, story authz). Source of truth remains Stripe;
// this row is updated by webhook events.

import { eq } from "drizzle-orm";
import { db, subscriptionsTable, usersTable, type Subscription } from "@workspace/db";

export type Plan = "free" | "conjurer";

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

const planCache = new Map<number, { plan: Plan; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

function planFromRow(row: Subscription | undefined): Plan {
  if (!row) return "free";
  if (row.plan !== "conjurer") return "free";
  if (!ACTIVE_STATUSES.has(row.status)) return "free";
  // Honor period-end as a guard against missed webhooks.
  if (row.currentPeriodEnd && row.currentPeriodEnd.getTime() < Date.now()) {
    return "free";
  }
  return "conjurer";
}

export async function getUserPlan(userId: number): Promise<Plan> {
  const cached = planCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.plan;
  const [row] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .limit(1);
  const plan = planFromRow(row);
  planCache.set(userId, { plan, expiresAt: Date.now() + CACHE_TTL_MS });
  return plan;
}

export function invalidatePlanCache(userId?: number): void {
  if (userId == null) planCache.clear();
  else planCache.delete(userId);
}

export async function getSubscriptionForUser(
  userId: number,
): Promise<Subscription | null> {
  const [row] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve a user's plan by their handle. Used by quota checks that only know
 * the author handle (e.g. legacy guest callers go through here too and
 * resolve to "free").
 */
export async function getPlanByHandle(handle: string): Promise<Plan> {
  if (!handle) return "free";
  const [u] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.handle, handle))
    .limit(1);
  if (!u) return "free";
  return getUserPlan(u.id);
}
