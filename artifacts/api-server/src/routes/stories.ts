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
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { generateImageBuffer } from "@workspace/integrations-openai-ai-server/image";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function buildIllustrationPrompt(
  sectionText: string,
  genre: string,
  artStyle: string,
  characters: string | null | undefined,
): string {
  const characterHint = characters
    ? ` Characters: ${characters.slice(0, 200)}.`
    : "";
  return `${artStyle} illustration for a ${genre} story. Scene: ${sectionText.slice(0, 300)}.${characterHint} High quality, detailed, no text or watermarks.`;
}

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

  const systemPrompt = `You are a creative fiction writer. Write engaging, coherent ${genre} stories with vivid descriptions and compelling characters. The art style for illustrations will be: ${artStyle}. Always respond in valid JSON.`;

  const userPrompt = seedPrompt
    ? `Write a ${genre} fanfiction story of approximately ${wordTarget} words. Seed idea: "${seedPrompt}". 
Return JSON with: { "title": string, "fullText": string, "summary": string (2-3 sentences), "characters": string (brief description of main characters, max 200 chars), "sections": string[] (split fullText into 3-4 narrative sections for illustration) }`
    : `Write an original ${genre} fiction story of approximately ${wordTarget} words with memorable characters and a satisfying plot arc.
Return JSON with: { "title": string, "fullText": string, "summary": string (2-3 sentences), "characters": string (brief description of main characters, max 200 chars), "sections": string[] (split fullText into 3-4 narrative sections for illustration) }`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.1",
    max_completion_tokens: 4096,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);
  return {
    title: parsed.title ?? "Untitled Story",
    fullText: parsed.fullText ?? "",
    summary: parsed.summary ?? "",
    characters: parsed.characters ?? "",
    sections: Array.isArray(parsed.sections) ? parsed.sections : [],
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

router.post("/stories", async (req, res): Promise<void> => {
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

router.post("/stories/generate", async (req, res): Promise<void> => {
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

  if (generateIllustrations !== false && generated.sections.length > 0) {
    const illustrationPromises = generated.sections
      .slice(0, 4)
      .map(async (section, idx) => {
        try {
          const prompt = buildIllustrationPrompt(
            section,
            genre,
            artStyle,
            generated.characters,
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
        } catch (err) {
          req.log.error({ err, idx }, "Failed to generate illustration");
        }
      });

    await Promise.all(illustrationPromises);

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

  res.status(201).json(finalStory[0] ?? story);
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

router.post("/stories/:id/illustrations", async (req, res): Promise<void> => {
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

export default router;
