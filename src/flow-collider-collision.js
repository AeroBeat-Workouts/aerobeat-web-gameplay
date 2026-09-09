// @ts-check

/** @typedef {Readonly<Record<string, unknown>>} DataRecord */
/** @typedef {"left_wrist" | "right_wrist"} WristName */
/** @typedef {Readonly<{songTimeMs:number,measurementTimestampMs:number,sourceFrameId:string,sourceIdentity:string,calibrationId:string,sx:number,sy:number}>} ColliderSample */

export const maximumColliderSampleGapMs = 150;
export const defaultFlowColliderSettings = Object.freeze({
  schema: "aerobeat/flow_collider_settings",
  version: 1,
  algorithm: "swept_athlete_plane_v1",
  colliderRadius: 0.12,
  enforceAuthoredDirection: false,
  directionToleranceDegrees: 45,
  timingWindowMs: 180
});

const TARGET_HALF_EXTENT = 0.375;
const MINIMUM_DIRECTION_TRAVEL = 0.05;
const DIRECTIONS = Object.freeze({
  up: Object.freeze([0, 1]), down: Object.freeze([0, -1]), left: Object.freeze([-1, 0]), right: Object.freeze([1, 0]),
  "up-left": Object.freeze([-Math.SQRT1_2, Math.SQRT1_2]), "up-right": Object.freeze([Math.SQRT1_2, Math.SQRT1_2]),
  "down-left": Object.freeze([-Math.SQRT1_2, -Math.SQRT1_2]), "down-right": Object.freeze([Math.SQRT1_2, -Math.SQRT1_2])
});

/**
 * Extract one measured, calibrated landmark in canonical athlete-grid coordinates.
 * Provider/raw/screen coordinates never enter this result.
 * @param {DataRecord} evidence @param {DataRecord} input @param {WristName | "nose"} anchorName @param {number} timelinePositionMs @param {number} frameTimestampMs
 * @returns {ColliderSample | null}
 */
export function measuredColliderSample(evidence, input, anchorName, timelinePositionMs, frameTimestampMs) {
  if (evidence.provenance !== "measured" || !Array.isArray(evidence.anchors) || typeof evidence.measuredSourceFrameId !== "string" || typeof evidence.calibrationId !== "string" || typeof evidence.measurementTimestampMs !== "number" || typeof input.sourceIdentity !== "string" || input.sourceIdentity.length === 0) return null;
  const anchor = evidence.anchors.find((entry) => entry && typeof entry === "object" && /** @type {DataRecord} */ (entry).anchor === anchorName);
  if (!anchor || typeof anchor !== "object") return null;
  const point = /** @type {DataRecord} */ (anchor);
  if (point.valid !== true || typeof point.confidence !== "number" || point.confidence < 0.5 || typeof point.x !== "number" || typeof point.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1 || point.calibrationId !== evidence.calibrationId || point.measurementTimestampMs !== evidence.measurementTimestampMs) return null;
  const ageMs = frameTimestampMs - evidence.measurementTimestampMs;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maximumColliderSampleGapMs) return null;
  return Object.freeze({ songTimeMs: timelinePositionMs - ageMs, measurementTimestampMs: evidence.measurementTimestampMs, sourceFrameId: evidence.measuredSourceFrameId, sourceIdentity: input.sourceIdentity, calibrationId: evidence.calibrationId, sx: 4 * point.x - 0.5, sy: 2.5 - 3 * point.y });
}

/** @param {number} placement */
export function targetCenterForPlacement(placement) {
  return Object.freeze({ x: placement % 4, y: 2 - Math.floor(placement / 4) });
}

/** @param {DataRecord} event @param {ColliderSample} sample @param {number} radius @param {number} timingWindowMs */
export function pointContactsFlowTarget(event, sample, radius, timingWindowMs) {
  const center = targetCenterForPlacement(Number(event.placement));
  const half = TARGET_HALF_EXTENT + radius;
  return sample.songTimeMs >= Number(event.centerTimestampMs) - timingWindowMs && sample.songTimeMs <= Number(event.centerTimestampMs) + timingWindowMs && sample.sx >= center.x - half && sample.sx <= center.x + half && sample.sy >= center.y - half && sample.sy <= center.y + half;
}

/**
 * Clip a measured wrist segment against the logical target footprint and timing slab.
 * Tangency and both timing boundaries are inclusive.
 * @param {DataRecord} event @param {ColliderSample} first @param {ColliderSample} second @param {number} radius @param {number} timingWindowMs
 * @returns {Readonly<{startMs:number,endMs:number,fraction:number}> | null}
 */
export function clipWristSegmentToTarget(event, first, second, radius, timingWindowMs) {
  if (!isContinuousColliderSegment(first, second)) return null;
  const target = targetCenterForPlacement(Number(event.placement));
  const half = TARGET_HALF_EXTENT + radius;
  const dt = second.songTimeMs - first.songTimeMs;
  let low = 0; let high = 1;
  for (const [origin, delta, minimum, maximum] of [
    [first.songTimeMs, dt, Number(event.centerTimestampMs) - timingWindowMs, Number(event.centerTimestampMs) + timingWindowMs],
    [first.sx, second.sx - first.sx, target.x - half, target.x + half],
    [first.sy, second.sy - first.sy, target.y - half, target.y + half]
  ]) {
    if (delta === 0) { if (origin < minimum || origin > maximum) return null; continue; }
    const a = (minimum - origin) / delta; const b = (maximum - origin) / delta;
    low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b));
    if (low > high) return null;
  }
  return Object.freeze({ startMs: first.songTimeMs + dt * low, endMs: first.songTimeMs + dt * high, fraction: low });
}

/** @param {ColliderSample | null} first @param {ColliderSample} second */
export function isContinuousColliderSegment(first, second) {
  return first !== null && first.sourceFrameId !== second.sourceFrameId && first.sourceIdentity === second.sourceIdentity && first.calibrationId === second.calibrationId && second.measurementTimestampMs > first.measurementTimestampMs && second.songTimeMs > first.songTimeMs && second.measurementTimestampMs - first.measurementTimestampMs <= maximumColliderSampleGapMs && second.songTimeMs - first.songTimeMs <= maximumColliderSampleGapMs;
}

/** @param {string | undefined} direction @param {ColliderSample | null} first @param {ColliderSample} second @param {number} toleranceDegrees */
export function matchesAuthoredDirection(direction, first, second, toleranceDegrees) {
  if (direction === undefined) return true;
  const expected = DIRECTIONS[direction];
  if (!expected || !isContinuousColliderSegment(first, second)) return false;
  const dx = second.sx - /** @type {ColliderSample} */ (first).sx;
  const dy = second.sy - /** @type {ColliderSample} */ (first).sy;
  const length = Math.hypot(dx, dy);
  if (length < MINIMUM_DIRECTION_TRAVEL) return false;
  const cosine = (dx * expected[0] + dy * expected[1]) / length;
  return cosine + Number.EPSILON >= Math.cos(toleranceDegrees * Math.PI / 180);
}
