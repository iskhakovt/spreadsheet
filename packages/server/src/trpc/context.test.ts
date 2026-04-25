import { fnv1a } from "@spreadsheet/shared";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { type HonoLoggerEnv, silentLogger } from "../logger.js";
import { createContext, createWSContext } from "./context.js";

const person = { id: "p1", groupId: "g1", name: "Alice", anatomy: null, isAdmin: false, isCompleted: false };
const group = {
  id: "g1",
  encrypted: false,
  isReady: true,
  questionMode: "all",
  showTiming: true,
  anatomyLabels: null,
  anatomyPicker: null,
};

function makeStores(getPersonByToken: (t: string) => Promise<typeof person | null>) {
  return {
    groups: {
      getPersonByToken,
      getGroupById: vi.fn().mockResolvedValue(group),
    },
    sync: {},
    questions: {},
  } as never;
}

/** Calls createContext inside a real Hono request so c.var.logger is populated. */
async function resolveContext(stores: ReturnType<typeof makeStores>, headers: Record<string, string>) {
  const app = new Hono<HonoLoggerEnv>();
  app.use("*", (c, next) => {
    c.set("logger", silentLogger);
    return next();
  });
  let ctx: Awaited<ReturnType<typeof createContext>> | undefined;
  app.get("/", async (c) => {
    ctx = await createContext(stores, c);
    return c.json({});
  });
  await app.request("/", { headers });
  return ctx!;
}

describe("createContext", () => {
  it("resolves person via x-person-token header", async () => {
    const stores = makeStores(vi.fn().mockResolvedValue(person));
    const ctx = await resolveContext(stores, { "x-person-token": "my-token" });
    expect(ctx.person?.id).toBe("p1");
    expect(ctx.personToken).toBe("my-token");
  });

  it("returns unauthenticated context when no auth header is present", async () => {
    const stores = makeStores(vi.fn().mockResolvedValue(null));
    const ctx = await resolveContext(stores, {});
    expect(ctx.person).toBeNull();
    expect(ctx.personToken).toBeNull();
  });

  it("resolves person via X-Session-Key + matching cookie", async () => {
    const token = "cookie-token";
    const hash = fnv1a(token);
    const stores = makeStores(vi.fn().mockResolvedValue(person));
    const ctx = await resolveContext(stores, {
      "x-session-key": hash,
      cookie: `s_${hash}=${token}`,
    });
    expect(ctx.person?.id).toBe("p1");
    expect(ctx.personToken).toBe(token);
  });

  it("returns unauthenticated context when X-Session-Key cookie is missing", async () => {
    const stores = makeStores(vi.fn());
    const ctx = await resolveContext(stores, { "x-session-key": "some-hash" });
    expect(ctx.person).toBeNull();
    expect(ctx.personToken).toBeNull();
  });

  it("prefers X-Session-Key over x-person-token when both are present", async () => {
    const token = "cookie-token";
    const hash = fnv1a(token);
    const getPersonByToken = vi.fn().mockResolvedValue(person);
    const stores = makeStores(getPersonByToken);
    await resolveContext(stores, {
      "x-session-key": hash,
      cookie: `s_${hash}=${token}`,
      "x-person-token": "other-token",
    });
    expect(getPersonByToken).toHaveBeenCalledWith(token);
    expect(getPersonByToken).not.toHaveBeenCalledWith("other-token");
  });
});

describe("createWSContext", () => {
  function makeWSOpts(params: Record<string, string>, cookieHeader = "") {
    return {
      req: { headers: { cookie: cookieHeader } },
      info: { connectionParams: params },
    } as never;
  }

  it("resolves person via token in connectionParams", async () => {
    const stores = makeStores(vi.fn().mockResolvedValue(person));
    const ctx = await createWSContext(stores, makeWSOpts({ token: "ws-token" }));
    expect(ctx.person?.id).toBe("p1");
    expect(ctx.personToken).toBe("ws-token");
  });

  it("resolves person via sessionKey + cookie", async () => {
    const token = "ws-cookie-token";
    const hash = fnv1a(token);
    const stores = makeStores(vi.fn().mockResolvedValue(person));
    const ctx = await createWSContext(stores, makeWSOpts({ sessionKey: hash }, `s_${hash}=${token}`));
    expect(ctx.person?.id).toBe("p1");
    expect(ctx.personToken).toBe(token);
  });

  it("returns unauthenticated context when sessionKey cookie is absent", async () => {
    const stores = makeStores(vi.fn());
    const ctx = await createWSContext(stores, makeWSOpts({ sessionKey: "hash" }));
    expect(ctx.person).toBeNull();
    expect(ctx.personToken).toBeNull();
  });

  it("returns unauthenticated context when no params are provided", async () => {
    const stores = makeStores(vi.fn().mockResolvedValue(null));
    const ctx = await createWSContext(stores, makeWSOpts({}));
    expect(ctx.person).toBeNull();
    expect(ctx.personToken).toBeNull();
  });

  it("ignores non-string token in connectionParams", async () => {
    const stores = makeStores(vi.fn());
    const opts = { req: { headers: { cookie: "" } }, info: { connectionParams: { token: 42 } } } as never;
    const ctx = await createWSContext(stores, opts);
    expect(ctx.person).toBeNull();
    expect(ctx.personToken).toBeNull();
  });

  it("ignores non-string sessionKey in connectionParams", async () => {
    const stores = makeStores(vi.fn());
    const opts = { req: { headers: { cookie: "" } }, info: { connectionParams: { sessionKey: true } } } as never;
    const ctx = await createWSContext(stores, opts);
    expect(ctx.person).toBeNull();
    expect(ctx.personToken).toBeNull();
  });
});
