// @ts-check

import { Sha256 } from "@aerobeat/web-hash";
import { gloveGeometry, saberGeometry } from "@aerobeat/web-contracts/equipment-contracts";

/** @typedef {Readonly<Record<string, unknown>>} DataRecord */
/** @typedef {"left_wrist" | "right_wrist"} WristName */
/** @typedef {Readonly<{x:number,y:number}>} JudgePoint */
/** @typedef {Readonly<{songTimeMs:number,measurementTimestampMs:number,sourceFrameId:string,sourceIdentity:string,calibrationId:string,sx:number,sy:number}>} ColliderSample */

export const maximumColliderSampleFreshnessMs = 150;
export const maximumColliderSampleGapMs = 150;
const WRIST_BOMB_RADIUS_WU = 0.12;
export const flowColliderSettingsBounds = Object.freeze({
  colliderRadius: Object.freeze({ minimum: 0, maximum: 0.5 }),
  directionToleranceDegrees: Object.freeze({ minimum: 0, maximum: 90 }),
  timingWindowMs: Object.freeze({ minimum: 50, maximum: 300 }),
  colliderScale: Object.freeze({ minimum: 0.25, maximum: 4 }),
  wristBombColliderScale: Object.freeze({ minimum: 0, maximum: 2 }),
  colliderDepthForward: Object.freeze({ minimum: 1, maximum: 4 }),
  colliderDepthBackward: Object.freeze({ minimum: 1, maximum: 4 })
});
export const defaultFlowColliderSettings = Object.freeze({
  schema: "aerobeat/flow_collider_settings",
  version: 1,
  algorithm: "swept_athlete_plane_v1",
  colliderRadius: 0.12,
  enforceAuthoredDirection: true,
  directionToleranceDegrees: 45,
  timingWindowMs: 180,
  colliderVisible: false,
  colliderScale: 1,
  colliderDepthForward: 1,
  colliderDepthBackward: 1
});

const LEGACY_SETTING_KEYS = Object.freeze(["schema", "version", "algorithm", "colliderRadius", "enforceAuthoredDirection", "directionToleranceDegrees", "timingWindowMs"]);
const PRE_VISIBILITY_SETTING_KEYS = Object.freeze([...LEGACY_SETTING_KEYS, "colliderScale", "colliderDepthForward", "colliderDepthBackward"]);
const VISIBLE_SETTING_KEYS = Object.freeze([...PRE_VISIBILITY_SETTING_KEYS, "colliderVisible"]);
const SETTING_KEYS = Object.freeze([...VISIBLE_SETTING_KEYS, "wristBombColliderScale"]);

/**
 * Construct one exact immutable settings record. Omission selects defaults; supplied
 * values must provide every field as own enumerable data with no extras/accessors.
 * @param {unknown} [value]
 */
