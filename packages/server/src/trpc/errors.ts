import { TRPCError } from "@trpc/server";

/**
 * Maps a store's `encryption_mismatch`: a sealed value's mode (`p:` / `e:`)
 * doesn't match the group's `encrypted` flag. Always a client bug, so every
 * write path reports it with the same message.
 */
export function encryptionMismatchError(): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message: "Value encryption does not match group setting" });
}
