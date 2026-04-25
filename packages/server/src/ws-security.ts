/**
 * Returns true if the WebSocket upgrade should be allowed.
 * Non-browser clients omit Origin — those are trusted (e.g. integration tests,
 * server-to-server). Browsers always send Origin; reject any that don't match
 * the server host to block Cross-Site WebSocket Hijacking (CSWSH).
 */
export function isAllowedOrigin(origin: string | undefined, host: string): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false; // malformed origin
  }
}
