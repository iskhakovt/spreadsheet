import {
  Anatomy,
  type GroupStatus,
  type GroupStatusRow,
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
   * group (written by an older client), and the key is verified. The layout
   * seals and writes it back.
   */
  profileNeedsReseal?: true;
};

/**
 * Open the sealed fields (name, anatomy, progress) of a status response.
 *
 * Each field opens on its own, and one that's rejected (see `GroupCodec.open`)
 * is dropped rather than failing the whole status. Otherwise any member could
 * blank everyone's screen with one bad write:
 *  - another member's name → `UI.unreadableName`; anatomy / progress → null.
 *  - your own name → "" (routes you to /setup to enter it again); anatomy → null.
 *
 * Fail closed on your OWN ciphertext only: if it exists and nothing has
 * proven the key (`codec.keyVerified`), the link carries the wrong key, so
 * throw {@link WrongKeyError}. Dropping instead would send you to re-enter
 * your fields, sealed under that wrong key, overwriting what the right key
 * can read. Other members' ciphertext that doesn't open is only dropped:
 * you can't overwrite their data, and someone who wrote under a wrong key
 * mustn't be able to lock everyone else out.
 *
 * Your own legacy plaintext in an encrypted group is read as-is and flagged
 * for re-sealing (`profileNeedsReseal`), but only once the key is proven.
 */
export async function decryptStatus(
  // The row type (plain strings) rather than SealedGroupStatus: subscription
  // payloads skip output validation, so they arrive typed as rows. Opening
  // works on any string, and a sealed status is assignable to it.
  raw: GroupStatusRow,
  codec: GroupCodec = getGroupCodec(raw.group.encrypted),
): Promise<LiveGroupStatus> {
  const selfId = raw.person?.id ?? null;
  let ownCiphertext = false;
  let ownLegacyPlaintext = false;

  async function attempt<T>(value: string, schema: PayloadSchema<T>, own: boolean): Promise<OpenResult<T>> {
    if (own && codec.encrypted && sealedModeMatches(value, true)) ownCiphertext = true;
    return codec.tryOpen(value, schema);
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
      progress: m.progress === null ? null : await openOther(m.progress, Progress),
    })),
  );

  if (ownCiphertext && !codec.keyVerified) throw new WrongKeyError();

  const reseal = ownLegacyPlaintext && codec.keyVerified;
  return { ...raw, person, members, ...(reseal ? { profileNeedsReseal: true as const } : {}) };
}
