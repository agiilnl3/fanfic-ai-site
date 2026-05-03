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
      // reading_progress.paragraph_index was added after launch; older
      // databases need it backfilled at boot. Defaults to 0 so existing
      // rows resume at the top of the story.
      await client.query(
        `ALTER TABLE IF EXISTS reading_progress ADD COLUMN IF NOT EXISTS paragraph_index integer NOT NULL DEFAULT 0`,
      );

      // Inline paragraph-anchored comments. drizzle push manages the
      // column itself, but we add IF NOT EXISTS here so a fresh boot
      // before push has run does not crash subsequent inserts.
      await client.query(
        `ALTER TABLE IF EXISTS story_comments ADD COLUMN IF NOT EXISTS paragraph_index integer`,
      );

      // Real full-text search on stories. Generated tsvector + GIN
      // index replaces the previous ILIKE '%q%' scan. Title is weighted
      // 'A' (highest), summary 'B', seed_prompt 'C' so /stories/feed
      // ts_rank_cd surfaces title matches first.
      await client.query(`
        ALTER TABLE IF EXISTS stories
          ADD COLUMN IF NOT EXISTS tsv tsvector
          GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(title, '')),       'A') ||
            setweight(to_tsvector('english', coalesce(summary, '')),     'B') ||
            setweight(to_tsvector('english', coalesce(seed_prompt, '')), 'C')
          ) STORED
      `);
      await client.query(
        `CREATE INDEX IF NOT EXISTS stories_tsv_idx ON stories USING gin (tsv)`,
      );

      // pgvector for personalized recommendations. Drizzle does not
      // model the `vector` type, so the table is created here in raw
      // SQL. text-embedding-3-small returns 1536-dim vectors.
      await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS story_embeddings (
          story_id integer PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE,
          embedding vector(1536) NOT NULL,
          updated_at timestamp NOT NULL DEFAULT now()
        )
      `);
      // ivfflat needs ANALYZE before it's useful and is overkill for
      // small tables, so we skip the index until catalog grows. Cosine
      // distance is computed via the `<=>` operator.
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
