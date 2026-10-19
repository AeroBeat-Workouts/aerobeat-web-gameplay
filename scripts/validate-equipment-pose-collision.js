// @ts-check

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { colliderDefaultDepthWu, colliderSettingsDefaults, equipmentEulerDegreesToQuaternion, isColliderSettings, isPointInsideColliderBounds, resolveColliderBounds } from "@aerobeat/web-contracts";
import { flowSolidBladeRadiusWu, saberGeometry } from "@aerobeat/web-contracts/equipment-contracts";
import { beatInsideColliderDepth, colliderBackFaceTimestampMs, effectivePlayNoteAfterWindowMs, internalFlowFirstContactSliceT, sweptSaberContactsFlowTarget, equipmentPoseAnchorEpsilonWu, equipmentPoseContractsCommit, resolvedGloveObbContactsBoxingTarget, resolvedSaberCapsuleContactsFlowTarget } from "../src/equipment-pose-collision.js";

const HASH = "c".repeat(64);
const identity = { schema: "aerobeat/equipment_config_identity", version: 1, algorithm: "sha256", value: HASH };
const orientation = (x = 0, y = 0, z = 0) => equipmentEulerDegreesToQuaternion({ x, y, z });
const pose = (role, mode, anchor, options = {}) => ({ role, mode, anchor, scale: options.scale ?? 1, orientation: options.orientation ?? orientation(), geometryIdentity: mode === "flow" ? "aerobeat/saber_capsule_v1" : "aerobeat/glove_obb_v1", configIdentity: identity });
const flowEvent = { centerTimestampMs: 1000, placement: 5 };
const boxingTarget = { centerTimestampMs: 1000, x: 1, y: 1 };
const flowContact = (entry, songTimeMs = 1000) => resolvedSaberCapsuleContactsFlowTarget(flowEvent, entry, songTimeMs, 180);
const boxingContact = (entry, songTimeMs = 1000) => resolvedGloveObbContactsBoxingTarget(boxingTarget, entry, songTimeMs, 180);

assert.equal(equipmentPoseContractsCommit, "9544415ee5e42deaa4de99967c961d158d6720d7", "pose semantics stay pinned to latest contracts main");
assert.equal(equipmentPoseAnchorEpsilonWu, 1e-6, "the strict measured-anchor epsilon is documented and stable");

// Flow uses the exact transformed capsule projection for both roles and canonical scales.
for (const role of ["left_wrist", "right_wrist"]) {
  for (const scale of [0.75, 1, 2]) assert.equal(flowContact(pose(role, "flow", { x: 1, y: 1, z: 0 }, { scale })), true, `${role} scale ${scale} center contact`);
}
assert.equal(flowContact(pose("left_wrist", "flow", { x: 1.524, y: 1, z: 0 }, { orientation: orientation(0, 0, 0) })), true, "capsule radius exact touch counts");
assert.equal(flowContact(pose("left_wrist", "flow", { x: 1.524001, y: 1, z: 0 }, { orientation: orientation(0, 0, 0) })), false, "capsule radius just miss stays outside");
assert.equal(flowContact(pose("left_wrist", "flow", { x: 3, y: 0.5, z: 0 }, { orientation: orientation(0, 0, 0) })), false, "collinear but disjoint capsule axis cannot false-positive on a target edge");
assert.equal(flowContact(pose("right_wrist", "flow", { x: 2.5, y: 1, z: 0 }, { scale: 2, orientation: orientation(0, 0, 180) })), true, "Z swing rotates the projected saber into target");
assert.equal(flowContact(pose("right_wrist", "flow", { x: 2.5, y: 1, z: 0 }, { scale: 1, orientation: orientation(0, 0, 180) })), false, "scale-one Z swing cannot bridge scale-two reach");
assert.equal(flowContact(pose("left_wrist", "flow", { x: 1.524, y: 1, z: 0 }, { orientation: orientation(90, 0, 0) })), true, "local X roll leaves saber projection unchanged");
assert.equal(flowContact(pose("left_wrist", "flow", { x: 2.2, y: 1, z: 0 }, { orientation: orientation(0, 0, 180) })), true, "in-plane reversed saber reaches the target");
assert.equal(flowContact(pose("left_wrist", "flow", { x: 2.2, y: 1, z: 0 }, { orientation: orientation(0, 90, 180) })), false, "out-of-plane Y tilt shortens the same projected reach");
assert.equal(flowContact(pose("left_wrist", "flow", { x: 1, y: 1, z: 0 }, { scale: 0.75, orientation: orientation(25, 35, 65) })), true, "combined normalized quaternion resolves deterministically");
assert.equal(flowContact(pose("left_wrist", "flow", { x: 1, y: 1, z: 0 }), 820), true, "Flow early timing boundary is inclusive");
assert.equal(flowContact(pose("left_wrist", "flow", { x: 1, y: 1, z: 0 }), 1180.001), false, "Flow outside timing boundary misses");

