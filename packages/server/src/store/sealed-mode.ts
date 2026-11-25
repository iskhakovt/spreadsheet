import { sealedModeMatches } from "@spreadsheet/shared";

/**
 * True if every value was sealed in the group's mode: `e:` in encrypted
 * groups, `p:` in plaintext ones. `null` / `undefined` pass, since they're
 * absent values (unset anatomy, a push without progress), not mis-sealed ones.
 *
 * Every store write of a sealed field checks this before writing, so a client
 * bug can't store plaintext in an encrypted group (or the reverse).
 */
export function sealedInGroupMode(values: readonly (string | null | undefined)[], encrypted: boolean): boolean {
  return values.every((value) => value == null || sealedModeMatches(value, encrypted));
}
