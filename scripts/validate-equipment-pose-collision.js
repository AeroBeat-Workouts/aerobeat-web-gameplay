// @ts-check

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { colliderDefaultDepthWu, colliderSettingsDefaults, equipmentEulerDegreesToQuaternion, isColliderSettings, isPointInsideColliderBounds, resolveColliderBounds } from "@aerobeat/web-contracts";
import { saberGeometry } from "@aerobeat/web-contracts/equipment-contracts";
import { beatInsideColliderDepth, colliderBackFaceTimestampMs, effectivePlayNoteAfterWindowMs, internalFlowFirstContactSliceT, sweptSaberContactsFlowTarget, equipmentPoseAnchorEpsilonWu, equipmentPoseContractsCommit, resolvedGloveObbContactsBoxingTarget, resolvedSaberCapsuleContactsFlowTarget } from "../src/equipment-pose-collision.js";

const HASH = "c".repeat(64);
const identity = { schema: "aerobeat/equipment_config_identity", version: 1, algorithm: "sha256", value: HASH };
const orientation = (x = 0, y = 0, z = 0) => equipmentEulerDegreesToQuaternion({ x, y, z });
const pose = (role, mode, anchor, options = {}) => ({ role, mode, anchor, scale: options.scale ?? 1, orientation: options.orientation ?? orientation(), geometryIdentity: mode === "flow" ? "aerobeat/saber_capsule_v1" : "aerobeat/glove_obb_v1", configIdentity: identity });
const flowEvent = { centerTimestampMs: 1000, placement: 5 };
const boxingTarget = { centerTimestampMs: 1000, x: 1, y: 1 };
const flowContact = (entry, songTimeMs = 1000) => resolvedSaberCapsuleContactsFlowTarget(flowEvent, entry, songTimeMs, 180);
const boxingContact = (entry, songTimeMs = 1000) => resolvedGloveObbContactsBoxingTarget(boxingTarget, entry, songTimeMs, 180);

assert.equal(equipmentPoseContractsCommit, "51c2b42805f5aa008386dc8bc779cfad8542af34", "pose semantics stay pinned to latest contracts main");
assert.equal(equipmentPoseAnchorEpsilonWu, 1e-6, "the strict measured-anchor epsilon is documented and stable");

// Flow uses the exact transformed capsule projection for both roles and canonical scales.
for (const role of ["left_wrist", "right_wrist"]) {
  for (const scale of [0.75, 1, 2]) assert.equal(flowContact(pose(role, "flow", { x: 1, y: 1, z: 0 }, { scale })), true, `${role} scale ${scale} center contact`);
}
assert.equal(flowContact(pose("left_wrist", "flow", { x: 1.68, y: 1, z: 0 }, { orientation: orientation(0, 0, 0) })), true, "capsule radius exact touch counts");
assert.equal(flowContact(pose("left_wrist", "flow", { x: 1.680001, y: 1, z: 0 }, { orientation: orientation(0, 0, 0) })), false, "capsule radius just miss stays outside");
assert.equal(flowContact(pose("left_wrist", "flow", { x: 3, y: 0.5, z: 0 }, { orientation: orientation(0, 0, 0) })), false, "collinear but disjoint capsule axis cannot false-positive on a target edge");
assert.equal(flowContact(pose("right_wrist", "flow", { x: 2.5, y: 1, z: 0 }, { scale: 2, orientation: orientation(0, 0, 180) })), true, "Z swing rotates the projected saber into target");
assert.equal(flowContact(pose("right_wrist", "flow", { x: 2.5, y: 1, z: 0 }, { scale: 1, orientation: orientation(0, 0, 180) })), false, "scale-one Z swing cannot bridge scale-two reach");
assert.equal(flowContact(pose("left_wrist", "flow", { x: 1.68, y: 1, z: 0 }, { orientation: orientation(90, 0, 0) })), true, "local X roll leaves saber projection unchanged");
assert.equal(flowContact(pose("left_wrist", "flow", { x: 2.2, y: 1, z: 0 }, { orientation: orientation(0, 0, 180) })), true, "in-plane reversed saber reaches the target");
assert.equal(flowContact(pose("left_wrist", "flow", { x: 2.2, y: 1, z: 0 }, { orientation: orientation(0, 90, 180) })), false, "out-of-plane Y tilt shortens the same projected reach");
assert.equal(flowContact(pose("left_wrist", "flow", { x: 1, y: 1, z: 0 }, { scale: 0.75, orientation: orientation(25, 35, 65) })), true, "combined normalized quaternion resolves deterministically");
assert.equal(flowContact(pose("left_wrist", "flow", { x: 1, y: 1, z: 0 }), 820), true, "Flow early timing boundary is inclusive");
assert.equal(flowContact(pose("left_wrist", "flow", { x: 1, y: 1, z: 0 }), 1180.001), false, "Flow outside timing boundary misses");

