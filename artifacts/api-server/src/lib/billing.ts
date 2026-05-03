// Helpers shared by billing routes and the Stripe webhook handler.
// Owns the local `subscriptions` row and Stripe Customer creation.

import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import {
  db,
  storiesTable,
  subscriptionsTable,
  usersTable,
  type User,
} from "@workspace/db";
import { clerkClient } from "@clerk/express";
import { getUncachableStripeClient } from "./stripeClient";
import { invalidatePlanCache, type Plan } from "./subscriptions";
import { logger } from "./logger";

export const CONJURER_PRODUCT_NAME = "Conjurer Monthly";
export const CONJURER_METADATA_KEY = "fanfic_plan";
export const CONJURER_METADATA_VALUE = "conjurer";

export interface ResolvedPlan {
  plan: Plan;
  status: string;
  currentPeriodEnd: Date | null;
  stripeSubscriptionId: string | null;
  priceId: string | null;
}

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Look up the user's email in Clerk for Stripe Customer creation. */
async function emailForUser(user: User): Promise<string | undefined> {
  try {
    const clerkUser = await clerkClient.users.getUser(user.clerkUserId);
    const e = clerkUser.emailAddresses?.find(
      (x) => x.id === clerkUser.primaryEmailAddressId,
    );
    return e?.emailAddress ?? clerkUser.emailAddresses?.[0]?.emailAddress;
  } catch (err) {
    logger.warn({ err, userId: user.id }, "clerk email lookup failed");
    return undefined;
  }
}

/**
 * Idempotently get-or-create the Stripe Customer for this app user and
 * persist a row in the local `subscriptions` table. Called from the
 * checkout/portal routes and from webhook handlers as a safety net.
 */
export async function ensureStripeCustomer(user: User): Promise<string> {
  const [existing] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, user.id))
    .limit(1);
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const stripe = await getUncachableStripeClient();
  const email = await emailForUser(user);
  const customer = await stripe.customers.create({
    email,
    name: user.displayName,
    metadata: { fanfic_user_id: String(user.id), fanfic_handle: user.handle },
  });

  await db
    .insert(subscriptionsTable)
    .values({
      userId: user.id,
      stripeCustomerId: customer.id,
      plan: "free",
      status: "inactive",
    })
    .onConflictDoUpdate({
      target: subscriptionsTable.userId,
      set: {
        stripeCustomerId: customer.id,
        updatedAt: new Date(),
      },
    });
  invalidatePlanCache(user.id);
  return customer.id;
}

/**
 * Fetch the live Stripe Subscription for a customer and reduce it to a Plan.
 * Used when a webhook event references a subscription id (we always re-fetch
 * to avoid trusting the event payload version).
 */
export async function resolvePlanForCustomer(
  customerId: string,
): Promise<ResolvedPlan> {
  const stripe = await getUncachableStripeClient();
  // List active-ish subscriptions; pick the most recent.
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 5,
    expand: ["data.items.data.price.product"],
  });
  // Prefer an active/trialing/past_due subscription; fall back to most recent.
  const ranked = [...subs.data].sort((a, b) => {
    const aActive = ACTIVE_STATUSES.has(a.status) ? 1 : 0;
    const bActive = ACTIVE_STATUSES.has(b.status) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return b.created - a.created;
  });
  const sub = ranked[0];
  if (!sub) {
    return {
      plan: "free",
      status: "inactive",
      currentPeriodEnd: null,
      stripeSubscriptionId: null,
      priceId: null,
    };
  }
  const item = sub.items.data[0];
  const price = item?.price;
  const product =
    price && typeof price.product === "object" && price.product !== null
      ? (price.product as Stripe.Product)
      : null;
  const isConjurer =
    product?.metadata?.[CONJURER_METADATA_KEY] === CONJURER_METADATA_VALUE ||
    product?.name === CONJURER_PRODUCT_NAME;
  const plan: Plan =
    ACTIVE_STATUSES.has(sub.status) && isConjurer ? "conjurer" : "free";
  // The Stripe SDK types lag the live API, which moved current_period_end
  // onto subscription items. Read from item first, fall back to the legacy
  // top-level field. A narrow inline type keeps us from leaking `any`.
  type WithPeriodEnd = { current_period_end?: number };
  const periodEndUnix =
    (item as WithPeriodEnd | undefined)?.current_period_end ??
    (sub as unknown as WithPeriodEnd).current_period_end ??
    null;
  return {
    plan,
    status: sub.status,
    currentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
    stripeSubscriptionId: sub.id,
    priceId: price?.id ?? null,
  };
}

/**
 * Upsert a subscriptions row from a resolved plan. Looks up the local user
 * by stripe_customer_id; if no local row exists yet, creates one.
 */
export async function applyPlanForCustomer(
  customerId: string,
  resolved: ResolvedPlan,
): Promise<void> {
  // Resolve the local user via the existing subscriptions row, or via the
  // Stripe customer's metadata.fanfic_user_id (set in ensureStripeCustomer).
  let userId: number | null = null;
  const [existing] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.stripeCustomerId, customerId))
    .limit(1);
  if (existing) {
    userId = existing.userId;
  } else {
    try {
      const stripe = await getUncachableStripeClient();
      const customer = await stripe.customers.retrieve(customerId);
      if (!customer.deleted) {
        const meta = customer.metadata?.fanfic_user_id;
        if (meta) {
          const parsed = Number(meta);
          if (Number.isFinite(parsed)) userId = parsed;
        }
      }
    } catch (err) {
      logger.warn({ err, customerId }, "stripe customer lookup failed");
    }
  }
  if (userId == null) {
    logger.warn({ customerId }, "no local user found for stripe customer");
    return;
  }

  // Confirm the user actually exists locally before writing the FK.
  const [u] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!u) {
    logger.warn({ customerId, userId }, "stale local user id for stripe customer");
    return;
  }

  await db
    .insert(subscriptionsTable)
    .values({
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: resolved.stripeSubscriptionId,
      plan: resolved.plan,
      status: resolved.status,
      currentPeriodEnd: resolved.currentPeriodEnd,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: subscriptionsTable.userId,
      set: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: resolved.stripeSubscriptionId,
        plan: resolved.plan,
        status: resolved.status,
        currentPeriodEnd: resolved.currentPeriodEnd,
        updatedAt: new Date(),
      },
    });
  invalidatePlanCache(userId);

  // When a user drops back to free (cancelled/expired/inactive Conjurer),
  // their existing private stories must become readable again — privacy is
  // a Conjurer-only feature. We flip isPrivate=false on every story they
  // own. Idempotent.
  if (resolved.plan !== "conjurer") {
    await db
      .update(storiesTable)
      .set({ isPrivate: false, updatedAt: new Date() })
      .where(
        and(eq(storiesTable.userId, userId), eq(storiesTable.isPrivate, true)),
      );
  }

  logger.info(
    { userId, plan: resolved.plan, status: resolved.status },
    "applied plan for user",
  );
}

/** Discard SQL-only side effect markers; helps tests stay deterministic. */
export const _internal = { sql };
