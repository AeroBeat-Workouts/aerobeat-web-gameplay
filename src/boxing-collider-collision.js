// @ts-check

import { Sha256 } from "@aerobeat/web-hash";
import {
  aeroGuardCountModes,
  aeroRowReachBounds,
  boxingColliderRowY,
  defaultGuardCountMode,
  isBoxingColliderSetupFields,
  normalizeBoxingColliderSetupFields
} from "@aerobeat/web-contracts";
import {
  defaultFlowColliderSettings,
  flowColliderSettingsBounds,
  isContinuousColliderSegment,
  matchesAuthoredDirection,
  targetCenterForPlacement
} from "./flow-collider-collision.js";

/** @typedef {Readonly<Record<string, unknown>>} DataRecord */
/**
 * The exact collider settings record for boxing_collider_v1. It reuses the
 * Flow Colliders collider profile (radius / authored-direction toggle /
 * tolerance / timing window) and adds the run-gated row-reach fractions and
 * the guard count mode.
 *
 * @typedef {Readonly<{schema:string,version:1,algorithm:"swept_athlete_plane_v1",colliderRadius:number,enforceAuthoredDirection:boolean,directionToleranceDegrees:number,timingWindowMs:number,topRowReachWU:number,bottomRowReachWU:number,guardCountMode:"collision"|"gesture"}>} BoxingColliderSettings
 */
/**
 * Godot guard-gesture port thresholds, mirroring the GUARD_DEFAULT_* names in
 * aerobeat-input-camera-tracking/src/detectors/pose_detector_substrate.gd.
 *
 * @typedef {Readonly<{enabled:boolean,maxWristSeparationX:number,maxWristSeparationY:number,maxWristNoseDistance:number}>} GuardGestureConfig
 */

/** Godot GUARD_DEFAULT_MAX_WRIST_SEPARATION_X. */
export const GUARD_DEFAULT_MAX_WRIST_SEPARATION_X = 0.20;
/** Godot GUARD_DEFAULT_MAX_WRIST_SEPARATION_Y. */
export const GUARD_DEFAULT_MAX_WRIST_SEPARATION_Y = 0.12;
/** Godot GUARD_DEFAULT_MAX_WRIST_NOSE_DISTANCE. */
export const GUARD_DEFAULT_MAX_WRIST_NOSE_DISTANCE = 0.15;
/** Config-hook shape for the guard gesture port; wired from the guard profile config when available. */
export const defaultGuardGestureConfig = Object.freeze({ enabled: true, maxWristSeparationX: GUARD_DEFAULT_MAX_WRIST_SEPARATION_X, maxWristSeparationY: GUARD_DEFAULT_MAX_WRIST_SEPARATION_Y, maxWristNoseDistance: GUARD_DEFAULT_MAX_WRIST_NOSE_DISTANCE });

/** Exact own-keys contract of a normalized reach + guard-mode setup record. */
export const BOXING_COLLIDER_SETUP_KEYS = Object.freeze(["topRowReachWU", "bottomRowReachWU", "guardCountMode"]);
/** Row reach bounds (min/max/default tuples) for the two reach settings. */
export const boxingColliderReachBounds = aeroRowReachBounds;
/** The two guard count modes, from contracts. */
export const boxingGuardCountModes = aeroGuardCountModes;

const SETTING_KEYS = Object.freeze(["schema", "version", "algorithm", "colliderRadius", "enforceAuthoredDirection", "directionToleranceDegrees", "timingWindowMs", "topRowReachWU", "bottomRowReachWU", "guardCountMode"]);

/** Exact default settings: Flow Colliders profile + reach 0.25/0.25 + collision guards. */
export const defaultBoxingColliderSettings = Object.freeze({
  ...defaultFlowColliderSettings,
  topRowReachWU: 0.25,
  bottomRowReachWU: 0.25,
  guardCountMode: "collision"
});

/**
 * Construct one exact immutable Boxing Collider settings record. Omission of
 * reach/guard fields selects the 0.25/0.25 + collision defaults; supplied
 * values must provide every field as own enumerable data with no
 * extras/accessors.
 *
 * @param {unknown} [value]
 * @returns {BoxingColliderSettings}
 */
