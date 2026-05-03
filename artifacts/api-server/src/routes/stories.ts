import { Router, type IRouter } from "express";
import { eq, desc, count, and, sql, inArray, gte } from "drizzle-orm";
import {
  db,
  storiesTable,
  illustrationsTable,
  storyLikesTable,
  storyCommentsTable,
  storyRepostsTable,
  storyViewsTable,
  authorFollowsTable,
  notificationsTable,
} from "@workspace/db";
import { ilike, or, isNull } from "drizzle-orm";
import {
  hiddenStoriesTable,
  storyTagsTable,
  tagsTable,
  readingProgressTable,
} from "@workspace/db";
import {
  ListStoriesQueryParams,
  CreateStoryBody,
  GenerateStoryBody,
  GetPublicFeedQueryParams,
  GetStoryParams,
  UpdateStoryBody,
  UpdateStoryParams,
  DeleteStoryParams,
  PublishStoryParams,
  GetIllustrationsParams,
  GenerateIllustrationBody,
  GenerateIllustrationParams,
  DeleteIllustrationParams,
  RegenerateIllustrationParams,
  RegenerateIllustrationBody,
  ListCoAuthorsParams,
  AddCoAuthorParams,
  AddCoAuthorBody,
  RemoveCoAuthorParams,
  RemoveCoAuthorBody,
  RegenerateStoryTextParams,
  RegenerateStorySectionParams,
  RegenerateStorySectionBody,
  GetStoryLikeParams,
  GetStoryLikeQueryParams,
  LikeStoryParams,
  LikeStoryBody,
  UnlikeStoryParams,
  UnlikeStoryQueryParams,
  ContinueStoryParams,
  ContinueStoryBody,
  GetStoryAudioParams,
  GetStoryAudioQueryParams,
  ExportStoryPdfParams,
  GetStoryCommentsParams,
  AddStoryCommentParams,
  AddStoryCommentBody,
  DeleteStoryCommentParams,
  DeleteStoryCommentQueryParams,
  ReorderIllustrationsParams,
  ReorderIllustrationsBody,
} from "@workspace/api-zod";
import { checkAndBumpStory, checkAndBumpIllustration } from "../lib/usage";
import { notifyRecipient } from "../lib/notification-bus";
import { openai } from "@workspace/integrations-openai-ai-server";
import { generateImageBuffer } from "@workspace/integrations-openai-ai-server/image";
import { uploadIllustrationBuffer } from "../lib/uploadIllustration";
import { canEditStory } from "../lib/storyAuthz";
import PDFDocument from "pdfkit";
import { logger } from "../lib/logger";
import { buildIllustrationPrompt } from "../lib/prompt";
import {
  aiGenerationLimiter,
  illustrationLimiter,
  writeLimiter,
} from "../middlewares/rate-limit";

const router: IRouter = Router();

async function generateStoryText(
  genre: string,
  artStyle: string,
  lengthSetting: string,
  seedPrompt?: string,
  model: string = "gpt-5.1",
): Promise<{
  title: string;
  fullText: string;
  summary: string;
  characters: string;
  sections: string[];
}> {
  const wordTarget =
    lengthSetting === "short" ? 600 : lengthSetting === "long" ? 2500 : 1400;

  const maxTokens =
    lengthSetting === "short" ? 16000 : lengthSetting === "long" ? 65536 : 32000;

  const systemPrompt = `You are a creative fiction writer. Write engaging, coherent ${genre} stories with vivid descriptions and compelling characters. The art style for illustrations will be: ${artStyle}. Always respond in valid JSON.`;

  const userPrompt = seedPrompt
    ? `Write a ${genre} fanfiction story of approximately ${wordTarget} words. Seed idea: "${seedPrompt}". 
Return JSON with: { "title": string, "fullText": string, "summary": string (2-3 sentences), "characters": string (brief description of main characters, max 200 chars), "sections": string[] (3-4 brief 1-2 sentence scene descriptions for illustration prompts — do NOT repeat fullText) }`
    : `Write an original ${genre} fiction story of approximately ${wordTarget} words with memorable characters and a satisfying plot arc.
Return JSON with: { "title": string, "fullText": string, "summary": string (2-3 sentences), "characters": string (brief description of main characters, max 200 chars), "sections": string[] (3-4 brief 1-2 sentence scene descriptions for illustration prompts — do NOT repeat fullText) }`;

  const response = await openai.chat.completions.create({
    model,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`AI returned malformed JSON. The story may have been too long. Try a shorter length setting. (raw length: ${raw.length})`);
  }
  const p = parsed as Record<string, unknown>;
  return {
    title: typeof p.title === "string" ? p.title : "Untitled Story",
    fullText: typeof p.fullText === "string" ? p.fullText : "",
    summary: typeof p.summary === "string" ? p.summary : "",
    characters: typeof p.characters === "string" ? p.characters : "",
    sections: Array.isArray(p.sections)
      ? p.sections.filter((s): s is string => typeof s === "string")
      : [],
  };
}

type StoryRow = typeof storiesTable.$inferSelect;

async function attachCounts<T extends StoryRow>(
  rows: T[],
): Promise<(T & { likeCount: number; commentCount: number })[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const likeRows = await db
    .select({ storyId: storyLikesTable.storyId, value: count() })
    .from(storyLikesTable)
    .where(inArray(storyLikesTable.storyId, ids))
    .groupBy(storyLikesTable.storyId);
  const commentRows = await db
    .select({ storyId: storyCommentsTable.storyId, value: count() })
    .from(storyCommentsTable)
    .where(inArray(storyCommentsTable.storyId, ids))
    .groupBy(storyCommentsTable.storyId);
  const likeMap = new Map(likeRows.map((r) => [r.storyId, Number(r.value)]));
  const commentMap = new Map(commentRows.map((r) => [r.storyId, Number(r.value)]));
  return rows.map((r) => ({
    ...r,
    likeCount: likeMap.get(r.id) ?? 0,
    commentCount: commentMap.get(r.id) ?? 0,
  }));
}

