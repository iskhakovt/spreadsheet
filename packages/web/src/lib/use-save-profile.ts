import type { Anatomy } from "@spreadsheet/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useErrorBoundary } from "react-error-boundary";
import { wrapSensitive } from "./crypto.js";
import { useTRPC } from "./trpc.js";

export interface ProfileInput {
  name: string;
  anatomy: Anatomy | null;
}

/**
 * Save the caller's own profile through `groups.setProfile`, wrapping both
 * fields first. Pass plaintext: in encrypted groups the wrap is what keeps
 * name and anatomy off the server in the clear.
 *
 * `saving` covers the whole operation, wrap included. The mutation alone
 * only goes pending once wrapping has finished, which left a window where a
 * second click submitted again. A failure (wrap or request) goes to the
 * screen's error boundary, which offers a retry.
 */
export function useSaveProfile() {
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
    try {
      await mutation.mutateAsync({
        name: await wrapSensitive(profile.name),
        anatomy: profile.anatomy ? await wrapSensitive(profile.anatomy) : null,
      });
    } catch (err) {
      showBoundary(err);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return { save, saving };
}
