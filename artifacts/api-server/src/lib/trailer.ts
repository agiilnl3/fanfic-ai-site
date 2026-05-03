import { spawn } from "child_process";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { db, storiesTable, illustrationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { uploadIllustrationBuffer } from "./uploadIllustration";
import { logger } from "./logger";

export type TrailerStatus = "queued" | "rendering" | "ready" | "failed";

const SECONDS_PER_IMAGE = 4;
const FPS = 30;
const ZOOM_END = 1.18;

function ffmpegBin(): string {
  return process.env.FFMPEG_PATH ?? "ffmpeg";
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-1000)}`));
    });
  });
}

function computeHash(parts: (string | number | null | undefined)[]): string {
  return createHash("sha256")
    .update(parts.map((p) => String(p ?? "")).join("|"))
    .digest("hex")
    .slice(0, 16);
}

async function fetchToFile(url: string, dest: string): Promise<void> {
  // SSRF guard: only allow our own object-storage proxy paths
  // (e.g. `/api/storage/uploads/<uuid>`). Refuse absolute URLs so a
  // tampered `imageUrl` row can't trick the server into fetching
  // arbitrary internal/private endpoints.
  if (!url.startsWith("/api/storage/")) {
    throw new Error(`refusing to fetch non-local image url: ${url}`);
  }
  const base = process.env.PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8080";
  const resp = await fetch(`${base}${url}`);
  if (!resp.ok) throw new Error(`fetch ${url} -> ${resp.status}`);
  const ab = await resp.arrayBuffer();
  await writeFile(dest, Buffer.from(ab));
}

async function renderNarration(
  text: string,
  outPath: string,
): Promise<number> {
  const trimmed = text.slice(0, 4000);
  const resp = await openai.audio.speech.create({
    model: "tts-1",
    voice: "nova",
    input: trimmed,
    response_format: "mp3",
  });
  const buf = Buffer.from(await resp.arrayBuffer());
  await writeFile(outPath, buf);
  return buf.length;
}

interface RenderOptions {
  imagePaths: string[];
  audioPath: string;
  outPath: string;
}

async function renderTrailer(opts: RenderOptions): Promise<void> {
  const totalFrames = SECONDS_PER_IMAGE * FPS;
  // Each image becomes a `lavfi`-like still that pans/zooms via zoompan,
  // then they're concatenated and muxed with the narration. We trim to
  // the audio length so the trailer is exactly `min(image-budget, audio)`.
  const filterComplex = opts.imagePaths
    .map((_, i) => {
      const z = `'min(zoom+0.0008,${ZOOM_END})'`;
      const x = `'iw/2-(iw/zoom/2)'`;
      const y = `'ih/2-(ih/zoom/2)'`;
      return (
        `[${i}:v]scale=1920:1080:force_original_aspect_ratio=increase,` +
        `crop=1920:1080,setsar=1,` +
        `zoompan=z=${z}:x=${x}:y=${y}:d=${totalFrames}:s=1920x1080:fps=${FPS},` +
        `format=yuv420p[v${i}]`
      );
    })
    .join(";");
  const concatInputs = opts.imagePaths.map((_, i) => `[v${i}]`).join("");
  const fullFilter = `${filterComplex};${concatInputs}concat=n=${opts.imagePaths.length}:v=1:a=0[vout]`;

  const args: string[] = [];
  for (const p of opts.imagePaths) {
    args.push("-loop", "1", "-t", String(SECONDS_PER_IMAGE), "-i", p);
  }
  args.push("-i", opts.audioPath);
  args.push(
    "-filter_complex",
    fullFilter,
    "-map",
    "[vout]",
    "-map",
    `${opts.imagePaths.length}:a`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    "-movflags",
    "+faststart",
    "-y",
    opts.outPath,
  );
  await run(ffmpegBin(), args);
}

const inFlight = new Set<number>();

export function isTrailerJobInFlight(storyId: number): boolean {
  return inFlight.has(storyId);
}

export async function runTrailerJob(storyId: number): Promise<void> {
  if (inFlight.has(storyId)) return;
  inFlight.add(storyId);
  let workDir: string | null = null;
  try {
    const [story] = await db
      .select()
      .from(storiesTable)
      .where(eq(storiesTable.id, storyId))
      .limit(1);
    if (!story || !story.fullText) {
      await db
        .update(storiesTable)
        .set({ trailerStatus: "failed" })
        .where(eq(storiesTable.id, storyId));
      return;
    }
    const illos = await db
      .select()
      .from(illustrationsTable)
      .where(eq(illustrationsTable.storyId, storyId))
      .orderBy(illustrationsTable.sectionIndex);
    const picks = illos.slice(0, 8);
    if (picks.length < 1) {
      await db
        .update(storiesTable)
        .set({ trailerStatus: "failed" })
        .where(eq(storiesTable.id, storyId));
      return;
    }

    const hash = computeHash([
      story.fullText.length,
      story.title,
      ...picks.map((p) => `${p.id}:${p.imageUrl}`),
    ]);

    if (
      story.trailerHash === hash &&
      story.trailerStatus === "ready" &&
      story.trailerUrl
    ) {
      return;
    }

    await db
      .update(storiesTable)
      .set({ trailerStatus: "rendering" })
      .where(eq(storiesTable.id, storyId));

    workDir = await mkdtemp(join(tmpdir(), `trailer-${storyId}-`));
    const imagePaths: string[] = [];
    for (let i = 0; i < picks.length; i++) {
      const p = join(workDir, `img-${i}.png`);
      await fetchToFile(picks[i].imageUrl, p);
      imagePaths.push(p);
    }
    const audioPath = join(workDir, "narration.mp3");
    // Use the summary if present (more "trailer-like"), otherwise a
    // reasonable opening slice.
    const narrationText =
      (story.summary && story.summary.length > 60
        ? story.summary
        : story.fullText.slice(0, 1200)) ?? "";
    await renderNarration(narrationText, audioPath);

    const outPath = join(workDir, "trailer.mp4");
    await renderTrailer({ imagePaths, audioPath, outPath });

    const mp4 = await readFile(outPath);
    const url = await uploadIllustrationBuffer(mp4, "video/mp4");

    await db
      .update(storiesTable)
      .set({
        trailerUrl: url,
        trailerStatus: "ready",
        trailerHash: hash,
      })
      .where(eq(storiesTable.id, storyId));
  } catch (err) {
    logger.warn({ err, storyId }, "trailer render failed");
    await db
      .update(storiesTable)
      .set({ trailerStatus: "failed" })
      .where(eq(storiesTable.id, storyId))
      .catch(() => {});
  } finally {
    inFlight.delete(storyId);
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export function startTrailerJobInBackground(storyId: number): void {
  setImmediate(() => {
    void runTrailerJob(storyId);
  });
}
