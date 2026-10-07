// @ts-check

import { colliderSettingsDefaults, isPointInsideColliderBounds, resolveColliderBounds, resolveGloveObb, resolveSaberCapsule, equipmentEulerDegreesToQuaternion, multiplyEquipmentQuaternions, slerpEquipmentQuaternionShortest, createResolvedEquipmentPose } from "@aerobeat/web-contracts";
import { flowNoteCellBox } from "./flow-collider-collision.js";

/** @typedef {Readonly<Record<string, unknown>>} DataRecord */
/** @typedef {Readonly<{x:number,y:number}>} Point2 */
/** @typedef {import("@aerobeat/web-contracts").AeroResolvedEquipmentPose} ResolvedPose */
/** @typedef {"front" | "back"} HitDepthHalf */

/** Settled contracts revision whose resolved-pose semantics this judge consumes. */
export const equipmentPoseContractsCommit = "51c2b42805f5aa008386dc8bc779cfad8542af34";
/** Tight XY agreement required between a resolved pose anchor and measured wrist. */
export const equipmentPoseAnchorEpsilonWu = 1e-6;

/**
 * A beat approaches from future -Z, crosses the equipment judge plane at its
 * center timestamp, then exits through the past +Z face. Contracts owns the
 * world-Z volume: offset milliseconds multiplied by 0.006 world units/ms.
 * Inclusive faces remain hittable; only strict back-face crossing misses.
 * @param {number} centerTimestampMs
 * @param {number} songTimeMs
 * @param {number} timingWindowMs
 * @param {number} [depthForward]
 * @param {number} [depthBackward]
 */
export function beatInsideColliderDepth(centerTimestampMs, songTimeMs, timingWindowMs, depthForward = 1, depthBackward = 1) {
  const bounds = resolveColliderBounds({ mode: "flow", center: { x: 0, y: 0, z: 0 }, halfWidth: 1, halfHeight: 1, settings: { ...colliderSettingsDefaults.flow, colliderDepthForward: depthForward, colliderDepthBackward: depthBackward }, timingWindowMs, speedWuPerMs: 0.006 });
  return isPointInsideColliderBounds({ x: 0, y: 0, z: (songTimeMs - centerTimestampMs) * 0.006 }, bounds);
}

/** @param {number} centerTimestampMs @param {number} timingWindowMs @param {number} [depthBackward] */
export function colliderBackFaceTimestampMs(centerTimestampMs, timingWindowMs, depthBackward = 1) {
  return centerTimestampMs + timingWindowMs * depthBackward;
}

/**
 * Test a contract-resolved 3D saber capsule after exact projection into judge XY.
 * Local-axis roll leaves the projection unchanged; out-of-plane tilt shortens it.
 * @param {DataRecord} event
 * @param {unknown} pose
 * @param {number} songTimeMs
 * @param {number} timingWindowMs
 * @param {{scale?:number,depthForward?:number,depthBackward?:number}} [volume]
 */
export function resolvedSaberCapsuleContactsFlowTarget(event, pose, songTimeMs, timingWindowMs, volume = {}) {
  const box = flowNoteCellBox(event);
  const bounds = resolveTargetColliderBounds("flow", { x: box.centerX, y: box.centerY }, { x: box.halfX, y: box.halfY }, timingWindowMs, volume);
  if (!isPointInsideColliderBounds({ x: box.centerX, y: box.centerY, z: (songTimeMs - Number(event.centerTimestampMs)) * 0.006 }, bounds)) return false;
  const capsule = resolveSaberCapsule(pose);
  return segmentContactsRectangle(
    Object.freeze({ x: capsule.start.x, y: capsule.start.y }),
    Object.freeze({ x: capsule.end.x, y: capsule.end.y }),
    bounds,
    capsule.radius
  );
}

/**
 * Project the exact transformed 3D glove OBB to its XY convex hull, then use SAT
 * against the target rectangle. Touching is collision; no enclosing AABB is used.
 * @param {Readonly<{centerTimestampMs:number,x:number,y:number}>} target
 * @param {unknown} pose
 * @param {number} songTimeMs
 * @param {number} timingWindowMs
 * @param {{scale?:number,depthForward?:number,depthBackward?:number}} [volume]
 */
