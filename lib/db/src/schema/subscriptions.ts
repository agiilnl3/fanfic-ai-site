import { pgTable, serial, text, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";

export const subscriptionsTable = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id"),
    plan: text("plan").notNull().default("free"),
    status: text("status").notNull().default("inactive"),
    currentPeriodEnd: timestamp("current_period_end"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdUnique: uniqueIndex("subscriptions_user_id_unique").on(table.userId),
    customerIdx: uniqueIndex("subscriptions_customer_id_unique").on(table.stripeCustomerId),
  }),
);

export type Subscription = typeof subscriptionsTable.$inferSelect;