export function createFlowColliderSettings(value = defaultFlowColliderSettings) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new TypeError("Flow Collider settings must be a plain record");
  const keys = Reflect.ownKeys(value);
  const exactKeys = keys.includes("wristBombColliderScale") ? SETTING_KEYS : keys.length === LEGACY_SETTING_KEYS.length ? LEGACY_SETTING_KEYS : keys.length === PRE_VISIBILITY_SETTING_KEYS.length ? PRE_VISIBILITY_SETTING_KEYS : VISIBLE_SETTING_KEYS;
  if (keys.length !== exactKeys.length || keys.some((key) => typeof key !== "string" || !exactKeys.includes(key))) throw new TypeError("Flow Collider settings require every exact field and no extras");
  /** @type {Record<string, unknown>} */ const record = {};
  for (const key of exactKeys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError("Flow Collider settings cannot contain accessors or hidden fields"); record[key] = descriptor.value; }
  if (record.schema !== "aerobeat/flow_collider_settings" || record.version !== 1 || record.algorithm !== "swept_athlete_plane_v1" || typeof record.enforceAuthoredDirection !== "boolean") throw new TypeError("Flow Collider settings require the exact v1 algorithm contract");
  const colliderRadius = boundedSetting(record.colliderRadius, flowColliderSettingsBounds.colliderRadius, "collider radius");
  const directionToleranceDegrees = boundedSetting(record.directionToleranceDegrees, flowColliderSettingsBounds.directionToleranceDegrees, "direction tolerance");
  const timingWindowMs = boundedSetting(record.timingWindowMs, flowColliderSettingsBounds.timingWindowMs, "timing window");
  if (record.colliderVisible !== undefined && typeof record.colliderVisible !== "boolean") throw new TypeError("Flow Collider visibility must be boolean");
  const colliderVisible = record.colliderVisible ?? false;
  const colliderScale = boundedSetting(record.colliderScale ?? 1, flowColliderSettingsBounds.colliderScale, "collider scale");
  const wristBombColliderScale = boundedSetting(record.wristBombColliderScale ?? 1, flowColliderSettingsBounds.wristBombColliderScale, "wrist bomb collider scale");
  const colliderDepthForward = boundedSetting(record.colliderDepthForward ?? 1, flowColliderSettingsBounds.colliderDepthForward, "forward depth");
  const colliderDepthBackward = boundedSetting(record.colliderDepthBackward ?? 1, flowColliderSettingsBounds.colliderDepthBackward, "backward depth");
  const normalized = Object.freeze({ schema: record.schema, version: record.version, algorithm: record.algorithm, colliderRadius, enforceAuthoredDirection: record.enforceAuthoredDirection, directionToleranceDegrees, timingWindowMs, colliderVisible, colliderScale, colliderDepthForward, colliderDepthBackward, ...(record.wristBombColliderScale === undefined ? {} : { wristBombColliderScale }) });
  return normalized;
}

/** @param {unknown} value @param {Readonly<{minimum:number,maximum:number}>} bounds @param {string} label */
function boundedSetting(value, bounds, label) { if (typeof value !== "number" || !Number.isFinite(value) || value < bounds.minimum || value > bounds.maximum) throw new RangeError(`Flow Collider ${label} is outside its bounded range`); return Object.is(value, -0) ? 0 : value; }

/** @param {unknown} settings */
export function flowColliderSettingsIdentity(settings) { const exact = createFlowColliderSettings(settings); const legacy = exact.colliderScale === 1 && exact.colliderDepthForward === 1 && exact.colliderDepthBackward === 1; const keys = legacy ? LEGACY_SETTING_KEYS : PRE_VISIBILITY_SETTING_KEYS; return `sha256:${new Sha256().update(JSON.stringify((Number(exact.wristBombColliderScale ?? 1) === 1 ? keys : [...keys, "wristBombColliderScale"]).map((key) => exact[key]))).digestHex()}`; }

/**
 * Minimum judge-space displacement over the smoothing window before the
 * saber direction is motion-derived rather than the grid-facing fallback.
 * Shared by the pure `saberDirectionFromWristHistory` oracle.
 */
export const MINIMUM_SABER_DIRECTION_TRAVEL = 0.05;
const MINIMUM_DIRECTION_TRAVEL = MINIMUM_SABER_DIRECTION_TRAVEL;
const DIRECTIONS = Object.freeze({
  up: Object.freeze([0, 1]), down: Object.freeze([0, -1]), left: Object.freeze([-1, 0]), right: Object.freeze([1, 0]),
  "up-left": Object.freeze([-Math.SQRT1_2, Math.SQRT1_2]), "up-right": Object.freeze([Math.SQRT1_2, Math.SQRT1_2]),
  "down-left": Object.freeze([-Math.SQRT1_2, -Math.SQRT1_2]), "down-right": Object.freeze([Math.SQRT1_2, -Math.SQRT1_2])
});

