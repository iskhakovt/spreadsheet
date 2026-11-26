import {
  Anatomy,
  type GroupStatus,
  type GroupStatusRow,
  KeyCheck,
  type Member,
  type PayloadSchema,
  type Person,
  PersonName,
  Progress,
  sealedModeMatches,
} from "@spreadsheet/shared";
import { type GroupCodec, getGroupCodec, type OpenResult, WrongKeyError } from "./codec.js";
import { UI } from "./strings.js";

/** Group status as the cache holds it: every sealed field opened. */
export type LiveGroupStatus = GroupStatus & {
  /**
   * The caller's own name or anatomy is legacy plaintext in an encrypted
   * group. Set whether or not the key is proven yet; `useResealLegacyProfile`
   * re-seals it once `codec.keyProven`.
   */
  profileHasLegacyPlaintext?: true;
  /**
   * The caller's own ciphertext is in the status, but none of it opened and
   * nothing has proven the key yet. The journal may still prove it, so
   * `assertKeyNotRefuted` decides after hydration.
   */
  ownCiphertextUnproven?: true;
};

/**
 * Open the sealed fields (name, anatomy, progress) of a status response.
 * A rejected field is dropped, not the whole status, so one bad write can't
 * blank everyone's screen: another member's name becomes `UI.unreadableName`,
 * your own name "" (routes you to /setup), and anatomy / progress null.
 *
 * The group's key check, when it has one, proves the key or throws
 * {@link WrongKeyError} before any field is opened. Without one, if your own
 * ciphertext is present and none of it opens, the status is flagged
 * `ownCiphertextUnproven`, and `assertKeyNotRefuted` throws
 * {@link WrongKeyError} unless your journal proves the key first. Other
 * members' ciphertext is only dropped. Your own legacy plaintext is read and
 * flagged (`profileHasLegacyPlaintext`). See design/sync.md § Sealed values.
 */
export async function decryptStatus(
  // The row type (plain strings) rather than SealedGroupStatus: subscription
  // payloads skip output validation, so they arrive typed as rows.
  raw: GroupStatusRow,
  codec: GroupCodec = getGroupCodec(raw.group.encrypted),
): Promise<LiveGroupStatus> {
  const { keyCheck, ...group } = raw.group;
  if (codec.encrypted && keyCheck !== null) await verifyKeyCheck(keyCheck, codec);

  const selfId = raw.person?.id ?? null;
  let ownCiphertext = false;
  let ownCiphertextOpened = false;
  let ownLegacyPlaintext = false;

  async function attempt<T>(value: string, schema: PayloadSchema<T>, own: boolean): Promise<OpenResult<T>> {
    const result = await codec.tryOpen(value, schema);
    if (own && codec.encrypted && sealedModeMatches(value, true)) {
      ownCiphertext = true;
      // Decrypted, even if the payload then failed its schema: GCM authenticated it.
      if (result.ok || result.reason === "payload") ownCiphertextOpened = true;
    }
    return result;
  }

  async function openOther<T>(value: string, schema: PayloadSchema<T>): Promise<T | null> {
    const result = await attempt(value, schema, false);
    if (result.ok) return result.value;
    console.error(`Dropping another member's field (${result.reason})`);
    return null;
  }

  async function openOwnField<T>(value: string, schema: PayloadSchema<T>): Promise<T | null> {
    const result = await attempt(value, schema, true);
    if (result.ok) return result.value;
    if (result.reason === "mode") {
      const legacy = codec.openLegacyPlaintext(value, schema);
      if (legacy !== null) {
        ownLegacyPlaintext = true;
        return legacy;
      }
    }
    console.error(`Dropping your own field (${result.reason})`);
    return null;
  }

  /** Your own progress: counts as your own ciphertext, but has no legacy plaintext to accept. */
  async function openOwnStrict<T>(value: string, schema: PayloadSchema<T>): Promise<T | null> {
    const result = await attempt(value, schema, true);
    if (result.ok) return result.value;
    console.error(`Dropping your own field (${result.reason})`);
    return null;
  }

  async function openProfile(fields: {
    id: string;
    name: string;
    anatomy: string | null;
  }): Promise<{ name: string; anatomy: Anatomy | null }> {
    const own = fields.id === selfId;
    const open = own ? openOwnField : openOther;
    const name = await open(fields.name, PersonName);
    return {
      name: name ?? (own ? "" : UI.unreadableName),
      anatomy: fields.anatomy === null ? null : await open(fields.anatomy, Anatomy),
    };
  }

  const person: Person | null = raw.person ? { ...raw.person, ...(await openProfile(raw.person)) } : null;
  const members: Member[] = await Promise.all(
    raw.members.map(async (m) => ({
      ...m,
      ...(await openProfile(m)),
      progress: m.progress === null ? null : await (m.id === selfId ? openOwnStrict : openOther)(m.progress, Progress),
    })),
  );

  // Only your own server-side data proves the key: another member's value
  // opening shows only that this key matches whoever wrote it.
  if (ownCiphertextOpened) codec.markKeyProven();
  const unproven = ownCiphertext && !codec.keyProven;

  return {
    ...raw,
    group,
    person,
    members,
    ...(ownLegacyPlaintext ? { profileHasLegacyPlaintext: true as const } : {}),
    ...(unproven ? { ownCiphertextUnproven: true as const } : {}),
  };
}

/**
 * Decides the key for everyone, including someone with no data of their own
 * yet. A key check that isn't ciphertext proves nothing, so it's ignored.
 */
async function verifyKeyCheck(keyCheck: string, codec: GroupCodec): Promise<void> {
  const result = await codec.tryOpen(keyCheck, KeyCheck);
  if (result.ok || result.reason === "payload") codec.markKeyProven();
  else if (result.reason === "decrypt") throw new WrongKeyError();
  else console.error(`Ignoring the group's key check (${result.reason})`);
}

/**
 * Throws {@link WrongKeyError} when the status flagged your own ciphertext
 * as unopened and nothing of yours has proven the key since. The layout's
 * `AuthedShell` calls it after journal hydration (so the journal can prove
 * the key first) and on every render, so the key-mismatch screen shows
 * before any screen can write.
 */
export function assertKeyNotRefuted(status: Pick<LiveGroupStatus, "ownCiphertextUnproven">, codec: GroupCodec): void {
  if (status.ownCiphertextUnproven && !codec.keyProven) throw new WrongKeyError();
}
