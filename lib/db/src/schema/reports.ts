import { pgTable, serial, text, integer, timestamp, index, boolean } from "drizzle-orm/pg-core";

export const reportsTable = pgTable(
  "reports",
  {
    id: serial("id").primaryKey(),
    targetType: text("target_type").notNull(),
    targetId: integer("target_id").notNull(),
    reporterName: text("reporter_name").notNull(),
    reason: text("reason").notNull().default(""),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => ({
    statusIdx: index("reports_status_idx").on(table.status, table.createdAt),
    targetIdx: index("reports_target_idx").on(table.targetType, table.targetId),
  }),
);

export const hiddenStoriesTable = pgTable("hidden_stories", {
  storyId: integer("story_id").primaryKey(),
  reason: text("reason"),
  hiddenAt: timestamp("hidden_at").notNull().defaultNow(),
});

export const hiddenCommentsTable = pgTable("hidden_comments", {
  commentId: integer("comment_id").primaryKey(),
  reason: text("reason"),
  hiddenAt: timestamp("hidden_at").notNull().defaultNow(),
});

export type Report = typeof reportsTable.$inferSelect;
