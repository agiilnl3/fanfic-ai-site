import type { Story, User, Series } from "@workspace/db";

/**
 * Generic ownership check for any row that has a stable `userId` plus a
 * legacy `authorName` handle. Prefers stable Clerk id; falls back to
 * handle only when the row pre-dates the Clerk migration (userId is null).
 */
export function ownsByUserOrHandle(
  row: { userId: number | null; authorName: string },
  user: Pick<User, "id" | "handle"> | null | undefined,
): boolean {
  if (!user) return false;
  if (row.userId != null) return row.userId === user.id;
  return user.handle === row.authorName;
}

export function canEditSeries(
  series: Pick<Series, "userId" | "authorName">,
  user: Pick<User, "id" | "handle"> | null | undefined,
): boolean {
  return ownsByUserOrHandle(series, user);
}

/**
 * Authorization check for story edits. Prefers stable Clerk-backed
 * `users.id` ownership when present on the story; falls back to handle
 * comparison only for legacy rows that pre-date the userId column.
 */
export function canEditStory(
  story: Pick<Story, "authorName" | "coAuthors" | "userId">,
  user: Pick<User, "id" | "handle"> | null | undefined,
): boolean {
  if (!user) return false;
  if (story.userId != null) {
    if (story.userId === user.id) return true;
    // co-authors are still handle-based until co-author IDs are tracked
    return (story.coAuthors ?? []).includes(user.handle);
  }
  // Legacy story (pre-Clerk): fall back to handle comparison.
  if (user.handle === story.authorName) return true;
  return (story.coAuthors ?? []).includes(user.handle);
}
