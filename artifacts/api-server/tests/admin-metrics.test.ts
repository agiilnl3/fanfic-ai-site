import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/testApp";
import {
  db,
  storiesTable,
  storyLikesTable,
  storyCommentsTable,
} from "@workspace/db";

const adminToken = process.env.ADMIN_PASSWORD ?? "test-admin";

describe("/admin/metrics", () => {
  const app = buildTestApp();
  let publishedId = 0;
  let draftId = 0;
  const author = `t_metrics_${Date.now()}`;

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = adminToken;
    const [pub] = await db
      .insert(storiesTable)
      .values({
        title: "Published metric",
        authorName: author,
        genre: "Test",
        artStyle: "Test",
        status: "published",
        fullText: "x",
      })
      .returning();
    publishedId = pub.id;
    const [draft] = await db
      .insert(storiesTable)
      .values({
        title: "Draft metric",
        authorName: author,
        genre: "Test",
        artStyle: "Test",
        status: "draft",
        fullText: "x",
      })
      .returning();
    draftId = draft.id;
    // Heavy engagement on the DRAFT to verify it must NOT appear in topStories.
    for (let i = 0; i < 25; i++) {
      await db
        .insert(storyLikesTable)
        .values({ storyId: draftId, authorName: `liker_${author}_${i}` })
        .onConflictDoNothing();
    }
    for (let i = 0; i < 5; i++) {
      await db.insert(storyCommentsTable).values({
        storyId: publishedId,
        authorName: `c_${author}_${i}`,
        body: "ok",
      });
    }
  });

  it("returns DAU, top authors, and top stories with the right shape", async () => {
    const res = await request(app)
      .get("/api/admin/metrics")
      .set("x-admin-token", adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.dailyActive)).toBe(true);
    expect(Array.isArray(res.body.topAuthors)).toBe(true);
    expect(Array.isArray(res.body.topStories)).toBe(true);
  });

  it("never includes draft / non-published stories in topStories", async () => {
    const res = await request(app)
      .get("/api/admin/metrics")
      .set("x-admin-token", adminToken);
    expect(res.status).toBe(200);
    const ids: number[] = res.body.topStories.map((s: { id: number }) => s.id);
    expect(ids).not.toContain(draftId);
  });
});
