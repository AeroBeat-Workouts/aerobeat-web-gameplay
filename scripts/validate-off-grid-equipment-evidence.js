// @ts-check

import assert from "node:assert/strict";
import { equipmentEulerDegreesToQuaternion } from "@aerobeat/web-contracts";
import { gloveGeometry, saberGeometry } from "@aerobeat/web-contracts/equipment-contracts";
import { createAeroGameplaySessionCoordinator } from "../src/index.js";
import { measuredColliderSample } from "../src/flow-collider-collision.js";
import { resolvedGloveObbContactsBoxingTarget, resolvedSaberCapsuleContactsFlowTarget } from "../src/equipment-pose-collision.js";

const HASH = "a".repeat(64);
const CONFIG_IDENTITY = Object.freeze({ schema: "aerobeat/equipment_config_identity", version: 1, algorithm: "sha256", value: "b".repeat(64) });
const clock = (ms, playing) => ({ contextTimeSeconds: ms / 1000, positionSeconds: ms / 1000, playing });
const orientation = (z = 0) => equipmentEulerDegreesToQuaternion({ x: 0, y: 0, z });
const pose = (role, mode, x, y, zRotation = 0) => ({ role, mode, anchor: { x, y, z: 0 }, scale: 1, orientation: orientation(zRotation), geometryIdentity: mode === "flow" ? "aerobeat/saber_capsule_v1" : "aerobeat/glove_obb_v1", configIdentity: CONFIG_IDENTITY });

function normalizedAnchor(name, measured, x, y) {
  const inGrid = x >= 0 && x <= 1 && y >= 0 && y <= 1;
  return { schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "cal-1", measurementTimestampMs: measured, valid: true, confidence: 1, rawX: 0.5, rawY: 0.5, x, y, cell: inGrid ? 5 : null, subcell: inGrid ? 20 : null };
}
function judgeAnchor(name, measured, sx, sy) { return normalizedAnchor(name, measured, (sx + 0.5) / 4, (2.5 - sy) / 3); }
function evidence(frameId, measured, left = [-0.500001, 1], right = [3, 1]) {
  return {
    schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal-1", measuredSourceFrameId: frameId, measurementTimestampMs: measured, provenance: "measured", activeBoxingActions: [],
    anchors: [judgeAnchor("nose", measured, 1, 1), judgeAnchor("left_shoulder", measured, 0, 1), judgeAnchor("right_shoulder", measured, 3, 1), judgeAnchor("left_elbow", measured, 0, 1), judgeAnchor("right_elbow", measured, 3, 1), judgeAnchor("left_wrist", measured, ...left), judgeAnchor("right_wrist", measured, ...right)], entries: []
  };
}
const input = (sample) => ({ sourceIdentity: "camera-a", calibration: { calibrationId: "cal-1", readiness: "countdown" }, tracking: { gameplayPaused: false, freshCalibrationRequired: false }, countdownFrozen: false, latestEvidence: sample, straightQualifications: [] });
const equipmentPoses = (sample, mode = "flow") => ["left_wrist", "right_wrist"].map((role) => { const wrist = sample.anchors.find((entry) => entry.anchor === role); return pose(role, mode, wrist.x * 4 - 0.5, 2.5 - wrist.y * 3); });

// Extraction accepts finite wrists beyond every grid side, but not non-finite
// values; the nose remains bounded because it owns body/obstacle semantics.
{
  const sides = [
    ["left", -0.01, 0.5], ["right", 1.01, 0.5],
    ["top", 0.5, -0.01], ["bottom", 0.5, 1.01]
  ];
  for (const [side, x, y] of sides) {
    const sample = { provenance: "measured", measuredSourceFrameId: `frame-${side}`, calibrationId: "cal-1", measurementTimestampMs: 1000, anchors: [normalizedAnchor("left_wrist", 1000, Number(x), Number(y)), normalizedAnchor("nose", 1000, Number(x), Number(y))] };
    assert.ok(measuredColliderSample(sample, { sourceIdentity: "camera-a" }, "left_wrist", 1000, 1000), `${side} finite off-grid wrist is accepted`);
    assert.equal(measuredColliderSample(sample, { sourceIdentity: "camera-a" }, "nose", 1000, 1000), null, `${side} off-grid nose stays body-grid bounded`);
  }
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    for (const axis of ["x", "y"]) {
      const point = normalizedAnchor("left_wrist", 1000, 0.5, 0.5);
      point[axis] = value;
      const sample = { provenance: "measured", measuredSourceFrameId: `invalid-${axis}`, calibrationId: "cal-1", measurementTimestampMs: 1000, anchors: [point] };
      assert.equal(measuredColliderSample(sample, { sourceIdentity: "camera-a" }, "left_wrist", 1000, 1000), null, `${axis}=${String(value)} is rejected`);
    }
  }
}

