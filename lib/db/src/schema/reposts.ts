import { pgTable, serial, text, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const storyRepostsTable = pgTable(
  "story_reposts",
  {
    id: serial("id").primaryKey(),
    storyId: integer("story_id").notNull(),
    userId: integer("user_id"),
    reposterName: text("reposter_name").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    pairUnique: uniqueIndex("story_reposts_pair_unique").on(
      table.storyId,
      table.reposterName,
    ),
    reposterIdx: index("story_reposts_reposter_idx").on(table.reposterName),
    storyIdx: index("story_reposts_story_idx").on(table.storyId),
  }),
);

export type StoryRepost = typeof storyRepostsTable.$inferSelect;