/**
 * Extract one measured, calibrated landmark in canonical athlete-grid coordinates.
 * Provider/raw/screen coordinates never enter this result.
 *
 * F4 (0.0.60): `provenance: "frozen"` frames (held last-measured positions
 * republished during a calibrated tracking freeze) are accepted. The 150 ms
 * freshness age check is EXEMPTED for frozen frames — the held timestamp is
 * allowed to age past it by design — and the held position is scored at the
 * current song position because it represents the athlete's current pose.
 * Every other validation (exact anchor name, valid + confidence, finite
 * coordinates, calibration/timestamp equality) stays identical. Wrist
 * coordinates may be finite and off-grid because exact resolved equipment
 * geometry decides collider contact; nose coordinates remain grid-bounded for
 * body/obstacle semantics.
 *
 * @param {DataRecord} evidence @param {DataRecord} input @param {WristName | "nose"} anchorName @param {number} timelinePositionMs @param {number} frameTimestampMs
 * @returns {ColliderSample | null}
 */
export function measuredColliderSample(evidence, input, anchorName, timelinePositionMs, frameTimestampMs) {
  const isFrozen = evidence.provenance === "frozen";
  if (evidence.provenance !== "measured" && !isFrozen || !Array.isArray(evidence.anchors) || typeof evidence.measuredSourceFrameId !== "string" || typeof evidence.calibrationId !== "string" || typeof evidence.measurementTimestampMs !== "number" || typeof input.sourceIdentity !== "string" || input.sourceIdentity.length === 0) return null;
  const anchor = evidence.anchors.find((entry) => entry && typeof entry === "object" && /** @type {DataRecord} */ (entry).anchor === anchorName);
  if (!anchor || typeof anchor !== "object") return null;
  const point = /** @type {DataRecord} */ (anchor);
  const finitePosition = typeof point.x === "number" && typeof point.y === "number" && Number.isFinite(point.x) && Number.isFinite(point.y);
  const gridBoundedPosition = anchorName !== "nose" || finitePosition && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
  if (point.valid !== true || typeof point.confidence !== "number" || point.confidence < 0.5 || !finitePosition || !gridBoundedPosition || point.calibrationId !== evidence.calibrationId || point.measurementTimestampMs !== evidence.measurementTimestampMs) return null;
  const ageMs = frameTimestampMs - evidence.measurementTimestampMs;
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  // Frozen frames hold the last measured position, so the held timestamp
  // deliberately ages past the freshness window. Exempt it from the freshness
  // check and score the held pose at the current song position.
  if (!isFrozen && ageMs >= maximumColliderSampleFreshnessMs) return null;
  const effectiveAgeMs = isFrozen ? 0 : ageMs;
  return Object.freeze({ songTimeMs: timelinePositionMs - effectiveAgeMs, measurementTimestampMs: evidence.measurementTimestampMs, sourceFrameId: evidence.measuredSourceFrameId, sourceIdentity: input.sourceIdentity, calibrationId: evidence.calibrationId, sx: 4 * point.x - 0.5, sy: 2.5 - 3 * point.y });
}

/**
 * Canonical 4x3 judge-space cell center for a placement (column 0..3, one WU
 * per cell: X = placement % 4, Y = 2 - row with row 0 = top). JUDGE space,
 * never presentation space.
 *
 * @param {number} placement
 * @returns {JudgePoint}
 */
export function targetCenterForPlacement(placement) {
  return Object.freeze({ x: placement % 4, y: 2 - Math.floor(placement / 4) });
}

/**
 * 0.0.61 (GATE 1): equipment detection volumes live in JUDGE space, sourced
 * from the shared `@aerobeat/web-contracts/equipment-contracts` so the
 * renderer's visible equipment and the gameplay hit volumes are the same
 * constants ("what you see is what hits").
 *
 * A flow note's cell box is the 1x1 judge-space cell around its placement
 * center (the old 0.375-radius target footprint is retired).
 *
 * @param {DataRecord} event
 * @returns {Readonly<{centerX:number,centerY:number,halfX:number,halfY:number}>}
 */
export function flowNoteCellBox(event) {
  const center = targetCenterForPlacement(Number(event.placement));
  return Object.freeze({ centerX: center.x, centerY: center.y, halfX: 0.5, halfY: 0.5 });
}

