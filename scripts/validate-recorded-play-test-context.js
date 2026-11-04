// @ts-check
import assert from "node:assert/strict";
import { createAeroGameplaySessionCoordinator, defaultFlowColliderSettings, defaultBoxingColliderSettings } from "../src/index.js";

const hash = "a".repeat(64);
const identity = { schema: "aerobeat/equipment_config_identity", version: 1, algorithm: "sha256", value: "b".repeat(64) };
const replayOptions = { purpose: "visual_test", recordedPlayReplay: true };
const startRequest = purpose => ({ schema: "aerobeat/gameplay_session_start", version: 1, purpose });
const clock = (ms, playing = true) => ({ contextTimeSeconds: ms / 1000, positionSeconds: ms / 1000, playing });
const interaction = (epoch, activationTimelineMs) => ({ schema: "aerobeat/visual_test_interaction", version: 1, mode: "production_judgement", epoch, activationTimelineMs });
function configuration(mode = "flow", center = 1000, direction) {
  const selectedVariant = { variantId: "recorded", chartId: "recorded-chart", mode, rulesetId: mode === "flow" ? "flow_colliders_v1" : "boxing_collider_v1", recipeId: null, modifierIds: [], ranked: true, localOnly: false, mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: hash }, scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: hash }, provenance: { kind: "imported" } };
  const event = { schema: "aerobeat/resolved_content_event", version: 3, eventId: "recorded-note", variantId: "recorded", chartId: "recorded-chart", centerTimestampMs: center, sourceEventIds: ["source"], ...(mode === "flow" ? { type: "note", hand: "left", placement: 5, ...(direction === undefined ? {} : { direction }) } : { type: "straight_left", spatialTarget: { targetCell: 5, acceptedSubcells: [], sourceCell: -1 } }) };
  return { packageId: "recorded-package", selectedVariant, resolvedEvents: [event], ...(mode === "flow" ? { flowColliderSettings: { ...defaultFlowColliderSettings, colliderDepthBackward: 0 } } : { boxingColliderSettings: { ...defaultBoxingColliderSettings, colliderDepthBackward: 10 } }) };
}
function measured(t, x = 1, y = 1) {
  const anchor = (name, sx, sy) => ({ schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "recorded-cal", measurementTimestampMs: t, valid: true, confidence: 1, rawX: .5, rawY: .5, x: (sx + .5) / 4, y: (2.5 - sy) / 3, cell: 5, subcell: 20 });
  return { schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "recorded-cal", measuredSourceFrameId: "recorded-" + t, measurementTimestampMs: t, provenance: "measured", activeBoxingActions: [], anchors: [anchor("nose", 3, 2), anchor("left_shoulder", 0, 1), anchor("right_shoulder", 3, 1), anchor("left_elbow", 0, 1), anchor("right_elbow", 3, 1), anchor("left_wrist", x, y), anchor("right_wrist", 3.5, 1)], entries: [] };
}
const input = sample => ({ sourceIdentity: "recorded-test-source", calibration: { calibrationId: "recorded-cal", readiness: "countdown" }, tracking: { gameplayPaused: false, freshCalibrationRequired: false }, countdownFrozen: false, latestEvidence: sample, straightQualifications: [] });
function frame(mode, songMs, x, y, authority) {
  const t = 10000 + songMs, sample = measured(t, x, y);
  const equipmentPoses = ["left_wrist", "right_wrist"].map(role => {
    const anchor = sample.anchors.find(value => value.anchor === role);
    return { role, mode, anchor: { x: anchor.x * 4 - .5, y: 2.5 - anchor.y * 3, z: 0 }, scale: 1, orientation: mode === "flow" ? { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } : { x: 0, y: 0, z: 0, w: 1 }, geometryIdentity: mode === "flow" ? "aerobeat/saber_capsule_v1" : "aerobeat/glove_obb_v1", configIdentity: identity };
  });
  return { timestampMs: t, clock: clock(songMs), input: input(sample), equipmentPoses, ...(authority === undefined ? {} : { interaction: authority }) };
}
function ready(kind, config = configuration()) {
  const c = createAeroGameplaySessionCoordinator({ sessionId: "recorded-test", instanceId: "recorded-game", countdownStepMs: 1 });
  c.configureContent(config, kind === "play" ? undefined : kind === "replay" ? replayOptions : { purpose: "visual_test" });
  if (kind === "play") {
    c.advance({ timestampMs: 0, clock: clock(0, false), input: input(null) });
    assert.equal(c.requestStart(0).accepted, true);
    for (const t of [1, 2, 3]) c.advance({ timestampMs: t, clock: clock(0, false) });
  } else assert.equal(c.requestStart(0, startRequest("visual_test")).accepted, true);
  return c;
}
function lateRun(kind, mode = "flow", contact = true) {
  const c = ready(kind, configuration(mode));
  for (let t = 900; t <= 2050; t += 50) c.advance(frame(mode, t, contact && t >= 1250 ? 1 : 3, 1, kind === "play" ? undefined : interaction(1, 900)));
  return c;
}
for (const mode of ["flow", "boxing"]) {
  const play = lateRun("play", mode), replay = lateRun("replay", mode), ordinary = lateRun("test", mode);
  assert.equal(play.getJudgements().length, 1);
  assert.equal(replay.getJudgements().length, 1);
  assert.equal(play.getJudgements()[0].result, "hit");
  assert.ok(play.getJudgements()[0].timingOffsetMs > 180, `${mode}: real legal contact occurs beyond ordinary Test's base window`);
  const fields = ({ sessionPurpose, ...rest }) => rest;
  assert.deepEqual(replay.getJudgements().map(fields), play.getJudgements().map(fields), `${mode}: recorded Test exactly matches Play contact/tier/timing`);
  assert.equal(ordinary.getJudgements()[0].result, "miss", `${mode}: ordinary Test retains the base-window miss`);
  assert.equal(replay.getJudgements()[0].sessionPurpose, "visual_test");
  assert.equal(replay.getSnapshot().session.purpose, "visual_test");
  assert.equal(replay.getSnapshot().session.ranked, false);
  assert.equal(replay.getSnapshot().session.calibrationId, null);
  assert.ok(replay.getScorePartitions().every(value => value.ranked === false && value.localOnly === true));
  assert.equal(lateRun("replay", mode, false).getJudgements()[0].result, "miss", `${mode}: no contact never becomes a hit`);
}
// Already-centered pending notes, including beat zero, must not be excluded.
for (const [center, activation] of [[0, 0], [1000, 1250]]) {
  for (const kind of ["replay", "test"]) {
    const c = ready(kind, configuration("flow", center));
    c.advance(frame("flow", activation, 3, 1, interaction(1, activation)));
    c.advance(frame("flow", activation + 50, 1, 1, interaction(1, activation)));
    assert.equal(c.getJudgements().some(value => value.result === "hit"), kind === "replay", `${kind}: center ${center}, activation ${activation}`);
  }
}
// New interaction epochs preserve pending recorded notes, but still require a
// fresh baseline and monotonic immutable authority just like ordinary Test.
for (const kind of ["replay", "test"]) {
  const c = ready(kind);
  c.advance(frame("flow", 900, 3, 1, interaction(1, 900)));
  c.advance(frame("flow", 1000, 3, 1)); // Deactivate; no authority/no judgement.
  c.advance(frame("flow", 1200, 1, 1, interaction(2, 1200)));
  assert.equal(c.getJudgements().length, 0, "epoch transition only seeds a recovery baseline");
  c.advance(frame("flow", 1250, 1, 1, interaction(2, 1200)));
  assert.equal(c.getJudgements().some(value => value.result === "hit"), kind === "replay");
  const before = c.getSnapshot();
  assert.throws(() => c.advance(frame("flow", 1300, 1, 1, interaction(1, 900))), /epochs must increase/);
  assert.equal(c.getSnapshot(), before);
}
// Direction and strict interaction/equipment admission are not widened.
{
  const c = ready("replay", configuration("flow", 1000, "up"));
  for (let t = 900; t <= 2050; t += 50) c.advance(frame("flow", t, 1, 1 - Math.min(t - 900, 200) / 500, interaction(1, 900)));
  assert.equal(c.getJudgements()[0].result, "miss", "reverse-only motion still misses");
  const noAuthority = ready("replay");
  for (const t of [900, 1000, 1250, 2050]) noAuthority.advance(frame("flow", t, 1, 1));
  assert.deepEqual(noAuthority.getJudgements(), [], "configuration alone never grants evidence authority");
  const strict = ready("replay"), baseline = strict.getSnapshot();
  assert.throws(() => strict.advance({ timestampMs: 10000, clock: clock(0), interaction: interaction(1, 0) }), /strict input evidence/);
  const missingPoses = frame("flow", 0, 1, 1, interaction(1, 0)); delete missingPoses.equipmentPoses;
  assert.throws(() => strict.advance(missingPoses), /equipment/i);
  assert.throws(() => strict.advance(frame("flow", 0, 1, 1, interaction(1, 1))), /authoritative timeline/);
  assert.equal(strict.getSnapshot(), baseline, "failed admission remains transactional");
}
{
  const c = ready("replay");
  c.setLeaseSnapshot({ schema: "aerobeat/media_lease_snapshot", version: 1, ownerInstanceId: "recorded-game", generation: 1, state: "owned", resources: ["audio"] });
  assert.equal(c.getSnapshot().session.state, "playing", "Test retains its audio-only lease policy");
  c.setLeaseSnapshot({ schema: "aerobeat/media_lease_snapshot", version: 1, ownerInstanceId: "other-game", generation: 2, state: "owned", resources: ["audio", "camera"] });
  assert.equal(c.getSnapshot().session.state, "paused_manual");
  assert.equal(c.getSnapshot().session.pauseReason, "media_lease_unavailable");
  assert.equal(c.requestStart(1, startRequest("visual_test")).accepted, false, "replay cannot bypass Test's lease gate");
  assert.deepEqual(c.getJudgements(), []);
}
// Context cannot escalate into Play and is only installed by exact options.
{
  const config = configuration(), c = ready("replay", config), before = c.getSnapshot();
  for (const request of [undefined, startRequest("play")]) {
    assert.throws(() => c.requestStart(20000, request), /reconfigure or reset before starting Play/);
    assert.equal(c.getSnapshot(), before, "rejected Play start cannot mutate generation, clock or truth");
  }
  for (const options of [{ purpose: "play", recordedPlayReplay: true }, { recordedPlayReplay: true }, { purpose: "visual_test", recordedPlayReplay: false }, { purpose: "visual_test", recordedPlayReplay: "true" }, { purpose: "visual_test", recordedPlayReplay: undefined }, { ...replayOptions, extra: true }]) {
    assert.throws(() => c.configureContent(config, options));
    assert.equal(c.getSnapshot(), before);
  }
  let getterCalls = 0;
  const accessor = { purpose: "visual_test" };
  Object.defineProperty(accessor, "recordedPlayReplay", { enumerable: true, get() { getterCalls++; return true; } });
  assert.throws(() => c.configureContent(config, accessor), /accessors or hidden fields/);
  assert.equal(getterCalls, 0);
  assert.equal(c.getSnapshot(), before);
  assert.throws(() => c.configureContent({ ...config, resolvedEvents: "bad" }, { purpose: "visual_test" }));
  assert.equal(c.getSnapshot(), before);
  // Failed ordinary reconfiguration must not silently clear the replay context.
  c.advance(frame("flow", 1250, 3, 1, interaction(1, 1250)));
  c.advance(frame("flow", 1300, 1, 1, interaction(1, 1250)));
  assert.equal(c.getJudgements()[0].result, "hit");
  c.requestStart(11300, startRequest("visual_test")); // Same configuration restart.
  c.advance(frame("flow", 1300, 3, 1, interaction(1, 1300)));
  c.advance(frame("flow", 1350, 1, 1, interaction(1, 1300)));
  assert.equal(c.getJudgements()[0].result, "hit", "Test restart preserves context but clears old run truth/epochs");
  c.configureContent(config, { purpose: "visual_test" });
  c.requestStart(11350, startRequest("visual_test"));
  c.advance(frame("flow", 1350, 3, 1, interaction(1, 1350)));
  c.advance(frame("flow", 1400, 1, 1, interaction(1, 1350)));
  assert.deepEqual(c.getJudgements(), [], "ordinary reconfiguration clears recorded epoch eligibility");
  c.configureContent(config, replayOptions);
  c.reset(12000);
  assert.doesNotThrow(() => c.requestStart(12000, startRequest("play")), "reset clears context and restores ordinary Play start gates");
  c.configureContent(config, replayOptions);
  c.configureContent(config);
  assert.doesNotThrow(() => c.requestStart(12000, startRequest("play")), "normal Play reconfiguration clears context");
}
console.log("Recorded Play in Test validation passed (Flow/Boxing late parity, epochs, negatives, non-ranked admission and lifecycle).");
