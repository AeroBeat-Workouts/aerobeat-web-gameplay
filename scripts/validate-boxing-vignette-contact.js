// @ts-check
//
// B12 (0.0.58): real boxing_collider_v1 nose–obstacle collisions must emit a
// contact signal the assembly can read to set `hazardContactActive`:
// an `obstacleOutcomes` entry with `rulesetId: "boxing_collider_v1"` +
// `result: "contact"` + a finite `firstContactTimelinePositionMs`, and an
// in-window `snapshot.hazardContact` of `{ active: true, sinceMs: <finite> }`.
//
// This drives a real session through the public input path (calibration-ready
// pose/evidence frames with a measured nose anchor moving into an authored
// obstacle geometry) — no mocks of the obstacle truth. Each scenario includes
// a future punch note so the session stays "playing" long enough for the
// obstacle interval to elapse and its outcome to finalize.

import assert from "node:assert/strict";
import { createAeroGameplaySessionCoordinator } from "../src/index.js";

const HASH = "a".repeat(64);

// Full-height left column wall (cells 0/4/8) — the authoring geometry for a
// weave_right obstacle; the right columns stay safe.
const WALL_GEOMETRY = Object.freeze({ x: 0, y: 0, width: 1, height: 3 });

function variant() {
  return { variantId: "boxing-collider-b12", chartId: "chart-boxing-b12", mode: "boxing", rulesetId: "boxing_collider_v1", recipeId: null, modifierIds: [], ranked: false, localOnly: true, mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, provenance: { kind: "imported" } };
}

// One resolved obstacle checkpoint event (type weave_right), built exactly the
// way the boxing converter emits obstacle windows: normalized geometry, derived
// mask, blockedCells matching the mask, instantaneous nose-safe checkpoint.
function weaveEvent(eventId, startMs, endMs) {
  const geometry = { ...WALL_GEOMETRY };
  const gridMask = Array.from({ length: geometry.width * geometry.height }, (_, index) => (geometry.y + Math.floor(index / geometry.width)) * 4 + geometry.x + index % geometry.width);
  const noseSafeCells = Array.from({ length: 12 }, (_, cell) => cell).filter((cell) => !gridMask.includes(cell));
  return {
    schema: "aerobeat/resolved_content_event", version: 3, eventId, variantId: variant().variantId, chartId: variant().chartId,
    centerTimestampMs: startMs, intervalStartTimestampMs: startMs, intervalEndTimestampMs: endMs, sourceEventIds: [`source-${eventId}`], type: "weave_right",
    sourceGeometry: { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v2_legacy_obstacle", kind: "v2_type_1", ...geometry },
    gameplayGeometry: { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", ...geometry },
    gridMask, blockedCells: [...gridMask],
    checkpoint: { kind: "instantaneous", freshnessMs: 150, timingWindowMs: 180, noseSafeCells },
    spatialTarget: { targetCell: 5, acceptedSubcells: [], sourceCell: -1 }
  };
}

/** A future straight-left punch that keeps the session playing past the obstacle window. */
function keeperPunch(eventId = "b12-keeper") {
  return { schema: "aerobeat/resolved_content_event", version: 3, eventId, variantId: variant().variantId, chartId: variant().chartId, centerTimestampMs: 5000, sourceEventIds: [`source-${eventId}`], type: "straight_left", spatialTarget: { targetCell: 5, acceptedSubcells: [], sourceCell: -1 } };
}

function anchor(name, measured, sx, sy) {
  return { schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "cal-1", measurementTimestampMs: measured, valid: true, confidence: 1, rawX: 0.5, rawY: 0.5, x: (sx + 0.5) / 4, y: (2.5 - sy) / 3, cell: 5, subcell: 20 };
}

function evidence(frameId, measured, sx, sy) {
  return { schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal-1", measuredSourceFrameId: frameId, measurementTimestampMs: measured, provenance: "measured", activeBoxingActions: [], anchors: [anchor("nose", measured, sx, sy), anchor("left_shoulder", measured, 0, 0), anchor("right_shoulder", measured, 3, 0), anchor("left_elbow", measured, 0, 0), anchor("right_elbow", measured, 3, 0), anchor("left_wrist", measured, 1, 1), anchor("right_wrist", measured, 3, 1)], entries: [] };
}

function input(measured, latest) {
  return { sourceIdentity: "camera-a", calibration: { calibrationId: "cal-1", readiness: "countdown" }, tracking: { gameplayPaused: false, freshCalibrationRequired: false }, countdownFrozen: false, latestEvidence: latest, straightQualifications: [] };
}

const clock = (ms, playing) => ({ contextTimeSeconds: ms / 1000, positionSeconds: ms / 1000, playing });

function ready(events, id = "b12") {
  const c = createAeroGameplaySessionCoordinator({ sessionId: `${id}-${Math.random().toString(36).slice(2)}`, countdownStepMs: 1 });
  c.configureContent({ packageId: "package", selectedVariant: variant(), resolvedEvents: events, profileIdentity: { schema: "aerobeat/prototype_tuning_identity", version: 1, profileId: "profile", profileVersion: "1", contentHash: HASH, class: "between_run_ruleset", regenerationRequired: false } });
  c.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) });
  assert.equal(c.requestStart(0).accepted, true);
  c.advance({ timestampMs: 1, clock: clock(0, false) });
  c.advance({ timestampMs: 2, clock: clock(0, false) });
  c.advance({ timestampMs: 3, clock: clock(0, false) });
  assert.equal(c.getSnapshot().session.state, "playing");
  return c;
}

