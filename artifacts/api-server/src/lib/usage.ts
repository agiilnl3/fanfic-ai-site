import { and, eq, sql } from "drizzle-orm";
import { db, dailyUsageTable, tariffsTable } from "@workspace/db";
import { getPlanByHandle, type Plan } from "./subscriptions";

const FALLBACK_STORY_LIMIT = Number(process.env.FREE_DAILY_STORY_LIMIT ?? 5);
const FALLBACK_ILLUSTRATION_LIMIT = Number(
  process.env.FREE_DAILY_ILLUSTRATION_LIMIT ?? 20,
);

interface CachedTariff {
  tier: string;
  storyDailyLimit: number;
  illustrationDailyLimit: number;
}

const tariffCache = new Map<string, { row: CachedTariff; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

// Conjurer is the paid tier shipped by Task #17. We seed both the legacy
// "premium" name (used by the admin UI to set custom quotas) and the
// canonical "conjurer" plan so admins keep their existing controls and the
// billing webhook lands on a real row.
const TIER_DEFAULTS: Record<string, CachedTariff> = {
  free: {
    tier: "free",
    storyDailyLimit: FALLBACK_STORY_LIMIT,
    illustrationDailyLimit: FALLBACK_ILLUSTRATION_LIMIT,
  },
  premium: {
    tier: "premium",
    storyDailyLimit: FALLBACK_STORY_LIMIT * 10,
    illustrationDailyLimit: FALLBACK_ILLUSTRATION_LIMIT * 10,
  },
  conjurer: {
    tier: "conjurer",
    storyDailyLimit: FALLBACK_STORY_LIMIT * 10,
    illustrationDailyLimit: FALLBACK_ILLUSTRATION_LIMIT * 10,
  },
};

function defaultTariff(tier: string): CachedTariff {
  return TIER_DEFAULTS[tier] ?? TIER_DEFAULTS.free;
}

async function loadTariff(tier: string): Promise<CachedTariff> {
  const now = Date.now();
  const cached = tariffCache.get(tier);
  if (cached && cached.expiresAt > now) return cached.row;

  const [row] = await db
    .select()
    .from(tariffsTable)
    .where(eq(tariffsTable.tier, tier))
    .limit(1);
  let result: CachedTariff;
  if (row) {
    result = {
      tier: row.tier,
      storyDailyLimit: row.storyDailyLimit,
      illustrationDailyLimit: row.illustrationDailyLimit,
    };
  } else {
    // Seed all known tier defaults on first miss so the admin UI never
    // 404s on a freshly provisioned database. Idempotent.
    await db
      .insert(tariffsTable)
      .values(Object.values(TIER_DEFAULTS))
      .onConflictDoNothing();
    result = defaultTariff(tier);
  }
  tariffCache.set(tier, { row: result, expiresAt: now + CACHE_TTL_MS });
  return result;
}

export async function getFreeTariff(): Promise<CachedTariff> {
  return loadTariff("free");
}

export async function getTariffForPlan(plan: Plan): Promise<CachedTariff> {
  return loadTariff(plan === "conjurer" ? "conjurer" : "free");
}

export function invalidateTariffCache(): void {
  tariffCache.clear();
}

function today(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function getUsage(authorName: string) {
  const day = today();
  const plan = await getPlanByHandle(authorName);
  const tariff = await getTariffForPlan(plan);
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
    plan,
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
