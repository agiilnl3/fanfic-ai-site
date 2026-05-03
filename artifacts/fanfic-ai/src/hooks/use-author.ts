import { useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface MeResponse {
  id: number;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  isAdmin: boolean;
}

const ME_QUERY_KEY = ["me"] as const;

async function fetchMe(): Promise<MeResponse | null> {
  const base = import.meta.env.BASE_URL || "/";
  const res = await fetch(`${base}api/me`, { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Failed to load profile (${res.status})`);
  return res.json();
}

/**
 * Returns the signed-in author's handle and display name. When the user is
 * signed out, falls back to a guest pen-name stored in localStorage so
 * read-only browsing continues to work.
 *
 * `setAuthorName` is preserved for backward compat with components that let
 * a guest type a pen-name; for signed-in users it is a no-op.
 */
export function useAuthor() {
  const { isSignedIn } = useUser();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    enabled: !!isSignedIn,
    staleTime: 60_000,
  });

  const [guestName, setGuestName] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("fanfic_author") ?? "";
  });

  useEffect(() => {
    if (!isSignedIn) return;
    // After sign-in, drop the guest pen-name so we always source from Clerk.
    if (typeof window !== "undefined") {
      localStorage.removeItem("fanfic_author");
    }
  }, [isSignedIn]);

  const authorName = isSignedIn ? me?.handle ?? "" : guestName;

  const setAuthorName = (name: string) => {
    if (isSignedIn) return;
    setGuestName(name);
    if (typeof window !== "undefined") {
      if (name) localStorage.setItem("fanfic_author", name);
      else localStorage.removeItem("fanfic_author");
    }
  };

  return {
    authorName,
    setAuthorName,
    isSignedIn: !!isSignedIn,
    displayName: isSignedIn ? me?.displayName ?? "" : guestName,
    avatarUrl: isSignedIn ? me?.avatarUrl ?? null : null,
    isAdmin: !!me?.isAdmin,
    me,
    refetchMe: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  };
}
