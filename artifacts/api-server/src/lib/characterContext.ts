import { eq, inArray } from "drizzle-orm";
import {
  db,
  charactersTable,
  storyCharactersTable,
  type Character,
} from "@workspace/db";
import {
  generateImageBuffer,
  editImagesFromBuffers,
} from "@workspace/integrations-openai-ai-server/image";
import { objectStorageClient } from "./objectStorage";
import type { CharacterRef } from "./prompt";

// Load all characters linked to a story (via story_characters join).
// Used by every illustration codepath so a character that was added on
// chapter 1 also appears in chapter 2's illustrations automatically.
export async function loadStoryCharacters(
  storyId: number,
): Promise<Character[]> {
  const links = await db
    .select({ characterId: storyCharactersTable.characterId })
    .from(storyCharactersTable)
    .where(eq(storyCharactersTable.storyId, storyId));
  if (links.length === 0) return [];
  const ids = links.map((l) => l.characterId);
  return await db
    .select()
    .from(charactersTable)
    .where(inArray(charactersTable.id, ids));
}

export function toCharacterRefs(rows: Character[]): CharacterRef[] {
  return rows.map((r) => ({
    name: r.name,
    description: r.description,
    referenceImageUrl: r.referenceImageUrl,
  }));
}

// Reference image URLs are emitted as `/api/storage/objects/uploads/<id>`
// by uploadIllustrationBuffer. To pass them to the OpenAI edit endpoint
// we need to round-trip back to bytes — fetch them straight from the
// storage bucket so we don't depend on the API serving itself.
async function downloadReferenceBuffer(url: string): Promise<Buffer | null> {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) return null;
  const m = url.match(/\/api\/storage\/objects\/(.+)$/);
  if (!m) return null;
  const objectSubpath = m[1]!;
  const fullPath = `${dir.replace(/\/$/, "")}/${objectSubpath}`;
  const stripped = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
  const parts = stripped.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const bucketName = parts[0]!;
  const objectName = parts.slice(1).join("/");
  try {
    const [buf] = await objectStorageClient
      .bucket(bucketName)
      .file(objectName)
      .download();
    return buf;
  } catch {
    return null;
  }
}

// Generate an illustration. If any of the linked characters have an
// uploaded reference image, route through the edit endpoint with the
// references attached so the generated image keeps those characters
// visually consistent. Otherwise fall back to plain text-to-image.
export async function generateIllustrationForCharacters(
  prompt: string,
  characters: Character[],
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024",
): Promise<Buffer> {
  const refUrls = characters
    .map((c) => c.referenceImageUrl)
    .filter((u): u is string => !!u)
    .slice(0, 4);
  if (refUrls.length === 0) {
    return await generateImageBuffer(prompt, size);
  }
  const buffers: Buffer[] = [];
  for (const u of refUrls) {
    const b = await downloadReferenceBuffer(u);
    if (b) buffers.push(b);
  }
  if (buffers.length === 0) {
    return await generateImageBuffer(prompt, size);
  }
  return await editImagesFromBuffers(buffers, prompt, size);
}