/**
 * A bomb tests only a measured wrist-centered sphere, never a saber capsule,
 * glove, nose, or another body landmark. The target is its canonical 1x1
 * placement box; sphere/box contact is inclusive at the closest point.
 * The fixed 0.12 WU radius matches the renderer's 0.24 WU diameter at scale
 * one; neither equipment orientation/scale nor target equipment depth applies.
 * @param {DataRecord} event
 * @param {ColliderSample} wrist
 * @param {DataRecord} settings
 */
export function wristBombSphereContactsFlowTarget(event, wrist, settings) {
  const scale = Number(settings.wristBombColliderScale ?? 1);
  if (scale === 0) return false;
  const timingWindowMs = Number(settings.timingWindowMs);
  if (wrist.songTimeMs < Number(event.centerTimestampMs) - timingWindowMs || wrist.songTimeMs > Number(event.centerTimestampMs) + timingWindowMs) return false;
  const cell = flowNoteCellBox(event);
  const half = 0.5;
  const dx = Math.max(Math.abs(wrist.sx - cell.centerX) - half, 0);
  const dy = Math.max(Math.abs(wrist.sy - cell.centerY) - half, 0);
  const radius = WRIST_BOMB_RADIUS_WU * scale;
  return dx * dx + dy * dy <= radius * radius + Number.EPSILON;
}

/**
 * 0.0.61 (GATE 1): the saber capsule is the SOLE flow hit detector. It is a
 * 2D capsule on the z=0 judge plane: origin at the measured wrist sample,
 * axis along `direction` (unit vector, judge up-positive space), half-extent
 * `saberGeometry.length` along the axis, radius `saberGeometry.radius` around
 * it. A note is contacted when the capsule intersects the note's 1x1 cell box
 * and the sample sits inside the inclusive timing window. The wrist-in-cell
 * point test is retired: the capsule's origin term keeps a wrist at the cell
 * center hittable in ANY direction, while the axis term adds the beam's reach
 * extension (a wrist just outside the cell can still cut the note).
 *
 * @param {DataRecord} event
 * @param {Readonly<{songTimeMs:number,sx:number,sy:number}>} sample
 * @param {JudgePoint} direction Unit saber axis direction.
 * @param {number} timingWindowMs
 * @returns {boolean}
 */
export function saberCapsuleContactsFlowTarget(event, sample, direction, timingWindowMs) {
  if (sample.songTimeMs < Number(event.centerTimestampMs) - timingWindowMs || sample.songTimeMs > Number(event.centerTimestampMs) + timingWindowMs) return false;
  const cell = flowNoteCellBox(event);
  // The capsule is a 2D shape: a line segment (the beam's centerline) from
  // the wrist sample p0 to p0 + saberGeometry.length * direction, inflated by
  // saberGeometry.radius. It intersects the 1x1 cell box iff the minimum
  // distance between the centerline segment and the cell box is <= radius.
  // For a convex segment and a convex axis-aligned box, the minimum distance
  // is the smaller of:
  //   - 0 if either segment endpoint lies inside the cell box;
  //   - the minimum over the cell's four corners of the corner-to-segment
  //     distance (a corner-to-segment distance already captures the case where
  //     the segment crosses a cell edge, because the closest cell point to
  //     the crossing is on that edge and hence within the convex hull of the
  //     four corners — the convexity of both sets makes the corner test
  //     sufficient when no endpoint is inside).
  const p0 = { x: sample.sx, y: sample.sy };
  const p1 = { x: sample.sx + saberGeometry.length * direction.x, y: sample.sy + saberGeometry.length * direction.y };
  const minX = cell.centerX - cell.halfX; const maxX = cell.centerX + cell.halfX;
  const minY = cell.centerY - cell.halfY; const maxY = cell.centerY + cell.halfY;
  const inside = (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
  if (inside(p0) || inside(p1)) return true;
  const segDx = p1.x - p0.x; const segDy = p1.y - p0.y;
  const segLenSq = segDx * segDx + segDy * segDy;
  let minimum = Number.POSITIVE_INFINITY;
  for (const [cx, cy] of [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]]) {
    const t = segLenSq === 0 ? 0 : Math.max(0, Math.min(1, ((cx - p0.x) * segDx + (cy - p0.y) * segDy) / segLenSq));
    const px = p0.x + t * segDx; const py = p0.y + t * segDy;
    minimum = Math.min(minimum, Math.hypot(cx - px, cy - py));
  }
  return minimum <= saberGeometry.radius + Number.EPSILON;
}

