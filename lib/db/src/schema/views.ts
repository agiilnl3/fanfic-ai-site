import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { storiesTable } from "./stories";

export const storyViewsTable = pgTable(
  "story_views",
  {
    id: serial("id").primaryKey(),
    storyId: integer("story_id")
      .notNull()
      .references(() => storiesTable.id, { onDelete: "cascade" }),
    viewerName: text("viewer_name"),
    completed: integer("completed").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    storyIdx: index("story_views_story_idx").on(table.storyId, table.createdAt),
  }),
);

export type StoryView = typeof storyViewsTable.$inferSelect;
