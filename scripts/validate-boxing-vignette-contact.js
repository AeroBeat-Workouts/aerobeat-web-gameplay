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
  assert.equal(released.sinceMs, mid.sinceMs, "nose out of the wall: sinceMs retained from the episode entry (release-moment pulse phase stays recomputable)");
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

// --- L-B2/L-B3 (0.0.61): non-continuous sample gap BEFORE the interval ends publishes
// the release boundary with the entry sinceMs retained (pre-fix the snapshot stayed
// {active:false, sinceMs:<entry>, releasedAtMs:null} because the gap severing path never
// released; L-B2 published releasedAtMs but nulled sinceMs, which the renderer's
// release-moment pulse phase needs retained) ---
{
  const c = ready([weaveEvent("b12-gap", 1000, 1600), keeperPunch()], "b12-gap");
  send(c, 950, 1, 2, "b12g-0");
  assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: null, releasedAtMs: null }, "gap: hazardContact idle before any contact");
  send(c, 1050, 0, 1.5, "b12g-1");
  const inside = c.getSnapshot().hazardContact;
  assert.equal(inside.active, true, "gap: inside the wall after entry");
  assert.ok(Number.isFinite(inside.sinceMs) && inside.sinceMs >= 1000 && inside.sinceMs <= 1050, `gap: sinceMs is the clipped entry (${inside.sinceMs})`);
  assert.equal(inside.releasedAtMs, null, "gap: releasedAtMs null while the episode is active");
  const entrySinceMs = inside.sinceMs;
  // 300 ms sample gap (> maximumObstacleSampleGapMs=150) with the nose now OUTSIDE the
  // wall, while the interval [1000,1600] is still open: the occupied set is severed
  // without an exit boundary and the release boundary must be published at this tick.
  send(c, 1350, 2, 1.5, "b12g-2");
  assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: entrySinceMs, releasedAtMs: 1350 }, "gap: released shape {active:false, sinceMs:<entry retained>, releasedAtMs:gap tick}");
  // Past the interval end: the wall finalizes as a single contact and the
  // already-published release tick / retained entry sinceMs are not overwritten.
  send(c, 1700, 2, 1.5, "b12g-3");
  assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: entrySinceMs, releasedAtMs: 1350 }, "gap: finalize does not overwrite the published release tick or the retained entry sinceMs");
  assert.deepEqual(c.getObstacleOutcomes().map((outcome) => [outcome.eventId, outcome.result]), [["b12-gap", "contact"]], "gap: the clipped entry still settles as one contact outcome");
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