async function singleCounts(
  storyId: number,
): Promise<{ likeCount: number; commentCount: number }> {
  const [{ value: likeCount }] = await db
    .select({ value: count() })
    .from(storyLikesTable)
    .where(eq(storyLikesTable.storyId, storyId));
  const [{ value: commentCount }] = await db
    .select({ value: count() })
    .from(storyCommentsTable)
    .where(eq(storyCommentsTable.storyId, storyId));
  return { likeCount: Number(likeCount), commentCount: Number(commentCount) };
}

router.get("/stories", async (req, res): Promise<void> => {
  const parsed = ListStoriesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { status, genre, authorName } = parsed.data;
  const conditions = [];
  if (status) conditions.push(eq(storiesTable.status, status));
  if (genre) conditions.push(eq(storiesTable.genre, genre));
  if (authorName) conditions.push(eq(storiesTable.authorName, authorName));

  const stories =
    conditions.length > 0
      ? await db
          .select()
          .from(storiesTable)
          .where(and(...conditions))
          .orderBy(desc(storiesTable.createdAt))
      : await db
          .select()
          .from(storiesTable)
          .orderBy(desc(storiesTable.createdAt));

  res.json(await attachCounts(stories));
});

router.post("/stories", writeLimiter, async (req, res): Promise<void> => {
  const parsed = CreateStoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [story] = await db
    .insert(storiesTable)
    .values({
      ...parsed.data,
      userId: req.user?.id ?? null,
      status: "draft",
    })
    .returning();

  res.status(201).json(story);
});

router.post("/stories/generate", aiGenerationLimiter, async (req, res): Promise<void> => {
  const parsed = GenerateStoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { genre, artStyle, lengthSetting, seedPrompt, authorName, generateIllustrations, model } =
    parsed.data;

  const quota = await checkAndBumpStory(authorName);
  if (!quota.ok) {
    res.status(429).json({
      error: "Daily story quota reached",
      remaining: quota.remaining,
      limit: quota.limit,
    });
    return;
  }

  req.log.info({ genre, artStyle, lengthSetting, model }, "Generating story with AI");

  const generated = await generateStoryText(
    genre,
    artStyle,
    lengthSetting,
    seedPrompt,
    model,
  );

  const [story] = await db
    .insert(storiesTable)
    .values({
      title: generated.title,
      genre,
      artStyle,
      lengthSetting,
      seedPrompt: seedPrompt ?? null,
      fullText: generated.fullText,
      summary: generated.summary,
      characters: generated.characters,
      authorName,
      userId: req.user?.id ?? null,
      status: "draft",
    })
    .returning();

  const failedSections: number[] = [];

  if (generateIllustrations !== false && generated.sections.length > 0) {
    const illustrationResults = await Promise.allSettled(
      generated.sections.slice(0, 4).map(async (section, idx) => {
        const prompt = buildIllustrationPrompt(
          section,
          genre,
          artStyle,
          generated.characters,
          generated.summary,
        );
        const buffer = await generateImageBuffer(prompt, "1024x1024");
        const imageUrl = await uploadIllustrationBuffer(buffer);
        await db.insert(illustrationsTable).values({
          storyId: story.id,
          sectionIndex: idx,
          prompt,
          imageUrl,
          caption: null,
        });
        return idx;
      }),
    );

    illustrationResults.forEach((result, idx) => {
      if (result.status === "rejected") {
        req.log.error({ err: result.reason, idx }, "Failed to generate illustration");
        failedSections.push(idx);
      }
    });

    const firstIllustration = await db
      .select()
      .from(illustrationsTable)
      .where(eq(illustrationsTable.storyId, story.id))
      .orderBy(illustrationsTable.sectionIndex)
      .limit(1);

    if (firstIllustration[0]) {
      await db
        .update(storiesTable)
        .set({ coverImageUrl: firstIllustration[0].imageUrl })
        .where(eq(storiesTable.id, story.id));
      story.coverImageUrl = firstIllustration[0].imageUrl;
    }
  }

  const finalStory = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, story.id))
    .limit(1);

  const responseBody = {
    ...(finalStory[0] ?? story),
    ...(failedSections.length > 0 ? { illustrationWarnings: `${failedSections.length} illustration(s) could not be generated for section(s): ${failedSections.join(", ")}` } : {}),
  };
  res.status(201).json(responseBody);
});

