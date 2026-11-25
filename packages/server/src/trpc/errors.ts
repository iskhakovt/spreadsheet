import { TRPCError } from "@trpc/server";

/**
 * Maps a store's `encryption_mismatch`: a sealed value's mode (`p:` / `e:`)
 * doesn't match the group's `encrypted` flag. Shared by every write path so
 * they all report it with one message.
 */
export function encryptionMismatchError(): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message: "Value encryption does not match group setting" });
}
