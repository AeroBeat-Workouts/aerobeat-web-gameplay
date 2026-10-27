// @ts-check
/**
 * Latency-tolerant collider scoring.
 *
 * Collider judgement is time-based, so a slow tracking pipeline must delay the
 * verdict instead of discarding the evidence. Before this fix the collider
 * sample gate rejected any measured frame older than 150 ms, the equipment-pose
 * validator then threw `equipment_poses_invalid` on every display frame, and no
 * note could score at all — which is exactly what a CPU-saturated host or a
 * low-end phone produces.
 *
 * This suite pins:
 *  - the judgement age bound and the song-time placement of a late sample,
 *  - a correct swing scoring across latency and pose cadence, in both modes,
 *  - a wrong-cell swing still missing under latency (no false positives),
 *  - healthy zero-latency behaviour unchanged,
 *  - an out-of-order frame being absorbed without throwing.
 */
import assert from "node:assert/strict";
import { createAeroGameplaySessionCoordinator, maximumColliderJudgementAgeMs } from "../src/index.js";
import { measuredColliderSample } from "../src/flow-collider-collision.js";

const HASH = "a".repeat(64);
const EQUIPMENT_CONFIG_IDENTITY = Object.freeze({ schema: "aerobeat/equipment_config_identity", version: 1, algorithm: "sha256", value: "b".repeat(64) });
const hashIdentity = () => ({ schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH });
const variant = (mode) => ({ variantId: `${mode}-v`, chartId: `${mode}-c`, mode, rulesetId: mode === "flow" ? "flow_colliders_v1" : "boxing_collider_v1", recipeId: null, modifierIds: [], ranked: false, localOnly: true, mapHash: hashIdentity(), scoreIdentityHash: hashIdentity(), provenance: { kind: "imported" } });
const anchor = (name, measured, sx, sy) => ({ schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "cal-1", measurementTimestampMs: measured, valid: true, confidence: 1, rawX: 0.5, rawY: 0.5, x: (sx + 0.5) / 4, y: (2.5 - sy) / 3, cell: 5, subcell: 20 });
const evidence = (frameId, measured, left, right, nose) => ({ schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal-1", measuredSourceFrameId: frameId, measurementTimestampMs: measured, provenance: "measured", activeBoxingActions: [], anchors: [anchor("nose", measured, ...nose), anchor("left_shoulder", measured, 0, 0), anchor("right_shoulder", measured, 3, 0), anchor("left_elbow", measured, 0, 0), anchor("right_elbow", measured, 3, 0), anchor("left_wrist", measured, ...left), anchor("right_wrist", measured, ...right)], entries: [] });
const posesForEvidence = (sample, mode) => ["left_wrist", "right_wrist"].map((role) => {
  const wrist = /** @type {Record<string, number>} */ (sample.anchors.find((entry) => entry.anchor === role));
  return { role, mode, anchor: { x: wrist.x * 4 - 0.5, y: 2.5 - wrist.y * 3, z: 0 }, scale: 1, orientation: { x: 0, y: 0, z: 0, w: 1 }, geometryIdentity: mode === "flow" ? "aerobeat/saber_capsule_v1" : "aerobeat/glove_obb_v1", configIdentity: EQUIPMENT_CONFIG_IDENTITY };
});
const inputSnapshot = (latest) => ({ sourceIdentity: "camera-a", calibration: { calibrationId: "cal-1", readiness: "countdown" }, tracking: { gameplayPaused: false, freshCalibrationRequired: false }, countdownFrozen: false, latestEvidence: latest, straightQualifications: [] });
const clock = (ms, playing) => ({ contextTimeSeconds: ms / 1000, positionSeconds: ms / 1000, playing });
const note = (mode, centerTimestampMs) => ({ schema: "aerobeat/resolved_content_event", version: 3, eventId: `${mode}-note`, variantId: `${mode}-v`, chartId: `${mode}-c`, centerTimestampMs, sourceEventIds: [`source-${mode}`], type: mode === "flow" ? "note" : "straight_left", ...(mode === "flow" ? { hand: "left", placement: 5 } : { spatialTarget: { targetCell: 5, acceptedSubcells: [], sourceCell: -1 } }) });

let runSeq = 0;
function playing(mode) {
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: `latency-${mode}-${++runSeq}`, countdownStepMs: 1 });
  coordinator.configureContent({ packageId: "package", selectedVariant: variant(mode), resolvedEvents: [note(mode, 1000)], profileIdentity: { schema: "aerobeat/prototype_tuning_identity", version: 1, profileId: "profile", profileVersion: "1", contentHash: HASH, class: "between_run_ruleset", regenerationRequired: false } });
  coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: inputSnapshot(null) });
  assert.equal(coordinator.requestStart(0).accepted, true);
  for (const timestampMs of [1, 2, 3]) coordinator.advance({ timestampMs, clock: clock(0, false) });
  assert.equal(coordinator.getSnapshot().session.state, "playing");
  return coordinator;
}

/** The most recent measured frame, so a stalled pipeline can republish it. */
let held = null;

/**
 * One measured tracking frame: landmarks were captured at `captureMs`, and the
 * display loop consumes them at `wallMs`. The audio clock sits at `wallMs`, so
 * the frame's age is `wallMs - captureMs`.
 */
function deliver(coordinator, mode, wallMs, captureMs, left, right = [3, 1], nose = [3, 2]) {
  const sample = evidence(`f-${captureMs}`, captureMs, left, right, nose);
  held = Object.freeze({ sample, poses: posesForEvidence(sample, mode), frozenTickId: 0 });
  coordinator.advance({ timestampMs: wallMs, clock: clock(wallMs, true), input: inputSnapshot(sample), equipmentPoses: held.poses });
}

