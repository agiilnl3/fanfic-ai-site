import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, storiesTable } from "@workspace/db";

const router: IRouter = Router();

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

router.get("/sitemap.xml", async (req, res): Promise<void> => {
  const proto = (req.headers["x-forwarded-proto"] as string) ?? req.protocol ?? "https";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const base = `${proto}://${host}`;

  const stories = await db
    .select({
      id: storiesTable.id,
      updatedAt: storiesTable.updatedAt,
    })
    .from(storiesTable)
    .where(eq(storiesTable.status, "published"))
    .orderBy(desc(storiesTable.updatedAt))
    .limit(5000);

  const urls = [
    { loc: `${base}/`, priority: "1.0", changefreq: "daily" },
    { loc: `${base}/feed`, priority: "0.9", changefreq: "hourly" },
    { loc: `${base}/create`, priority: "0.7", changefreq: "monthly" },
    ...stories.map((s) => ({
      loc: `${base}/story/${s.id}`,
      lastmod: s.updatedAt.toISOString(),
      priority: "0.8",
      changefreq: "weekly" as const,
    })),
  ];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url>\n    <loc>${escapeXml(u.loc)}</loc>\n` +
          ("lastmod" in u && u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : "") +
          `    <changefreq>${u.changefreq}</changefreq>\n` +
          `    <priority>${u.priority}</priority>\n` +
          `  </url>`,
      )
      .join("\n") +
    `\n</urlset>\n`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(xml);
});

router.get("/robots.txt", (req, res): void => {
  const proto = (req.headers["x-forwarded-proto"] as string) ?? req.protocol ?? "https";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const base = `${proto}://${host}`;
  res.type("text/plain").send(`User-agent: *\nAllow: /\n\nSitemap: ${base}/api/sitemap.xml\n`);
});

export default router;
