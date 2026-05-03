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
import { openai } from "@workspace/integrations-openai-ai-server";
import { objectStorageClient } from "./objectStorage";
import { logger } from "./logger";
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

// Filter the linked-character list down to just the ones who actually
// appear in this section of prose. We use a tiny LLM classification
// pass: cheap, deterministic, and fails open (returns the full list)
// so a transient OpenAI hiccup never blocks an illustration.
export async function filterCharactersInSection(
  sectionText: string,
  characters: Character[],
): Promise<Character[]> {
  if (characters.length <= 1) return characters;
  const trimmed = sectionText.trim();
  if (!trimmed) return characters;
  const namesList = characters.map((c) => c.name);
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a literary assistant. Given a story passage and a list of character names, decide which of those exact characters appear, are referenced by name, or are clearly the speaker/POV in the passage. Reply with strict JSON of the form {\"present\":[\"Name1\",\"Name2\"]}. Use the exact names from the input list. If none match, return an empty array.",
        },
        {
          role: "user",
          content: `Characters: ${JSON.stringify(namesList)}\n\nPassage:\n${trimmed.slice(0, 4000)}`,
        },
      ],
    });
    const raw = resp.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as { present?: unknown };
    if (!Array.isArray(parsed.present)) return characters;
    const present = new Set(
      parsed.present.filter((n): n is string => typeof n === "string"),
    );
    const filtered = characters.filter((c) => present.has(c.name));
    return filtered.length > 0 ? filtered : characters;
  } catch (err) {
    logger.warn(
      { err },
      "filterCharactersInSection failed; falling back to all linked characters",
    );
    return characters;
  }
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