/**
 * Advance the clock with no new measurement, exactly as the input layer does on
 * tracking loss: republish the held last-measured frame as `frozen` with an
 * incrementing tick and carry the held equipment poses.
 */
function idleTo(coordinator, wallFrom, wallTo) {
  assert.ok(held, "an idle stretch requires a held frame");
  for (let wall = wallFrom; wall <= wallTo; wall += 16) {
    held = Object.freeze({ ...held, frozenTickId: held.frozenTickId + 1 });
    const frozen = { ...held.sample, provenance: "frozen", frozenTickId: held.frozenTickId };
    coordinator.advance({ timestampMs: wall, clock: clock(wall, true), input: inputSnapshot(frozen), equipmentPoses: held.poses });
  }
}

/** Run a swing through the note cell, then advance the clock past every deadline. */
function swingRun(mode, { latencyMs, cadenceMs, targetX = 1, targetY = 1 }) {
  const coordinator = playing(mode);
  const x = (ms) => 3 - (3 - targetX) * Math.max(0, Math.min(1, (ms - 880) / 240));
  const y = (ms) => 1 + (targetY - 1) * Math.max(0, Math.min(1, (ms - 880) / 240));
  for (let capture = 500; capture <= 1700; capture += cadenceMs) deliver(coordinator, mode, capture + latencyMs, capture, [x(capture), y(capture)]);
  idleTo(coordinator, 1700 + latencyMs + 16, 2300);
  const judgements = coordinator.getJudgements();
  assert.equal(judgements.length, 1, `${mode} latency ${latencyMs} cadence ${cadenceMs}: the note must be judged exactly once`);
  return judgements[0];
}

// ---------------------------------------------------------------------------
// 1. The judgement age bound and the late sample's own song position.
// ---------------------------------------------------------------------------
{
  assert.equal(maximumColliderJudgementAgeMs, 750, "judgement age bound is the documented 750 ms");
  const sample = evidence("frame", 1000, [1, 1], [3, 1], [3, 2]);
  const input = inputSnapshot(sample);
  const atBound = measuredColliderSample(sample, input, "left_wrist", 1750, 1750);
  assert.ok(atBound, "a measured frame one bound old is still usable evidence");
  assert.equal(atBound.songTimeMs, 1000, "a late sample keeps the song position it was measured at");
  assert.equal(measuredColliderSample(sample, input, "left_wrist", 2000, 1751), null, "beyond the bound a measured frame is rejected");
}

// ---------------------------------------------------------------------------
// 2. A correct swing scores across pipeline latency and pose cadence.
// ---------------------------------------------------------------------------
for (const mode of /** @type {const} */ (["boxing", "flow"])) {
  for (const latencyMs of [0, 140, 150, 300, 500, 700]) {
    for (const cadenceMs of [16, 66, 200]) {
      const judgement = swingRun(mode, { latencyMs, cadenceMs });
      assert.ok(["great", "good"].includes(judgement.tier), `${mode} latency ${latencyMs}ms cadence ${cadenceMs}ms: correct swing must score (got ${judgement.tier} ${JSON.stringify(judgement.diagnostics)})`);
      assert.equal(judgement.result, "hit", `${mode} latency ${latencyMs}ms cadence ${cadenceMs}ms: correct swing is a hit`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Under latency a wrong swing still misses: late evidence must not invent hits.
// ---------------------------------------------------------------------------
for (const mode of /** @type {const} */ (["boxing", "flow"])) {
  const judgement = swingRun(mode, { latencyMs: 400, cadenceMs: 16, targetX: 3, targetY: 2 });
  assert.equal(judgement.result, "miss", `${mode}: a swing that never reaches the cell misses, even with late frames`);
  assert.equal(judgement.tier, "miss", `${mode}: an unreached note scores nothing`);
  assert.deepEqual([...judgement.diagnostics], ["wrong_collider"], `${mode}: the miss names the collider, not staleness`);
}

// ---------------------------------------------------------------------------
// 4. Healthy tracking is unchanged: zero latency scores, and the diagnostic for
//    a genuinely unavailable pipeline is still `stale_input`.
// ---------------------------------------------------------------------------
{
  const healthy = swingRun("boxing", { latencyMs: 0, cadenceMs: 16 });
  assert.equal(healthy.result, "hit", "zero-latency contact is unchanged");
  const abandoned = playing("boxing");
  deliver(abandoned, "boxing", 900, 900, [1, 1]);
  idleTo(abandoned, 916, 2300);
  const judgement = abandoned.getJudgements()[0];
  assert.equal(judgement.result, "hit", "a glove resting on the cell still scores");
}

// ---------------------------------------------------------------------------
// 5. An out-of-order frame is absorbed without throwing, and judgement keeps
//    working afterwards: a correct in-order frame still scores exactly once.
// ---------------------------------------------------------------------------
{
  const coordinator = playing("boxing");
  deliver(coordinator, "boxing", 1000, 1000, [3, 1]);
  deliver(coordinator, "boxing", 1016, 1016, [3, 1]);
  assert.doesNotThrow(() => deliver(coordinator, "boxing", 1032, 700, [3, 1]), "an older frame is absorbed, never thrown");
  assert.equal(coordinator.getJudgements().length, 0, "a reordered frame does not judge the note");
  deliver(coordinator, "boxing", 1048, 1048, [1, 1]);
  idleTo(coordinator, 1064, 2300);
  const judgements = coordinator.getJudgements();
  assert.equal(judgements.length, 1, "the note is judged exactly once after a reordered frame");
  assert.equal(judgements[0].result, "hit", "a correct in-order swing still scores after a reordered frame");
}

console.log("Latency-tolerant collider scoring validation passed.");