import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, notificationPrefsTable } from "@workspace/db";
import {
  GetNotificationPrefsParams,
  UpdateNotificationPrefsParams,
  UpdateNotificationPrefsBody,
} from "@workspace/api-zod";
import { getPrefsFor } from "../lib/notification-prefs";

const router: IRouter = Router();

router.get(
  "/authors/:name/notification-prefs",
  async (req, res): Promise<void> => {
    const params = GetNotificationPrefsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const prefs = await getPrefsFor(params.data.name);
    res.json({
      authorName: prefs.authorName,
      comment: prefs.comment,
      follow: prefs.follow,
      like: prefs.like,
      repost: prefs.repost,
      coAuthorChapter: prefs.coAuthorChapter,
    });
  },
);

router.put(
  "/authors/:name/notification-prefs",
  async (req, res): Promise<void> => {
    const params = UpdateNotificationPrefsParams.safeParse(req.params);
    const body = UpdateNotificationPrefsBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    // Only the named author (or an admin) may modify their own prefs.
    if (!req.user?.isAdmin && req.user?.handle !== params.data.name) {
      res.status(403).json({ error: "Cannot modify another author's preferences" });
      return;
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.comment !== undefined) patch.comment = body.data.comment;
    if (body.data.follow !== undefined) patch.follow = body.data.follow;
    if (body.data.like !== undefined) patch.like = body.data.like;
    if (body.data.repost !== undefined) patch.repost = body.data.repost;
    if (body.data.coAuthorChapter !== undefined)
      patch.coAuthorChapter = body.data.coAuthorChapter;

    const [row] = await db
      .insert(notificationPrefsTable)
      .values({
        authorName: params.data.name,
        comment: body.data.comment ?? true,
        follow: body.data.follow ?? true,
        like: body.data.like ?? true,
        repost: body.data.repost ?? true,
        coAuthorChapter: body.data.coAuthorChapter ?? true,
      })
      .onConflictDoUpdate({
        target: notificationPrefsTable.authorName,
        set: patch,
      })
      .returning();
    res.json({
      authorName: row.authorName,
      comment: row.comment,
      follow: row.follow,
      like: row.like,
      repost: row.repost,
      coAuthorChapter: row.coAuthorChapter,
    });
  },
);

export default router;
