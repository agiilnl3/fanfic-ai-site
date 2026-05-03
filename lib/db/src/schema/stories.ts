import { pgTable, serial, text, timestamp, index, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const storiesTable = pgTable(
  "stories",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    genre: text("genre").notNull(),
    artStyle: text("art_style").notNull(),
    lengthSetting: text("length_setting").notNull().default("medium"),
    seedPrompt: text("seed_prompt"),
    fullText: text("full_text"),
    summary: text("summary"),
    characters: text("characters"),
    status: text("status").notNull().default("draft"),
    // Clerk-backed owner. Nullable for legacy rows created pre-Clerk.
    userId: integer("user_id"),
    authorName: text("author_name").notNull(),
    coAuthors: text("co_authors")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    coverImageUrl: text("cover_image_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    // pg_trgm GIN indexes back the feed search ILIKE '%q%' so it does not
    // full-table-scan. The pg_trgm extension is enabled out of band; these
    // indexes are also created out of band and tracked here for visibility:
    //   CREATE INDEX stories_title_trgm   ON stories USING gin (title gin_trgm_ops);
    //   CREATE INDEX stories_summary_trgm ON stories USING gin (summary gin_trgm_ops);
    //   CREATE INDEX stories_seed_trgm    ON stories USING gin (seed_prompt gin_trgm_ops);
    titleIdx: index("stories_title_idx").on(table.title),
    statusCreatedIdx: index("stories_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
  }),
);

export const insertStorySchema = createInsertSchema(storiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertStory = z.infer<typeof insertStorySchema>;
export type Story = typeof storiesTable.$inferSelect;
