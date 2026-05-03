import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import {
  getUncachableStripeClient,
  getStripePublishableKey,
} from "../lib/stripeClient";
import {
  ensureStripeCustomer,
  CONJURER_METADATA_KEY,
  CONJURER_METADATA_VALUE,
} from "../lib/billing";
import { getUserPlan, getSubscriptionForUser } from "../lib/subscriptions";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Build the allowlist of host[:port] values we'll accept as Stripe redirect
 * targets. The user must NOT be able to influence this — otherwise an
 * authenticated attacker could craft Stripe Checkout/Portal links that
 * redirect back to a phishing site.
 */
function getAllowedAppHosts(): Set<string> {
  const hosts = new Set<string>();
  const fromEnv = process.env.REPLIT_DOMAINS ?? "";
  for (const h of fromEnv.split(",")) {
    const t = h.trim().toLowerCase();
    if (t) hosts.add(t);
  }
  const dev = (process.env.REPLIT_DEV_DOMAIN ?? "").trim().toLowerCase();
  if (dev) hosts.add(dev);
  // Localhost is fine in non-deployment dev for testing.
  if (process.env.REPLIT_DEPLOYMENT !== "1") {
    hosts.add("localhost:8080");
    hosts.add("localhost:5173");
  }
  return hosts;
}

/**
 * Resolve the app origin we'll send Stripe back to. We prefer the request's
 * Origin header / forwarded host when it matches the allowlist; otherwise we
 * fall back to the first configured Replit domain. We never honor a
 * client-supplied body field for this — it would be an open redirect.
 */
function resolveAppOrigin(req: import("express").Request): string {
  const allowed = getAllowedAppHosts();
  const candidates: { host: string; proto: string }[] = [];
  const originHdr = req.get("origin");
  if (originHdr) {
    try {
      const u = new URL(originHdr);
      candidates.push({ host: u.host.toLowerCase(), proto: u.protocol.replace(":", "") });
    } catch {
      /* ignore */
    }
  }
  const fwdHost = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim();
  const fwdProto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
  if (fwdHost) candidates.push({ host: fwdHost.toLowerCase(), proto: fwdProto || "https" });
  const hostHdr = req.headers.host;
  if (typeof hostHdr === "string" && hostHdr) {
    candidates.push({ host: hostHdr.toLowerCase(), proto: req.protocol || "https" });
  }
  for (const c of candidates) {
    if (allowed.has(c.host)) {
      const proto = c.host.startsWith("localhost") ? c.proto || "http" : "https";
      return `${proto}://${c.host}`;
    }
  }
  // Fall back to the first configured Replit domain.
  const fallback = [...allowed].find((h) => !h.startsWith("localhost"));
  return fallback ? `https://${fallback}` : "https://localhost:8080";
}

interface ConjurerPriceRow {
  product_id: string;
  product_name: string;
  price_id: string;
  unit_amount: string | number | null;
  currency: string;
  metadata: Record<string, string> | null;
}

/** Look up the Conjurer monthly price from the synced stripe schema. */
async function findConjurerPrice(): Promise<ConjurerPriceRow | null> {
  try {
    const result = await db.execute(sql`
      SELECT
        p.id        AS product_id,
        p.name      AS product_name,
        pr.id       AS price_id,
        pr.unit_amount,
        pr.currency,
        p.metadata
      FROM stripe.products p
      JOIN stripe.prices pr ON pr.product = p.id
      WHERE p.active = true
        AND pr.active = true
        AND pr.recurring->>'interval' = 'month'
        AND (
          (p.metadata ->> ${CONJURER_METADATA_KEY}) = ${CONJURER_METADATA_VALUE}
          OR p.name = 'Conjurer Monthly'
        )
      ORDER BY pr.created DESC
      LIMIT 1
    `);
    const rows = (result as unknown as { rows: ConjurerPriceRow[] }).rows ?? [];
    return rows[0] ?? null;
  } catch (err) {
    logger.warn({ err }, "stripe.products query failed; not seeded yet?");
    return null;
  }
}

router.get("/billing/config", async (_req, res): Promise<void> => {
  try {
    const [publishableKey, price] = await Promise.all([
      getStripePublishableKey().catch(() => null),
      findConjurerPrice(),
    ]);
    res.json({
      publishableKey,
      conjurer: price
        ? {
            productId: price.product_id,
            priceId: price.price_id,
            unitAmount:
              price.unit_amount == null ? null : Number(price.unit_amount),
            currency: price.currency,
          }
        : null,
    });
  } catch (err) {
    logger.error({ err }, "billing/config failed");
    res.status(500).json({ error: "Stripe not available" });
  }
});

router.get("/billing/me", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const plan = await getUserPlan(user.id);
  const sub = await getSubscriptionForUser(user.id);
  res.json({
    plan,
    status: sub?.status ?? "inactive",
    currentPeriodEnd: sub?.currentPeriodEnd
      ? sub.currentPeriodEnd.toISOString()
      : null,
    hasStripeCustomer: !!sub?.stripeCustomerId,
  });
});

router.post(
  "/billing/checkout",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.user!;
    try {
      const price = await findConjurerPrice();
      if (!price) {
        res
          .status(503)
          .json({ error: "Conjurer plan not yet provisioned. Try again shortly." });
        return;
      }
      const customerId = await ensureStripeCustomer(user);
      const stripe = await getUncachableStripeClient();

      // Refuse a duplicate checkout when the user already has an
      // active/trialing/past_due subscription — without this guard a fast
      // double-click or direct API call could create a second active sub.
      const existingSubs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 5,
      });
      const ACTIVE = new Set(["active", "trialing", "past_due", "unpaid"]);
      if (existingSubs.data.some((s) => ACTIVE.has(s.status))) {
        res.status(409).json({
          error: "You already have an active subscription. Manage it from the customer portal.",
          code: "subscription_active",
        });
        return;
      }

      const safeOrigin = resolveAppOrigin(req);
      const successUrl = `${safeOrigin}/settings?billing=success`;
      const cancelUrl = `${safeOrigin}/pricing?checkout=cancelled`;

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: price.price_id, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: String(user.id),
        allow_promotion_codes: true,
        metadata: { fanfic_user_id: String(user.id), plan: "conjurer" },
        subscription_data: {
          metadata: { fanfic_user_id: String(user.id), plan: "conjurer" },
        },
      });
      res.json({ url: session.url });
    } catch (err) {
      logger.error({ err, userId: user.id }, "billing/checkout failed");
      res.status(500).json({ error: "Failed to start checkout" });
    }
  },
);

router.post(
  "/billing/portal",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.user!;
    try {
      const customerId = await ensureStripeCustomer(user);
      const stripe = await getUncachableStripeClient();
      const safeOrigin = resolveAppOrigin(req);
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${safeOrigin}/settings`,
      });
      res.json({ url: portal.url });
    } catch (err) {
      logger.error({ err, userId: user.id }, "billing/portal failed");
      res.status(500).json({ error: "Failed to open billing portal" });
    }
  },
);

export default router;
