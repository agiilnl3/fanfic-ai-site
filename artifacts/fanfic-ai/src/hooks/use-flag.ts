import { useEffect, useState } from "react";

interface FlagsResponse {
  flags: Record<string, boolean>;
}

let cache: Promise<FlagsResponse> | null = null;
let cacheValue: FlagsResponse | null = null;

function loadFlags(): Promise<FlagsResponse> {
  if (cache) return cache;
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

export function useFlag(name: string): boolean {
  const [enabled, setEnabled] = useState<boolean>(
    () => !!cacheValue?.flags?.[name],
  );
  useEffect(() => {
    let cancelled = false;
    loadFlags().then((v) => {
      if (!cancelled) setEnabled(!!v.flags[name]);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);
  return enabled;
}

export function resetFlagCacheForTest(): void {
  cache = null;
  cacheValue = null;
}
