/**
 * E2E regression test for the paragraph-level reading-progress resume
 * on the FanFic AI story page.
 *
 * Guards against regressions in:
 * - artifacts/fanfic-ai/src/pages/story.tsx (resume effect + scroll
 *   handler that persists window cursor / paragraphIndex)
 * - artifacts/api-server/src/routes/library.ts (GET/POST
 *   /stories/:id/progress, which now round-trip paragraphIndex)
 * - lib/db/src/schema/library.ts (paragraph_index column)
 *
 * Run with:
 *   pnpm --filter @workspace/e2e-tests test:resume
 *
 * Hermetic: each run uses a unique pen name so it can be re-run.
 */
import { test, expect, request as pwRequest } from "@playwright/test";

const PARAGRAPH_COUNT = 80;
const SEED_PARAGRAPH_INDEX = 30;
const SEED_PROGRESS = 35;
// Persist throttle in story.tsx is 3000ms; wait a bit longer.
const PERSIST_THROTTLE_MS = 4_000;

function buildFullText(n: number): string {
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    lines.push(
      `Paragraph ${i}: lorem ipsum dolor sit amet, consectetur adipiscing elit. ` +
        `Vivamus laoreet, mauris vel placerat hendrerit, lectus risus dignissim odio.`,
    );
  }
  return lines.join("\n\n");
}

test("auto-resumes to saved paragraph and persists advanced cursor on scroll", async ({
  page,
  baseURL,
}) => {
  expect(baseURL, "baseURL must be set in playwright.config").toBeTruthy();

  const authorName = `e2e-resume-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}`;
  // The API write-rate limiter is keyed by IP unless x-author-name is
  // supplied; sending the unique pen name keeps repeated suite runs
  // hermetic and avoids cross-test throttling.
  const api = await pwRequest.newContext({
    baseURL,
    extraHTTPHeaders: { "x-author-name": authorName },
  });

  // 1. Seed a story with many paragraphs.
  const createRes = await api.post("/api/stories", {
    data: {
      title: "E2E Resume Test",
      genre: "Fantasy",
      artStyle: "Digital Art",
      lengthSetting: "short",
      authorName,
      fullText: buildFullText(PARAGRAPH_COUNT),
    },
  });
  expect(createRes.ok(), `create story: ${createRes.status()}`).toBeTruthy();
  const story = (await createRes.json()) as { id: number };
  const storyId = story.id;
  expect(storyId).toBeGreaterThan(0);

  // 2. Seed reading progress with a non-zero paragraphIndex.
  const seedProg = await api.post(`/api/stories/${storyId}/progress`, {
    data: {
      authorName,
      progress: SEED_PROGRESS,
      paragraphIndex: SEED_PARAGRAPH_INDEX,
    },
  });
  expect(seedProg.ok(), `seed progress: ${seedProg.status()}`).toBeTruthy();
  const seeded = (await seedProg.json()) as { paragraphIndex: number };
  expect(seeded.paragraphIndex).toBe(SEED_PARAGRAPH_INDEX);

  // 3. Set the pen name in localStorage on the same origin, then load
  //    the story page so the resume effect fires.
  await page.goto("/");
  await page.evaluate((name) => {
    window.localStorage.setItem("fanfic_author", name);
  }, authorName);

  await page.goto(`/story/${storyId}`);

  // Wait for the seeded paragraph anchor to render.
  const anchor = page.locator(
    `[data-paragraph-index="${SEED_PARAGRAPH_INDEX}"]`,
  );
  await anchor.waitFor({ state: "attached", timeout: 15_000 });

  // 4. The resume effect schedules a scroll on a timeout (~80ms).
  //    Poll for window.scrollY > 50 instead of a fixed sleep so the
  //    test stays stable on slow runs.
  await expect
    .poll(() => page.evaluate(() => window.scrollY), {
      timeout: 5_000,
      message: "page should auto-scroll to saved paragraphIndex",
    })
    .toBeGreaterThan(50);

  // 5. The seeded paragraph should sit near the top of the viewport
  //    (story.tsx scrolls to el.top - 80). Allow some slack.
  const anchorTop = await anchor.evaluate(
    (el) => el.getBoundingClientRect().top,
  );
  expect(anchorTop).toBeGreaterThan(-50);
  expect(anchorTop).toBeLessThan(250);

  // 6. Scroll all the way to the bottom and nudge the listener so the
  //    throttled persist actually fires.
  await page.evaluate(() => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "auto",
    });
    window.dispatchEvent(new Event("scroll"));
  });

  // 7. Wait past the persist throttle, then verify the saved cursor
  //    advanced past the seed.
  await page.waitForTimeout(PERSIST_THROTTLE_MS);

  const finalRes = await api.get(
    `/api/stories/${storyId}/progress?authorName=${encodeURIComponent(
      authorName,
    )}`,
  );
  expect(finalRes.ok(), `get progress: ${finalRes.status()}`).toBeTruthy();
  const final = (await finalRes.json()) as {
    paragraphIndex: number;
    progress: number;
  };

  expect(
    final.paragraphIndex,
    `paragraphIndex should advance past seed (${SEED_PARAGRAPH_INDEX}); got ${final.paragraphIndex}`,
  ).toBeGreaterThan(SEED_PARAGRAPH_INDEX);
  expect(final.progress).toBeGreaterThanOrEqual(SEED_PROGRESS);

  await api.dispose();
});
