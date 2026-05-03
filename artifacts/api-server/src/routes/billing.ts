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
      const origin = (req.body as { origin?: string } | undefined)?.origin?.trim();
      const safeOrigin =
        origin && /^https?:\/\//.test(origin)
          ? origin.replace(/\/$/, "")
          : `https://${(process.env.REPLIT_DOMAINS ?? "").split(",")[0] ?? ""}`;
      const successUrl = `${safeOrigin}/settings?billing=success`;
      const cancelUrl = `${safeOrigin}/pricing?billing=cancelled`;

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
      const origin = (req.body as { origin?: string } | undefined)?.origin?.trim();
      const safeOrigin =
        origin && /^https?:\/\//.test(origin)
          ? origin.replace(/\/$/, "")
          : `https://${(process.env.REPLIT_DOMAINS ?? "").split(",")[0] ?? ""}`;
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