router.get("/stories/feed", async (req, res): Promise<void> => {
  const parsed = GetPublicFeedQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { genre, limit, q, followerName, sort, tag, viewerAuthorName } =
    parsed.data;
  const conditions = [eq(storiesTable.status, "published")];
  if (genre) conditions.push(eq(storiesTable.genre, genre));
  if (q && q.trim()) {
    const needle = `%${q.trim()}%`;
    const search = or(
      ilike(storiesTable.title, needle),
      ilike(storiesTable.summary, needle),
      ilike(storiesTable.seedPrompt, needle),
    );
    if (search) conditions.push(search);
  }

  if (followerName && followerName.trim()) {
    const follows = await db
      .select({ authorName: authorFollowsTable.authorName })
      .from(authorFollowsTable)
      .where(eq(authorFollowsTable.followerName, followerName.trim()));
    const authors = follows.map((f) => f.authorName);
    if (authors.length === 0) {
      res.json([]);
      return;
    }
    conditions.push(inArray(storiesTable.authorName, authors));
  }

  if (tag && tag.trim()) {
    const tagged = await db
      .select({ storyId: storyTagsTable.storyId })
      .from(storyTagsTable)
      .innerJoin(tagsTable, eq(tagsTable.id, storyTagsTable.tagId))
      .where(eq(tagsTable.slug, tag.trim().toLowerCase()));
    const ids = tagged.map((r) => r.storyId);
    if (ids.length === 0) {
      res.json([]);
      return;
    }
    conditions.push(inArray(storiesTable.id, ids));
  }

  // Hide moderated stories from the public feed.
  const hidden = await db.select({ id: hiddenStoriesTable.storyId }).from(hiddenStoriesTable);
  if (hidden.length > 0) {
    const hiddenIds = hidden.map((h) => h.id);
    conditions.push(sql`${storiesTable.id} NOT IN (${sql.join(hiddenIds.map((id) => sql`${id}`), sql`, `)})`);
  }

  const sortMode = sort ?? "new";
  const cap = limit ?? 20;

  if (sortMode === "new") {
    const stories = await db
      .select()
      .from(storiesTable)
      .where(and(...conditions))
      .orderBy(desc(storiesTable.createdAt))
      .limit(cap);
    const counted = await attachCounts(stories);
    res.json(await decorateForViewer(counted, viewerAuthorName));
    return;
  }

  // Trending: rank stories by engagement events that happened in the window,
  // not by story creation time. We aggregate per-event-table by createdAt
  // (the time the like/comment/repost/view actually occurred), join the
  // weighted scores together, then return the top N stories matching the
  // base filter conditions. Reposts and views are included.
  const windowMs =
    sortMode === "today"
      ? 24 * 3600 * 1000
      : sortMode === "week"
        ? 7 * 24 * 3600 * 1000
        : null;
  const since = windowMs ? new Date(Date.now() - windowMs) : null;

  const likeWhere = since ? gte(storyLikesTable.createdAt, since) : undefined;
  const commentWhere = since
    ? gte(storyCommentsTable.createdAt, since)
    : undefined;
  const repostWhere = since
    ? gte(storyRepostsTable.createdAt, since)
    : undefined;
  const viewWhere = since ? gte(storyViewsTable.createdAt, since) : undefined;

  const [likeRows, commentRows, repostRows, viewRows] = await Promise.all([
    db
      .select({
        storyId: storyLikesTable.storyId,
        c: count(),
      })
      .from(storyLikesTable)
      .where(likeWhere)
      .groupBy(storyLikesTable.storyId),
    db
      .select({
        storyId: storyCommentsTable.storyId,
        c: count(),
      })
      .from(storyCommentsTable)
      .where(commentWhere)
      .groupBy(storyCommentsTable.storyId),
    db
      .select({
        storyId: storyRepostsTable.storyId,
        c: count(),
      })
      .from(storyRepostsTable)
      .where(repostWhere)
      .groupBy(storyRepostsTable.storyId),
    db
      .select({
        storyId: storyViewsTable.storyId,
        c: count(),
      })
      .from(storyViewsTable)
      .where(viewWhere)
      .groupBy(storyViewsTable.storyId),
  ]);

  const score = new Map<number, number>();
  const bump = (rows: { storyId: number; c: number }[], weight: number) => {
    for (const r of rows) {
      score.set(r.storyId, (score.get(r.storyId) ?? 0) + Number(r.c) * weight);
    }
  };
  bump(likeRows, 3);
  bump(commentRows, 2);
  bump(repostRows, 4);
  bump(viewRows, 1);

  if (score.size === 0) {
    res.json([]);
    return;
  }

  const candidateIds = Array.from(score.keys());
  const stories = await db
    .select()
    .from(storiesTable)
    .where(and(...conditions, inArray(storiesTable.id, candidateIds)));
  const ranked = stories
    .map((s) => ({ s, score: score.get(s.id) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map((r) => r.s);
  const countedRanked = await attachCounts(ranked);
  res.json(await decorateForViewer(countedRanked, viewerAuthorName));
});

async function decorateForViewer<
  T extends { id: number },
>(rows: T[], viewerAuthorName: string | undefined): Promise<T[]> {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const viewer = viewerAuthorName?.trim();
  const [tagLinks, progressRows] = await Promise.all([
    db
      .select({
        storyId: storyTagsTable.storyId,
        id: tagsTable.id,
        slug: tagsTable.slug,
        label: tagsTable.label,
      })
      .from(storyTagsTable)
      .innerJoin(tagsTable, eq(tagsTable.id, storyTagsTable.tagId))
      .where(inArray(storyTagsTable.storyId, ids)),
    viewer
      ? db
          .select({
            storyId: readingProgressTable.storyId,
            progress: readingProgressTable.progress,
          })
          .from(readingProgressTable)
          .where(
            and(
              eq(readingProgressTable.authorName, viewer),
              inArray(readingProgressTable.storyId, ids),
            ),
          )
      : Promise.resolve(
          [] as { storyId: number; progress: number }[],
        ),
  ]);
  const tagsByStory = new Map<
    number,
    { id: number; slug: string; label: string; storyCount: number }[]
  >();
  for (const t of tagLinks) {
    const list = tagsByStory.get(t.storyId) ?? [];
    list.push({ id: t.id, slug: t.slug, label: t.label, storyCount: 0 });
    tagsByStory.set(t.storyId, list);
  }
  const progressByStory = new Map(
    progressRows.map((p) => [p.storyId, p.progress]),
  );
  return rows.map((r) => ({
    ...r,
    tags: tagsByStory.get(r.id) ?? [],
    readingProgress: viewer ? progressByStory.get(r.id) ?? null : null,
  }));
}

router.get("/stories/stats", async (_req, res): Promise<void> => {
  const [total] = await db
    .select({ count: count() })
    .from(storiesTable);

  const [published] = await db
    .select({ count: count() })
    .from(storiesTable)
    .where(eq(storiesTable.status, "published"));

  const [drafts] = await db
    .select({ count: count() })
    .from(storiesTable)
    .where(eq(storiesTable.status, "draft"));

  const [totalIllust] = await db
    .select({ count: count() })
    .from(illustrationsTable);

  const genreRows = await db
    .select({ genre: storiesTable.genre, count: count() })
    .from(storiesTable)
    .groupBy(storiesTable.genre);

  res.json({
    totalStories: total?.count ?? 0,
    publishedStories: published?.count ?? 0,
    draftStories: drafts?.count ?? 0,
    totalIllustrations: totalIllust?.count ?? 0,
    genreBreakdown: genreRows.map((r) => ({ genre: r.genre, count: r.count })),
  });
});

router.get("/stories/:id", async (req, res): Promise<void> => {
  const params = GetStoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [story] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id));

  if (!story) {
    res.status(404).json({ error: "Story not found" });
    return;
  }

  // Hidden stories disappear from public detail too — only the original
  // author may still fetch their own hidden draft via ?requesterAuthorName.
  const [hiddenRow] = await db
    .select({ id: hiddenStoriesTable.storyId })
    .from(hiddenStoriesTable)
    .where(eq(hiddenStoriesTable.storyId, story.id))
    .limit(1);
  if (hiddenRow) {
    const requester =
      typeof req.query.requesterAuthorName === "string"
        ? req.query.requesterAuthorName.trim()
        : "";
    if (!requester || requester !== story.authorName) {
      res.status(404).json({ error: "Story not found" });
      return;
    }
  }

  const illustrations = await db
    .select()
    .from(illustrationsTable)
    .where(eq(illustrationsTable.storyId, story.id))
    .orderBy(illustrationsTable.sectionIndex);

  const counts = await singleCounts(story.id);
  res.json({ ...story, ...counts, illustrations });
});

router.patch("/stories/:id", async (req, res): Promise<void> => {
  const params = UpdateStoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateStoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Story not found" });
    return;
  }
  if (!canEditStory(existing, req.user ?? null)) {
    res.status(403).json({ error: "Only the author or a co-author may edit" });
    return;
  }

  // Defensively strip identity fields so a co-author cannot rewrite the
  // story's denormalized authorName via PATCH. (UpdateStoryBody no longer
  // declares authorName, but we keep this guard in case any client sends it.)
  const updates: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  delete updates.authorName;
  delete updates.userId;
  const [story] = await db
    .update(storiesTable)
    .set(updates)
    .where(eq(storiesTable.id, params.data.id))
    .returning();

  res.json(story);
});