export function resolvedGloveObbContactsBoxingTarget(target, pose, songTimeMs, timingWindowMs, volume = {}) {
  const bounds = resolveTargetColliderBounds("boxing", target, { x: 0.5, y: 0.5 }, timingWindowMs, volume);
  if (!isPointInsideColliderBounds({ x: target.x, y: target.y, z: (songTimeMs - target.centerTimestampMs) * 0.006 }, bounds)) return false;
  const obb = resolveGloveObb(pose);
  const corners = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    corners.push(Object.freeze({
      x: obb.center.x + sx * obb.axes.x.x * obb.halfExtents.x + sy * obb.axes.y.x * obb.halfExtents.y + sz * obb.axes.z.x * obb.halfExtents.z,
      y: obb.center.y + sx * obb.axes.x.y * obb.halfExtents.x + sy * obb.axes.y.y * obb.halfExtents.y + sz * obb.axes.z.y * obb.halfExtents.z
    }));
  }
  const hull = convexHull(corners);
  const rectangle = Object.freeze([
    Object.freeze({ x: bounds.minX, y: bounds.minY }),
    Object.freeze({ x: bounds.maxX, y: bounds.minY }),
    Object.freeze({ x: bounds.maxX, y: bounds.maxY }),
    Object.freeze({ x: bounds.minX, y: bounds.maxY })
  ]);
  return convexPolygonsContact(hull, rectangle);
}

/**
 * Use the single contracts volume authority for both modes. Visibility is
 * presentation-only: toggling the wireframe cannot alter scoring.
 * @param {"flow"|"boxing"} mode
 * @param {Point2} center
 * @param {Point2} halfSize
 * @param {number} timingWindowMs
 * @param {{scale?:number,depthForward?:number,depthBackward?:number}} volume
 */
function resolveTargetColliderBounds(mode, center, halfSize, timingWindowMs, volume) {
  return resolveColliderBounds({ mode, center: { x: center.x, y: center.y, z: 0 }, halfWidth: halfSize.x, halfHeight: halfSize.y, settings: { ...colliderSettingsDefaults[mode], colliderScale: volume.scale ?? 1, colliderDepthForward: volume.depthForward ?? 1, colliderDepthBackward: volume.depthBackward ?? 1 }, timingWindowMs, speedWuPerMs: 0.006 });
}

/** @param {Point2} start @param {Point2} end @param {Readonly<{minX:number,maxX:number,minY:number,maxY:number}>} rectangle @param {number} radius */
function segmentContactsRectangle(start, end, rectangle, radius) {
  const inside = (point) => point.x >= rectangle.minX && point.x <= rectangle.maxX && point.y >= rectangle.minY && point.y <= rectangle.maxY;
  if (inside(start) || inside(end)) return true;
  const corners = [
    { x: rectangle.minX, y: rectangle.minY }, { x: rectangle.maxX, y: rectangle.minY },
    { x: rectangle.maxX, y: rectangle.maxY }, { x: rectangle.minX, y: rectangle.maxY }
  ];
  for (let index = 0; index < corners.length; index += 1) if (segmentsContact(start, end, corners[index], corners[(index + 1) % corners.length])) return true;
  let distance = Math.min(pointRectangleDistance(start, rectangle), pointRectangleDistance(end, rectangle));
  for (const corner of corners) distance = Math.min(distance, pointSegmentDistance(corner, start, end));
  return distance <= radius + Number.EPSILON;
}

/** @param {Point2} point @param {Readonly<{minX:number,maxX:number,minY:number,maxY:number}>} rectangle */
function pointRectangleDistance(point, rectangle) { const dx = Math.max(rectangle.minX - point.x, 0, point.x - rectangle.maxX); const dy = Math.max(rectangle.minY - point.y, 0, point.y - rectangle.maxY); return Math.hypot(dx, dy); }
/** @param {Point2} point @param {Point2} start @param {Point2} end */
function pointSegmentDistance(point, start, end) { const dx = end.x - start.x; const dy = end.y - start.y; const lengthSquared = dx * dx + dy * dy; const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)); return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy)); }
/** @param {Point2} a @param {Point2} b @param {Point2} c @param {Point2} d */
function segmentsContact(a, b, c, d) {
  const epsilon = 1e-12;
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (point, start, end) => point.x >= Math.min(start.x, end.x) - epsilon && point.x <= Math.max(start.x, end.x) + epsilon && point.y >= Math.min(start.y, end.y) - epsilon && point.y <= Math.max(start.y, end.y) + epsilon;
  const abC = cross(a, b, c); const abD = cross(a, b, d); const cdA = cross(c, d, a); const cdB = cross(c, d, b);
  if (Math.abs(abC) <= epsilon && onSegment(c, a, b)) return true;
  if (Math.abs(abD) <= epsilon && onSegment(d, a, b)) return true;
  if (Math.abs(cdA) <= epsilon && onSegment(a, c, d)) return true;
  if (Math.abs(cdB) <= epsilon && onSegment(b, c, d)) return true;
  return ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon));
}

