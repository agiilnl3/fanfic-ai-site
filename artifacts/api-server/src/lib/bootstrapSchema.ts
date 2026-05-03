import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

/**
 * Defensive boot-time DDL safety net for the branching-storylines feature
 * (Task #14). The project's normal schema rollout path is
 * `pnpm --filter db push` in scripts/post-merge.sh, which Drizzle Kit
 * runs against the deploy database after a task merges. This function
 * exists so that:
 *
 *   1. A first-boot of the API server in any environment whose database
 *      hasn't received `db push` yet (e.g. a freshly provisioned DB,
 *      a local dev container, a hotfix path that bypassed the merge
 *      script) can still serve /chapter-tree, /branch and reading
 *      progress without 500s on a missing relation.
 *   2. The lazy chapter backfill in lib/chapters.ts can rely on the
 *      table existing before its first SELECT.
 *
 * It runs once at process start and is fully idempotent. We intentionally
 * keep this *narrow* — only the new objects from Task #14 — because
 * Drizzle remains the source of truth for the rest of the schema.
 */
export async function bootstrapBranchingSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS chapters (
        id SERIAL PRIMARY KEY,
        story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        parent_chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        branch_label TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        is_canonical BOOLEAN NOT NULL DEFAULT false,
        author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        author_handle TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS chapters_story_id_idx ON chapters(story_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS chapters_parent_idx ON chapters(parent_chapter_id)
    `);
    await db.execute(sql`
      ALTER TABLE reading_progress
      ADD COLUMN IF NOT EXISTS chapter_id INTEGER
        REFERENCES chapters(id) ON DELETE SET NULL
    `);
    logger.info("Branching-storylines schema bootstrap OK");
  } catch (err) {
    logger.error({ err }, "Failed to bootstrap branching-storylines schema");
    // Don't crash the server — the rest of the API still works.
  }
}