/**
 * 0.0.61 (GATE 1): the glove box is the SOLE boxing hit detector. It is the
 * shared `gloveGeometry` half-extents (0.34 x 0.28 x 0.34, local x = thumb
 * side mirrored per hand, y = up, z = grid-facing) placed with its center at
 * the measured wrist sample offset `offsetZ` (0.05) toward the grid. In the
 * z=0 judge plane the detection volume is therefore the axis-aligned box
 * `[wrist.x - 0.34, wrist.x + 0.34] x [wrist.y - 0.28, wrist.y + 0.28]`
 * (the +0.05 grid-facing offset is out-of-plane and does not shift the
 * 2D judge position). A punch (or guard side) is contacted when the glove box
 * intersects the 1x1 target box and the sample sits inside the inclusive
 * timing window. The old wrist-sample-in-inflated-box test is retired; this
 * box OVERLAP test intentionally changes the boundary by up to half a glove
 * dimension versus the old 0.375+radius footprint.
 *
 * @param {Readonly<{centerTimestampMs:number,x:number,y:number}>} target
 * @param {Readonly<{songTimeMs:number,sx:number,sy:number}>} sample
 * @param {number} timingWindowMs
 * @returns {boolean}
 */
export function gloveBoxContactsBoxingTarget(target, sample, timingWindowMs) {
  if (sample.songTimeMs < Number(target.centerTimestampMs) - timingWindowMs || sample.songTimeMs > Number(target.centerTimestampMs) + timingWindowMs) return false;
  return sample.sx - gloveGeometry.x < target.x + 0.5 && sample.sx + gloveGeometry.x > target.x - 0.5 && sample.sy - gloveGeometry.y < target.y + 0.5 && sample.sy + gloveGeometry.y > target.y - 0.5;
}

/**
 * 0.0.61 (GATE 1): pure, exported saber-orientation oracle. The assembly
 * imports this EXACT function to orient the visible beam, so visual == hit:
 * the same function drives both the renderer's beam and the gameplay capsule.
 *
 * Inputs:
 * - `wristSamples`: ascending array of measured wrist positions in judge
 *   space. Each entry is `{ t: measurementTimestampMs (ms, ascending),
 *   x: sx, y: sy }`. Entries with non-finite fields, a non-finite/non-
 *   ascending `t`, or an array of any shape are rejected by returning the
 *   fallback (safe: no NaN, no throw on host input).
 * - `nowMs`: the current wall timestamp in ms. Samples older than
 *   `windowMs` relative to `nowMs` are ignored.
 * - `windowMs`: smoothing lookback in ms (default 100). Must be a finite
 *   positive number, otherwise the fallback is returned.
 * - `fallback`: the grid-facing direction used when the wrist is (near)
 *   stationary or no usable sample exists. Must be a finite {x,y}; the
 *   default is `{x:0,y:1}` (up = toward the top of the grid, matching the
 *   authored up-positive convention).
 *
 * Output: a FROZEN unit direction vector `{x, y}` in the same judge
 * up-positive space as `measuredColliderSample` (sx right-positive, sy
 * up-positive). When the net displacement of the samples inside the window
 * is at least `MINIMUM_SABER_DIRECTION_TRAVEL` the displacement is
 * normalized to the motion direction; otherwise (stationary wrist, empty or
 * degenerate input) the (normalized) fallback is returned.
 *
 * @param {ReadonlyArray<Readonly<{t:number,x:number,y:number}>>} wristSamples
 * @param {number} nowMs
 * @param {Readonly<{x:number,y:number}>} [fallback]
 * @param {number} [windowMs]
 * @returns {Readonly<{x:number,y:number}>}
 */
