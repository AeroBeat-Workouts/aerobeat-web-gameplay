// @ts-check

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = readFileSync(".testbed/playwright.config.js", "utf8");
const demo = readFileSync(".testbed/demo/main.js", "utf8");
const fixture = JSON.parse(readFileSync(".testbed/fixtures/scaffold-session.json", "utf8"));

assert.match(config, /fail on unexpected console warning\/error/u);
assert.match(demo, /foundation only/u);
assert.deepEqual(fixture, {
  schema: "aero.gameplay.scaffold-fixture",
  version: 1,
  mode: "flow",
  clockMs: 0,
  events: []
});

console.log("Deterministic gameplay browser placeholder check passed.");
