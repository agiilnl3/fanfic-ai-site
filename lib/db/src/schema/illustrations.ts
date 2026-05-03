import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { storiesTable } from "./stories";

export const illustrationsTable = pgTable("illustrations", {
  id: serial("id").primaryKey(),
  storyId: integer("story_id")
    .notNull()
    .references(() => storiesTable.id, { onDelete: "cascade" }),
  sectionIndex: integer("section_index").notNull(),
  prompt: text("prompt").notNull(),
  imageUrl: text("image_url").notNull(),
  caption: text("caption"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertIllustrationSchema = createInsertSchema(
  illustrationsTable,
).omit({
  id: true,
  createdAt: true,
});
export type InsertIllustration = z.infer<typeof insertIllustrationSchema>;
export type Illustration = typeof illustrationsTable.$inferSelect;
