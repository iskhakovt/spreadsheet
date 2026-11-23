import {
  decodeOpaque,
  encodeOpaque,
  FORMAT_VERSION,
  isSealedFormat,
  type PayloadSchema,
  PREFIX_PLAINTEXT,
  type Sealed,
  sealedModeMatches,
} from "@spreadsheet/shared";
import { decryptJson, encryptJson, getGroupKeyFromUrl, importGroupKey, MissingKeyError } from "./crypto.js";
import { NonRetriableError } from "./errors.js";

/**
 * Thrown when this tab holds a group key but the group isn't encrypted. No
 * real link produces that, so it means the server and the link disagree,
 * and following the server would quietly downgrade writes to plaintext.
 */
export class UnexpectedKeyError extends NonRetriableError {
  readonly code = "UNEXPECTED_GROUP_KEY" as const;
  constructor() {
    super("This link carries an encryption key, but the group isn't encrypted");
    this.name = "UnexpectedKeyError";
  }
}

/**
 * Thrown when an encrypted group's values exist but none of them open with
 * this tab's key: the link carries the wrong key (or everything was
 * tampered with). Failing closed matters: dropping the fields instead would
 * route the person to re-enter them, sealed under the wrong key, which
 * would overwrite data the right key can still read.
 */
export class WrongKeyError extends NonRetriableError {
  readonly code = "WRONG_GROUP_KEY" as const;
  constructor() {
    super("The encryption key in this link doesn't match this group");
    this.name = "WrongKeyError";
  }
}

/**
 * Why a sealed value was rejected on read:
 *  - `format`  — no `p:1:` / `e:1:` prefix, or an unknown version.
 *  - `mode`    — sealed in the other mode from the group's config
 *                (`p:` in an encrypted group, `e:` in a plaintext one).
 *  - `decrypt` — the ciphertext doesn't open with this group's key.
 *  - `payload` — not JSON, or JSON that fails the field's schema.
 */
export type SealedRejection = "format" | "mode" | "decrypt" | "payload";

export class SealedValueError extends Error {
  constructor(readonly reason: SealedRejection) {
    super(`Sealed value rejected: ${reason}`);
    this.name = "SealedValueError";
  }
}

/**
 * The one place a sensitive value is sealed or opened. The mode comes from
 * the group's `encrypted` flag, never from the call site.
 *
 * Writes: `seal` produces `p:1:<json>` for plaintext groups and padded
 * `e:1:<ciphertext>` for encrypted ones. It's the only producer of `Sealed<T>`,
 * which every sensitive tRPC input requires.
 *
 * Reads: `open` rejects any value that doesn't match the group's config.
 * That matters in encrypted groups: GCM authenticates ciphertext, but a
 * `p:` value could have been written by anyone with database access, so
 * accepting one would let the server forge answers or names.
 */
export type OpenResult<T> = { ok: true; value: T } | { ok: false; reason: SealedRejection };

export interface GroupCodec {
  readonly encrypted: boolean;
  seal<T>(value: T): Promise<Sealed<T>>;
  /** Open and validate; throws {@link SealedValueError} on a rejected value. */
  open<T>(value: string, schema: PayloadSchema<T>): Promise<T>;
  /** Like `open`, but a rejected value is dropped (reason logged, never the value). Key errors still throw. */
  openOrDrop<T>(value: string, schema: PayloadSchema<T>): Promise<T | null>;
  /** Like `open`, but returns the rejection instead of throwing it. Key errors still throw. */
  tryOpen<T>(value: string, schema: PayloadSchema<T>): Promise<OpenResult<T>>;
  /**
   * Read a `p:` value in an ENCRYPTED group as plaintext, for the caller's
   * own profile fields only: those are values an older client leaked, and
   * the caller confirms and re-seals them. Never use it for other members'
   * values. Returns null for anything that isn't a valid `p:1:` payload.
   */
  openLegacyPlaintext<T>(value: string, schema: PayloadSchema<T>): T | null;
}

class Codec implements GroupCodec {
  readonly encrypted: boolean;
  /** Set when the codec can't be used at all; thrown from every seal/open. */
  readonly #unusable: Error | null;
  readonly #key: Promise<CryptoKey> | null;

  constructor(encrypted: boolean, groupKey: string | null) {
    this.encrypted = encrypted;
    if (encrypted && !groupKey) this.#unusable = new MissingKeyError();
    else if (!encrypted && groupKey) this.#unusable = new UnexpectedKeyError();
    else this.#unusable = null;
    this.#key = encrypted && groupKey ? importGroupKey(groupKey) : null;
    // A rejected import surfaces from the first seal/open, not as an unhandled rejection.
    this.#key?.catch(() => {});
  }