// Boxing must scale its glove, not the target: the old target-scale OBB path
// incorrectly misses this contact at Scale .5 and accepts it at Scale 2.
const scaleEdge = pose("left_wrist", "boxing", { x: 1.65, y: 1, z: 0 });
assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, scaleEdge, 1000, 180, { scale: .5 }), true, "Scale .5 glove still reaches the fixed note edge");
assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, scaleEdge, 1000, 180, { scale: 1 }), true, "Scale 1 glove radius contacts fixed note rectangle");
assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, scaleEdge, 1000, 180, { scale: 2 }), true, "Scale 2 increases glove radius");

// The 3D cylinder tests the note at its moving Z; XY rotation around local Z
// leaves its circular cross-section unchanged, while X/Y tilts move its axis.
for (const role of ["left_wrist", "right_wrist"]) {
  for (const scale of [0.75, 1, 2]) assert.equal(boxingContact(pose(role, "boxing", { x: 1, y: 1, z: 0 }, { scale })), true, `${role} scale ${scale} center contact`);
}
assert.equal(boxingContact(pose("left_wrist", "boxing", { x: 1.84, y: 1, z: 0 })), true, "cylinder radius exact XY touch counts");
assert.equal(boxingContact(pose("left_wrist", "boxing", { x: 1.840001, y: 1, z: 0 })), false, "outside radius misses");
assert.equal(boxingContact(pose("right_wrist", "boxing", { x: 1.84, y: 1, z: 0 }, { orientation: orientation(0, 0, 90) })), true, "local Z roll leaves circular cross-section unchanged");
assert.equal(boxingContact(pose("right_wrist", "boxing", { x: 1.840001, y: 1, z: 0 }, { orientation: orientation(0, 0, 90) })), false, "rolled cylinder retains precise XY edge");
const pitchedX = pose("left_wrist", "boxing", { x: 1, y: 1.8, z: 0 }, { orientation: orientation(90, 0, 0) });
assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, pitchedX, 1000, 180, { depthForward: 0, depthBackward: 0 }), false, "collapsed axis has no hidden length");
assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, pitchedX, 1000, 180, { depthForward: 1, depthBackward: 0 }), true, "rotated front reaches toward target Y");
const pitchedY = pose("left_wrist", "boxing", { x: 1.8, y: 1, z: 0 }, { orientation: orientation(0, -90, 0) });
assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, pitchedY, 1000, 180, { depthForward: 0, depthBackward: 0 }), false, "Y-tilted zero length stays outside target");
assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, pitchedY, 1000, 180, { depthForward: 1, depthBackward: 0 }), true, "Y-tilted front follows local Z");
assert.equal(boxingContact(pose("right_wrist", "boxing", { x: 1.2, y: 1.1, z: 0 }, { scale: 0.75, orientation: orientation(25, 35, 65) })), true, "combined glove quaternion resolves deterministically");
assert.equal(boxingContact(pose("right_wrist", "boxing", { x: 1.9, y: 1.9, z: 0 }, { orientation: orientation(0, 0, 45) })), false, "circular corner misses outside true radius");
assert.equal(boxingContact(pose("left_wrist", "boxing", { x: 1, y: 1, z: 0 }), 820), false, "moving note Z=-1.08 is beyond front cap");
assert.equal(boxingContact(pose("left_wrist", "boxing", { x: 1, y: 1, z: 0 }), 1180), false, "moving note Z=+1.08 is beyond back cap");
assert.equal(boxingContact(pose("left_wrist", "boxing", { x: 1, y: 1, z: 0 }), 1180.001), false, "outside independent timing boundary misses");

