import { randomUUID } from "node:crypto";
import { Storage, type File } from "@google-cloud/storage";
import { and, asc, eq, like, sql } from "drizzle-orm";
import {
  db,
  pool,
  illustrationsTable,
  storiesTable,
} from "@workspace/db";

// NOTE: This re-implements the storage upload helper from
// artifacts/api-server/src/lib/uploadIllustration.ts and the public ACL bit
// from objectAcl.ts because @workspace/api-server does not expose its
// internals as a package export. If the production upload layout changes,
// update both call sites.

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const ACL_POLICY_METADATA_KEY = "custom:aclPolicy";

const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  const p = path.startsWith("/") ? path : `/${path}`;
  const parts = p.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`Invalid object path: ${path}`);
  return { bucketName: parts[0]!, objectName: parts.slice(1).join("/") };
}

async function setPublicAcl(file: File): Promise<void> {
  await file.setMetadata({
    metadata: {
      [ACL_POLICY_METADATA_KEY]: JSON.stringify({
        owner: "system",
        visibility: "public",
      }),
    },
  });
}

async function uploadIllustrationBuffer(
  buffer: Buffer,
  contentType = "image/png",
): Promise<string> {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const id = randomUUID();
  const fullPath = `${dir.replace(/\/$/, "")}/uploads/${id}`;
  const { bucketName, objectName } = parseObjectPath(fullPath);
  const file = storage.bucket(bucketName).file(objectName);
  await file.save(buffer, {
    contentType,
    metadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
    resumable: false,
  });
  await setPublicAcl(file);
  return `/api/storage/objects/uploads/${id}`;
}

const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s;

function decodeDataUrl(
  dataUrl: string,
): { buffer: Buffer; contentType: string } | null {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return null;
  const contentType = m[1]!;
  const base64 = m[2]!;
  return { buffer: Buffer.from(base64, "base64"), contentType };
}

async function main(): Promise<void> {
  if (!process.env.PRIVATE_OBJECT_DIR) {
    throw new Error(
      "PRIVATE_OBJECT_DIR not set. Set it before running this migration.",
    );
  }
  console.log("Migrating base64 illustrations to Object Storage...");

  // Step 1: snapshot every base64 illustration row that needs migration.
  // We capture the original data URL here so that, after we rewrite the
  // illustrations table, we can still match story covers byte-for-byte
  // against what their first illustration *was*.
  const baseIllustrations = await db
    .select({
      id: illustrationsTable.id,
      storyId: illustrationsTable.storyId,
      sectionIndex: illustrationsTable.sectionIndex,
      imageUrl: illustrationsTable.imageUrl,
    })
    .from(illustrationsTable)
    .where(like(illustrationsTable.imageUrl, "data:image/%"));

  // Step 2: snapshot every base64 story cover and resolve its current first
  // illustration (by section_index, id) — *before* any updates — so we can
  // compare original data URLs and decide whether to reuse the illustration's
  // new URL or upload the cover independently.
  const baseCovers = await db
    .select({
      id: storiesTable.id,
      coverImageUrl: storiesTable.coverImageUrl,
    })
    .from(storiesTable)
    .where(
      sql`${storiesTable.coverImageUrl} IS NOT NULL AND ${storiesTable.coverImageUrl} LIKE 'data:image/%'`,
    );

  type CoverPlan = {
    storyId: number;
    coverDataUrl: string;
    matchIllustrationId: number | null;
  };
  const coverPlans: Array<CoverPlan> = [];
  for (const story of baseCovers) {
    const cover = story.coverImageUrl;
    if (!cover) continue;
    const firstRows = await db
      .select({
        id: illustrationsTable.id,
        imageUrl: illustrationsTable.imageUrl,
      })
      .from(illustrationsTable)
      .where(eq(illustrationsTable.storyId, story.id))
      .orderBy(asc(illustrationsTable.sectionIndex), asc(illustrationsTable.id))
      .limit(1);
    const first = firstRows[0];
    coverPlans.push({
      storyId: story.id,
      coverDataUrl: cover,
      matchIllustrationId:
        first && first.imageUrl === cover ? first.id : null,
    });
  }

  // Step 3: upload each base64 illustration and update the row. Track
  // id -> newUrl so covers whose original equalled the first illustration
  // can reuse the same URL without re-uploading the same blob.
  const illustrationNewUrl = new Map<number, string>();
  let illMigrated = 0;
  let illSkipped = 0;
  for (const row of baseIllustrations) {
    const decoded = decodeDataUrl(row.imageUrl);
    if (!decoded) {
      console.warn(
        `[illustrations] id=${row.id}: could not decode data URL; skipping`,
      );
      illSkipped += 1;
      continue;
    }
    const newUrl = await uploadIllustrationBuffer(
      decoded.buffer,
      decoded.contentType,
    );
    // Use a guarded WHERE so a concurrent writer cannot clobber a fresh URL.
    await db
      .update(illustrationsTable)
      .set({ imageUrl: newUrl })
      .where(
        and(
          eq(illustrationsTable.id, row.id),
          eq(illustrationsTable.imageUrl, row.imageUrl),
        ),
      );
    illustrationNewUrl.set(row.id, newUrl);
    illMigrated += 1;
    console.log(
      `[illustrations] id=${row.id} -> ${newUrl} (${decoded.buffer.length} bytes)`,
    );
  }

  // Step 4: migrate story covers using the snapshot.
  let covMigrated = 0;
  let covSkipped = 0;
  for (const plan of coverPlans) {
    let newUrl: string | null = null;

    if (plan.matchIllustrationId !== null) {
      // Cover bytes were identical to the first illustration's original
      // data URL — reuse the URL we just wrote for that illustration.
      newUrl = illustrationNewUrl.get(plan.matchIllustrationId) ?? null;
    }

    if (!newUrl) {
      // Either the cover differs from the first illustration, or the first
      // illustration was not migrated in this run (e.g. it was already a
      // non-base64 URL). Upload the cover independently.
      const decoded = decodeDataUrl(plan.coverDataUrl);
      if (!decoded) {
        console.warn(
          `[stories] id=${plan.storyId}: could not decode cover data URL; skipping`,
        );
        covSkipped += 1;
        continue;
      }
      newUrl = await uploadIllustrationBuffer(
        decoded.buffer,
        decoded.contentType,
      );
    }

    await db
      .update(storiesTable)
      .set({ coverImageUrl: newUrl })
      .where(
        and(
          eq(storiesTable.id, plan.storyId),
          eq(storiesTable.coverImageUrl, plan.coverDataUrl),
        ),
      );
    covMigrated += 1;
    console.log(
      `[stories] id=${plan.storyId} cover -> ${newUrl}` +
        (plan.matchIllustrationId !== null
          ? ` (reused illustration ${plan.matchIllustrationId})`
          : ""),
    );
  }

  console.log(
    `Done. illustrations: migrated=${illMigrated} skipped=${illSkipped}; ` +
      `stories.cover_image_url: migrated=${covMigrated} skipped=${covSkipped}`,
  );
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
