import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/testApp";
import {
  db,
  seriesTable,
  seriesStoriesTable,
  storiesTable,
  hiddenStoriesTable,
} from "@workspace/db";

describe("/series/:id moderation filter", () => {
  const app = buildTestApp();
  const author = `t_series_${Date.now()}`;
  let seriesId = 0;
  let visibleId = 0;
  let hiddenId = 0;
  let draftId = 0;

  beforeAll(async () => {
    const [series] = await db
      .insert(seriesTable)
      .values({ title: "Test series", authorName: author })
      .returning();
    seriesId = series.id;
    const mk = async (status: "published" | "draft") => {
      const [s] = await db
        .insert(storiesTable)
        .values({
          title: `${status} story`,
          authorName: author,
          genre: "Test",
          artStyle: "Test",
          status,
          fullText: "x",
        })
        .returning();
      return s.id;
    };
    visibleId = await mk("published");
    hiddenId = await mk("published");
    draftId = await mk("draft");
    await db.insert(seriesStoriesTable).values([
      { seriesId, storyId: visibleId, position: 1 },
      { seriesId, storyId: hiddenId, position: 2 },
      { seriesId, storyId: draftId, position: 3 },
    ]);
    await db
      .insert(hiddenStoriesTable)
      .values({ storyId: hiddenId, reason: "test" })
      .onConflictDoNothing();
  });

  it("returns only published, non-hidden stories to the public", async () => {
    const res = await request(app).get(`/api/series/${seriesId}`);
    expect(res.status).toBe(200);
    const ids: number[] = (res.body.stories ?? []).map(
      (s: { id: number }) => s.id,
    );
    expect(ids).toContain(visibleId);
    expect(ids).not.toContain(hiddenId);
    expect(ids).not.toContain(draftId);
  });
});
