import { Helmet } from "react-helmet-async";

interface SeoProps {
  title?: string;
  description?: string;
  image?: string;
  type?: "website" | "article";
  author?: string;
  publishedTime?: string;
}

const SITE_NAME = "FanFic AI";
const DEFAULT_DESCRIPTION =
  "AI-powered fanfiction platform — generate richly illustrated stories from a single prompt. Every tale is a uniquely crafted manuscript.";

export function Seo({
  title,
  description = DEFAULT_DESCRIPTION,
  image,
  type = "website",
  author,
  publishedTime,
}: SeoProps) {
  const fullTitle = title ? `${title} · ${SITE_NAME}` : `${SITE_NAME} — Conjure Worlds with Ink & Algorithm`;
  const url = typeof window !== "undefined" ? window.location.href : "";

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />

      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:site_name" content={SITE_NAME} />
      {image && <meta property="og:image" content={image} />}
      {author && <meta property="article:author" content={author} />}
      {publishedTime && <meta property="article:published_time" content={publishedTime} />}

      <meta name="twitter:card" content={image ? "summary_large_image" : "summary"} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      {image && <meta name="twitter:image" content={image} />}
    </Helmet>
  );
}