/** Send one measured frame at wall time == song time with a nose at canonical sx/sy. */
function send(c, songMs, sx, sy, frameId) {
  c.advance({ timestampMs: songMs, clock: clock(songMs, true), input: input(songMs, evidence(frameId ?? `f-${songMs}`, songMs, sx, sy)) });
}

// --- Real collision: nose enters the wall -> contact outcome + active hazardContact ---
{
  const c = ready([weaveEvent("b12-wall", 1000, 1300), keeperPunch()], "b12-contact");
  // Baseline nose at the top center (outside the left column wall).
  send(c, 950, 1, 2, "b12-0");
  assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: null, releasedAtMs: null }, "pre-collision: hazardContact idle");
  // Enter the wall mid-interval (nose inside the left column via segment clip).
  send(c, 1100, 0, 1.5, "b12-1");
  const mid = c.getSnapshot().hazardContact;
  assert.equal(mid.active, true, "nose inside the wall: hazardContact active");
  assert.ok(typeof mid.sinceMs === "number" && Number.isFinite(mid.sinceMs) && mid.sinceMs >= 1000 && mid.sinceMs <= 1100, `nose inside the wall: sinceMs is the clipped entry (${mid.sinceMs})`);
  assert.equal(mid.releasedAtMs, null, "nose inside the wall: releasedAtMs null");
  // Exit the wall back to the safe right columns before the interval ends.
  send(c, 1200, 2, 1.5, "b12-2");
  const released = c.getSnapshot().hazardContact;
  assert.equal(released.active, false, "nose out of the wall: hazardContact released");
  assert.equal(released.sinceMs, null, "nose out of the wall: sinceMs null");
  assert.ok(released.releasedAtMs !== null && released.releasedAtMs <= 1300, "nose out of the wall: releasedAtMs set");
  // Past the interval end: exactly one contact outcome for the boxing ruleset.
  send(c, 1400, 2, 1.5, "b12-3");
  const outcomes = c.getObstacleOutcomes();
  assert.deepEqual(outcomes.map((outcome) => [outcome.eventId, outcome.rulesetId, outcome.result, outcome.consequenceApplied]), [["b12-wall", "boxing_collider_v1", "contact", false]], "wall contact settles as one boxing_collider_v1 obstacle outcome");
  const outcome = outcomes[0];
  assert.ok(typeof outcome.firstContactTimelinePositionMs === "number" && Number.isFinite(outcome.firstContactTimelinePositionMs), "contact outcome carries a finite firstContactTimelinePositionMs for the assembly derivation");
  assert.ok(outcome.committedTimelinePositionMs >= 1300, "outcome committed at or after the interval end");
  // The head collision applies no ADDITIONAL boxing score consequence beyond
  // the normal checkpoint judgement (no combo break from the collision itself).
  // The weave_right checkpoint may be judged hit or miss through tryHit; the
  // point here is that the collision does not force a miss or break combo.
  const partition = c.getScorePartitions()[0];
  assert.equal(partition.obstacleContacts, 0, "head collision adds no obstacleContacts score consequence");
}

