import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));

function serve(env: Record<string, string>) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/main.ts", "serve"], {
    cwd: serverRoot,
    // Unreachable on purpose: the check must fail before anything connects.
    env: { PATH: process.env.PATH ?? "", DATABASE_URL: "postgres://nobody@127.0.0.1:1/none", ...env },
    encoding: "utf-8",
    timeout: 15_000,
  });
}

describe("serve startup", () => {
  it("refuses to start without STOKEN_SECRET, instead of starting with sync broken", () => {
    const result = serve({});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("STOKEN_SECRET environment variable is required");
  });
});
