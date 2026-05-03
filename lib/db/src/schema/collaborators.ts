import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Per-story collaborator invitations. A row is created when the primary
 * author invites a registered user (by handle); the invitee then accepts,
 * declines, or the owner revokes. Accepted writers may add new chapters
 * via /continue and edit chapters they themselves wrote.
 *
 * The legacy `stories.co_authors` text[] is kept in sync with accepted
 * collaborator handles so existing canEditStory checks keep working.
 */
export const storyCollaboratorsTable = pgTable(
  "story_collaborators",
  {
    id: serial("id").primaryKey(),
    storyId: integer("story_id").notNull(),
    userId: integer("user_id").notNull(),
    role: text("role").notNull().default("writer"), // 'writer' | 'editor'
    status: text("status").notNull().default("pending"), // 'pending' | 'accepted' | 'declined' | 'revoked'
    invitedByUserId: integer("invited_by_user_id"),
    invitedAt: timestamp("invited_at").notNull().defaultNow(),
    respondedAt: timestamp("responded_at"),
  },
  (table) => ({
    storyUserUnique: uniqueIndex("story_collaborators_story_user_unique").on(
      table.storyId,
      table.userId,
    ),
    userStatusIdx: index("story_collaborators_user_status_idx").on(
      table.userId,
      table.status,
    ),
  }),
);

export type StoryCollaborator = typeof storyCollaboratorsTable.$inferSelect;

/**
 * Records the author of each appended chapter (zero-indexed).
 * The first chapter of a story (index 0) is implicitly the primary author
 * and is not stored here unless explicitly written by someone else.
 */
export const chapterAuthorsTable = pgTable(
  "chapter_authors",
  {
    id: serial("id").primaryKey(),
    storyId: integer("story_id").notNull(),
    chapterIndex: integer("chapter_index").notNull(),
    userId: integer("user_id").notNull(),
    authorHandle: text("author_handle").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    storyChapterUnique: uniqueIndex("chapter_authors_story_chapter_unique").on(
      table.storyId,
      table.chapterIndex,
    ),
    storyIdx: index("chapter_authors_story_idx").on(table.storyId),
  }),
);

export type ChapterAuthor = typeof chapterAuthorsTable.$inferSelect;
