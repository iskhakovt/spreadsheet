import { useEffect, useState } from "react";
import { decryptStatus } from "./decrypt-status.js";
import { trpc } from "./trpc.js";

type GroupStatus = NonNullable<Awaited<ReturnType<typeof trpc.groups.status.query>>>;

const DEFAULT_POLL_MS = 30_000;

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
    const interval = setInterval(refresh, pollMs);
    return () => clearInterval(interval);
  }, [token, pollMs]);

  return { status, refresh };
}