export function saberDirectionFromWristHistory(wristSamples, nowMs, fallback = Object.freeze({ x: 0, y: 1 }), windowMs = 100) {
  const normalizeVector = (x, y) => {
    const length = Math.hypot(x, y);
    if (length < Number.EPSILON) return Object.freeze({ x: 0, y: 1 });
    return Object.freeze({ x: x / length, y: y / length });
  };
  const safeFallback = fallback !== null && typeof fallback === "object" && Number.isFinite(/** @type {DataRecord} */ (fallback).x) && Number.isFinite(/** @type {DataRecord} */ (fallback).y) ? normalizeVector(/** @type {DataRecord} */ (fallback).x, /** @type {DataRecord} */ (fallback).y) : Object.freeze({ x: 0, y: 1 });
  if (!Array.isArray(wristSamples) || !Number.isFinite(nowMs) || !Number.isFinite(windowMs) || windowMs <= 0) return safeFallback;
  /** @type {Readonly<{t:number,x:number,y:number}> | null} */
  let oldest = null;
  /** @type {Readonly<{t:number,x:number,y:number}> | null} */
  let newest = null;
  for (const entry of wristSamples) {
    if (entry === null || typeof entry !== "object" || !Number.isFinite(/** @type {DataRecord} */ (entry).t) || !Number.isFinite(/** @type {DataRecord} */ (entry).x) || !Number.isFinite(/** @type {DataRecord} */ (entry).y)) return safeFallback;
    const sample = /** @type {Readonly<{t:number,x:number,y:number}>} */ (entry);
    if (sample.t < nowMs - windowMs) continue;
    if (sample.t > nowMs) return safeFallback; // non-monotonic/corrupt history: fail to the fallback
    if (oldest === null || sample.t < oldest.t) oldest = sample;
    if (newest === null || sample.t > newest.t) newest = sample;
  }
  if (oldest === null || newest === null || oldest === newest) return safeFallback;
  const dx = newest.x - oldest.x; const dy = newest.y - oldest.y;
  if (Math.hypot(dx, dy) < MINIMUM_SABER_DIRECTION_TRAVEL) return safeFallback;
  return normalizeVector(dx, dy);
}

/**
 * Target-point + entry-cone geometry for a directional Flow Collider note,
 * for the "Visible tolerance range" debug overlay.
 *
 * The accepted-entry sector is every wrist-velocity vector whose angle from
 * the authored direction unit vector is within `toleranceDegrees` (half-angle),
 * so the full cone opens 2×`toleranceDegrees` centered on the direction. The
 * renderer combines `direction` and `toleranceDegrees` to draw the sector arc
 * around `center`. Vectors are in the same canonical up-positive
 * athlete-grid space as `matchesAuthoredDirection` (input y-down is already
 * converted by `measuredColliderSample`), so `up` is `{x:0,y:1}`.
 *
 * @param {string} direction One of the eight authored direction names.
 * @param {number} toleranceDegrees Half-angle of the entry cone, 0..90.
 * @returns {Readonly<{center:Readonly<{x:number,y:number}>,direction:Readonly<{x:number,y:number}>,toleranceDegrees:number}> | null}
 *   The geometry for the direction, or `null` when `direction` is not one of
 *   the eight authored direction names.
 */
export function authoredDirectionCone(direction, toleranceDegrees) {
  const dir = DIRECTIONS[direction];
  if (!dir) return null;
  const center = Object.freeze({ x: 0, y: 0 });
  return Object.freeze({
    center,
    direction: Object.freeze({ x: dir[0], y: dir[1] }),
    toleranceDegrees
  });
}

/**
 * 0.0.61: continuity contract for the equipment-volume judge. The detector is
 * now a per-frame equipment-volume test (saber capsule / glove box), so the
 * old swept-segment clipping is retired; this keeps the segment-continuity
 * definition (used by the authored-direction check and bomb coverage
 * tracking) unchanged.
 *
 * @param {ColliderSample | null} first @param {ColliderSample} second
 */
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
