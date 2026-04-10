import { useEffect, useState } from "react";
import { decryptStatus } from "./decrypt-status.js";
import { trpc } from "./trpc.js";

type GroupStatus = NonNullable<Awaited<ReturnType<typeof trpc.groups.status.query>>>;

const DEFAULT_POLL_MS = 30_000;

/** Runtime override via window.__ENV.POLL_MS (set by server, used by E2E tests for fast polling). */
function getEffectivePoll(pollMs: number): number {
  const override = (window as { __ENV?: { POLL_MS?: string } }).__ENV?.POLL_MS;
  return override ? Number(override) : pollMs;
}

/**
 * Subscribes to real-time group status via WebSocket and falls back to HTTP
 * polling if the WS isn't delivering. The fallback covers: initial mount
 * (before WS connects), WS errors, and CF Tunnel/proxy environments where
 * WebSocket is blocked.
 *
 * API surface unchanged from the polling-only era — `status` and `refresh()`.
 */
export function useGroupStatus(token: string, pollMs = DEFAULT_POLL_MS) {
  const [status, setStatus] = useState<GroupStatus | null | "loading" | "error">("loading");
  const [wsConnected, setWsConnected] = useState(false);

  async function fetchAndDecryptStatus(): Promise<GroupStatus | null> {
    const raw = await trpc.groups.status.query({ token });
    if (!raw) return null;
    return decryptStatus(raw);
  }

  function refresh(): Promise<void> {
    return fetchAndDecryptStatus()
      .then(setStatus)
      .catch((err) => {
        console.error("Failed to fetch status:", err);
        setStatus("error");
      });
  }

  // Initial fetch — runs once per token, ensures the UI has data even if WS
  // is slow to connect (or never connects).
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Real-time subscription via WebSocket.
  useEffect(() => {
    const sub = trpc.groups.onStatus.subscribe(undefined, {
      onStarted: () => setWsConnected(true),
      onData: async (raw) => {
        if (!raw) return;
        try {
          const decrypted = await decryptStatus(raw);
          setStatus(decrypted);
          setWsConnected(true);
        } catch (err) {
          console.error("Failed to decrypt WS status:", err);
        }
      },
      onError: (err) => {
        console.error("WS subscription error:", err);
        setWsConnected(false);
      },
      onComplete: () => setWsConnected(false),
    });
    return () => {
      sub.unsubscribe();
      setWsConnected(false);
    };
  }, [token]);

  // Polling fallback — only runs while WS is NOT delivering data.
  useEffect(() => {
    if (wsConnected) return;
    const interval = setInterval(refresh, getEffectivePoll(pollMs));
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, pollMs, wsConnected]);

  return { status, refresh };
}
