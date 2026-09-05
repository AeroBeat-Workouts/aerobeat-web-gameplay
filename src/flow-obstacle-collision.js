// @ts-check

/** @typedef {Readonly<Record<string, unknown>>} DataRecord */
/** @typedef {Readonly<{songTimeMs:number,measurementTimestampMs:number,sourceFrameId:string,calibrationId:string,sx:number,sy:number}>} NoseSample */

export const maximumObstacleSampleGapMs = 150;

/**
 * Extract the only collision authority: a valid measured nose anchor. Coordinates
 * are converted from top-left normalized athlete space to canonical grid-world coordinates.
 * @param {DataRecord} evidence @param {number} timelinePositionMs @param {number} frameTimestampMs
 * @returns {NoseSample | null}
 */
export function measuredNoseSample(evidence, timelinePositionMs, frameTimestampMs) {
  if (evidence.provenance !== "measured" || !Array.isArray(evidence.anchors) || typeof evidence.measuredSourceFrameId !== "string" || typeof evidence.calibrationId !== "string" || typeof evidence.measurementTimestampMs !== "number") return null;
  const anchor = evidence.anchors.find((entry) => entry && typeof entry === "object" && /** @type {DataRecord} */ (entry).anchor === "nose");
  if (!anchor || typeof anchor !== "object") return null;
  const nose = /** @type {DataRecord} */ (anchor);
  if (nose.valid !== true || typeof nose.confidence !== "number" || nose.confidence < 0.5 || typeof nose.x !== "number" || typeof nose.y !== "number" || !Number.isFinite(nose.x) || !Number.isFinite(nose.y) || nose.calibrationId !== evidence.calibrationId || nose.measurementTimestampMs !== evidence.measurementTimestampMs) return null;
  const ageMs = frameTimestampMs - evidence.measurementTimestampMs;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maximumObstacleSampleGapMs) return null;
  return Object.freeze({ songTimeMs: timelinePositionMs - Math.min(maximumObstacleSampleGapMs, Math.max(0, ageMs)), measurementTimestampMs: evidence.measurementTimestampMs, sourceFrameId: evidence.measuredSourceFrameId, calibrationId: evidence.calibrationId, sx: 4 * nose.x - 0.5, sy: 2.5 - 3 * nose.y });
}

/** @param {DataRecord} obstacle @param {NoseSample} sample */
export function pointContactsObstacle(obstacle, sample) {
  const geometry = /** @type {DataRecord} */ (obstacle.gameplayGeometry);
  return sample.songTimeMs >= Number(obstacle.intervalStartTimestampMs) && sample.songTimeMs <= Number(obstacle.intervalEndTimestampMs) && sample.sx >= Number(geometry.x) - 0.5 && sample.sx <= Number(geometry.x) + Number(geometry.width) - 0.5 && sample.sy >= 2.5 - Number(geometry.y) - Number(geometry.height) && sample.sy <= 2.5 - Number(geometry.y);
}

/**
 * Analytically clips one measured trajectory segment against authored time and
 * logical obstacle bounds. Returns exact song-time endpoints or null.
 * @param {DataRecord} obstacle @param {NoseSample} first @param {NoseSample} second
 * @returns {Readonly<{startMs:number,endMs:number}> | null}
 */
export function clipNoseSegment(obstacle, first, second) {
  const dt = second.songTimeMs - first.songTimeMs;
  if (!(dt > 0)) return null;
  const geometry = /** @type {DataRecord} */ (obstacle.gameplayGeometry);
  let low = 0; let high = 1;
  for (const [origin, delta, minimum, maximum] of [
    [first.songTimeMs, dt, Number(obstacle.intervalStartTimestampMs), Number(obstacle.intervalEndTimestampMs)],
    [first.sx, second.sx - first.sx, Number(geometry.x) - 0.5, Number(geometry.x) + Number(geometry.width) - 0.5],
    [first.sy, second.sy - first.sy, 2.5 - Number(geometry.y) - Number(geometry.height), 2.5 - Number(geometry.y)]
  ]) {
    if (delta === 0) { if (origin < minimum || origin > maximum) return null; continue; }
    const a = (minimum - origin) / delta; const b = (maximum - origin) / delta;
    low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b));
    if (low > high) return null;
  }
  return Object.freeze({ startMs: first.songTimeMs + dt * low, endMs: first.songTimeMs + dt * high });
}

/** @param {readonly Readonly<{startMs:number,endMs:number}>[]} source @param {number} startMs @param {number} endMs */
export function addInterval(source, startMs, endMs) {
  const intervals = [...source, { startMs: Math.min(startMs, endMs), endMs: Math.max(startMs, endMs) }].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  /** @type {{startMs:number,endMs:number}[]} */ const merged = [];
  for (const interval of intervals) { const last = merged.at(-1); if (last && interval.startMs <= last.endMs) last.endMs = Math.max(last.endMs, interval.endMs); else merged.push({ ...interval }); }
  return Object.freeze(merged.map(Object.freeze));
}

/** @param {readonly Readonly<{startMs:number,endMs:number}>[]} intervals @param {number} startMs @param {number} endMs */
export function coversInterval(intervals, startMs, endMs) { return intervals.some((entry) => entry.startMs <= startMs && entry.endMs >= endMs); }
