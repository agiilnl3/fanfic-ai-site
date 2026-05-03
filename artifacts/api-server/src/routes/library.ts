import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  bookmarksTable,
  readingProgressTable,
  storiesTable,
} from "@workspace/db";
import {
  AddBookmarkParams,
  AddBookmarkBody,
  RemoveBookmarkParams,
  RemoveBookmarkQueryParams,
  GetBookmarkInfoParams,
  GetBookmarkInfoQueryParams,
  ListBookmarksParams,
  ListReadingHistoryParams,
  GetReadingProgressParams,
  GetReadingProgressQueryParams,
  SetReadingProgressParams,
  SetReadingProgressBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/stories/:id/bookmark", async (req, res): Promise<void> => {
  const params = GetBookmarkInfoParams.safeParse(req.params);
  const query = GetBookmarkInfoQueryParams.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const author = (query.data.authorName ?? "").trim();
  if (!author) {
    res.json({ storyId: params.data.id, bookmarked: false });
    return;
  }
  const [row] = await db
    .select({ id: bookmarksTable.id })
    .from(bookmarksTable)
    .where(
      and(
        eq(bookmarksTable.storyId, params.data.id),
        eq(bookmarksTable.authorName, author),
      ),
    )
    .limit(1);
  res.json({ storyId: params.data.id, bookmarked: !!row });
});

router.post("/stories/:id/bookmark", async (req, res): Promise<void> => {
  const params = AddBookmarkParams.safeParse(req.params);
  const body = AddBookmarkBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const author = body.data.authorName.trim();
  await db
    .insert(bookmarksTable)
    .values({ authorName: author, storyId: params.data.id })
    .onConflictDoNothing();
  res.json({ storyId: params.data.id, bookmarked: true });
});

router.delete("/stories/:id/bookmark", async (req, res): Promise<void> => {
  const params = RemoveBookmarkParams.safeParse(req.params);
  const query = RemoveBookmarkQueryParams.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  await db
    .delete(bookmarksTable)
    .where(
      and(
        eq(bookmarksTable.storyId, params.data.id),
        eq(bookmarksTable.authorName, query.data.authorName.trim()),
      ),
    );
  res.json({ storyId: params.data.id, bookmarked: false });
});

router.get("/authors/:name/bookmarks", async (req, res): Promise<void> => {
  const params = ListBookmarksParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const rows = await db
    .select()
    .from(bookmarksTable)
    .where(eq(bookmarksTable.authorName, params.data.name))
    .orderBy(desc(bookmarksTable.createdAt));
  if (rows.length === 0) {
    res.json([]);
    return;
  }
  const storyIds = rows.map((r) => r.storyId);
  const stories = await db
    .select()
    .from(storiesTable)
    .where(inArray(storiesTable.id, storyIds));
  const sMap = new Map(stories.map((s) => [s.id, s]));
  res.json(
    rows
      .map((r) => {
        const s = sMap.get(r.storyId);
        if (!s) return null;
        return {
          id: r.id,
          authorName: r.authorName,
          storyId: r.storyId,
          createdAt: r.createdAt.toISOString(),
          story: {
            ...s,
            createdAt: s.createdAt.toISOString(),
            updatedAt: s.updatedAt.toISOString(),
          },
        };
      })
      .filter(Boolean),
  );
});

router.get("/authors/:name/history", async (req, res): Promise<void> => {
  const params = ListReadingHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const rows = await db
    .select()
    .from(readingProgressTable)
    .where(eq(readingProgressTable.authorName, params.data.name))
    .orderBy(desc(readingProgressTable.updatedAt))
    .limit(50);
  if (rows.length === 0) {
    res.json([]);
    return;
  }
  const storyIds = rows.map((r) => r.storyId);
  const stories = await db
    .select()
    .from(storiesTable)
    .where(inArray(storiesTable.id, storyIds));
  const sMap = new Map(stories.map((s) => [s.id, s]));
  res.json(
    rows
      .map((r) => {
        const s = sMap.get(r.storyId);
        if (!s) return null;
        return {
          storyId: r.storyId,
          progress: r.progress,
          updatedAt: r.updatedAt.toISOString(),
          story: {
            ...s,
            createdAt: s.createdAt.toISOString(),
            updatedAt: s.updatedAt.toISOString(),
          },
        };
      })
      .filter(Boolean),
  );
});

router.get("/stories/:id/progress", async (req, res): Promise<void> => {
  const params = GetReadingProgressParams.safeParse(req.params);
  const query = GetReadingProgressQueryParams.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [row] = await db
    .select()
    .from(readingProgressTable)
    .where(
      and(
        eq(readingProgressTable.storyId, params.data.id),
        eq(readingProgressTable.authorName, query.data.authorName.trim()),
      ),
    )
    .limit(1);
  res.json({
    storyId: params.data.id,
    authorName: query.data.authorName.trim(),
    progress: row?.progress ?? 0,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  });
});

router.post("/stories/:id/progress", async (req, res): Promise<void> => {
  const params = SetReadingProgressParams.safeParse(req.params);
  const body = SetReadingProgressBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const author = body.data.authorName.trim();
  const progress = Math.max(0, Math.min(100, body.data.progress));
  const [row] = await db
    .insert(readingProgressTable)
    .values({
      authorName: author,
      storyId: params.data.id,
      progress,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [readingProgressTable.authorName, readingProgressTable.storyId],
      set: {
        progress: sql`GREATEST(${readingProgressTable.progress}, ${progress})`,
        updatedAt: new Date(),
      },
    })
    .returning();
  res.json({
    storyId: params.data.id,
    authorName: author,
    progress: row?.progress ?? progress,
    updatedAt: row?.updatedAt?.toISOString() ?? new Date().toISOString(),
  });
});

export default router;
