import { logger } from "./logger";

type SentryModule = typeof import("@sentry/node");
let sentry: SentryModule | null = null;
let initialized = false;

export async function initSentry(): Promise<void> {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    sentry = (await import("@sentry/node")) as SentryModule;
    sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      release: process.env.SENTRY_RELEASE,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    });
    initialized = true;
    logger.info("sentry initialized");
  } catch (err) {
    logger.warn({ err }, "sentry init skipped (package or DSN unavailable)");
  }
}

export async function traceOpenAI<T>(
  op: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!initialized || !sentry) return fn();
  return sentry.startSpan({ name: op, op: "ai.openai" }, fn);
}

export function captureError(err: unknown, ctx?: Record<string, unknown>): void {
  if (!initialized || !sentry) return;
  try {
    sentry.captureException(err, ctx ? { extra: ctx } : undefined);
  } catch {
    // never let Sentry crash the request path
  }
}
