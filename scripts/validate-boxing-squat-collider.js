// @ts-check
//
// 0.0.87 (B12-squat): e2e collider/vignette tests for the BOXING SQUAT obstacle
// (full-width bottom row, geometry {x:0,y:2,width:4,height:1}). The playtest
// symptom was: in boxing, the player's nose "went into the squat collider" but
// the red-edge "hurt vignette" (hazardContact) did NOT fire.
//
// Root cause (see session-coordinator.js, evaluateBoxingObstacles /
// evaluateFlowObstacles discrete path): when the nose sample that first lands
// inside an obstacle has NO continuous prior (prior === null — the first-ever
// tracked frame, e.g. right after calibration/baseline or a tracking reseed),
// the discrete path pushed an enter AND an exit at the same sample.songTimeMs.
// Both land in one processObstacleBoundaries time-group: the enter sets
// hazardContactSinceMs + occupies, then the exit immediately de-occupies +
// releases, so the snapshot reads {active:false, sinceMs, releasedAtMs}. The
// contact OUTCOME is recorded (so the assembly's outcome-based derivation can
// fire), but the STATE-DRIVEN during-collision vignette
// (snapshot.hazardContact.active -> frame.hazardContactActive) reads
// active:false and never pulses. The fix makes a first-ever discrete sample
// SUSTAIN the contact (enter only); the exit is deferred to the next sample
// that observes the nose outside, or to finalize when the interval ends.
//
// This validator drives a REAL session through the public input path (a
// measured nose anchor moving into the authored squat geometry) — no mocks of
// the obstacle truth — and asserts the vignette + logic fire appropriately:
//   1. A nose entering the squat fires hazardContact.active === true.
//   2. A nose entering the squat emits an obstacleOutcomes entry with
//      result: "contact".
//   3. A nose exiting the squat releases the vignette
//      (hazardContactReleasedAtMs set, sinceMs retained).
//   4. A safe pass (nose stays above the squat) does NOT fire the vignette.
//   5. The FIRST-EVER discrete sample inside the squat fires the vignette
//      (the exact playtest regression the fix addresses).
//   6. Mirrors 1-5 for weave_left / weave_right.

import assert from "node:assert/strict";
import { createAeroGameplaySessionCoordinator } from "../src/index.js";

const HASH = "a".repeat(64);

// Authoring geometry per obstacle type (mirrors the boxing converter / the
// existing validators): squat = full-width bottom row; weave_left = right
// column; weave_right = left column.
const GEOMETRY = Object.freeze({
  squat: Object.freeze({ x: 0, y: 2, width: 4, height: 1 }),
  weave_left: Object.freeze({ x: 3, y: 0, width: 1, height: 3 }),
  weave_right: Object.freeze({ x: 0, y: 0, width: 1, height: 3 })
});

function variant() {
  return { variantId: "sq-e2e", chartId: "chart-sq-e2e", mode: "boxing", rulesetId: "boxing_collider_v1", recipeId: null, modifierIds: [], ranked: false, localOnly: true, mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, provenance: { kind: "imported" } };
}

