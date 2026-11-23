import { z } from "zod";
import { decodeOpaque, PREFIX_ENCRYPTED, PREFIX_PLAINTEXT } from "./crypto.js";

declare const payloadType: unique symbol;

/**
 * A sensitive value as it travels and is stored: `p:1:<json>` in plaintext
 * groups, `e:1:<base64url(iv ∥ ciphertext)>` in encrypted ones. `T` is the
 * payload type. It exists only at the type level, so {@link Opened} can map a
 * sealed field back to what it holds.
 *
 * The client's group codec is the only producer: it picks the mode from the
 * group's config, so no call site chooses whether to encrypt. Input schemas
 * built with {@link sealed} make passing a raw string a compile error.
 */
export type Sealed<T> = string & { readonly [payloadType]: T };

/**
 * Replace every `Sealed<T>` in a type with `T`, recursively: the shape the UI
 * works with after the codec opened each field. Keeping it a distinct type is
 * the point: an opened value can't be handed back to a sealed input.
 */
export type Opened<T> =
  T extends Sealed<infer U>
    ? U
    : T extends readonly (infer E)[]
      ? Opened<E>[]
      : T extends object
        ? { [K in keyof T]: Opened<T[K]> }
        : T;

/**
 * Schema for the payload inside a sealed value (what the client's codec
 * validates after opening). An alias so web code can name it without
 * depending on Zod itself.
 */
export type PayloadSchema<T> = z.ZodType<T>;

const SEALED_FORMAT = /^[pe]:\d+:/;

/** True if `value` has the `p:N:` / `e:N:` sealed prefix. Says nothing about the payload. */
export function isSealedFormat(value: unknown): value is string {
  return typeof value === "string" && SEALED_FORMAT.test(value);
}

/**
 * True if `value` was sealed in the mode the group's config requires: `e` in
 * encrypted groups, `p` in plaintext ones. Used on both sides: the server
 * rejects mismatched writes, the client codec rejects mismatched reads.
 */
export function sealedModeMatches(value: string, encrypted: boolean): boolean {
  if (!isSealedFormat(value)) return false;
  return decodeOpaque(value).mode === (encrypted ? PREFIX_ENCRYPTED : PREFIX_PLAINTEXT);
}

/**
 * Input schema for a sealed field the server stores. Checks the format only;
 * the store checks the mode against the group. Built with `z.custom` rather
 * than `.brand()`, because `.brand()` brands the output type only, and the
 * tRPC client's input type would still accept a raw string.
 */
export function sealed<T>() {
  return z.custom<Sealed<T>>(isSealedFormat, { error: "Expected a sealed value (p:1:… or e:1:…)" });
}

/**
 * Output schema for a sealed field the server returns. Typed `Sealed<T>` for
 * the client, but only checked to be a string: the client opens each field on
 * its own and drops one that doesn't open, so one bad row can't fail a whole
 * response. Input side stays `string`, so server code can return DB rows.
 */
export function sealedOutput<T>() {
  return z.string().transform((value) => value as Sealed<T>);
}