// Flow remains XY-projected with its own timing slab. Boxing intersects a
// moving XY note face in 3D, with independent ±base timing eligibility.
const flowAt = pose("left_wrist", "flow", { x: 1, y: 1, z: 0 });
assert.equal(flowContact(flowAt, 819), false);
assert.equal(flowContact(flowAt, 820), true);
assert.equal(flowContact(flowAt, 1180), true);
assert.equal(flowContact(flowAt, 1180.001), false);
assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, flowAt, 640, 180, { depthForward: 2 }), false);
assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, pose("left_wrist", "flow", { x: 1.54, y: 1, z: 0 }), 1000, 180, { scale: 2 }), true);
const boxerAt = pose("left_wrist", "boxing", { x: 1, y: 1, z: 0 });
for (const volume of [{ depthForward: 0, depthBackward: 0 }, { depthForward: 2, depthBackward: 3 }]) {
  assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, boxerAt, 819, 180, volume), false, "depth cannot admit before base timing");
  assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, boxerAt, 1181, 180, volume), false, "depth cannot admit after base timing");
}
assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, boxerAt, 890, 180, { depthForward: 1, depthBackward: 1 }), true, "extended rear reaches early moving Z");
assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, boxerAt, 890, 180, { depthForward: 1, depthBackward: 0 }), false, "rear zero cannot reach early note");
assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, boxerAt, 1130, 180, { depthForward: 1, depthBackward: 0 }), false, "unit front cannot reach late note Z");
assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, boxerAt, 1130, 180, { depthForward: 2, depthBackward: 0 }), true, "positive front reaches later moving Z");
assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, pose("left_wrist", "boxing", { x: 1.9, y: 1, z: 0 }), 1000, 180), false);
assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, pose("left_wrist", "boxing", { x: 1.9, y: 1, z: 0 }), 1000, 180, { scale: 2 }), true, "scale grows cylinder not authored rectangle");
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
assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, flowAt, 750, 250, { depthForward: 2 }), true, "Flow inclusive independent timing persists");
assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, boxerAt, 750, 250, { depthForward: 2 }), false, "Boxing longer cylinder still cannot reach distant early Z");
assert.equal(resolvedGloveObbContactsBoxingTarget(boxingTarget, boxerAt, 1250.001, 250, { depthBackward: 3 }), false, "Boxing depth cannot extend independent timing");

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
close(slice(scaledBlade, "right", { scale: 2 }), 0.85, "Flow scale grows blade radius without changing cell glyph coordinates");
assert.equal(slice(scaledBlade, "right", { scale: 2 }), slice(scaledBlade), "Flow scale does not expand the note cell");
close(slice(pose("left_wrist", "flow", { x: 1, y: 1.52, z: 0 }, { orientation: orientation(0, 0, 90) }), "up"), 0.85, "XY rotation changes projected blade contact locus");
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
// Flow Scale multiplies the solid blade radius, not the cell target. Zero
// disables scoring even when its collapsed axis lies inside the target.
assert.equal(flowSolidBladeRadiusWu, 0.024);
const edgeBlade = pose("left_wrist", "flow", { x: 1, y: 1.525, z: 0 });
for (const scale of [0, 0.00001, 1]) assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, edgeBlade, 1000, 180, { scale, depthForward: 1, depthBackward: 0 }), false, `Flow Scale${scale} has no solid blade overlap`);
assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, edgeBlade, 1000, 180, { scale: 2, depthForward: 1, depthBackward: 0 }), true, "Flow Scale2 grows the scored saber radius rather than note target");
assert.equal(sweptSaberContactsFlowTarget(flowEvent, [{ t: 1000, pose: edgeBlade }], 180, { scale: 2, depthForward: 1, depthBackward: 0 })?.firstContactMs, 1000, "swept scoring uses solid blade radius");
assert.equal(slice(edgeBlade, "up", { scale: 1, depthForward: 1, depthBackward: 0 }), null, "noncontact solid blade has no slice hint");
assert.ok(slice(edgeBlade, "up", { scale: 2, depthForward: 1, depthBackward: 0 }) !== null, "scaled solid blade contact supplies aligned slice hint");
assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, pose("left_wrist", "flow", { x: 1, y: 1, z: 0 }), 1000, 180, { scale: 0, depthForward: 1, depthBackward: 0 }), false, "Scale0 never scores even inside note");
const pointBlade = pose("left_wrist", "flow", { x: 1, y: 1, z: 0 });
assert.equal(sweptSaberContactsFlowTarget(flowEvent, [{ t: 1000, pose: pointBlade }], 180, { scale: 0 }), null, "Scale0 swept contact and Almost are absent");
const crossingBladeHistory = [{ t: 900, pose: pose("left_wrist", "flow", { x: -.5, y: 1, z: 0 }) }, { t: 1000, pose: pointBlade }];
assert.equal(sweptSaberContactsFlowTarget(flowEvent, crossingBladeHistory, 180, { scale: 0, depthForward: 1, depthBackward: 0 }), null, "Scale0 swept axis crosses a note but yields neither contact nor Almost");
assert.ok(sweptSaberContactsFlowTarget(flowEvent, crossingBladeHistory, 180, { scale: 1, depthForward: 1, depthBackward: 0 })?.firstContactMs >= 900, "the same nonzero swept axis really crosses that note");
assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, pointBlade, 1000, 180, { scale: 1, depthForward: 0, depthBackward: 0 }), true, "zero/zero reach is a sphere at hilt when radius positive");
assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, pointBlade, 1000, 180, { scale: 0, depthForward: 0, depthBackward: 0 }), false, "zero/zero reach and zero radius cannot score");
for (const value of [0, .00001, 9999999]) {
  assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, pointBlade, 1000, 180, { scale: value, depthForward: value, depthBackward: value }), value !== 0, `finite Scale/Depth ${value} changes real scored saber contact`);
}
assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, edgeBlade, 1000, 180, { scale: 9999999, depthForward: 0, depthBackward: 0 }), true, "huge finite radius can score off-center without widening target");
assert.throws(() => resolvedSaberCapsuleContactsFlowTarget(flowEvent, pointBlade, 1000, 180, { depthForward: Number.MAX_VALUE, depthBackward: Number.MAX_VALUE }), /flow_saber_geometry_nonfinite/u, "derived saber length overflow rejects instead of scoring corrupt geometry");
assert.throws(() => sweptSaberContactsFlowTarget(flowEvent, [{ t: 1000, pose: pointBlade }], 180, { depthForward: Number.MAX_VALUE, depthBackward: Number.MAX_VALUE }), /flow_saber_geometry_nonfinite/u, "swept overflow rejects too");
assert.throws(() => resolvedSaberCapsuleContactsFlowTarget(flowEvent, pose("left_wrist", "flow", { x: 1, y: 1, z: 0 }, { scale: 100 }), 1000, 180, { scale: Number.MAX_VALUE }), /flow_saber_geometry_nonfinite/u, "derived scored radius overflow rejects");
for (const key of ["scale", "depthForward", "depthBackward"]) for (const bad of [-1, NaN, Infinity]) {
  assert.throws(() => resolvedSaberCapsuleContactsFlowTarget(flowEvent, pointBlade, 1000, 180, { [key]: bad }), /flow_saber_reach_invalid/u, `invalid ${key} fails before scoring`);
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
for (const [label, x] of [["hilt", 1.5 + flowSolidBladeRadiusWu], ["tip", .5 - saberGeometry.length - flowSolidBladeRadiusWu]]) {
  const volume = { scale: 1, depthForward: 1, depthBackward: 0 };
  const at = (anchorX) => pose("left_wrist", "flow", { x: anchorX, y: 1, z: 0 });
  const outerX = label === "hilt" ? x + .000001 : x - .000001;
  assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, at(x), 1000, 180, volume), true, `exact ${label} boundary at solid blade radius touches the unchanged cell`);
  assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, at(outerX), 1000, 180, volume), false, `${label} one microunit beyond the solid radius misses`);
  assert.equal(sweptSaberContactsFlowTarget(flowEvent, [{ t: 1000, pose: at(x) }], 180, volume)?.firstContactMs, 1000, `${label} exact boundary scores in swept Play geometry`);
  assert.equal(sweptSaberContactsFlowTarget(flowEvent, [{ t: 1000, pose: at(outerX) }], 180, volume)?.nearMiss, true, `${label} just beyond boundary is only near`);
  assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, at(x), 1000, 180, { ...volume, scale: 0 }), false, `${label} scored boundary disables with Flow Scale0`);
}
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
