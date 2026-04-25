import { fnv1a } from "@spreadsheet/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getAuthHeaders,
  getAuthParams,
  getAuthToken,
  getScope,
  sessionStore,
  setExchanged,
  setSession,
} from "./session.js";

describe("session", () => {
  beforeEach(() => {
    sessionStore.setState({ token: null, hash: null, exchanged: false, scope: "" });
  });

  it("returns no auth before setSession", () => {
    expect(getAuthHeaders()).toEqual({});
    expect(getAuthParams()).toEqual({});
    expect(getAuthToken()).toBeNull();
    expect(getScope()).toBe("");
  });

  it("sends x-person-token before exchange", () => {
    setSession("tkn-1");
    expect(getAuthHeaders()).toEqual({ "x-person-token": "tkn-1" });
    expect(getAuthParams()).toEqual({ token: "tkn-1" });
    expect(getAuthToken()).toBe("tkn-1");
    expect(getScope()).toBe(`s${fnv1a("tkn-1")}:`);
  });

  it("switches to x-session-key after setExchanged", () => {
    setSession("tkn-1");
    setExchanged();
    const hash = fnv1a("tkn-1");
    expect(getAuthHeaders()).toEqual({ "x-session-key": hash });
    expect(getAuthParams()).toEqual({ sessionKey: hash });
    expect(getAuthToken()).toBe("tkn-1");
  });

  it("resets exchanged when the token changes", () => {
    setSession("tkn-1");
    setExchanged();
    setSession("tkn-2");
    expect(getAuthHeaders()).toEqual({ "x-person-token": "tkn-2" });
    expect(getAuthParams()).toEqual({ token: "tkn-2" });
    expect(getScope()).toBe(`s${fnv1a("tkn-2")}:`);
  });

  it("is a no-op when setSession is called with the same token", () => {
    setSession("tkn-1");
    setExchanged();
    setSession("tkn-1");
    expect(getAuthHeaders()).toEqual({ "x-session-key": fnv1a("tkn-1") });
  });
});
