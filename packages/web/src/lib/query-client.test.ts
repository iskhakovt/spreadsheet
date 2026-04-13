import { describe, expect, it } from "vitest";
import { MissingKeyError } from "./crypto.js";
import { makeQueryClient } from "./query-client.js";

function getRetryFn() {
  const qc = makeQueryClient();
  const retry = qc.getDefaultOptions().queries?.retry;
  if (typeof retry !== "function") throw new Error("expected retry to be a function");
  return retry;
}

describe("makeQueryClient retry", () => {
  it("does not retry errors with retry: false", () => {
    const retry = getRetryFn();
    const error = new MissingKeyError();
    expect(retry(0, error)).toBe(false);
  });

  it("retries normal errors up to 2 times", () => {
    const retry = getRetryFn();
    const error = new Error("network failure");
    expect(retry(0, error)).toBe(true);
    expect(retry(1, error)).toBe(true);
    expect(retry(2, error)).toBe(false);
  });
});
