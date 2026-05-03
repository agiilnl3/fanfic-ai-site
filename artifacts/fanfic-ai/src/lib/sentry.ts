import * as Sentry from "@sentry/react";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined) ?? "";
  if (!dsn) return;
  try {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      // release ties uploaded source maps (CI step "Upload fanfic-ai
      // source maps to Sentry") to events captured at runtime so
      // browser stack traces are symbolicated in the dashboard.
      release:
        (import.meta.env.VITE_SENTRY_RELEASE as string | undefined) ??
        undefined,
      tracesSampleRate: Number(
        import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? "0.1",
      ),
    });
    initialized = true;
  } catch {
    // swallow — Sentry failures must never block the app boot
  }
}

/**
 * Attach the authenticated user to the Sentry scope so any error
 * reported from the browser is tagged with their id. Call from the
 * auth provider whenever the session changes; pass null on logout.
 */
export function setSentryUser(
  user: { id: string | number; email?: string } | null,
): void {
  if (!initialized) return;
  try {
    if (!user) {
      Sentry.setUser(null);
    } else {
      Sentry.setUser({ id: String(user.id), email: user.email });
    }
  } catch {
    // ignore
  }
}
