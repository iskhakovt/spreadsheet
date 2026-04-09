import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PORT_FILE = resolve(import.meta.dirname, ".e2e-port");

export const test = base.extend({
  baseURL: async ({}, use) => {
    let port: string;
    try {
      port = readFileSync(PORT_FILE, "utf-8").trim();
    } catch {
      throw new Error(`E2E port file not found at ${PORT_FILE} — did globalSetup run?`);
    }
    if (!port || !/^\d+$/.test(port)) {
      throw new Error(`Invalid port in ${PORT_FILE}: "${port}"`);
    }
    await use(`http://localhost:${port}`);
  },
});

export { expect };
