import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/testApp";
import { db, storiesTable } from "@workspace/db";

describe("/stories/:id/progress monotonicity", () => {
  const app = buildTestApp();
  const author = `t_progress_${Date.now()}`;
  let storyId = 0;

  beforeAll(async () => {
    const [s] = await db
      .insert(storiesTable)
      .values({
        title: "Progress test",
        authorName: author,
        genre: "Test",
        artStyle: "Test",
        status: "published",
        fullText: "x",
      })
      .returning();
    storyId = s.id;
  });

  it("never decreases the saved progress percentage", async () => {
    const post = (progress: number, paragraphIndex = 0) =>
      request(app)
        .post(`/api/stories/${storyId}/progress`)
        .send({ authorName: author, progress, paragraphIndex });

    const get = () =>
      request(app)
        .get(`/api/stories/${storyId}/progress`)
        .query({ authorName: author });

    const high = await post(80, 5);
    expect(high.status).toBe(200);
    expect(high.body.progress).toBe(80);

    const low = await post(10, 1);
    expect(low.status).toBe(200);

    const got = await get();
    expect(got.status).toBe(200);
    expect(got.body.progress).toBe(80);
    // paragraphIndex tracks the latest cursor even if progress doesn't move.
    expect(got.body.paragraphIndex).toBe(1);
  });
});
