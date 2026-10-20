// @ts-check

import { Sha256 } from "@aerobeat/web-hash";

/** @typedef {Readonly<Record<string, unknown>>} DataRecord */
const SETTING_KEYS = Object.freeze(["schema", "version", "colliderVisible", "colliderScale", "colliderDepthForward", "colliderDepthBackward"]);
export const defaultKneeColliderSettings = Object.freeze({ schema: "aerobeat/knee_collider_settings", version: 1, colliderVisible: false, colliderScale: 1, colliderDepthForward: 1, colliderDepthBackward: 1 });

/** @param {unknown} [value] */
export function createKneeColliderSettings(value = defaultKneeColliderSettings) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError("Knee collider settings must be a plain record");
  if (Reflect.ownKeys(value).length !== SETTING_KEYS.length) throw new TypeError("Knee collider settings require every exact field");
  /** @type {Record<string, unknown>} */ const record = {};
  for (const key of SETTING_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError("Knee collider settings require own enumerable data fields");
    record[key] = descriptor.value;
  }
  if (record.schema !== "aerobeat/knee_collider_settings" || record.version !== 1 || typeof record.colliderVisible !== "boolean") throw new TypeError("Knee collider settings identity or visibility is invalid");
  for (const key of ["colliderScale", "colliderDepthForward", "colliderDepthBackward"]) if (typeof record[key] !== "number" || !Number.isFinite(record[key]) || Number(record[key]) < 0) throw new RangeError(`Knee collider ${key} must be finite and nonnegative`);
  return Object.freeze({ schema: record.schema, version: 1, colliderVisible: record.colliderVisible, colliderScale: Object.is(record.colliderScale, -0) ? 0 : record.colliderScale, colliderDepthForward: Object.is(record.colliderDepthForward, -0) ? 0 : record.colliderDepthForward, colliderDepthBackward: Object.is(record.colliderDepthBackward, -0) ? 0 : record.colliderDepthBackward });
}

/** Visibility is presentation-only; the three independent dimensions partition score history. @param {unknown} value */
export function kneeColliderSettingsIdentity(value) {
  const settings = createKneeColliderSettings(value);
  return `sha256:${new Sha256().update(JSON.stringify([settings.schema, settings.version, settings.colliderScale, settings.colliderDepthForward, settings.colliderDepthBackward])).digestHex()}`;
}

// A dedicated, small judge-plane collider: a knee-centered 0.24 WU radius pad
// against the authored 1x1 cell, with separate forward/backward song-time reach.
// It never consumes a wrist pose or invents a measured Z coordinate.
export const kneePadRadiusWu = 0.24;
/** @param {Readonly<{x:number,y:number,centerTimestampMs:number}>} target @param {Readonly<{sx:number,sy:number,songTimeMs:number}>} knee @param {DataRecord} settings @param {number} windowMs */
export function kneePadContactsBoxingTarget(target, knee, settings, windowMs) {
  const scale = Number(settings.colliderScale);
  if (scale === 0 || knee.songTimeMs < target.centerTimestampMs - windowMs || knee.songTimeMs > target.centerTimestampMs + windowMs) return false;
  const radius = kneePadRadiusWu * scale;
  // Depth controls extend only the collider along the track/time axis, never
  // the authored timing window. Zero reaches can still touch at the center.
  const deltaMs = knee.songTimeMs - target.centerTimestampMs;
  const reach = deltaMs < 0 ? Number(settings.colliderDepthForward) : Number(settings.colliderDepthBackward);
  if (reach === 0 && deltaMs !== 0) return false;
  if (reach > 0 && Math.abs(deltaMs) > windowMs * Math.min(reach, 1)) return false;
  const dx = Math.max(Math.abs(knee.sx - target.x) - 0.5, 0);
  const dy = Math.max(Math.abs(knee.sy - target.y) - 0.5, 0);
  return dx * dx + dy * dy <= radius * radius;
}

/** @param {DataRecord} evidence @param {DataRecord} input @param {"left"|"right"} side @param {number} timelineMs @param {number} frameTimestampMs @param {number} freshnessMs */
export function measuredKneeSample(evidence, input, side, timelineMs, frameTimestampMs, freshnessMs) {
  if (evidence.provenance !== "measured" || !evidence.kneePose || typeof evidence.kneePose !== "object" || typeof input.sourceIdentity !== "string" || !Array.isArray(/** @type {DataRecord} */ (evidence.kneePose).legs)) return null;
  const pose = /** @type {DataRecord} */ (evidence.kneePose);
  if (pose.calibrationId !== evidence.calibrationId || pose.measuredSourceFrameId !== evidence.measuredSourceFrameId || pose.measurementTimestampMs !== evidence.measurementTimestampMs) return null;
  const age = frameTimestampMs - Number(pose.measurementTimestampMs);
  if (!Number.isFinite(age) || age < 0 || age >= freshnessMs) return null;
  const leg = /** @type {DataRecord | undefined} */ (pose.legs.find((item) => item && typeof item === "object" && /** @type {DataRecord} */ (item).side === side));
  if (!leg || typeof leg.confidence !== "number" || leg.confidence < 0.5 || !leg.knee || typeof leg.knee !== "object") return null;
  const knee = /** @type {DataRecord} */ (leg.knee);
  if (typeof knee.x !== "number" || typeof knee.y !== "number" || !Number.isFinite(knee.x) || !Number.isFinite(knee.y)) return null;
  const sx = 4 * knee.x - 0.5; const sy = 2.5 - 3 * knee.y;
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;
  return Object.freeze({ sx, sy, songTimeMs: timelineMs - age, sourceFrameId: String(pose.measuredSourceFrameId), calibrationId: String(pose.calibrationId), sourceIdentity: input.sourceIdentity, measurementTimestampMs: Number(pose.measurementTimestampMs) });
}
