// @ts-check

import { colliderSettingsDefaults, isPointInsideColliderBounds, resolveColliderBounds, resolveGloveColliderParts, resolveSaberColliderParts, equipmentEulerDegreesToQuaternion, multiplyEquipmentQuaternions, slerpEquipmentQuaternionShortest, createResolvedEquipmentPose } from "@aerobeat/web-contracts";
import { authoredDirectionCone, flowNoteCellBox } from "./flow-collider-collision.js";

/** @typedef {Readonly<Record<string, unknown>>} DataRecord */
/** @typedef {Readonly<{x:number,y:number}>} Point2 */
/** @typedef {import("@aerobeat/web-contracts").AeroResolvedEquipmentPose} ResolvedPose */
/** @typedef {"front" | "back"} HitDepthHalf */
/** @typedef {(pose: ResolvedPose, context: Readonly<{timestampMs:number,tangent:Readonly<{x:number,y:number,z:number}>}>) => ResolvedPose} ReprojectEquipmentPose */

/** Settled contracts revision whose resolved-pose semantics this judge consumes. */
export const equipmentPoseContractsCommit = "a1c1fbc2a51bdc2eb0c63dc3a2b46ae2dd4f2296";
/** Tight XY agreement required between a resolved pose anchor and measured wrist. */
export const equipmentPoseAnchorEpsilonWu = 1e-6;

/**
 * A beat approaches from future -Z, crosses the equipment judge plane at its
 * center timestamp, then exits through the past +Z face. Contracts owns the
 * world-Z volume: offset milliseconds multiplied by 0.006 world units/ms.
 * Flow note timing uses the independent base window regardless of saber reach.
 * Inclusive faces remain hittable; only strict back-face crossing misses.
 * @param {number} centerTimestampMs
 * @param {number} songTimeMs
 * @param {number} timingWindowMs
 */
export function beatInsideColliderDepth(centerTimestampMs, songTimeMs, timingWindowMs) {
  const bounds = resolveColliderBounds({ mode: "flow", center: { x: 0, y: 0, z: 0 }, halfWidth: 1, halfHeight: 1, settings: colliderSettingsDefaults.flow, timingWindowMs, speedWuPerMs: 0.006 });
  return isPointInsideColliderBounds({ x: 0, y: 0, z: (songTimeMs - centerTimestampMs) * 0.006 }, bounds);
}

/** @param {number} centerTimestampMs @param {number} timingWindowMs @param {number} [depthBackward] Boxing-only timing factor; Flow calls without it. */
export function colliderBackFaceTimestampMs(centerTimestampMs, timingWindowMs, depthBackward = 1) {
  return centerTimestampMs + timingWindowMs * depthBackward;
}

/**
 * Play-only note deadline: the complete pinned note must pass the
 * canonical athlete camera (Z=5, pitched down 5 degrees) before a full miss.
 * At 0.006 WU/ms, +1000ms places its center at Z=6, conservatively past
 * the pinned shape's -0.15 Z extent at maximum 2x scale. Flow saber reach
 * does not change its note deadline; Boxing retains its depth timing factor.
 * This is not a public collider bound;
 * bombs, guards, and checkpoints retain their original windows.
 * @param {number} centerTimestampMs
 * @param {number} timingWindowMs
 * @param {number} [depthBackward] Boxing-only timing factor; Flow omits it.
 */
export function effectivePlayNoteAfterWindowMs(centerTimestampMs, timingWindowMs, depthBackward = 1) {
  return Math.max(colliderBackFaceTimestampMs(centerTimestampMs, timingWindowMs, depthBackward), centerTimestampMs + 1000);
}

/**
 * Test the pose-axis Flow saber reach after projection into judge XY.
 * Local-axis roll leaves projection unchanged; out-of-plane tilt shortens it.
 * @param {DataRecord} event
 * @param {unknown} pose
 * @param {number} songTimeMs
 * @param {number} timingWindowMs
 * @param {{scale?:number,depthForward?:number,depthBackward?:number,depthBackwardAthleteFacing?:boolean}} [volume]
 */
