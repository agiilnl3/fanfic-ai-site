import type { Story, User } from "@workspace/db";

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
