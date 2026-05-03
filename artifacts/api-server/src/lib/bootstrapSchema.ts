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
    logger.info("chapters schema bootstrap OK");
  } catch (err) {
    logger.error({ err }, "Failed to bootstrap chapters schema");
  }
}
