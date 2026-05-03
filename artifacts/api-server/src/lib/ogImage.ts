import sharp from "sharp";
import { createHash } from "crypto";
import { db, storiesTable, illustrationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const WIDTH = 1200;
const HEIGHT = 630;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clamp(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) {
    lines.push(cur.length > maxChars ? cur.slice(0, maxChars - 1) + "…" : cur);
  }
  return lines;
}

async function fetchImageBuffer(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  // SSRF guard: only allow our own object-storage proxy paths.
  if (!url.startsWith("/api/storage/")) {
    logger.warn({ url }, "ogImage: refusing non-local url");
    return null;
  }
  const base = process.env.PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8080";
  try {
    const resp = await fetch(`${base}${url}`);
    if (!resp.ok) return null;
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab);
  } catch (err) {
    logger.warn({ err, url }, "ogImage: fetch failed");
    return null;
  }
}

export interface OgRenderInput {
  title: string;
  authorName: string;
  genre: string;
  imageUrl: string | null;
}

export async function renderOgImage(input: OgRenderInput): Promise<Buffer> {
  const titleLines = wrapText(input.title, 24, 3);
  const titleStartY =
    HEIGHT / 2 - (titleLines.length - 1) * 38 - 10;
  const titleTspans = titleLines
    .map(
      (line, i) =>
        `<tspan x="60" dy="${i === 0 ? 0 : 76}">${escapeXml(line)}</tspan>`,
    )
    .join("");

  const overlay = Buffer.from(
    `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(0,0,0,0.20)"/>
          <stop offset="55%" stop-color="rgba(0,0,0,0.55)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0.85)"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <g font-family="Georgia, 'Times New Roman', serif" fill="#ffffff">
        <text x="60" y="${titleStartY}" font-size="64" font-weight="700" style="paint-order:stroke; stroke:rgba(0,0,0,0.35); stroke-width:2px;">${titleTspans}</text>
        <text x="60" y="${HEIGHT - 90}" font-size="28" opacity="0.95">by ${escapeXml(clamp(input.authorName, 36))}</text>
      </g>
      <g transform="translate(${WIDTH - 220}, ${HEIGHT - 110})">
        <rect width="160" height="48" rx="24" ry="24" fill="rgba(255,255,255,0.92)"/>
        <text x="80" y="31" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="20" font-weight="600" fill="#111827">${escapeXml(input.genre.slice(0, 14))}</text>
      </g>
      <g transform="translate(60, 50)" font-family="Inter, system-ui, sans-serif">
        <text font-size="22" font-weight="700" fill="#ffffff" letter-spacing="3">FANFIC AI</text>
      </g>
    </svg>`,
  );

  const bgBuf = await fetchImageBuffer(input.imageUrl);

  const base = bgBuf
    ? sharp(bgBuf).resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" })
    : sharp({
        create: {
          width: WIDTH,
          height: HEIGHT,
          channels: 3,
          background: { r: 17, g: 24, b: 39 },
        },
      });

  return base
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png({ compressionLevel: 8 })
    .toBuffer();
}

export function ogContentHash(input: OgRenderInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify([input.title, input.authorName, input.genre, input.imageUrl]),
    )
    .digest("hex")
    .slice(0, 16);
}

export async function loadOgInputForStory(
  storyId: number,
): Promise<OgRenderInput | null> {
  const [story] = await db
    .select({
      id: storiesTable.id,
      title: storiesTable.title,
      authorName: storiesTable.authorName,
      genre: storiesTable.genre,
      status: storiesTable.status,
      posterCoverUrl: storiesTable.posterCoverUrl,
      coverImageUrl: storiesTable.coverImageUrl,
    })
    .from(storiesTable)
    .where(eq(storiesTable.id, storyId))
    .limit(1);
  // Don't render OG images for non-published stories — these get
  // crawled by social platforms, so leaking draft titles is undesirable.
  if (!story || story.status !== "published") return null;

  let imageUrl = story.posterCoverUrl ?? story.coverImageUrl ?? null;
  if (!imageUrl) {
    const [first] = await db
      .select({ imageUrl: illustrationsTable.imageUrl })
      .from(illustrationsTable)
      .where(eq(illustrationsTable.storyId, storyId))
      .orderBy(illustrationsTable.sectionIndex)
      .limit(1);
    if (first) imageUrl = first.imageUrl;
  }
  return {
    title: story.title,
    authorName: story.authorName,
    genre: story.genre,
    imageUrl,
  };
}
