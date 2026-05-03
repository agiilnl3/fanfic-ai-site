import { pgTable, serial, text, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { storiesTable } from "./stories";

export const bookmarksTable = pgTable(
  "bookmarks",
  {
    id: serial("id").primaryKey(),
    authorName: text("author_name").notNull(),
    storyId: integer("story_id")
      .notNull()
      .references(() => storiesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    pairUnique: uniqueIndex("bookmarks_pair_unique").on(
      table.authorName,
      table.storyId,
    ),
    authorIdx: index("bookmarks_author_idx").on(table.authorName),
  }),
);

export const readingProgressTable = pgTable(
  "reading_progress",
  {
    id: serial("id").primaryKey(),
    authorName: text("author_name").notNull(),
    storyId: integer("story_id")
      .notNull()
      .references(() => storiesTable.id, { onDelete: "cascade" }),
    progress: integer("progress").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    pairUnique: uniqueIndex("reading_progress_pair_unique").on(
      table.authorName,
      table.storyId,
    ),
    authorIdx: index("reading_progress_author_idx").on(table.authorName),
  }),
);

export type Bookmark = typeof bookmarksTable.$inferSelect;
export type ReadingProgress = typeof readingProgressTable.$inferSelect;
