import { initSentry } from "./lib/sentry";
void initSentry();

import app from "./app";
import { logger } from "./lib/logger";
import { bootstrapBranchingSchema } from "./lib/bootstrapSchema";
import { startEmbeddingBackfill } from "./lib/embeddings";
import { getStripeSync } from "./lib/stripeClient";
import { seedConjurerProductIfMissing } from "./lib/seedStripeProducts";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function initStripe(): Promise<void> {
  try {
    // Bootstrap the stripe.* schema (products, customers, webhooks, etc.)
    // before anything tries to query it. Idempotent — pg-node-migrations
    // tracks applied versions in its own table.
    if (process.env.DATABASE_URL) {
      try {
        const { runMigrations } = (await import(
          "stripe-replit-sync"
        )) as unknown as {
          runMigrations: (cfg: {
            databaseUrl: string;
            ssl?: boolean;
          }) => Promise<void>;
        };
        await runMigrations({ databaseUrl: process.env.DATABASE_URL });
      } catch (err) {
        logger.warn({ err }, "stripe-replit-sync migrations failed");
      }
    }
    const sync = await getStripeSync();
    // Register a managed webhook pointing at this deployment so Stripe
    // events are delivered without manual dashboard wiring.
    const domain = (process.env.REPLIT_DOMAINS ?? "").split(",")[0];
    if (domain) {
      try {
        await sync.findOrCreateManagedWebhook(
          `https://${domain}/api/stripe/webhook`,
        );
      } catch (err) {
        logger.warn({ err }, "managed webhook registration skipped");
      }
    }
    // Make sure the Conjurer product exists in Stripe (dev only) BEFORE we
    // sync, otherwise the freshly bootstrapped stripe.* schema would stay
    // empty and /billing/config returns null.
    await seedConjurerProductIfMissing();
    // Pull products + prices into the local mirror so the checkout route
    // can find the Conjurer price by SQL. Customers/subscriptions follow
    // in the background and are also kept in sync via webhooks.
    try {
      await sync.syncProducts();
      await sync.syncPrices();
    } catch (err) {
      logger.warn({ err }, "stripe products/prices sync failed");
    }
    sync
      .syncCustomers()
      .then(() => sync.syncSubscriptions())
      .catch((err: unknown) => {
        logger.warn({ err }, "stripe customers/subscriptions sync failed");
      });
  } catch (err) {
    logger.warn({ err }, "Stripe init skipped (connector not available?)");
  }
}

// Run branching-storylines DDL safety net before accepting traffic so
// /chapter-tree never 500s on a missing relation in a freshly
// provisioned DB. Idempotent.
void bootstrapBranchingSchema().finally(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
    // Lazily backfill embeddings for any published stories that don't
    // have one yet. Runs once per boot, capped, in the background.
    startEmbeddingBackfill();
    // Stripe init is async and best-effort.
    void initStripe();
  });
});