export function createBoxingColliderSettings(value = defaultBoxingColliderSettings) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new TypeError("Boxing Collider settings must be a plain record");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== SETTING_KEYS.length || keys.some((key) => typeof key !== "string" || !SETTING_KEYS.includes(key))) throw new TypeError("Boxing Collider settings require every exact field and no extras");
  /** @type {Record<string, unknown>} */ const record = {};
  for (const key of SETTING_KEYS) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError("Boxing Collider settings cannot contain accessors or hidden fields"); record[key] = descriptor.value; }
  if (record.schema !== "aerobeat/flow_collider_settings" || record.version !== 1 || record.algorithm !== "swept_athlete_plane_v1" || typeof record.enforceAuthoredDirection !== "boolean") throw new TypeError("Boxing Collider settings require the exact v1 algorithm contract");
  const setup = normalizeReachAndGuardMode({ topRowReachWU: record.topRowReachWU, bottomRowReachWU: record.bottomRowReachWU, guardCountMode: record.guardCountMode });
  const colliderRadius = boundedSetting(record.colliderRadius, flowColliderSettingsBounds.colliderRadius, "collider radius");
  const directionToleranceDegrees = boundedSetting(record.directionToleranceDegrees, flowColliderSettingsBounds.directionToleranceDegrees, "direction tolerance");
  const timingWindowMs = boundedSetting(record.timingWindowMs, flowColliderSettingsBounds.timingWindowMs, "timing window");
  return Object.freeze({ schema: "aerobeat/flow_collider_settings", version: 1, algorithm: "swept_athlete_plane_v1", colliderRadius, enforceAuthoredDirection: record.enforceAuthoredDirection, directionToleranceDegrees, timingWindowMs, topRowReachWU: setup.topRowReachWU, bottomRowReachWU: setup.bottomRowReachWU, guardCountMode: setup.guardCountMode });
}

/** @param {unknown} value @param {Readonly<{minimum:number,maximum:number}>} bounds @param {string} label */
function boundedSetting(value, bounds, label) { if (typeof value !== "number" || !Number.isFinite(value) || value < bounds.minimum || value > bounds.maximum) throw new RangeError(`Boxing Collider ${label} is outside its bounded range`); return Object.is(value, -0) ? 0 : value; }

/**
 * Normalized reach + guard-mode setup with defaults applied, rejecting any
 * present-but-invalid field.
 *
 * @param {unknown} value
 * @returns {Readonly<{topRowReachWU:number,bottomRowReachWU:number,guardCountMode:"collision"|"gesture"}>}
 */
export function normalizeReachAndGuardMode(value) {
  const normalized = normalizeBoxingColliderSetupFields(value ?? {});
  if (normalized === null) throw new TypeError("Boxing Collider reach/guard-mode fields are invalid");
  return normalized;
}

/**
 * Exact reach + guard-mode + collider-profile identity for the Boxing Collider
 * score partition. Mirrors flowColliderSettingsIdentity over the full ordered
 * settings field list.
 *
 * @param {unknown} settings
 * @returns {string}
 */
export function boxingColliderSettingsIdentity(settings) { const exact = createBoxingColliderSettings(settings); return `sha256:${new Sha256().update(JSON.stringify(SETTING_KEYS.map((key) => exact[key]))).digestHex()}`; }

/**
 * Judge-plane target center for a Boxing Collider placement. The X is the
 * canonical column center; the Y comes from the shared contracts
 * reach-row mapping (row 0 = top) so the judge and the presentation use
 * one truth.
 *
 * @param {number} placement
 * @param {Readonly<{topRowReachWU:number,bottomRowReachWU:number}>} reach
 * @returns {Readonly<{x:number,y:number}>}
 */
export function boxingColliderTargetCenter(placement, reach) {
  return Object.freeze({ x: targetCenterForPlacement(placement).x, y: boxingColliderRowY(boxerRowForPlacement(placement), reach).worldY });
}

/**
 * The canonical top-down grid row (0 = top, 1 = center, 2 = bottom) for a
 * 4x3 placement, matching the grid model row=floor(cell/4).
 *
 * @param {number} placement
 * @returns {0 | 1 | 2}
 */
export function boxerRowForPlacement(placement) {
  if (!Number.isInteger(placement) || placement < 0 || placement > 11) throw new RangeError("Boxing Collider placement must be a 4x3 grid cell");
  return /** @type {0 | 1 | 2} */ (Math.floor(placement / 4));
}

/**
 * Resolve the authored direction name for direction-enforced Boxing punch
 * families. Uppercuts are always "up"; hooks are horizontal toward the center
 * (left hook to the right, right hook to the left), mirroring the converter
 * spatialTarget. Straights are ALWAYS overlap-only and resolve to undefined.
 *
 * @param {string} action
 * @returns {"up" | "left" | "right" | undefined}
 */
export function boxingAuthoredDirection(action) {
  if (action === "uppercut_left" || action === "uppercut_right") return "up";
  if (action === "hook_left") return "right";
  if (action === "hook_right") return "left";
  return undefined;
}