function obstacleEvent(eventId, type, startMs, endMs) {
  const geometry = GEOMETRY[type];
  const gridMask = Array.from({ length: geometry.width * geometry.height }, (_, i) => (geometry.y + Math.floor(i / geometry.width)) * 4 + geometry.x + i % geometry.width);
  const noseSafeCells = Array.from({ length: 12 }, (_, c) => c).filter((c) => !gridMask.includes(c));
  return {
    schema: "aerobeat/resolved_content_event", version: 3, eventId, variantId: "sq-e2e", chartId: "chart-sq-e2e",
    centerTimestampMs: startMs, intervalStartTimestampMs: startMs, intervalEndTimestampMs: endMs, sourceEventIds: [`source-${eventId}`], type,
    sourceGeometry: { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v2_legacy_obstacle", kind: "v2_type_1", ...geometry },
    gameplayGeometry: { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", ...geometry },
    gridMask, blockedCells: [...gridMask],
    checkpoint: { kind: "instantaneous", freshnessMs: 150, timingWindowMs: 180, noseSafeCells },
    spatialTarget: { targetCell: 5, acceptedSubcells: [], sourceCell: -1 }
  };
}

/** A future punch note that keeps the session "playing" past the obstacle window. */
function keeperPunch(eventId = "sq-keeper") {
  return { schema: "aerobeat/resolved_content_event", version: 3, eventId, variantId: "sq-e2e", chartId: "chart-sq-e2e", centerTimestampMs: 5000, sourceEventIds: [`source-${eventId}`], type: "straight_left", spatialTarget: { targetCell: 5, acceptedSubcells: [], sourceCell: -1 } };
}

function anchor(name, measured, sx, sy) {
  return { schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "cal-1", measurementTimestampMs: measured, valid: true, confidence: 1, rawX: 0.5, rawY: 0.5, x: (sx + 0.5) / 4, y: (2.5 - sy) / 3, cell: 5, subcell: 20 };
}

function evidence(frameId, measured, sx, sy) {
  return { schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal-1", measuredSourceFrameId: frameId, measurementTimestampMs: measured, provenance: "measured", activeBoxingActions: [], anchors: [anchor("nose", measured, sx, sy), anchor("left_shoulder", measured, 0, 0), anchor("right_shoulder", measured, 3, 0), anchor("left_elbow", measured, 0, 0), anchor("right_elbow", measured, 3, 0), anchor("left_wrist", measured, 1, 1), anchor("right_wrist", measured, 3, 1)], entries: [] };
}

const EQUIPMENT_CONFIG_IDENTITY = Object.freeze({ schema: "aerobeat/equipment_config_identity", version: 1, algorithm: "sha256", value: "b".repeat(64) });
function equipmentPosesForEvidence(sample) {
  return ["left_wrist", "right_wrist"].map((role) => {
    const w = sample.anchors.find((entry) => entry.anchor === role);
    assert.ok(w, `measured ${role} required for equipment pose`);
    return { role, mode: "boxing", anchor: { x: w.x * 4 - 0.5, y: 2.5 - w.y * 3, z: 0 }, scale: 1, orientation: { x: 0, y: 0, z: 0, w: 1 }, geometryIdentity: "aerobeat/glove_obb_v1", configIdentity: EQUIPMENT_CONFIG_IDENTITY };
  });
}

function input(measured, latest) {
  return { sourceIdentity: "camera-a", calibration: { calibrationId: "cal-1", readiness: "countdown" }, tracking: { gameplayPaused: false, freshCalibrationRequired: false }, countdownFrozen: false, latestEvidence: latest, straightQualifications: [] };
}

const clock = (ms, playing) => ({ contextTimeSeconds: ms / 1000, positionSeconds: ms / 1000, playing });

function ready(events, id) {
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
  const sample = evidence(frameId ?? `sq-f-${songMs}`, songMs, sx, sy);
  c.advance({ timestampMs: songMs, clock: clock(songMs, true), input: input(songMs, sample), equipmentPoses: equipmentPosesForEvidence(sample) });
}

// Canonical inside/outside nose positions per obstacle type (canonical sx/sy).
// The squat's y-range is [-0.5, 0.5] (bottom row); weave columns span all rows.
const NOSE = Object.freeze({
  squat: Object.freeze({ inside: [1.5, 0], outside: [1.5, 2] }),
  weave_right: Object.freeze({ inside: [0, 1.5], outside: [2.5, 1.5] }),
  weave_left: Object.freeze({ inside: [3, 1.5], outside: [1.5, 1.5] })
});

// ---------------------------------------------------------------------------
// SQUAT — the playtest regression, all five assertions.
// ---------------------------------------------------------------------------

// 1+2+3. Enter -> vignette active + contact outcome; exit -> released.
{
  const c = ready([obstacleEvent("sq-enter", "squat", 1000, 1300), keeperPunch()], "sq-enter");
  const [inSx, inSy] = NOSE.squat.inside; const [outSx, outSy] = NOSE.squat.outside;
  send(c, 950, outSx, outSy, "sqe-0");
  assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: null, releasedAtMs: null }, "squat pre-collision: hazardContact idle");
  send(c, 1100, inSx, inSy, "sqe-1");
  const mid = c.getSnapshot().hazardContact;
  assert.equal(mid.active, true, "squat: nose inside -> hazardContact.active true (vignette fires)");
  assert.ok(typeof mid.sinceMs === "number" && Number.isFinite(mid.sinceMs) && mid.sinceMs >= 1000 && mid.sinceMs <= 1100, `squat: sinceMs is the entry time (${mid.sinceMs})`);
  assert.equal(mid.releasedAtMs, null, "squat: releasedAtMs null while inside");
  // Exit the squat back above it before the interval ends.
  send(c, 1200, outSx, outSy, "sqe-2");
  const released = c.getSnapshot().hazardContact;
  assert.equal(released.active, false, "squat: nose out -> hazardContact released");
  assert.equal(released.sinceMs, mid.sinceMs, "squat: sinceMs retained from the episode entry (release-moment pulse stays recomputable)");
  assert.ok(released.releasedAtMs !== null && released.releasedAtMs >= 1100 && released.releasedAtMs <= 1200, "squat: releasedAtMs is the analytic exit crossing (between the entry and exit samples)");
  // Past the interval end: exactly one contact outcome for the boxing ruleset.
  send(c, 1400, outSx, outSy, "sqe-3");
  const outcomes = c.getObstacleOutcomes();
  assert.deepEqual(outcomes.map((o) => [o.eventId, o.rulesetId, o.result, o.consequenceApplied]), [["sq-enter", "boxing_collider_v1", "contact", false]], "squat: enter+exit settles as one boxing_collider_v1 contact outcome");
  assert.ok(typeof outcomes[0].firstContactTimelinePositionMs === "number" && Number.isFinite(outcomes[0].firstContactTimelinePositionMs), "squat: contact outcome carries a finite firstContactTimelinePositionMs");
}

// 4. Safe pass: nose stays ABOVE the squat -> no vignette, no contact.
{
  const c = ready([obstacleEvent("sq-safe", "squat", 1000, 1300), keeperPunch()], "sq-safe");
  const [outSx, outSy] = NOSE.squat.outside;
  send(c, 950, outSx, outSy, "sqs-0");
  send(c, 1100, outSx, outSy, "sqs-1");
  send(c, 1200, outSx, outSy, "sqs-2");
  assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: null, releasedAtMs: null }, "squat safe pass: hazardContact never activates");
  send(c, 1400, outSx, outSy, "sqs-3");
  const outcomes = c.getObstacleOutcomes();
  assert.equal(outcomes.length, 1, "squat safe pass: exactly one outcome");
  assert.notEqual(outcomes[0].result, "contact", "squat safe pass: outcome is NOT contact");
  assert.equal(outcomes[0].firstContactTimelinePositionMs, null, "squat safe pass: no first contact");
}

