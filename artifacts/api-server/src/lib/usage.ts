import { and, eq, sql } from "drizzle-orm";
import { db, dailyUsageTable, tariffsTable } from "@workspace/db";

const FALLBACK_STORY_LIMIT = Number(process.env.FREE_DAILY_STORY_LIMIT ?? 5);
const FALLBACK_ILLUSTRATION_LIMIT = Number(
  process.env.FREE_DAILY_ILLUSTRATION_LIMIT ?? 20,
);

let cached: { tier: string; storyDailyLimit: number; illustrationDailyLimit: number } | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30_000;

export async function getFreeTariff() {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;
  const [row] = await db
    .select()
    .from(tariffsTable)
    .where(eq(tariffsTable.tier, "free"))
    .limit(1);
  if (row) {
    cached = {
      tier: row.tier,
      storyDailyLimit: row.storyDailyLimit,
      illustrationDailyLimit: row.illustrationDailyLimit,
    };
  } else {
    // Seed defaults on first call. Both tiers are seeded so the admin UI
    // never 404s on the premium card.
    await db
      .insert(tariffsTable)
      .values([
        {
          tier: "free",
          storyDailyLimit: FALLBACK_STORY_LIMIT,
          illustrationDailyLimit: FALLBACK_ILLUSTRATION_LIMIT,
        },
        {
          tier: "premium",
          storyDailyLimit: FALLBACK_STORY_LIMIT * 10,
          illustrationDailyLimit: FALLBACK_ILLUSTRATION_LIMIT * 10,
        },
      ])
      .onConflictDoNothing();
    cached = {
      tier: "free",
      storyDailyLimit: FALLBACK_STORY_LIMIT,
      illustrationDailyLimit: FALLBACK_ILLUSTRATION_LIMIT,
    };
  }
  cachedAt = now;
  return cached;
}

export function invalidateTariffCache() {
  cached = null;
  cachedAt = 0;
}

function today(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function getUsage(authorName: string) {
  const day = today();
  const tariff = await getFreeTariff();
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
    storyLimit: tariff.storyDailyLimit,
    illustrationLimit: tariff.illustrationDailyLimit,
    storiesRemaining: Math.max(0, tariff.storyDailyLimit - (row?.storyCount ?? 0)),
    illustrationsRemaining: Math.max(
      0,
      tariff.illustrationDailyLimit - (row?.illustrationCount ?? 0),
    ),
  };
}

async function bump(authorName: string, column: "story_count" | "illustration_count") {
  const day = today();
  const colExpr =
    column === "story_count"
      ? sql`${dailyUsageTable.storyCount} + 1`
      : sql`${dailyUsageTable.illustrationCount} + 1`;
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