/** @param {readonly Point2[]} points @returns {readonly Point2[]} */
function convexHull(points) {
  const ordered = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
  const unique = ordered.filter((point, index) => index === 0 || point.x !== ordered[index - 1].x || point.y !== ordered[index - 1].y);
  if (unique.length <= 2) return Object.freeze(unique);
  const cross = (origin, left, right) => (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x);
  const half = (source) => { const result = []; for (const point of source) { while (result.length >= 2 && cross(result[result.length - 2], result[result.length - 1], point) <= 0) result.pop(); result.push(point); } return result; };
  const lower = half(unique); const upper = half([...unique].reverse());
  lower.pop(); upper.pop();
  return Object.freeze([...lower, ...upper]);
}

/** @param {readonly Point2[]} left @param {readonly Point2[]} right */
function convexPolygonsContact(left, right) {
  if (left.length === 0 || right.length === 0) return false;
  const axes = [];
  for (const polygon of [left, right]) for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]; const end = polygon[(index + 1) % polygon.length];
    const dx = end.x - start.x; const dy = end.y - start.y;
    if (Math.hypot(dx, dy) > Number.EPSILON) axes.push(Object.freeze({ x: -dy, y: dx }));
  }
  for (const axis of axes) {
    const project = (polygon) => { let min = Number.POSITIVE_INFINITY; let max = Number.NEGATIVE_INFINITY; for (const point of polygon) { const value = point.x * axis.x + point.y * axis.y; min = Math.min(min, value); max = Math.max(max, value); } return { min, max }; };
    const a = project(left); const b = project(right);
    if (a.max < b.min || b.max < a.min) return false;
  }
  return true;
}

/* ------------------------------------------------------------------------
 * Swept (time-based) hit test
 *
 * A hit is no longer a single snapshot in time: the equipment is swept
 * through every song-time inside the beat's timing window
 * `[center - window*depthForward, center + window*depthBackward]` and the
 * beat's XY cell box is tested at each sampled and interpolated pose. The
 * depth condition is automatic — a beat's Z is `(t - center) * 0.006`, which
 * lies inside the collider Z-range exactly when t lies inside that window.
 * Because the test integrates over the whole window, a late hit that the
 * old single-snapshot test tunnels through (sparse low-FPS samples that jump
 * from before the window to after it) is caught by the interpolation across
 * the gap. Results are deterministic in the pose history alone: identical
 * histories produce identical hits at any camera update rate.
 * ------------------------------------------------------------------------ */

/**
 * Frame-rate-independent margin kept beyond the deepest possible window
 * (300 ms max window × 4 max depth factor) so a bounded pose history always
 * covers the swept range of any legal beat.
 */
export const sweptPoseHistoryMarginMs = 200;

/**
 * Retain a bounded, ascending per-role resolved-pose history.
 *
 * @param {ReadonlyArray<Readonly<{t:number, pose: ResolvedPose}>>} history
 * @param {ResolvedPose | null} pose
 * @param {number} timestampMs The measurement timestamp for this entry.
 * @param {number} trimMs Total trim window (deepest legal window + margin).
 * @returns {ReadonlyArray<Readonly<{t:number, pose: ResolvedPose}>>}
 */
export function pushPoseHistory(history, pose, timestampMs, trimMs) {
  if (pose === null) return Object.freeze([]);
  const entry = Object.freeze({ t: timestampMs, pose });
  const cutoff = timestampMs - trimMs;
  // Copy into a fresh mutable array so the push never mutates a previous
  // frozen history (which would throw).
  const kept = [];
  for (const candidate of history) if (candidate.t > cutoff) kept.push(candidate);
  kept.push(entry);
  return Object.freeze(kept);
}

