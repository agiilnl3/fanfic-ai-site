import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const tariffsTable = pgTable("tariffs", {
  tier: text("tier").primaryKey(),
  storyDailyLimit: integer("story_daily_limit").notNull().default(5),
  illustrationDailyLimit: integer("illustration_daily_limit").notNull().default(20),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Tariff = typeof tariffsTable.$inferSelect;
