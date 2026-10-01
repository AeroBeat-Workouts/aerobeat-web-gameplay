// @ts-check
// 0.0.86 (Derrick): the magnetic assist must arc the blade INTO a beat's hit
// CONE, not merely rotate it part-way toward the beat.
//
// An ARROWED beat is hittable anywhere within a cone whose axis is the authored
// direction (see authoredDirectionCone in flow-collider-collision.js); a plain
// beat has no direction and keeps aiming at the note centre. A plain slerp
// toward the heading rotates only `weight` of the way, so at low/mid strength
// (a far beat) the blade can still land OUTSIDE the cone. That looked assisted
// and changed nothing for gameplay.
//
// This asserts the observable property: with assist on, the residual angle to
// the authored heading is inside the cone half-angle; with assist off it is not.
import assert from "node:assert/strict";
import { magneticSaberOrientation, normalizeMagneticAttractionSettings } from "../src/equipment-pose-collision.js";
import { authoredDirectionCone } from "../src/flow-collider-collision.js";
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

console.log("Magnetic assist arcs into the authored hit cone (in-cone when aided, outside when not, range 0 a no-op).");