/**
 * Guard gesture port of pose_detector_substrate.gd _process_guard, evaluated
 * on web normalized camera/preview landmarks (MediaPipe y-down). All of:
 * the two wrist separations within threshold, both wrists within the nose
 * distance, and each wrist above its own elbow. The Godot y-up comparison
 * `wrist.y >= elbow.y` becomes `wrist.y <= elbow.y` in the web y-down frame.
 *
 * @param {{leftWrist:DataRecord,rightWrist:DataRecord,nose:DataRecord,leftElbow:DataRecord,rightElbow:DataRecord}} landmarks
 * @param {GuardGestureConfig} [config]
 * @returns {boolean}
 */
export function guardGestureSatisfied(landmarks, config = defaultGuardGestureConfig) {
  const point = (anchor) => {
    const value = /** @type {unknown} */ (anchor);
    if (value === null || typeof value !== "object") return null;
    const record = /** @type {DataRecord} */ (value);
    if (record.valid === false) return null;
    const x = record.x; const y = record.y;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return Object.freeze({ x, y });
  };
  if (config.enabled === false) return false;
  const leftWrist = point(landmarks.leftWrist); const rightWrist = point(landmarks.rightWrist); const nose = point(landmarks.nose);
  const leftElbow = point(landmarks.leftElbow); const rightElbow = point(landmarks.rightElbow);
  if (leftWrist === null || rightWrist === null || nose === null || leftElbow === null || rightElbow === null) return false;
  const wristsCloseX = Math.abs(leftWrist.x - rightWrist.x) <= config.maxWristSeparationX;
  const wristsCloseY = Math.abs(leftWrist.y - rightWrist.y) <= config.maxWristSeparationY;
  const leftWristAboveElbow = leftWrist.y <= leftElbow.y;
  const rightWristAboveElbow = rightWrist.y <= rightElbow.y;
  const leftWristNearNose = Math.hypot(leftWrist.x - nose.x, leftWrist.y - nose.y) <= config.maxWristNoseDistance;
  const rightWristNearNose = Math.hypot(rightWrist.x - nose.x, rightWrist.y - nose.y) <= config.maxWristNoseDistance;
  return wristsCloseX && wristsCloseY && leftWristAboveElbow && rightWristAboveElbow && leftWristNearNose && rightWristNearNose;
}

/**
 * Read one valid normalized anchor (x, y in [0,1]) from measured evidence.
 *
 * @param {DataRecord} evidence
 * @param {string} anchorName
 * @returns {{x:number,y:number} | null}
 */
export function measuredGuardAnchor(evidence, anchorName) {
  if (evidence.provenance !== "measured" || !Array.isArray(evidence.anchors)) return null;
  const anchor = /** @type {DataRecord | undefined} */ (evidence.anchors.find((entry) => entry && typeof entry === "object" && /** @type {DataRecord} */ (entry).anchor === anchorName));
  if (!anchor || anchor.valid !== true) return null;
  if (typeof anchor.confidence !== "number" || anchor.confidence < 0.5) return null;
  if (typeof anchor.x !== "number" || typeof anchor.y !== "number" || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || anchor.x < 0 || anchor.x > 1 || anchor.y < 0 || anchor.y > 1) return null;
  if (anchor.calibrationId !== evidence.calibrationId || anchor.measurementTimestampMs !== evidence.measurementTimestampMs) return null;
  return Object.freeze({ x: anchor.x, y: anchor.y });
}

/**
 * Guard gesture evaluation directly on a measured evidence snapshot. Returns
 * null when the evidence is missing or non-measured (the caller treats that
 * as "no gesture this frame"); otherwise the exact five-condition port.
 *
 * @param {DataRecord | null} evidence
 * @param {GuardGestureConfig} [config]
 * @returns {boolean | null}
 */
export function guardGestureFromEvidence(evidence, config = defaultGuardGestureConfig) {
  if (evidence === null || typeof evidence !== "object") return null;
  if (evidence.provenance !== "measured" || !Array.isArray(evidence.anchors) || typeof evidence.calibrationId !== "string") return null;
  return guardGestureSatisfied({
    leftWrist: measuredGuardAnchor(/** @type {DataRecord} */ (evidence), "left_wrist"),
    rightWrist: measuredGuardAnchor(/** @type {DataRecord} */ (evidence), "right_wrist"),
    nose: measuredGuardAnchor(/** @type {DataRecord} */ (evidence), "nose"),
    leftElbow: measuredGuardAnchor(/** @type {DataRecord} */ (evidence), "left_elbow"),
    rightElbow: measuredGuardAnchor(/** @type {DataRecord} */ (evidence), "right_elbow")
  }, config);
}

