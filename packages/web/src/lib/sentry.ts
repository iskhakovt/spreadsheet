import "./env-config.js";
import * as Sentry from "@sentry/react";

export function initSentry() {
  const dsn = window.__ENV?.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

export { Sentry };
