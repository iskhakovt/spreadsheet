import { Anatomy, OperationPayload, PersonName, Progress, plainSealed, Rating } from "@spreadsheet/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertKeyOpens,
  createGroupCodec,
  getGroupCodec,
  SealedValueError,
  UnexpectedKeyError,
  WrongKeyError,
} from "./codec.js";
import { generateGroupKey, MissingKeyError } from "./crypto.js";

const op = (key: string, data: OperationPayload["data"]): OperationPayload => ({ key, data });

async function rejection(promise: Promise<unknown>): Promise<string> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SealedValueError);
  return (err as SealedValueError).reason;
}

describe("seal: the group's config picks the mode", () => {
  it("plaintext groups get p:1: JSON", async () => {
    const codec = createGroupCodec(false, null);
    expect(await codec.seal({ answered: 3, total: 40 })).toBe('p:1:{"answered":3,"total":40}');
  });

  it("encrypted groups get e:1: ciphertext that doesn't contain the value", async () => {
    const codec = createGroupCodec(true, await generateGroupKey());
    const sealed = await codec.seal("Alice");
    expect(sealed).toMatch(/^e:1:[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("Alice");
  });

  it("round-trips in both modes", async () => {
    for (const codec of [createGroupCodec(false, null), createGroupCodec(true, await generateGroupKey())]) {
      expect(await codec.open(await codec.seal("Alice"), PersonName)).toBe("Alice");
      expect(await codec.open(await codec.seal<Anatomy>("afab"), Anatomy)).toBe("afab");
      expect(await codec.open(await codec.seal({ answered: 1, total: 2 }), Progress)).toEqual({
        answered: 1,
        total: 2,
      });
    }
  });

  it("uses a fresh IV each time", async () => {
    const codec = createGroupCodec(true, await generateGroupKey());
    expect(await codec.seal("same")).not.toBe(await codec.seal("same"));
  });
});

describe("open: rejects anything that doesn't match the group's config", () => {
  it("rejects p: values in an encrypted group (the server could have forged them)", async () => {
    const codec = createGroupCodec(true, await generateGroupKey());
    expect(await rejection(codec.open(plainSealed("Alice"), PersonName))).toBe("mode");
    expect(
      await rejection(codec.open(plainSealed(op("kissing:mutual", { rating: "yes", note: null })), OperationPayload)),
    ).toBe("mode");
  });

  it("rejects e: values in a plaintext group", async () => {
    const sealed = await createGroupCodec(true, await generateGroupKey()).seal("Alice");
    expect(await rejection(createGroupCodec(false, null).open(sealed, PersonName))).toBe("mode");
  });

  it("rejects raw strings and unknown format versions", async () => {
    const codec = createGroupCodec(false, null);
    expect(await rejection(codec.open("Alice", PersonName))).toBe("format");
    expect(await rejection(codec.open('p:2:"Alice"', PersonName))).toBe("format");
  });

  it("rejects ciphertext sealed under another key, or tampered with", async () => {
    const mine = createGroupCodec(true, await generateGroupKey());
    const theirs = createGroupCodec(true, await generateGroupKey());
    expect(await rejection(mine.open(await theirs.seal("Alice"), PersonName))).toBe("decrypt");
    const sealed = await mine.seal("Alice");
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
    expect(await rejection(mine.open(tampered, PersonName))).toBe("decrypt");
  });

  it("rejects payloads that aren't JSON or fail the field's schema", async () => {
    const codec = createGroupCodec(false, null);
    expect(await rejection(codec.open("p:1:{not json", PersonName))).toBe("payload");
    expect(await rejection(codec.open(plainSealed("penis"), Anatomy))).toBe("payload");
    expect(await rejection(codec.open(plainSealed(""), PersonName))).toBe("payload");
    expect(await rejection(codec.open(plainSealed({ key: "k", data: { rating: "sure" } }), OperationPayload))).toBe(
      "payload",
    );
  });

  it("openOrDrop returns null for a rejected value", async () => {
    const codec = createGroupCodec(true, await generateGroupKey());
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await codec.openOrDrop(plainSealed("Alice"), PersonName)).toBeNull();
    expect(await codec.openOrDrop(await codec.seal("Alice"), PersonName)).toBe("Alice");
    vi.restoreAllMocks();
  });
});

describe("tryOpen", () => {
  it("returns the value, or the rejection reason without throwing", async () => {
    const codec = createGroupCodec(true, await generateGroupKey());
    expect(await codec.tryOpen(await codec.seal("Alice"), PersonName)).toEqual({ ok: true, value: "Alice" });
    expect(await codec.tryOpen(plainSealed("Alice"), PersonName)).toEqual({ ok: false, reason: "mode" });
  });

  it("still throws key errors", async () => {
    await expect(createGroupCodec(true, null).tryOpen("e:1:abc", PersonName)).rejects.toBeInstanceOf(MissingKeyError);
  });
});

describe("openLegacyPlaintext: your own leaked plaintext, read once to re-seal", () => {
  it("reads a p:1: value in an encrypted group", async () => {
    const codec = createGroupCodec(true, await generateGroupKey());
    expect(codec.openLegacyPlaintext(plainSealed("Alice"), PersonName)).toBe("Alice");
  });

  it("returns null for anything else: ciphertext, bad payloads, plaintext groups", async () => {
    const codec = createGroupCodec(true, await generateGroupKey());
    expect(codec.openLegacyPlaintext(await codec.seal("Alice"), PersonName)).toBeNull();
    expect(codec.openLegacyPlaintext(plainSealed("penis"), Anatomy)).toBeNull();
    expect(codec.openLegacyPlaintext('p:2:"Alice"', PersonName)).toBeNull();
    expect(createGroupCodec(false, null).openLegacyPlaintext(plainSealed("Alice"), PersonName)).toBeNull();
  });
});

describe("logging", () => {
  it("logs why a value was dropped, never the value itself", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const codec = createGroupCodec(true, await generateGroupKey());
    await codec.openOrDrop(plainSealed("Alice Secretname"), PersonName);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("mode");
    expect(logged).not.toContain("Alice");
    vi.restoreAllMocks();
  });
});

