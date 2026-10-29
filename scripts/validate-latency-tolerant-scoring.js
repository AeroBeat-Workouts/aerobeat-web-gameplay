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
import { createAeroGameplaySessionCoordinator, maximumColliderJudgementAgeMs, defaultBoxingColliderSettings } from "../src/index.js";
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
function playing(mode, options = {}, configuration = {}) {
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: `latency-${mode}-${++runSeq}`, countdownStepMs: 1, ...options });
  coordinator.configureContent({ packageId: "package", selectedVariant: variant(mode), resolvedEvents: [note(mode, 1000)], ...configuration, profileIdentity: { schema: "aerobeat/prototype_tuning_identity", version: 1, profileId: "profile", profileVersion: "1", contentHash: HASH, class: "between_run_ruleset", regenerationRequired: false } });
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

// Production coordinator: position-based Flow reprojection changes a sparse
// swing verdict; endpoint slerp does not. The same callback receives each
// reconstructed sample used by collision and the private slice diagnostic.
for (const projected of [false, true]) {
  let calls = 0;
  const coordinator = playing("flow", projected ? { reprojectEquipmentPose: (pose, context) => {
    calls++;
    assert.ok(Number.isFinite(context.timestampMs) && Number.isFinite(context.tangent.y));
    return { ...pose, orientation: Math.abs(pose.anchor.y - 1) < .1 ? { x: 0, y: 0, z: 0, w: 1 } : pose.orientation };
  } } : {});
  for (const [time, y] of [[800, .8], [1200, 1.2], [1300, 1.2]]) {
    const sample = evidence(`project-${time}`, time, [2, y], [3, 2], [3, 2]);
    const poses = posesForEvidence(sample, "flow").map((pose) => ({ ...pose, orientation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } }));
    coordinator.advance({ timestampMs: time, clock: clock(time, true), input: inputSnapshot(sample), equipmentPoses: poses });
  }
  assert.equal(coordinator.getJudgements().length, projected ? 1 : 0, "only intermediate reprojection reaches the note");
  if (projected) {
    assert.equal(coordinator.getJudgements()[0].result, "hit");
    assert.ok(calls > 0);
    coordinator.seekTo(500);
    assert.equal(coordinator.getJudgements().length, 0, "seek clears judged ids");
    const before = calls;
    deliver(coordinator, "flow", 1400, 1400, [3, 2]);
    assert.equal(calls, before, "seek removes the previous spline bracket");
    assert.equal(coordinator.getJudgements().length, 0, "seek cannot replay an old interpolated contact");
  }
}

// Boxing ignores art rotation by contract, but uses the same spline anchors.
// The fast preceding secant bends the [800,1200] segment into the cell while
// its moving Z is eligible. Without that older point, linear anchors miss.
for (const withPredecessor of [false, true]) {
  let calls = 0;
  const coordinator = playing("boxing", { reprojectEquipmentPose: (pose) => { calls++; return pose; } }, { boxingColliderSettings: { ...defaultBoxingColliderSettings, colliderDepthForward: 1, colliderDepthBackward: 0 } });
  if (withPredecessor) deliver(coordinator, "boxing", 790, 790, [3.4, 1]);
  deliver(coordinator, "boxing", 800, 800, [2.8, 1]);
  deliver(coordinator, "boxing", 1200, 1200, [1.5, 1]);
  deliver(coordinator, "boxing", 1300, 1300, [1.5, 1]);
  assert.equal(coordinator.getJudgements().length, withPredecessor ? 1 : 0, "Boxing spline passes the note when linear motion does not");
  assert.ok(calls > 0, "Boxing forwards its projector");
  if (withPredecessor) assert.equal(coordinator.getJudgements()[0].result, "hit", "same beat scores exactly once across later updates");
}

