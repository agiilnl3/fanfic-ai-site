import { Router, type IRouter } from "express";
import { eq, desc, count, and, sql, inArray, notInArray, gte } from "drizzle-orm";
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
  usersTable,
  storyCollaboratorsTable,
  chapterAuthorsTable,
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
  ListCollaboratorsParams,
  InviteCollaboratorParams,
  InviteCollaboratorBody,
  RespondCollaboratorInviteParams,
  RespondCollaboratorInviteBody,
  RevokeCollaboratorParams,
  ListStoryChaptersParams,
} from "@workspace/api-zod";
import { checkAndBumpStory, checkAndBumpIllustration } from "../lib/usage";
import { notifyRecipient } from "../lib/notification-bus";
import { openai } from "@workspace/integrations-openai-ai-server";
import { generateImageBuffer } from "@workspace/integrations-openai-ai-server/image";
import { uploadIllustrationBuffer } from "../lib/uploadIllustration";
import { canEditStory } from "../lib/storyAuthz";
import { backfillStoryToChapters, lockStoryChapters } from "../lib/chapters";
import { chaptersTable } from "@workspace/db";
import PDFDocument from "pdfkit";
import { logger } from "../lib/logger";
import { buildIllustrationPrompt } from "../lib/prompt";
import {
  loadStoryCharacters,
  toCharacterRefs,
  generateIllustrationForCharacters,
  filterCharactersInSection,
} from "../lib/characterContext";
import {
  aiGenerationLimiter,
  illustrationLimiter,
  writeLimiter,
} from "../middlewares/rate-limit";
import { embedStoryInBackground, toVectorLiteral } from "../lib/embeddings";
import { getUserPlan } from "../lib/subscriptions";
import { generatePosterCoverInBackground } from "../lib/posterCover";
import { synthesizeStoryNarration } from "../lib/ttsCache";
import {
  startTrailerJobInBackground,
  isTrailerJobInFlight,
  type TrailerStatus,
} from "../lib/trailer";
import {
  loadOgInputForStory,
  ogContentHash,
  renderOgImage,
} from "../lib/ogImage";
import { pool } from "@workspace/db";

const router: IRouter = Router();

// Free-tier users are quietly downgraded to the cheaper model. The create
// page also hides the gpt-5.1 option for free users; this is the
// authoritative server-side guard.
const PREMIUM_MODELS = new Set(["gpt-5.1"]);
function gateModelForPlan(
  model: string,
  plan: "free" | "conjurer",
): string {
  if (plan === "conjurer") return model;
  return PREMIUM_MODELS.has(model) ? "gpt-5-mini" : model;
}

/**
 * Returns true when the requester may read this story. Public (non-private)
 * rows are always readable; private rows only by the author / co-author.
 * Use from any /stories/:id/* read endpoint.
 */
function canReadStory(
  story: {
    isPrivate?: boolean | null;
    userId: number | null;
    authorName: string;
    coAuthors?: string[] | null;
  },
  user: { id: number; handle: string } | null | undefined,
): boolean {
  if (!story.isPrivate) return true;
  return canEditStory(
    { authorName: story.authorName, coAuthors: story.coAuthors ?? [], userId: story.userId },
    user ?? null,
  );
}

/**
 * Filter a story list down to rows the requester is allowed to see. Public
 * (non-private) rows are always visible; private rows only to the owner /
 * co-author.
 */
function filterVisibleStories<
  T extends {
    isPrivate?: boolean | null;
    userId: number | null;
    authorName: string;
    coAuthors?: string[] | null;
  },
>(rows: T[], user: { id: number; handle: string } | null | undefined): T[] {
  return rows.filter((s) => {
    if (!s.isPrivate) return true;
    return canEditStory(
      { authorName: s.authorName, coAuthors: s.coAuthors ?? [], userId: s.userId },
      user ?? null,
    );
  });
}

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

  // Hide private stories from anyone but their author/co-authors.
  const visible = filterVisibleStories(stories, req.user);
  res.json(await attachCounts(visible));
});