  async seal<T>(value: T): Promise<Sealed<T>> {
    if (this.#unusable) throw this.#unusable;
    const json = JSON.stringify(value);
    if (!this.#key) return encodeOpaque(false, json) as Sealed<T>;
    return encodeOpaque(true, await encryptJson(json, await this.#key)) as Sealed<T>;
  }

  async open<T>(value: string, schema: PayloadSchema<T>): Promise<T> {
    if (this.#unusable) throw this.#unusable;
    if (!isSealedFormat(value) || decodeOpaque(value).version !== FORMAT_VERSION) {
      throw new SealedValueError("format");
    }
    if (!sealedModeMatches(value, this.encrypted)) throw new SealedValueError("mode");
    return this.#parse(await this.#plaintextJson(value), schema);
  }

  async openOrDrop<T>(value: string, schema: PayloadSchema<T>): Promise<T | null> {
    const result = await this.tryOpen(value, schema);
    if (result.ok) return result.value;
    // The reason only: a rejected `p:` value's prefix is plaintext.
    console.error(`Dropping sealed value (${result.reason})`);
    return null;
  }

  async tryOpen<T>(value: string, schema: PayloadSchema<T>): Promise<OpenResult<T>> {
    try {
      return { ok: true, value: await this.open(value, schema) };
    } catch (err) {
      if (!(err instanceof SealedValueError)) throw err;
      return { ok: false, reason: err.reason };
    }
  }

  openLegacyPlaintext<T>(value: string, schema: PayloadSchema<T>): T | null {
    if (!this.encrypted || !isSealedFormat(value)) return null;
    const { mode, version, payload } = decodeOpaque(value);
    if (mode !== PREFIX_PLAINTEXT || version !== FORMAT_VERSION) return null;
    try {
      return this.#parse(payload, schema);
    } catch {
      return null;
    }
  }

  async #plaintextJson(value: string): Promise<string> {
    const { payload } = decodeOpaque(value);
    if (!this.#key) return payload;
    try {
      return await decryptJson(payload, await this.#key);
    } catch {
      throw new SealedValueError("decrypt");
    }
  }

  #parse<T>(json: string, schema: PayloadSchema<T>): T {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new SealedValueError("payload");
    }
    const result = schema.safeParse(parsed);
    if (!result.success) throw new SealedValueError("payload");
    return result.data;
  }
}

/**
 * Throw {@link WrongKeyError} if `values` hold ciphertext and none of it
 * opens under the codec's key. A value that decrypts but fails `schema`
 * still proves the key (GCM authenticated it). No-op in plaintext groups or
 * when there's no ciphertext to test.
 *
 * Call it before persisting anything derived from a replay (e.g. a cursor):
 * under a wrong key every entry is dropped, and advancing the cursor past
 * them would hide them from the right key later.
 */
export async function assertKeyOpens<T>(
  codec: GroupCodec,
  values: readonly string[],
  schema: PayloadSchema<T>,
): Promise<void> {
  if (!codec.encrypted) return;
  let sawCiphertext = false;
  for (const value of values) {
    if (!sealedModeMatches(value, true)) continue;
    sawCiphertext = true;
    const result = await codec.tryOpen(value, schema);
    if (result.ok || result.reason === "payload") return;
  }
  if (sawCiphertext) throw new WrongKeyError();
}

/** Build a codec for an explicit mode and key. Tests and {@link getGroupCodec} use this. */
export function createGroupCodec(encrypted: boolean, groupKey: string | null): GroupCodec {
  return new Codec(encrypted, groupKey);
}

let cached: { encrypted: boolean; groupKey: string | null; codec: GroupCodec } | null = null;

/**
 * The codec for the current tab's group. `encrypted` is the group's flag
 * from the server; the key comes from the link (URL fragment, cached per
 * session in sessionStorage). Both must agree, or the codec refuses to work.
 *
 * Never throws itself, so it's safe to call during render: a missing or
 * unexpected key throws from the first seal/open instead.
 */
export function getGroupCodec(encrypted: boolean): GroupCodec {
  const groupKey = getGroupKeyFromUrl();
  if (cached?.encrypted !== encrypted || cached.groupKey !== groupKey) {
    cached = { encrypted, groupKey, codec: createGroupCodec(encrypted, groupKey) };
  }
  return cached.codec;
}
