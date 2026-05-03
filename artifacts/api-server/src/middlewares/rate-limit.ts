import rateLimit, {
  ipKeyGenerator,
  type RateLimitRequestHandler,
} from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { getUserPlan, getCachedUserPlan } from "../lib/subscriptions";

function clientKey(req: Request): string {
  const author = req.headers["x-author-name"];
  if (typeof author === "string" && author.length > 0) return `author:${author}`;
  return ipKeyGenerator(req.ip ?? "unknown");
}

// Conjurer subscribers get higher burst quotas. We multiply the per-window
// limit rather than skipping entirely so abuse is still rate-limited.
const CONJURER_MULTIPLIER = 10;

function isConjurer(req: Request): boolean {
  const u = req.user;
  if (!u) return false;
  return getCachedUserPlan(u.id) === "conjurer";
}

/**
 * Warms the per-user plan cache so subsequent rate limiters can read it
 * synchronously. Skips for anonymous callers. Cheap (in-memory cache hit
 * after the first request in a 30s window).
 */
export async function attachUserPlan(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (req.user) await getUserPlan(req.user.id);
  } catch {
    // ignore — limiter will treat as free
  }
  next();
}

function tierLimit(base: number) {
  return (req: Request) => (isConjurer(req) ? base * CONJURER_MULTIPLIER : base);
}

export const aiGenerationLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: tierLimit(20),
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
  limit: tierLimit(60),
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
  limit: tierLimit(30),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: "Too many requests. Slow down." },
});
