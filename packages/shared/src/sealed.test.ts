import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { isSealedFormat, type Opened, type Sealed, sealed, sealedModeMatches, sealedOutput } from "./sealed.js";
import { fakeEncrypted, plainSealed } from "./test-helpers.js";
import type { Anatomy, GroupStatus, Person, Progress, SealedPerson } from "./types.js";

describe("isSealedFormat", () => {
  it("accepts p:N: and e:N: prefixes", () => {
    expect(isSealedFormat('p:1:"Alice"')).toBe(true);
    expect(isSealedFormat("e:1:abc")).toBe(true);
    expect(isSealedFormat("e:2:abc")).toBe(true);
  });

  it("rejects raw strings and other prefixes", () => {
    expect(isSealedFormat("Alice")).toBe(false);
    expect(isSealedFormat("")).toBe(false);
    expect(isSealedFormat("x:1:abc")).toBe(false);
    expect(isSealedFormat("p:abc")).toBe(false);
    expect(isSealedFormat(42)).toBe(false);
  });
});

describe("sealedModeMatches", () => {
  it("requires e: in encrypted groups and p: in plaintext ones", () => {
    expect(sealedModeMatches("e:1:abc", true)).toBe(true);
    expect(sealedModeMatches('p:1:"Alice"', false)).toBe(true);
    expect(sealedModeMatches('p:1:"Alice"', true)).toBe(false);
    expect(sealedModeMatches("e:1:abc", false)).toBe(false);
  });

  it("rejects raw values in either mode", () => {
    expect(sealedModeMatches("Alice", true)).toBe(false);
    expect(sealedModeMatches("Alice", false)).toBe(false);
  });
});

describe("sealed() input schema", () => {
  const schema = z.object({ name: sealed<string>() });

  it("accepts sealed values", () => {
    expect(schema.safeParse({ name: plainSealed("Alice") }).success).toBe(true);
    expect(schema.safeParse({ name: fakeEncrypted("x") }).success).toBe(true);
  });

  it("rejects a raw string at runtime", () => {
    expect(schema.safeParse({ name: "Alice" }).success).toBe(false);
  });

  it("types its input as Sealed<T>, so a raw string doesn't compile", () => {
    expectTypeOf<z.input<typeof schema>["name"]>().toEqualTypeOf<Sealed<string>>();
    expectTypeOf<string>().not.toExtend<z.input<typeof schema>["name"]>();
  });
});

describe("sealedOutput() schema", () => {
  const schema = sealedOutput<Anatomy>();

  it("passes any string through unchanged, so one bad row can't fail a response", () => {
    expect(schema.parse("not-sealed")).toBe("not-sealed");
    expect(schema.parse("e:1:abc")).toBe("e:1:abc");
  });

  it("is typed string on the way in and Sealed<T> on the way out", () => {
    expectTypeOf<z.input<typeof schema>>().toEqualTypeOf<string>();
    expectTypeOf<z.output<typeof schema>>().toEqualTypeOf<Sealed<Anatomy>>();
  });
});

describe("Opened<T>", () => {
  it("maps sealed fields to their payload type, through nullables and arrays", () => {
    expectTypeOf<Opened<Sealed<string>>>().toEqualTypeOf<string>();
    expectTypeOf<Opened<Sealed<Anatomy> | null>>().toEqualTypeOf<Anatomy | null>();
    expectTypeOf<Opened<Sealed<Progress>[]>>().toEqualTypeOf<Progress[]>();
    expectTypeOf<Person["name"]>().toEqualTypeOf<string>();
    expectTypeOf<Person["anatomy"]>().toEqualTypeOf<Anatomy | null>();
    expectTypeOf<GroupStatus["members"][number]["progress"]>().toEqualTypeOf<Progress | null>();
  });

  it("keeps opened values out of sealed slots", () => {
    expectTypeOf<Person["name"]>().not.toExtend<SealedPerson["name"]>();
  });
});
