// @ts-check
// 0.0.86 (Derrick): the magnetic assist must arc the blade INTO a beat's hit
// CONE, not merely rotate it part-way toward the beat.
//
// An ARROWED beat is hittable anywhere within a cone whose axis is the authored
// direction (see authoredDirectionCone in flow-collider-collision.js); a plain
// beat has no authored heading and does not receive magnetic steering. A plain slerp
// toward the heading rotates only `weight` of the way, so at low/mid strength
// (a far beat) the blade can still land OUTSIDE the cone. That looked assisted
// and changed nothing for gameplay.
//
// This asserts the observable property: with assist on, the residual angle to
// the authored heading is inside the cone half-angle; with assist off it is not.
import assert from "node:assert/strict";
import { magneticSaberOrientation, normalizeMagneticAttractionSettings, resolvedSaberCapsuleContactsFlowTarget } from "../src/equipment-pose-collision.js";
import { authoredDirectionCone, matchesAuthoredDirection } from "../src/flow-collider-collision.js";
import { equipmentEulerDegreesToQuaternion } from "@aerobeat/web-contracts";

const CONE_DEGREES = 45;
const HEADING = 90; // the authored "up" direction
const HASH = "e".repeat(64);
const configIdentity = { schema: "aerobeat/equipment_config_identity", version: 1, algorithm: "sha256", value: HASH };
const pose = (zDegrees) => Object.freeze({
  role: "left_wrist", mode: "flow", anchor: Object.freeze({ x: 0, y: 0, z: 0 }), scale: 1,
  orientation: equipmentEulerDegreesToQuaternion({ x: 0, y: 0, z: zDegrees }),
  geometryIdentity: "aerobeat/saber_capsule_v1", configIdentity
});
const headingDegrees = (q) => Math.atan2(2 * (q.x * q.y + q.w * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) * 180 / Math.PI;
/** Absolute angular error to the authored heading, wrapped to 0..180. */
const errorTo = (q) => Math.abs((((headingDegrees(q) - HEADING) % 360) + 540) % 360 - 180);

const cone = authoredDirectionCone("up", CONE_DEGREES);
assert.ok(cone, "up must author a hit cone");
assert.equal(cone.direction.y, 1, "the up cone axis points +Y");

const on = normalizeMagneticAttractionSettings({ range: 2, minStrength: 0.2, maxStrength: 0.8, backFaceBias: 0.5 });
const off = normalizeMagneticAttractionSettings({ range: 0, minStrength: 0.2, maxStrength: 0.8, backFaceBias: 0.5 });
// A FAR beat: weak proximity weight, which is exactly where the plain slerp used
// to stop short of the cone.
const farTarget = Object.freeze([{ id: "far-note", hand: "left", direction: "up", x: 0, y: 1.8, z: 0 }]);

// The regression: 90 degrees off is outside the cone unaided, and must be inside
// it once assist is on.
const wide = pose(180);
assert.ok(errorTo(magneticSaberOrientation(wide, 0, farTarget, off)) > CONE_DEGREES, "unaided blade starts outside the cone");
const assisted = magneticSaberOrientation(wide, 0, farTarget, on);
assert.ok(
  errorTo(assisted) <= CONE_DEGREES,
  `assist must arc the blade into the hit cone (residual ${errorTo(assisted).toFixed(1)}° must be <= ${CONE_DEGREES}°)`
);

// Proximity still decides how far BEYOND the cone edge it goes. Measured from a
// blade 90 degrees off (where the cone-entry weight, not full alignment, is the
// binding constraint), a near beat must end up closer to the axis than a far one.
const nearTarget = Object.freeze([{ id: "near-note", hand: "left", direction: "up", x: 0, y: 0.1, z: 0 }]);
const wideStart = pose(180);
const farError = errorTo(magneticSaberOrientation(wideStart, 0, farTarget, on));
const nearError = errorTo(magneticSaberOrientation(wideStart, 0, nearTarget, on));
assert.ok(nearError < farError,
  `a closer beat must pull harder than a distant one (near ${nearError.toFixed(1)}° must be < far ${farError.toFixed(1)}°)`);

// Range 0 must remain a strict no-op.
assert.deepEqual(magneticSaberOrientation(wide, 0, farTarget, off), wide.orientation, "range zero never rotates the blade");

// A plain (directionless) beat keeps its existing behaviour and is never steered.
const plainTarget = Object.freeze([{ id: "plain", hand: "left", x: 0, y: 1.8, z: 0 }]);
assert.deepEqual(magneticSaberOrientation(wide, 0, plainTarget, on), wide.orientation, "directionless beats do not attract");

// Normal Game Setup strength/range, 0.8 WU from the note: an opposite-facing
// saber previously rotated only 86.4°, stopping 93.6° from the up cone axis.
const defaults = normalizeMagneticAttractionSettings({ range: 1, minStrength: 0.2, maxStrength: 0.8, backFaceBias: 0.5 });
const note = Object.freeze({ placement: 6, centerTimestampMs: 1000, hand: "left", direction: "up" });
const atNote = Object.freeze({ ...pose(-90), anchor: Object.freeze({ x: 2, y: 0.2, z: 0 }) });
const target = Object.freeze([{ id: "opposite", hand: "left", direction: "up", x: 2, y: 1, z: 0 }]);
const corrected = magneticSaberOrientation(atNote, 1000, target, defaults);
assert.ok(errorTo(corrected) <= CONE_DEGREES + 1e-10,
  `default weak assist must enter the opposite-facing cone (residual ${errorTo(corrected)}°)`);
assert.equal(resolvedSaberCapsuleContactsFlowTarget(note, atNote, 1000, 180), false, "raw opposite-facing capsule misses");
assert.equal(resolvedSaberCapsuleContactsFlowTarget(note, { ...atNote, orientation: corrected }, 1000, 180), true,
  "the same assisted orientation published for rendering must contact the note");
const prior = { songTimeMs: 900, measurementTimestampMs: 900, sourceFrameId: "a", sourceIdentity: "camera", calibrationId: "cal", sx: 2, sy: 0.1 };
const invalidMotion = { ...prior, songTimeMs: 1000, measurementTimestampMs: 1000, sourceFrameId: "b", sy: 0 };
assert.equal(matchesAuthoredDirection("up", prior, invalidMotion, CONE_DEGREES), false,
  "capsule contact cannot grant a hit when measured wrist motion is opposite the arrow");

// Crossing the ±180° seam must take the shortest path rather than an almost
// complete revolution; the geometric cone is identical on either side.
for (const start of [-179, 179]) {
  const seamPose = Object.freeze({ ...atNote, orientation: equipmentEulerDegreesToQuaternion({ x: 0, y: 0, z: start }) });
  const leftTarget = Object.freeze([{ ...target[0], direction: "left" }]);
  const seamOrientation = magneticSaberOrientation(seamPose, 1000, leftTarget, defaults);
  const seamDelta = Math.abs((((headingDegrees(seamOrientation) - start) % 360) + 540) % 360 - 180);
  assert.ok(seamDelta < 1, `seam start ${start}° must take the 1° short arc (${seamDelta}°)`);
  assert.ok(Math.abs((((headingDegrees(seamOrientation) - 180) % 360) + 540) % 360 - 180) < 1,
    `seam start ${start}° must remain near the left-facing cone axis`);
}

console.log("Magnetic assist enters the authored hit cone at weak/opposite headings; collision and measured-motion gate agree.");