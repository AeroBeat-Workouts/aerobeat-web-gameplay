// @ts-check
import assert from "node:assert/strict";
import { createResolvedEquipmentPose, equipmentEulerDegreesToQuaternion } from "@aerobeat/web-contracts";
import { resolvePoseAt, pushPoseHistory, sweptSaberContactsFlowTarget, sweptGloveObbContactsBoxingTarget, internalFlowFirstContactSliceT } from "../src/equipment-pose-collision.js";

const identity = { schema: "aerobeat/equipment_config_identity", version: 1, algorithm: "sha256", value: "b".repeat(64) };
const pose = (x, y = 1, mode = "flow", zRotation = 0) => createResolvedEquipmentPose({ role: "left_wrist", mode, anchor: { x, y, z: 0 }, scale: 1, orientation: equipmentEulerDegreesToQuaternion({ x: 0, y: 0, z: zRotation }), geometryIdentity: mode === "flow" ? "aerobeat/saber_capsule_v1" : "aerobeat/glove_obb_v1", configIdentity: identity });
const entry = (t, x, y = 1, mode = "flow") => ({ t, pose: pose(x, y, mode) });
const event = { centerTimestampMs: 1000, placement: 5 };
const target = { centerTimestampMs: 1000, x: 1, y: 1 };

// Previous secant 3 WU/100ms, current 1 WU/200ms: start slope is
// clamped to 3x, end slope 1x, so the midpoint is 3.75 (linear: 3.5).
const history = [entry(700, 0), entry(800, 3), entry(1000, 4)];
let context;
const capture = (value, node) => { context = node; return value; };
assert.equal(resolvePoseAt(history, 900, capture).anchor.x, 3.75);
assert.equal(context.timestampMs, 900);
assert.ok(Math.abs(context.tangent.x - .0025) < 1e-12, "tangent is the spline derivative in WU/ms");
assert.deepEqual(context.tangent, { x: context.tangent.x, y: 0, z: 0 });
assert.ok(Object.isFrozen(context) && Object.isFrozen(context.tangent));
let endpointCalls = 0;
const forbiddenEndpoint = () => { endpointCalls++; throw new Error("endpoint modified"); };
for (const sample of history) assert.equal(resolvePoseAt(history, sample.t, forbiddenEndpoint), sample.pose, "measured endpoints retain exact identity");
assert.equal(resolvePoseAt(history, 0, forbiddenEndpoint), history[0].pose);
assert.equal(resolvePoseAt(history, 2000, forbiddenEndpoint), history[2].pose);
assert.equal(endpointCalls, 0, "no extrapolation or endpoint reprojection");
assert.equal(resolvePoseAt([entry(800, 3), entry(1000, 4)], 900).anchor.x, 3.5, "two poses are linear without an older secant");

for (const xs of [[0, 3, 4], [4, 1, 0], [0, 3, 2], [3, 1, 1]]) {
  const bounded = xs.map((x, index) => entry(index * 100, x));
  for (let t = 100; t <= 200; t++) {
    const x = resolvePoseAt(bounded, t).anchor.x;
    assert.ok(x >= Math.min(xs[1], xs[2]) - 1e-12 && x <= Math.max(xs[1], xs[2]) + 1e-12, "curve never overshoots measured component bounds");
  }
}
const equal = [entry(700, 0), entry(800, 2), entry(1200, 2)];
assert.equal(resolvePoseAt(equal, 1000, capture).anchor.x, 2);
assert.equal(context.tangent.x, 0, "equal endpoints remain valid stationary geometry");
const scaled = [{ t: 0, pose: pose(0) }, { t: 100, pose: createResolvedEquipmentPose({ ...pose(1, 1, "flow", 180), scale: 2 }) }];
const midpoint = resolvePoseAt(scaled, 50);
assert.equal(midpoint.scale, 1.5);
assert.ok(Math.abs(Math.abs(midpoint.orientation.z) - Math.SQRT1_2) < 1e-12, "no-callback orientation keeps shortest slerp");

// A position-dependent projection points a saber at the target only around
// the segment midpoint. Endpoint orientation interpolation cannot do this.
const sparse = [entry(800, 2, .8), entry(1200, 2, 1.2)];
const reproject = (value) => createResolvedEquipmentPose({ ...value, orientation: equipmentEulerDegreesToQuaternion({ x: 0, y: 0, z: value.anchor.y > .9 && value.anchor.y < 1.1 ? 180 : 0 }) });
assert.equal(sweptSaberContactsFlowTarget(event, sparse, 50), null);
const contact = sweptSaberContactsFlowTarget(event, sparse, 50, {}, null, reproject);
assert.ok(contact && "firstContactMs" in contact, "reprojected interior saber reaches the target");
assert.ok(internalFlowFirstContactSliceT(event, sparse, 50, {}, contact, null, reproject) !== null, "slice diagnostic uses the same reprojected geometry");
assert.equal(internalFlowFirstContactSliceT(event, sparse, 50, {}, contact), null, "unprojected geometry does not claim a slice");
assert.throws(() => resolvePoseAt(sparse, 1000, () => ({ invalid: true })), "projector output must satisfy the resolved-pose contract");

// The whole-gap 24-point lattice had no sample in [1000.123,1000.125].
// Clip first and explicitly probe both inclusive boundaries in both modes.
for (const mode of ["flow", "boxing"]) {
  const stationary = [entry(0, 1, 1, mode), entry(2400, 1, 1, mode)];
  const center = 1000.124; const window = .001;
  const hit = mode === "flow" ? sweptSaberContactsFlowTarget({ ...event, centerTimestampMs: center }, stationary, window) : sweptGloveObbContactsBoxingTarget({ ...target, centerTimestampMs: center }, stationary, window);
  assert.equal(hit?.firstContactMs, center - window, `${mode}: narrow overlap starts inclusively, without a movement gate`);
  const clipped = [entry(center - window, 1, 1, mode)];
  assert.ok(mode === "flow" ? sweptSaberContactsFlowTarget({ ...event, centerTimestampMs: center }, clipped, window) : sweptGloveObbContactsBoxingTarget({ ...target, centerTimestampMs: center }, clipped, window));
}

// Retain only one point at/before cutoff, and null resets erase it too.
let trimmed = [entry(0, 3), entry(500, 3), entry(1000, 3)];
trimmed = pushPoseHistory(trimmed, pose(1), 2000, 200);
assert.deepEqual(trimmed.map(({ t }) => t), [1000, 2000]);
assert.ok(sweptSaberContactsFlowTarget({ ...event, centerTimestampMs: 1900 }, trimmed, 50), "retained predecessor brackets sparse eligible contact");
assert.deepEqual(pushPoseHistory(trimmed, null, 2100, 200), [], "invalid/reset sample cannot bridge history");
assert.deepEqual(pushPoseHistory(trimmed, pose(1), 2000, 200).map(({ t }) => t), [1000, 2000], "republishing a timestamp stays idempotent");
console.log("Bounded spline and equipment reprojection validation passed.");
