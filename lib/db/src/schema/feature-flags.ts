import { pgTable, serial, text, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const featureFlagsTable = pgTable(
  "feature_flags",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    rolloutPercent: integer("rollout_percent").notNull().default(0),
    description: text("description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    nameUnique: uniqueIndex("feature_flags_name_unique").on(table.name),
  }),
);

export const featureFlagOverridesTable = pgTable(
  "feature_flag_overrides",
  {
    id: serial("id").primaryKey(),
    flagName: text("flag_name").notNull(),
    userId: integer("user_id").notNull(),
    enabled: boolean("enabled").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    flagUserUnique: uniqueIndex("feature_flag_overrides_flag_user_unique").on(
      table.flagName,
      table.userId,
    ),
  }),
);

export type FeatureFlag = typeof featureFlagsTable.$inferSelect;
export type FeatureFlagOverride = typeof featureFlagOverridesTable.$inferSelect;
