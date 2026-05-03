import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import {
  ListNotificationsQueryParams,
  GetUnreadNotificationCountQueryParams,
  MarkNotificationsReadBody,
} from "@workspace/api-zod";
import { writeLimiter } from "../middlewares/rate-limit";
import { getPrefsFor } from "../lib/notification-prefs";

const router: IRouter = Router();

function allowedTypes(prefs: Awaited<ReturnType<typeof getPrefsFor>>): string[] {
  const list: string[] = [];
  if (prefs.comment) list.push("comment");
  if (prefs.follow) list.push("follow");
  if (prefs.like) list.push("like");
  if (prefs.repost) list.push("repost");
  if (prefs.coAuthorChapter) list.push("co_author_chapter");
  if (prefs.collabInvite) list.push("collab_invite");
  if (prefs.collabAccept) list.push("collab_accept");
  return list;
}

async function unreadCount(recipientName: string) {
  const prefs = await getPrefsFor(recipientName);
  const types = allowedTypes(prefs);
  if (types.length === 0) return { recipientName, unread: 0 };
  const rows = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.recipientName, recipientName),
        isNull(notificationsTable.readAt),
        inArray(notificationsTable.type, types),
      ),
    );
  return { recipientName, unread: rows.length };
}

router.get("/notifications", async (req, res): Promise<void> => {
  const parsed = ListNotificationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "recipientName required" });
    return;
  }
  const { recipientName, limit } = parsed.data;
  const prefs = await getPrefsFor(recipientName);
  const types = allowedTypes(prefs);
  if (types.length === 0) {
    res.json([]);
    return;
  }
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.recipientName, recipientName),
        inArray(notificationsTable.type, types),
      ),
    )
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit ?? 30);
  res.json(rows);
});

router.get("/notifications/unread-count", async (req, res): Promise<void> => {
  const parsed = GetUnreadNotificationCountQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "recipientName required" });
    return;
  }
  res.json(await unreadCount(parsed.data.recipientName));
});

router.post("/notifications/mark-read", writeLimiter, async (req, res): Promise<void> => {
  const parsed = MarkNotificationsReadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "recipientName required" });
    return;
  }
  const recipient = parsed.data.recipientName.trim();
  await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationsTable.recipientName, recipient),
        isNull(notificationsTable.readAt),
      ),
    );
  res.json(await unreadCount(recipient));
});

export default router;
