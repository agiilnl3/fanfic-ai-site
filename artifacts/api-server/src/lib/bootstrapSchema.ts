import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

// Idempotent safety net so a fresh DB can serve /chapter-tree before
// `pnpm --filter db push` has run. Drizzle remains the source of truth.
export async function bootstrapBranchingSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS chapters (
        id SERIAL PRIMARY KEY,
        story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        parent_chapter_id INTEGER,
        title TEXT NOT NULL DEFAULT '',
        branch_label TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        is_canonical BOOLEAN NOT NULL DEFAULT true,
        author_user_id INTEGER,
        author_handle TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      ALTER TABLE chapters
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    `);
    await db.execute(sql`
      ALTER TABLE chapters
      ADD COLUMN IF NOT EXISTS branch_label TEXT NOT NULL DEFAULT ''
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS chapters_story_idx ON chapters(story_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS chapters_parent_idx ON chapters(parent_chapter_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS chapters_story_parent_pos_idx
        ON chapters(story_id, parent_chapter_id, position)
    `);
    await db.execute(sql`
      ALTER TABLE reading_progress
      ADD COLUMN IF NOT EXISTS chapter_id INTEGER
        REFERENCES chapters(id) ON DELETE SET NULL
    `);
    // Sharing-pack columns (poster cover + trailer). Idempotent so
    // fresh DBs and existing deployments both end up in the same shape.
    await db.execute(sql`
      ALTER TABLE stories
      ADD COLUMN IF NOT EXISTS poster_cover_url TEXT
    `);
    await db.execute(sql`
      ALTER TABLE stories
      ADD COLUMN IF NOT EXISTS trailer_url TEXT
    `);
    await db.execute(sql`
      ALTER TABLE stories
      ADD COLUMN IF NOT EXISTS trailer_status TEXT
    `);
    await db.execute(sql`
      ALTER TABLE stories
      ADD COLUMN IF NOT EXISTS trailer_hash TEXT
    `);
    // Stripe paid tiers ("Conjurer" subscription) — Task #17.
    // Private stories are a Conjurer perk; column is non-nullable so the
    // story authz fast path can rely on it without coalescing.
    await db.execute(sql`
      ALTER TABLE stories
      ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        stripe_customer_id TEXT NOT NULL,
        stripe_subscription_id TEXT,
        plan TEXT NOT NULL DEFAULT 'free',
        status TEXT NOT NULL DEFAULT 'inactive',
        current_period_end TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_unique
        ON subscriptions(user_id)
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_customer_id_unique
        ON subscriptions(stripe_customer_id)
    `);
    logger.info("chapters schema bootstrap OK");
  } catch (err) {
    logger.error({ err }, "Failed to bootstrap chapters schema");
  }
}