// 5. THE PLAYTEST REGRESSION: the FIRST-EVER tracked nose sample is already
// inside the squat (no continuous prior — prior === null discrete path). Pre-fix
// the discrete path pushed enter+exit at the same tick, so the snapshot read
// {active:false, sinceMs, releasedAtMs} and the vignette never fired. Post-fix
// the first-ever sample SUSTAINS the contact (enter only) and the vignette is
// active on that very frame.
{
  const c = ready([obstacleEvent("sq-first", "squat", 1000, 1300), keeperPunch()], "sq-first");
  const [inSx, inSy] = NOSE.squat.inside; const [outSx, outSy] = NOSE.squat.outside;
  // No baseline frame: the very first tracked frame is already inside the squat.
  send(c, 1100, inSx, inSy, "sqf-1");
  const first = c.getSnapshot().hazardContact;
  assert.equal(first.active, true, "squat FIRST-EVER sample inside: hazardContact.active true (the playtest regression — pre-fix this was false)");
  assert.ok(typeof first.sinceMs === "number" && Number.isFinite(first.sinceMs) && first.sinceMs === 1100, `squat FIRST-EVER sample inside: sinceMs is the sample time (${first.sinceMs})`);
  assert.equal(first.releasedAtMs, null, "squat FIRST-EVER sample inside: releasedAtMs null (sustained, not a flash)");
  // Sustained: a second inside sample keeps it active.
  send(c, 1200, inSx, inSy, "sqf-2");
  assert.equal(c.getSnapshot().hazardContact.active, true, "squat FIRST-EVER: second inside sample keeps the vignette active");
  // Exit: the nose leaves -> released.
  send(c, 1250, outSx, outSy, "sqf-3");
  const released = c.getSnapshot().hazardContact;
  assert.equal(released.active, false, "squat FIRST-EVER: exit releases the vignette");
  assert.ok(released.releasedAtMs !== null, "squat FIRST-EVER: releasedAtMs set on exit");
  // Past the interval end: a single contact outcome.
  send(c, 1400, outSx, outSy, "sqf-4");
  const outcomes = c.getObstacleOutcomes();
  assert.deepEqual(outcomes.map((o) => [o.eventId, o.result]), [["sq-first", "contact"]], "squat FIRST-EVER: settles as one contact outcome");
  assert.ok(outcomes[0].firstContactTimelinePositionMs === 1100, "squat FIRST-EVER: firstContactTimelinePositionMs is the first inside sample");
}

