// Stripe client + StripeSync wiring for the Replit Stripe connector.
// Credentials are fetched fresh per call from the connectors API; never
// cache the Stripe client itself because tokens expire.

import Stripe from "stripe";

interface ConnectionSettings {
  publishable: string;
  secret: string;
}

let cachedSettings: ConnectionSettings | null = null;
let cachedAt = 0;
const SETTINGS_TTL_MS = 60_000;

async function getCredentials(): Promise<ConnectionSettings> {
  if (cachedSettings && Date.now() - cachedAt < SETTINGS_TTL_MS) {
    return cachedSettings;
  }
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;
  if (!hostname || !xReplitToken) {
    throw new Error("Replit connectors hostname/token not available");
  }
  const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
  const targetEnvironment = isProduction ? "production" : "development";
  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", "stripe");
  url.searchParams.set("environment", targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
  });
  const data = (await response.json()) as {
    items?: Array<{ settings: ConnectionSettings }>;
  };
  const item = data.items?.[0];
  if (!item || !item.settings.publishable || !item.settings.secret) {
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }
  cachedSettings = item.settings;
  cachedAt = Date.now();
  return cachedSettings;
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secret } = await getCredentials();
  // Don't change to an older API version.
  // Pin the API version explicitly. Cast via `as never` because the bundled
  // Stripe types only know about the very latest version string but the
  // server account is still on 2025-08-27.basil.
  return new Stripe(secret, { apiVersion: "2025-08-27.basil" as never });
}

export async function getStripePublishableKey(): Promise<string> {
  const { publishable } = await getCredentials();
  return publishable;
}

export async function getStripeSecretKey(): Promise<string> {
  const { secret } = await getCredentials();
  return secret;
}

// StripeSync singleton for webhook processing and data sync.
// stripe-replit-sync owns the `stripe.*` schema in our PostgreSQL db.
type StripeSyncInstance = {
  processWebhook(payload: Buffer, signature: string): Promise<void>;
  findOrCreateManagedWebhook(url: string): Promise<{ webhook: unknown }>;
  syncBackfill(): Promise<void>;
  syncProducts(params?: unknown): Promise<{ synced: number }>;
  syncPrices(params?: unknown): Promise<{ synced: number }>;
  syncCustomers(params?: unknown): Promise<{ synced: number }>;
  syncSubscriptions(params?: unknown): Promise<{ synced: number }>;
};

let stripeSync: StripeSyncInstance | null = null;

export async function getStripeSync(): Promise<StripeSyncInstance> {
  if (stripeSync) return stripeSync;
  const mod = (await import("stripe-replit-sync")) as unknown as {
    StripeSync: new (opts: {
      poolConfig: { connectionString: string; max: number };
      stripeSecretKey: string;
    }) => StripeSyncInstance;
  };
  const secretKey = await getStripeSecretKey();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL required for StripeSync");
  }
  stripeSync = new mod.StripeSync({
    poolConfig: { connectionString: process.env.DATABASE_URL, max: 2 },
    stripeSecretKey: secretKey,
  });
  return stripeSync;
}
