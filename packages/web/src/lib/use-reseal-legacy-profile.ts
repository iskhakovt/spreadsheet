import { useEffect, useRef } from "react";
import { usePersonApp } from "./person-app-context.js";
import { useSaveProfile } from "./use-save-profile.js";

/**
 * Re-encrypt the caller's own name and anatomy when they were stored as
 * plaintext in an encrypted group (`profileNeedsReseal`, set by
 * `decryptStatus`). An older client leaked them that way; this seals them
 * with the group key and writes them back, once per mount. The status
 * refetch after the save clears the flag.
 *
 * Skipped while the name is empty: that's the /setup case, and saving
 * there seals both fields anyway.
 */
export function useResealLegacyProfile(): void {
  const { authedStatus, codec } = usePersonApp();
  const { save } = useSaveProfile(codec);
  const started = useRef(false);
  const { profileNeedsReseal, person } = authedStatus;

  useEffect(() => {
    if (!profileNeedsReseal || !person.name || started.current) return;
    started.current = true;
    void save({ name: person.name, anatomy: person.anatomy });
  }, [profileNeedsReseal, person.name, person.anatomy, save]);
}
