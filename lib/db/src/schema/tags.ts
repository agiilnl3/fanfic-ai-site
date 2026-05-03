import { pgTable, serial, text, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { storiesTable } from "./stories";

export const tagsTable = pgTable(
  "tags",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    slugUnique: uniqueIndex("tags_slug_unique").on(table.slug),
  }),
);

export const storyTagsTable = pgTable(
  "story_tags",
  {
    storyId: integer("story_id")
      .notNull()
      .references(() => storiesTable.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tagsTable.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pairUnique: uniqueIndex("story_tags_pair_unique").on(table.storyId, table.tagId),
    tagIdx: index("story_tags_tag_idx").on(table.tagId),
  }),
);

export type Tag = typeof tagsTable.$inferSelect;
export type StoryTag = typeof storyTagsTable.$inferSelect;
