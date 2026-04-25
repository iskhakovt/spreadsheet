import { fnv1a } from "@spreadsheet/shared";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type HonoLoggerEnv, silentLogger } from "../logger.js";
import type { GroupStore } from "../store/groups.js";
import type { QuestionStore } from "../store/questions.js";
import type { SyncStore } from "../store/sync.js";
import { strictMock } from "../test/mocks.js";
import { createContext, createWSContext } from "./context.js";

const person = {
  id: "p1",
  groupId: "g1",
  name: "Alice",
  anatomy: null,
  token: "tkn",
  isAdmin: false,
  isCompleted: false,
  progress: null,
  createdAt: new Date(),
};
const group = {
  id: "g1",
  adminToken: null,
  encrypted: false,
  isReady: true,
  questionMode: "all" as const,
  showTiming: true,
  anatomyLabels: null,
  anatomyPicker: null,
  createdAt: new Date(),
};

function makeStores(getPersonByToken: GroupStore["getPersonByToken"]) {
  const groups = strictMock<GroupStore>();
  groups.getPersonByToken.mockImplementation(getPersonByToken);
  groups.getGroupById.mockResolvedValue(group);
  return { groups, sync: strictMock<SyncStore>(), questions: strictMock<QuestionStore>() };
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
    const stores = makeStores(async () => person);
    const ctx = await resolveContext(stores, { "x-person-token": "my-token" });
    expect(ctx.person?.id).toBe("p1");
    expect(ctx.personToken).toBe("my-token");
  });

  it("returns unauthenticated context when no auth header is present", async () => {
    const stores = makeStores(async () => null);
    const ctx = await resolveContext(stores, {});
    expect(ctx.person).toBeNull();
    expect(ctx.personToken).toBeNull();
  });

  it("resolves person via X-Session-Key + matching cookie", async () => {
    const token = "cookie-token";
    const hash = fnv1a(token);
    const stores = makeStores(async () => person);
    const ctx = await resolveContext(stores, {
      "x-session-key": hash,
      cookie: `s_${hash}=${token}`,
    });
    expect(ctx.person?.id).toBe("p1");
    expect(ctx.personToken).toBe(token);
  });

  it("returns unauthenticated context when X-Session-Key cookie is missing", async () => {
    const stores = makeStores(async () => null);
    const ctx = await resolveContext(stores, { "x-session-key": "some-hash" });
    expect(ctx.person).toBeNull();
    expect(ctx.personToken).toBeNull();
  });

  it("prefers X-Session-Key over x-person-token when both are present", async () => {
    const token = "cookie-token";
    const hash = fnv1a(token);
    const stores = makeStores(async () => person);
    await resolveContext(stores, {
      "x-session-key": hash,
      cookie: `s_${hash}=${token}`,
      "x-person-token": "other-token",
    });
    expect(stores.groups.getPersonByToken).toHaveBeenCalledWith(token);
    expect(stores.groups.getPersonByToken).not.toHaveBeenCalledWith("other-token");
  });
});

describe("createWSContext", () => {
  type WSOpts = Parameters<typeof createWSContext>[1];

  function makeWSOpts(params: Record<string, unknown>, cookieHeader = ""): WSOpts {
    return { req: { headers: { cookie: cookieHeader } }, info: { connectionParams: params } } as WSOpts;
  }

  it("resolves person via token in connectionParams", async () => {
    const stores = makeStores(async () => person);
    const ctx = await createWSContext(stores, makeWSOpts({ token: "ws-token" }));
    expect(ctx.person?.id).toBe("p1");
    expect(ctx.personToken).toBe("ws-token");
  });

  it("resolves person via sessionKey + cookie", async () => {
    const token = "ws-cookie-token";
    const hash = fnv1a(token);
    const stores = makeStores(async () => person);
    const ctx = await createWSContext(stores, makeWSOpts({ sessionKey: hash }, `s_${hash}=${token}`));
    expect(ctx.person?.id).toBe("p1");
    expect(ctx.personToken).toBe(token);
  });

  it("returns unauthenticated context when sessionKey cookie is absent", async () => {
    const stores = makeStores(async () => null);
    const ctx = await createWSContext(stores, makeWSOpts({ sessionKey: "hash" }));
    expect(ctx.person).toBeNull();
    expect(ctx.personToken).toBeNull();
  });

  it("returns unauthenticated context when no params are provided", async () => {
    const stores = makeStores(async () => null);
    const ctx = await createWSContext(stores, makeWSOpts({}));
    expect(ctx.person).toBeNull();
    expect(ctx.personToken).toBeNull();
  });

  it("ignores non-string token in connectionParams", async () => {
    const stores = makeStores(async () => null);
    const ctx = await createWSContext(stores, makeWSOpts({ token: 42 }));
    expect(ctx.person).toBeNull();
    expect(ctx.personToken).toBeNull();
  });

  it("ignores non-string sessionKey in connectionParams", async () => {
    const stores = makeStores(async () => null);
    const ctx = await createWSContext(stores, makeWSOpts({ sessionKey: true }));
    expect(ctx.person).toBeNull();
    expect(ctx.personToken).toBeNull();
  });
});