/** @param {Readonly<{minX:number,maxX:number,minY:number,maxY:number}>} rectangle @param {number} radius */
function circleContactsRectangle(center, rectangle, radius) {
  const nearestX = Math.max(rectangle.minX, Math.min(center.x, rectangle.maxX));
  const nearestY = Math.max(rectangle.minY, Math.min(center.y, rectangle.maxY));
  return Math.hypot(center.x - nearestX, center.y - nearestY) <= radius + Number.EPSILON;
}

/**
 * Interpolate two resolved poses at a normalized progress in [0, 1].
 * Anchors interpolate linearly, orientation via shortest-path slerp, scale
 * linearly; identity fields carry from the start pose.
 *
 * @param {ResolvedPose} start
 * @param {ResolvedPose} target
 * @param {number} progress
 * @returns {ResolvedPose}
 */
export function lerpResolvedEquipmentPose(start, target, progress) {
  const p = Math.max(0, Math.min(1, progress));
  return createResolvedEquipmentPose({
    role: start.role,
    mode: start.mode,
    anchor: {
      x: start.anchor.x + (target.anchor.x - start.anchor.x) * p,
      y: start.anchor.y + (target.anchor.y - start.anchor.y) * p,
      z: start.anchor.z + (target.anchor.z - start.anchor.z) * p
    },
    scale: start.scale + (target.scale - start.scale) * p,
    orientation: slerpEquipmentQuaternionShortest(start.orientation, target.orientation, p),
    geometryIdentity: start.geometryIdentity,
    configIdentity: start.configIdentity
  });
}

/** @param {DataRecord} event @param {Readonly<{centerX:number,centerY:number,halfX:number,halfY:number}>} box @param {{scale?:number,depthForward?:number,depthBackward?:number}} volume @param {number} timingWindowMs */
function flowSweptContactAtPose(box, pose, volume, timingWindowMs) {
  const bounds = resolveTargetColliderBounds("flow", { x: box.centerX, y: box.centerY }, { x: box.halfX, y: box.halfY }, timingWindowMs, volume);
  const capsule = resolveSaberCapsule(pose);
  return segmentContactsRectangle(
    Object.freeze({ x: capsule.start.x, y: capsule.start.y }),
    Object.freeze({ x: capsule.end.x, y: capsule.end.y }),
    bounds,
    capsule.radius
  );
}

/** @param {Readonly<{centerTimestampMs:number,x:number,y:number}>} target @param {ResolvedPose} pose @param {number} timingWindowMs @param {{scale?:number,depthForward?:number,depthBackward?:number}} volume */
function boxingSweptContactAtPose(target, pose, timingWindowMs, volume) {
  const bounds = resolveTargetColliderBounds("boxing", target, { x: 0.5, y: 0.5 }, timingWindowMs, volume);
  const obb = resolveGloveObb(pose);
  const corners = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    corners.push(Object.freeze({
      x: obb.center.x + sx * obb.axes.x.x * obb.halfExtents.x + sy * obb.axes.y.x * obb.halfExtents.y + sz * obb.axes.z.x * obb.halfExtents.z,
      y: obb.center.y + sx * obb.axes.x.y * obb.halfExtents.x + sy * obb.axes.y.y * obb.halfExtents.y + sz * obb.axes.z.y * obb.halfExtents.z
    }));
  }
  const hull = convexHull(corners);
  const rectangle = Object.freeze([
    Object.freeze({ x: bounds.minX, y: bounds.minY }),
    Object.freeze({ x: bounds.maxX, y: bounds.minY }),
    Object.freeze({ x: bounds.maxX, y: bounds.maxY }),
    Object.freeze({ x: bounds.minX, y: bounds.maxY })
  ]);
  return convexPolygonsContact(hull, rectangle);
}

