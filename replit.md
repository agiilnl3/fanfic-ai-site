# FanFic AI

## Overview

AI-powered fanfiction platform where users generate coherent stories illustrated with matching AI artwork. No authentication required — identity is tracked via a pen name stored in localStorage.

pnpm workspace monorepo using TypeScript.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec → `lib/api-spec/openapi.yaml`)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + TanStack Query + wouter routing + shadcn UI
- **AI**: OpenAI via Replit AI proxy (`@workspace/integrations-openai-ai-server`)
- **Image generation**: `generateImageBuffer` from the OpenAI integration (stored as base64 data URLs)

## Architecture

```
artifacts/
  api-server/       — Express 5 API server (port 8080)
  fanfic-ai/        — React + Vite frontend (preview path /)

lib/
  api-spec/         — openapi.yaml (source of truth for all types)
  api-zod/          — Generated Zod validators for request validation
  api-client-react/ — Generated TanStack Query hooks for the frontend
  db/               — Drizzle ORM schema + db client
  integrations-openai-ai-server/ — OpenAI client + image generation helpers
```

## Features

- **AI Story Generation** — POST /api/stories/generate: uses gpt-5.1 to generate title, fullText, summary, characters, then auto-generates 3-4 illustrations in the matching art style
- **Illustrations** — DALL-E generated images stored as base64 data URLs; first image becomes the cover
- **Stories CRUD** — List, get, create, update, delete
- **Publishing** — Stories start as drafts; POST /api/stories/:id/publish makes them public
- **Public Feed** — GET /api/stories/feed returns published stories
- **Stats** — GET /api/stories/stats returns counts and genre breakdown

## Frontend Pages

- `/` — Home: hero, platform stats, recently published stories
- `/create` — Conjure Story: genre/style/length/seed prompt form, immersive loading state during generation (30-60s), redirects to story page on success
- `/story/:id` — Full reading experience with prose text and inline illustrations
- `/feed` — The Grand Library: searchable/filterable published story feed
- `/dashboard` — Author's Desk: pen name management, draft/published tabs, publish/delete actions

## Design

Dark indigo and warm amber theme ("candlelit writer's study"). Fraunces serif for headings, Inter for UI.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Important Notes

- `lib/api-zod/src/index.ts` must only contain `export * from "./generated/api"` — adding extra exports causes duplicate name conflicts with orval codegen
- Images are base64 data URLs — render directly as `<img src={illustration.imageUrl} />`
- Author identity is tracked via `localStorage.getItem("authorName")` — no auth system
- Story generation uses `gpt-5.1` model with `json_object` response format
- Illustrations generated in parallel after text generation, limited to 4 per story

## Performance & Hardening (May 2026)

- **Code-splitting**: `App.tsx` lazy-loads Create/Story/Feed/Dashboard pages with React.lazy + Suspense
- **Feed virtualization**: `pages/feed.tsx` uses `@tanstack/react-virtual` window virtualizer when ≥50 stories
- **Hover prefetch**: `StoryCard` prefetches `getStory(id)` on hover/focus/touch with 30s staleTime
- **Lazy images**: All `<img>` tags use `loading="lazy" decoding="async"`
- **Rate limiting**: `src/middlewares/rate-limit.ts` — `aiGenerationLimiter` (20/h), `illustrationLimiter` (60/h), `writeLimiter` (30/min); key = `X-Author-Name` header or `ipKeyGenerator(req.ip)` (IPv6-safe). `app.set("trust proxy", 1)` set in `app.ts`
- **Tests**: Vitest configured for api-server. `pnpm --filter @workspace/api-server test`. Pure helpers (e.g. `buildIllustrationPrompt` in `src/lib/prompt.ts`) unit-tested

## Deferred (will be configured later via admin panel)

- Auth (Clerk), background queue for AI jobs, PostHog analytics, Sentry error tracking, expanded e2e tests

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