// --- No contact: nose never enters -> avoided/unevaluated outcome, hazardContact never activates ---
{
  const c = ready([weaveEvent("b12-safe", 1000, 1300), keeperPunch()], "b12-safe");
  send(c, 950, 2, 1.5, "b12s-0");
  send(c, 1100, 2, 1.5, "b12s-1");
  send(c, 1200, 3, 1.5, "b12s-2");
  assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: null, releasedAtMs: null }, "safe path: hazardContact never activates");
  send(c, 1400, 3, 1.5, "b12s-3");
  const outcomes = c.getObstacleOutcomes();
  assert.deepEqual(outcomes.map((outcome) => [outcome.eventId, outcome.rulesetId, outcome.result]), [["b12-safe", "boxing_collider_v1", "unevaluated_tracking"]], "safe path with sparse frames settles as unevaluated_tracking (no contact, no continuous coverage)");
  assert.equal(outcomes[0].firstContactTimelinePositionMs, null, "no-contact outcome has no first contact");
}

// --- Stale evidence mid-wall: occupied occupation is dropped, state released ---
{
  const c = ready([weaveEvent("b12-stale", 1000, 1300), keeperPunch()], "b12-stale");
  send(c, 950, 1, 2, "b12t-0");
  send(c, 1050, 0, 1.5, "b12t-1");
  assert.equal(c.getSnapshot().hazardContact.active, true, "entered before the stall");
  // Gap beyond maximumObstacleSampleGapMs: no fresh measured frame in between.
  send(c, 1350, 0, 1.5, "b12t-2");
  assert.equal(c.getSnapshot().hazardContact.active, false, "stall drops the occupied obstacle and releases hazardContact");
  const outcomes = c.getObstacleOutcomes();
  assert.deepEqual(outcomes.map((outcome) => [outcome.eventId, outcome.rulesetId, outcome.result]), [["b12-stale", "boxing_collider_v1", "contact"]], "the clipped entry before the stall still records contact");
}

// --- Pause clears the boxing hazardContact state (same lifecycle as Flow) ---
{
  const c = ready([weaveEvent("b12-pause", 1000, 1300), keeperPunch()], "b12-pause");
  send(c, 950, 1, 2, "b12p-0");
  send(c, 1100, 0, 1.5, "b12p-1");
  assert.equal(c.getSnapshot().hazardContact.active, true, "active before pause");
  c.pause(1150);
  assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: null, releasedAtMs: null }, "pause clears boxing hazardContact");
}

// --- Scoring isolation: a punched note keeps scoring while a head collision happens ---
{
  const c = ready([
    weaveEvent("b12-scorable-wall", 1000, 1300),
    { schema: "aerobeat/resolved_content_event", version: 3, eventId: "b12-straight", variantId: variant().variantId, chartId: variant().chartId, centerTimestampMs: 2000, sourceEventIds: ["source-b12-straight"], type: "straight_left", spatialTarget: { targetCell: 5, acceptedSubcells: [], sourceCell: -1 } }
  ], "b12-score");
  send(c, 950, 1, 2, "b12sc-0");
  send(c, 1100, 0, 1.5, "b12sc-1"); // head collision
  send(c, 1200, 2, 1.5, "b12sc-2");
  // Punch the note: left wrist into the placement-5 target at song 2000.
  const punch = evidence("b12sc-3", 1950, 2, 1.5);
  punch.anchors.find((entry) => entry.anchor === "left_wrist").x = (1 + 0.5) / 4;
  punch.anchors.find((entry) => entry.anchor === "left_wrist").y = (2.5 - 1) / 3;
  c.advance({ timestampMs: 1950, clock: clock(1950, true), input: input(1950, punch) });
  const punchEnd = evidence("b12sc-4", 2000, 2, 1.5);
  punchEnd.anchors.find((entry) => entry.anchor === "left_wrist").x = (1 + 0.5) / 4;
  punchEnd.anchors.find((entry) => entry.anchor === "left_wrist").y = (2.5 - 1) / 3;
  c.advance({ timestampMs: 2000, clock: clock(2000, true), input: input(2000, punchEnd) });
  const judgements = c.getJudgements().map((entry) => [entry.eventId, entry.result]);
  // The straight note scores hit; the weave_right checkpoint may be judged
  // (hit or miss) through tryHit independently of the head collision.
  assert.ok(judgements.some(([id, result]) => id === "b12-straight" && result === "hit"), "the punched note still scores hit");
  const partition = c.getScorePartitions()[0];
  assert.equal(partition.obstacleContacts, 0, "the head collision adds no obstacleContacts (no combo break from collision)");
  assert.deepEqual(c.getObstacleOutcomes().map((outcome) => [outcome.eventId, outcome.rulesetId, outcome.result, outcome.consequenceApplied]), [["b12-scorable-wall", "boxing_collider_v1", "contact", false]], "the collision still records a consequence-free contact outcome");
}

console.log("B12 boxing nose-obstacle collision contact-signal validation passed.");
