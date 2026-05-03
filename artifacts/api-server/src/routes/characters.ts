import { Router, type IRouter } from "express";
import { and, eq, inArray, desc } from "drizzle-orm";
import {
  db,
  charactersTable,
  storyCharactersTable,
  storiesTable,
  seriesTable,
  type Character,
} from "@workspace/db";
import {
  ListCharactersQueryParams,
  CreateCharacterBody,
  UpdateCharacterParams,
  UpdateCharacterBody,
  DeleteCharacterParams,
  DeleteCharacterQueryParams,
  UploadCharacterReferenceParams,
  UploadCharacterReferenceBody,
  ListStoryCharactersParams,
  SetStoryCharactersParams,
  SetStoryCharactersBody,
  ListSeriesCharactersParams,
} from "@workspace/api-zod";
import { uploadIllustrationBuffer } from "../lib/uploadIllustration";
import { canEditStory, canEditSeries } from "../lib/storyAuthz";
import { writeLimiter } from "../middlewares/rate-limit";

const router: IRouter = Router();

// Strict ownership check: only ever trusts the authenticated principal
// (req.user). The request body MUST NOT influence this — `ownerHandle`
// from the body is just used to namespace lists, not to grant authority.
function ownsCharacter(
  c: Pick<Character, "ownerUserId" | "ownerHandle">,
  user: { id: number; handle: string } | null | undefined,
): boolean {
  if (!user) return false;
  if (c.ownerUserId != null) return c.ownerUserId === user.id;
  // Legacy row with no stable user id: fall back to handle comparison
  // against the trusted req.user.handle (never the request body).
  return c.ownerHandle === user.handle;
}

router.get("/characters", async (req, res): Promise<void> => {
  const parsed = ListCharactersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { ownerHandle, seriesId } = parsed.data;
  const conditions = [eq(charactersTable.ownerHandle, ownerHandle)];
  if (seriesId != null) {
    conditions.push(eq(charactersTable.seriesId, seriesId));
  }
  const rows = await db
    .select()
    .from(charactersTable)
    .where(and(...conditions))
    .orderBy(desc(charactersTable.createdAt));
  res.json(rows);
});

router.post(
  "/characters",
  writeLimiter,
  async (req, res): Promise<void> => {
    const parsed = CreateCharacterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { ownerHandle, name, description, seriesId } = parsed.data;
    // overrideClientIdentity has already forced ownerHandle to the
    // authenticated handle on writes, but defend in depth here too.
    if (!req.user || req.user.handle !== ownerHandle) {
      res.status(403).json({ error: "ownerHandle must match your pen name" });
      return;
    }
    if (seriesId != null) {
      const [series] = await db
        .select()
        .from(seriesTable)
        .where(eq(seriesTable.id, seriesId));
      if (!series) {
        res.status(404).json({ error: "Series not found" });
        return;
      }
      if (!canEditSeries(series, req.user ?? null)) {
        res.status(403).json({ error: "Not the series owner" });
        return;
      }
    }
    const [row] = await db
      .insert(charactersTable)
      .values({
        ownerUserId: req.user?.id ?? null,
        ownerHandle,
        name,
        description: description ?? "",
        seriesId: seriesId ?? null,
      })
      .returning();
    res.status(201).json(row);
  },
);

router.patch(
  "/characters/:id",
  writeLimiter,
  async (req, res): Promise<void> => {
    const params = UpdateCharacterParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = UpdateCharacterBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const [existing] = await db
      .select()
      .from(charactersTable)
      .where(eq(charactersTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "Character not found" });
      return;
    }
    if (!ownsCharacter(existing, req.user ?? null)) {
      res.status(403).json({ error: "Not the character owner" });
      return;
    }
    // If the caller is reassigning the character to a (different) series,
    // verify they can edit that target series. Otherwise an author could
    // dump their character into another author's series and pollute it.
    if (
      body.data.seriesId !== undefined &&
      body.data.seriesId !== existing.seriesId
    ) {
      if (body.data.seriesId !== null) {
        const [series] = await db
          .select()
          .from(seriesTable)
          .where(eq(seriesTable.id, body.data.seriesId));
        if (!series) {
          res.status(404).json({ error: "Series not found" });
          return;
        }
        if (!canEditSeries(series, req.user ?? null)) {
          res.status(403).json({ error: "Not the series owner" });
          return;
        }
      }
    }
    const patch: Partial<typeof charactersTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.data.name != null) patch.name = body.data.name;
    if (body.data.description != null) patch.description = body.data.description;
    if (body.data.seriesId !== undefined) patch.seriesId = body.data.seriesId;
    const [row] = await db
      .update(charactersTable)
      .set(patch)
      .where(eq(charactersTable.id, params.data.id))
      .returning();
    res.json(row);
  },
);

