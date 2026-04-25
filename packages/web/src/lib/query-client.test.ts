import { describe, expect, it } from "vitest";
import { MissingKeyError } from "./crypto.js";
import { NonRetriableError } from "./errors.js";
import { makeQueryClient } from "./query-client.js";

function getRetryFn() {
  const qc = makeQueryClient();
  const retry = qc.getDefaultOptions().queries?.retry;
  if (typeof retry !== "function") throw new Error("expected retry to be a function");
  return retry;
}

describe("makeQueryClient retry", () => {
  it("does not retry NonRetriableError subclasses", () => {
    const retry = getRetryFn();
    expect(retry(0, new MissingKeyError())).toBe(false);
    expect(retry(0, new NonRetriableError("boom"))).toBe(false);
  });

  it("retries normal errors up to 2 times", () => {
    const retry = getRetryFn();
    const error = new Error("network failure");
    expect(retry(0, error)).toBe(true);
    expect(retry(1, error)).toBe(true);
    expect(retry(2, error)).toBe(false);
  });
});
