import { type GroupStatusRow, plainSealed } from "@spreadsheet/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGroupCodec, type GroupCodec, WrongKeyError } from "./codec.js";
import { generateGroupKey, MissingKeyError } from "./crypto.js";
import { decryptStatus } from "./decrypt-status.js";
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
): GroupStatusRow {
  const flags = { isAdmin: false, isCompleted: false };
  return {
    person: self && { ...self, ...flags },
    group: {
      id: "g1",
      encrypted,
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
      expect(opened.profileNeedsReseal).toBeUndefined();
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

  it("accepts your own legacy plaintext in an encrypted group and flags it for re-sealing once the key is verified", async () => {
    // Bob's ciphertext opens, which proves this tab holds the right key.
    const raw = status(true, { id: "me", name: plainSealed("Alice"), anatomy: plainSealed("afab") }, [
      { id: "bob", name: await encrypted.seal("Bob"), anatomy: null },
    ]);
    const opened = await decryptStatus(raw, encrypted);
    expect(opened.person).toMatchObject({ name: "Alice", anatomy: "afab" });
    expect(opened.members[0]).toMatchObject({ name: "Alice", anatomy: "afab" });
    expect(opened.profileNeedsReseal).toBe(true);
  });

  it("shows your legacy plaintext but doesn't re-seal it while nothing verifies the key", async () => {
    const raw = status(true, { id: "me", name: plainSealed("Alice"), anatomy: null }, []);
    const opened = await decryptStatus(raw, encrypted);
    expect(opened.person?.name).toBe("Alice");
    expect(opened.profileNeedsReseal).toBeUndefined();
  });

  it("never re-seals another member's legacy plaintext", async () => {
    const raw = status(true, { id: "me", name: await encrypted.seal("Alice"), anatomy: null }, [
      { id: "bob", name: plainSealed("Bob"), anatomy: null },
    ]);
    const opened = await decryptStatus(raw, encrypted);
    expect(opened.members.find((m) => m.id === "bob")?.name).toBe(UI.unreadableName);
    expect(opened.profileNeedsReseal).toBeUndefined();
  });

  it("throws WrongKeyError when none of the group's ciphertext opens, instead of dropping it", async () => {
    // Dropping would route you to /setup and re-seal your name under the
    // wrong key, overwriting what the right key can still read.
    const theirs = createGroupCodec(true, await generateGroupKey());
    const raw = status(
      true,
      { id: "me", name: await theirs.seal("Alice"), anatomy: await theirs.seal("afab") },
      [{ id: "bob", name: await theirs.seal("Bob"), anatomy: null }],
      await theirs.seal({ answered: 1, total: 2 }),
    );
    await expect(decryptStatus(raw, encrypted)).rejects.toBeInstanceOf(WrongKeyError);
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
    expect(opened.profileNeedsReseal).toBeUndefined();
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

  it("empties your own name when it doesn't open but the key is verified, so /setup asks for it again", async () => {
    // e.g. a tampered row: Bob's name proves the key, so only yours is bad.
    const theirs = createGroupCodec(true, await generateGroupKey());
    const raw = status(true, { id: "me", name: await theirs.seal("Alice"), anatomy: null }, [
      { id: "bob", name: await encrypted.seal("Bob"), anatomy: null },
    ]);
    const opened = await decryptStatus(raw, encrypted);
    expect(opened.person?.name).toBe("");
    expect(opened.members.find((m) => m.id === "bob")?.name).toBe("Bob");
  });

  it("counts a value that decrypts but fails its schema as proof of the right key", async () => {
    const theirs = createGroupCodec(true, await generateGroupKey());
    const raw = status(true, { id: "me", name: await theirs.seal("Alice"), anatomy: null }, [
      { id: "bob", name: await encrypted.seal(""), anatomy: null },
    ]);
    const opened = await decryptStatus(raw, encrypted);
    expect(opened.person?.name).toBe("");
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