/**
 * Swept hit test for one beat against a bounded ascending resolved-pose
 * history (`{t, pose}` entries, measurement timestamps in ms).
 *
 * Samples the equipment at every stored pose inside the beat's timing
 * window AND linearly interpolates between consecutive stored poses (anchor
 * + extents via the resolved volume), so sparse low-FPS histories catch a
 * crossing that the old single-snapshot test tunnels through. Returns the
 * EARLIEST contact time and which half of the window it falls in —
 * `front` for `t < center` (early/Great), `back` for `t >= center` (late/Good) —
 * or `null` when the beat is never contacted.
 *
 * @param {DataRecord} event
 * @param {ReadonlyArray<Readonly<{t:number, pose: ResolvedPose}>>} history
 * @param {number} timingWindowMs
 * @param {{scale?:number,depthForward?:number,depthBackward?:number}} volume
 */
export function sweptSaberContactsFlowTarget(event, history, timingWindowMs, volume = {}) {
  if (history.length === 0) return null;
  const box = flowNoteCellBox(event);
  const center = Number(event.centerTimestampMs);
  const windowStart = center - timingWindowMs * (volume.depthForward ?? 1);
  const windowEnd = center + timingWindowMs * (volume.depthBackward ?? 1);
  const contacts = [];
  /** @type {number[]} */ const sampleTimes = [];
  for (const entry of history) if (entry.t >= windowStart && entry.t <= windowEnd) sampleTimes.push(entry.t);
  const probe = (t) => {
    if (t < windowStart || t > windowEnd) return;
    const pose = resolvePoseAt(history, t);
    if (flowSweptContactAtPose(box, pose, volume, timingWindowMs)) contacts.push(t);
  };
  for (const t of sampleTimes) probe(t);
  // Interpolate across every stored-pose gap that overlaps the window.
  for (let index = 0; index < history.length - 1; index += 1) {
    const from = history[index]; const to = history[index + 1];
    const spanStart = Math.max(windowStart, from.t);
    const spanEnd = Math.min(windowEnd, to.t);
    if (spanStart > spanEnd || to.t <= from.t) continue;
    const steps = 24;
    for (let step = 1; step < steps; step += 1) {
      const t = from.t + (to.t - from.t) * (step / steps);
      if (t < windowStart || t > windowEnd) continue;
      const pose = resolvePoseAt(history, t);
      if (flowSweptContactAtPose(box, pose, volume, timingWindowMs)) { contacts.push(t); break; }
    }
  }
  if (contacts.length > 0) {
    contacts.sort((a, b) => a - b);
    const first = contacts[0];
    return Object.freeze({ firstContactMs: first, hitDepthHalf: /** @type {HitDepthHalf} */ (first < center ? "front" : "back") });
  }
  // No contact: check for a near-miss. The saber must have been within a
  // tight margin of the cell box at some time inside the 1/4-beat sub-window
  // around the beat center. This captures "close but not quite" — the hand
  // was in the correct cell area with good timing but the capsule didn't
  // touch. The margin (0.25 WU) is slightly larger than the saber radius
  // (0.18) so there is a valid near-miss band: no contact (> 0.18) but near
  // (<= 0.25). Passing through the cell's general area during a sweep does
  // not qualify — only being close to the cell edge at the right time does.
  const quarterWindow = timingWindowMs * 0.25;
  const nearStart = center - quarterWindow;
  const nearEnd = center + quarterWindow;
  const nearMargin = 0.25;
  let firstNearMs = null;
  const nearProbe = (t) => {
    if (t < nearStart || t > nearEnd) return;
    const pose = resolvePoseAt(history, t);
    const capsule = resolveSaberCapsule(pose);
    if (saberNearCell(capsule, box, nearMargin)) {
      if (firstNearMs === null || t < firstNearMs) firstNearMs = t;
    }
  };
  for (const t of sampleTimes) nearProbe(t);
  for (let index = 0; index < history.length - 1; index += 1) {
    const from = history[index]; const to = history[index + 1];
    const spanStart = Math.max(nearStart, from.t);
    const spanEnd = Math.min(nearEnd, to.t);
    if (spanStart > spanEnd || to.t <= from.t) continue;
    const steps = 24;
    for (let step = 1; step < steps; step += 1) {
      const t = from.t + (to.t - from.t) * (step / steps);
      if (t < nearStart || t > nearEnd) continue;
      const pose = resolvePoseAt(history, t);
      const capsule = resolveSaberCapsule(pose);
      if (saberNearCell(capsule, box, nearMargin)) {
        if (firstNearMs === null || t < firstNearMs) firstNearMs = t;
        break;
      }
    }
  }
  if (firstNearMs !== null) return Object.freeze({ nearMiss: true, firstNearMs });
  return null;
}

