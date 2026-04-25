import { describe, expect, it } from "vitest";
import { silentLogger } from "../../logger.js";
import { strictMock } from "../../test/mocks.js";
import type { TrpcContext } from "../context.js";
import { createCallerFactory } from "../init.js";
import { appRouter } from "../router.js";

const createCaller = createCallerFactory(appRouter);

function mockCtx(
  overrides: Partial<{
    person: TrpcContext["person"];
    group: TrpcContext["group"];
  }>,
): TrpcContext {
  return {
    groups: strictMock<TrpcContext["groups"]>(),
    sync: strictMock<TrpcContext["sync"]>(),
    questions: strictMock<TrpcContext["questions"]>(),
    person: overrides.person ?? null,
    group: overrides.group ?? null,
    personToken: overrides.person ? "mock-token" : null,
    logger: silentLogger,
  };
}

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

describe("analytics.track", () => {
  it("requires authentication", async () => {
    const caller = createCaller(mockCtx({}));
    await expect(caller.analytics.track({ event: "results_viewed" })).rejects.toThrow(
      "Invalid or missing person token",
    );
  });

  it("returns ok for results_viewed", async () => {
    const caller = createCaller(mockCtx({ person, group }));
    const result = await caller.analytics.track({ event: "results_viewed" });
    expect(result).toEqual({ ok: true });
  });

  it("rejects unknown event", async () => {
    const caller = createCaller(mockCtx({ person, group }));
    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input rejection
    await expect(caller.analytics.track({ event: "unknown" as any })).rejects.toThrow();
  });
});
