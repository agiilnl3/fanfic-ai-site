import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  reportsTable,
  hiddenStoriesTable,
  hiddenCommentsTable,
  storiesTable,
  storyCommentsTable,
} from "@workspace/db";
import {
  CreateReportBody,
  AdminListReportsQueryParams,
  AdminResolveReportParams,
  AdminResolveReportBody,
} from "@workspace/api-zod";
import { adminAuth } from "../middlewares/admin";

const router: IRouter = Router();

async function attachPreviews(
  rows: (typeof reportsTable.$inferSelect)[],
): Promise<Array<typeof reportsTable.$inferSelect & { targetPreview: string | null }>> {
  if (rows.length === 0) return [];
  const storyIds = rows.filter((r) => r.targetType === "story").map((r) => r.targetId);
  const commentIds = rows.filter((r) => r.targetType === "comment").map((r) => r.targetId);
  const stories = storyIds.length
    ? await db
        .select({ id: storiesTable.id, title: storiesTable.title })
        .from(storiesTable)
        .where(inArray(storiesTable.id, storyIds))
    : [];
  const comments = commentIds.length
    ? await db
        .select({ id: storyCommentsTable.id, body: storyCommentsTable.body })
        .from(storyCommentsTable)
        .where(inArray(storyCommentsTable.id, commentIds))
    : [];
  const sMap = new Map(stories.map((s) => [s.id, s.title]));
  const cMap = new Map(comments.map((c) => [c.id, c.body]));
  return rows.map((r) => ({
    ...r,
    targetPreview:
      r.targetType === "story"
        ? sMap.get(r.targetId) ?? null
        : (cMap.get(r.targetId)?.slice(0, 200) ?? null),
  }));
}

function shape(
  r: typeof reportsTable.$inferSelect & { targetPreview?: string | null },
) {
  return {
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetId,
    reporterName: r.reporterName,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    targetPreview: r.targetPreview ?? null,
  };
}

router.post("/reports", async (req, res): Promise<void> => {
  const body = CreateReportBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [row] = await db
    .insert(reportsTable)
    .values({
      targetType: body.data.targetType,
      targetId: body.data.targetId,
      reporterName: body.data.reporterName.trim(),
      reason: (body.data.reason ?? "").trim(),
    })
    .returning();
  res.status(201).json(shape(row));
});

router.get("/admin/reports", adminAuth, async (req, res): Promise<void> => {
  const query = AdminListReportsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const rows = query.data.status
    ? await db
        .select()
        .from(reportsTable)
        .where(eq(reportsTable.status, query.data.status))
        .orderBy(desc(reportsTable.createdAt))
    : await db.select().from(reportsTable).orderBy(desc(reportsTable.createdAt));
  const decorated = await attachPreviews(rows);
  res.json(decorated.map(shape));
});

router.post(
  "/admin/reports/:id",
  adminAuth,
  async (req, res): Promise<void> => {
    const params = AdminResolveReportParams.safeParse(req.params);
    const body = AdminResolveReportBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const [report] = await db
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.id, params.data.id))
      .limit(1);
    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    if (body.data.action === "hide") {
      if (report.targetType === "story") {
        await db
          .insert(hiddenStoriesTable)
          .values({ storyId: report.targetId, reason: report.reason })
          .onConflictDoNothing();
        // Also flip the story to "draft" so the public feed drops it.
        await db
          .update(storiesTable)
          .set({ status: "draft", updatedAt: new Date() })
          .where(eq(storiesTable.id, report.targetId));
      } else {
        await db
          .insert(hiddenCommentsTable)
          .values({ commentId: report.targetId, reason: report.reason })
          .onConflictDoNothing();
        await db
          .delete(storyCommentsTable)
          .where(eq(storyCommentsTable.id, report.targetId));
      }
    }
    const [updated] = await db
      .update(reportsTable)
      .set({
        status: body.data.action === "hide" ? "hidden" : "dismissed",
        resolvedAt: new Date(),
      })
      .where(eq(reportsTable.id, params.data.id))
      .returning();
    res.json(shape(updated));
  },
);

export default router;
