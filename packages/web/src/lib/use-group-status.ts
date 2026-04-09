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

export function useGroupStatus(token: string, pollMs = DEFAULT_POLL_MS) {
  const [status, setStatus] = useState<GroupStatus | null | "loading" | "error">("loading");

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

  useEffect(() => {
    refresh();
  }, [token]);

  useEffect(() => {
    const interval = setInterval(refresh, getEffectivePoll(pollMs));
    return () => clearInterval(interval);
  }, [token, pollMs]);

  return { status, refresh };
}
