import { db, pool, storiesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

// text-embedding-3-small. 1536 dims; cheap; good enough for similarity ranking.
const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_INPUT_CHARS = 8000;

// Replit's OpenAI-compatible proxy does NOT support /embeddings
// (see the integration's "Unsupported Capabilities" section). When
// we hit that error once, flip a process-wide switch so we don't
// keep spamming logs — and /feed/for-you quietly uses its
// engagement-based fallback ranker. The feature still ships;
// vector recs become a future upgrade once the proxy supports the
// endpoint or the user wires up a direct OPENAI_API_KEY.
let embeddingsDisabled = false;
export function embeddingsAvailable(): boolean {
  return !embeddingsDisabled;
}

function buildStoryText(s: {
  title: string;
  genre: string;
  summary: string | null;
  characters: string | null;
  fullText: string | null;
}): string {
  const parts = [
    `Title: ${s.title}`,
    `Genre: ${s.genre}`,
    s.summary ? `Summary: ${s.summary}` : "",
    s.characters ? `Characters: ${s.characters}` : "",
    s.fullText ? `Body: ${s.fullText}` : "",
  ].filter(Boolean);
  return parts.join("\n").slice(0, MAX_INPUT_CHARS);
}

function toVectorLiteral(vec: number[]): string {
  // pgvector accepts a string like '[0.1,0.2,...]'.
  return `[${vec.join(",")}]`;
}

export async function embedStoryById(storyId: number): Promise<boolean> {
  const [row] = await db
    .select({
      id: storiesTable.id,
      title: storiesTable.title,
      genre: storiesTable.genre,
      summary: storiesTable.summary,
      characters: storiesTable.characters,
      fullText: storiesTable.fullText,
      status: storiesTable.status,
    })
    .from(storiesTable)
    .where(eq(storiesTable.id, storyId))
    .limit(1);
  if (!row) return false;
  if (row.status !== "published") return false;
  if (embeddingsDisabled) return false;
  const text = buildStoryText(row);
  if (!text.trim()) return false;
  try {
    const resp = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    });
    const vec = resp.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) return false;
    const lit = toVectorLiteral(vec);
    await pool.query(
      `INSERT INTO story_embeddings (story_id, embedding, updated_at)
         VALUES ($1, $2::vector, now())
         ON CONFLICT (story_id) DO UPDATE
           SET embedding = EXCLUDED.embedding, updated_at = now()`,
      [storyId, lit],
    );
    return true;
  } catch (err) {
    // The Replit OpenAI proxy returns INVALID_ENDPOINT for /embeddings.
    // Detect that once and stop trying for the rest of the process so
    // we don't fill the logs with the same warning over and over.
    const msg = (err as { message?: string })?.message ?? "";
    const code = (err as { code?: string })?.code ?? "";
    if (code === "INVALID_ENDPOINT" || /not supported/i.test(msg)) {
      embeddingsDisabled = true;
      logger.warn(
        "OpenAI embeddings endpoint unavailable (Replit proxy doesn't support /embeddings). " +
          "Set OPENAI_API_KEY to enable vector-based recommendations; for now, " +
          "/feed/for-you will use engagement-based ranking.",
      );
      return false;
    }
    logger.warn({ err, storyId }, "embedStoryById failed");
    return false;
  }
}

// Fire-and-forget wrapper used from request handlers.
export function embedStoryInBackground(storyId: number): void {
  void embedStoryById(storyId).catch(() => {
    /* logged inside */
  });
}

// Boot-time backfill: embed any published story without an embedding,
// up to N at a time, with a small concurrency cap. Runs once.
let backfillStarted = false;
export function startEmbeddingBackfill(maxPerBoot = 50, concurrency = 3): void {
  if (backfillStarted) return;
  backfillStarted = true;
  if (embeddingsDisabled) return;
  setTimeout(async () => {
    try {
      if (embeddingsDisabled) return;
      const { rows } = await pool.query<{ id: number }>(
        `SELECT s.id
           FROM stories s
           LEFT JOIN story_embeddings e ON e.story_id = s.id
          WHERE s.status = 'published' AND e.story_id IS NULL
          ORDER BY s.created_at DESC
          LIMIT $1`,
        [maxPerBoot],
      );
      if (rows.length === 0) return;
      logger.info({ count: rows.length }, "embedding backfill starting");
      let i = 0;
      const workers = Array.from({ length: concurrency }, async () => {
        while (i < rows.length) {
          const { id } = rows[i++];
          await embedStoryById(id);
        }
      });
      await Promise.all(workers);
      logger.info({ count: rows.length }, "embedding backfill finished");
    } catch (err) {
      logger.warn({ err }, "embedding backfill failed");
    }
  }, 5000).unref?.();
}

// Helpers for the /feed/for-you ranker.
export const VECTOR_SQL = sql;
export { toVectorLiteral };
