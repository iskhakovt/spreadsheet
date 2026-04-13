import type { FallbackProps } from "react-error-boundary";
import { Sentry } from "../lib/sentry.js";
import { Button } from "./Button.js";
import { Card } from "./Card.js";

function isMissingKeyError(error: unknown): boolean {
  return error instanceof Error && error.message === "Cannot decrypt without group key";
}

/** Shown when an encrypted group is opened without the #key= fragment */
export function MissingKeyScreen() {
  return (
    <Card>
      <div className="text-center pt-16 space-y-4">
        <h1 className="text-2xl font-bold">Encryption key missing</h1>
        <p className="text-text-muted text-sm">
          This group is encrypted, but the key wasn't included in your link. Ask the person who shared it to resend the
          full link.
        </p>
      </div>
    </Card>
  );
}

/** Root-level fallback — shown when the entire app crashes */
export function RootErrorFallback({ error, resetErrorBoundary }: Readonly<FallbackProps>) {
  if (isMissingKeyError(error)) {
    return <MissingKeyScreen />;
  }
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
export function ScreenErrorFallback({ error, resetErrorBoundary }: Readonly<FallbackProps>) {
  if (isMissingKeyError(error)) {
    return <MissingKeyScreen />;
  }
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
