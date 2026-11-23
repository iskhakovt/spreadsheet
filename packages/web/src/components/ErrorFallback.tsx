import type { FallbackProps } from "react-error-boundary";
import { Button } from "./Button.js";
import { Card } from "./Card.js";

function isMissingKeyError(error: unknown): boolean {
  if (error instanceof Error && "code" in error && (error as { code: string }).code === "MISSING_GROUP_KEY")
    return true;
  // Fallback for errors that don't carry the code (e.g., re-thrown by a framework)
  return error instanceof Error && error.message.includes("decrypt without group key");
}

function errorCode(error: unknown): string | null {
  return error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : null;
}

/**
 * Shown when the link's key doesn't fit the group: it opens none of the
 * group's encrypted values (wrong key), or the group isn't encrypted at all
 * (a key that shouldn't be there). Nothing is written in either case.
 */
export function KeyMismatchScreen() {
  return (
    <Card>
      <div className="text-center pt-16 space-y-4">
        <h1 className="text-2xl font-bold">This link's key doesn't match</h1>
        <p className="text-text-muted text-sm">
          The encryption key in this link doesn't fit this group, so nothing was loaded or changed. Ask the person who
          shared it to resend the full link.
        </p>
      </div>
    </Card>
  );
}

/** The key screen for a key error, or null for any other error. */
function keyErrorScreen(error: unknown) {
  if (isMissingKeyError(error)) return <MissingKeyScreen />;
  const code = errorCode(error);
  if (code === "WRONG_GROUP_KEY" || code === "UNEXPECTED_GROUP_KEY") return <KeyMismatchScreen />;
  return null;
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
  const keyScreen = keyErrorScreen(error);
  if (keyScreen) return keyScreen;
  return (
    <div className="min-h-dvh flex items-center justify-center px-6">
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
  const keyScreen = keyErrorScreen(error);
  if (keyScreen) return keyScreen;
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

/** Error handler — logs to console */
export function handleError(error: unknown, info: { componentStack?: string | null }) {
  console.error("Error boundary caught:", error, info.componentStack);
}