// ---------------------------------------------------------------------------
// WEAVE_RIGHT — mirror of the squat assertions (left column wall).
// ---------------------------------------------------------------------------
{
  const c = ready([obstacleEvent("wr-enter", "weave_right", 1000, 1300), keeperPunch()], "wr-enter");
  const [inSx, inSy] = NOSE.weave_right.inside; const [outSx, outSy] = NOSE.weave_right.outside;
  send(c, 950, outSx, outSy, "wre-0");
  send(c, 1100, inSx, inSy, "wre-1");
  assert.equal(c.getSnapshot().hazardContact.active, true, "weave_right: nose inside -> vignette active");
  send(c, 1200, outSx, outSy, "wre-2");
  assert.equal(c.getSnapshot().hazardContact.active, false, "weave_right: nose out -> released");
  send(c, 1400, outSx, outSy, "wre-3");
  assert.deepEqual(c.getObstacleOutcomes().map((o) => [o.eventId, o.rulesetId, o.result]), [["wr-enter", "boxing_collider_v1", "contact"]], "weave_right: one contact outcome");
}

// WEAVE_RIGHT safe pass.
{
  const c = ready([obstacleEvent("wr-safe", "weave_right", 1000, 1300), keeperPunch()], "wr-safe");
  const [outSx, outSy] = NOSE.weave_right.outside;
  send(c, 950, outSx, outSy, "wrs-0");
  send(c, 1100, outSx, outSy, "wrs-1");
  send(c, 1400, outSx, outSy, "wrs-2");
  assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: null, releasedAtMs: null }, "weave_right safe pass: vignette never fires");
  assert.notEqual(c.getObstacleOutcomes()[0].result, "contact", "weave_right safe pass: no contact");
}

// WEAVE_RIGHT first-ever discrete sample inside (the regression, mirrored).
{
  const c = ready([obstacleEvent("wr-first", "weave_right", 1000, 1300), keeperPunch()], "wr-first");
  const [inSx, inSy] = NOSE.weave_right.inside;
  send(c, 1100, inSx, inSy, "wrf-1");
  assert.equal(c.getSnapshot().hazardContact.active, true, "weave_right FIRST-EVER sample inside: vignette active (pre-fix: false)");
  send(c, 1400, 2.5, 1.5, "wrf-2");
  assert.deepEqual(c.getObstacleOutcomes().map((o) => [o.eventId, o.result]), [["wr-first", "contact"]], "weave_right FIRST-EVER: one contact outcome");
}