export function resolvedSaberCapsuleContactsFlowTarget(event, pose, songTimeMs, timingWindowMs, volume = {}) {
  const box = flowNoteCellBox(event);
  const bounds = resolveTargetColliderBounds("flow", { x: box.centerX, y: box.centerY }, { x: box.halfX, y: box.halfY }, timingWindowMs);
  if (!isPointInsideColliderBounds({ x: box.centerX, y: box.centerY, z: (songTimeMs - Number(event.centerTimestampMs)) * 0.006 }, bounds)) return false;
  const parts = resolveSaberColliderParts(pose, volume);
  if (volume.scale === 0) return false;
  return parts.some((capsule) => segmentContactsRectangle(capsule.start, capsule.end, bounds, capsule.radius));
}

/**
 * Intersect the flat-ended rotating 3D glove cylinder with the authored note
 * rectangle at its moving Z. Timing eligibility is independent of cylinder depth.
 * @param {Readonly<{centerTimestampMs:number,x:number,y:number}>} target
 * @param {unknown} pose
 * @param {number} songTimeMs
 * @param {number} timingWindowMs
 * @param {{scale?:number,depthForward?:number,depthBackward?:number,depthBackwardAthleteFacing?:boolean}} [volume]
 */
export function resolvedGloveObbContactsBoxingTarget(target, pose, songTimeMs, timingWindowMs, volume = {}) {
  if (volume.scale === 0) return false;
  return boxingContactAtEligibleTime(target, pose, songTimeMs, timingWindowMs, volume, null);
}

/** Play's later visibility deadline extends only eligibility, never glove depth. */
function boxingContactAtEligibleTime(target, pose, songTimeMs, timingWindowMs, volume, afterWindowMs) {
  if (songTimeMs < target.centerTimestampMs - timingWindowMs || songTimeMs > (afterWindowMs ?? target.centerTimestampMs + timingWindowMs)) return false;
  const parts = resolveGloveColliderParts(pose, volume);
  const z = (songTimeMs - target.centerTimestampMs) * 0.006;
  if (!Number.isFinite(z)) throw new TypeError("boxing_target_geometry_nonfinite");
  return parts.some((cylinder) => cylinderContactsNoteRectangle(cylinder, target, z));
}

/**
 * Intersect a flat-capped cylinder with the note's zero-thickness XY rectangle
 * at song Z. Its exact solid test separates the axial cap interval from the
 * perpendicular radius, so an axis-distance capsule cannot extend the caps.
 * The clipped axis projection, authored rectangle corners and edges supply
 * witnesses even when the cylinder is pitched or rolls in the note plane.
 * @param {import("@aerobeat/web-contracts").AeroEquipmentColliderPart} cylinder
 * @param {Readonly<{x:number,y:number}>} target
 * @param {number} z
 */
