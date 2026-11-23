import {
  Anatomy,
  type GroupStatus,
  type GroupStatusRow,
  type Member,
  type PayloadSchema,
  type Person,
  PersonName,
  Progress,
} from "@spreadsheet/shared";
import { type GroupCodec, getGroupCodec } from "./codec.js";
import { UI } from "./strings.js";

/** Group status as the cache holds it: every sealed field opened. */
export type LiveGroupStatus = GroupStatus & {
  /**
   * The caller's own name or anatomy is legacy plaintext in an encrypted
   * group (written by an older client). The layout seals and writes it back.
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
 * Your own profile fields are also opened with `openOwn`, which accepts
 * legacy plaintext in an encrypted group and flags it for re-sealing.
 */
export async function decryptStatus(
  // The row type (plain strings) rather than SealedGroupStatus: subscription
  // payloads skip output validation, so they arrive typed as rows. Opening
  // works on any string, and a sealed status is assignable to it.
  raw: GroupStatusRow,
  codec: GroupCodec = getGroupCodec(raw.group.encrypted),
): Promise<LiveGroupStatus> {
  const selfId = raw.person?.id ?? null;
  let needsReseal = false;

  async function openOwn<T>(value: string, schema: PayloadSchema<T>): Promise<T | null> {
    const opened = await codec.openOwn(value, schema);
    if (opened?.needsReseal) needsReseal = true;
    return opened?.value ?? null;
  }

  async function openProfile(fields: {
    id: string;
    name: string;
    anatomy: string | null;
  }): Promise<{ name: string; anatomy: Anatomy | null }> {
    if (fields.id === selfId) {
      return {
        name: (await openOwn(fields.name, PersonName)) ?? "",
        anatomy: fields.anatomy === null ? null : await openOwn(fields.anatomy, Anatomy),
      };
    }
    return {
      name: (await codec.openOrDrop(fields.name, PersonName)) ?? UI.unreadableName,
      anatomy: fields.anatomy === null ? null : await codec.openOrDrop(fields.anatomy, Anatomy),
    };
  }

  const person: Person | null = raw.person ? { ...raw.person, ...(await openProfile(raw.person)) } : null;
  const members: Member[] = await Promise.all(
    raw.members.map(async (m) => ({
      ...m,
      ...(await openProfile(m)),
      progress: m.progress === null ? null : await codec.openOrDrop(m.progress, Progress),
    })),
  );

  return { ...raw, person, members, ...(needsReseal ? { profileNeedsReseal: true as const } : {}) };
}
