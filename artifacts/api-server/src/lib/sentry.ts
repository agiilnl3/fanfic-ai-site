import type {
  Request,
  Response,
  NextFunction,
  RequestHandler,
  ErrorRequestHandler,
} from "express";
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

export function captureError(
  err: unknown,
  ctx?: Record<string, unknown>,
): void {
  if (!initialized || !sentry) return;
  try {
    sentry.captureException(err, ctx ? { extra: ctx } : undefined);
  } catch {
    // never let Sentry crash the request path
  }
}

/**
 * Express middleware: attach the authenticated user (set by attachUser
 * earlier in the chain) to the current Sentry scope so errors include
 * user context in the dashboard.
 */
export function sentryUserContextMiddleware(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (initialized && sentry) {
      try {
        const user = (
          req as Request & { user?: { id?: number; email?: string } }
        ).user;
        if (user?.id != null) {
          sentry.setUser({ id: String(user.id), email: user.email });
        }
      } catch {
        // ignore — never block the request
      }
    }
    next();
  };
}

/**
 * Express request-scope middleware. Sentry's modern SDK auto-instruments
 * incoming HTTP via OpenTelemetry once init() is called, but we also
 * isolate each request to its own scope so user/tags do not leak.
 */
export function sentryRequestMiddleware(): RequestHandler {
  return (_req: Request, _res: Response, next: NextFunction) => {
    if (initialized && sentry) {
      try {
        sentry.withScope(() => next());
        return;
      } catch {
        // fall through
      }
    }
    next();
  };
}

/**
 * Express error handler. Mount LAST in the middleware chain so it sees
 * unhandled exceptions from any route. Forwards to Sentry then defers
 * to the next error handler (or the default Express one).
 */
export function sentryErrorMiddleware(): ErrorRequestHandler {
  return (err: unknown, req: Request, _res: Response, next: NextFunction) => {
    if (initialized && sentry) {
      try {
        sentry.captureException(err, {
          extra: {
            url: req.originalUrl,
            method: req.method,
            userId: (req as Request & { user?: { id?: number } }).user?.id,
          },
        });
      } catch {
        // never let Sentry crash the error path
      }
    }
    next(err);
  };
}