// Exact resolved geometry, not grid membership, decides just-outside contact on
// all four sides. Moving farther than each shape's projected extent must miss.
{
  const flowCases = [
    ["left", 4, -0.500001, 1, 180, -0.5 - saberGeometry.radius - 0.000001, 1],
    ["right", 7, 3.500001, 1, 0, 3.5 + saberGeometry.radius + 0.000001, 1],
    ["top", 1, 1, 2.500001, 90, 1, 2.5 + saberGeometry.radius + 0.000001],
    ["bottom", 9, 1, -0.500001, -90, 1, -0.5 - saberGeometry.radius - 0.000001]
  ];
  for (const [side, placement, hitX, hitY, z, missX, missY] of flowCases) {
    const event = { centerTimestampMs: 1000, placement };
    assert.equal(resolvedSaberCapsuleContactsFlowTarget(event, pose("left_wrist", "flow", Number(hitX), Number(hitY), Number(z)), 1000, 180), true, `Flow ${side} just-outside capsule overlaps`);
    assert.equal(resolvedSaberCapsuleContactsFlowTarget(event, pose("left_wrist", "flow", Number(missX), Number(missY), Number(z)), 1000, 180), false, `Flow ${side} farther capsule misses`);
  }

  const boxingCases = [
    ["left", 0, 1, -0.500001, 1, -0.5 - gloveGeometry.x - 0.000001, 1],
    ["right", 3, 1, 3.500001, 1, 3.5 + gloveGeometry.x + 0.000001, 1],
    ["top", 1, 2, 1, 2.500001, 1, 2.5 + gloveGeometry.y + 0.000001],
    ["bottom", 1, 0, 1, -0.500001, 1, -0.5 - gloveGeometry.y - 0.000001]
  ];
  for (const [side, targetX, targetY, hitX, hitY, missX, missY] of boxingCases) {
    const target = { centerTimestampMs: 1000, x: targetX, y: targetY };
    assert.equal(resolvedGloveObbContactsBoxingTarget(target, pose("left_wrist", "boxing", Number(hitX), Number(hitY)), 1000, 180), true, `Boxing ${side} just-outside OBB overlaps`);
    assert.equal(resolvedGloveObbContactsBoxingTarget(target, pose("left_wrist", "boxing", Number(missX), Number(missY)), 1000, 180), false, `Boxing ${side} farther OBB misses`);
  }
}

// Play and authorized Visual Test feed the same finite off-grid evidence and
// resolved capsule into the same production evaluator.
{
  const selectedVariant = { variantId: "off-grid", chartId: "chart-off-grid", mode: "flow", rulesetId: "flow_colliders_v1", recipeId: null, modifierIds: [], ranked: false, localOnly: true, mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, provenance: { kind: "imported" } };
  const event = { schema: "aerobeat/resolved_content_event", version: 3, eventId: "off-grid-left", variantId: "off-grid", chartId: "chart-off-grid", centerTimestampMs: 1000, sourceEventIds: ["source-off-grid-left"], type: "note", hand: "left", placement: 4 };
  const configuration = { packageId: "off-grid-package", selectedVariant, resolvedEvents: [event], profileIdentity: { schema: "aerobeat/prototype_tuning_identity", version: 1, profileId: "profile", profileVersion: "1", contentHash: HASH, class: "between_run_ruleset", regenerationRequired: false } };
  const run = (purpose) => {
    const coordinator = createAeroGameplaySessionCoordinator({ sessionId: `off-grid-${purpose}`, countdownStepMs: 1 });
    if (purpose === "visual_test") {
      coordinator.configureContent(configuration, { purpose: "visual_test" });
      assert.equal(coordinator.requestStart(0, { schema: "aerobeat/gameplay_session_start", version: 1, purpose: "visual_test" }).accepted, true);
    } else {
      coordinator.configureContent(configuration);
      coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: { ...input(null), latestEvidence: null } });
      assert.equal(coordinator.requestStart(0).accepted, true);
      coordinator.advance({ timestampMs: 1, clock: clock(0, false) });
      coordinator.advance({ timestampMs: 2, clock: clock(0, false) });
      coordinator.advance({ timestampMs: 3, clock: clock(0, false) });
    }
    const baseline = evidence(`${purpose}-baseline`, purpose === "play" ? 900 : 900, [-1.5, 1]);
    const interaction = { schema: "aerobeat/visual_test_interaction", version: 1, mode: "production_judgement", epoch: 1, activationTimelineMs: 900 };
    coordinator.advance({ timestampMs: 900, clock: clock(900, true), input: input(baseline), equipmentPoses: equipmentPoses(baseline), ...(purpose === "visual_test" ? { interaction } : {}) });
    const contact = evidence(`${purpose}-contact`, 1000);
    coordinator.advance({ timestampMs: 1000, clock: clock(1000, true), input: input(contact), equipmentPoses: equipmentPoses(contact), ...(purpose === "visual_test" ? { interaction } : {}) });
    return coordinator;
  };
  const play = run("play");
  const visual = run("visual_test");
  const truth = (entry) => ({ eventId: entry.eventId, rulesetId: entry.rulesetId, result: entry.result, beatCenterTimestampMs: entry.beatCenterTimestampMs, committedTimelinePositionMs: entry.committedTimelinePositionMs, timingOffsetMs: entry.timingOffsetMs, diagnostics: entry.diagnostics, shadow: entry.shadow });
  assert.deepEqual(truth(visual.getJudgements()[0]), truth(play.getJudgements()[0]), "off-grid production judgement has Play/Test parity");
  assert.deepEqual([play.getJudgements()[0].sessionPurpose, visual.getJudgements()[0].sessionPurpose], ["play", "visual_test"]);
}

console.log("Finite off-grid equipment evidence validation passed.");