// Boxing uses exact projected OBB convex hull/SAT, including transformed Z extent.
for (const role of ["left_wrist", "right_wrist"]) {
  for (const scale of [0.75, 1, 2]) assert.equal(boxingContact(pose(role, "boxing", { x: 1, y: 1, z: 0 }, { scale })), true, `${role} scale ${scale} center contact`);
}
assert.equal(boxingContact(pose("left_wrist", "boxing", { x: 1.84, y: 1, z: 0 })), true, "glove projected hull exact touch counts");
assert.equal(boxingContact(pose("left_wrist", "boxing", { x: 1.840001, y: 1, z: 0 })), false, "glove projected hull just miss stays outside");
assert.equal(boxingContact(pose("right_wrist", "boxing", { x: 1.78, y: 1, z: 0 }, { orientation: orientation(0, 0, 90) })), true, "Z swing rotates glove XY half extents");
assert.equal(boxingContact(pose("right_wrist", "boxing", { x: 1.780001, y: 1, z: 0 }, { orientation: orientation(0, 0, 90) })), false, "rotated glove exact projected edge remains sharp");
assert.equal(boxingContact(pose("left_wrist", "boxing", { x: 1, y: 1.79, z: 0 }, { orientation: orientation(90, 0, 0) })), true, "X roll projects glove Z extent and offset into judge Y");
assert.equal(boxingContact(pose("left_wrist", "boxing", { x: 1.79, y: 1, z: 0 }, { orientation: orientation(0, 90, 0) })), true, "Y tilt projects glove Z extent and offset into judge X");
assert.equal(boxingContact(pose("right_wrist", "boxing", { x: 1.2, y: 1.1, z: 0 }, { scale: 0.75, orientation: orientation(25, 35, 65) })), true, "combined glove quaternion resolves deterministically");
assert.equal(boxingContact(pose("right_wrist", "boxing", { x: 1.9, y: 1.9, z: 0 }, { orientation: orientation(0, 0, 45) })), false, "rotated-hull corner misses even though its enclosing AABB overlaps the target");
assert.equal(boxingContact(pose("left_wrist", "boxing", { x: 1, y: 1, z: 0 }), 820), true, "Boxing early timing boundary is inclusive");
assert.equal(boxingContact(pose("left_wrist", "boxing", { x: 1, y: 1, z: 0 }), 1180.001), false, "Boxing outside timing boundary misses");

