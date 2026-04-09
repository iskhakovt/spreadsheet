import { unwrapSensitive } from "./crypto.js";
import { decodeValue, getGroupKeyFromUrl } from "./crypto.js";

/**
 * Decode sensitive fields (names, anatomy) in a group status response.
 * Uses unwrapSensitive which handles both raw strings (plaintext groups)
 * and opaque strings (encrypted groups) transparently.
 * When person is null (admin token pre-setup), returns status unchanged.
 */
export async function decryptStatus<
  T extends {
    person: { name: string; anatomy: string | null; [k: string]: unknown } | null;
    group: { encrypted: boolean; [k: string]: unknown };
    members: Array<{ name: string; anatomy: string | null; progress: string | null; [k: string]: unknown }>;
  },
>(status: T): Promise<T> {
  if (!status.person) return status;

  const groupKey = getGroupKeyFromUrl();
  const isEncrypted = groupKey && status.group.encrypted;

  const decryptedPerson = {
    ...status.person,
    name: await unwrapSensitive(status.person.name),
    anatomy: status.person.anatomy ? await unwrapSensitive(status.person.anatomy) : null,
  };

  const decryptedMembers = await Promise.all(
    status.members.map(async (m) => ({
      ...m,
      name: await unwrapSensitive(m.name),
      anatomy: m.anatomy ? await unwrapSensitive(m.anatomy) : null,
      progress: isEncrypted && m.progress ? await decodeValue<string>(m.progress).catch(() => null) : m.progress,
    })),
  );

  return {
    ...status,
    person: decryptedPerson,
    members: decryptedMembers,
  };
}
