import app from "./app";
import { logger } from "./lib/logger";
import { bootstrapBranchingSchema } from "./lib/bootstrapSchema";
import { startEmbeddingBackfill } from "./lib/embeddings";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Run branching-storylines DDL safety net before accepting traffic so
// /chapter-tree never 500s on a missing relation in a freshly
// provisioned DB. Idempotent.
void bootstrapBranchingSchema().finally(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
    // Lazily backfill embeddings for any published stories that don't
    // have one yet. Runs once per boot, capped, in the background.
    startEmbeddingBackfill();
  });
});
