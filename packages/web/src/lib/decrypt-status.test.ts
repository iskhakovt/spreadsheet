import { type GroupStatusRow, plainSealed } from "@spreadsheet/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGroupCodec, type GroupCodec } from "./codec.js";
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

  it("accepts your own legacy plaintext in an encrypted group and flags it for re-sealing", async () => {
    const raw = status(true, { id: "me", name: plainSealed("Alice"), anatomy: plainSealed("afab") }, []);
    const opened = await decryptStatus(raw, encrypted);
    expect(opened.person).toMatchObject({ name: "Alice", anatomy: "afab" });
    expect(opened.members[0]).toMatchObject({ name: "Alice", anatomy: "afab" });
    expect(opened.profileNeedsReseal).toBe(true);
  });

  it("empties your own name when it doesn't open at all, so /setup asks for it again", async () => {
    const other = createGroupCodec(true, await generateGroupKey());
    const raw = status(true, { id: "me", name: await other.seal("Alice"), anatomy: null }, []);
    const opened = await decryptStatus(raw, encrypted);
    expect(opened.person?.name).toBe("");
    expect(opened.profileNeedsReseal).toBeUndefined();
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