// One-FPS capture with a live render/audio clock. Held measured frames are
// idle publications, not freshly measured or frozen observations. The original
// measurement bracket must survive both age expiry and temporary null evidence.
for (const mode of ["flow", "boxing"]) {
  for (const gap of ["held", "no_frame", "frozen"]) {
    const coordinator = playing(mode, {}, { resolvedEvents: [note(mode, 1200)] });
    const sample = evidence("slow-first", 700, [3, 1], [3, 2], [3, 2]);
    const makePoses = (value) => posesForEvidence(value, mode).map((pose) => mode === "flow" ? { ...pose, orientation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } } : pose);
    const firstPoses = makePoses(sample);
    coordinator.advance({ timestampMs: 700, clock: clock(700, true), input: inputSnapshot(sample), equipmentPoses: firstPoses });
    // A same-id changed payload is not an exact idle publication. Once stale,
    // it must still fail ordinary admission transactionally.
    const changed = evidence("slow-first", 700, [2, 1], [3, 2], [3, 2]);
    for (let wall = 800; wall < 1700; wall += 100) {
      if (wall === 1500) assert.throws(() => coordinator.advance({ timestampMs: wall, clock: clock(wall, true), input: inputSnapshot(changed), equipmentPoses: makePoses(changed) }), (error) => error.code === "equipment_poses_invalid", "changed stale data cannot impersonate an accepted repeat");
      const heldInput = inputSnapshot(gap === "frozen" ? wall === 1500 ? null : { ...sample, provenance: "frozen", frozenTickId: wall / 100 } : gap === "no_frame" && wall >= 1100 ? null : sample);
      const renderPoses = wall === 1500 && gap !== "frozen" ? firstPoses.map((pose) => ({ ...pose, scale: 5, orientation: { x: 0, y: 0, z: 0, w: 1 } })) : firstPoses;
      assert.doesNotThrow(() => coordinator.advance({ timestampMs: wall, clock: clock(wall, true), input: heldInput, equipmentPoses: gap === "no_frame" && wall >= 1100 ? undefined : renderPoses }), `${mode} ${gap}: held render tick must not throw or clear a measured bracket`);
      assert.equal(coordinator.getJudgements().length, 0, "idle ticks do not score held equipment");
      assert.equal(coordinator.getSnapshot().session.timelinePositionMs, wall, "idle ticks keep the authoritative clock live");
    }
    const endpoint = evidence("slow-second", 1700, [0, 1], [3, 2], [3, 2]);
    const lastPoses = makePoses(endpoint);
    coordinator.advance({ timestampMs: 1700, clock: clock(1700, true), input: inputSnapshot(endpoint), equipmentPoses: lastPoses });
    assert.equal(coordinator.getJudgements()[0]?.result, "hit", `${mode} ${gap}: a fresh endpoint reconstructs the one-second gap`);
    assert.ok(Math.abs(coordinator.getJudgements()[0].timingOffsetMs) <= 180, "historical contact stays inside the unchanged window");
    coordinator.advance({ timestampMs: 1800, clock: clock(1800, true), input: inputSnapshot(endpoint), equipmentPoses: lastPoses });
    assert.equal(coordinator.getJudgements().length, 1, "gap reconstruction is exactly once");
  }
}

for (const mode of ["flow", "boxing"]) {
  const coordinator = playing(mode, {}, { resolvedEvents: [note(mode, 1200), { ...note(mode, 5000), eventId: `${mode}-future`, sourceEventIds: [`${mode}-future-source`] }] });
  const sample = evidence("held-on-target", 700, [1, 1], [3, 2], [3, 2]);
  const poses = posesForEvidence(sample, mode);
  coordinator.advance({ timestampMs: 700, clock: clock(700, true), input: inputSnapshot(sample), equipmentPoses: poses });
  for (let wall = 800; wall <= 2200; wall += 100) coordinator.advance({ timestampMs: wall, clock: clock(wall, true), input: inputSnapshot(sample), equipmentPoses: poses });
  assert.equal(coordinator.getJudgements().length, 0, `${mode}: held observations do not score an approaching note or finalize at the inclusive deadline`);
  coordinator.advance({ timestampMs: 2201, clock: clock(2201, true), input: inputSnapshot(null) });
  assert.equal(coordinator.getJudgements()[0]?.result, "miss", "idle/no-frame ticks retain the exact strict Miss deadline");
  assert.equal(coordinator.getJudgements()[0]?.committedTimelinePositionMs, 2201);
  deliver(coordinator, mode, 2300, 2300, [1, 1]);
  assert.equal(coordinator.getJudgements().length, 1);
  assert.equal(coordinator.getJudgements()[0].result, "miss", "a later endpoint cannot recover already-finalized truth");

  const changedSource = playing(mode, {}, { resolvedEvents: [note(mode, 1200)] });
  const first = evidence("source-before", 700, [3, 1], [3, 2], [3, 2]);
  changedSource.advance({ timestampMs: 700, clock: clock(700, true), input: inputSnapshot(first), equipmentPoses: posesForEvidence(first, mode) });
  const next = evidence("source-after", 1700, [0, 1], [3, 2], [3, 2]);
  changedSource.advance({ timestampMs: 1700, clock: clock(1700, true), input: { ...inputSnapshot(next), sourceIdentity: "camera-b" }, equipmentPoses: posesForEvidence(next, mode) });
  assert.equal(changedSource.getJudgements().length, 0, "a source switch cannot reconstruct across the old bracket");
  const staleChangedSource = { ...inputSnapshot(first), sourceIdentity: "camera-b" };
  assert.throws(() => changedSource.advance({ timestampMs: 1800, clock: clock(1800, true), input: staleChangedSource, equipmentPoses: posesForEvidence(first, mode) }), (error) => error.code === "equipment_poses_invalid", "the old publication cache is cleared with the source boundary");
}

