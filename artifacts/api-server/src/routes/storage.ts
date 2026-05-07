import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { createHash } from "crypto";
import sharp from "sharp";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getObjectAclPolicy } from "../lib/objectAcl";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const IMG_ALLOWED_WIDTHS = new Set([200, 300, 400, 600, 800, 1024, 1200, 1600]);
const IMG_ALLOWED_FORMATS = new Set(["webp", "jpeg", "png", "avif"]);
const IMG_ALLOWED_QUERY_KEYS = new Set(["w", "format"]);
// Hard cap on the source object we'll pull into memory + hand to sharp.
// Anything larger is almost certainly not a story illustration / cover.
const IMG_MAX_SOURCE_BYTES = 25 * 1024 * 1024; // 25 MiB
// Refuse decompression bombs early (sharp default is 0.5 GP).
const IMG_MAX_PIXELS = 60_000_000; // 60 MP

async function streamFileToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// On-the-fly image transcoder. Mirrors /storage/objects/*path but
// returns a sharp-resized + re-encoded variant. Clients pass
// ?w=400&format=webp; we clamp to a small allowlist of widths and
// formats so we don't render arbitrary sizes (which would blow up
// the cache and let an attacker force the worker to do CPU work).
// Long s-maxage because the underlying object is content-addressed
// (uploads/{uuid}) and immutable.
router.get("/storage/img/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    // Strict query schema: reject anything other than (w, format) so
    // a caller can't fragment the CDN cache (and force the worker to
    // re-transcode) by appending unique cache-busters like
    // ?w=600&format=webp&t=<random>.
    for (const k of Object.keys(req.query)) {
      if (!IMG_ALLOWED_QUERY_KEYS.has(k)) {
        res.status(400).json({ error: `unexpected query parameter: ${k}` });
        return;
      }
    }
    const wRaw = Number(req.query.w);
    const fmtRaw = String(req.query.format ?? "webp").toLowerCase();
    const w =
      Number.isFinite(wRaw) && IMG_ALLOWED_WIDTHS.has(wRaw) ? wRaw : 800;
    const fmt = IMG_ALLOWED_FORMATS.has(fmtRaw) ? fmtRaw : "webp";

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const acl = await getObjectAclPolicy(objectFile);
    if (acl?.visibility !== "public") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [metadata] = await objectFile.getMetadata();
    // Refuse to transcode anything that isn't an image, or that is
    // larger than our source cap. Both gates run before we pull bytes
    // into memory or hand anything to sharp.
    const srcContentType =
      (metadata.contentType as string | undefined) ?? "";
    if (!srcContentType.startsWith("image/")) {
      res.status(415).json({ error: "Source is not an image" });
      return;
    }
    const srcSize = Number(metadata.size ?? 0);
    if (Number.isFinite(srcSize) && srcSize > IMG_MAX_SOURCE_BYTES) {
      res.status(413).json({ error: "Source image too large to transcode" });
      return;
    }
    const sourceEtag =
      (metadata.etag as string | undefined) ??
      (metadata.md5Hash as string | undefined) ??
      String(metadata.generation ?? "");
    const variantHash = createHash("sha1")
      .update(`${sourceEtag}|${w}|${fmt}`)
      .digest("hex")
      .slice(0, 16);
    const etag = `"img-${variantHash}"`;

    const ifNoneMatch = req.header("if-none-match");
    if (ifNoneMatch && ifNoneMatch === etag) {
      res.setHeader("ETag", etag);
      res.setHeader(
        "Cache-Control",
        "public, max-age=86400, s-maxage=2592000, immutable",
      );
      res.status(304).end();
      return;
    }

    const sourceBuf = await streamFileToBuffer(objectFile.createReadStream());
    let pipeline = sharp(sourceBuf, {
      failOn: "none",
      limitInputPixels: IMG_MAX_PIXELS,
    })
      .rotate()
      .resize({
        width: w,
        withoutEnlargement: true,
        fit: "inside",
      });
    let contentType = "image/webp";
    if (fmt === "webp") {
      pipeline = pipeline.webp({ quality: 80, effort: 4 });
    } else if (fmt === "jpeg") {
      pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
      contentType = "image/jpeg";
    } else if (fmt === "png") {
      pipeline = pipeline.png({ compressionLevel: 9 });
      contentType = "image/png";
    } else if (fmt === "avif") {
      pipeline = pipeline.avif({ quality: 60, effort: 4 });
      contentType = "image/avif";
    }
    const out = await pipeline.toBuffer();

    res.setHeader("Content-Type", contentType);
    res.setHeader("ETag", etag);
    res.setHeader("Vary", "Accept");
    // Variant URLs include the (w,format) in the query, and the
    // underlying object is content-addressed by random uuid, so we
    // can cache aggressively.
    res.setHeader(
      "Cache-Control",
      "public, max-age=86400, s-maxage=2592000, immutable",
    );
    res.send(out);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error transcoding object image");
    res.status(500).json({ error: "Failed to transcode image" });
  }
});

router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const acl = await getObjectAclPolicy(objectFile);
    if (acl?.visibility !== "public") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const response = await objectStorageService.downloadObject(objectFile, 60 * 60 * 24 * 30);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
