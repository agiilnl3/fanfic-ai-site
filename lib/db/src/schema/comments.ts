import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { storiesTable } from "./stories";

export const storyCommentsTable = pgTable(
  "story_comments",
  {
    id: serial("id").primaryKey(),
    storyId: integer("story_id")
      .notNull()
      .references(() => storiesTable.id, { onDelete: "cascade" }),
    userId: integer("user_id"),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    parentId: integer("parent_id"),
    // Anchors a comment to a specific paragraph (matches `data-paragraph-index`
    // on the rendered story). NULL means the comment is on the whole story.
    paragraphIndex: integer("paragraph_index"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    storyIdx: index("story_comments_story_idx").on(table.storyId),
    parentIdx: index("story_comments_parent_idx").on(table.parentId),
    paraIdx: index("story_comments_para_idx").on(
      table.storyId,
      table.paragraphIndex,
    ),
  }),
);

export type StoryComment = typeof storyCommentsTable.$inferSelect;
