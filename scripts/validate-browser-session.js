// @ts-check

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";

const gameplayRoot = resolve(".");
const contractsRoot = resolve("../aerobeat-web-contracts");
const hashRoot = resolve("../aerobeat-web-hash");
const server = createServer(async (request, response) => {
  try {
    const path = request.url === "/" ? null : request.url?.split("?")[0] ?? null;
    if (path === null) {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"@aerobeat/web-contracts":"/contracts/src/index.js","@aerobeat/web-hash":"/hash/src/index.js"}}</script><script type="module">
        import { createAeroGameplaySessionCoordinator, createAeroPrototypeProfileRegistry } from "/gameplay/src/index.js";
        const HASH = "a".repeat(64);
        const runtime = createAeroGameplaySessionCoordinator({ sessionId: "browser" });
        const variant = { variantId: "browser-variant", chartId: "browser-chart", mode: "boxing", rulesetId: "boxing_semantic_track_v1", recipeId: "row_family_balanced_height_v1", modifierIds: [], ranked: false, mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, provenance: { kind: "authored" } };
        const clock = (positionMs, playing) => ({ contextTimeSeconds: positionMs / 1000, positionSeconds: positionMs / 1000, playing });
        const input = (calibrationId, paused = false, fresh = false) => ({ calibration: { calibrationId, readiness: fresh ? "calibration_required" : "countdown" }, tracking: { gameplayPaused: paused, freshCalibrationRequired: fresh }, countdownFrozen: paused, latestEvidence: null, straightQualifications: [] });
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
        const recoverySequence = [runtime.getSnapshot().countdown.value];
        runtime.advance({ timestampMs: 10_000, clock: clock(0, false) });
        recoverySequence.push(runtime.getSnapshot().countdown.value);
        runtime.advance({ timestampMs: 10_999, clock: clock(0, false) });
        recoverySequence.push(runtime.getSnapshot().countdown.value);
        runtime.advance({ timestampMs: 11_000, clock: clock(0, false) });
        recoverySequence.push(runtime.getSnapshot().countdown.value);
        runtime.advance({ timestampMs: 12_000, clock: clock(0, false) });
        recoverySequence.push(runtime.getSnapshot().session.state);
        const flowVariant = { ...variant, variantId: "browser-flow", chartId: "browser-flow-chart", mode: "flow", rulesetId: "flow_grid_v1", recipeId: null };
        const flowEvent = (eventId, centerTimestampMs, authoredBeat, endTimestampMs) => ({ schema: "aerobeat/resolved_content_event", version: 1, eventId, variantId: flowVariant.variantId, chartId: flowVariant.chartId, centerTimestampMs, ...(endTimestampMs === undefined ? {} : { endTimestampMs }), authoredBeat });
        const flowEvents = [
          flowEvent("browser-bomb", 500, { start: 1, type: "bomb", placement: 11 }),
          flowEvent("browser-obstacle", 600, { start: 1.2, end: 2, type: "obstacle", cells: [1,2,5,6] }, 1000),
          flowEvent("browser-arc", 700, { start: 1.4, end: 2.2, type: "arc", startPlacement: 8, endPlacement: 3, startDirection: 0, endDirection: 8 }, 1100),
          flowEvent("browser-burst", 800, { start: 1.6, end: 2.4, type: "burst", placement: 10, tailPlacement: 2, direction: 8, checkpointCount: 3 }, 1200)
        ];
        const flowRuntime = createAeroGameplaySessionCoordinator({ sessionId: "browser-flow" });
        flowRuntime.configureContent({ packageId: "browser-flow-package", selectedVariant: flowVariant, resolvedEvents: flowEvents });
        const beforeMalformedFlow = JSON.stringify(flowRuntime.getSnapshot());
        let malformedFlowRejected = false;
        try { flowRuntime.configureContent({ packageId: "browser-flow-package", selectedVariant: flowVariant, resolvedEvents: [flowEvent("bad-obstacle", 500, { start: 1, end: 2, type: "obstacle", cells: [1,1] }, 1000)] }); } catch { malformedFlowRejected = true; }
        const malformedFlowTransactional = beforeMalformedFlow === JSON.stringify(flowRuntime.getSnapshot());
        flowRuntime.advance({ timestampMs: 0, clock: clock(0, false), input: input("flow-cal") });
        flowRuntime.requestStart(0);
        flowRuntime.advance({ timestampMs: 1000, clock: clock(0, false) });
        flowRuntime.advance({ timestampMs: 2000, clock: clock(0, false) });
        flowRuntime.advance({ timestampMs: 3000, clock: clock(0, false) });
        flowRuntime.advance({ timestampMs: 4000, clock: clock(1200, true), input: input("flow-cal") });
        const ignoredFlowResults = flowRuntime.getJudgements().map((entry) => [entry.eventId, entry.result]);
        const profiles = createAeroPrototypeProfileRegistry();
        profiles.select("aero.visual.compact");
        profiles.select("aero.scoring.prototype-wide", { sessionState: "paused_manual" });
        profiles.select("aero.converter.prototype-reach");
        const profileSnapshot = JSON.parse(JSON.stringify(profiles.getSnapshot()));
        window.result = { states, recoverySequence, frozen: Object.isFrozen(runtime.getSnapshot()), serializable: JSON.parse(JSON.stringify(runtime.getSnapshot())).session.sessionId, countdownReason: runtime.getSnapshot().countdown.reason, malformedFlowRejected, malformedFlowTransactional, ignoredFlowResults, visualProfile: profileSnapshot.active.visual.profile.profileId, scoringProfile: profileSnapshot.active.scoring.profile.profileId, regenerationRequired: profileSnapshot.regenerationRequired, bundleHash: profiles.exportProfiles().bundleHash };
      </script>`);
      return;
    }
    const mapping = path.startsWith("/contracts/") ? [contractsRoot, path.slice(11)] : path.startsWith("/gameplay/") ? [gameplayRoot, path.slice(10)] : path.startsWith("/hash/") ? [hashRoot, path.slice(6)] : null;
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
  assert.deepEqual(result, { states: ["idle", "calibrating", "countdown", "playing", "paused_tracking", "paused_tracking", "countdown"], recoverySequence: [3, 2, 2, 1, "playing"], frozen: true, serializable: "browser", countdownReason: "tracking_resume", malformedFlowRejected: true, malformedFlowTransactional: true, ignoredFlowResults: [["browser-bomb", "ignored"], ["browser-obstacle", "ignored"], ["browser-arc", "ignored"], ["browser-burst", "ignored"]], visualProfile: "aero.visual.compact", scoringProfile: "aero.scoring.prototype-wide", regenerationRequired: true, bundleHash: "sha256:81df0fa01910c08bac660c036be23a1ac1bf3f0e8f62ad3355b9e8362b20ae37" });
  assert.deepEqual(consoleNoise, []);
} finally {
  await browser.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
console.log("Gameplay session browser validation passed.");
