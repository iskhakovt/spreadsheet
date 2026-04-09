import type { FallbackProps } from "react-error-boundary";
import { Sentry } from "../lib/sentry.js";
import { Button } from "./Button.js";
import { Card } from "./Card.js";

/** Root-level fallback — shown when the entire app crashes */
export function RootErrorFallback({ resetErrorBoundary }: FallbackProps) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center space-y-6 max-w-sm">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-text-muted text-sm">An unexpected error occurred. Your data is safe — it's saved locally.</p>
        <Button fullWidth onClick={resetErrorBoundary}>
          Reload
        </Button>
      </div>
    </div>
  );
}

/** Screen-level fallback — shown when a single screen crashes */
export function ScreenErrorFallback({ resetErrorBoundary }: FallbackProps) {
  return (
    <Card>
      <div className="text-center pt-16 space-y-6">
        <h2 className="text-xl font-bold">Something didn't load</h2>
        <p className="text-text-muted text-sm">This section had a problem. Your progress is saved.</p>
        <Button fullWidth onClick={resetErrorBoundary}>
          Try again
        </Button>
      </div>
    </Card>
  );
}

/** Error handler — logs to console + Sentry */
export function handleError(error: unknown, info: { componentStack?: string | null }) {
  console.error("Error boundary caught:", error, info.componentStack);
  Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
}