function cylinderContactsNoteRectangle(cylinder, target, z) {
  const dx = cylinder.end.x - cylinder.start.x;
  const dy = cylinder.end.y - cylinder.start.y;
  const dz = cylinder.end.z - cylinder.start.z;
  const length = Math.hypot(dx, dy, dz);
  const radius = cylinder.radius;
  const minX = target.x - 0.5; const maxX = target.x + 0.5;
  const minY = target.y - 0.5; const maxY = target.y + 0.5;
  if (![minX, maxX, minY, maxY, z, length, radius, radius * radius].every(Number.isFinite)) throw new TypeError("boxing_target_geometry_nonfinite");
  const axis = cylinder.axis;
  // For each XY point on the target plane, compute its axial coordinate
  // relative to the back cap. The caps bound that coordinate, while the
  // perpendicular distance from the axis must be at most the cylinder radius.
  const pointInside = (x, y) => {
    const vx = x - cylinder.start.x; const vy = y - cylinder.start.y; const vz = z - cylinder.start.z;
    const axial = vx * axis.x + vy * axis.y + vz * axis.z;
    const radialSquared = vx * vx + vy * vy + vz * vz - axial * axial;
    if (![vx, vy, vz, axial, radialSquared].every(Number.isFinite)) throw new TypeError("boxing_target_geometry_nonfinite");
    return axial >= -Number.EPSILON && axial <= length + Number.EPSILON && radialSquared <= radius * radius + Number.EPSILON;
  };
  // For a convex cylinder, intersection with a rectangle in one plane is
  // witnessed by its nearest XY point to the axis at a permitted axial range,
  // or by the target edge/corner where a cap/rim first enters the rectangle.
  const at = (x, y) => pointInside(Math.max(minX, Math.min(maxX, x)), Math.max(minY, Math.min(maxY, y)));
  for (const candidate of [cylinder.start, cylinder.end]) if (at(candidate.x, candidate.y)) return true;
  // With a tilted axis, the plane's closest point on the axis is a separate
  // interior witness: both projected endpoints can lie beyond opposite edges.
  if (dz !== 0) {
    const crossing = (z - cylinder.start.z) / dz;
    if (crossing >= 0 && crossing <= 1 && at(cylinder.start.x + dx * crossing, cylinder.start.y + dy * crossing)) return true;
  }
  for (const x of [minX, maxX]) for (const y of [minY, maxY]) if (pointInside(x, y)) return true;
  const intersectEdge = (fixed, low, high, vertical) => {
    let left = low; let right = high;
    const projection = (value) => vertical ? (fixed - cylinder.start.x) * axis.x + (value - cylinder.start.y) * axis.y + (z - cylinder.start.z) * axis.z : (value - cylinder.start.x) * axis.x + (fixed - cylinder.start.y) * axis.y + (z - cylinder.start.z) * axis.z;
    for (const cap of [0, length]) {
      const slope = vertical ? axis.y : axis.x;
      if (slope !== 0) {
        const crossing = low + (cap - projection(low)) / slope;
        if (crossing >= low && crossing <= high && (vertical ? pointInside(fixed, crossing) : pointInside(crossing, fixed))) return true;
      }
    }
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const a = left + (right - left) / 3; const b = right - (right - left) / 3;
      const radial = (value) => {
        const x = vertical ? fixed : value; const y = vertical ? value : fixed;
        const vx = x - cylinder.start.x; const vy = y - cylinder.start.y; const vz = z - cylinder.start.z;
        const axial = projection(value);
        return vx * vx + vy * vy + vz * vz - axial * axial;
      };
      if (radial(a) <= radial(b)) right = b; else left = a;
    }
    return vertical ? pointInside(fixed, (left + right) / 2) : pointInside((left + right) / 2, fixed);
  };
  return intersectEdge(minX, minY, maxY, true) || intersectEdge(maxX, minY, maxY, true) || intersectEdge(minY, minX, maxX, false) || intersectEdge(maxY, minX, maxX, false);
}

/**
 * Use the shared contracts bounds for timing and the fixed base note cell in
 * Flow; its saber controls only resize the blade, never the target or slab.
 * Boxer scoring uses its own fixed authored target and shared cylinder.
 * @param {"flow"} mode
 * @param {Point2} center
 * @param {Point2} halfSize
 * @param {number} timingWindowMs
 */
