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
 * Thrown when the caller's own ciphertext exists but none of it opens with
 * this tab's key: the link carries the wrong key. Dropping the fields
 * instead would have the person re-enter them under that key, overwriting
 * what the right key can read (see design/sync.md § Sealed values).
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

export type OpenResult<T> = { ok: true; value: T } | { ok: false; reason: SealedRejection };

/**
 * The group codec: the one place a sensitive value is sealed or opened. The
 * mode comes from the group's `encrypted` flag, never from the call site.
 * `seal` is the only producer of `Sealed<T>`; `open` rejects any value that
 * doesn't match the group's config (see design/sync.md § Sealed values).
 */
export interface GroupCodec {
  readonly encrypted: boolean;
  /**
   * True once the caller's own server-side ciphertext (profile, progress or
   * journal) has decrypted under this key, even if its payload then failed
   * the schema. Never cleared. Set only via {@link markKeyProven}: another
   * member's value or the local outbox opening proves nothing.
   */
  readonly keyProven: boolean;
  /** Record that the caller's own server-side ciphertext opened under this key. */
  markKeyProven(): void;
  seal<T>(value: T): Promise<Sealed<T>>;
  /** Open and validate; throws {@link SealedValueError} on a rejected value. */
  open<T>(value: string, schema: PayloadSchema<T>): Promise<T>;
  /** Like `open`, but a rejected value is dropped (reason logged, never the value). Key errors still throw. */
  openOrDrop<T>(value: string, schema: PayloadSchema<T>): Promise<T | null>;
  /** Like `open`, but returns the rejection instead of throwing it. Key errors still throw. */
  tryOpen<T>(value: string, schema: PayloadSchema<T>): Promise<OpenResult<T>>;
  /**
   * Read a `p:` value in an encrypted group, for the caller's own profile
   * fields only (legacy plaintext an older client wrote; `useResealLegacyProfile`
   * re-seals it). Never for other members' values. Null unless a valid `p:1:` payload.
   */
  openLegacyPlaintext<T>(value: string, schema: PayloadSchema<T>): T | null;
}

class Codec implements GroupCodec {
  readonly encrypted: boolean;
  /** Set when the codec can't be used at all; thrown from every seal/open. */
  readonly #unusable: Error | null;
  readonly #key: Promise<CryptoKey> | null;
  #keyProven = false;

  get keyProven(): boolean {
    return this.#keyProven;
  }

  markKeyProven(): void {
    this.#keyProven = true;
  }

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
 * Prove the key on the caller's own server-side ciphertext and mark the codec
 * proven, or throw {@link WrongKeyError} if `ownValues` hold ciphertext and
 * none of it decrypts (a value that decrypts but fails `schema` still counts).
 * No-op in plaintext groups, without ciphertext, or once the key is proven, so
 * one corrupt entry can't pass for a wrong key.
 *
 * Call it before persisting anything derived from a replay (e.g. a cursor):
 * moving past entries a wrong key dropped would hide them from the right key.
 */
export async function assertKeyOpens<T>(
  codec: GroupCodec,
  ownValues: readonly string[],
  schema: PayloadSchema<T>,
): Promise<void> {
  if (!codec.encrypted || codec.keyProven) return;
  let sawCiphertext = false;
  for (const value of ownValues) {
    if (!sealedModeMatches(value, true)) continue;
    sawCiphertext = true;
    const result = await codec.tryOpen(value, schema);
    if (result.ok || result.reason === "payload") {
      codec.markKeyProven();
      return;
    }
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