router.delete("/stories/:id", async (req, res): Promise<void> => {
  const params = DeleteStoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Story not found" });
    return;
  }
  // Only the primary author (not co-authors) may delete.
  if (
    !req.user ||
    (existing.userId != null
      ? existing.userId !== req.user.id
      : req.user.handle !== existing.authorName) &&
      !req.user.isAdmin
  ) {
    res.status(403).json({ error: "Only the primary author may delete" });
    return;
  }

  await db.delete(storiesTable).where(eq(storiesTable.id, params.data.id));
  res.sendStatus(204);
});

router.post("/stories/:id/publish", async (req, res): Promise<void> => {
  const params = PublishStoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Story not found" });
    return;
  }
  if (!canEditStory(existing, req.user ?? null)) {
    res.status(403).json({ error: "Only the author or a co-author may publish" });
    return;
  }

  const [story] = await db
    .update(storiesTable)
    .set({ status: "published", updatedAt: new Date() })
    .where(eq(storiesTable.id, params.data.id))
    .returning();

  res.json(story);
});

router.get("/stories/:id/illustrations", async (req, res): Promise<void> => {
  const params = GetIllustrationsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const illustrations = await db
    .select()
    .from(illustrationsTable)
    .where(eq(illustrationsTable.storyId, params.data.id))
    .orderBy(illustrationsTable.sectionIndex);

  res.json(illustrations);
});

router.post("/stories/:id/illustrations", illustrationLimiter, async (req, res): Promise<void> => {
  const params = GenerateIllustrationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = GenerateIllustrationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [story] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id));

  if (!story) {
    res.status(404).json({ error: "Story not found" });
    return;
  }
  if (!canEditStory(story, req.user ?? null)) {
    res.status(403).json({ error: "Only the author or a co-author may add illustrations" });
    return;
  }

  const quota = await checkAndBumpIllustration(story.authorName);
  if (!quota.ok) {
    res.status(429).json({
      error: "Daily illustration quota reached",
      remaining: quota.remaining,
      limit: quota.limit,
    });
    return;
  }

  const prompt = buildIllustrationPrompt(
    parsed.data.sectionText,
    story.genre,
    story.artStyle,
    story.characters,
    story.summary,
  );

  req.log.info({ storyId: story.id }, "Generating illustration");
  const buffer = await generateImageBuffer(prompt, "1024x1024");
  const imageUrl = await uploadIllustrationBuffer(buffer);

  const [illustration] = await db
    .insert(illustrationsTable)
    .values({
      storyId: story.id,
      sectionIndex: parsed.data.sectionIndex,
      prompt,
      imageUrl,
      caption: parsed.data.caption ?? null,
    })
    .returning();

  res.status(201).json(illustration);
});

router.put("/stories/:id/illustrations/order", async (req, res): Promise<void> => {
  const params = ReorderIllustrationsParams.safeParse(req.params);
  const body = ReorderIllustrationsBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }
  const [story] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!story) {
    res.status(404).json({ error: "Story not found" });
    return;
  }
  if (!canEditStory(story, req.user ?? null)) {
    res.status(403).json({ error: "Only the author or a co-author may reorder" });
    return;
  }
  const ids = body.data.order;
  if (ids.length === 0) {
    res.json([]);
    return;
  }
  const existing = await db
    .select({ id: illustrationsTable.id })
    .from(illustrationsTable)
    .where(
      and(
        eq(illustrationsTable.storyId, story.id),
        inArray(illustrationsTable.id, ids),
      ),
    );
  if (existing.length !== ids.length) {
    res.status(400).json({ error: "Order list does not match story illustrations" });
    return;
  }

  await db.transaction(async (tx) => {
    // Two-phase update to dodge unique constraints if any are added later.
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(illustrationsTable)
        .set({ sectionIndex: -1 - i })
        .where(eq(illustrationsTable.id, ids[i]));
    }
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(illustrationsTable)
        .set({ sectionIndex: i })
        .where(eq(illustrationsTable.id, ids[i]));
    }
  });

  const updated = await db
    .select()
    .from(illustrationsTable)
    .where(eq(illustrationsTable.storyId, story.id))
    .orderBy(illustrationsTable.sectionIndex);
  res.json(updated);
});

router.delete(
  "/stories/:id/illustrations/:illustrationId",
  async (req, res): Promise<void> => {
    const params = DeleteIllustrationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [story] = await db
      .select()
      .from(storiesTable)
      .where(eq(storiesTable.id, params.data.id))
      .limit(1);
    if (!story) {
      res.status(404).json({ error: "Story not found" });
      return;
    }
    if (!canEditStory(story, req.user ?? null)) {
      res.status(403).json({ error: "Only the author or a co-author may delete illustrations" });
      return;
    }

    const [illustration] = await db
      .delete(illustrationsTable)
      .where(
        and(
          eq(illustrationsTable.id, params.data.illustrationId),
          eq(illustrationsTable.storyId, params.data.id),
        ),
      )
      .returning();

    if (!illustration) {
      res.status(404).json({ error: "Illustration not found" });
      return;
    }

    res.sendStatus(204);
  },
);

