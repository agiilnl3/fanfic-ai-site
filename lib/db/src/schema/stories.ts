import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const storiesTable = pgTable("stories", {
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
  authorName: text("author_name").notNull(),
  coAuthors: text("co_authors")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  coverImageUrl: text("cover_image_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertStorySchema = createInsertSchema(storiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertStory = z.infer<typeof insertStorySchema>;
export type Story = typeof storiesTable.$inferSelect;
