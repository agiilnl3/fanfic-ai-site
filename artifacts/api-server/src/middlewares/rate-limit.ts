import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";

function clientKey(req: { ip?: string; headers: Record<string, unknown> }): string {
  const author = req.headers["x-author-name"];
  if (typeof author === "string" && author.length > 0) return `author:${author}`;
  return req.ip ?? "unknown";
}

export const aiGenerationLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: "Too many AI generation requests. Please try again later.",
    retryAfter: "1 hour",
  },
});

export const illustrationLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: "Too many illustration requests. Please try again later.",
    retryAfter: "1 hour",
  },
});

export const writeLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: "Too many requests. Slow down." },
});