router.post(
  "/stories/:id/illustrations/:illustrationId/regenerate",
  illustrationLimiter,
  async (req, res): Promise<void> => {
    const params = RegenerateIllustrationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [existing] = await db
      .select()
      .from(illustrationsTable)
      .where(
        and(
          eq(illustrationsTable.id, params.data.illustrationId),
          eq(illustrationsTable.storyId, params.data.id),
        ),
      );

    if (!existing) {
      res.status(404).json({ error: "Illustration not found" });
      return;
    }

    const [story] = await db
      .select()
      .from(storiesTable)
      .where(eq(storiesTable.id, params.data.id));

    if (!story) {
      res.status(404).json({ error: "Story not found" });
      return;
    }
    if (!canEditStory(story, req.user ?? null)) {
      res.status(403).json({ error: "Only the author or a co-author may regenerate illustrations" });
      return;
    }

    req.log.info({ illustrationId: existing.id }, "Regenerating illustration");
    const bodyParsed = RegenerateIllustrationBody.safeParse(req.body ?? {});
    if (!bodyParsed.success) {
      res.status(400).json({ error: bodyParsed.error.message });
      return;
    }
    const promptOverride = bodyParsed.data.promptOverride;
    const finalPrompt = typeof promptOverride === "string" && promptOverride.trim()
      ? promptOverride.trim()
      : existing.prompt;
    const buffer = await generateImageBuffer(finalPrompt, "1024x1024");
    const newImageUrl = await uploadIllustrationBuffer(buffer);

    const [updated] = await db
      .update(illustrationsTable)
      .set({ imageUrl: newImageUrl, prompt: finalPrompt })
      .where(eq(illustrationsTable.id, existing.id))
      .returning();

    if (existing.sectionIndex === 0) {
      await db
        .update(storiesTable)
        .set({ coverImageUrl: newImageUrl })
        .where(eq(storiesTable.id, params.data.id));
    }

    res.json(updated);
  },
);

router.post("/stories/:id/regenerate", aiGenerationLimiter, async (req, res): Promise<void> => {
  const params = RegenerateStoryTextParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [story] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id));

  if (!story) {
    res.status(404).json({ error: "Story not found" });
    return;
  }
  if (!canEditStory(story, req.user ?? null)) {
    res.status(403).json({ error: "Only the author or a co-author may regenerate text" });
    return;
  }

  req.log.info({ storyId: story.id }, "Regenerating story text");
  const generated = await generateStoryText(
    story.genre,
    story.artStyle,
    story.lengthSetting,
    story.seedPrompt ?? undefined,
  );

  const [updated] = await db
    .update(storiesTable)
    .set({
      title: generated.title,
      fullText: generated.fullText,
      summary: generated.summary,
      characters: generated.characters,
      updatedAt: new Date(),
    })
    .where(eq(storiesTable.id, story.id))
    .returning();

  res.json(updated ?? story);
});

router.post(
  "/stories/:id/sections/:sectionIndex/regenerate",
  aiGenerationLimiter,
  async (req, res): Promise<void> => {
    const idParam = RegenerateStorySectionParams.safeParse(req.params);
    if (!idParam.success) {
      res.status(400).json({ error: idParam.error.message });
      return;
    }

    const sectionIndex = idParam.data.sectionIndex;

    const bodyParsed = RegenerateStorySectionBody.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: bodyParsed.error.message });
      return;
    }

    const [story] = await db
      .select()
      .from(storiesTable)
      .where(eq(storiesTable.id, idParam.data.id));

    if (!story) {
      res.status(404).json({ error: "Story not found" });
      return;
    }
    if (!canEditStory(story, req.user ?? null)) {
      res.status(403).json({ error: "Only the author or a co-author may regenerate sections" });
      return;
    }

    req.log.info({ storyId: story.id, sectionIndex }, "Regenerating section text");

    const sectionSystemPrompt = `You are a creative fiction writer continuing a ${story.genre} story in ${story.artStyle} style. Rewrite the given passage to be more vivid and compelling while keeping the same plot points.`;
    const sectionResponse = await openai.chat.completions.create({
      model: "gpt-5.1",
      max_completion_tokens: 1024,
      messages: [
        { role: "system", content: sectionSystemPrompt },
        {
          role: "user",
          content: `Rewrite this passage (return only the rewritten text, no JSON wrapper):\n\n${bodyParsed.data.currentSectionText}`,
        },
      ],
    });
    const rewrittenText = sectionResponse.choices[0]?.message?.content ?? bodyParsed.data.currentSectionText;

    const paragraphs = (story.fullText ?? "").split(/\n\n+/);
    const numSections = 4;
    const paragraphsPerSection = Math.max(1, Math.ceil(paragraphs.length / numSections));
    const startIdx = sectionIndex * paragraphsPerSection;
    const endIdx = Math.min(startIdx + paragraphsPerSection, paragraphs.length);
    const newParagraphs = [...paragraphs];
    const rewrittenParagraphs = rewrittenText.split(/\n\n+/);
    newParagraphs.splice(startIdx, endIdx - startIdx, ...rewrittenParagraphs);
    const newFullText = newParagraphs.join("\n\n");

    await db
      .update(storiesTable)
      .set({ fullText: newFullText, updatedAt: new Date() })
      .where(eq(storiesTable.id, story.id));

    const illustrationPrompt = buildIllustrationPrompt(
      rewrittenText,
      story.genre,
      story.artStyle,
      story.characters,
      story.summary,
    );
    const buffer = await generateImageBuffer(illustrationPrompt, "1024x1024");
    const newImageUrl = await uploadIllustrationBuffer(buffer);

    const existingIlls = await db
      .select()
      .from(illustrationsTable)
      .where(
        and(
          eq(illustrationsTable.storyId, story.id),
          eq(illustrationsTable.sectionIndex, sectionIndex),
        ),
      );

    let illustration;
    if (existingIlls[0]) {
      const [updated] = await db
        .update(illustrationsTable)
        .set({ imageUrl: newImageUrl, prompt: illustrationPrompt })
        .where(eq(illustrationsTable.id, existingIlls[0].id))
        .returning();
      illustration = updated;
    } else {
      const [inserted] = await db
        .insert(illustrationsTable)
        .values({
          storyId: story.id,
          sectionIndex,
          prompt: illustrationPrompt,
          imageUrl: newImageUrl,
          caption: null,
        })
        .returning();
      illustration = inserted;
    }

    if (sectionIndex === 0 && illustration) {
      await db
        .update(storiesTable)
        .set({ coverImageUrl: newImageUrl })
        .where(eq(storiesTable.id, story.id));
    }

    res.json({
      sectionIndex,
      rewrittenText,
      illustration: illustration ?? null,
    });
  },
);

