import { KEY_CHECK, type KeyCheck } from "@spreadsheet/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { usePersonApp } from "./person-app-context.js";
import { useTRPC } from "./trpc.js";

/**
 * Give an older encrypted group its key check, from an admin's page whose
 * status is strong evidence for the key (`keyCheckFillable`, set by
 * `decryptStatus`). Once per mount. From then on the check proves or refutes
 * every link's key on load (design/sync.md § Key verification).
 *
 * Best effort: on failure the group keeps the checks it had, and the next
 * load tries again.
 */
export function useFillKeyCheck(): void {
  const { authedStatus, codec } = usePersonApp();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { mutateAsync } = useMutation(
    trpc.groups.fillKeyCheck.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.groups.status.pathKey() }),
    }),
  );
  const started = useRef(false);
  const fillable = !!authedStatus.keyCheckFillable && authedStatus.person.isAdmin;

  useEffect(() => {
    if (!fillable || started.current) return;
    started.current = true;
    void (async () => {
      try {
        await mutateAsync({ keyCheck: await codec.seal<KeyCheck>(KEY_CHECK) });
      } catch (err) {
        console.error("Couldn't fill in the group's key check:", err);
      }
    })();
  }, [fillable, codec, mutateAsync]);
}
