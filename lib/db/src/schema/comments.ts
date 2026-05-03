import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { storiesTable } from "./stories";

export const storyCommentsTable = pgTable(
  "story_comments",
  {
    id: serial("id").primaryKey(),
    storyId: integer("story_id")
      .notNull()
      .references(() => storiesTable.id, { onDelete: "cascade" }),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    parentId: integer("parent_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    storyIdx: index("story_comments_story_idx").on(table.storyId),
    parentIdx: index("story_comments_parent_idx").on(table.parentId),
  }),
);

export type StoryComment = typeof storyCommentsTable.$inferSelect;
