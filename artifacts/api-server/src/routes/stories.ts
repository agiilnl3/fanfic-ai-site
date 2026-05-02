import { Router, type IRouter } from "express";
import { eq, desc, count, and } from "drizzle-orm";
import { db, storiesTable, illustrationsTable } from "@workspace/db";
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
  RegenerateStoryTextParams,
  RegenerateStorySectionParams,
  RegenerateStorySectionBody,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { generateImageBuffer } from "@workspace/integrations-openai-ai-server/image";
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
    model: "gpt-5.1",
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

  const { genre, artStyle, lengthSetting, seedPrompt, authorName, generateIllustrations } =
    parsed.data;

  req.log.info({ genre, artStyle, lengthSetting }, "Generating story with AI");

  const generated = await generateStoryText(
    genre,
    artStyle,
    lengthSetting,
    seedPrompt,
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
        const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
        await db.insert(illustrationsTable).values({
          storyId: story.id,
          sectionIndex: idx,
          prompt,
          imageUrl: dataUrl,
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
  const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;

  const [illustration] = await db
    .insert(illustrationsTable)
    .values({
      storyId: story.id,
      sectionIndex: parsed.data.sectionIndex,
      prompt,
      imageUrl: dataUrl,
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
    const buffer = await generateImageBuffer(existing.prompt, "1024x1024");
    const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;

    const [updated] = await db
      .update(illustrationsTable)
      .set({ imageUrl: dataUrl })
      .where(eq(illustrationsTable.id, existing.id))
      .returning();

    if (existing.sectionIndex === 0) {
      await db
        .update(storiesTable)
        .set({ coverImageUrl: dataUrl })
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
    const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;

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
        .set({ imageUrl: dataUrl, prompt: illustrationPrompt })
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
          imageUrl: dataUrl,
          caption: null,
        })
        .returning();
      illustration = inserted;
    }

    if (sectionIndex === 0 && illustration) {
      await db
        .update(storiesTable)
        .set({ coverImageUrl: dataUrl })
        .where(eq(storiesTable.id, story.id));
    }

    res.json({
      sectionIndex,
      rewrittenText,
      illustration: illustration ?? null,
    });
  },
);

export default router;
