import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const adminsTable = pgTable("admins", {
  userId: integer("user_id")
    .notNull()
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  note: text("note"),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export type Admin = typeof adminsTable.$inferSelect;
export type InsertAdmin = typeof adminsTable.$inferInsert;
