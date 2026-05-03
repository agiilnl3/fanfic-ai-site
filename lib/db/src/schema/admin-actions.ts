import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";

export const adminActionsTable = pgTable(
  "admin_actions",
  {
    id: serial("id").primaryKey(),
    actorUserId: integer("actor_user_id"),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: integer("target_id"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    createdAtIdx: index("admin_actions_created_at_idx").on(table.createdAt),
    targetIdx: index("admin_actions_target_idx").on(table.targetType, table.targetId),
  }),
);

export type AdminAction = typeof adminActionsTable.$inferSelect;
export type InsertAdminAction = typeof adminActionsTable.$inferInsert;
