// Encryption format constants — shared between server (validation) and web (encrypt/decrypt)

export const PREFIX_PLAINTEXT = "p";
export const PREFIX_ENCRYPTED = "e";
export const FORMAT_VERSION = "1";

/** Build a prefixed opaque string: `p:1:payload` or `e:1:payload` */
export function encodeOpaque(encrypted: boolean, payload: string): string {
  const prefix = encrypted ? PREFIX_ENCRYPTED : PREFIX_PLAINTEXT;
  return `${prefix}:${FORMAT_VERSION}:${payload}`;
}

/** Parse a prefixed opaque string. Returns [mode, version, payload]. Throws on invalid format. */
export function decodeOpaque(value: string): { mode: "p" | "e"; version: string; payload: string } {
  const firstColon = value.indexOf(":");
  if (firstColon === -1) throw new Error("Invalid opaque format: no prefix");
  const secondColon = value.indexOf(":", firstColon + 1);
  if (secondColon === -1) throw new Error("Invalid opaque format: no version");

  const mode = value.slice(0, firstColon);
  const version = value.slice(firstColon + 1, secondColon);
  const payload = value.slice(secondColon + 1);

  if (mode !== "p" && mode !== "e") throw new Error(`Invalid opaque mode: ${mode}`);
  return { mode: mode as "p" | "e", version, payload };
}
