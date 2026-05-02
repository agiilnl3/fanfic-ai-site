import { pgTable, serial, text, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { storiesTable } from "./stories";

export const storyLikesTable = pgTable(
  "story_likes",
  {
    id: serial("id").primaryKey(),
    storyId: integer("story_id")
      .notNull()
      .references(() => storiesTable.id, { onDelete: "cascade" }),
    authorName: text("author_name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    storyAuthorUnique: uniqueIndex("story_likes_story_author_unique").on(
      table.storyId,
      table.authorName,
    ),
  }),
);

export type StoryLike = typeof storyLikesTable.$inferSelect;