/**
 * Swept 2.5D contact of one wrist segment against a reach-row Boxing target:
 * the Flow Colliders sweep (inclusive tangency and timing slab) re-slabbed at
 * the reach-row Y. The X footprint comes from the canonical placement's
 * column; the Y slab is [target.y - (0.375 + radius), target.y + (0.375 +
 * radius)] so the judge plane always follows the shared reach-row mapping.
 *
 * @param {DataRecord} event
 * @param {Readonly<{centerTimestampMs:number,x:number,y:number}>} target
 * @param {Readonly<{songTimeMs:number,measurementTimestampMs:number,sourceFrameId:string,sourceIdentity:string,calibrationId:string,sx:number,sy:number}>} first
 * @param {Readonly<{songTimeMs:number,measurementTimestampMs:number,sourceFrameId:string,sourceIdentity:string,calibrationId:string,sx:number,sy:number}>} second
 * @param {number} radius
 * @param {number} timingWindowMs
 * @returns {Readonly<{startMs:number,endMs:number,fraction:number}> | null}
 */
export function clipWristSegmentToBoxingTarget(event, target, first, second, radius, timingWindowMs) {
  if (!isContinuousColliderSegment(first, second)) return null;
  const dt = second.songTimeMs - first.songTimeMs;
  const half = 0.375 + radius;
  let low = 0; let high = 1;
  for (const [origin, delta, minimum, maximum] of [
    [first.songTimeMs, dt, Number(target.centerTimestampMs) - timingWindowMs, Number(target.centerTimestampMs) + timingWindowMs],
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

/**
 * Point contact against a reach-row Boxing target footprint with the same
 * inclusive slab semantics as pointContactsFlowTarget.
 *
 * @param {Readonly<{centerTimestampMs:number,x:number,y:number}>} target
 * @param {Readonly<{songTimeMs:number,sx:number,sy:number}>} sample
 * @param {number} radius
 * @param {number} timingWindowMs
 * @returns {boolean}
 */
export function pointContactsBoxingTarget(target, sample, radius, timingWindowMs) {
  const half = 0.375 + radius;
  return sample.songTimeMs >= Number(target.centerTimestampMs) - timingWindowMs && sample.songTimeMs <= Number(target.centerTimestampMs) + timingWindowMs && sample.sx >= target.x - half && sample.sx <= target.x + half && sample.sy >= target.y - half && sample.sy <= target.y + half;
}

/**
 * Boxing punch direction check: applies the authored-direction tolerance
 * check to the enforced families; straights always pass (overlap-only).
 *
 * @param {string} action
 * @param {Readonly<{songTimeMs:number,measurementTimestampMs:number,sourceFrameId:string,sourceIdentity:string,calibrationId:string,sx:number,sy:number}> | null} first
 * @param {Readonly<{songTimeMs:number,measurementTimestampMs:number,sourceFrameId:string,sourceIdentity:string,calibrationId:string,sx:number,sy:number}>} second
 * @param {boolean} enforceAuthoredDirection
 * @param {number} directionToleranceDegrees
 * @returns {boolean}
 */
export function matchesBoxingAuthoredDirection(action, first, second, enforceAuthoredDirection, directionToleranceDegrees) {
  const direction = boxingAuthoredDirection(action);
  if (direction === undefined) return true;
  if (enforceAuthoredDirection !== true) return true;
  return matchesAuthoredDirection(direction, first, second, directionToleranceDegrees);
}

/**
 * The exact reach-row target center table for a placement at the given reach
 * values. Exposed for renderer/judge identity tests.
 *
 * @param {number} placement
 * @param {Readonly<{topRowReachWU:number,bottomRowReachWU:number}>} reach
 * @returns {Readonly<{row:0|1|2,worldY:number,athleteY:number,x:number}>}
 */
export function boxingColliderReachRowForPlacement(placement, reach) {
  const row = boxerRowForPlacement(placement);
  const center = boxingColliderTargetCenter(placement, reach);
  return Object.freeze({ row, worldY: center.y, athleteY: boxingColliderRowY(row, reach).athleteY, x: center.x });
}

/**
 * @param {unknown} value
 * @returns {value is Readonly<{topRowReachWU:number,bottomRowReachWU:number,guardCountMode:"collision"|"gesture"}>}
 */
export function isBoxingColliderSetup(value) { return isBoxingColliderSetupFields(value); }
