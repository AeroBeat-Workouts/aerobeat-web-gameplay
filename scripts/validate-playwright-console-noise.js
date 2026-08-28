// @ts-check

import { readFileSync } from "node:fs";

const config = readFileSync(".testbed/playwright.config.js", "utf8");

if (!config.includes("console")) {
  console.error(".testbed/playwright.config.js must document console warning/error failure posture.");
  process.exit(1);
}

console.log("Playwright console-noise scaffold check passed.");