// Future beats arrive from -Z, cross zero at the center, then exit through +Z.
// Flow saber reach never changes that note timing slab; Boxing retains its
// independent depth multipliers.
for (const [mode, contact, target] of [
  ["Flow", resolvedSaberCapsuleContactsFlowTarget, flowEvent],
  ["Boxing", resolvedGloveObbContactsBoxingTarget, boxingTarget]
]) {
  const equipment = pose("left_wrist", mode.toLowerCase(), { x: 1, y: 1, z: 0 });
  assert.equal(contact(target, equipment, 819, 180), false, `${mode}: beyond front face cannot hit`);
  assert.equal(contact(target, equipment, 820, 180), true, `${mode}: inclusive front face hits`);
  assert.equal(contact(target, equipment, 1180, 180), true, `${mode}: inclusive back face hits`);
  assert.equal(contact(target, equipment, 1180.001, 180), false, `${mode}: behind back face cannot hit`);
  assert.equal(contact(target, equipment, 640, 180, { depthForward: 2 }), mode === "Boxing", `${mode}: extra forward reach changes only Boxing timing`);
  assert.equal(contact(target, equipment, 1181, 180, { depthForward: 2 }), false, `${mode}: depth+ cannot extend past +Z`);
  assert.equal(contact(target, equipment, 640, 180, { depthBackward: 2 }), false, `${mode}: depth- cannot extend future -Z`);
  assert.equal(contact(target, equipment, 1360, 180, { depthBackward: 2 }), mode === "Boxing", `${mode}: extra rear reach changes only Boxing timing`);
  assert.equal(contact(target, equipment, 1360.001, 180, { depthBackward: 2 }), false, `${mode}: beyond extended back face misses`);
  const distant = pose("left_wrist", mode.toLowerCase(), { x: mode === "Flow" ? 1.8 : 1.9, y: 1, z: 0 });
  assert.equal(contact(target, distant, 1000, 180), false, `${mode}: default XY target outside`);
  assert.equal(contact(target, distant, 1000, 180, { scale: 2 }), true, `${mode}: scale expands XY contact`);
}
assert.equal(beatInsideColliderDepth(1000, 640, 180), false, "a future note remains ineligible beyond its timing window");
assert.equal(beatInsideColliderDepth(1000, 820, 180), true, "Flow front face stays inclusive");
assert.equal(colliderBackFaceTimestampMs(1000, 180), 1180, "Flow note late bound uses only the timing window");
assert.equal(effectivePlayNoteAfterWindowMs(1000,180),2000,"Play note floor exceeds its normal late bound");
assert.equal(effectivePlayNoteAfterWindowMs(1000,300),2000,"larger note timing window still respects Play floor");
assert.equal(colliderDefaultDepthWu, 1.08, "shared contracts default face is 180ms × .006 WU/ms");
const sharedBounds = resolveColliderBounds({ mode: "flow", center: { x: 1, y: 1, z: 0 }, halfWidth: .5, halfHeight: .5, settings: { ...colliderSettingsDefaults.flow, colliderScale: 2, colliderDepthForward: 2, colliderDepthBackward: 1 }, timingWindowMs: 180, speedWuPerMs: .006 });
assert.deepEqual(sharedBounds, { minX: 0, maxX: 2, minY: 0, maxY: 2, minZ: -2.16, maxZ: 1.08 }, "contracts still resolve legacy world-Z bounds; these do not define Flow saber reach");
assert.equal(isPointInsideColliderBounds({ x: 1, y: 1, z: -2.16 }, sharedBounds), true, "contract world-Z front face inclusive");
const zeroRearContractSettings = { ...colliderSettingsDefaults.flow, colliderDepthBackward: 0 };
assert.equal(isColliderSettings(zeroRearContractSettings), true, "contract boundary accepts a Flow rear-zero setting without a gameplay clamp");
const zeroRearContractBounds = resolveColliderBounds({ mode: "flow", center: { x: 1, y: 1, z: 0 }, halfWidth: 0.5, halfHeight: 0.5, settings: zeroRearContractSettings, timingWindowMs: 180, speedWuPerMs: 0.006 });
assert.equal(zeroRearContractBounds.maxZ, 0, "contract resolves a genuine rear-zero face, not a hidden one-factor fallback");
assert.equal(isPointInsideColliderBounds({ x: 1, y: 1, z: 0 }, zeroRearContractBounds), true, "the zero face itself remains inclusive");
for (const [mode, contact, target] of [["flow", resolvedSaberCapsuleContactsFlowTarget, flowEvent], ["boxing", resolvedGloveObbContactsBoxingTarget, boxingTarget]]) {
  const equipment = pose("left_wrist", mode, { x: 1, y: 1, z: 0 });
  const widthMs = 250;
  const customized = { depthForward: 2, depthBackward: 1 };
  assert.equal(contact(target, equipment, 500, widthMs, customized), mode === "boxing", `${mode}: custom forward depth extends only Boxing's time face`);
  assert.equal(contact(target, equipment, 499.999, widthMs, customized), false, `${mode}: custom front face outside`);
  assert.equal(contact(target, equipment, 1250, widthMs, customized), true, `${mode}: custom backward face remains at +250ms`);
  assert.equal(contact(target, equipment, 1250.001, widthMs, customized), false, `${mode}: custom back face outside`);
}