// --- F4 (0.0.60): tracking freeze — walls stay live from a held (frozen) nose ---
// During a calibrated tracking freeze the input republishes the held last-measured
// frame as `provenance: "frozen"` with a strictly increasing `frozenTickId`. The
// obstacle nose path must accept those held nose samples (freshness-exempted in
// measuredNoseSample, and per-tick identity via (calibrationId, frozenTickId) in the
// coordinator) so a wall contact keeps firing / is maintained from the held nose,
// first contact is recorded exactly once, and the session stays "playing".
{
  const frozenEvidence = (heldFrameId, heldTs, sx, sy, tick) => ({ schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal-1", provenance: "frozen", frozenTickId: tick, measuredSourceFrameId: heldFrameId, measurementTimestampMs: heldTs, activeBoxingActions: [], anchors: [anchor("nose", heldTs, sx, sy), anchor("left_shoulder", heldTs, 0, 0), anchor("right_shoulder", heldTs, 3, 0), anchor("left_elbow", heldTs, 0, 0), anchor("right_elbow", heldTs, 3, 0), anchor("left_wrist", heldTs, 1, 1), anchor("right_wrist", heldTs, 3, 1)], entries: [] });
  /** Send a frozen re-publication of the held frame at wall time == song time. */
  const sendFrozen = (c, songMs, heldFrameId, heldTs, sx, sy, tick) => { c.advance({ timestampMs: songMs, clock: clock(songMs, true), input: input(songMs, frozenEvidence(heldFrameId, heldTs, sx, sy, tick)) }); };

  // (a) The held nose is INSIDE the wall column for the whole freeze. The first
  // frozen tick (the wall activates at song 1000) is what sets firstContact — the
  // prior measured frame was inside but before the interval. Across >=2 frozen
  // ticks the contact holds, firstContact is recorded exactly once, the red-edge
  // vignette (hazardContact) stays active, and the wall finalizes as "contact".
  {
    const c = ready([weaveEvent("fz-contact", 1000, 1400), keeperPunch()], "fz-contact");
    // Nose at the wall, but the wall interval has not opened yet (song 900 < 1000).
    send(c, 900, 0, 1.5, "fzc-0");
    assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: null, releasedAtMs: null }, "pre-interval: no contact yet");
    // Freeze begins, holding frame "fzc-0" (nose at the wall). First frozen tick
    // lands at song 1050, inside the interval [1000,1400] -> contact fires from the
    // held nose and sets firstContact exactly once.
    sendFrozen(c, 1050, "fzc-0", 900, 0, 1.5, 1);
    const afterFirst = c.getSnapshot().hazardContact;
    assert.equal(afterFirst.active, true, "first frozen tick with the held nose in the wall activates hazardContact");
    assert.ok(typeof afterFirst.sinceMs === "number" && Number.isFinite(afterFirst.sinceMs) && afterFirst.sinceMs >= 999.99 && afterFirst.sinceMs <= 1050.01, `firstContact set once on the first frozen tick (${afterFirst.sinceMs})`);
    assert.equal(c.getSnapshot().session.state, "playing", "session stays playing on the first frozen tick");
    // Second + third frozen ticks (held timestamp now 250ms / 350ms old, well past
    // the 150ms window): the held nose still tracks, contact holds, firstContact
    // is NOT re-fired, and the vignette stays lit.
    sendFrozen(c, 1150, "fzc-0", 900, 0, 1.5, 2);
    sendFrozen(c, 1250, "fzc-0", 900, 0, 1.5, 3);
    const afterMore = c.getSnapshot().hazardContact;
    assert.equal(afterMore.active, true, "held nose inside the wall keeps hazardContact active across >=2 frozen ticks");
    assert.equal(afterMore.sinceMs, afterFirst.sinceMs, "first-contact time is not re-fired by later frozen ticks");
    assert.equal(c.getSnapshot().session.state, "playing", "session stays playing across the frozen ticks");
    // Resume: a measured frame after the freeze is accepted (not swallowed by the
    // monotonic gate) and keeps tracking the wall.
    send(c, 1300, 0, 1.5, "fzc-1");
    assert.equal(c.getSnapshot().session.state, "playing", "measured resume frame after the freeze is accepted");
    // Past the interval end: the wall finalizes as a single contact, firstContact
    // preserved from the frozen tick, with no boxing score consequence. The session
    // stays "playing" through the freeze and the resume above; once the wall
    // resolves (and the weave checkpoint's own window closes) the chart may settle
    // — matching the existing b12 blocks, which assert the outcome rather than a
    // terminal "playing" state after the wall resolves.
    send(c, 1450, 2, 1.5, "fzc-2");
    const outcomes = c.getObstacleOutcomes();
    assert.deepEqual(outcomes.map((outcome) => [outcome.eventId, outcome.rulesetId, outcome.result, outcome.consequenceApplied]), [["fz-contact", "boxing_collider_v1", "contact", false]], "frozen-held-nose wall contact settles as one boxing_collider_v1 contact outcome");
    const outcome = outcomes[0];
    assert.equal(outcome.firstContactTimelinePositionMs, afterFirst.sinceMs, "final firstContactTimelinePositionMs equals the once-set frozen first contact");
    assert.ok(typeof outcome.firstContactTimelinePositionMs === "number" && Number.isFinite(outcome.firstContactTimelinePositionMs), "contact outcome carries a finite firstContactTimelinePositionMs");
  }

  // (b) The held nose is OUTSIDE the wall for the whole freeze: no contact fires,
  // the vignette never activates, and the wall finalizes with no first contact
  // (never-contacted walls settle as unevaluated_tracking, same as the measured
  // b12-safe case — the frozen path must not fabricate a contact).
  {
    const c = ready([weaveEvent("fz-safe", 1000, 1400), keeperPunch()], "fz-safe");
    send(c, 900, 2, 1.5, "fzs-0");          // outside the left-column wall
    send(c, 1050, 2, 1.5, "fzs-1");
    sendFrozen(c, 1150, "fzs-1", 1050, 2, 1.5, 1);
    sendFrozen(c, 1250, "fzs-1", 1050, 2, 1.5, 2);
    assert.equal(c.getSnapshot().hazardContact.active, false, "frozen nose outside the wall never activates hazardContact");
    assert.equal(c.getSnapshot().session.state, "playing", "session stays playing during an outside-wall freeze");
    send(c, 1450, 2, 1.5, "fzs-2");
    const outcomes = c.getObstacleOutcomes();
    assert.notEqual(outcomes[0].result, "contact", "frozen nose outside the wall produces no contact");
    assert.equal(outcomes[0].firstContactTimelinePositionMs, null, "no-contact frozen outcome has no first contact");
  }
}

// kpxg (0.0.61): boxing obstacle outcomes are UNCHANGED by the flow-wall fix —
// the boxing path pushes into `obstacleOutcomes` (the array the exclusion
// filter checks), so an expired checkpoint finalizes exactly once and its
// outcome count stays stable across many later LIVE ticks. Extra keeper events
// keep the session "playing" well past the wall expiry (a lone keeper would
// complete the run the instant the weave double-resolves as judged + outcome).
{
  const c = ready([weaveEvent("kpxg-boxing", 1000, 1300), keeperPunch("kb-keep-1"), { ...keeperPunch("kb-keep-2"), centerTimestampMs: 6000 }, { ...keeperPunch("kb-keep-3"), centerTimestampMs: 7000 }], "kpxg-boxing");
  send(c, 950, 2, 1.5, "kb-0");
  send(c, 1100, 2, 1.5, "kb-1");
  send(c, 1400, 2, 1.5, "kb-2");
  const count = () => c.getObstacleOutcomes().filter((o) => o.eventId === "kpxg-boxing").length;
  assert.equal(count(), 1, "boxing wall finalized exactly once at expiry");
  assert.equal(c.getSnapshot().session.state, "playing", "session still playing past the wall expiry");
  for (let i = 1; i <= 10; i++) send(c, 1400 + i * 100, 2, 1.5, `kb-a${i}`);
  assert.equal(count(), 1, "boxing wall count stable at +1 s of live ticks after expiry");
}

console.log("B12 boxing nose-obstacle collision contact-signal validation passed.");
