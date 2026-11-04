// @ts-check
import assert from "node:assert/strict";
import { createResolvedEquipmentPose, equipmentEulerDegreesToQuaternion } from "@aerobeat/web-contracts";
import { createAeroGameplaySessionCoordinator } from "../src/index.js";
import { defaultFlowColliderSettings, matchesAuthoredDirection } from "../src/flow-collider-collision.js";
import { sweptSaberContactsFlowTarget, resolvePoseAt, resolvedSaberCapsuleContactsFlowTarget } from "../src/equipment-pose-collision.js";

const hash = "a".repeat(64);
const identity = { schema: "aerobeat/equipment_config_identity", version: 1, algorithm: "sha256", value: "d".repeat(64) };
const variant = { variantId: "reversal", chartId: "reversal", mode: "flow", rulesetId: "flow_colliders_v1", recipeId: null, modifierIds: [], ranked: false, localOnly: true, mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: hash }, scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: hash }, provenance: { kind: "imported" } };
const event = { schema: "aerobeat/resolved_content_event", version: 3, eventId: "upward-after-downward", variantId: "reversal", chartId: "reversal", centerTimestampMs: 1000, sourceEventIds: ["source"], type: "note", hand: "left", placement: 9, direction: "up" };
const clock = (ms, playing) => ({ contextTimeSeconds: ms / 1000, positionSeconds: ms / 1000, playing });
const anchor = (name, t, x, y) => ({ schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "cal", measurementTimestampMs: t, valid: true, confidence: 1, rawX: .5, rawY: .5, x: (x + .5) / 4, y: (2.5 - y) / 3, cell: 9, subcell: 20 });
const evidence = (t, x, y) => ({ schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal", measuredSourceFrameId: "f" + t, measurementTimestampMs: t, provenance: "measured", activeBoxingActions: [], anchors: [anchor("nose", t, 3, 2), anchor("left_shoulder", t, 0, 1), anchor("right_shoulder", t, 3, 1), anchor("left_elbow", t, 0, 1), anchor("right_elbow", t, 3, 1), anchor("left_wrist", t, x, y), anchor("right_wrist", t, 3.5, 1)], entries: [] });
const input = (e) => ({ sourceIdentity: "camera", calibration: { calibrationId: "cal", readiness: "countdown" }, tracking: { gameplayPaused: false, freshCalibrationRequired: false }, countdownFrozen: false, latestEvidence: e, straightQualifications: [] });
const pose = (role, x, y) => createResolvedEquipmentPose({ role, mode: "flow", anchor: { x, y, z: 0 }, scale: 1, orientation: equipmentEulerDegreesToQuaternion({ x: 0, y: 90, z: 0 }), geometryIdentity: "aerobeat/saber_capsule_v1", configIdentity: identity });
const reversal = [[800, 1], [850, .65], [900, .3], [950, .05], [1000, -.25], [1050, .05], [1100, .3], [1150, .65], [1200, 1]];
const volume = { scale: 1, depthForward: 1, depthBackward: 0 };
const history = reversal.map(([t, y]) => ({ t, pose: pose("left_wrist", 1, y) }));
const directionAt = (t) => {
  const sample = (time, sourceFrameId) => { const p = resolvePoseAt(history, time); return { sourceFrameId, sourceIdentity: "camera", calibrationId: "cal", measurementTimestampMs: time, songTimeMs: time, sx: p.anchor.x, sy: p.anchor.y }; };
  return matchesAuthoredDirection("up", sample(Math.max(800, t - 75), "a"), sample(Math.min(1200, t + 75), "b"), 45);
};
const first = sweptSaberContactsFlowTarget(event, history, 180, volume, 2000);
assert.equal(first?.firstContactMs, 868.75, "direct callers retain earliest geometric contact");
assert.equal(directionAt(first.firstContactMs), false);
assert.equal(resolvedSaberCapsuleContactsFlowTarget(event, resolvePoseAt(history, 1050), 1050, 180, volume), true);
assert.equal(directionAt(1050), true, "later contact satisfies unchanged direction gate");

const rejectedContacts = [];
assert.equal(sweptSaberContactsFlowTarget(event, history, 180, volume, 2000, undefined, () => false, t => rejectedContacts.push(t)), null);
assert.equal(rejectedContacts.length, 1, "qualifier-only skips must not fabricate further rejected contacts");
assert.equal(resolvedSaberCapsuleContactsFlowTarget(event, resolvePoseAt(history, rejectedContacts[0]), rejectedContacts[0], 180, volume), true);
const distantHistory = history.map(entry => ({ t: entry.t, pose: pose("left_wrist", 3.5, entry.pose.anchor.y) }));
let distantRejections = 0;
sweptSaberContactsFlowTarget(event, distantHistory, 180, volume, 2000, undefined, () => false, () => distantRejections++);
assert.equal(distantRejections, 0, "no geometry means no direction-rejection evidence");

function run(path, x = 1, enforceAuthoredDirection = true) {
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "direction-regression", countdownStepMs: 1 });
  coordinator.configureContent({ packageId: "fixture", selectedVariant: variant, resolvedEvents: [event], profileIdentity: { schema: "aerobeat/prototype_tuning_identity", version: 1, profileId: "profile", profileVersion: "1", contentHash: hash, class: "between_run_ruleset", regenerationRequired: false }, flowColliderSettings: { ...defaultFlowColliderSettings, colliderScale: 1, colliderDepthForward: 1, colliderDepthBackward: 0, timingWindowMs: 180, enforceAuthoredDirection } });
  coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: input(null) });
  assert.equal(coordinator.requestStart(0).accepted, true);
  for (const t of [1, 2, 3]) coordinator.advance({ timestampMs: t, clock: clock(0, false) });
  const samples = [...path];
  for (let t = 1250; t <= 2100; t += 50) samples.push([t, path.at(-1)[1]]);
  for (const [t, y] of samples) coordinator.advance({ timestampMs: t, clock: clock(t, true), input: input(evidence(t, x, y)), equipmentPoses: [pose("left_wrist", x, y), pose("right_wrist", 3.5, 1)] });
  const judgements = coordinator.getJudgements();
  assert.equal(judgements.length, 1, "later frames cannot judge the event twice");
  coordinator.destroy();
  return judgements[0];
}
const reverseOnly = reversal.map(([t, y]) => [t, t > 1000 ? -.25 : y]);
const wrongWay = run(reverseOnly), noContact = run(reversal, 3);
assert.equal(wrongWay.tier, "miss", "wrong-way geometry must not become a hit or near");
assert.deepEqual(wrongWay.diagnostics, ["wrong_direction"], "actual rejected contact proves direction rejection");
assert.equal(noContact.tier, "miss", "valid up motion without contact cannot hit");
assert.deepEqual(noContact.diagnostics, ["wrong_collider"], "authored direction alone cannot explain a no-contact miss");
assert.equal(run(reverseOnly, 1, false).result, "hit", "explicit overlap-only callers remain compatible");
const hit = run(reversal);
assert.equal(hit.result, "hit", "earlier wrong-way contact must not mask later valid upward contact");
assert.equal(hit.tier, "great", "real contact wins over any near candidate");
assert.equal(hit.committedTimelinePositionMs, 1050);
assert.ok(Math.abs(hit.timingOffsetMs - 35.41666666666674) < 1e-9, "timing reflects the earliest qualifying sampled contact, not the earlier wrong-way geometry or just the measured endpoint");
console.log("Flow direction-qualified contact validation passed (reversal, reverse-only, no-contact, opt-out, exactly-once).");
