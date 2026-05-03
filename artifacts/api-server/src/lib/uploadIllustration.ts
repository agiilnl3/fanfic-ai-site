import { randomUUID } from "crypto";
import { objectStorageClient } from "./objectStorage";
import { setObjectAclPolicy } from "./objectAcl";

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  const p = path.startsWith("/") ? path : `/${path}`;
  const parts = p.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`Invalid object path: ${path}`);
  return { bucketName: parts[0]!, objectName: parts.slice(1).join("/") };
}

export async function uploadIllustrationBuffer(
  buffer: Buffer,
  contentType = "image/png",
): Promise<string> {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const id = randomUUID();
  const fullPath = `${dir.replace(/\/$/, "")}/uploads/${id}`;
  const { bucketName, objectName } = parseObjectPath(fullPath);
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(buffer, {
    contentType,
    metadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
    resumable: false,
  });
  await setObjectAclPolicy(file, { owner: "system", visibility: "public" });
  return `/api/storage/objects/uploads/${id}`;
}
