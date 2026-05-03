import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const notificationPrefsTable = pgTable("notification_prefs", {
  authorName: text("author_name").primaryKey(),
  comment: boolean("comment").notNull().default(true),
  follow: boolean("follow").notNull().default(true),
  like: boolean("like").notNull().default(true),
  repost: boolean("repost").notNull().default(true),
  coAuthorChapter: boolean("co_author_chapter").notNull().default(true),
  collabInvite: boolean("collab_invite").notNull().default(true),
  collabAccept: boolean("collab_accept").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type NotificationPrefs = typeof notificationPrefsTable.$inferSelect;
