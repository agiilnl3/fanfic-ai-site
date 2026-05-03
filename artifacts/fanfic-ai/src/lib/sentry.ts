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
      tracesSampleRate: Number(
        import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? "0.1",
      ),
    });
    initialized = true;
  } catch {
    // swallow — Sentry failures must never block the app boot
  }
}