// ---------- Continuation ----------

router.post(
  "/stories/:id/continue",
  aiGenerationLimiter,
  async (req, res): Promise<void> => {
    const params = ContinueStoryParams.safeParse(req.params);
    const body = ContinueStoryBody.safeParse(req.body ?? {});
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }
    const [story] = await db
      .select()
      .from(storiesTable)
      .where(eq(storiesTable.id, params.data.id))
      .limit(1);
    if (!story) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (!canEditStory(story, req.user ?? null)) {
      res.status(403).json({ error: "Only the author or a co-author may add chapters" });
      return;
    }

    const quota = await checkAndBumpStory(body.data.authorName);
    if (!quota.ok) {
      res.status(429).json({
        error: "Daily story quota reached",
        remaining: quota.remaining,
        limit: quota.limit,
      });
      return;
    }

    const previousChapter = (story.fullText ?? "").slice(-3000);
    const userPrompt = `You are continuing a ${story.genre} story titled "${story.title}".
Previously: ${previousChapter}

${body.data.seedPrompt ? `Hint for the next chapter: "${body.data.seedPrompt}".` : ""}

Write the NEXT chapter (~700 words). Keep characters, tone, and style consistent. Return JSON:
{ "chapterTitle": string, "chapterText": string, "newSection": string (1-2 sentence scene description for an illustration prompt) }`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.1",
      max_completion_tokens: 16000,
      messages: [
        { role: "system", content: `You are continuing an ongoing ${story.genre} story. Always respond in valid JSON.` },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      res.status(502).json({ error: "AI returned malformed JSON" });
      return;
    }
    const chapterTitle = typeof parsed.chapterTitle === "string" ? parsed.chapterTitle : "Next Chapter";
    const chapterText = typeof parsed.chapterText === "string" ? parsed.chapterText : "";
    const newSection = typeof parsed.newSection === "string" ? parsed.newSection : "";

    if (!chapterText) {
      res.status(502).json({ error: "AI returned empty chapter" });
      return;
    }

    const appended = `${story.fullText ?? ""}\n\n## ${chapterTitle}\n\n${chapterText}`;

    const [updated] = await db
      .update(storiesTable)
      .set({ fullText: appended, updatedAt: new Date() })
      .where(eq(storiesTable.id, story.id))
      .returning();

    // Notify the primary author if a co-author wrote this chapter
    if (story.authorName && story.authorName !== body.data.authorName) {
      try {
        await db.insert(notificationsTable).values({
          recipientName: story.authorName,
          type: "co_author_chapter",
          actorName: body.data.authorName,
          storyId: story.id,
          payload: { storyTitle: story.title, chapterTitle },
        });
        notifyRecipient(story.authorName);
      } catch (err) {
        logger.warn({ err }, "failed to insert co-author chapter notification");
      }
    }

    if (body.data.generateIllustration !== false && newSection) {
      try {
        const [{ value: existingCount }] = await db
          .select({ value: count() })
          .from(illustrationsTable)
          .where(eq(illustrationsTable.storyId, story.id));
        const sectionIndex = existingCount;
        const prompt = buildIllustrationPrompt(
          newSection,
          story.genre,
          story.artStyle,
          story.characters,
          story.summary,
        );
        const buffer = await generateImageBuffer(prompt, "1024x1024");
        const imageUrl = await uploadIllustrationBuffer(buffer);
        await db.insert(illustrationsTable).values({
          storyId: story.id,
          sectionIndex,
          prompt,
          imageUrl,
          caption: chapterTitle,
        });
      } catch (err) {
        req.log.error({ err }, "Failed to generate continuation illustration");
      }
    }

    res.json(updated);
  },
);

// ---------- TTS ----------

router.get("/stories/:id/audio", aiGenerationLimiter, async (req, res): Promise<void> => {
  const params = GetStoryAudioParams.safeParse(req.params);
  const query = GetStoryAudioQueryParams.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }
  const [story] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!story || !story.fullText) {
    res.status(404).json({ error: "Story has no text" });
    return;
  }

  const voice = query.data.voice ?? "nova";
  const text = story.fullText.slice(0, 4000);

  const response = await openai.audio.speech.create({
    model: "tts-1",
    voice,
    input: text,
    response_format: "mp3",
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("Content-Length", buffer.length.toString());
  res.send(buffer);
});

// ---------- PDF Export ----------

