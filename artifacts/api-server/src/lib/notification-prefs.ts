import { eq, inArray } from "drizzle-orm";
import { db, notificationPrefsTable, type NotificationPrefs } from "@workspace/db";

export type NotificationType =
  | "comment"
  | "follow"
  | "like"
  | "repost"
  | "co_author_chapter"
  | "collab_invite"
  | "collab_accept";

const FIELD: Record<NotificationType, keyof NotificationPrefs> = {
  comment: "comment",
  follow: "follow",
  like: "like",
  repost: "repost",
  co_author_chapter: "coAuthorChapter",
  collab_invite: "collabInvite",
  collab_accept: "collabAccept",
};

export async function getPrefsFor(authorName: string): Promise<NotificationPrefs> {
  const [row] = await db
    .select()
    .from(notificationPrefsTable)
    .where(eq(notificationPrefsTable.authorName, authorName))
    .limit(1);
  if (row) return row;
  return {
    authorName,
    comment: true,
    follow: true,
    like: true,
    repost: true,
    coAuthorChapter: true,
    collabInvite: true,
    collabAccept: true,
    updatedAt: new Date(),
  };
}

export async function shouldNotify(
  recipient: string,
  type: NotificationType,
): Promise<boolean> {
  const prefs = await getPrefsFor(recipient);
  return Boolean(prefs[FIELD[type]]);
}

/** Filter a batch of notifications down to the ones the recipient still wants. */
export async function filterByPrefs<
  T extends { type: string; recipientName: string },
>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const recipients = Array.from(new Set(rows.map((r) => r.recipientName)));
  const stored = await db
    .select()
    .from(notificationPrefsTable)
    .where(inArray(notificationPrefsTable.authorName, recipients));
  const map = new Map(stored.map((r) => [r.authorName, r]));
  return rows.filter((r) => {
    const prefs = map.get(r.recipientName);
    if (!prefs) return true;
    const field = FIELD[r.type as NotificationType];
    if (!field) return true;
    return Boolean(prefs[field]);
  });
}
