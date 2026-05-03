import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { storiesTable } from "./stories";
import { seriesTable } from "./series";

// A reusable character profile owned by a single author. Optionally
// scoped to a series so series-level characters can be auto-attached
// when a new chapter is added to that series.
export const charactersTable = pgTable(
  "characters",
  {
    id: serial("id").primaryKey(),
    // Stable Clerk-backed user id (nullable for legacy import paths).
    ownerUserId: integer("owner_user_id"),
    // Pen-name fallback so legacy authors keep ownership while we backfill ids.
    ownerHandle: text("owner_handle").notNull(),
    seriesId: integer("series_id").references(() => seriesTable.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // Public /api/storage/objects/... URL of the reference image, if uploaded.
    referenceImageUrl: text("reference_image_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    ownerIdx: index("characters_owner_idx").on(table.ownerHandle),
    seriesIdx: index("characters_series_idx").on(table.seriesId),
  }),
);

// Many-to-many link between stories and the characters that appear in them.
export const storyCharactersTable = pgTable(
  "story_characters",
  {
    storyId: integer("story_id")
      .notNull()
      .references(() => storiesTable.id, { onDelete: "cascade" }),
    characterId: integer("character_id")
      .notNull()
      .references(() => charactersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.storyId, table.characterId] }),
    storyIdx: index("story_characters_story_idx").on(table.storyId),
    characterIdx: index("story_characters_character_idx").on(table.characterId),
    pairUnique: uniqueIndex("story_characters_pair_unique").on(
      table.storyId,
      table.characterId,
    ),
  }),
);

export type Character = typeof charactersTable.$inferSelect;
export type StoryCharacter = typeof storyCharactersTable.$inferSelect;