describe("keyProven", () => {
  it("isn't set by a decrypt by itself: someone else's value opening proves nothing", async () => {
    const key = await generateGroupKey();
    const reader = createGroupCodec(true, key);
    expect(await reader.open(await createGroupCodec(true, key).seal("Bob"), PersonName)).toBe("Bob");
    expect(reader.keyProven).toBe(false);
  });

  it("is set by markKeyProven and stays set", async () => {
    const codec = createGroupCodec(true, await generateGroupKey());
    codec.markKeyProven();
    expect(codec.keyProven).toBe(true);
  });
});

describe("assertKeyOpens", () => {
  it("passes, and marks the key proven, when any of your ciphertext opens", async () => {
    const key = await generateGroupKey();
    const codec = createGroupCodec(true, key);
    const other = createGroupCodec(true, await generateGroupKey());
    await expect(assertKeyOpens(codec, [await other.seal("x"), await codec.seal("Alice")], PersonName)).resolves.toBe(
      undefined,
    );
    expect(codec.keyProven).toBe(true);
  });

  it("counts a value that decrypts but fails its schema (fresh reader)", async () => {
    const key = await generateGroupKey();
    const sealed = await createGroupCodec(true, key).seal("");
    const reader = createGroupCodec(true, key);
    await expect(assertKeyOpens(reader, [sealed], PersonName)).resolves.toBe(undefined);
    expect(reader.keyProven).toBe(true);
  });

  it("throws WrongKeyError when there is ciphertext and none of it opens", async () => {
    const codec = createGroupCodec(true, await generateGroupKey());
    const other = createGroupCodec(true, await generateGroupKey());
    await expect(
      assertKeyOpens(codec, [await other.seal("a"), await other.seal("b")], PersonName),
    ).rejects.toBeInstanceOf(WrongKeyError);
  });

  it("passes once the key is already proven, so a corrupt value can't pass for a wrong key", async () => {
    const codec = createGroupCodec(true, await generateGroupKey());
    codec.markKeyProven();
    const other = createGroupCodec(true, await generateGroupKey());
    await expect(assertKeyOpens(codec, [await other.seal("x")], PersonName)).resolves.toBe(undefined);
  });

  it("has nothing to prove without ciphertext, or in a plaintext group", async () => {
    const codec = createGroupCodec(true, await generateGroupKey());
    await expect(assertKeyOpens(codec, [], PersonName)).resolves.toBe(undefined);
    await expect(assertKeyOpens(codec, [plainSealed("Alice")], PersonName)).resolves.toBe(undefined);
    await expect(assertKeyOpens(createGroupCodec(false, null), ["e:1:abc"], PersonName)).resolves.toBe(undefined);
  });
});

describe("key and config must agree", () => {
  it("an encrypted group without a key refuses to seal or open (never falls back to plaintext)", async () => {
    const codec = createGroupCodec(true, null);
    await expect(codec.seal("Alice")).rejects.toBeInstanceOf(MissingKeyError);
    await expect(codec.open("e:1:abc", PersonName)).rejects.toBeInstanceOf(MissingKeyError);
    await expect(codec.openOrDrop("e:1:abc", PersonName)).rejects.toBeInstanceOf(MissingKeyError);
  });

  it("a plaintext group with a key refuses too (the server would be downgrading the group)", async () => {
    const codec = createGroupCodec(false, await generateGroupKey());
    await expect(codec.seal("Alice")).rejects.toBeInstanceOf(UnexpectedKeyError);
    await expect(codec.open(plainSealed("Alice"), PersonName)).rejects.toBeInstanceOf(UnexpectedKeyError);
  });
});

describe("getGroupCodec", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    vi.stubGlobal("window", { location: { hash: "", pathname: "/" } });
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("never throws itself, so the layout can build it during render", async () => {
    const { getGroupCodec: fresh } = await import("./codec.js");
    const codec = fresh(true); // encrypted, but no key in this tab
    await expect(codec.seal("x")).rejects.toBeInstanceOf((await import("./crypto.js")).MissingKeyError);
  });

  it("returns the same codec while the mode and key are unchanged", () => {
    expect(getGroupCodec(false)).toBe(getGroupCodec(false));
  });
});

