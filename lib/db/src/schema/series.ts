import { pgTable, serial, text, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { storiesTable } from "./stories";

export const seriesTable = pgTable(
  "series",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    summary: text("summary"),
    authorName: text("author_name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    authorIdx: index("series_author_idx").on(table.authorName),
  }),
);

export const seriesStoriesTable = pgTable(
  "series_stories",
  {
    seriesId: integer("series_id")
      .notNull()
      .references(() => seriesTable.id, { onDelete: "cascade" }),
    storyId: integer("story_id")
      .notNull()
      .references(() => storiesTable.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (table) => ({
    storyUnique: uniqueIndex("series_stories_story_unique").on(table.storyId),
    seriesIdx: index("series_stories_series_idx").on(table.seriesId),
  }),
);

export type Series = typeof seriesTable.$inferSelect;
export type SeriesStory = typeof seriesStoriesTable.$inferSelect;
