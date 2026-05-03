import { createHash } from "crypto";
import { openai } from "@workspace/integrations-openai-ai-server";
import { objectStorageClient } from "./objectStorage";
import { setObjectAclPolicy } from "./objectAcl";
import { logger } from "./logger";
import { traceOpenAI } from "./sentry";

export type TtsVoice =
  | "alloy"
  | "echo"
  | "fable"
  | "onyx"
  | "nova"
  | "shimmer";

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  const p = path.startsWith("/") ? path : `/${path}`;
  const parts = p.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`Invalid object path: ${path}`);
  return { bucketName: parts[0]!, objectName: parts.slice(1).join("/") };
}

function ttsKey(text: string, voice: TtsVoice): string {
  const h = createHash("sha256")
    .update(`tts-1|${voice}|${text}`)
    .digest("hex")
    .slice(0, 24);
  return `tts/${h}.mp3`;
}

export interface TtsResult {
  buffer: Buffer;
  url: string;
  cached: boolean;
}

export async function synthesizeStoryNarration(
  text: string,
  voice: TtsVoice = "nova",
): Promise<TtsResult> {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const key = ttsKey(text, voice);
  const fullPath = `${dir.replace(/\/$/, "")}/uploads/${key}`;
  const { bucketName, objectName } = parseObjectPath(fullPath);
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  const url = `/api/storage/objects/uploads/${key}`;

  try {
    const [exists] = await file.exists();
    if (exists) {
      const [buf] = await file.download();
      return { buffer: buf, url, cached: true };
    }
  } catch (err) {
    logger.warn({ err }, "tts cache lookup failed; regenerating");
  }

  const resp = await traceOpenAI("tts.synthesize", () =>
    openai.audio.speech.create({
      model: "tts-1",
      voice,
      input: text,
      response_format: "mp3",
    }),
  );
  const buffer = Buffer.from(await resp.arrayBuffer());
  await file.save(buffer, {
    contentType: "audio/mpeg",
    metadata: {
      contentType: "audio/mpeg",
      cacheControl: "public, max-age=31536000, immutable",
    },
    resumable: false,
  });
  await setObjectAclPolicy(file, { owner: "system", visibility: "public" });
  return { buffer, url, cached: false };
}
