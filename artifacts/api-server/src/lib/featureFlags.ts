import { eq, and } from "drizzle-orm";
import { db, featureFlagsTable, featureFlagOverridesTable } from "@workspace/db";

function hashUserToBucket(userId: number, flagName: string): number {
  let h = 2166136261 >>> 0;
  const s = `${flagName}:${userId}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 100;
}

export async function getActiveFlagsForUser(
  userId: number | null,
): Promise<Record<string, boolean>> {
  const flags = await db.select().from(featureFlagsTable);
  const overrideMap = new Map<string, boolean>();
  if (userId !== null) {
    const overrides = await db
      .select()
      .from(featureFlagOverridesTable)
      .where(eq(featureFlagOverridesTable.userId, userId));
    for (const o of overrides) overrideMap.set(o.flagName, o.enabled);
  }
  const out: Record<string, boolean> = {};
  for (const f of flags) {
    if (overrideMap.has(f.name)) {
      out[f.name] = overrideMap.get(f.name)!;
      continue;
    }
    if (!f.enabled) {
      out[f.name] = false;
      continue;
    }
    if (f.rolloutPercent >= 100) {
      out[f.name] = true;
      continue;
    }
    if (f.rolloutPercent <= 0) {
      out[f.name] = false;
      continue;
    }
    if (userId === null) {
      out[f.name] = false;
      continue;
    }
    out[f.name] = hashUserToBucket(userId, f.name) < f.rolloutPercent;
  }
  return out;
}

export async function setFlagOverride(
  flagName: string,
  userId: number,
  enabled: boolean,
): Promise<void> {
  await db
    .insert(featureFlagOverridesTable)
    .values({ flagName, userId, enabled })
    .onConflictDoUpdate({
      target: [featureFlagOverridesTable.flagName, featureFlagOverridesTable.userId],
      set: { enabled },
    });
}

export async function upsertFlag(
  name: string,
  enabled: boolean,
  rolloutPercent: number,
  description?: string,
): Promise<void> {
  await db
    .insert(featureFlagsTable)
    .values({ name, enabled, rolloutPercent, description: description ?? null })
    .onConflictDoUpdate({
      target: featureFlagsTable.name,
      set: { enabled, rolloutPercent, updatedAt: new Date() },
    });
}

export async function isFlagEnabled(
  name: string,
  userId: number | null,
): Promise<boolean> {
  const all = await getActiveFlagsForUser(userId);
  return !!all[name];
}