// The private visual slice uses the exact swept hit and the resolved contact-time
// blade, never a stale wrist or the latest pose. These also cover axis glyphs.
const slice = (entry, direction = "right", volume = {}, time = 1000) => {
  const event = { ...flowEvent, direction };
  const history = [{ t: time, pose: entry }];
  const hit = sweptSaberContactsFlowTarget(event, history, 180, volume);
  return internalFlowFirstContactSliceT(event, history, 180, volume, hit);
};
const close = (actual, expected, label) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);
close(slice(pose("left_wrist", "flow", { x: 1, y: 1, z: 0 })), 0.5, "right arrow centered overlapping blade chooses cell-center locus");
close(slice(pose("left_wrist", "flow", { x: 1, y: 1.3, z: 0 }), "up"), 0.8, "up arrow uses positive judge Y");
close(slice(pose("left_wrist", "flow", { x: 1, y: 1.3, z: 0 }), "up-right"), 0.65, "diagonal arrow projects on normalized cell diagonal");
close(slice(pose("left_wrist", "flow", { x: 1, y: 1, z: 0 }), null), 0.5, "directionless orb uses midpoint");
const scaledBlade = pose("left_wrist", "flow", { x: 1.4, y: 1, z: 0 }, { scale: 2 });
close(slice(scaledBlade, "right", { scale: 2 }), 0.7, "expanded cell rescales glyph coordinate");
assert.ok(slice(scaledBlade, "right", { scale: 2 }) < slice(scaledBlade), "cell scale changes first-contact normalization");
close(slice(pose("left_wrist", "flow", { x: 1, y: 1.6, z: 0 }, { orientation: orientation(0, 0, 90) }), "up"), 0.85, "XY rotation changes projected blade contact locus");
close(slice(pose("left_wrist", "flow", { x: 1, y: 1, z: 0 }, { orientation: orientation(0, 90, 0) })), 0.5, "Z tilt shortens projected blade");
// The same canonical capsule scores at both hilt and tip, early and late.
// Behind-hilt near evidence must remain geometrically false, not a fake hit.
for (const [label, anchorX, orientationZ] of [
  ["hilt", 1.35, 0], ["tip", 0.22, 0]
]) {
  for (const t of [900, 1100]) {
    const blade = pose("left_wrist", "flow", { x: anchorX, y: 1, z: 0 }, { orientation: orientation(0, 0, orientationZ) });
    const swept = sweptSaberContactsFlowTarget(flowEvent, [{ t, pose: blade }], 180);
    assert.equal(flowContact(blade, t), true, `${label} ${t}: canonical capsule contacts`);
    assert.equal(swept?.firstContactMs, t, `${label} ${t}: swept contact keeps its true time`);
    assert.equal(swept?.hitDepthHalf, t < 1000 ? "front" : "back", `${label} ${t}: temporal diagnostic remains honest`);
  }
}
// Reach factors change the pose-axis capsule, not the Flow note timing slab.
const temporalBlade = pose("left_wrist", "flow", { x: 1, y: 1, z: 0 });
for (const volume of [{ depthForward: 0.25, depthBackward: 0 }, { depthForward: 1, depthBackward: 1 }, { depthForward: 4, depthBackward: 4 }]) {
  assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, temporalBlade, 820, 180, volume), true, "early boundary remains inclusive regardless of reach");
  assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, temporalBlade, 819.999, 180, volume), false, "longer blade cannot admit an earlier note");
  assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, temporalBlade, 1180, 180, volume), true, "rear zero still permits inclusive late hits");
  assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, temporalBlade, 1180.001, 180, volume), false, "longer rear cannot delay the note deadline");
  assert.equal(sweptSaberContactsFlowTarget(flowEvent, [{ t: 1180, pose: temporalBlade }], 180, volume)?.firstContactMs, 1180, "swept rear-zero late contact stays hittable");
  assert.equal(sweptSaberContactsFlowTarget(flowEvent, [{ t: 1180.001, pose: temporalBlade }], 180, volume), null, "swept longer blade cannot extend timing");
}
assert.equal(effectivePlayNoteAfterWindowMs(1000, 300), 2000, "Play note deadline is independent of blade length");
// A unit front ends at the contracted visible tip; rear zero is exactly the hilt.
assert.equal(saberGeometry.length, 0.75, "the test measures visible local +X reach");
for (const [label, angle, anchor] of [["hand-up", 90, { x: 1, y: -0.48, z: 0 }], ["hand-down", -90, { x: 1, y: 2.48, z: 0 }]]) {
  const blade = pose("left_wrist", "flow", anchor, { orientation: orientation(0, 0, angle) });
  const at = (volume) => resolvedSaberCapsuleContactsFlowTarget(flowEvent, blade, 1000, 180, volume);
  const swept = (volume) => sweptSaberContactsFlowTarget(flowEvent, [{ t: 1000, pose: blade }], 180, volume);
  assert.equal(at({ depthForward: 1, depthBackward: 0 }), false, `${label}: visible unit tip ends short of target`);
  assert.equal(at({ depthForward: 1.5, depthBackward: 0 }), true, `${label}: longer forward blade reaches target`);
  assert.equal(swept({ depthForward: 1, depthBackward: 0 })?.nearMiss, true, `${label}: shorter tip is near but not a hit`);
  assert.equal(slice(blade, angle > 0 ? "up" : "down", { depthForward: 1, depthBackward: 0 }), null, `${label}: short noncontact has no slice hint`);
  assert.equal(swept({ depthForward: 1.5, depthBackward: 0 })?.firstContactMs, 1000, `${label}: longer tip scores swept contact`);
  assert.ok(slice(blade, angle > 0 ? "up" : "down", { depthForward: 1.5, depthBackward: 0 }) !== null, `${label}: extended contact supplies a slice hint`);
}
const rearPose = pose("left_wrist", "flow", { x: 1.7, y: 1, z: 0 });
assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, rearPose, 1000, 180, { depthForward: 1, depthBackward: 0 }), false, "rear zero starts at hilt, without hidden backward blade");
assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, rearPose, 1000, 180, { depthForward: 1, depthBackward: 1 }), true, "positive rear reaches behind hilt");
assert.deepEqual(sweptSaberContactsFlowTarget(flowEvent, [{ t: 1000, pose: rearPose }], 180, { depthForward: 1, depthBackward: 0 }), { nearMiss: true, firstNearMs: 1000 }, "rear zero retains Almost near evidence rather than a false hit");
assert.equal(sweptSaberContactsFlowTarget(flowEvent, [{ t: 1000, pose: rearPose }], 180, { depthForward: 1, depthBackward: 1 })?.firstContactMs, 1000, "positive rear turns that near into real contact");
assert.equal(slice(rearPose, "right", { depthForward: 1, depthBackward: 0 }), null, "hilt-only near has no misleading slice hint");
assert.ok(slice(rearPose, "right", { depthForward: 1, depthBackward: 1 }) !== null, "rearward scoring contact has a slice hint on that same capsule");
const frontPose = pose("left_wrist", "flow", { x: -0.05, y: 1, z: 0 });
assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, frontPose, 1000, 180, { depthForward: 0.25, depthBackward: 0 }), false, "shortened forward reach cannot touch beyond its tip");
assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, frontPose, 1000, 180, { depthForward: 1, depthBackward: 0 }), true, "unit forward reaches visible tip at 0.75 times pose scale");
const scaledFrontPose = pose("left_wrist", "flow", { x: -0.95, y: 1, z: 0 }, { scale: 2 });
assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, scaledFrontPose, 1000, 180, { depthForward: 0.5, depthBackward: 0 }), false, "shortened scaled blade stops before target");
assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, scaledFrontPose, 1000, 180, { depthForward: 1, depthBackward: 0 }), true, "unit forward multiplies the contracted tip by pose scale");
const behindHilt = pose("left_wrist", "flow", { x: 1.7, y: 1, z: 0 });
assert.equal(flowContact(behindHilt), false, "behind hilt at 0.2 WU from cell edge never collides");
assert.deepEqual(sweptSaberContactsFlowTarget(flowEvent, [{ t: 1000, pose: behindHilt }], 180), { nearMiss: true, firstNearMs: 1000 }, "strict spatial near band and quarter timing classify behind-hilt noncontact");
assert.equal(sweptSaberContactsFlowTarget(flowEvent, [{ t: 1100, pose: behindHilt }], 180), null, "same near geometry outside quarter timing earns nothing");
assert.equal(sweptSaberContactsFlowTarget(flowEvent, [{ t: 1000, pose: pose("left_wrist", "flow", { x: 2.1, y: 1, z: 0 }) }], 180), null, "far geometry does not acquire near credit");