router.post("/stories", writeLimiter, async (req, res): Promise<void> => {
  const parsed = CreateStoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Privacy is a Conjurer perk; silently coerce to public for free users
  // so a stale client cannot bypass the upsell.
  let isPrivate = parsed.data.isPrivate ?? false;
  if (isPrivate && req.user) {
    const plan = await getUserPlan(req.user.id);
    if (plan !== "conjurer") isPrivate = false;
  } else if (isPrivate && !req.user) {
    isPrivate = false;
  }

  const [story] = await db
    .insert(storiesTable)
    .values({
      ...parsed.data,
      isPrivate,
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

  // Resolve plan once; gates both privacy and model selection.
  const plan = req.user ? await getUserPlan(req.user.id) : "free";
  const effectiveModel = gateModelForPlan(model ?? "gpt-5.1", plan);
  const isPrivate = plan === "conjurer" ? parsed.data.isPrivate ?? false : false;

  const quota = await checkAndBumpStory(authorName, req.user?.id ?? null);
  if (!quota.ok) {
    res.status(429).json({
      error: "Daily story quota reached",
      remaining: quota.remaining,
      limit: quota.limit,
    });
    return;
  }

  req.log.info(
    { genre, artStyle, lengthSetting, model: effectiveModel, plan, isPrivate },
    "Generating story with AI",
  );

  const generated = await generateStoryText(
    genre,
    artStyle,
    lengthSetting,
    seedPrompt,
    effectiveModel,
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
      isPrivate,
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

  // Dedicated 16:9 poster cover with title typography baked in. Best-effort.
  generatePosterCoverInBackground(story.id);

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

// Server-Sent Events streaming variant of /stories/generate.
// Emits: meta, token, section, illustration, done, error.
// Persists incrementally so a refresh resumes mid-generation.
// Cancel: closing the request aborts the OpenAI stream and marks the
// row as `cancelled`.
router.post(
  "/stories/generate/stream",
  aiGenerationLimiter,
  async (req, res): Promise<void> => {
    const parsed = GenerateStoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const {
      genre,
      artStyle,
      lengthSetting,
      seedPrompt,
      authorName,
      generateIllustrations,
      model,
    } = parsed.data;

    const plan = req.user ? await getUserPlan(req.user.id) : "free";
    const effectiveModel = gateModelForPlan(model ?? "gpt-5.1", plan);
    const isPrivate = plan === "conjurer" ? parsed.data.isPrivate ?? false : false;

    const quota = await checkAndBumpStory(authorName, req.user?.id ?? null);
    if (!quota.ok) {
      res.status(429).json({
        error: "Daily story quota reached",
        remaining: quota.remaining,
        limit: quota.limit,
      });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Disable proxy buffering (nginx-style) so events flush immediately.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const send = (event: string, data: unknown): void => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const abort = new AbortController();
    let cancelled = false;
    req.on("close", () => {
      if (!res.writableEnded) {
        cancelled = true;
        abort.abort();
      }
    });

    const wordTarget =
      lengthSetting === "short"
        ? 600
        : lengthSetting === "long"
          ? 2500
          : 1400;
    const maxTokens =
      lengthSetting === "short"
        ? 16000
        : lengthSetting === "long"
          ? 65536
          : 32000;

    // Insert the story shell first so a refresh can resume / link to it.
    const [story] = await db
      .insert(storiesTable)
      .values({
        title: "Untitled Story",
        genre,
        artStyle,
        lengthSetting,
        seedPrompt: seedPrompt ?? null,
        fullText: "",
        summary: "",
        characters: "",
        authorName,
        userId: req.user?.id ?? null,
        status: "draft",
        isPrivate,
      })
      .returning();

    send("meta", { storyId: story.id, title: story.title });

    let fullText = "";
    try {
      const sysPrompt = `You are a creative fiction writer. Write an engaging, coherent ${genre} story with vivid descriptions, compelling characters, and clear paragraph breaks (blank line between paragraphs). Target approximately ${wordTarget} words. Output the story body only — no JSON, no headings, no preface.`;
      const userPrompt = seedPrompt
        ? `Write a ${genre} fanfiction story (~${wordTarget} words). Seed idea: "${seedPrompt}".`
        : `Write an original ${genre} fiction story (~${wordTarget} words) with memorable characters and a satisfying arc.`;

      const stream = await openai.chat.completions.create(
        {
          model: effectiveModel,
          max_completion_tokens: maxTokens,
          stream: true,
          messages: [
            { role: "system", content: sysPrompt },
            { role: "user", content: userPrompt },
          ],
        },
        { signal: abort.signal },
      );

      let lastPersistedLen = 0;
      const PERSIST_EVERY = 400;

      for await (const chunk of stream) {
        if (cancelled) break;
        const tok = chunk.choices[0]?.delta?.content ?? "";
        if (!tok) continue;
        fullText += tok;
        send("token", { text: tok });
        if (fullText.length - lastPersistedLen >= PERSIST_EVERY) {
          lastPersistedLen = fullText.length;
          try {
            await db
              .update(storiesTable)
              .set({ fullText })
              .where(eq(storiesTable.id, story.id));
          } catch (err) {
            req.log.warn({ err }, "incremental persist failed");
          }
        }
      }

      if (cancelled) {
        await db
          .update(storiesTable)
          .set({ fullText, status: "cancelled" })
          .where(eq(storiesTable.id, story.id));
        if (!res.writableEnded) res.end();
        return;
      }

      // Final flush of the body.
      await db
        .update(storiesTable)
        .set({ fullText })
        .where(eq(storiesTable.id, story.id));

      send("section", { phase: "metadata" });

      // Second small JSON call for title/summary/characters/section prompts.
      const metaResp = await openai.chat.completions.create(
        {
          model: "gpt-5-mini",
          max_completion_tokens: 2000,
          messages: [
            {
              role: "system",
              content: `You return concise JSON metadata describing a ${genre} story written in the user message.`,
            },
            {
              role: "user",
              content: `Story:\n\n${fullText.slice(0, 8000)}\n\nReturn JSON: { "title": string, "summary": string (2-3 sentences), "characters": string (max 200 chars), "sections": string[] (3-4 brief 1-sentence scene descriptions for illustration prompts — do NOT repeat the story text) }`,
            },
          ],
          response_format: { type: "json_object" },
        },
        { signal: abort.signal },
      );

      const metaRaw = metaResp.choices[0]?.message?.content ?? "{}";
      let metaParsed: Record<string, unknown> = {};
      try {
        metaParsed = JSON.parse(metaRaw) as Record<string, unknown>;
      } catch {
        /* leave empty */
      }
      const title =
        typeof metaParsed.title === "string" && metaParsed.title.trim()
          ? metaParsed.title
          : "Untitled Story";
      const summary =
        typeof metaParsed.summary === "string" ? metaParsed.summary : "";
      const characters =
        typeof metaParsed.characters === "string" ? metaParsed.characters : "";
      const sections = Array.isArray(metaParsed.sections)
        ? (metaParsed.sections as unknown[])
            .filter((s): s is string => typeof s === "string")
            .slice(0, 4)
        : [];

      await db
        .update(storiesTable)
        .set({ title, summary, characters })
        .where(eq(storiesTable.id, story.id));

      send("section", {
        phase: "metadataDone",
        title,
        summary,
      });

      if (
        generateIllustrations !== false &&
        sections.length > 0 &&
        !cancelled
      ) {
        const total = sections.length;
        send("section", { phase: "illustrations", total });

        const results = await Promise.allSettled(
          sections.map(async (section, idx) => {
            if (cancelled) throw new Error("cancelled");
            const prompt = buildIllustrationPrompt(
              section,
              genre,
              artStyle,
              characters,
              summary,
            );
            const buffer = await generateImageBuffer(prompt, "1024x1024");
            if (cancelled) throw new Error("cancelled");
            const imageUrl = await uploadIllustrationBuffer(buffer);
            const [ill] = await db
              .insert(illustrationsTable)
              .values({
                storyId: story.id,
                sectionIndex: idx,
                prompt,
                imageUrl,
                caption: null,
              })
              .returning();
            if (idx === 0) {
              await db
                .update(storiesTable)
                .set({ coverImageUrl: imageUrl })
                .where(eq(storiesTable.id, story.id));
            }
            send("illustration", {
              index: idx,
              total,
              illustration: ill,
            });
            return idx;
          }),
        );
        const failed = results
          .map((r, i) => (r.status === "rejected" ? i : -1))
          .filter((i) => i >= 0);
        if (failed.length > 0) {
          req.log.warn({ failed }, "Some illustrations failed during stream");
          send("section", { phase: "illustrationsPartial", failed });
        }
      }

      if (cancelled) {
        await db
          .update(storiesTable)
          .set({ status: "cancelled" })
          .where(eq(storiesTable.id, story.id));
        if (!res.writableEnded) res.end();
        return;
      }

      // Best-effort dedicated poster cover (kicked off after everything
      // else so it doesn't block the SSE close).
      generatePosterCoverInBackground(story.id);

      send("done", { storyId: story.id });
      if (!res.writableEnded) res.end();
    } catch (err) {
      req.log.error({ err }, "SSE story generation failed");
      if (cancelled || (err instanceof Error && err.name === "AbortError")) {
        try {
          await db
            .update(storiesTable)
            .set({ fullText, status: "cancelled" })
            .where(eq(storiesTable.id, story.id));
        } catch {
          /* ignore */
        }
      } else {
        send("error", {
          message: err instanceof Error ? err.message : "Generation failed",
          storyId: story.id,
        });
      }
      if (!res.writableEnded) res.end();
    }
  },
);

// ---------- Personalized "For you" feed (pgvector centroid ranking) ----------
//
// Personalized feed: averages the embeddings of recently liked /
// read-past-50% stories into a centroid, then ranks published stories
// by cosine distance. Falls back to engagement-trending (and finally
// newest) when the viewer has no signal or embeddings are unavailable.
router.get("/feed/for-you", async (req, res): Promise<void> => {
  // Personalization is bound to the signed-in handle only — we
  // ignore any client-supplied viewer hint so anonymous callers
  // can't probe another user's like / read history.
  const viewer = req.user?.handle?.trim() || undefined;
  const limit = Math.max(
    1,
    Math.min(50, Number(req.query.limit) || 20),
  );

  // Apply the same moderation list as /stories/feed.
  const hiddenRows = await db
    .select({ id: hiddenStoriesTable.storyId })
    .from(hiddenStoriesTable);
  const hiddenIds = new Set<number>(hiddenRows.map((h) => h.id));

  const fallback = async (): Promise<void> => {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [likeRows, viewRows] = await Promise.all([
      db
        .select({ storyId: storyLikesTable.storyId, c: count() })
        .from(storyLikesTable)
        .where(gte(storyLikesTable.createdAt, since))
        .groupBy(storyLikesTable.storyId),
      db
        .select({ storyId: storyViewsTable.storyId, c: count() })
        .from(storyViewsTable)
        .where(gte(storyViewsTable.createdAt, since))
        .groupBy(storyViewsTable.storyId),
    ]);
    const score = new Map<number, number>();
    for (const r of likeRows)
      score.set(r.storyId, (score.get(r.storyId) ?? 0) + Number(r.c) * 3);
    for (const r of viewRows)
      score.set(r.storyId, (score.get(r.storyId) ?? 0) + Number(r.c));
    for (const id of hiddenIds) score.delete(id);
    const ids = Array.from(score.keys());
    if (ids.length === 0) {
      // Cold start: surface newest published stories.
      const newestConds = [and(eq(storiesTable.status, "published"), eq(storiesTable.isPrivate, false))];
      if (hiddenIds.size > 0) {
        newestConds.push(notInArray(storiesTable.id, Array.from(hiddenIds)));
      }
      const newest = await db
        .select()
        .from(storiesTable)
        .where(and(...newestConds))
        .orderBy(desc(storiesTable.createdAt))
        .limit(limit);
      res.json(await decorateForViewer(await attachCounts(newest), viewer));
      return;
    }
    const stories = await db
      .select()
      .from(storiesTable)
      .where(
        and(
          and(eq(storiesTable.status, "published"), eq(storiesTable.isPrivate, false)),
          inArray(storiesTable.id, ids),
        ),
      );
    const ranked = stories
      .map((s) => ({ s, score: score.get(s.id) ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.s);
    res.json(
      await decorateForViewer(await attachCounts(ranked), viewer),
    );
  };

  if (!viewer) {
    await fallback();
    return;
  }

  // Pull the viewer's recent positive signals: up to 30 most recent
  // likes plus stories they read past 50 %. We dedupe in SQL via
  // UNION before joining to story_embeddings so we never average the
  // same story twice (which would over-weight the genre).
  const seedIds: number[] = [];
  const liked = await db
    .select({ storyId: storyLikesTable.storyId })
    .from(storyLikesTable)
    .where(eq(storyLikesTable.authorName, viewer))
    .orderBy(desc(storyLikesTable.createdAt))
    .limit(30);
  for (const l of liked) seedIds.push(l.storyId);
  const read = await db
    .select({ storyId: readingProgressTable.storyId })
    .from(readingProgressTable)
    .where(
      and(
        eq(readingProgressTable.authorName, viewer),
        gte(readingProgressTable.progress, 50),
      ),
    )
    .orderBy(desc(readingProgressTable.updatedAt))
    .limit(30);
  for (const r of read) {
    if (!seedIds.includes(r.storyId)) seedIds.push(r.storyId);
  }

  if (seedIds.length === 0) {
    await fallback();
    return;
  }

  // Compute the centroid in-database so we don't pay for hauling
  // 1536-float vectors over the wire just to average them. The CTE
  // returns a single vector. AVG() over pgvector returns a vector.
  let centroidLit: string;
  try {
    const { rows } = await pool.query<{ centroid: string }>(
      `SELECT AVG(embedding)::text AS centroid
         FROM story_embeddings
        WHERE story_id = ANY($1::int[])`,
      [seedIds],
    );
    if (!rows[0]?.centroid) {
      // No embeddings yet for any of the viewer's seeds (likely a
      // brand-new install before backfill ran). Trending is a sane
      // stand-in.
      await fallback();
      return;
    }
    centroidLit = rows[0].centroid;
  } catch (err) {
    req.log.warn({ err }, "for-you centroid failed; using fallback");
    await fallback();
    return;
  }

  // Skip already-engaged + moderated stories.
  const exclude = new Set<number>(seedIds);
  for (const id of hiddenIds) exclude.add(id);

  let nearest: { id: number }[];
  try {
    const excludeArr = Array.from(exclude);
    const result = await pool.query<{ id: number }>(
      `SELECT s.id
         FROM stories s
         JOIN story_embeddings e ON e.story_id = s.id
        WHERE s.status = 'published'
          AND ($2::int[] = '{}'::int[] OR NOT (s.id = ANY($2::int[])))
        ORDER BY e.embedding <=> $1::vector
        LIMIT $3`,
      [centroidLit, excludeArr, limit],
    );
    nearest = result.rows;
  } catch (err) {
    req.log.warn({ err }, "for-you nearest-neighbour failed");
    await fallback();
    return;
  }

  if (nearest.length === 0) {
    await fallback();
    return;
  }

  const nearestIds = nearest.map((r) => r.id);
  const stories = await db
    .select()
    .from(storiesTable)
    .where(inArray(storiesTable.id, nearestIds));
  // Preserve nearest-neighbour ordering — Postgres returned them in
  // similarity order; the WHERE-IN reshuffles them, so we re-sort.
  const order = new Map(nearestIds.map((id, i) => [id, i]));
  stories.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const counted = await attachCounts(stories);
  res.json(await decorateForViewer(counted, viewer));
});

// Faceted counts (genre / artStyle / tag) for the current text query.
router.get("/stories/feed/facets", async (req, res): Promise<void> => {
  const q = (req.query.q as string | undefined)?.trim();
  const baseConds = [and(eq(storiesTable.status, "published"), eq(storiesTable.isPrivate, false))];
  if (q) {
    baseConds.push(
      sql`(stories.tsv @@ websearch_to_tsquery('english', ${q})
           OR ${storiesTable.title} ILIKE ${`%${q}%`})`,
    );
  }
  // Match the public feed: counts must not include moderated stories.
  const hidden = await db
    .select({ id: hiddenStoriesTable.storyId })
    .from(hiddenStoriesTable);
  if (hidden.length > 0) {
    baseConds.push(notInArray(storiesTable.id, hidden.map((h) => h.id)));
  }
  const [genreRows, artStyleRows, tagRows] = await Promise.all([
    db
      .select({ value: storiesTable.genre, c: count() })
      .from(storiesTable)
      .where(and(...baseConds))
      .groupBy(storiesTable.genre)
      .orderBy(desc(count()))
      .limit(20),
    db
      .select({ value: storiesTable.artStyle, c: count() })
      .from(storiesTable)
      .where(and(...baseConds))
      .groupBy(storiesTable.artStyle)
      .orderBy(desc(count()))
      .limit(20),
    db
      .select({
        value: tagsTable.slug,
        label: tagsTable.label,
        c: count(),
      })
      .from(storyTagsTable)
      .innerJoin(tagsTable, eq(tagsTable.id, storyTagsTable.tagId))
      .innerJoin(
        storiesTable,
        eq(storiesTable.id, storyTagsTable.storyId),
      )
      .where(and(...baseConds))
      .groupBy(tagsTable.slug, tagsTable.label)
      .orderBy(desc(count()))
      .limit(20),
  ]);
  res.json({
    genres: genreRows.map((r) => ({ value: r.value, count: Number(r.c) })),
    artStyles: artStyleRows.map((r) => ({
      value: r.value,
      count: Number(r.c),
    })),
    // `value` is the tag slug (matches the /stories/feed `tag` filter);
    // `label` is the human-readable name for display.
    tags: tagRows.map((r) => ({
      value: r.value,
      label: r.label,
      count: Number(r.c),
    })),
  });
});

router.get("/stories/feed", async (req, res): Promise<void> => {
  const parsed = GetPublicFeedQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { genre, limit, q, followerName, sort, tag, viewerAuthorName } =
    parsed.data;
  const style = (req.query.style as string | undefined)?.trim();
  const conditions = [and(eq(storiesTable.status, "published"), eq(storiesTable.isPrivate, false))];
  if (genre) conditions.push(eq(storiesTable.genre, genre));
  if (style) conditions.push(eq(storiesTable.artStyle, style));
  const trimmedQ = q?.trim();
  if (trimmedQ) {
    conditions.push(
      sql`(stories.tsv @@ websearch_to_tsquery('english', ${trimmedQ})
           OR ${storiesTable.title} ILIKE ${`%${trimmedQ}%`})`,
    );
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

  // Private stories never appear in the public feed regardless of who is
  // authenticated. Conjurers reach their own private stories via /stories
  // (the dashboard list) or by direct id.
  conditions.push(eq(storiesTable.isPrivate, false));

  const sortMode = sort ?? "new";
  const cap = limit ?? 20;

  if (sortMode === "new") {
    // When the reader supplied a search query, rank by ts_rank_cd
    // (relevance) instead of recency so the most-relevant match floats
    // to the top regardless of when it was published.
    const stories = trimmedQ
      ? await db
          .select()
          .from(storiesTable)
          .where(and(...conditions))
          .orderBy(
            desc(
              sql`ts_rank_cd(stories.tsv, websearch_to_tsquery('english', ${trimmedQ}))`,
            ),
            desc(storiesTable.createdAt),
          )
          .limit(cap)
      : await db
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
    .where(and(eq(storiesTable.status, "published"), eq(storiesTable.isPrivate, false)));

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

  // Private (Conjurer-only) stories are 404 to anyone but the owner /
  // co-author. Treating it as 404 (not 403) avoids leaking existence.
  if (story.isPrivate && !canEditStory(story, req.user ?? null)) {
    res.status(404).json({ error: "Story not found" });
    return;
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
  // Privacy is a Conjurer perk; silently drop the flag for free users so a
  // stale client cannot bypass the upsell via PATCH.
  if ("isPrivate" in updates && updates.isPrivate === true && req.user) {
    const plan = await getUserPlan(req.user.id);
    if (plan !== "conjurer") delete updates.isPrivate;
  }
  const [story] = await db
    .update(storiesTable)
    .set(updates)
    .where(eq(storiesTable.id, params.data.id))
    .returning();

  // Refresh the embedding when content changed or when a draft
  // transitions to published. Cheap to over-trigger since it's
  // background and idempotent.
  if (
    story.status === "published" &&
    ("fullText" in parsed.data ||
      "summary" in parsed.data ||
      "title" in parsed.data ||
      ("status" in parsed.data && existing.status !== "published"))
  ) {
    embedStoryInBackground(story.id);
  }

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

  // Refresh embedding after the status flip (embedStoryById no-ops on drafts).
  embedStoryInBackground(params.data.id);

  res.json(story);
});

router.get("/stories/:id/illustrations", async (req, res): Promise<void> => {
  const params = GetIllustrationsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Private stories' illustrations are 404 to non-owners.
  const [story] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!story || !canReadStory(story, req.user ?? null)) {
    res.status(404).json({ error: "Not found" });
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

  const quota = await checkAndBumpIllustration(story.authorName, req.user?.id ?? null);
  if (!quota.ok) {
    res.status(429).json({
      error: "Daily illustration quota reached",
      remaining: quota.remaining,
      limit: quota.limit,
    });
    return;
  }

  const allLinked = await loadStoryCharacters(story.id);
  const linkedChars = await filterCharactersInSection(
    parsed.data.sectionText,
    allLinked,
  );
  const prompt = buildIllustrationPrompt(
    parsed.data.sectionText,
    story.genre,
    story.artStyle,
    story.characters,
    story.summary,
    toCharacterRefs(linkedChars),
  );

  req.log.info(
    {
      storyId: story.id,
      linkedCount: allLinked.length,
      presentCount: linkedChars.length,
    },
    "Generating illustration",
  );
  const buffer = await generateIllustrationForCharacters(
    prompt,
    linkedChars,
    "1024x1024",
  );
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
    const linkedChars = await loadStoryCharacters(story.id);
    const buffer = await generateIllustrationForCharacters(
      finalPrompt,
      linkedChars,
      "1024x1024",
    );
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

    const allLinked = await loadStoryCharacters(story.id);
    const linkedChars = await filterCharactersInSection(
      rewrittenText,
      allLinked,
    );
    const illustrationPrompt = buildIllustrationPrompt(
      rewrittenText,
      story.genre,
      story.artStyle,
      story.characters,
      story.summary,
      toCharacterRefs(linkedChars),
    );
    const buffer = await generateIllustrationForCharacters(
      illustrationPrompt,
      linkedChars,
      "1024x1024",
    );
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

    const quota = await checkAndBumpStory(body.data.authorName, req.user?.id ?? null);
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

    // Backfill chapter rows from legacy fullText (no-op if already
    // backfilled) before grabbing the per-story lock.
    await backfillStoryToChapters(story.id);

    // Append the chapter, record authorship, and insert the new
    // chapters tree row in a single transaction guarded by the
    // per-story advisory lock so concurrent /continue or /branch calls
    // can't both pick the same canonical leaf or stomp `fullText`.
    const [updated] = await db.transaction(async (tx) => {
      await lockStoryChapters(tx, story.id);

      // Re-read the story inside the lock so we use the latest
      // fullText for both the append and the chapter-index counter.
      const [fresh] = await tx
        .select()
        .from(storiesTable)
        .where(eq(storiesTable.id, story.id))
        .limit(1);
      const baseText = fresh?.fullText ?? "";
      const appended = `${baseText}\n\n## ${chapterTitle}\n\n${chapterText}`;
      const existingChapterCount = (baseText.match(/^## /gm) || []).length;
      const newChapterIndex = existingChapterCount + 1;

      // Find the canonical leaf by *walking the canonical path from the
      // root*, not by scanning all chapters for "canonical with no
      // canonical child" — a non-canonical alternate branch can have
      // its own canonical descendants (its sub-branches), and those
      // would otherwise be picked up as false leaves and corrupt the
      // story's canonical chain. Walking from the root guarantees we
      // append to the *currently rendered* path.
      const existingChapters = await tx
        .select()
        .from(chaptersTable)
        .where(eq(chaptersTable.storyId, story.id));
      let canonicalLeafId: number | null = null;
      if (existingChapters.length > 0) {
        const childrenOf = new Map<number | null, typeof existingChapters>();
        for (const c of existingChapters) {
          const arr = childrenOf.get(c.parentChapterId) ?? [];
          arr.push(c);
          childrenOf.set(c.parentChapterId, arr);
        }
        // Canonical root: the chapter whose parent is null AND
        // is_canonical = true. There should be exactly one.
        const root = (childrenOf.get(null) ?? []).find((c) => c.isCanonical);
        let cursor = root ?? null;
        while (cursor) {
          const next = (childrenOf.get(cursor.id) ?? []).find(
            (c) => c.isCanonical,
          );
          if (!next) break;
          cursor = next;
        }
        canonicalLeafId = cursor?.id ?? null;
      }

      const [row] = await tx
        .update(storiesTable)
        .set({ fullText: appended, updatedAt: new Date() })
        .where(eq(storiesTable.id, story.id))
        .returning();
      if (req.user) {
        await tx
          .insert(chapterAuthorsTable)
          .values({
            storyId: story.id,
            chapterIndex: newChapterIndex,
            userId: req.user.id,
            authorHandle: req.user.handle,
          })
          .onConflictDoNothing();
      }
      await tx.insert(chaptersTable).values({
        storyId: story.id,
        parentChapterId: canonicalLeafId,
        title: chapterTitle,
        branchLabel: "",
        text: chapterText,
        position: 0,
        isCanonical: true,
        authorUserId: req.user?.id ?? null,
        authorHandle: req.user?.handle ?? story.authorName,
      });
      return [row];
    });

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
        const allLinked = await loadStoryCharacters(story.id);
        const linkedChars = await filterCharactersInSection(
          newSection,
          allLinked,
        );
        const prompt = buildIllustrationPrompt(
          newSection,
          story.genre,
          story.artStyle,
          story.characters,
          story.summary,
          toCharacterRefs(linkedChars),
        );
        const buffer = await generateIllustrationForCharacters(
          prompt,
          linkedChars,
          "1024x1024",
        );
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
  if (!canReadStory(story, req.user ?? null)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const voice = query.data.voice ?? "nova";
  const text = story.fullText.slice(0, 4000);

  // Shared TTS cache: dedup'd with the trailer narration path so
  // identical (text, voice) inputs reuse the same MP3 in Object Storage.
  const { buffer } = await synthesizeStoryNarration(text, voice);
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
  if (!story || !canReadStory(story, req.user ?? null)) {
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
  // Don't reveal like-count for a private story to anyone but the owner.
  const [story] = await db
    .select({
      id: storiesTable.id,
      isPrivate: storiesTable.isPrivate,
      userId: storiesTable.userId,
      authorName: storiesTable.authorName,
      coAuthors: storiesTable.coAuthors,
    })
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!story || !canReadStory(story, req.user ?? null)) {
    res.status(404).json({ error: "Not found" });
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
  if (!story || !canReadStory(story, req.user ?? null)) {
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

// ---------- Collaborators (rich invitations) ----------

type CollaboratorRow = {
  userId: number;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  status: string;
  invitedAt: string;
  respondedAt: string | null;
};

async function loadCollaboratorList(storyId: number): Promise<CollaboratorRow[]> {
  const rows = await db
    .select({
      userId: storyCollaboratorsTable.userId,
      handle: usersTable.handle,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
      role: storyCollaboratorsTable.role,
      status: storyCollaboratorsTable.status,
      invitedAt: storyCollaboratorsTable.invitedAt,
      respondedAt: storyCollaboratorsTable.respondedAt,
    })
    .from(storyCollaboratorsTable)
    .innerJoin(usersTable, eq(usersTable.id, storyCollaboratorsTable.userId))
    .where(eq(storyCollaboratorsTable.storyId, storyId))
    .orderBy(desc(storyCollaboratorsTable.invitedAt));
  return rows.map((r) => ({
    userId: r.userId,
    handle: r.handle,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    role: r.role,
    status: r.status,
    invitedAt: r.invitedAt.toISOString(),
    respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
  }));
}

async function syncStoryCoAuthorsArray(storyId: number): Promise<void> {
  // Keep stories.co_authors text[] in sync with accepted writer collaborators
  // so the existing canEditStory + UI byline keep working without joins.
  const accepted = await db
    .select({ handle: usersTable.handle })
    .from(storyCollaboratorsTable)
    .innerJoin(usersTable, eq(usersTable.id, storyCollaboratorsTable.userId))
    .where(
      and(
        eq(storyCollaboratorsTable.storyId, storyId),
        eq(storyCollaboratorsTable.status, "accepted"),
        eq(storyCollaboratorsTable.role, "writer"),
      ),
    );
  const handles = accepted.map((r) => r.handle);
  await db
    .update(storiesTable)
    .set({ coAuthors: handles, updatedAt: new Date() })
    .where(eq(storiesTable.id, storyId));
}

router.get("/stories/:id/collaborators", async (req, res): Promise<void> => {
  const params = ListCollaboratorsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [story] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!story || !canReadStory(story, req.user ?? null)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const collaborators = await loadCollaboratorList(story.id);
  // Pending invitations leak who-was-invited; only owner or any listed
  // collaborator (accepted, pending, or even past) gets the full picture.
  // Everyone else sees only accepted writers (which are already public via
  // the chapter byline + stories.coAuthors text[] anyway).
  const callerId = req.user?.id;
  const isOwner = !!callerId && story.userId === callerId;
  const isCollaborator =
    !!callerId && collaborators.some((c) => c.userId === callerId);
  const visible =
    isOwner || isCollaborator
      ? collaborators
      : collaborators.filter((c) => c.status === "accepted");
  res.json({
    storyId: story.id,
    primaryAuthor: story.authorName,
    primaryUserId: story.userId,
    collaborators: visible,
  });
});

router.post(
  "/stories/:id/collaborators",
  writeLimiter,
  async (req, res): Promise<void> => {
    const params = InviteCollaboratorParams.safeParse(req.params);
    const body = InviteCollaboratorBody.safeParse(req.body ?? {});
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
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
    const isOwner =
      story.userId != null
        ? story.userId === req.user.id
        : req.user.handle === story.authorName;
    if (!isOwner) {
      res.status(403).json({ error: "Only the primary author can invite collaborators" });
      return;
    }
    const handle = body.data.handle.trim().replace(/^@/, "");
    if (!handle || handle === req.user.handle) {
      res.status(400).json({ error: "Invalid handle" });
      return;
    }
    const [invitee] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.handle, handle))
      .limit(1);
    if (!invitee) {
      res.status(404).json({ error: "No user with that handle" });
      return;
    }
    const [existing] = await db
      .select()
      .from(storyCollaboratorsTable)
      .where(
        and(
          eq(storyCollaboratorsTable.storyId, story.id),
          eq(storyCollaboratorsTable.userId, invitee.id),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.status === "pending" || existing.status === "accepted") {
        res.status(400).json({ error: "Already invited" });
        return;
      }
      // Re-invite after decline/revoke: reset to pending.
      await db
        .update(storyCollaboratorsTable)
        .set({
          status: "pending",
          role: body.data.role,
          invitedAt: new Date(),
          respondedAt: null,
          invitedByUserId: req.user.id,
        })
        .where(eq(storyCollaboratorsTable.id, existing.id));
    } else {
      await db.insert(storyCollaboratorsTable).values({
        storyId: story.id,
        userId: invitee.id,
        role: body.data.role,
        status: "pending",
        invitedByUserId: req.user.id,
      });
    }
    try {
      await db.insert(notificationsTable).values({
        recipientName: invitee.handle,
        type: "collab_invite",
        actorName: req.user.handle,
        storyId: story.id,
        payload: {
          storyTitle: story.title,
          role: body.data.role,
          inviterUserId: req.user.id,
          inviteeUserId: invitee.id,
        },
      });
      notifyRecipient(invitee.handle);
    } catch (err) {
      logger.warn({ err }, "failed to insert collab_invite notification");
    }
    const collaborators = await loadCollaboratorList(story.id);
    res.json({
      storyId: story.id,
      primaryAuthor: story.authorName,
      primaryUserId: story.userId,
      collaborators,
    });
  },
);

router.post(
  "/stories/:id/collaborators/:userId/respond",
  writeLimiter,
  async (req, res): Promise<void> => {
    const params = RespondCollaboratorInviteParams.safeParse(req.params);
    const body = RespondCollaboratorInviteBody.safeParse(req.body ?? {});
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (req.user.id !== params.data.userId) {
      res.status(403).json({ error: "Only the invitee may respond" });
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
    const [invite] = await db
      .select()
      .from(storyCollaboratorsTable)
      .where(
        and(
          eq(storyCollaboratorsTable.storyId, story.id),
          eq(storyCollaboratorsTable.userId, req.user.id),
        ),
      )
      .limit(1);
    if (!invite || invite.status !== "pending") {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }
    const nextStatus = body.data.action === "accept" ? "accepted" : "declined";
    await db
      .update(storyCollaboratorsTable)
      .set({ status: nextStatus, respondedAt: new Date() })
      .where(eq(storyCollaboratorsTable.id, invite.id));
    if (nextStatus === "accepted") {
      await syncStoryCoAuthorsArray(story.id);
      // Notify the primary author that the invite was accepted.
      try {
        await db.insert(notificationsTable).values({
          recipientName: story.authorName,
          type: "collab_accept",
          actorName: req.user.handle,
          storyId: story.id,
          payload: { storyTitle: story.title, role: invite.role },
        });
        notifyRecipient(story.authorName);
      } catch (err) {
        logger.warn({ err }, "failed to insert collab_accept notification");
      }
    }
    const collaborators = await loadCollaboratorList(story.id);
    res.json({
      storyId: story.id,
      primaryAuthor: story.authorName,
      primaryUserId: story.userId,
      collaborators,
    });
  },
);

router.delete(
  "/stories/:id/collaborators/:userId",
  writeLimiter,
  async (req, res): Promise<void> => {
    const params = RevokeCollaboratorParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
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
    const isOwner =
      story.userId != null
        ? story.userId === req.user.id
        : req.user.handle === story.authorName;
    const isSelf = req.user.id === params.data.userId;
    if (!isOwner && !isSelf) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    const [invite] = await db
      .select()
      .from(storyCollaboratorsTable)
      .where(
        and(
          eq(storyCollaboratorsTable.storyId, story.id),
          eq(storyCollaboratorsTable.userId, params.data.userId),
        ),
      )
      .limit(1);
    if (!invite) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db
      .update(storyCollaboratorsTable)
      .set({ status: "revoked", respondedAt: new Date() })
      .where(eq(storyCollaboratorsTable.id, invite.id));
    await syncStoryCoAuthorsArray(story.id);
    const collaborators = await loadCollaboratorList(story.id);
    res.json({
      storyId: story.id,
      primaryAuthor: story.authorName,
      primaryUserId: story.userId,
      collaborators,
    });
  },
);

router.get("/stories/:id/chapters", async (req, res): Promise<void> => {
  const params = ListStoryChaptersParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [story] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!story || !canReadStory(story, req.user ?? null)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const rows = await db
    .select({
      chapterIndex: chapterAuthorsTable.chapterIndex,
      userId: chapterAuthorsTable.userId,
      handle: chapterAuthorsTable.authorHandle,
    })
    .from(chapterAuthorsTable)
    .where(eq(chapterAuthorsTable.storyId, story.id))
    .orderBy(chapterAuthorsTable.chapterIndex);
  res.json({
    storyId: story.id,
    primaryAuthor: story.authorName,
    chapters: rows,
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
    .select({
      id: storiesTable.id,
      isPrivate: storiesTable.isPrivate,
      userId: storiesTable.userId,
      authorName: storiesTable.authorName,
      coAuthors: storiesTable.coAuthors,
    })
    .from(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .limit(1);
  if (!story || !canReadStory(story, req.user ?? null)) {
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

// Per-paragraph comment counts powering the inline "+N" badges.
// Returns one row per paragraph that has at least one comment.
router.get(
  "/stories/:id/comments/paragraph-counts",
  async (req, res): Promise<void> => {
    const params = GetStoryCommentsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const rows = await db
      .select({
        paragraphIndex: storyCommentsTable.paragraphIndex,
        c: count(),
      })
      .from(storyCommentsTable)
      .where(
        and(
          eq(storyCommentsTable.storyId, params.data.id),
          sql`${storyCommentsTable.paragraphIndex} IS NOT NULL`,
        ),
      )
      .groupBy(storyCommentsTable.paragraphIndex);
    res.json(
      rows
        .filter((r) => r.paragraphIndex != null)
        .map((r) => ({
          paragraphIndex: r.paragraphIndex as number,
          count: Number(r.c),
        })),
    );
  },
);

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
    // Replies inherit the parent's paragraph anchor.
    let paragraphIndex: number | null =
      typeof body.data.paragraphIndex === "number" &&
      Number.isInteger(body.data.paragraphIndex) &&
      body.data.paragraphIndex >= 0
        ? body.data.paragraphIndex
        : null;
    if (parentId != null) {
      const [parentRow] = await db
        .select({ paragraphIndex: storyCommentsTable.paragraphIndex })
        .from(storyCommentsTable)
        .where(eq(storyCommentsTable.id, parentId))
        .limit(1);
      if (parentRow) paragraphIndex = parentRow.paragraphIndex;
    }
    const [comment] = await db
      .insert(storyCommentsTable)
      .values({
        storyId: params.data.id,
        authorName,
        body: text,
        parentId,
        paragraphIndex,
        userId: req.user?.id ?? null,
      })
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

// ---------- Trailer (video) ----------

router.post(
  "/stories/:id/trailer",
  aiGenerationLimiter,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [story] = await db
      .select()
      .from(storiesTable)
      .where(eq(storiesTable.id, id))
      .limit(1);
    if (!story) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Trailer renders are expensive (image fetches + TTS + ffmpeg).
    // Restrict kickoffs to authors/co-authors so randoms can't grief.
    if (!canEditStory(story, req.user ?? null)) {
      res
        .status(403)
        .json({ error: "Only the author or a co-author may render a trailer" });
      return;
    }
    const status: TrailerStatus =
      story.trailerStatus === "ready" && story.trailerUrl
        ? "ready"
        : isTrailerJobInFlight(id)
          ? "rendering"
          : "queued";
    if (status === "ready") {
      res.status(200).json({ storyId: id, status, url: story.trailerUrl });
      return;
    }
    if (status === "queued") {
      await db
        .update(storiesTable)
        .set({ trailerStatus: "queued" })
        .where(eq(storiesTable.id, id));
      startTrailerJobInBackground(id);
    }
    res.status(202).json({ storyId: id, status, url: story.trailerUrl ?? null });
  },
);

router.get("/stories/:id/trailer", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [story] = await db
    .select()
    .from(storiesTable)
    .where(eq(storiesTable.id, id))
    .limit(1);
  if (!story) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Trailer URL/status is only visible to the author/co-authors while a
  // story is unpublished. Once published, anyone can read its status.
  if (story.status !== "published" && !canEditStory(story, req.user ?? null)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Private stories — even when "published" — never expose a trailer to
  // non-owners.
  if (!canReadStory(story, req.user ?? null)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const raw = story.trailerStatus as TrailerStatus | null;
  const inFlight = isTrailerJobInFlight(id);
  // If the row says queued/rendering but no job is actually running
  // (e.g. the server restarted mid-render), surface that as "failed"
  // so the UI re-enables the Generate button instead of polling
  // forever.
  const stale =
    !inFlight && (raw === "queued" || raw === "rendering");
  const status: TrailerStatus =
    raw === "ready" && story.trailerUrl
      ? "ready"
      : inFlight
        ? "rendering"
        : stale
          ? "failed"
          : (raw ?? "idle");
  res.json({ storyId: id, status, url: story.trailerUrl ?? null });
});

// ---------- Dynamic Open Graph image ----------

router.get("/og/:storyId", async (req, res): Promise<void> => {
  const id = Number(req.params.storyId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).end();
    return;
  }
  const input = await loadOgInputForStory(id);
  if (!input) {
    res.status(404).end();
    return;
  }
  try {
    const png = await renderOgImage(input);
    res.setHeader("Content-Type", "image/png");
    res.setHeader(
      "Cache-Control",
      "public, max-age=600, s-maxage=86400, stale-while-revalidate=604800",
    );
    res.setHeader("ETag", `"og-${id}-${ogContentHash(input)}"`);
    res.send(png);
  } catch (err) {
    req.log.warn({ err, id }, "OG render failed");
    res.status(500).end();
  }
});

export default router;
