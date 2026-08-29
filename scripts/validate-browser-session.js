// @ts-check

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";

const gameplayRoot = resolve(".");
const contractsRoot = resolve("../aerobeat-web-contracts");
const server = createServer(async (request, response) => {
  try {
    const path = request.url === "/" ? null : request.url?.split("?")[0] ?? null;
    if (path === null) {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"@aerobeat/web-contracts":"/contracts/src/index.js"}}</script><script type="module">
        import { createAeroGameplaySessionCoordinator } from "/gameplay/src/index.js";
        const HASH = "a".repeat(64);
        const runtime = createAeroGameplaySessionCoordinator({ sessionId: "browser" });
        const variant = { variantId: "browser-variant", chartId: "browser-chart", mode: "boxing", rulesetId: "boxing_semantic_track_v1", recipeId: "row_family_balanced_height_v1", modifierIds: [], ranked: false, mapHash: { value: HASH }, scoreIdentityHash: { value: HASH }, provenance: { kind: "authored" } };
        const clock = (positionMs, playing) => ({ contextTimeSeconds: positionMs / 1000, positionSeconds: positionMs / 1000, playing });
        const input = (calibrationId, paused = false, fresh = false) => ({ calibration: { calibrationId, readiness: fresh ? "calibration_required" : "ready" }, tracking: { gameplayPaused: paused, freshCalibrationRequired: fresh }, countdownFrozen: paused, latestEvidence: null, straightQualifications: [] });
        const states = [runtime.getSnapshot().session.state];
        runtime.configureContent({ packageId: "browser-package", selectedVariant: variant, resolvedEvents: [] });
        states.push(runtime.getSnapshot().session.state);
        runtime.advance({ timestampMs: 0, clock: clock(0, false), input: input("cal-1") });
        runtime.requestStart(0);
        states.push(runtime.getSnapshot().session.state);
        runtime.advance({ timestampMs: 1000, clock: clock(0, false) });
        runtime.advance({ timestampMs: 2000, clock: clock(0, false) });
        runtime.advance({ timestampMs: 3000, clock: clock(0, false) });
        states.push(runtime.getSnapshot().session.state);
        runtime.advance({ timestampMs: 3100, clock: clock(100, true), input: input("cal-1", true, true) });
        states.push(runtime.getSnapshot().session.state);
        runtime.advance({ timestampMs: 3200, clock: clock(100, false), input: input("cal-1") });
        states.push(runtime.getSnapshot().session.state);
        runtime.advance({ timestampMs: 3300, clock: clock(100, false), input: input("cal-2") });
        states.push(runtime.getSnapshot().session.state);
        window.result = { states, frozen: Object.isFrozen(runtime.getSnapshot()), serializable: JSON.parse(JSON.stringify(runtime.getSnapshot())).session.sessionId, countdownReason: runtime.getSnapshot().countdown.reason };
      </script>`);
      return;
    }
    const mapping = path.startsWith("/contracts/") ? [contractsRoot, path.slice(11)] : path.startsWith("/gameplay/") ? [gameplayRoot, path.slice(10)] : null;
    if (!mapping) { response.statusCode = 404; response.end(); return; }
    const root = mapping[0];
    const file = resolve(root, mapping[1]);
    if (file !== root && !file.startsWith(`${root}${sep}`)) { response.statusCode = 403; response.end(); return; }
    response.setHeader("content-type", extname(file) === ".js" ? "text/javascript; charset=utf-8" : "application/octet-stream");
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end();
  }
});
await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Browser server did not bind");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const consoleNoise = [];
  page.on("console", (message) => { if (message.type() === "warning" || message.type() === "error") consoleNoise.push(`${message.type()}: ${message.text()}`); });
  page.on("pageerror", (error) => consoleNoise.push(`pageerror: ${error.message}`));
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(() => "result" in window);
  const result = await page.evaluate(() => window.result);
  assert.deepEqual(result, { states: ["idle", "calibrating", "countdown", "playing", "paused_tracking", "paused_tracking", "countdown"], frozen: true, serializable: "browser", countdownReason: "tracking_resume" });
  assert.deepEqual(consoleNoise, []);
} finally {
  await browser.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
console.log("Gameplay session browser validation passed.");
