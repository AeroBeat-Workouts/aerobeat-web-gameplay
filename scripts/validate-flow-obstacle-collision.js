// @ts-check

import assert from "node:assert/strict";
import { addInterval, clipNoseSegment, coversInterval, measuredNoseSample, pointContactsObstacle } from "../src/flow-obstacle-collision.js";

const geometry = Object.freeze({ schema: "aerobeat/flow_obstacle_geometry", version: 1, coordinateSpace: "beatsaber_lane_layer", x: 1, y: 2, width: 1, height: 3 });
const obstacle = Object.freeze({ intervalStartTimestampMs: 37039.99938964844, intervalEndTimestampMs: 37064.99938964844, geometry });
const evidence = (frame, measured, x, y, overrides = {}) => ({ provenance: "measured", measuredSourceFrameId: frame, calibrationId: "cal", measurementTimestampMs: measured, anchors: [{ anchor: "nose", calibrationId: "cal", measurementTimestampMs: measured, valid: true, confidence: 1, x, y, ...overrides }] });
const sample = (songTimeMs, sx, sy, measured = songTimeMs) => Object.freeze({ songTimeMs, sx, sy, measurementTimestampMs: measured, sourceFrameId: String(measured), calibrationId: "cal" });

const top = measuredNoseSample(evidence("top", 1000, 0.5, 0), 1000, 1000);
const middle = measuredNoseSample(evidence("middle", 1000, 0.5, 0.5), 1000, 1000);
assert.deepEqual({ sx: top?.sx, sy: top?.sy }, { sx: 1.5, sy: 2.5 });
assert.equal(pointContactsObstacle({ ...obstacle, intervalStartTimestampMs: 1000, intervalEndTimestampMs: 1001 }, /** @type {NonNullable<typeof top>} */ (top)), true, "3c9d top-third nose contacts");
assert.equal(pointContactsObstacle({ ...obstacle, intervalStartTimestampMs: 1000, intervalEndTimestampMs: 1001 }, /** @type {NonNullable<typeof middle>} */ (middle)), false, "3c9d middle nose avoids");
assert.equal(measuredNoseSample(evidence("bad", 1000, 0.5, 0, { confidence: 0.49 }), 1000, 1000), null);
assert.equal(measuredNoseSample(evidence("wrist", 1000, 0.5, 0, { anchor: "left_wrist" }), 1000, 1000), null, "wrists never substitute for nose");

const tunnel = clipNoseSegment(obstacle, sample(37000, 0, 2.5, 1000), sample(37100, 3, 2.5, 1100));
assert.ok(tunnel);
assert.equal(tunnel.startMs >= obstacle.intervalStartTimestampMs, true);
assert.equal(tunnel.endMs <= obstacle.intervalEndTimestampMs, true);
assert.equal(tunnel.endMs > tunnel.startMs, true, "analytic clipping catches a 25 ms wall between samples");
const tangent = clipNoseSegment({ ...obstacle, intervalStartTimestampMs: 0, intervalEndTimestampMs: 100 }, sample(0, 0.5, 1.5, 0), sample(100, 0.5, 1.5, 100));
assert.deepEqual(tangent, { startMs: 0, endMs: 100 }, "inclusive edge contact is deterministic");
let union = addInterval([], 0, 50); union = addInterval(union, 50, 100);
assert.equal(coversInterval(union, 0, 100), true);
assert.equal(coversInterval(addInterval([], 0, 49), 0, 100), false);
assert.notEqual(measuredNoseSample(evidence("fresh", 1000, 0.5, 0), 1150, 1150), null, "150 ms sample age is accepted");
assert.equal(measuredNoseSample(evidence("stale", 1000, 0.5, 0), 1151, 1151), null, "151 ms sample age is rejected");
console.log("Continuous measured nose-only Flow obstacle collision checks passed.");
