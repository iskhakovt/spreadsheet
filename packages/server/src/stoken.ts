import { createHmac } from "node:crypto";
import { openId, sealId } from "./opaque-id.js";

const STOKEN_TAG = "stoken02";

/**
 * Encode the push cursor (the caller's journal head id). Sealed with the
 * same opaque-id cipher as journal cursors, under its own tag, so it no
 * longer reveals the global journal row count.
 */
export function encodeStoken(id: number): string {
  return sealId(id, STOKEN_TAG);
}

export function decodeStoken(stoken: string): number {
  const id = openId(stoken, STOKEN_TAG);
  if (id !== null) return id;
  // Clients persist the stoken in localStorage, so tokens minted before the
  // opaque format still arrive after a deploy. They're HMAC-signed and
  // carry nothing the client didn't already have, so keep accepting them;
  // the next push hands back a v2 token.
  return decodeLegacyStoken(stoken);
}

/** v1 format: base64url(`v1:<id>:<hmac>`). Read-only; never minted. */
function decodeLegacyStoken(stoken: string): number {
  const decoded = Buffer.from(stoken, "base64url").toString();
  const parts = decoded.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid stoken format");
  }
  const [version, idStr, mac] = parts;
  if (version !== "v1") {
    throw new Error(`Unsupported stoken version: ${version}`);
  }
  const payload = `${version}:${idStr}`;
  if (mac !== signLegacy(payload)) {
    throw new Error("Invalid stoken signature");
  }
  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 0) {
    throw new Error("Invalid stoken id");
  }
  return id;
}

function signLegacy(payload: string): string {
  const secret = process.env.STOKEN_SECRET;
  if (!secret) {
    throw new Error("STOKEN_SECRET environment variable is required");
  }
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
