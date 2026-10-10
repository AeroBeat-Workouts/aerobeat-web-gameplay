// @ts-check
// Spatial Boxing checkpoints retain the mask's safe-cell complement, but a
// 4.5-row squat intrudes halfway into row 1. Judge the measured nose against
// exact geometry in addition to the coarse cell; weave remains cell-only.
import assert from "node:assert/strict";
import { deriveObstacleGridMask } from "@aerobeat/web-contracts";
import { createAeroGameplaySessionCoordinator } from "../src/index.js";

const HASH = "a".repeat(64);
const BOXING = { variantId: "checkpoint", chartId: "chart-checkpoint", mode: "boxing", rulesetId: "boxing_spatial_grid_v1", recipeId: "row_family_balanced_height_v1", modifierIds: [], ranked: false, mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, provenance: { kind: "imported" } };
const profileIdentity = { schema: "aerobeat/prototype_tuning_identity", version: 1, profileId: "checkpoint", profileVersion: "1", contentHash: HASH, class: "between_run_ruleset", regenerationRequired: false };
const clock = (ms, playing) => ({ contextTimeSeconds: ms / 1000, positionSeconds: ms / 1000, playing });
const squatGeometry = { x: 0, y: -3, width: 4, height: 4.5 };
const weaveGeometry = { x: 0, y: 0, width: 2, height: 3 };

function obstacle(type, geometry) {
  const gameplayGeometry = { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", ...geometry };
  const gridMask = [...deriveObstacleGridMask(gameplayGeometry)];
  return { schema: "aerobeat/resolved_content_event", version: 3, eventId: type, variantId: BOXING.variantId, chartId: BOXING.chartId, centerTimestampMs: 1000, intervalStartTimestampMs: 1000, intervalEndTimestampMs: 1200, sourceEventIds: [`source-${type}`], type, sourceGeometry: { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v3_obstacle_rect", kind: "v3_rect", x: geometry.x, y: 0, width: geometry.width, height: 3 }, gameplayGeometry, gridMask, blockedCells: [...gridMask], checkpoint: { kind: "instantaneous", freshnessMs: 150, timingWindowMs: 180, noseSafeCells: Array.from({ length: 12 }, (_, cell) => cell).filter((cell) => !gridMask.includes(cell)) } };
}
function anchor(name, measured, x, y, cell) {
  return { schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "cal-1", measurementTimestampMs: measured, valid: true, confidence: 1, rawX: 0.5, rawY: 0.5, x, y, cell, subcell: 20 };
}
function evidence(measured, type, noseX, noseY, noseCell) {
  const anchors = ["nose", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist"].map((name) => name === "nose" ? anchor(name, measured, noseX, noseY, noseCell) : anchor(name, measured, 0.5, 0.5, 5));
  return { schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal-1", measuredSourceFrameId: `frame-${measured}`, measurementTimestampMs: measured, provenance: "measured", activeBoxingActions: [type], anchors, entries: [] };
}
function run(type, geometry, noseX, noseY, noseCell) {
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: `checkpoint-${type}-${noseX}-${noseY}`, countdownStepMs: 1 });
  coordinator.configureContent({ packageId: "checkpoint-package", selectedVariant: BOXING, resolvedEvents: [obstacle(type, geometry)], profileIdentity });
  const input = (sample) => ({ calibration: { calibrationId: "cal-1", readiness: "countdown" }, tracking: { gameplayPaused: false, freshCalibrationRequired: false }, countdownFrozen: false, latestEvidence: sample, straightQualifications: [] });
  coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: input(null) });
  assert.equal(coordinator.requestStart(0).accepted, true);
  for (const ms of [1, 2, 3]) coordinator.advance({ timestampMs: ms, clock: clock(0, false) });
  assert.equal(coordinator.getSnapshot().session.state, "playing");
  coordinator.advance({ timestampMs: 1000, clock: clock(1000, true), input: input(evidence(1000, type, noseX, noseY, noseCell)) });
  const early = coordinator.getJudgements();
  coordinator.advance({ timestampMs: 1181, clock: clock(1181, true), input: input(evidence(1181, type, noseX, noseY, noseCell)) });
  const judged = coordinator.getJudgements();
  coordinator.destroy();
  return { early, judged };
}

assert.deepEqual([...deriveObstacleGridMask({ schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", ...squatGeometry })], [0, 1, 2, 3]);
// The squat occupies normalized y <= 0.5, inclusive at the fractional edge;
// y = 0.25 is upper row1 (contact), y = 0.5 is tangent, y = 0.75 is clear.
for (const [label, y, expected] of [["upper half", 0.25, "miss"], ["inclusive boundary", 0.5, "miss"], ["lower half", 0.75, "hit"]]) {
  const { early, judged } = run("squat", squatGeometry, 0.5, y, 5);
  assert.equal(early.length, expected === "hit" ? 1 : 0, `${label}: no unsafe early hit`);
  assert.deepEqual(judged.map((entry) => entry.result), [expected], `${label}: score agrees with exact visible geometry`);
}
// A two-column weave still scores by its existing safe-cell complement; do
// not apply squat's vertical geometry restriction to weave.
assert.deepEqual(run("weave_right", weaveGeometry, 0.875, 0.25, 7).judged.map((entry) => entry.result), ["hit"], "weave safe-side control");
assert.deepEqual(run("weave_right", weaveGeometry, 0.125, 0.25, 4).judged.map((entry) => entry.result), ["miss"], "weave blocked-side control");
console.log("Boxing squat partial-row checkpoint and weave control passed.");
