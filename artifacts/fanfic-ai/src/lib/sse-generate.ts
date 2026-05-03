import type { Illustration, Story } from "@workspace/api-client-react";

export type StreamEvent =
  | { type: "meta"; storyId: number; title: string }
  | { type: "token"; text: string }
  | {
      type: "section";
      phase:
        | "metadata"
        | "metadataDone"
        | "illustrations"
        | "illustrationsPartial";
      total?: number;
      title?: string;
      summary?: string;
      failed?: number[];
    }
  | {
      type: "illustration";
      index: number;
      total: number;
      illustration: Illustration;
    }
  | { type: "done"; storyId: number }
  | { type: "error"; message: string; storyId?: number };

export interface GenerateStreamBody {
  genre: string;
  artStyle: string;
  lengthSetting: "short" | "medium" | "long";
  authorName: string;
  seedPrompt?: string;
  generateIllustrations?: boolean;
  model?: "gpt-5.1" | "gpt-5-mini";
  isPrivate?: boolean;
}

/**
 * Open a POST SSE stream against /api/stories/generate/stream and yield
 * parsed events. EventSource only supports GET, so we use fetch + a
 * ReadableStream reader and parse the text/event-stream format ourselves.
 */
export async function* streamStoryGeneration(
  body: GenerateStreamBody,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent, void, unknown> {
  const base = import.meta.env.BASE_URL || "/";
  const res = await fetch(`${base}api/stories/generate/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    let msg = `Stream failed (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      // Normalize CRLF/CR to LF so framing works behind any proxy.
      buf += decoder
        .decode(value, { stream: true })
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");
      // SSE events are separated by a blank line.
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = parseSseBlock(raw);
        if (ev) yield ev;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

function parseSseBlock(block: string): StreamEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }
  const p = payload as Record<string, unknown>;
  switch (event) {
    case "meta":
      return {
        type: "meta",
        storyId: Number(p.storyId),
        title: String(p.title ?? ""),
      };
    case "token":
      return { type: "token", text: String(p.text ?? "") };
    case "section":
      return {
        type: "section",
        phase: p.phase as
          | "metadata"
          | "metadataDone"
          | "illustrations"
          | "illustrationsPartial",
        total: typeof p.total === "number" ? p.total : undefined,
        title: typeof p.title === "string" ? p.title : undefined,
        summary: typeof p.summary === "string" ? p.summary : undefined,
        failed: Array.isArray(p.failed) ? (p.failed as number[]) : undefined,
      };
    case "illustration":
      return {
        type: "illustration",
        index: Number(p.index),
        total: Number(p.total),
        illustration: p.illustration as Illustration,
      };
    case "done":
      return { type: "done", storyId: Number(p.storyId) };
    case "error":
      return {
        type: "error",
        message: String(p.message ?? "Generation failed"),
        storyId: typeof p.storyId === "number" ? p.storyId : undefined,
      };
    default:
      return null;
  }
}

// Re-export Story for convenience in the streaming UI.
export type { Story };
