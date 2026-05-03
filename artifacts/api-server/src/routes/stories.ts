import { Router, type IRouter } from "express";
import { eq, desc, count, and, sql } from "drizzle-orm";
import { db, storiesTable, illustrationsTable, storyLikesTable } from "@workspace/db";
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
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { generateImageBuffer } from "@workspace/integrations-openai-ai-server/image";
import { uploadIllustrationBuffer } from "../lib/uploadIllustration";
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

  res.json(stories);
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

  const { genre, limit } = parsed.data;
  const conditions = [eq(storiesTable.status, "published")];
  if (genre) conditions.push(eq(storiesTable.genre, genre));

  const stories = await db
    .select()
    .from(storiesTable)
    .where(and(...conditions))
    .orderBy(desc(storiesTable.createdAt))
    .limit(limit ?? 20);

  res.json(stories);
});

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

  const illustrations = await db
    .select()
    .from(illustrationsTable)
    .where(eq(illustrationsTable.storyId, story.id))
    .orderBy(illustrationsTable.sectionIndex);

  res.json({ ...story, illustrations });
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

  const [story] = await db
    .update(storiesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(storiesTable.id, params.data.id))
    .returning();

  if (!story) {
    res.status(404).json({ error: "Story not found" });
    return;
  }

  res.json(story);
});

router.delete("/stories/:id", async (req, res): Promise<void> => {
  const params = DeleteStoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [story] = await db
    .delete(storiesTable)
    .where(eq(storiesTable.id, params.data.id))
    .returning();

  if (!story) {
    res.status(404).json({ error: "Story not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/stories/:id/publish", async (req, res): Promise<void> => {
  const params = PublishStoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [story] = await db
    .update(storiesTable)
    .set({ status: "published", updatedAt: new Date() })
    .where(eq(storiesTable.id, params.data.id))
    .returning();

  if (!story) {
    res.status(404).json({ error: "Story not found" });
    return;
  }

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

router.delete(
  "/stories/:id/illustrations/:illustrationId",
  async (req, res): Promise<void> => {
    const params = DeleteIllustrationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
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

    const requester = body.data.authorName.trim();
    if (!requester || requester !== story.authorName) {
      res.status(403).json({ error: "Only the story's author may add chapters" });
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

  await db
    .insert(storyLikesTable)
    .values({ storyId: params.data.id, authorName })
    .onConflictDoNothing();

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
  await db
    .delete(storyLikesTable)
    .where(
      and(
        eq(storyLikesTable.storyId, params.data.id),
        eq(storyLikesTable.authorName, authorName),
      ),
    );
  const info = await getLikeInfo(params.data.id, authorName);
  res.json(info);
});

export default router;
