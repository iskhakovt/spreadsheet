import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const releasercPath = fileURLToPath(new URL("./.releaserc.json", import.meta.url));
const releaserc = JSON.parse(readFileSync(releasercPath, "utf8"));

const findPlugin = (name) => releaserc.plugins?.find((p) => Array.isArray(p) && p[0] === name)?.[1];

const analyzer = findPlugin("@semantic-release/commit-analyzer");
const generator = findPlugin("@semantic-release/release-notes-generator");

const types = Array.from(
  new Set([
    ...(analyzer?.releaseRules ?? []).map((r) => r.type).filter(Boolean),
    ...(generator?.presetConfig?.types ?? []).map((t) => t.type),
  ]),
);

export default {
  extends: ["@commitlint/config-conventional"],
  ...(types.length > 0 && {
    rules: { "type-enum": [2, "always", types] },
  }),
};
