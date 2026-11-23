import type { Anatomy } from "@spreadsheet/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useErrorBoundary } from "react-error-boundary";
import type { GroupCodec } from "./codec.js";
import { getScope } from "./session.js";
import { useTRPC } from "./trpc.js";

export interface ProfileInput {
  name: string;
  anatomy: Anatomy | null;
}

/**
 * Save the caller's own profile through `groups.setProfile`, sealing both
 * fields with the group's codec first. Pass plaintext; `setProfile`'s input
 * type only accepts sealed values, so nothing else compiles.
 *
 * `saving` covers the whole operation, sealing included. The mutation alone
 * only goes pending once sealing has finished, which left a window where a
 * second click submitted again. A failure (seal or request) goes to the
 * screen's error boundary, which offers a retry.
 */
export function useSaveProfile(codec: GroupCodec) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { showBoundary } = useErrorBoundary();
  const mutation = useMutation(
    trpc.groups.setProfile.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.groups.status.pathKey() }),
    }),
  );

  // The ref is the guard (synchronous, so two clicks in one frame can't
  // both pass); the state drives `disabled`.
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);

  async function save(profile: Readonly<ProfileInput>): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    // Requests carry whatever session the tab is on when they go out. If a
    // same-tab token switch lands while we're sealing, this profile belongs
    // to the previous person: drop it rather than write it to the next one.
    const scope = getScope();
    try {
      const sealed = {
        name: await codec.seal(profile.name),
        anatomy: profile.anatomy === null ? null : await codec.seal<Anatomy>(profile.anatomy),
      };
      if (getScope() !== scope) return;
      await mutation.mutateAsync(sealed);
    } catch (err) {
      showBoundary(err);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return { save, saving };
}