function resolveTargetColliderBounds(mode, center, halfSize, timingWindowMs) {
  return resolveColliderBounds({ mode, center: { x: center.x, y: center.y, z: 0 }, halfWidth: halfSize.x, halfHeight: halfSize.y, settings: colliderSettingsDefaults[mode], timingWindowMs, speedWuPerMs: 0.006 });
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

/* ------------------------------------------------------------------------
 * Swept (time-based) hit test
 *
 * A hit is no longer a single snapshot in time: the equipment is swept
 * through every song-time inside the beat's timing window
 * `[center - window, afterWindowMs ?? center + window]` and the
 * beat's XY cell box is tested at each sampled and interpolated pose. The
 * Flow note timing is independent of reach: a beat's Z is
 * `(t - center) * 0.006` inside the base timing slab.
 * Because the test integrates over the whole window, a late hit that the
 * old single-snapshot test tunnels through (sparse low-FPS samples that jump
 * from before the window to after it) is caught by the interpolation across
 * the gap. Results are deterministic in the pose history alone: identical
 * histories produce identical hits at any camera update rate.
 * ------------------------------------------------------------------------ */

/**
 * Frame-rate-independent margin kept beyond the deepest possible window
 * (300 ms max window × 4 max depth factor) so a bounded pose history always
 * covers recent swept ranges. A retained predecessor brackets sparse gaps;
 * unbounded depth settings do not imply unlimited retained history.
 */
export const sweptPoseHistoryMarginMs = 200;

/**
 * Retain a bounded, ascending per-role resolved-pose history.
 *
 * Entries are stamped with the song position the pose was MEASURED at, not the
 * playhead that happened to consume it. A slow pipeline therefore delays when a
 * pose enters the history instead of shifting it forward on the timeline, so
 * the swept judge keeps testing the swing against the beats it actually passed.
 * A timestamp that is already present replaces its pose (idempotent republish),
 * and an out-of-order entry is inserted in its correct place rather than
 * discarding the neighbours.
 *
 * @param {ReadonlyArray<Readonly<{t:number, pose: ResolvedPose}>>} history
 * @param {ResolvedPose | null} pose
 * @param {number} timestampMs The measurement song time for this entry.
 * @param {number} trimMs Total trim window (deepest legal window + margin).
 * @returns {ReadonlyArray<Readonly<{t:number, pose: ResolvedPose}>>}
 */
export function pushPoseHistory(history, pose, timestampMs, trimMs) {
  if (pose === null) return Object.freeze([]);
  if (!Number.isFinite(timestampMs)) return history;
  const entry = () => Object.freeze({ t: timestampMs, pose });
  const kept = [];
  let inserted = false;
  for (const candidate of history) {
    if (candidate.t === timestampMs) { kept.push(entry()); inserted = true; continue; }
    if (!inserted && candidate.t > timestampMs) { kept.push(entry()); inserted = true; }
    kept.push(candidate);
  }
  if (!inserted) kept.push(entry());
  const cutoff = kept[kept.length - 1].t - trimMs;
  // Keep one predecessor at/before the cutoff to bracket sparse segments.
  // Null/reset boundaries still clear the entire history, including this point.
  const firstInside = kept.findIndex((candidate) => candidate.t > cutoff);
  return Object.freeze(kept.slice(Math.max(0, (firstInside < 0 ? kept.length : firstInside) - 1)));
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

/** @param {Readonly<{centerX:number,centerY:number,halfX:number,halfY:number}>} box @param {unknown} pose @param {{scale?:number,depthForward?:number,depthBackward?:number,depthBackwardAthleteFacing?:boolean}} volume @param {number} timingWindowMs */
function flowSweptContactAtPose(box, pose, volume, timingWindowMs) {
  const bounds = resolveTargetColliderBounds("flow", { x: box.centerX, y: box.centerY }, { x: box.halfX, y: box.halfY }, timingWindowMs);
  const parts = resolveSaberColliderParts(pose, volume);
  if (volume.scale === 0) return false;
  return parts.some((capsule) => segmentContactsRectangle(capsule.start, capsule.end, bounds, capsule.radius));
}

/**
 * Swept hit test for one beat against a bounded ascending resolved-pose
 * history (`{t, pose}` entries, measurement timestamps in ms).
 *
 * Samples the equipment at every stored pose inside the beat's timing
 * window AND reconstructs bounded spline anchors with optional equipment
 * reprojection between consecutive stored poses, so sparse histories catch a
 * crossing that the old single-snapshot test tunnels through. Returns the
 * EARLIEST contact time and its diagnostic temporal half — `front` for
 * `t < center`, `back` for `t >= center` — or `null` when never contacted.
 * Flow scores either real contact as Great; Boxing grading is independent.
 *
 * @param {DataRecord} event
 * @param {ReadonlyArray<Readonly<{t:number, pose: ResolvedPose}>>} history
 * @param {number} timingWindowMs
 * @param {{scale?:number,depthForward?:number,depthBackward?:number,depthBackwardAthleteFacing?:boolean}} volume
 * @param {number | null} [afterWindowMs] Play note deadline; null uses the base window.
 * @param {ReprojectEquipmentPose} [reprojectEquipmentPose]
 */
export function sweptSaberContactsFlowTarget(event, history, timingWindowMs, volume = {}, afterWindowMs = null, reprojectEquipmentPose) {
  if (history.length === 0) return null;
  const box = flowNoteCellBox(event);
  const center = Number(event.centerTimestampMs);
  const windowStart = center - timingWindowMs;
  const windowEnd = afterWindowMs ?? center + timingWindowMs;
  for (const t of overlapSampleTimes(history, windowStart, windowEnd, center)) {
    const pose = resolvePoseAt(history, t, reprojectEquipmentPose);
    if (flowSweptContactAtPose(box, pose, volume, timingWindowMs)) return Object.freeze({ firstContactMs: t, hitDepthHalf: /** @type {HitDepthHalf} */ (t < center ? "front" : "back") });
  }
  // No contact: check for a near-miss. The saber must have been within a
  // tight margin of the cell box at some time inside the 1/4-beat sub-window
  // around the beat center. This captures "close but not quite" — the hand
  // was in the correct cell area with good timing but the capsule didn't
  // touch. The independent 0.25-WU near margin forms a band around the
  // scored Scale1 solid blade radius (.024 WU); at large scales actual hits
  // still take priority. Crossing the cell's general area during a sweep does
  // not qualify — only being close to the cell edge at the right time does.
  const quarterWindow = timingWindowMs * 0.25;
  const nearStart = center - quarterWindow;
  const nearEnd = center + quarterWindow;
  const nearMargin = 0.25;
  let firstNearMs = null;
  for (const t of overlapSampleTimes(history, nearStart, nearEnd, center)) {
    const pose = resolvePoseAt(history, t, reprojectEquipmentPose);
    const parts = resolveSaberColliderParts(pose, volume);
    if (volume.scale !== 0 && parts.some((capsule) => saberNearCell(capsule, box, nearMargin))) { firstNearMs = t; break; }
  }
  if (firstNearMs !== null) return Object.freeze({ nearMiss: true, firstNearMs });
  return null;
}

/**
 * INTERNAL presentation hint, not judgement or snapshot authority. Call only
 * with the exact successful swept result for this event/history/window; a
 * near-miss, absent result, or non-finite contact time has no slice. The judge
 * tests the reach-adjusted, XY-projected capsule against a cell rectangle
 * inside the independent note-timing slab, NOT a continuous 3D solid collision.
 * Resolve the full 3D pose at the first sampled contact time, then choose the
 * point on its projected blade
 * axis closest to the cell center among axis points within one capsule radius
 * of the rectangle. Ties choose the smaller axis parameter (start before end).
 * This point is a deterministic locus of the projected overlap, not a physical
 * 3D intersection point. Normalize its projection onto the authored arrow axis
 * across the cell's projected extent; right/up increase toward the tip, and
 * diagonal glyphs use both cell dimensions. Directionless orbs use 0.5.
 * Clamp to [0.15, 0.85] to avoid slicing exactly at glyph edges.
 *
 * @param {DataRecord} event
 * @param {ReadonlyArray<Readonly<{t:number, pose: ResolvedPose}>>} history
 * @param {number} timingWindowMs
 * @param {{scale?:number,depthForward?:number,depthBackward?:number,depthBackwardAthleteFacing?:boolean}} volume
 * @param {Readonly<{firstContactMs:number,hitDepthHalf:HitDepthHalf}> | null} contact Exact swept hit (not near-miss).
 * @param {number | null} [afterWindowMs]
 * @param {ReprojectEquipmentPose} [reprojectEquipmentPose]
 * @returns {number | null}
 */
export function internalFlowFirstContactSliceT(event, history, timingWindowMs, volume, contact, afterWindowMs = null, reprojectEquipmentPose) {
  const t = contact?.firstContactMs;
  if (!Number.isFinite(t) || !history.length || contact?.hitDepthHalf !== (t < Number(event.centerTimestampMs) ? "front" : "back")) return null;
  const box = flowNoteCellBox(event);
  const center = Number(event.centerTimestampMs);
  if (t < center - timingWindowMs || t > (afterWindowMs ?? center + timingWindowMs)) return null;
  const bounds = resolveTargetColliderBounds("flow", { x: box.centerX, y: box.centerY }, { x: box.halfX, y: box.halfY }, timingWindowMs);
  const capsule = resolveSaberColliderParts(resolvePoseAt(history, t, reprojectEquipmentPose), volume).find((part) => segmentContactsRectangle(part.start, part.end, bounds, part.radius));
  if (volume.scale === 0 || !capsule) return null;
  const start = capsule.start; const end = capsule.end;
  const direction = event.direction == null ? null : authoredDirectionCone(String(event.direction), 0)?.direction;
  if (!direction) return event.direction == null ? 0.5 : null;
  // Distance to an axis point is convex along the segment. Ternary search its
  // minimum, then binary-search the two radius crossings. The candidate nearest
  // the cell center inside that interval is deterministic even for edge grazes.
  const at = (p) => ({ x: start.x + (end.x - start.x) * p, y: start.y + (end.y - start.y) * p });
  const distance = (p) => pointRectangleDistance(at(p), bounds);
  let low = 0; let high = 1;
  for (let i = 0; i < 64; i += 1) { const a = low + (high - low) / 3; const b = high - (high - low) / 3; if (distance(a) <= distance(b)) high = b; else low = a; }
  const minimum = (low + high) / 2;
  if (distance(minimum) > capsule.radius + Number.EPSILON) return null;
  let first = 0; let last = minimum;
  if (distance(first) > capsule.radius + Number.EPSILON) for (let i = 0; i < 64; i += 1) { const mid = (first + last) / 2; if (distance(mid) <= capsule.radius + Number.EPSILON) last = mid; else first = mid; }
  const entry = distance(0) <= capsule.radius + Number.EPSILON ? 0 : last;
  first = minimum; last = 1;
  if (distance(last) > capsule.radius + Number.EPSILON) for (let i = 0; i < 64; i += 1) { const mid = (first + last) / 2; if (distance(mid) <= capsule.radius + Number.EPSILON) first = mid; else last = mid; }
  const exit = distance(1) <= capsule.radius + Number.EPSILON ? 1 : first;
  const dx = end.x - start.x; const dy = end.y - start.y;
  const centerParameter = dx * dx + dy * dy === 0 ? 0 : ((bounds.minX + bounds.maxX) / 2 - start.x) * dx / (dx * dx + dy * dy) + ((bounds.minY + bounds.maxY) / 2 - start.y) * dy / (dx * dx + dy * dy);
  const locus = at(Math.max(entry, Math.min(exit, centerParameter)));
  const halfExtent = (bounds.maxX - bounds.minX) * Math.abs(direction.x) / 2 + (bounds.maxY - bounds.minY) * Math.abs(direction.y) / 2;
  const projection = ((locus.x - box.centerX) * direction.x + (locus.y - box.centerY) * direction.y) / (2 * halfExtent);
  const sliceT = Math.max(0.15, Math.min(0.85, 0.5 + projection));
  return Number.isFinite(sliceT) ? sliceT : null;
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
 * {@link sweptSaberContactsFlowTarget}; the exact rotated 3D glove cylinder
 * is tested against the moving note rectangle at every sampled time.
 *
 * @param {Readonly<{centerTimestampMs:number,x:number,y:number}>} target
 * @param {ReadonlyArray<Readonly<{t:number, pose: ResolvedPose}>>} history
 * @param {number} timingWindowMs
 * @param {{scale?:number,depthForward?:number,depthBackward?:number,depthBackwardAthleteFacing?:boolean}} volume
 * @param {number | null} [afterWindowMs] Play note deadline; null uses the base window.
 * @param {ReprojectEquipmentPose} [reprojectEquipmentPose]
 */
export function sweptGloveObbContactsBoxingTarget(target, history, timingWindowMs, volume = {}, afterWindowMs = null, reprojectEquipmentPose) {
  if (volume.scale === 0 || history.length === 0) return null;
  const center = Number(target.centerTimestampMs);
  const windowStart = center - timingWindowMs;
  const windowEnd = afterWindowMs ?? center + timingWindowMs;
  for (const t of overlapSampleTimes(history, windowStart, windowEnd, center)) {
    const pose = resolvePoseAt(history, t, reprojectEquipmentPose);
    if (boxingContactAtEligibleTime(target, pose, t, timingWindowMs, volume, afterWindowMs)) return Object.freeze({ firstContactMs: t, hitDepthHalf: /** @type {HitDepthHalf} */ (t < center ? "front" : "back") });
  }
  return null;
}

/**
 * Resolve the interpolated pose at song time t for an ascending pose history.
 * t outside the history range clamps to the nearest stored pose.
 *
 * @param {ReadonlyArray<Readonly<{t:number, pose: ResolvedPose}>>} history
 * @param {number} t
 * @param {ReprojectEquipmentPose} [reprojectEquipmentPose]
 * @returns {ResolvedPose}
 */
export function resolvePoseAt(history, t, reprojectEquipmentPose) {
  if (t <= history[0].t) return history[0].pose;
  for (let index = 0; index < history.length - 1; index += 1) {
    const from = history[index]; const to = history[index + 1];
    if (t <= to.t) {
      if (t === to.t || to.t <= from.t) return to.pose;
      const duration = to.t - from.t;
      const p = (t - from.t) / duration;
      const previous = history[index - 1];
      const anchor = { x: 0, y: 0, z: 0 }; const tangent = { x: 0, y: 0, z: 0 };
      for (const axis of /** @type {const} */ (["x", "y", "z"])) {
        const delta = to.pose.anchor[axis] - from.pose.anchor[axis];
        const secant = delta / duration;
        const prior = previous && previous.t < from.t ? (from.pose.anchor[axis] - previous.pose.anchor[axis]) / (from.t - previous.t) : secant;
        // Causal Hermite: the previous/current secants estimate the starting
        // velocity; the ending velocity is the current secant. Per-axis slopes
        // are sign-preserving and capped at 3x the current secant. Together
        // with end slope 1x this keeps each coordinate between its endpoints.
        // Equal endpoints stay fixed, even after movement. No future pose is
        // used, and a two-point history is exactly linear.
        const startSlope = secant === 0 ? 0 : Math.max(0, Math.min(3, (prior / secant + 1) / 2));
        const m0 = delta * startSlope; const m1 = delta;
        anchor[axis] = (2*p*p*p - 3*p*p + 1) * from.pose.anchor[axis] + (p*p*p - 2*p*p + p) * m0 + (-2*p*p*p + 3*p*p) * to.pose.anchor[axis] + (p*p*p - p*p) * m1;
        tangent[axis] = ((6*p*p - 6*p) * from.pose.anchor[axis] + (3*p*p - 4*p + 1) * m0 + (-6*p*p + 6*p) * to.pose.anchor[axis] + (3*p*p - 2*p) * m1) / duration;
      }
      const interpolated = lerpResolvedEquipmentPose(from.pose, to.pose, p);
      const reconstructed = createResolvedEquipmentPose({ ...interpolated, anchor });
      return reprojectEquipmentPose ? createResolvedEquipmentPose(reprojectEquipmentPose(reconstructed, Object.freeze({ timestampMs: t, tangent: Object.freeze(tangent) }))) : reconstructed;
    }
  }
  return history[history.length - 1].pose;
}

/**
 * Sample each segment's overlap, not its full-gap lattice. Endpoints and beat
 * center are explicit probes, so even a very narrow eligible slab is tested.
 * At most 24 subdivisions per overlapping segment; no extrapolation beyond
 * measured history. This is bounded approximation, not an analytic guarantee
 * for arbitrarily thin contacts or arbitrary projector functions.
 * @param {ReadonlyArray<Readonly<{t:number,pose:ResolvedPose}>>} history
 * @param {number} start
 * @param {number} end
 * @param {number} center
 */
function overlapSampleTimes(history, start, end, center) {
  const times = new Set();
  for (const entry of history) if (entry.t >= start && entry.t <= end) times.add(entry.t);
  for (let index = 0; index < history.length - 1; index += 1) {
    const low = Math.max(start, history[index].t); const high = Math.min(end, history[index + 1].t);
    if (low > high || history[index + 1].t <= history[index].t) continue;
    for (let step = 0; step <= 24; step += 1) times.add(low + (high - low) * step / 24);
    if (center >= low && center <= high) times.add(center);
  }
  return [...times].sort((a, b) => a - b);
}