// ---------------------------------------------------------------------------
// WEAVE_LEFT — mirror of the squat assertions (right column wall).
// ---------------------------------------------------------------------------
{
  const c = ready([obstacleEvent("wl-enter", "weave_left", 1000, 1300), keeperPunch()], "wl-enter");
  const [inSx, inSy] = NOSE.weave_left.inside; const [outSx, outSy] = NOSE.weave_left.outside;
  send(c, 950, outSx, outSy, "wle-0");
  send(c, 1100, inSx, inSy, "wle-1");
  assert.equal(c.getSnapshot().hazardContact.active, true, "weave_left: nose inside -> vignette active");
  send(c, 1200, outSx, outSy, "wle-2");
  assert.equal(c.getSnapshot().hazardContact.active, false, "weave_left: nose out -> released");
  send(c, 1400, outSx, outSy, "wle-3");
  assert.deepEqual(c.getObstacleOutcomes().map((o) => [o.eventId, o.rulesetId, o.result]), [["wl-enter", "boxing_collider_v1", "contact"]], "weave_left: one contact outcome");
}

// WEAVE_LEFT safe pass.
{
  const c = ready([obstacleEvent("wl-safe", "weave_left", 1000, 1300), keeperPunch()], "wl-safe");
  const [outSx, outSy] = NOSE.weave_left.outside;
  send(c, 950, outSx, outSy, "wls-0");
  send(c, 1100, outSx, outSy, "wls-1");
  send(c, 1400, outSx, outSy, "wls-2");
  assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: null, releasedAtMs: null }, "weave_left safe pass: vignette never fires");
  assert.notEqual(c.getObstacleOutcomes()[0].result, "contact", "weave_left safe pass: no contact");
}

// WEAVE_LEFT first-ever discrete sample inside (the regression, mirrored).
{
  const c = ready([obstacleEvent("wl-first", "weave_left", 1000, 1300), keeperPunch()], "wl-first");
  const [inSx, inSy] = NOSE.weave_left.inside;
  send(c, 1100, inSx, inSy, "wlf-1");
  assert.equal(c.getSnapshot().hazardContact.active, true, "weave_left FIRST-EVER sample inside: vignette active (pre-fix: false)");
  send(c, 1400, 1.5, 1.5, "wlf-2");
  assert.deepEqual(c.getObstacleOutcomes().map((o) => [o.eventId, o.result]), [["wl-first", "contact"]], "weave_left FIRST-EVER: one contact outcome");
}

// ---------------------------------------------------------------------------
// Regression guard: a SEVERED discrete sample (tracking gap > 150ms while
// inside) still ends the episode (the pre-loop severing clears occupied +
// releases; the discrete enter+exit flash nets to {active:false}). This must
// NOT change with the fix — the sustain is only for prior === null.
// ---------------------------------------------------------------------------
{
  const c = ready([obstacleEvent("sq-stall", "squat", 1000, 1600), keeperPunch()], "sq-stall");
  const [inSx, inSy] = NOSE.squat.inside;
  send(c, 950, 1.5, 2, "sqt-0");      // baseline above
  send(c, 1050, inSx, inSy, "sqt-1");  // enter (continuous)
  assert.equal(c.getSnapshot().hazardContact.active, true, "stall: entered before the gap");
  send(c, 1350, inSx, inSy, "sqt-2");  // 300ms gap (non-continuous) while inside
  assert.equal(c.getSnapshot().hazardContact.active, false, "stall: a tracking gap severs the contact episode (vignette released)");
  send(c, 1700, 1.5, 2, "sqt-3");
  assert.deepEqual(c.getObstacleOutcomes().map((o) => [o.eventId, o.result]), [["sq-stall", "contact"]], "stall: the clipped entry before the gap still records contact");
}

console.log("0.0.87 boxing squat/weave collider vignette e2e validation passed.");