router.get("/stories/:id/export.pdf", writeLimiter, async (req, res): Promise<void> => {
  const params = ExportStoryPdfParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }
  const [story] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!story) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const illustrations = await db
    .select()
    .from(illustrationsTable)
    .where(eq(illustrationsTable.storyId, story.id))
    .orderBy(illustrationsTable.sectionIndex);

  const doc = new PDFDocument({ size: "A4", margin: 60, info: { Title: story.title, Author: story.authorName } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${story.title.replace(/[^a-z0-9]/gi, "_").slice(0, 60) || "story"}.pdf"`,
  );
  doc.pipe(res);

  async function decodeImage(url: string): Promise<Buffer | null> {
    const m = url.match(/^data:image\/[^;]+;base64,(.+)$/);
    if (m) {
      try { return Buffer.from(m[1], "base64"); } catch { return null; }
    }
    if (url.startsWith("/api/storage/objects/")) {
      try {
        const dir = process.env.PRIVATE_OBJECT_DIR;
        if (!dir) return null;
        const entityId = url.slice("/api/storage/objects/".length);
        const fullPath = `${dir.replace(/\/$/, "")}/${entityId}`;
        const parts = fullPath.replace(/^\//, "").split("/");
        const bucketName = parts[0]!;
        const objectName = parts.slice(1).join("/");
        const { objectStorageClient } = await import("../lib/objectStorage");
        const file = objectStorageClient.bucket(bucketName).file(objectName);
        const [buf] = await file.download();
        return buf;
      } catch {
        return null;
      }
    }
    return null;
  }

  // Cover
  const coverBuf = story.coverImageUrl ? await decodeImage(story.coverImageUrl) : null;
  if (coverBuf) {
    try {
      doc.image(coverBuf, { fit: [475, 500], align: "center" });
    } catch {
      /* ignore */
    }
    doc.moveDown(2);
  }
  doc.font("Times-Bold").fontSize(28).text(story.title, { align: "center" });
  doc.moveDown(0.5);
  doc.font("Times-Italic").fontSize(14).text(`by ${story.authorName}`, { align: "center" });
  doc.moveDown(0.5);
  doc.font("Times-Roman").fontSize(11).fillColor("#666").text(`${story.genre} · ${story.lengthSetting}`, { align: "center" });
  doc.fillColor("black");

  if (story.summary) {
    doc.addPage();
    doc.font("Times-Bold").fontSize(16).text("Summary");
    doc.moveDown(0.5);
    doc.font("Times-Italic").fontSize(12).text(story.summary, { align: "justify" });
  }

  doc.addPage();
  const chapters = (story.fullText ?? "").split(/\n\n## /);
  let illIdx = 0;
  for (let i = 0; i < chapters.length; i++) {
    const chunk = chapters[i];
    if (i > 0) {
      const newlinePos = chunk.indexOf("\n");
      const heading = newlinePos > 0 ? chunk.slice(0, newlinePos) : `Chapter ${i + 1}`;
      const body = newlinePos > 0 ? chunk.slice(newlinePos + 1) : "";
      doc.moveDown(1);
      doc.font("Times-Bold").fontSize(18).text(heading);
      doc.moveDown(0.5);
      doc.font("Times-Roman").fontSize(12).text(body, { align: "justify" });
    } else {
      doc.font("Times-Roman").fontSize(12).text(chunk, { align: "justify" });
    }
    if (illIdx < illustrations.length) {
      const ill = illustrations[illIdx++];
      const buf = await decodeImage(ill.imageUrl);
      if (buf) {
        doc.moveDown(1);
        try {
          doc.image(buf, { fit: [400, 300], align: "center" });
          if (ill.caption) {
            doc.moveDown(0.3);
            doc.font("Times-Italic").fontSize(10).fillColor("#555").text(ill.caption, { align: "center" });
            doc.fillColor("black");
          }
        } catch {
          /* ignore image errors */
        }
        doc.moveDown(1);
      }
    }
  }

  doc.end();
});

async function getLikeInfo(storyId: number, authorName?: string | null) {
  const [{ value: likeCount }] = await db
    .select({ value: count() })
    .from(storyLikesTable)
    .where(eq(storyLikesTable.storyId, storyId));

  let hasLiked = false;
  if (authorName && authorName.trim()) {
    const [row] = await db
      .select({ id: storyLikesTable.id })
      .from(storyLikesTable)
      .where(
        and(
          eq(storyLikesTable.storyId, storyId),
          eq(storyLikesTable.authorName, authorName.trim()),
        ),
      )
      .limit(1);
    hasLiked = !!row;
  }
  return { storyId, likeCount, hasLiked };
}

router.get("/stories/:id/like", async (req, res): Promise<void> => {
  const params = GetStoryLikeParams.safeParse(req.params);
  const query = GetStoryLikeQueryParams.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }
  const info = await getLikeInfo(params.data.id, query.data.authorName);
  res.json(info);
});

router.post("/stories/:id/like", writeLimiter, async (req, res): Promise<void> => {
  const params = LikeStoryParams.safeParse(req.params);
  const body = LikeStoryBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }
  const authorName = body.data.authorName.trim();
  if (!authorName) {
    res.status(400).json({ error: "authorName required" });
    return;
  }

  const [story] = await db
    .select({ id: storiesTable.id })
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!story) {
    res.status(404).json({ error: "Story not found" });
    return;
  }

  const insertedLikes = await db
    .insert(storyLikesTable)
    .values({ storyId: params.data.id, authorName, userId: req.user?.id ?? null })
    .onConflictDoNothing()
    .returning({ id: storyLikesTable.id });

  if (insertedLikes.length > 0) {
    const [storyMeta] = await db
      .select({ authorName: storiesTable.authorName, title: storiesTable.title })
      .from(storiesTable)
      .where(eq(storiesTable.id, params.data.id))
      .limit(1);
    if (storyMeta && storyMeta.authorName && storyMeta.authorName !== authorName) {
      try {
        await db.insert(notificationsTable).values({
          recipientName: storyMeta.authorName,
          type: "like",
          actorName: authorName,
          storyId: params.data.id,
          payload: { storyTitle: storyMeta.title },
        });
        notifyRecipient(storyMeta.authorName);
      } catch (err) {
        logger.warn({ err }, "failed to insert like notification");
      }
    }
  }

  const info = await getLikeInfo(params.data.id, authorName);
  res.json(info);
});

router.delete("/stories/:id/like", writeLimiter, async (req, res): Promise<void> => {
  const params = UnlikeStoryParams.safeParse(req.params);
  const query = UnlikeStoryQueryParams.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }
  const authorName = query.data.authorName.trim();
  if (!authorName) {
    res.status(400).json({ error: "authorName required" });
    return;
  }
  const ownership = req.user
    ? or(
        eq(storyLikesTable.userId, req.user.id),
        and(
          isNull(storyLikesTable.userId),
          eq(storyLikesTable.authorName, req.user.handle),
        ),
      )
    : eq(storyLikesTable.authorName, authorName);
  await db
    .delete(storyLikesTable)
    .where(
      and(eq(storyLikesTable.storyId, params.data.id), ownership!),
    );
  const info = await getLikeInfo(params.data.id, authorName);
  res.json(info);
});

