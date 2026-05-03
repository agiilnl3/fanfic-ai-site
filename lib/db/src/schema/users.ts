import { pgTable, serial, text, timestamp, uniqueIndex, boolean, index } from "drizzle-orm/pg-core";

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    isAdmin: boolean("is_admin").notNull().default(false),
    banned: boolean("banned").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    clerkUserIdUnique: uniqueIndex("users_clerk_user_id_unique").on(table.clerkUserId),
    handleUnique: uniqueIndex("users_handle_unique").on(table.handle),
    handleIdx: index("users_handle_idx").on(table.handle),
  }),
);

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
