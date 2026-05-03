// Seed the Conjurer Monthly product/price in Stripe if it doesn't already
// exist. Stripe is the source of truth; stripe-replit-sync mirrors it into
// the local stripe.* schema. We don't seed a free plan because there's no
// purchase flow for it.

import { getUncachableStripeClient } from "./stripeClient";
import {
  CONJURER_METADATA_KEY,
  CONJURER_METADATA_VALUE,
  CONJURER_PRODUCT_NAME,
} from "./billing";
import { logger } from "./logger";

const CONJURER_DEFAULT_PRICE_USD_CENTS = Number(
  process.env.CONJURER_PRICE_USD_CENTS ?? 900,
);

export async function seedConjurerProductIfMissing(): Promise<void> {
  // In production we never seed; products are copied by Replit deploy.
  if (process.env.REPLIT_DEPLOYMENT === "1") return;
  try {
    const stripe = await getUncachableStripeClient();
    const search = await stripe.products.search({
      query: `metadata['${CONJURER_METADATA_KEY}']:'${CONJURER_METADATA_VALUE}'`,
      limit: 1,
    });
    let product = search.data[0];
    if (!product) {
      product = await stripe.products.create({
        name: CONJURER_PRODUCT_NAME,
        description:
          "FanFic AI Conjurer subscription — 10x daily quotas, private stories, and premium model access.",
        metadata: { [CONJURER_METADATA_KEY]: CONJURER_METADATA_VALUE },
      });
      logger.info({ productId: product.id }, "seeded Conjurer product");
    }

    const prices = await stripe.prices.list({
      product: product.id,
      active: true,
      limit: 10,
    });
    const monthly = prices.data.find(
      (p) => p.recurring?.interval === "month" && p.currency === "usd",
    );
    if (!monthly) {
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: CONJURER_DEFAULT_PRICE_USD_CENTS,
        currency: "usd",
        recurring: { interval: "month" },
      });
      logger.info({ priceId: price.id }, "seeded Conjurer monthly price");
    }
  } catch (err) {
    logger.warn({ err }, "Conjurer product seeding skipped");
  }
}
