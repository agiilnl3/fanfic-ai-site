import { and, eq, sql } from "drizzle-orm";
import { db, dailyUsageTable } from "@workspace/db";

export const FREE_DAILY_STORY_LIMIT = Number(process.env.FREE_DAILY_STORY_LIMIT ?? 5);
export const FREE_DAILY_ILLUSTRATION_LIMIT = Number(
  process.env.FREE_DAILY_ILLUSTRATION_LIMIT ?? 20,
);

function today(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function getUsage(authorName: string) {
  const day = today();
  const [row] = await db
    .select()
    .from(dailyUsageTable)
    .where(
      and(
        eq(dailyUsageTable.authorName, authorName),
        eq(dailyUsageTable.day, day),
      ),
    )
    .limit(1);
  return {
    authorName,
    day,
    storyCount: row?.storyCount ?? 0,
    illustrationCount: row?.illustrationCount ?? 0,
    storyLimit: FREE_DAILY_STORY_LIMIT,
    illustrationLimit: FREE_DAILY_ILLUSTRATION_LIMIT,
    storiesRemaining: Math.max(0, FREE_DAILY_STORY_LIMIT - (row?.storyCount ?? 0)),
    illustrationsRemaining: Math.max(
      0,
      FREE_DAILY_ILLUSTRATION_LIMIT - (row?.illustrationCount ?? 0),
    ),
  };
}

async function bump(authorName: string, column: "story_count" | "illustration_count") {
  const day = today();
  const colExpr =
    column === "story_count" ? sql`story_count + 1` : sql`illustration_count + 1`;
  await db
    .insert(dailyUsageTable)
    .values({
      authorName,
      day,
      storyCount: column === "story_count" ? 1 : 0,
      illustrationCount: column === "illustration_count" ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: [dailyUsageTable.authorName, dailyUsageTable.day],
      set: column === "story_count"
        ? { storyCount: colExpr }
        : { illustrationCount: colExpr },
    });
}

export async function checkAndBumpStory(authorName: string): Promise<{ ok: true } | { ok: false; remaining: number; limit: number }> {
  const usage = await getUsage(authorName);
  if (usage.storiesRemaining <= 0) {
    return { ok: false, remaining: 0, limit: usage.storyLimit };
  }
  await bump(authorName, "story_count");
  return { ok: true };
}

export async function checkAndBumpIllustration(authorName: string): Promise<{ ok: true } | { ok: false; remaining: number; limit: number }> {
  const usage = await getUsage(authorName);
  if (usage.illustrationsRemaining <= 0) {
    return { ok: false, remaining: 0, limit: usage.illustrationLimit };
  }
  await bump(authorName, "illustration_count");
  return { ok: true };
}
