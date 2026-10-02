// @ts-check

import { colliderSettingsDefaults, isPointInsideColliderBounds, resolveColliderBounds, resolveGloveObb, resolveSaberCapsule, equipmentEulerDegreesToQuaternion, multiplyEquipmentQuaternions, slerpEquipmentQuaternionShortest } from "@aerobeat/web-contracts";
import { flowNoteCellBox } from "./flow-collider-collision.js";

/** @typedef {Readonly<Record<string, unknown>>} DataRecord */
/** @typedef {Readonly<{x:number,y:number}>} Point2 */

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

/**
 * Flow saber magnetic-rotation assist — the AUTHORITATIVE blend shared by the
 * gameplay collision path and the renderer. The canonical saber extends along
 * pose-local +X; authoritative Flow directions map to XY headings (radians) in
 * the same judge/presentation X-Y plane. The world-Z correction aligns the
 * blade with that heading.
 * @type {Readonly<Record<string, number>>}
 */
export const magneticDirectionHeadingRad = Object.freeze({
  up: Math.PI / 2,
  "up-right": Math.PI / 4,
  right: 0,
  "down-right": -Math.PI / 4,
  down: -Math.PI / 2,
  "down-left": -Math.PI * 3 / 4,
  left: Math.PI,
  "up-left": Math.PI * 3 / 4
});

/** Bounded per-field ceiling for magnetic-attraction settings (0-2 range WU, 0-1 strengths/bias). */
export const magneticAttractionSettingBounds = Object.freeze({ range: 2, minStrength: 1, maxStrength: 1, backFaceBias: 1 });

/**
 * Exact, validated magnetic-attraction settings. `undefined` (absent) returns
 * `null` = assist disabled; `null`/invalid shapes throw. Omission of the field
 * is the only way to leave the pose untouched.
 * @param {unknown} value
 * @returns {Readonly<{range:number,minStrength:number,maxStrength:number,backFaceBias:number}>|null}
 */
export function normalizeMagneticAttractionSettings(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError("Magnetic attraction settings are invalid");
  if (Reflect.ownKeys(value).length !== 4) throw new TypeError("Magnetic attraction settings are invalid");
  /** @type {Record<string, number>} */ const normalized = {};
  for (const [key, max] of Object.entries(magneticAttractionSettingBounds)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const entry = descriptor?.value;
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value") || typeof entry !== "number" || !Number.isFinite(entry) || entry < 0 || entry > max) throw new TypeError("Magnetic attraction settings are invalid");
    normalized[key] = entry;
  }
  return Object.freeze({ range: normalized.range, minStrength: normalized.minStrength, maxStrength: normalized.maxStrength, backFaceBias: normalized.backFaceBias });
}

/**
 * Compute the AUTHORITATIVE magnetic-assisted orientation for a flow saber pose
 * without modifying the shared collision pose. The strongest weighted same-hand
 * directional target within range is chosen deterministically; other beats never
 * combine into a roll tug-of-war. Back-face means the half-space behind the saber
 * tip (negative projection onto its local +X blade axis). At the range edge the
 * per-frame nudge is minStrength; at the beat center it is maxStrength (or
 * minStrength when the user sets max below min).
 *
 * ROTATIONAL ONLY: the returned value is a quaternion; the pose anchor (and
 * therefore the saber position) is never translated.
 *
 * @param {import("@aerobeat/web-contracts/equipment-pose-contracts").AeroResolvedEquipmentPose} pose
 * @param {number} nowMs Current song time in ms.
 * @param {readonly Readonly<{hand:"left"|"right",direction:string,x:number,y:number,z:number,id:string}>} targets
 *   Same-space directional targets: each entry carries a hand, an authored
 *   direction name, its world X/Y (judge space) and Z (approach depth), and a
 *   stable id. Entries already resolved (hit/miss) must be pre-filtered out.
 * @param {Readonly<{range:number,minStrength:number,maxStrength:number,backFaceBias:number}>|null} settings
 * @returns {Readonly<{x:number,y:number,z:number,w:number}>} The assisted orientation (equals `pose.orientation` when no assist applies).
 */
export function magneticSaberOrientation(pose, nowMs, targets, settings) {
  if (pose.mode !== "flow" || !settings || settings.range === 0) return pose.orientation;
  const hand = pose.role === "left_wrist" ? "left" : "right";
  const origin = { x: pose.anchor.x, y: pose.anchor.y };
  const axisX = 1 - 2 * (pose.orientation.y ** 2 + pose.orientation.z ** 2);
  const axisY = 2 * (pose.orientation.x * pose.orientation.y + pose.orientation.w * pose.orientation.z);
  /** @type {{target: Readonly<{id:string,direction:string}>, weight:number}|null} */ let strongest = null;
  for (const target of targets) {
    if (target.hand !== hand) continue;
    if (target.judgement === "hit" || target.judgement === "miss") continue;
    const heading = magneticDirectionHeadingRad[target.direction];
    if (heading === undefined) continue;
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const dz = target.z - pose.anchor.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > settings.range) continue;
    const proximity = 1 - distance / settings.range;
    const backFaceWeight = distance === 0 ? 0 : Math.max(0, -(dx * axisX + dy * axisY) / distance);
    const strength = settings.minStrength + (Math.max(settings.minStrength, settings.maxStrength) - settings.minStrength) * proximity;
    const weight = Math.min(1, strength * (1 + settings.backFaceBias * backFaceWeight));
    if (weight > 0 && (!strongest || weight > strongest.weight || weight === strongest.weight && target.id < strongest.target.id)) strongest = { target, weight };
  }
  if (!strongest) return pose.orientation;
  const heading = magneticDirectionHeadingRad[strongest.target.direction];
  // World-Z adjustment preserves the wrist's own XYZ tilt rather than flattening it.
  const currentHeading = Math.atan2(axisY, axisX);
  // 0.0.86 (Derrick): an ARROWED beat is hittable anywhere inside a cone whose
  // axis is the authored direction, not only when the blade points exactly at the
  // beat. A plain slerp toward the heading rotates just `weight` of the way, so at
  // low/mid strength the blade can still sit OUTSIDE that cone: it looks assisted
  // and changes nothing for gameplay. Compute the weight at which the blade first
  // enters the cone and never use less than that, so the assist always actually
  // arcs into the hit zone; proximity still decides whether it goes further and
  // fully aligns. Directionless beats have no authored heading and are not steered.
  const coneLimitRad = (settings.coneToleranceDegrees ?? 45) * Math.PI / 180;
  // atan2 wraps at ±π; always steer across the shorter arc at that seam.
  const headingDelta = Math.atan2(Math.sin(heading - currentHeading), Math.cos(heading - currentHeading));
  const needed = Math.abs(headingDelta);
  const coneEntryWeight = needed <= coneLimitRad ? 0 : Math.max(0, 1 - coneLimitRad / needed);
  const effectiveWeight = Math.min(1, Math.max(strongest.weight, coneEntryWeight));
  const correction = equipmentEulerDegreesToQuaternion({ x: 0, y: 0, z: headingDelta * 180 / Math.PI });
  const goal = multiplyEquipmentQuaternions(correction, pose.orientation);
  return slerpEquipmentQuaternionShortest(pose.orientation, goal, effectiveWeight);
}
