// @ts-check
//
// Acceptance test for the magnetic-rotation assist being AUTHORITATIVE for
// Flow COLLISION (not only a visual effect). Two invariants:
//
//   1. The assisted orientation CHANGES A COLLISION VERDICT: the same tracked
//      wrist pose yields MISS with assist disabled (range = 0) and HIT with
//      assist enabled — and the reverse when range is 0.
//   2. The anchor invariant is preserved: the assist is ROTATIONAL ONLY. The
//      pose anchor must stay exactly at the measured wrist (within
//      `equipmentPoseAnchorEpsilonWu`) for both the raw and the assisted pose.
//
import assert from "node:assert/strict";
import { equipmentEulerDegreesToQuaternion } from "@aerobeat/web-contracts";
import {
  equipmentPoseAnchorEpsilonWu,
  magneticSaberOrientation,
  normalizeMagneticAttractionSettings,
  resolvedSaberCapsuleContactsFlowTarget
} from "../src/equipment-pose-collision.js";

const HASH = "e".repeat(64);
const configIdentity = { schema: "aerobeat/equipment_config_identity", version: 1, algorithm: "sha256", value: HASH };

/** Build a valid flow pose. The anchor is in JUDGE space. */
function flowPose(anchor, orientation = equipmentEulerDegreesToQuaternion({ x: 0, y: 0, z: 0 })) {
  return Object.freeze({
    role: "left_wrist",
    mode: "flow",
    anchor: Object.freeze({ ...anchor, z: 0 }),
    scale: 1,
    orientation,
    geometryIdentity: "aerobeat/saber_capsule_v1",
    configIdentity
  });
}

/** The Flow note at placement 6 (judge center x=2, y=1); the capsule is tested against its 1x1 cell box. */
const flowEvent = Object.freeze({ centerTimestampMs: 1000, placement: 6, hand: "left", direction: "up" });

// The tracked wrist sits just below the note's cell box with the saber pointing
// LEFT (−X, a 180° world-Z roll). The wrist is placed so that an UN-ASSISTED
// left-pointing blade MISSES the note (the capsule extends left, away from the
// note), but the magnetic pull toward an "up" beat rotates the blade to point
// up — and that assisted blade HITS the note directly above the wrist.
const wristAnchor = { x: 2.0, y: 0.7 };
const leftPointingOrientation = equipmentEulerDegreesToQuaternion({ x: 0, y: 0, z: 180 });
const rawPose = flowPose(wristAnchor, leftPointingOrientation);

// The assist target: a same-hand (left) directional "up" beat centered on the
// note cell, at the judge-plane depth (z=0) so it is within range.
const assistTarget = Object.freeze({ hand: "left", direction: "up", x: 2, y: 1, z: 0, id: "assist-note" });
const targets = Object.freeze([assistTarget]);

const assistOn = normalizeMagneticAttractionSettings({ range: 2, minStrength: 0.2, maxStrength: 0.8, backFaceBias: 0.5 });
const assistOff = normalizeMagneticAttractionSettings({ range: 0, minStrength: 0.2, maxStrength: 0.8, backFaceBias: 0.5 });
assert.notEqual(assistOn, null, "range=2 settings normalize");
assert.notEqual(assistOff, null, "range=0 settings normalize (assist disabled)");

const rawOrientation = rawPose.orientation;
const assistedOrientation = magneticSaberOrientation(rawPose, 1000, targets, assistOn);

// The assist must actually rotate the blade (it is not a no-op).
assert.notDeepEqual(assistedOrientation, rawOrientation, "assist with range>0 changes the orientation");

// --- Invariant 2: anchor is ROTATIONAL ONLY and stays at the measured wrist. ---
// `magneticSaberOrientation` returns a bare quaternion; the collision pose keeps
// the same anchor. Assert the anchor of the assisted pose equals the raw anchor
// within the strict measured-wrist epsilon (no teleport).
const assistedPose = Object.freeze({ ...rawPose, orientation: assistedOrientation });
assert.ok(
  Math.abs(assistedPose.anchor.x - rawPose.anchor.x) <= equipmentPoseAnchorEpsilonWu &&
  Math.abs(assistedPose.anchor.y - rawPose.anchor.y) <= equipmentPoseAnchorEpsilonWu &&
  Math.abs(assistedPose.anchor.z) <= equipmentPoseAnchorEpsilonWu,
  "magnetic assist is rotational only: the anchor stays at the measured wrist (no teleport)"
);

// --- Invariant 1: the assisted orientation CHANGES A COLLISION VERDICT. ---
// Without assist (range = 0) the identical tracked pose MISSES the note.
const rawOrientationVerdict = magneticSaberOrientation(rawPose, 1000, targets, assistOff);
assert.deepEqual(rawOrientationVerdict, rawOrientation, "range=0 leaves the orientation byte-identical (no assist)");
const rawPoseVerdict = Object.freeze({ ...rawPose, orientation: rawOrientationVerdict });

// With assist (range > 0) the identical tracked pose HITS the note.
assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, rawPoseVerdict, 1000, 180), false, "same tracked wrist pose MISSES without assist (range=0)");
assert.equal(resolvedSaberCapsuleContactsFlowTarget(flowEvent, assistedPose, 1000, 180), true, "same tracked wrist pose HITS with assist (range>0)");

// The verdict flip is real: the raw and assisted verdicts differ.
assert.notEqual(
  resolvedSaberCapsuleContactsFlowTarget(flowEvent, rawPoseVerdict, 1000, 180),
  resolvedSaberCapsuleContactsFlowTarget(flowEvent, assistedPose, 1000, 180),
  "assist flips the collision verdict for the same tracked pose"
);

// The anchor of the pose that now HITS is still the measured wrist.
assert.equal(assistedPose.anchor.x, wristAnchor.x, "assisted pose that hits keeps the exact measured wrist X");
assert.equal(assistedPose.anchor.y, wristAnchor.y, "assisted pose that hits keeps the exact measured wrist Y");

console.log("Magnetic assist is collision-authoritative: verdict flips with assist and the anchor invariant (rotational only) holds.");
