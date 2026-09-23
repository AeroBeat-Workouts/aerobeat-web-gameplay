// @ts-check

import { resolveGloveObb, resolveSaberCapsule } from "@aerobeat/web-contracts";
import { flowNoteCellBox } from "./flow-collider-collision.js";

/** @typedef {Readonly<Record<string, unknown>>} DataRecord */
/** @typedef {Readonly<{x:number,y:number}>} Point2 */

/** Settled contracts revision whose resolved-pose semantics this judge consumes. */
export const equipmentPoseContractsCommit = "51c2b42805f5aa008386dc8bc779cfad8542af34";
/** Tight XY agreement required between a resolved pose anchor and measured wrist. */
export const equipmentPoseAnchorEpsilonWu = 1e-6;

/**
 * Test a contract-resolved 3D saber capsule after exact projection into judge XY.
 * Local-axis roll leaves the projection unchanged; out-of-plane tilt shortens it.
 * @param {DataRecord} event
 * @param {unknown} pose
 * @param {number} songTimeMs
 * @param {number} timingWindowMs
 */
export function resolvedSaberCapsuleContactsFlowTarget(event, pose, songTimeMs, timingWindowMs) {
  if (!insideTimingWindow(event, songTimeMs, timingWindowMs)) return false;
  const capsule = resolveSaberCapsule(pose);
  const box = flowNoteCellBox(event);
  return segmentContactsRectangle(
    Object.freeze({ x: capsule.start.x, y: capsule.start.y }),
    Object.freeze({ x: capsule.end.x, y: capsule.end.y }),
    Object.freeze({ minX: box.centerX - box.halfX, maxX: box.centerX + box.halfX, minY: box.centerY - box.halfY, maxY: box.centerY + box.halfY }),
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
 */
export function resolvedGloveObbContactsBoxingTarget(target, pose, songTimeMs, timingWindowMs) {
  if (songTimeMs < target.centerTimestampMs - timingWindowMs || songTimeMs > target.centerTimestampMs + timingWindowMs) return false;
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
    Object.freeze({ x: target.x - 0.5, y: target.y - 0.5 }),
    Object.freeze({ x: target.x + 0.5, y: target.y - 0.5 }),
    Object.freeze({ x: target.x + 0.5, y: target.y + 0.5 }),
    Object.freeze({ x: target.x - 0.5, y: target.y + 0.5 })
  ]);
  return convexPolygonsContact(hull, rectangle);
}

/** @param {DataRecord} event @param {number} songTimeMs @param {number} timingWindowMs */
function insideTimingWindow(event, songTimeMs, timingWindowMs) {
  const center = Number(event.centerTimestampMs);
  return songTimeMs >= center - timingWindowMs && songTimeMs <= center + timingWindowMs;
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