/**
 * Check whether the saber is near the cell box in XY: the distance from
 * either capsule endpoint to the cell rectangle is within the given margin.
 * This is the spatial near-miss test — the hand was close to the correct
 * cell but the capsule never fully contacted it.
 *
 * @param {Readonly<{start:{x:number,y:number},end:{x:number,y:number},radius:number}>} capsule
 * @param {Readonly<{centerX:number,centerY:number,halfX:number,halfY:number}>} box
 * @param {number} margin
 * @returns {boolean}
 */
function saberNearCell(capsule, box, margin) {
  const minX = box.centerX - box.halfX;
  const maxX = box.centerX + box.halfX;
  const minY = box.centerY - box.halfY;
  const maxY = box.centerY + box.halfY;
  const rectDist = (px, py) => {
    const dx = Math.max(minX - px, 0, px - maxX);
    const dy = Math.max(minY - py, 0, py - maxY);
    return Math.hypot(dx, dy);
  };
  return rectDist(capsule.start.x, capsule.start.y) <= margin || rectDist(capsule.end.x, capsule.end.y) <= margin;
}

/**
 * Swept hit test for one boxing target against a bounded ascending
 * resolved-pose history. Same semantics as
 * {@link sweptSaberContactsFlowTarget}; the glove OBB XY convex hull is
 * tested at each sampled and interpolated pose.
 *
 * @param {Readonly<{centerTimestampMs:number,x:number,y:number}>} target
 * @param {ReadonlyArray<Readonly<{t:number, pose: ResolvedPose}>>} history
 * @param {number} timingWindowMs
 * @param {{scale?:number,depthForward?:number,depthBackward?:number}} volume
 */
export function sweptGloveObbContactsBoxingTarget(target, history, timingWindowMs, volume = {}) {
  if (history.length === 0) return null;
  const center = Number(target.centerTimestampMs);
  const windowStart = center - timingWindowMs * (volume.depthForward ?? 1);
  const windowEnd = center + timingWindowMs * (volume.depthBackward ?? 1);
  const contacts = [];
  /** @type {number[]} */ const sampleTimes = [];
  for (const entry of history) if (entry.t >= windowStart && entry.t <= windowEnd) sampleTimes.push(entry.t);
  const probe = (t) => {
    if (t < windowStart || t > windowEnd) return;
    const pose = resolvePoseAt(history, t);
    if (boxingSweptContactAtPose(target, pose, timingWindowMs, volume)) contacts.push(t);
  };
  for (const t of sampleTimes) probe(t);
  for (let index = 0; index < history.length - 1; index += 1) {
    const from = history[index]; const to = history[index + 1];
    const spanStart = Math.max(windowStart, from.t);
    const spanEnd = Math.min(windowEnd, to.t);
    if (spanStart > spanEnd || to.t <= from.t) continue;
    const steps = 24;
    for (let step = 1; step < steps; step += 1) {
      const t = from.t + (to.t - from.t) * (step / steps);
      if (t < windowStart || t > windowEnd) continue;
      const pose = resolvePoseAt(history, t);
      if (boxingSweptContactAtPose(target, pose, timingWindowMs, volume)) { contacts.push(t); break; }
    }
  }
  if (contacts.length === 0) return null;
  contacts.sort((a, b) => a - b);
  const first = contacts[0];
  return Object.freeze({ firstContactMs: first, hitDepthHalf: /** @type {HitDepthHalf} */ (first < center ? "front" : "back") });
}

/**
 * Resolve the interpolated pose at song time t for an ascending pose history.
 * t outside the history range clamps to the nearest stored pose.
 *
 * @param {ReadonlyArray<Readonly<{t:number, pose: ResolvedPose}>>} history
 * @param {number} t
 * @returns {ResolvedPose}
 */
function resolvePoseAt(history, t) {
  if (t <= history[0].t) return history[0].pose;
  for (let index = 0; index < history.length - 1; index += 1) {
    const from = history[index]; const to = history[index + 1];
    if (t <= to.t) {
      if (to.t <= from.t) return to.pose;
      return lerpResolvedEquipmentPose(from.pose, to.pose, (t - from.t) / (to.t - from.t));
    }
  }
  return history[history.length - 1].pose;
}
