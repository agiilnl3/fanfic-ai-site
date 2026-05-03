import type { Plugin, Connect } from "vite";
import type { IncomingMessage, ServerResponse } from "http";
import { readFileSync, existsSync } from "fs";
import path from "path";

// Lightweight SSR-style meta injection for `/story/:id` routes so
// social-card crawlers (Twitter/X, Facebook, Discord, Telegram, Slack)
// see absolute og:image / og:title / og:description tags in the
// initial HTML response — Helmet alone runs on the client only and
// most crawlers don't execute JS.
//
// We don't actually render React on the server. We just patch the
// shipped index.html with a few extra <meta> tags before sending it.
//
// Story metadata is fetched from the API server (same origin behind
// the proxy in production; via PUBLIC_API_BASE_URL or 127.0.0.1:8080
// in dev).
export function ssrOgPlugin(): Plugin {
  const STORY_RE = /^\/story\/(\d+)\/?$/;

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildMetaBlock(args: {
    storyId: number;
    title: string;
    description: string;
    authorName: string;
    origin: string;
  }): string {
    const og = `${args.origin}/api/og/${args.storyId}`;
    const fullTitle = `${args.title} · FanFic AI`;
    const url = `${args.origin}/story/${args.storyId}`;
    return [
      `<title>${escapeHtml(fullTitle)}</title>`,
      `<meta name="description" content="${escapeHtml(args.description)}"/>`,
      `<link rel="canonical" href="${url}"/>`,
      `<meta property="og:type" content="article"/>`,
      `<meta property="og:title" content="${escapeHtml(fullTitle)}"/>`,
      `<meta property="og:description" content="${escapeHtml(args.description)}"/>`,
      `<meta property="og:url" content="${url}"/>`,
      `<meta property="og:site_name" content="FanFic AI"/>`,
      `<meta property="og:image" content="${og}"/>`,
      `<meta property="og:image:width" content="1200"/>`,
      `<meta property="og:image:height" content="630"/>`,
      `<meta property="article:author" content="${escapeHtml(args.authorName)}"/>`,
      `<meta name="twitter:card" content="summary_large_image"/>`,
      `<meta name="twitter:title" content="${escapeHtml(fullTitle)}"/>`,
      `<meta name="twitter:description" content="${escapeHtml(args.description)}"/>`,
      `<meta name="twitter:image" content="${og}"/>`,
    ].join("\n    ");
  }

  function injectIntoHead(html: string, block: string): string {
    if (html.includes("</head>")) {
      return html.replace("</head>", `    ${block}\n  </head>`);
    }
    return `${block}\n${html}`;
  }

  function getOrigin(req: IncomingMessage): string {
    const proto =
      (req.headers["x-forwarded-proto"] as string)?.split(",")[0] ?? "http";
    const host =
      (req.headers["x-forwarded-host"] as string) ??
      (req.headers.host as string) ??
      "localhost";
    return `${proto}://${host}`;
  }

  async function fetchStoryMeta(
    storyId: number,
    origin: string,
  ): Promise<{
    title: string;
    summary: string | null;
    authorName: string;
    genre: string;
    status: string;
  } | null> {
    const candidates = [
      process.env.PUBLIC_API_BASE_URL,
      "http://127.0.0.1:8080",
      origin,
    ].filter(Boolean) as string[];
    for (const base of candidates) {
      try {
        const r = await fetch(`${base}/api/stories/${storyId}`);
        if (!r.ok) continue;
        const j = (await r.json()) as Record<string, unknown>;
        return {
          title: String(j.title ?? ""),
          summary: (j.summary as string | null) ?? null,
          authorName: String(j.authorName ?? ""),
          genre: String(j.genre ?? ""),
          status: String(j.status ?? ""),
        };
      } catch {
        /* try next */
      }
    }
    return null;
  }

  const handler =
    (loadHtml: (url: string) => Promise<string> | string): Connect.NextHandleFunction =>
    (req, res, next) => {
      void (async () => {
        try {
          const url = (req.url ?? "").split("?")[0];
          const m = STORY_RE.exec(url);
          if (!m) return next();
          // crawlers send Accept: text/html; skip XHRs/assets
          const accept = String(req.headers.accept ?? "");
          if (!accept.includes("text/html")) return next();
          const storyId = Number(m[1]);
          const origin = getOrigin(req);
          const meta = await fetchStoryMeta(storyId, origin);
          if (!meta || meta.status !== "published") return next();
          const baseHtml = await loadHtml(url);
          const description =
            meta.summary ??
            `A ${meta.genre} story by ${meta.authorName} on FanFic AI.`;
          const block = buildMetaBlock({
            storyId,
            title: meta.title,
            description,
            authorName: meta.authorName,
            origin,
          });
          const out = injectIntoHead(baseHtml, block);
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          (res as ServerResponse).end(out);
        } catch {
          next();
        }
      })();
    };

  return {
    name: "fanfic-ssr-og",
    apply: () => true,
    configureServer(server) {
      server.middlewares.use(
        handler(async (url) => {
          const indexPath = path.resolve(server.config.root, "index.html");
          const raw = readFileSync(indexPath, "utf-8");
          return server.transformIndexHtml(url, raw);
        }),
      );
    },
    configurePreviewServer(server) {
      const distIndex = path.resolve(
        server.config.root,
        server.config.build.outDir,
        "index.html",
      );
      server.middlewares.use(
        handler(async () => {
          if (!existsSync(distIndex)) return "";
          return readFileSync(distIndex, "utf-8");
        }),
      );
    },
  };
}