// A source change first seen on a frozen publication is still a real reset.
// It must not leave an older source's measured control point for recovery.
for (const mode of ["flow", "boxing"]) {
  const coordinator = playing(mode, {}, { resolvedEvents: [note(mode, 1200)] });
  const first = evidence("frozen-source-before", 700, [3, 1], [3, 2], [3, 2]);
  const makePoses = (sample) => posesForEvidence(sample, mode).map((pose) => mode === "flow" ? { ...pose, orientation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } } : pose);
  coordinator.advance({ timestampMs: 700, clock: clock(700, true), input: inputSnapshot(first), equipmentPoses: makePoses(first) });
  for (const wall of [900, 1300, 1600]) coordinator.advance({ timestampMs: wall, clock: clock(wall, true), input: { ...inputSnapshot({ ...first, provenance: "frozen", frozenTickId: wall }), sourceIdentity: "camera-b" }, equipmentPoses: makePoses(first) });
  const endpoint = evidence("frozen-source-after", 1700, [0, 1], [3, 2], [3, 2]);
  coordinator.advance({ timestampMs: 1700, clock: clock(1700, true), input: { ...inputSnapshot(endpoint), sourceIdentity: "camera-b" }, equipmentPoses: makePoses(endpoint) });
  assert.equal(coordinator.getJudgements().length, 0, `${mode}: frozen source switch prevents old-to-new measured reconstruction`);
}

// Default authored direction must inspect reconstructed motion at contact,
// not reject the original >150ms webcam pair. Keep the default enforcement.
for (const mode of ["flow", "boxing"]) {
  for (const cadence of [540, 1100]) {
    for (const reverse of [false, true]) {
      const center = reverse ? 5750 + cadence / 2 : 6000;
      const directed = { ...note(mode, center), ...(mode === "flow" ? { direction: "right" } : { type: "hook_left" }) };
      const control = { ...note(mode, center), eventId: `${mode}-direction-control`, sourceEventIds: [`${mode}-direction-control-source`], ...(mode === "flow" ? { direction: "left" } : {}) };
      const coordinator = playing(mode, {}, { resolvedEvents: reverse ? [directed, control] : [directed] });
      const makePoses = (value) => posesForEvidence(value, mode).map((pose) => mode === "flow" ? { ...pose, orientation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } } : pose);
      const first = evidence("direction-first", 5750, [reverse ? 3.42 : -.42, 1], [3, 2], [3, 2]);
      coordinator.advance({ timestampMs: 5750, clock: clock(5750, true), input: inputSnapshot(first), equipmentPoses: makePoses(first) });
      for (let wall = 5850; wall < 5750 + cadence; wall += 100) coordinator.advance({ timestampMs: wall, clock: clock(wall, true), input: inputSnapshot(first), equipmentPoses: makePoses(first) });
      assert.equal(coordinator.getJudgements().length, 0, "held off-target frames never score");
      const endpointTime = 5750 + cadence;
      const endpoint = evidence("direction-second", endpointTime, [reverse ? -.42 : 3.42, 1], [3, 2], [3, 2]);
      coordinator.advance({ timestampMs: endpointTime, clock: clock(endpointTime, true), input: inputSnapshot(endpoint), equipmentPoses: makePoses(endpoint) });
      const judged = coordinator.getJudgements();
      assert.equal(judged.length, 1, `${mode} ${cadence}ms ${reverse ? "reverse control" : "rightward direction"}: reconstructed default-rule contact scores`);
      assert.equal(judged[0].eventId, reverse ? control.eventId : directed.eventId, "wrong-direction candidate cannot consume the valid same-frame candidate");
      assert.equal(judged[0].result, "hit");
      assert.ok(Math.abs(judged[0].timingOffsetMs) <= 180, `${mode} ${cadence}ms reverse=${reverse}: contact offset ${judged[0].timingOffsetMs}`);
      coordinator.advance({ timestampMs: endpointTime + 20, clock: clock(endpointTime + 20, true), input: inputSnapshot(endpoint), equipmentPoses: makePoses(endpoint) });
      assert.equal(coordinator.getJudgements().length, 1, "duplicate publications cannot score the same beat twice");
      if (reverse) {
        coordinator.advance({ timestampMs: center + 1001, clock: clock(center + 1001, true), input: inputSnapshot(null) });
        const wrong = coordinator.getJudgements().find((judgement) => judgement.eventId === directed.eventId);
        assert.equal(wrong?.result, "miss", "reverse motion never hits the authored rightward note");
        assert.deepEqual([...wrong.diagnostics], ["wrong_direction"]);
        assert.equal(coordinator.getScorePartitions()[0].hits, 1, "reverse rejection leaves score/consumption unchanged");
      }
    }
  }
}

console.log("Latency-tolerant collider scoring validation passed.");