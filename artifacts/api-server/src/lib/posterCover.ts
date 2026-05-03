import sharp from "sharp";
import { db, storiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateImageBuffer } from "@workspace/integrations-openai-ai-server/image";
import { uploadIllustrationBuffer } from "./uploadIllustration";
import { logger } from "./logger";

const POSTER_W = 1792;
const POSTER_H = 1024;

// The image API only emits up to 1024x1024 for square gens. We
// generate the centerpiece at 1024² and then expand to a 16:9
// canvas using a blurred-cover backdrop of the same source so the
// poster reads as a true widescreen cover without empty bars.
async function expandTo16x9(square: Buffer): Promise<Buffer> {
  const backdrop = await sharp(square)
    .resize(POSTER_W, POSTER_H, { fit: "cover", position: "centre" })
    .blur(40)
    .modulate({ brightness: 0.85, saturation: 1.1 })
    .toBuffer();
  const centerpiece = await sharp(square)
    .resize(POSTER_H, POSTER_H, { fit: "contain", position: "centre" })
    .toBuffer();
  return sharp(backdrop)
    .composite([
      {
        input: centerpiece,
        top: 0,
        left: Math.round((POSTER_W - POSTER_H) / 2),
      },
    ])
    .png({ compressionLevel: 8 })
    .toBuffer();
}

function buildPosterPrompt(s: {
  title: string;
  authorName: string;
  genre: string;
  artStyle: string;
  summary: string | null;
}): string {
  const subject = (s.summary ?? "").slice(0, 300) || `a ${s.genre} story`;
  return [
    `Cinematic magazine-cover composition, 16:9, designed for sharing.`,
    `The title "${s.title}" is rendered prominently across the top in elegant serif typography that matches the ${s.artStyle} aesthetic.`,
    `Below the imagery, a small byline reads "by ${s.authorName}".`,
    `Subject: ${subject}.`,
    `Style: ${s.artStyle}, ${s.genre} mood, dramatic lighting, rich colors, editorial-poster quality, centered focal point with breathing room around the title.`,
    `Avoid: cluttered backgrounds behind the title, watermarks, illegible text.`,
  ].join(" ");
}

export async function generatePosterCover(storyId: number): Promise<string | null> {
  const [s] = await db
    .select({
      id: storiesTable.id,
      title: storiesTable.title,
      authorName: storiesTable.authorName,
      genre: storiesTable.genre,
      artStyle: storiesTable.artStyle,
      summary: storiesTable.summary,
    })
    .from(storiesTable)
    .where(eq(storiesTable.id, storyId))
    .limit(1);
  if (!s) return null;
  const prompt = buildPosterPrompt(s);
  try {
    const square = await generateImageBuffer(prompt, "1024x1024");
    const buffer = await expandTo16x9(square);
    const url = await uploadIllustrationBuffer(buffer);
    await db
      .update(storiesTable)
      .set({ posterCoverUrl: url })
      .where(eq(storiesTable.id, storyId));
    return url;
  } catch (err) {
    logger.warn({ err, storyId }, "poster cover generation failed");
    return null;
  }
}

export function generatePosterCoverInBackground(storyId: number): void {
  void generatePosterCover(storyId).catch(() => {
    /* logged inside */
  });
}
