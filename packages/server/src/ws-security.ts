/**
 * Returns true if the WebSocket upgrade should be allowed.
 * Non-browser clients omit Origin — those are trusted (e.g. integration tests,
 * server-to-server). Browsers always send Origin; reject any that don't match
 * the server host to block Cross-Site WebSocket Hijacking (CSWSH).
 *
 * `host` is the request's Host header. It is client-controlled, but the threat
 * model holds: in a real CSWSH the attacker's browser sends the legitimate
 * Host (the connection terminates at our server) and the attacker's own Origin
 * — so the comparison still rejects them. Don't try to "harden" this by
 * reading Forwarded / X-Forwarded-Host without understanding why those would
 * weaken rather than strengthen the check.
 */
export function isAllowedOrigin(origin: string | undefined, host: string): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).host === host.toLowerCase();
  } catch {
    return false; // malformed origin
  }
}
