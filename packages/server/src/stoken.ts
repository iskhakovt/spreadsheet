import { createHmac } from "node:crypto";

const STOKEN_VERSION = "v1";

function getSecret(): string {
  const secret = process.env.STOKEN_SECRET;
  if (!secret) {
    throw new Error("STOKEN_SECRET environment variable is required");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function encodeStoken(id: number): string {
  const payload = `${STOKEN_VERSION}:${id}`;
  const mac = sign(payload);
  return Buffer.from(`${payload}:${mac}`).toString("base64url");
}

export function decodeStoken(stoken: string): number {
  const decoded = Buffer.from(stoken, "base64url").toString();
  const parts = decoded.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid stoken format");
  }
  const [version, idStr, mac] = parts;
  if (version !== STOKEN_VERSION) {
    throw new Error(`Unsupported stoken version: ${version}`);
  }
  const payload = `${version}:${idStr}`;
  const expectedMac = sign(payload);
  if (mac !== expectedMac) {
    throw new Error("Invalid stoken signature");
  }
  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 0) {
    throw new Error("Invalid stoken id");
  }
  return id;
}
