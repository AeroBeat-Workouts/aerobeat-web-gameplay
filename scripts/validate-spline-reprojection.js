// @ts-check
import assert from "node:assert/strict";
import { createResolvedEquipmentPose, equipmentEulerDegreesToQuaternion } from "@aerobeat/web-contracts";
import { resolvePoseAt, resolvePoseAnchorAt, pushPoseHistory, sweptSaberContactsFlowTarget, sweptGloveObbContactsBoxingTarget, internalFlowFirstContactSliceT } from "../src/equipment-pose-collision.js";

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

// Direction-only reads share the full pose's exact arithmetic, not a linear
// approximation. Check every coordinate, including slope clamps, reversals,
// equal endpoints, fractional times, single points and out-of-range clamps.
for (const xs of [[0], [0, 3], [0, 3, 4], [4, 1, 0], [0, 3, 2], [3, 1, 1]]) {
  const anchors = xs.map((x, index) => ({ t: 100 + index * 100, pose: createResolvedEquipmentPose({ ...pose(x, 2 - x, "flow", index * 60), anchor: { x, y: 2 - x, z: x / 3 }, scale: 1 + index / 4 }) }));
  for (let t = 50; t <= anchors.at(-1).t + 50; t += 6.25) {
    assert.deepEqual(resolvePoseAnchorAt(anchors, t), resolvePoseAt(anchors, t).anchor, "anchor-only resolution is bit-exact with full reconstruction");
  }
  for (const sample of anchors) assert.equal(resolvePoseAnchorAt(anchors, sample.t), sample.pose.anchor, "exact endpoints retain anchor identity");
  assert.equal(resolvePoseAnchorAt(anchors, 0), anchors[0].pose.anchor);
  assert.equal(resolvePoseAnchorAt(anchors, 2000), anchors.at(-1).pose.anchor);
}

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

// After first rejected geometry, the pure time qualifier may skip projection.
// It must still test geometry for a later passing time, and no-contact near
// fallback must remain geometry-driven regardless of that qualifier.
const crossing = [entry(0, 3), entry(100, 1), entry(200, 3)];
const crossingEvent = { ...event, centerTimestampMs: 100 };
const frontOnly = { scale: 1, depthForward: 1, depthBackward: 0 };
const geometric = sweptSaberContactsFlowTarget(crossingEvent, crossing, 100, frontOnly);
assert.ok(geometric && "firstContactMs" in geometric && geometric.firstContactMs > 0 && geometric.firstContactMs < 100);
const calls = [];
const observeProjection = (value, node) => { calls.push({ kind: "project", t: node.timestampMs }); return value; };
const reject = (t) => { calls.push({ kind: "qualify", t }); return false; };
assert.equal(sweptSaberContactsFlowTarget(crossingEvent, crossing, 100, frontOnly, null, observeProjection, reject), null, "rejected geometry cannot fall back to near");
const firstRejection = calls.findIndex((call) => call.kind === "qualify");
assert.equal(calls[firstRejection].t, geometric.firstContactMs);
assert.ok(calls.slice(0, firstRejection).some((call) => call.kind === "project"), "initial search still evaluates real geometry");
assert.ok(calls.slice(firstRejection + 1).length > 0);
assert.ok(calls.slice(firstRejection + 1).every((call) => call.kind === "qualify"), "later direction failures skip all projection");
assert.equal(sweptSaberContactsFlowTarget(crossingEvent, crossing, 100, frontOnly, null, undefined, (t) => t >= 175), null, "later direction pass without real geometry cannot hit");
const laterContact = sweptSaberContactsFlowTarget(crossingEvent, crossing, 100, frontOnly, null, undefined, (t) => t >= 100);
assert.equal(laterContact?.firstContactMs, 100, "later qualifying measured endpoint still requires and gets real contact");
const nearHistory = [entry(0, 1.6), entry(200, 1.6)];
const near = sweptSaberContactsFlowTarget(crossingEvent, nearHistory, 100, frontOnly);
assert.ok(near && "nearMiss" in near);
assert.deepEqual(sweptSaberContactsFlowTarget(crossingEvent, nearHistory, 100, frontOnly, null, undefined, () => { throw new Error("no real contact must not invoke hit qualifier"); }), near);

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
