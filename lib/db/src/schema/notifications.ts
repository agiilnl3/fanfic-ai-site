import { pgTable, serial, text, timestamp, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";

export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    recipientName: text("recipient_name").notNull(),
    type: text("type").notNull(), // "comment" | "co_author_chapter" | "follow" | "like"
    storyId: integer("story_id"),
    actorName: text("actor_name").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    recipientIdx: index("notifications_recipient_idx").on(table.recipientName, table.createdAt),
  }),
);

export type Notification = typeof notificationsTable.$inferSelect;
