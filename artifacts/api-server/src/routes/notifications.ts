import { Router, type IRouter } from "express";
import { and, desc, eq, count, isNull } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import {
  ListNotificationsQueryParams,
  GetUnreadNotificationCountQueryParams,
  MarkNotificationsReadBody,
} from "@workspace/api-zod";
import { writeLimiter } from "../middlewares/rate-limit";

const router: IRouter = Router();

async function unreadCount(recipientName: string) {
  const [row] = await db
    .select({ value: count() })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.recipientName, recipientName),
        isNull(notificationsTable.readAt),
      ),
    );
  return { recipientName, unread: row?.value ?? 0 };
}

router.get("/notifications", async (req, res): Promise<void> => {
  const parsed = ListNotificationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "recipientName required" });
    return;
  }
  const { recipientName, limit } = parsed.data;
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.recipientName, recipientName))
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
