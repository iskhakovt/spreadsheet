import { encodeOpaque } from "./crypto.js";
import type { Sealed } from "./sealed.js";
import type { Answer, OperationPayload, Progress } from "./types.js";

/**
 * Seal a value the way a plaintext group's codec does: `p:1:<json>`. For tests
 * on both sides; production code seals through the client's group codec.
 */
export function plainSealed<T>(value: T): Sealed<T> {
  return encodeOpaque(false, JSON.stringify(value)) as Sealed<T>;
}

/**
 * Stand-in for an encrypted sealed value: `e:1:<label>`. The server never
 * decrypts, so its tests only need the format and mode right. Not decryptable.
 */
export function fakeEncrypted<T>(label: string): Sealed<T> {
  return encodeOpaque(true, label) as Sealed<T>;
}

/**
 * Build a `p:1:` plaintext journal op for tests. Typing `data` against
 * Answer makes field drops fail compile instead of silently leaving stale
 * keys (Zod strips unknowns on read). Tests exercising the strip-on-read
 * path build the raw string by hand.
 */
export function plainOp(key: string, data: Answer | null): Sealed<OperationPayload> {
  return plainSealed<OperationPayload>({ key, data });
}

/** Progress envelope counterpart to {@link plainOp}. */
export function plainProgress(payload: Progress): Sealed<Progress> {
  return plainSealed(payload);
}
