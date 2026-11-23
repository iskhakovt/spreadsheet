import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { usePersonApp } from "./person-app-context.js";
import { useSaveProfile } from "./use-save-profile.js";

/**
 * Re-seal the caller's own name and anatomy when they're legacy plaintext in
 * an encrypted group (`profileHasLegacyPlaintext`, set by `decryptStatus`),
 * once per mount. The status refetch after the save clears the flag.
 *
 * Waits for `codec.keyProven` (your own server-side ciphertext opened):
 * sealing under an unproven key could publish your profile under a wrong one.
 *
 * Skipped on /setup and /anatomy, which save the profile themselves: a
 * background write there could land after the person's own save and put the
 * old values back. Also skipped while the name is empty (the /setup case).
 */
export function useResealLegacyProfile(): void {
  const { authedStatus, codec } = usePersonApp();
  const { save } = useSaveProfile(codec);
  const started = useRef(false);
  const { profileHasLegacyPlaintext, person } = authedStatus;
  const keyProven = codec.keyProven;
  const { pathname } = useLocation();
  const onProfileScreen = pathname.endsWith("/setup") || pathname.endsWith("/anatomy");

  useEffect(() => {
    if (!profileHasLegacyPlaintext || !keyProven || !person.name || onProfileScreen || started.current) return;
    started.current = true;
    void save({ name: person.name, anatomy: person.anatomy });
  }, [profileHasLegacyPlaintext, keyProven, person.name, person.anatomy, onProfileScreen, save]);
}
