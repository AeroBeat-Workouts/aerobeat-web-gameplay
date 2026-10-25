// @ts-check
import assert from "node:assert/strict";
import { isGameplayJudgement } from "@aerobeat/web-contracts";
import { createAeroGameplaySessionCoordinator, defaultKneeColliderSettings, createKneeColliderSettings, kneeColliderSettingsIdentity } from "../src/index.js";
import { createAeroBodyGridService } from "../../aerobeat-web-input/src/index.js";

const HASH = "a".repeat(64);
const identity = { schema: "aerobeat/equipment_config_identity", version: 1, algorithm: "sha256", value: "b".repeat(64) };
const variant = (rulesetId = "boxing_collider_knee_v1") => ({ variantId: "knee-chart", chartId: "chart-knee", mode: "boxing", rulesetId, recipeId: null, ranked: false, localOnly: true, modifierIds: [], mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH } });
const beat = (id, time, type, cell) => ({ schema: "aerobeat/resolved_content_event", version: 3, eventId: id, variantId: "knee-chart", chartId: "chart-knee", centerTimestampMs: time, type, sourceEventIds: [`source-${id}`], spatialTarget: { targetCell: cell, acceptedSubcells: [cell * 4, cell * 4 + 1] }, timingWindowMs: 180, evidenceFreshnessMs: 150 });
const anchor = (name, time, sx, sy) => ({ schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "cal", measurementTimestampMs: time, valid: true, confidence: 1, rawX: 0.5, rawY: 0.5, x: (sx + .5) / 4, y: (2.5 - sy) / 3, cell: (sx + .5) / 4 < 0 || (sx + .5) / 4 > 1 || (2.5 - sy) / 3 < 0 || (2.5 - sy) / 3 > 1 ? null : 5, subcell: (sx + .5) / 4 < 0 || (sx + .5) / 4 > 1 || (2.5 - sy) / 3 < 0 || (2.5 - sy) / 3 > 1 ? null : 20 });
const projected = (sx, sy) => ({ x: (sx + .5) / 4, y: (2.5 - sy) / 3 });
function evidence(time, id, sides = { left: [1, 0], right: [2, 0] }, extras = {}) {
  const anchors = [anchor("nose", time, 0, 1), anchor("left_shoulder", time, 0, 1), anchor("right_shoulder", time, 3, 1), anchor("left_elbow", time, 0, 1), anchor("right_elbow", time, 3, 1), anchor("left_wrist", time, -4, 2), anchor("right_wrist", time, 7, 2)];
  const legs = Object.entries(sides).map(([side, [sx, sy]]) => ({ side, hip: projected(sx, sy + 1), knee: projected(sx, sy), ankle: projected(sx, sy - 1), confidence: 1 }));
  return { schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal", measuredSourceFrameId: id, measurementTimestampMs: time, provenance: "measured", activeBoxingActions: [], anchors, entries: [], ...(legs.length ? { kneePose: { schema: "aerobeat/measured_knee_pose", version: 1, calibrationId: "cal", measuredSourceFrameId: id, measurementTimestampMs: time, legs } } : {}), ...extras };
}
function input(sample) { return { sourceIdentity: "camera-a", calibration: { calibrationId: "cal", readiness: "countdown" }, tracking: { gameplayPaused: false, freshCalibrationRequired: false }, countdownFrozen: false, latestEvidence: sample, straightQualifications: [] }; }
function poses(sample) { return ["left_wrist", "right_wrist"].map(role => { const point = sample.anchors.find(item => item.anchor === role); return { role, mode: "boxing", anchor: { x: 4 * point.x - .5, y: 2.5 - 3 * point.y, z: 0 }, scale: 1, orientation: { x: 0, y: 0, z: 0, w: 1 }, geometryIdentity: "aerobeat/glove_obb_v1", configIdentity: identity }; }); }
const clock = (ms, playing) => ({ contextTimeSeconds: ms / 1000, positionSeconds: ms / 1000, playing });
function setup(events, kneeColliderSettings, rulesetId) {
  const game = createAeroGameplaySessionCoordinator({ sessionId: "knee-score", countdownStepMs: 1 });
  game.configureContent({ packageId: "package", selectedVariant: variant(rulesetId), resolvedEvents: events, ...(kneeColliderSettings ? { kneeColliderSettings } : {}) });
  game.advance({ timestampMs: 0, clock: clock(0, false), input: input(null) });
  assert.equal(game.requestStart(0).accepted, true);
  for (const t of [1, 2, 3]) game.advance({ timestampMs: t, clock: clock(0, false) });
  assert.equal(game.getSnapshot().session.state, "playing");
  return game;
}
function send(game, wall, song, id, sides, extras) { const sample = evidence(song, id, sides, extras); game.advance({ timestampMs: wall, clock: clock(song, true), input: input(sample), equipmentPoses: poses(sample) }); }
const result = game => game.getJudgements().map(j => [j.eventId, j.result]);

const left = beat("knee-left", 1000, "knee_left", 9);
{
  const live = setup([beat("live-knee", 1000, "knee_left", 9)]);
  send(live, 900, 900, "knee-old-height", { left: [1, 0] });
  assert.deepEqual(result(live), [], "active knee misses old row-reach height");
  live.setBoxingHeightTuning({ shoulderWorldY: 0, offsets: { straight: 0, hook: 0, uppercut: 0, guard: 0, knee: 0 } });
  send(live, 1000, 1000, "knee-new-height", { left: [1, 0] });
  assert.deepEqual(result(live), [["live-knee", "hit"]], "active knee immediately scores shoulder-relative height");
}
const right = beat("knee-right", 1200, "knee_right", 10);
const game = setup([left, right]);
send(game, 1000, 1000, "frame-1", { left: [1, .75], right: [8, 0] });
assert.deepEqual(result(game), [["knee-left", "hit"]], "current measured matching knee scores without any wrist action");
assert.equal(isGameplayJudgement(game.getJudgements()[0]), true);
assert.equal(game.getScorePartitions()[0].kneeColliderSettingsIdentity, kneeColliderSettingsIdentity(defaultKneeColliderSettings));
send(game, 1001, 1001, "frame-1", { left: [1, .75], right: [2, .75] });
assert.equal(game.getJudgements().length, 1, "duplicate measured frame cannot hit another knee");
send(game, 1200, 1200, "frame-2", { left: [1, .75], right: [2, .75] });
assert.deepEqual(result(game), [["knee-left", "hit"], ["knee-right", "hit"]], "second matching-side target scores once");
assert.equal(game.getScorePartitions()[0].hits, 2);

for (const [name, sides, wall, extra] of [
  ["wrong side", { right: [1, .75] }, 1000, {}],
  ["outside volume", { left: [1, 2] }, 1000, {}],
  ["stale", { left: [1, .75] }, 1150, {}],
  ["no knee pose", {}, 1000, {}],
  ["frozen", { left: [1, .75] }, 1000, { provenance: "frozen", frozenTickId: 1, kneePose: undefined }]
]) {
  const g = setup([left]);
  const sample = evidence(1000, `frame-${name}`, sides, extra);
  if (name === "frozen") delete sample.kneePose;
  if (name === "stale") {
    // A valid old measured frame is not a current equipment pose either.
    assert.throws(() => g.advance({ timestampMs: wall, clock: clock(1000, true), input: input(sample), equipmentPoses: poses(sample) }), /current valid measured wrist/);
    assert.deepEqual(result(g), [], name);
    continue;
  }
  g.advance({ timestampMs: wall, clock: clock(1000, true), input: input(sample), equipmentPoses: poses(sample) });
  assert.deepEqual(result(g), [], name);
}
const off = setup([left], createKneeColliderSettings({ ...defaultKneeColliderSettings, colliderScale: 0 }));
send(off, 1000, 1000, "zero", { left: [1, .75] });
assert.deepEqual(result(off), [], "zero knee scale disables overlap");
assert.notEqual(kneeColliderSettingsIdentity(defaultKneeColliderSettings), kneeColliderSettingsIdentity({ ...defaultKneeColliderSettings, colliderScale: 0 }));
assert.equal(kneeColliderSettingsIdentity(defaultKneeColliderSettings), kneeColliderSettingsIdentity({ ...defaultKneeColliderSettings, colliderVisible: true }), "Show has no scoring identity");
for (const key of ["colliderScale", "colliderDepthForward", "colliderDepthBackward"]) {
  assert.notEqual(kneeColliderSettingsIdentity(defaultKneeColliderSettings), kneeColliderSettingsIdentity({ ...defaultKneeColliderSettings, [key]: 2 }), `${key} partitions identity`);
  assert.throws(() => createKneeColliderSettings({ ...defaultKneeColliderSettings, [key]: -1 }), /nonnegative/);
}
const noKnee = setup([], undefined, "boxing_collider_v1");
assert.throws(() => noKnee.configureKneeColliderSettings(defaultKneeColliderSettings), /Knee settings/);
assert.throws(() => setup([left], undefined, "boxing_collider_v1"), /unsupported/, "historical ruleset rejects knee beats");
assert.throws(() => setup([left], undefined, "boxing_spatial_grid_v1"), /conversion recipe|unsupported/, "semantic and spatial boxing cannot score knees");
const settingsGame = createAeroGameplaySessionCoordinator();
settingsGame.configureContent({ packageId: "package", selectedVariant: variant(), resolvedEvents: [left] });
assert.equal(settingsGame.configureKneeColliderSettings({ ...defaultKneeColliderSettings, colliderScale: 2 }).colliderScale, 2);
assert.throws(() => settingsGame.configureContent({ packageId: "package", selectedVariant: variant("boxing_collider_v1"), resolvedEvents: [], kneeColliderSettings: defaultKneeColliderSettings }), /Knee settings/);
// Genuine input boundary: measured normalized MediaPipe-style landmarks pass
// through the actual body-grid calibration/projection before this coordinator.
{
  const grid = createAeroBodyGridService({ calibrationIdPrefix: "knee-integration" });
  const upper = { nose: [.5, .3], left_shoulder: [.6, .4], right_shoulder: [.4, .4], left_elbow: [.7, .4], right_elbow: [.3, .4], left_wrist: [.8, .4], right_wrist: [.2, .4] };
  const routing = (time, legY = null) => ({ sourceId: "camera-a", timestampMs: time, mirrored: true, landmarks: [...Object.entries(upper).map(([name, [x, y]]) => ({ name, x, y, confidence: .95 })), ...(legY === null ? [] : ["left", "right"].flatMap(side => ["hip", "knee", "ankle"].map(joint => ({ name: `${side}_${joint}`, x: side === "left" ? .65 : .35, y: joint === "hip" ? .55 : joint === "ankle" ? .9 : legY, confidence: .95 }))))] });
  for (let t = 0; t <= 2250; t += 250) grid.processPoseSample(routing(t));
  for (let t = 2500; t <= 5500; t += 250) grid.processPoseSample(routing(t));
  const measured = grid.processPoseSample(routing(5600, .5));
  assert.ok(measured.latestEvidence?.kneePose, "actual input publishes measured kneePose");
  const source = measured.latestEvidence;
  const projectedKnee = source.kneePose.legs.find(leg => leg.side === "left").knee;
  const expected = { x: 4 * projectedKnee.x - .5, y: 2.5 - 3 * projectedKnee.y };
  assert.ok(Math.abs(expected.x - 1) < .75 && Math.abs(expected.y - .75) < .75, "actual calibrated input projects the knee into the target cell");
  const c = createAeroGameplaySessionCoordinator({ countdownStepMs: 1 });
  const authored = beat("actual-input-knee", 5600, "knee_left", 9);
  c.configureContent({ packageId: "package", selectedVariant: variant(), resolvedEvents: [authored], kneeColliderSettings: defaultKneeColliderSettings });
  c.advance({ timestampMs: 0, clock: clock(0, false), input: grid.getSnapshot() });
  assert.equal(c.requestStart(0).accepted, true);
  for (const time of [1, 2, 3]) c.advance({ timestampMs: time, clock: clock(0, false) });
  c.advance({ timestampMs: 5600, clock: clock(5600, true), input: measured, equipmentPoses: poses(source) });
  assert.ok(Number.isFinite(expected.x) && Number.isFinite(expected.y), "calibrated input knee projection is finite");
  assert.deepEqual(result(c), [["actual-input-knee", "hit"]], "actual input measured knee scores through the coordinator");
  grid.destroy();
}
console.log("Measured knee collider coordinator scoring passed.");
