import { pgTable, serial, text, timestamp, uniqueIndex, index, integer } from "drizzle-orm/pg-core";

export const authorFollowsTable = pgTable(
  "author_follows",
  {
    id: serial("id").primaryKey(),
    followerUserId: integer("follower_user_id"),
    followerName: text("follower_name").notNull(),
    authorName: text("author_name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    pairUnique: uniqueIndex("author_follows_pair_unique").on(
      table.followerName,
      table.authorName,
    ),
    authorIdx: index("author_follows_author_idx").on(table.authorName),
    followerIdx: index("author_follows_follower_idx").on(table.followerName),
  }),
);

export type AuthorFollow = typeof authorFollowsTable.$inferSelect;