router.delete(
  "/characters/:id",
  writeLimiter,
  async (req, res): Promise<void> => {
    const params = DeleteCharacterParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const q = DeleteCharacterQueryParams.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: q.error.message });
      return;
    }
    const [existing] = await db
      .select()
      .from(charactersTable)
      .where(eq(charactersTable.id, params.data.id));
    if (!existing) {
      res.status(204).end();
      return;
    }
    if (!ownsCharacter(existing, req.user ?? null)) {
      res.status(403).json({ error: "Not the character owner" });
      return;
    }
    await db
      .delete(charactersTable)
      .where(eq(charactersTable.id, params.data.id));
    res.status(204).end();
  },
);

// Reference image upload via base64 — keeps the route boundary simple
// and avoids pulling in multer just for this one path. Cap the encoded
// payload at ~6 MB so a runaway upload can't OOM the API container.
const MAX_REF_BYTES = 6 * 1024 * 1024;
router.post(
  "/characters/:id/reference",
  writeLimiter,
  async (req, res): Promise<void> => {
    const params = UploadCharacterReferenceParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = UploadCharacterReferenceBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    if (body.data.imageBase64.length > MAX_REF_BYTES) {
      res.status(413).json({ error: "Image too large (max 6 MB encoded)" });
      return;
    }
    const [existing] = await db
      .select()
      .from(charactersTable)
      .where(eq(charactersTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "Character not found" });
      return;
    }
    if (!ownsCharacter(existing, req.user ?? null)) {
      res.status(403).json({ error: "Not the character owner" });
      return;
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(body.data.imageBase64, "base64");
    } catch {
      res.status(400).json({ error: "Invalid base64 payload" });
      return;
    }
    if (buffer.length === 0) {
      res.status(400).json({ error: "Empty image payload" });
      return;
    }
    const url = await uploadIllustrationBuffer(
      buffer,
      body.data.contentType ?? "image/png",
    );
    const [row] = await db
      .update(charactersTable)
      .set({ referenceImageUrl: url, updatedAt: new Date() })
      .where(eq(charactersTable.id, params.data.id))
      .returning();
    res.json(row);
  },
);

router.get("/stories/:id/characters", async (req, res): Promise<void> => {
  const params = ListStoryCharactersParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const links = await db
    .select({ characterId: storyCharactersTable.characterId })
    .from(storyCharactersTable)
    .where(eq(storyCharactersTable.storyId, params.data.id));
  if (links.length === 0) {
    res.json([]);
    return;
  }
  const ids = links.map((l) => l.characterId);
  const rows = await db
    .select()
    .from(charactersTable)
    .where(inArray(charactersTable.id, ids));
  res.json(rows);
});

router.put(
  "/stories/:id/characters",
  writeLimiter,
  async (req, res): Promise<void> => {
    const params = SetStoryCharactersParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = SetStoryCharactersBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
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
    if (!canEditStory(story, req.user ?? null)) {
      res.status(403).json({ error: "Only the author or co-author may set characters" });
      return;
    }
    const ids = Array.from(new Set(body.data.characterIds));
    // Verify the caller owns each character before linking — prevents
    // a bug where one author could attach another author's character to
    // their own story (and silently leak the reference image).
    if (ids.length > 0) {
      const owned = await db
        .select()
        .from(charactersTable)
        .where(inArray(charactersTable.id, ids));
      for (const c of owned) {
        if (!ownsCharacter(c, req.user ?? null)) {
          res
            .status(403)
            .json({ error: `Not the owner of character ${c.id}` });
          return;
        }
      }
      if (owned.length !== ids.length) {
        res.status(404).json({ error: "One or more characters not found" });
        return;
      }
    }
    await db
      .delete(storyCharactersTable)
      .where(eq(storyCharactersTable.storyId, params.data.id));
    if (ids.length > 0) {
      await db
        .insert(storyCharactersTable)
        .values(ids.map((cid) => ({ storyId: params.data.id, characterId: cid })));
      const rows = await db
        .select()
        .from(charactersTable)
        .where(inArray(charactersTable.id, ids));
      res.json(rows);
      return;
    }
    res.json([]);
  },
);

router.get("/series/:id/characters", async (req, res): Promise<void> => {
  const params = ListSeriesCharactersParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(charactersTable)
    .where(eq(charactersTable.seriesId, params.data.id))
    .orderBy(desc(charactersTable.createdAt));
  res.json(rows);
});

export default router;
