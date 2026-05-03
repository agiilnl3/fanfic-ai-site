import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

// Idempotent runtime setup: ensure the pg_trgm extension and the GIN trigram
// indexes used by /stories/feed search exist. drizzle-kit push does not
// manage extensions or non-btree index opclasses, so we create them here on
// the first connection. All statements use IF NOT EXISTS so this is safe to
// run on every boot and on every environment (dev, prod, fresh DBs).
let setupPromise: Promise<void> | null = null;
export function ensureDbExtensions(): Promise<void> {
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
    const client = await pool.connect();
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
      await client.query(
        `CREATE INDEX IF NOT EXISTS stories_title_trgm ON stories USING gin (title gin_trgm_ops)`,
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS stories_summary_trgm ON stories USING gin (summary gin_trgm_ops)`,
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS stories_seed_trgm ON stories USING gin (seed_prompt gin_trgm_ops)`,
      );
    } finally {
      client.release();
    }
  })().catch((err) => {
    setupPromise = null;
    throw err;
  });
  return setupPromise;
}

// Kick off setup on import; failures are logged but do not crash the process,
// since the indexes are an optimization (the queries still work without them).
void ensureDbExtensions().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[db] ensureDbExtensions failed:", err);
});

export * from "./schema";
