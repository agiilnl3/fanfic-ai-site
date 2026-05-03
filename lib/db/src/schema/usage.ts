import { pgTable, serial, text, integer, date, uniqueIndex } from "drizzle-orm/pg-core";

export const dailyUsageTable = pgTable(
  "daily_usage",
  {
    id: serial("id").primaryKey(),
    authorName: text("author_name").notNull(),
    day: date("day").notNull(),
    storyCount: integer("story_count").notNull().default(0),
    illustrationCount: integer("illustration_count").notNull().default(0),
  },
  (table) => ({
    pairUnique: uniqueIndex("daily_usage_pair_unique").on(
      table.authorName,
      table.day,
    ),
  }),
);

export type DailyUsage = typeof dailyUsageTable.$inferSelect;