describe("encrypted length padding", () => {
  // The server stores every `e:1:` string it receives. These pin the
  // observable contract (the opaque string's length must not reveal the
  // value), not the bucket arithmetic behind it.
  const lengthOf = async (value: unknown, key: string) => (await createGroupCodec(true, key).seal(value)).length;
  const distinctLengths = async (values: unknown[], key: string) =>
    new Set(await Promise.all(values.map((v) => lengthOf(v, key))));
  const op = (key: string, data: OperationPayload["data"]): OperationPayload => ({ key, data });

  it("note-less ops share one length across every rating, key, role, and set/clear", async () => {
    const key = await generateGroupKey();
    const keys = ["kissing:mutual", "oral:give", "watching-partner-masturbate:receive"];
    const ops = keys.flatMap((k) => [op(k, null), ...Rating.options.map((rating) => op(k, { rating, note: null }))]);
    expect((await distinctLengths(ops, key)).size).toBe(1);
  });

  it("a short note doesn't change the length", async () => {
    const key = await generateGroupKey();
    const k = "watching-partner-masturbate:receive";
    const ops = [
      op(k, { rating: "if-partner-wants", note: null }),
      op(k, { rating: "no", note: "" }),
      op(k, { rating: "yes", note: "only on weekends, and only if we've talked about it first" }),
    ];
    expect((await distinctLengths(ops, key)).size).toBe(1);
  });

  it("long notes are bucketed: same bucket, same length; next bucket, longer", async () => {
    const key = await generateGroupKey();
    const withNote = (note: string) => op("kissing:mutual", { rating: "yes", note });
    const [a, b, c] = await Promise.all(
      [withNote("x".repeat(300)), withNote("x".repeat(380)), withNote("x".repeat(600))].map((v) => lengthOf(v, key)),
    );
    expect(a).toBe(b);
    expect(c).toBeGreaterThan(b);
  });

  it("buckets by UTF-8 bytes, so multibyte notes don't leak their exact length", async () => {
    // "é" is one UTF-16 code unit but two UTF-8 bytes. Bucketing by
    // `string.length` would overshoot the bucket by the extra bytes and
    // give these two notes different ciphertext lengths.
    const key = await generateGroupKey();
    const withNote = (note: string) => op("kissing:mutual", { rating: "yes", note });
    expect((await distinctLengths([withNote("é".repeat(150)), withNote("é".repeat(180))], key)).size).toBe(1);
  });

  it("names, anatomy, and progress don't leak their length either", async () => {
    const key = await generateGroupKey();
    const values = [
      "Al",
      "Alexandra-Josephine",
      "amab",
      "none",
      { answered: 3, total: 40 },
      { answered: 147, total: 312 },
    ];
    expect((await distinctLengths(values, key)).size).toBe(1);
  });

  it("padded values open unchanged, multibyte notes included", async () => {
    const codec = createGroupCodec(true, await generateGroupKey());
    const ops = [
      op("kissing:mutual", { rating: "maybe", note: "Ça me plaît 🙂" }),
      op("kissing:mutual", { rating: "yes", note: "x".repeat(2000) }),
      op("kissing:mutual", null),
    ];
    for (const value of ops) {
      expect(await codec.open(await codec.seal(value), OperationPayload)).toEqual(value);
    }
    expect(await codec.open(await codec.seal("Alice"), PersonName)).toBe("Alice");
  });

  it("seals very long notes (padded past 128 KiB) without overflowing the argument limit", async () => {
    // 70 KB of note pads to a 128 KiB bucket. Spreading that into a single
    // String.fromCharCode call throws RangeError in V8.
    const codec = createGroupCodec(true, await generateGroupKey());
    const value = op("kissing:mutual", { rating: "yes", note: "x".repeat(70_000) });
    expect(await codec.open(await codec.seal(value), OperationPayload)).toEqual(value);
  });

  it("opens legacy unpadded e:1: values", async () => {
    // Pre-padding clients encrypted the bare JSON. Those journal entries
    // and profile fields stay on the server, so new code must keep reading them.
    const key = await generateGroupKey();
    const value = op("kissing:mutual", { rating: "fantasy", note: "legacy" });
    const legacy = await legacyEncrypt(value, key);
    expect(legacy.length).toBeLessThan(await lengthOf(value, key));
    expect(await createGroupCodec(true, key).open(legacy, OperationPayload)).toEqual(value);
  });

  it("leaves plaintext mode unpadded (the server can read it anyway)", async () => {
    expect(await createGroupCodec(false, null).seal("hello")).toBe('p:1:"hello"');
  });
});

/** Encrypt the way pre-padding clients did: bare JSON, no padding. */
async function legacyEncrypt(value: unknown, base64urlKey: string): Promise<string> {
  const fromB64url = (s: string) =>
    Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
  const toB64url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const cryptoKey = await crypto.subtle.importKey("raw", fromB64url(base64urlKey), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, plaintext));
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv);
  combined.set(ciphertext, iv.length);
  return `e:1:${toB64url(combined)}`;
}
