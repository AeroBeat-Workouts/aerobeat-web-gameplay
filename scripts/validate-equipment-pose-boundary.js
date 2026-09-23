// @ts-check

import assert from "node:assert/strict";
import { createAeroGameplaySessionCoordinator, equipmentPoseAnchorEpsilonWu } from "../src/index.js";

const HASH = "a".repeat(64);
const CONFIG_A = "d".repeat(64);
const CONFIG_B = "e".repeat(64);
const variant = { variantId: "pose", chartId: "chart-pose", mode: "flow", rulesetId: "flow_colliders_v1", recipeId: null, modifierIds: [], ranked: false, localOnly: true, mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, provenance: { kind: "imported" } };
const event = { schema: "aerobeat/resolved_content_event", version: 3, eventId: "pose-note", variantId: "pose", chartId: "chart-pose", centerTimestampMs: 1000, sourceEventIds: ["source-pose-note"], type: "note", hand: "left", placement: 5 };
const laterEvent = { ...event, eventId: "later-pose-note", centerTimestampMs: 2000, sourceEventIds: ["source-later-pose-note"], hand: "right", placement: 6 };
const config = { packageId: "pose-package", selectedVariant: variant, resolvedEvents: [event, laterEvent], profileIdentity: { schema: "aerobeat/prototype_tuning_identity", version: 1, profileId: "profile", profileVersion: "1", contentHash: HASH, class: "between_run_ruleset", regenerationRequired: false } };
const clock = (ms, playing) => ({ contextTimeSeconds: ms / 1000, positionSeconds: ms / 1000, playing });
const anchor = (name, measured, sx, sy) => ({ schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "cal-1", measurementTimestampMs: measured, valid: true, confidence: 1, rawX: 0.5, rawY: 0.5, x: (sx + 0.5) / 4, y: (2.5 - sy) / 3, cell: 5, subcell: 20 });
const evidence = (frameId, measured, left = [-0.5, 1], right = [3.5, 1]) => ({ schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal-1", measuredSourceFrameId: frameId, measurementTimestampMs: measured, provenance: "measured", activeBoxingActions: [], anchors: [anchor("nose", measured, 3, 2), anchor("left_shoulder", measured, 0, 0), anchor("right_shoulder", measured, 3, 0), anchor("left_elbow", measured, 0, 0), anchor("right_elbow", measured, 3, 0), anchor("left_wrist", measured, ...left), anchor("right_wrist", measured, ...right)], entries: [] });
const input = (sample) => ({ sourceIdentity: "camera-a", calibration: { calibrationId: "cal-1", readiness: "countdown" }, tracking: { gameplayPaused: false, freshCalibrationRequired: false }, countdownFrozen: false, latestEvidence: sample, straightQualifications: [] });
const poses = (sample, identity = CONFIG_A) => ["left_wrist", "right_wrist"].map((role) => { const wrist = sample.anchors.find((entry) => entry.anchor === role); return { role, mode: "flow", anchor: { x: wrist.x * 4 - 0.5, y: 2.5 - wrist.y * 3, z: 0 }, scale: 1, orientation: { x: 0, y: 0, z: 0, w: 1 }, geometryIdentity: "aerobeat/saber_capsule_v1", configIdentity: { schema: "aerobeat/equipment_config_identity", version: 1, algorithm: "sha256", value: identity } }; });
function ready() { const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "pose-boundary", countdownStepMs: 1 }); coordinator.configureContent(config); coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: { ...input(null), latestEvidence: null } }); assert.equal(coordinator.requestStart(0).accepted, true); coordinator.advance({ timestampMs: 1, clock: clock(0, false) }); coordinator.advance({ timestampMs: 2, clock: clock(0, false) }); coordinator.advance({ timestampMs: 3, clock: clock(0, false) }); return coordinator; }

// Missing, extra, accessor, mode, role, identity, and anchor errors reject before any state mutation.
for (const mutate of [
  () => undefined,
  (sample) => [...poses(sample), poses(sample)[0]],
  (sample) => poses(sample).map((pose, index) => index === 0 ? { ...pose, extra: true } : pose),
  (sample) => [poses(sample)[0], { ...poses(sample)[1], role: "left_wrist" }],
  (sample) => poses(sample).map((pose) => ({ ...pose, mode: "boxing", geometryIdentity: "aerobeat/glove_obb_v1" })),
  (sample) => [poses(sample, CONFIG_A)[0], poses(sample, CONFIG_B)[1]],
  (sample) => poses(sample).map((pose, index) => index === 0 ? { ...pose, anchor: { ...pose.anchor, x: pose.anchor.x + equipmentPoseAnchorEpsilonWu * 2 } } : pose)
]) {
  const coordinator = ready(); const sample = evidence("invalid", 900); const before = coordinator.getSnapshot();
  const candidate = mutate(sample);
  assert.throws(() => coordinator.advance({ timestampMs: 900, clock: clock(900, true), input: input(sample), ...(candidate === undefined ? {} : { equipmentPoses: candidate }) }), /equipment/iu);
  assert.equal(coordinator.getSnapshot(), before, "invalid pose boundary is transactional");
}

{
  const coordinator = ready(); const sample = evidence("accessor", 900); const hostile = poses(sample); let calls = 0;
  Object.defineProperty(hostile[0], "scale", { enumerable: true, get() { calls += 1; return 1; } });
  const before = coordinator.getSnapshot();
  assert.throws(() => coordinator.advance({ timestampMs: 900, clock: clock(900, true), input: input(sample), equipmentPoses: hostile }), /accessors or hidden/u);
  assert.equal(calls, 0); assert.equal(coordinator.getSnapshot(), before);
}

// Epsilon-inclusive anchors lock identity; later identity changes reject and cannot fork score partitions.
{
  const coordinator = ready(); const baseline = evidence("baseline", 900); const baselinePoses = poses(baseline);
  baselinePoses[0].anchor.x += equipmentPoseAnchorEpsilonWu;
  coordinator.advance({ timestampMs: 900, clock: clock(900, true), input: input(baseline), equipmentPoses: baselinePoses });
  const hit = evidence("hit", 1000, [1, 1], [3.5, 1]); const hitPoses = poses(hit);
  coordinator.advance({ timestampMs: 1000, clock: clock(1000, true), input: input(hit), equipmentPoses: hitPoses });
  const partition = coordinator.getScorePartitions()[0];
  assert.equal(partition.equipmentConfigIdentity.value, CONFIG_A);
  assert.match(partition.partitionId, new RegExp(`equipment-config-sha256:${CONFIG_A}`, "u"));
  assert.equal(Object.isFrozen(partition.equipmentConfigIdentity), true);
  const changed = evidence("changed", 1001, [1, 1], [3.5, 1]); const before = coordinator.getSnapshot();
  assert.throws(() => coordinator.advance({ timestampMs: 1001, clock: clock(1001, true), input: input(changed), equipmentPoses: poses(changed, CONFIG_B) }), /identity is locked/u);
  assert.equal(coordinator.getSnapshot(), before);
  assert.equal(coordinator.getScorePartitions().length, 1);
}

console.log("Equipment pose frame boundary validation passed.");
