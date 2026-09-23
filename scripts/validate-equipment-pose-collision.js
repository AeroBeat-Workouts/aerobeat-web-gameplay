// @ts-check

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { equipmentEulerDegreesToQuaternion } from "@aerobeat/web-contracts";
import { equipmentPoseAnchorEpsilonWu, equipmentPoseContractsCommit, resolvedGloveObbContactsBoxingTarget, resolvedSaberCapsuleContactsFlowTarget } from "../src/equipment-pose-collision.js";

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

const implementation = await readFile(new URL("../src/equipment-pose-collision.js", import.meta.url), "utf8");
assert.doesNotMatch(implementation, /\.glb|\.gltf|mesh|modelBounds/iu, "collision math is GLB/model independent");
console.log("Resolved equipment pose collision validation passed.");
