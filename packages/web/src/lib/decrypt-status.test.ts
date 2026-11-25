import { type GroupStatusRow, KEY_CHECK, type KeyCheck, plainSealed } from "@spreadsheet/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGroupCodec, type GroupCodec, WrongKeyError } from "./codec.js";
import { generateGroupKey, MissingKeyError } from "./crypto.js";
import { assertKeyNotRefuted, decryptStatus } from "./decrypt-status.js";
import { UI } from "./strings.js";

interface Profile {
  id: string;
  name: string;
  anatomy: string | null;
}

function status(
  encrypted: boolean,
  self: Profile | null,
  others: Profile[],
  progress: string | null = null,
  keyCheck: string | null = null,
): GroupStatusRow {
  const flags = { isAdmin: false, isCompleted: false };
  return {
    person: self && { ...self, ...flags },
    group: {
      id: "g1",
      encrypted,
      keyCheck,
      isReady: true,
      isAdminReady: true,
      questionMode: "filtered",
      anatomyLabels: null,
      anatomyPicker: "self",
    },
    members: [...(self ? [self] : []), ...others].map((m) => ({ ...m, ...flags, progress })),
  };
}

let encrypted: GroupCodec;
const plain = createGroupCodec(false, null);

beforeEach(async () => {
  encrypted = createGroupCodec(true, await generateGroupKey());
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("decryptStatus", () => {
  it("opens every sealed field, in both modes", async () => {
    for (const codec of [plain, encrypted]) {
      const raw = status(
        codec.encrypted,
        { id: "me", name: await codec.seal("Alice"), anatomy: await codec.seal("afab") },
        [{ id: "bob", name: await codec.seal("Bob"), anatomy: null }],
        await codec.seal({ answered: 3, total: 40 }),
      );
      const opened = await decryptStatus(raw, codec);
      expect(opened.person).toMatchObject({ name: "Alice", anatomy: "afab" });
      expect(opened.members.map((m) => [m.name, m.anatomy, m.progress])).toEqual([
        ["Alice", "afab", { answered: 3, total: 40 }],
        ["Bob", null, { answered: 3, total: 40 }],
      ]);
      expect(opened.profileHasLegacyPlaintext).toBeUndefined();
    }
  });

  it("drops another member's fields that don't match the group's config, without failing the status", async () => {
    // A server (or anyone with DB access) slipping plaintext into an
    // encrypted group: the client must not show it as Bob's real profile.
    const raw = status(
      true,
      { id: "me", name: await encrypted.seal("Alice"), anatomy: null },
      [{ id: "bob", name: plainSealed("Forged"), anatomy: plainSealed("amab") }],
      plainSealed({ answered: 99, total: 99 }),
    );
    const opened = await decryptStatus(raw, encrypted);
    const bob = opened.members.find((m) => m.id === "bob");
    expect(bob).toMatchObject({ name: UI.unreadableName, anatomy: null, progress: null });
    expect(opened.person?.name).toBe("Alice");
  });

  it("drops e: values in a plaintext group too", async () => {
    const raw = status(false, { id: "me", name: plainSealed("Alice"), anatomy: null }, [
      { id: "bob", name: await encrypted.seal("Bob"), anatomy: null },
    ]);
    const opened = await decryptStatus(raw, plain);
    expect(opened.members.find((m) => m.id === "bob")?.name).toBe(UI.unreadableName);
  });

  it("accepts your own legacy plaintext in an encrypted group and flags it for re-sealing once your data proves the key", async () => {
    // Your own progress opens, which proves this tab holds the key you've been using.
    const raw = status(
      true,
      { id: "me", name: plainSealed("Alice"), anatomy: plainSealed("afab") },
      [],
      await encrypted.seal({ answered: 1, total: 2 }),
    );
    const opened = await decryptStatus(raw, encrypted);
    expect(opened.person).toMatchObject({ name: "Alice", anatomy: "afab" });
    expect(opened.members[0]).toMatchObject({ name: "Alice", anatomy: "afab" });
    expect(opened.profileHasLegacyPlaintext).toBe(true);
  });

  it("flags your legacy plaintext even before anything proves the key (re-sealing waits for proof)", async () => {
    const raw = status(true, { id: "me", name: plainSealed("Alice"), anatomy: null }, []);
    const opened = await decryptStatus(raw, encrypted);
    expect(opened.person?.name).toBe("Alice");
    expect(opened.profileHasLegacyPlaintext).toBe(true);
    expect(encrypted.keyProven).toBe(false);
  });

  it("never re-seals another member's legacy plaintext", async () => {
    const raw = status(true, { id: "me", name: await encrypted.seal("Alice"), anatomy: null }, [
      { id: "bob", name: plainSealed("Bob"), anatomy: null },
    ]);
    const opened = await decryptStatus(raw, encrypted);
    expect(opened.members.find((m) => m.id === "bob")?.name).toBe(UI.unreadableName);
    expect(opened.profileHasLegacyPlaintext).toBeUndefined();
  });

  it("refutes the key when none of your ciphertext opens, instead of dropping it", async () => {
    // Dropping would route you to /setup and re-seal your name under the
    // wrong key, overwriting what the right key can still read.
    const theirs = createGroupCodec(true, await generateGroupKey());
    const raw = status(
      true,
      { id: "me", name: await theirs.seal("Alice"), anatomy: await theirs.seal("afab") },
      [{ id: "bob", name: await theirs.seal("Bob"), anatomy: null }],
      await theirs.seal({ answered: 1, total: 2 }),
    );
    const opened = await decryptStatus(raw, encrypted);
    expect(opened.ownCiphertextUnproven).toBe(true);
    expect(() => assertKeyNotRefuted(opened, encrypted)).toThrow(WrongKeyError);
  });

  it("can't be locked out by someone else's ciphertext under another key", async () => {
    // Bob wrote under a wrong key in a group with no other ciphertext. His
    // fields drop; yours are untouched and the app keeps working.
    const theirs = createGroupCodec(true, await generateGroupKey());
    const raw = status(true, { id: "me", name: plainSealed("Alice"), anatomy: null }, [
      { id: "bob", name: await theirs.seal("Bob"), anatomy: await theirs.seal("amab") },
    ]);
    const opened = await decryptStatus(raw, encrypted);
    expect(opened.person?.name).toBe("Alice");
    expect(opened.members.find((m) => m.id === "bob")).toMatchObject({ name: UI.unreadableName, anatomy: null });
    // Your legacy name is flagged, but nothing of yours proved the key, so it isn't re-sealed yet.
    expect(opened.profileHasLegacyPlaintext).toBe(true);
    expect(encrypted.keyProven).toBe(false);
  });

  it("keeps a key proven by an earlier status, so a later bad own field drops instead of failing", async () => {
    await decryptStatus(status(true, { id: "me", name: await encrypted.seal("Alice"), anatomy: null }, []), encrypted);
    const theirs = createGroupCodec(true, await generateGroupKey());
    const opened = await decryptStatus(
      status(true, { id: "me", name: await theirs.seal("Alice"), anatomy: null }, []),
      encrypted,
    );
    expect(opened.person?.name).toBe("");
  });

  it("empties your own name when it doesn't open but your other data proves the key, so /setup asks for it again", async () => {
    // e.g. a tampered row: your progress proves the key, so only the name is bad.
    const theirs = createGroupCodec(true, await generateGroupKey());
    const raw = status(
      true,
      { id: "me", name: await theirs.seal("Alice"), anatomy: null },
      [],
      await encrypted.seal({ answered: 1, total: 2 }),
    );
    const opened = await decryptStatus(raw, encrypted);
    expect(opened.person?.name).toBe("");
  });

  it("counts your own value that decrypts but fails its schema as proof of the key", async () => {
    const theirs = createGroupCodec(true, await generateGroupKey());
    const raw = status(
      true,
      { id: "me", name: await theirs.seal("Alice"), anatomy: await encrypted.seal("penis") },
      [],
    );
    const opened = await decryptStatus(raw, encrypted);
    expect(opened.person).toMatchObject({ name: "", anatomy: null });
  });

  it("isn't fooled by another member's data opening under the same wrong key", async () => {
    // Bob wrote under key B; Alice opens her link with that same B. Bob's
    // fields open, but that proves only that B is Bob's key. Alice's own
    // data (under the group's key) doesn't, so fail closed rather than drop
    // her name and let /setup overwrite it under B.
    const groupKey = createGroupCodec(true, await generateGroupKey());
    const keyB = await generateGroupKey();
    const bobWriter = createGroupCodec(true, keyB);
    const raw = status(true, { id: "me", name: await groupKey.seal("Alice"), anatomy: null }, [
      { id: "bob", name: await bobWriter.seal("Bob"), anatomy: null },
    ]);
    const codecB = createGroupCodec(true, keyB);
    const opened = await decryptStatus(raw, codecB);
    expect(() => assertKeyNotRefuted(opened, codecB)).toThrow(WrongKeyError);
  });

  it("counts your own progress as your own ciphertext", async () => {
    // Legacy plaintext profile, progress under the group's key, wrong key in the link.
    const raw = status(
      true,
      { id: "me", name: plainSealed("Alice"), anatomy: null },
      [],
      await encrypted.seal({ answered: 3, total: 9 }),
    );
    const wrong = createGroupCodec(true, await generateGroupKey());
    const opened = await decryptStatus(raw, wrong);
    expect(() => assertKeyNotRefuted(opened, wrong)).toThrow(WrongKeyError);
  });

  it("leaves the decision to after journal hydration: your journal can still prove the key", async () => {
    // Legacy profile, own progress unreadable (e.g. tampered), journal readable.
    const theirs = createGroupCodec(true, await generateGroupKey());
    const raw = status(
      true,
      { id: "me", name: plainSealed("Alice"), anatomy: null },
      [],
      await theirs.seal({ answered: 1, total: 2 }),
    );
    const opened = await decryptStatus(raw, encrypted);
    expect(opened.ownCiphertextUnproven).toBe(true);
    // Journal hydration's assertKeyOpens proves it from your own entries.
    encrypted.markKeyProven();
    expect(() => assertKeyNotRefuted(opened, encrypted)).not.toThrow();
  });

  it("returns a pre-setup status (no person, no members) without needing the key", async () => {
    const raw = status(true, null, []);
    const opened = await decryptStatus(raw, createGroupCodec(true, null));
    expect(opened.person).toBeNull();
    expect(opened.members).toEqual([]);
  });

  it("throws MissingKeyError for an encrypted group's fields when the key is missing", async () => {
    const raw = status(true, { id: "me", name: await encrypted.seal("Alice"), anatomy: null }, []);
    await expect(decryptStatus(raw, createGroupCodec(true, null))).rejects.toBeInstanceOf(MissingKeyError);
  });
});

describe("decryptStatus with the group's key check", () => {
  it("proves the key before anything else, even with no data of your own", async () => {
    const opened = await decryptStatus(status(true, null, [], null, await checkUnder(encrypted)), encrypted);
    expect(encrypted.keyProven).toBe(true);
    // Consumed: the opened status doesn't carry it.
    expect(opened.group).not.toHaveProperty("keyCheck");
  });

  it("refutes a wrong key with no data of your own, e.g. an admin link before setup", async () => {
    // Without the check nothing could, and setup would seal every name under the wrong key.
    const theirs = createGroupCodec(true, await generateGroupKey());
    const raw = status(true, null, [], null, await checkUnder(theirs));
    await expect(decryptStatus(raw, encrypted)).rejects.toBeInstanceOf(WrongKeyError);
  });

  it("counts a check that decrypts but holds another value as proof", async () => {
    const raw = status(true, null, [], null, await encrypted.seal("something else"));
    await decryptStatus(raw, encrypted);
    expect(encrypted.keyProven).toBe(true);
  });

  it("ignores a check that isn't ciphertext: anyone with database access could write it", async () => {
    const raw = status(true, null, [], null, plainSealed(KEY_CHECK));
    await decryptStatus(raw, encrypted);
    expect(encrypted.keyProven).toBe(false);
    expect(console.error).toHaveBeenCalledWith("Ignoring the group's key check (mode)");
  });

  it("once it proves the key, your own field that doesn't open drops instead of deferring", async () => {
    const theirs = createGroupCodec(true, await generateGroupKey());
    const raw = status(
      true,
      { id: "me", name: await theirs.seal("Alice"), anatomy: null },
      [],
      null,
      await checkUnder(encrypted),
    );
    const opened = await decryptStatus(raw, encrypted);
    expect(opened.person?.name).toBe("");
    expect(opened.ownCiphertextUnproven).toBeUndefined();
  });

  it("throws MissingKeyError when the key is missing", async () => {
    const raw = status(true, null, [], null, await checkUnder(encrypted));
    await expect(decryptStatus(raw, createGroupCodec(true, null))).rejects.toBeInstanceOf(MissingKeyError);
  });
});

describe("keyCheckFillable", () => {
  async function profile(id: string, codec: GroupCodec) {
    return { id, name: await codec.seal(id), anatomy: null };
  }

  it("is set when your own and another member's ciphertext open and none fails", async () => {
    const raw = status(true, await profile("me", encrypted), [await profile("bob", encrypted)]);
    expect((await decryptStatus(raw, encrypted)).keyCheckFillable).toBe(true);
  });

  it("isn't set on your own data alone: a wrong key you wrote under would lock everyone out", async () => {
    const raw = status(true, await profile("me", encrypted), [{ id: "bob", name: plainSealed("Bob"), anatomy: null }]);
    expect((await decryptStatus(raw, encrypted)).keyCheckFillable).toBeUndefined();
  });

  it("isn't set when any ciphertext fails to decrypt", async () => {
    const theirs = createGroupCodec(true, await generateGroupKey());
    const raw = status(true, await profile("me", encrypted), [
      await profile("bob", encrypted),
      await profile("carol", theirs),
    ]);
    expect((await decryptStatus(raw, encrypted)).keyCheckFillable).toBeUndefined();
  });

  it("isn't set when the group already has a check, or isn't encrypted", async () => {
    const withCheck = status(
      true,
      await profile("me", encrypted),
      [await profile("bob", encrypted)],
      null,
      await checkUnder(encrypted),
    );
    expect((await decryptStatus(withCheck, encrypted)).keyCheckFillable).toBeUndefined();
    const plainRaw = status(false, await profile("me", plain), [await profile("bob", plain)]);
    expect((await decryptStatus(plainRaw, plain)).keyCheckFillable).toBeUndefined();
  });
});

function checkUnder(codec: GroupCodec) {
  return codec.seal<KeyCheck>(KEY_CHECK);
}
