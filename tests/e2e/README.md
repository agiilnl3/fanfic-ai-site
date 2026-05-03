# E2E tests

Playwright-based end-to-end regression tests for the workspace.

## Run

Both the FanFic AI web app and the API server must be running locally
(the standard dev workflows take care of this). The tests hit the
shared path-based proxy at `http://localhost` by default; override
with `E2E_BASE_URL` to target a different environment.

```bash
pnpm --filter @workspace/e2e-tests install
pnpm --filter @workspace/e2e-tests test            # all specs
pnpm --filter @workspace/e2e-tests test:resume     # just the resume test
```

In the Replit dev container, Playwright reuses the pre-installed
Chromium pointed to by `$REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`, so
there is no need to run `playwright install`.

## Specs

- `reading-progress-resume.spec.ts` — seeds a story + saved
  `paragraphIndex` via the API, loads `/story/:id`, asserts the page
  auto-scrolls to the saved cursor, scrolls to the bottom, waits past
  the 3 s persist throttle, and asserts the saved `paragraphIndex`
  advanced. Each run uses a unique pen name, so it is hermetic and
  safe to re-run.