// ---------- Co-authors ----------

router.get("/stories/:id/co-authors", async (req, res): Promise<void> => {
  const params = ListCoAuthorsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [story] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!story) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({
    storyId: story.id,
    primaryAuthor: story.authorName,
    coAuthors: story.coAuthors ?? [],
  });
});

router.post("/stories/:id/co-authors", writeLimiter, async (req, res): Promise<void> => {
  const params = AddCoAuthorParams.safeParse(req.params);
  const body = AddCoAuthorBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [story] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!story) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (
    !req.user ||
    (story.userId != null
      ? story.userId !== req.user.id
      : req.user.handle !== story.authorName)
  ) {
    res.status(403).json({ error: "Only the primary author can manage co-authors" });
    return;
  }
  const newName = body.data.coAuthorName.trim();
  if (!newName || newName === story.authorName) {
    res.status(400).json({ error: "Invalid co-author name" });
    return;
  }
  const current = story.coAuthors ?? [];
  const next = current.includes(newName) ? current : [...current, newName];
  const [updated] = await db
    .update(storiesTable)
    .set({ coAuthors: next, updatedAt: new Date() })
    .where(eq(storiesTable.id, story.id))
    .returning();
  res.json({
    storyId: updated.id,
    primaryAuthor: updated.authorName,
    coAuthors: updated.coAuthors ?? [],
  });
});

router.post("/stories/:id/co-authors/remove", writeLimiter, async (req, res): Promise<void> => {
  const params = RemoveCoAuthorParams.safeParse(req.params);
  const body = RemoveCoAuthorBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [story] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!story) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (
    !req.user ||
    (story.userId != null
      ? story.userId !== req.user.id
      : req.user.handle !== story.authorName)
  ) {
    res.status(403).json({ error: "Only the primary author can manage co-authors" });
    return;
  }
  const target = body.data.coAuthorName.trim();
  const next = (story.coAuthors ?? []).filter((n) => n !== target);
  const [updated] = await db
    .update(storiesTable)
    .set({ coAuthors: next, updatedAt: new Date() })
    .where(eq(storiesTable.id, story.id))
    .returning();
  res.json({
    storyId: updated.id,
    primaryAuthor: updated.authorName,
    coAuthors: updated.coAuthors ?? [],
  });
});

// ---------- Comments ----------

router.get("/stories/:id/comments", async (req, res): Promise<void> => {
  const params = GetStoryCommentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [story] = await db
    .select({ id: storiesTable.id })
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!story) {
    res.status(404).json({ error: "Story not found" });
    return;
  }
  const comments = await db
    .select()
    .from(storyCommentsTable)
    .where(eq(storyCommentsTable.storyId, params.data.id))
    .orderBy(desc(storyCommentsTable.createdAt));
  res.json(comments);
});

router.post(
  "/stories/:id/comments",
  writeLimiter,
  async (req, res): Promise<void> => {
    const params = AddStoryCommentParams.safeParse(req.params);
    const body = AddStoryCommentBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }
    const authorName = body.data.authorName.trim();
    const text = body.data.body.trim();
    if (!authorName || !text) {
      res.status(400).json({ error: "authorName and body required" });
      return;
    }
    const [story] = await db
      .select({
        id: storiesTable.id,
        authorName: storiesTable.authorName,
        title: storiesTable.title,
      })
      .from(storiesTable)
      .where(eq(storiesTable.id, params.data.id))
      .limit(1);
    if (!story) {
      res.status(404).json({ error: "Story not found" });
      return;
    }
    let parentId: number | null = null;
    if (typeof body.data.parentId === "number") {
      const [parent] = await db
        .select({
          id: storyCommentsTable.id,
          storyId: storyCommentsTable.storyId,
          parentId: storyCommentsTable.parentId,
        })
        .from(storyCommentsTable)
        .where(eq(storyCommentsTable.id, body.data.parentId))
        .limit(1);
      if (parent && parent.storyId === params.data.id) {
        // Enforce single-level threading: replies always attach to the
        // top-level root, not to other replies.
        parentId = parent.parentId ?? parent.id;
      }
    }
    const [comment] = await db
      .insert(storyCommentsTable)
      .values({ storyId: params.data.id, authorName, body: text, parentId, userId: req.user?.id ?? null })
      .returning();

    if (story.authorName && story.authorName !== authorName) {
      try {
        await db.insert(notificationsTable).values({
          recipientName: story.authorName,
          type: "comment",
          actorName: authorName,
          storyId: story.id,
          payload: { storyTitle: story.title, preview: text.slice(0, 140) },
        });
        notifyRecipient(story.authorName);
      } catch (err) {
        logger.warn({ err }, "failed to insert comment notification");
      }
    }
    res.status(201).json(comment);
  },
);

router.delete(
  "/stories/:id/comments/:commentId",
  writeLimiter,
  async (req, res): Promise<void> => {
    const params = DeleteStoryCommentParams.safeParse(req.params);
    const query = DeleteStoryCommentQueryParams.safeParse(req.query);
    if (!params.success || !query.success) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }
    const authorName = query.data.authorName.trim();
    if (!authorName) {
      res.status(400).json({ error: "authorName required" });
      return;
    }
    const [existing] = await db
      .select()
      .from(storyCommentsTable)
      .where(
        and(
          eq(storyCommentsTable.id, params.data.commentId),
          eq(storyCommentsTable.storyId, params.data.id),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }
    const owns = req.user
      ? existing.userId != null
        ? existing.userId === req.user.id
        : existing.authorName === req.user.handle
      : existing.authorName === authorName;
    if (!owns && !req.user?.isAdmin) {
      res.status(403).json({ error: "Only the comment's author may delete it" });
      return;
    }
    await db.delete(storyCommentsTable).where(eq(storyCommentsTable.id, existing.id));
    res.sendStatus(204);
  },
);

export default router;
