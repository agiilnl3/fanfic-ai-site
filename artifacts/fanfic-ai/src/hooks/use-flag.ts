import { useEffect, useState } from "react";

interface FlagsResponse {
  flags: Record<string, boolean>;
}

let cache: Promise<FlagsResponse> | null = null;
let cacheValue: FlagsResponse | null = null;
let cacheKey: string | null = null;

function loadFlags(key: string): Promise<FlagsResponse> {
  // Bust the cache whenever the auth/user key changes so a logged-in
  // flip does not bleed into a logged-out session and vice versa.
  if (cache && cacheKey === key) return cache;
  cacheKey = key;
  const base = import.meta.env.BASE_URL || "/";
  cache = fetch(`${base}api/flags`, { credentials: "include" })
    .then((r) => (r.ok ? r.json() : { flags: {} }))
    .catch(() => ({ flags: {} }))
    .then((v: FlagsResponse) => {
      cacheValue = v;
      return v;
    });
  return cache;
}

/**
 * useFlag(name, userKey?) — returns whether `name` is enabled for the
 * current viewer. Pass a stable per-user key (clerk user id, or "anon"
 * when logged out) so the cache is invalidated on sign-in/sign-out.
 */
export function useFlag(name: string, userKey: string = "anon"): boolean {
  const [enabled, setEnabled] = useState<boolean>(
    () => !!cacheValue?.flags?.[name],
  );
  useEffect(() => {
    let cancelled = false;
    loadFlags(userKey).then((v) => {
      if (!cancelled) setEnabled(!!v.flags[name]);
    });
    return () => {
      cancelled = true;
    };
  }, [name, userKey]);
  return enabled;
}

export function resetFlagCacheForTest(): void {
  cache = null;
  cacheValue = null;
  cacheKey = null;
}
