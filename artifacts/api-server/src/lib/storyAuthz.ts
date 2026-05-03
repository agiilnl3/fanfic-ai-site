import type { Story } from "@workspace/db";

export function canEditStory(
  story: Pick<Story, "authorName" | "coAuthors">,
  requesterAuthorName: string | null | undefined,
): boolean {
  if (!requesterAuthorName) return false;
  const r = requesterAuthorName.trim();
  if (!r) return false;
  if (r === story.authorName) return true;
  return (story.coAuthors ?? []).includes(r);
}