const movingEvent = { ...flowEvent, direction: "right" };
const movingHistory = [
  { t: 900, pose: pose("left_wrist", "flow", { x: -1, y: 1, z: 0 }) },
  { t: 1100, pose: pose("left_wrist", "flow", { x: 1, y: 1, z: 0 }) }
];
const firstHit = sweptSaberContactsFlowTarget(movingEvent, movingHistory, 180);
assert.ok(firstHit && "firstContactMs" in firstHit && firstHit.firstContactMs > 900 && firstHit.firstContactMs < 1100, "first contact is sampled between frames");
const firstSlice = internalFlowFirstContactSliceT(movingEvent, movingHistory, 180, {}, firstHit);
assert.ok(firstSlice !== null && firstSlice < slice(movingHistory[1].pose), "interpolated first sampled contact differs from latest blade pose");
assert.equal(internalFlowFirstContactSliceT(movingEvent, movingHistory, 180, {}, null), null, "no hit is not a slice");
assert.equal(internalFlowFirstContactSliceT(movingEvent, movingHistory, 180, {}, { nearMiss: true, firstNearMs: 1000 }), null, "near miss is not a hit");
assert.equal(internalFlowFirstContactSliceT(movingEvent, movingHistory, 180, {}, { firstContactMs: NaN, hitDepthHalf: "back" }), null, "nonfinite contact fails closed");
assert.equal(internalFlowFirstContactSliceT(movingEvent, movingHistory, 180, {}, { firstContactMs: 2000, hitDepthHalf: "back" }), null, "out-of-window contact fails closed");
assert.equal(slice(pose("left_wrist", "flow", { x: 3, y: 1, z: 0 })), null, "wrong-cell miss has no slice");

const implementation = await readFile(new URL("../src/equipment-pose-collision.js", import.meta.url), "utf8");
assert.doesNotMatch(implementation, /\.glb|\.gltf|mesh|modelBounds/iu, "collision math is GLB/model independent");
console.log("Resolved equipment pose collision validation passed.");
