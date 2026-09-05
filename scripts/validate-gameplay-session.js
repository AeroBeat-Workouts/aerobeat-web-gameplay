// @ts-check

import assert from "node:assert/strict";
import { isCountdownSnapshot, isGameplayJudgement, isGameplaySessionSnapshot, isObstacleOutcome } from "@aerobeat/web-contracts";
import { createPlaybackClock } from "../../aerobeat-web-audio/src/index.js";
import {
  aeroGameplaySessionCapabilities,
  createAeroGameplaySessionCoordinator
} from "../src/index.js";

const HASH = "a".repeat(64);

function variant(rulesetId = "boxing_semantic_track_v1", recipeId = "row_family_balanced_height_v1", id = "variant") {
  return { variantId: id, chartId: `chart-${id}`, mode: rulesetId === "flow_grid_v2" ? "flow" : "boxing", rulesetId, recipeId: rulesetId === "flow_grid_v2" ? null : recipeId, modifierIds: [], ranked: false, mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, provenance: { baseVariantId: id } };
}

function event(eventId, centerTimestampMs, type, extra = {}) {
  return { schema: "aerobeat/resolved_content_event", version: 3, eventId, variantId: "variant", chartId: "chart-variant", centerTimestampMs, sourceEventIds: [`source-${eventId}`], type, ...extra };
}

function canonicalFlowEvent(eventId, centerTimestampMs, authoredBeat, endTimestampMs) {
  return { schema: "aerobeat/resolved_content_event", version: 3, eventId, variantId: "variant", chartId: "chart-variant", centerTimestampMs, ...(endTimestampMs === undefined ? {} : { intervalStartTimestampMs: centerTimestampMs, intervalEndTimestampMs: endTimestampMs }), sourceEventIds: [`source-${eventId}`], authoredBeat };
}

function anchor(name, cell, subcell, measured = 1000) {
  return { schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "cal-1", measurementTimestampMs: measured, valid: true, confidence: 1, rawX: 0.5, rawY: 0.5, x: 0.5, y: 0.5, cell, subcell };
}

function evidence(frameId, measured, actions, overrides = {}) {
  const cells = { nose: 1, left_shoulder: 4, right_shoulder: 7, left_elbow: 4, right_elbow: 7, left_wrist: 5, right_wrist: 6 };
  const subs = { nose: 2, left_shoulder: 16, right_shoulder: 23, left_elbow: 16, right_elbow: 23, left_wrist: 20, right_wrist: 27 };
  const anchors = Object.entries(cells).map(([name, cell]) => anchor(name, cell, subs[name], measured));
  return { schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal-1", measuredSourceFrameId: frameId, measurementTimestampMs: measured, provenance: "measured", activeBoxingActions: actions, anchors, entries: [], ...overrides };
}

function input(measured, latestEvidence, options = {}) {
  return { calibration: { calibrationId: options.calibrationId ?? "cal-1", readiness: options.ready === false ? "calibration_required" : "countdown" }, tracking: { gameplayPaused: options.paused === true, freshCalibrationRequired: options.fresh === true }, countdownFrozen: options.paused === true, latestEvidence, straightQualifications: options.qualifications ?? [] };
}

function config(events, selected = variant(), shadowVariants = []) {
  return { packageId: "package-1", selectedVariant: selected, resolvedEvents: events, profileIdentity: { schema: "aerobeat/prototype_tuning_identity", version: 1, profileId: "profile", profileVersion: "1", contentHash: HASH, class: "between_run_ruleset", regenerationRequired: false }, shadowVariants };
}

function clock(positionMs, playing, durationMs = null) { return { contextTimeSeconds: positionMs / 1000, positionSeconds: positionMs / 1000, ...(durationMs === null ? {} : { durationSeconds: durationMs / 1000, progress: durationMs === 0 ? 0 : Math.min(1, positionMs / durationMs) }), playing }; }

function readyPlaying(coordinator, events, selected = variant()) {
  coordinator.configureContent(config(events, selected));
  coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) });
  assert.equal(coordinator.requestStart(0).accepted, true);
  coordinator.advance({ timestampMs: 1000, clock: clock(0, false) });
  coordinator.advance({ timestampMs: 2000, clock: clock(0, false) });
  coordinator.advance({ timestampMs: 3000, clock: clock(0, false) });
  assert.equal(coordinator.getSnapshot().session.state, "playing");
}

// Initial calibration gate and immutable frozen countdown against authoritative audio.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "gate", countdownStepMs: 1000 });
  coordinator.configureContent(config([event("punch", 1000, "hook_left")]));
  assert.equal(coordinator.requestStart(0).accepted, false);
  coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) });
  coordinator.requestStart(0);
  assert.equal(coordinator.getSnapshot().countdown.value, 3);
  coordinator.advance({ timestampMs: 1000, clock: clock(0, false) });
  assert.equal(coordinator.getSnapshot().countdown.value, 2);
  coordinator.advance({ timestampMs: 2000, clock: clock(0, false) });
  assert.equal(coordinator.getSnapshot().countdown.value, 1);
  coordinator.advance({ timestampMs: 3000, clock: clock(0, false) });
  assert.equal(coordinator.getSnapshot().session.state, "playing");
  assert.equal(coordinator.getSnapshot().session.timelinePositionMs, 0);
  assert.equal(isGameplaySessionSnapshot(coordinator.getSnapshot().session), true);
  assert.equal(isCountdownSnapshot(coordinator.getSnapshot().countdown), true);
  assert.equal(Object.isFrozen(coordinator.getSnapshot()), true);
  assert.equal(coordinator.getSnapshot().session.version, 2);
  assert.equal(coordinator.getSnapshot().session.purpose, "play");
}

// Visual Test starts immediately with audio-only lease, ignores input, never scores/judges, resumes directly, completes, and restarts generation-safely.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "visual-test", instanceId: "game-a" });
  coordinator.configureContent(config([event("visual-a", 500, "hook_left"), event("visual-b", 1000, "hook_right")]));
  coordinator.setLeaseSnapshot({ schema: "aerobeat/media_lease_snapshot", version: 1, ownerInstanceId: "game-a", generation: 1, state: "owned", resources: ["audio"] });
  const request = Object.freeze({ schema: "aerobeat/gameplay_session_start", version: 1, purpose: "visual_test" });
  const startedGeneration = coordinator.getSnapshot().generation;
  assert.deepEqual(coordinator.requestStart(0, request), { accepted: true, reason: null });
  assert.equal(coordinator.getSnapshot().generation, startedGeneration + 1);
  assert.deepEqual({ state: coordinator.getSnapshot().session.state, purpose: coordinator.getSnapshot().session.purpose, ranked: coordinator.getSnapshot().session.ranked, calibrationId: coordinator.getSnapshot().session.calibrationId }, { state: "playing", purpose: "visual_test", ranked: false, calibrationId: null });
  assert.equal(Object.isFrozen(coordinator.getSnapshot().session), true);
  assert.equal(isGameplaySessionSnapshot(coordinator.getSnapshot().session), true);
  coordinator.advance({ timestampMs: 100, clock: clock(250, true, 2000), input: input(100, evidence("ignored-frame", 100, ["hook_left"]), { paused: true, fresh: true }) });
  assert.equal(coordinator.getSnapshot().session.state, "playing");
  assert.equal(coordinator.getSnapshot().session.timelinePositionMs, 250);
  assert.deepEqual(coordinator.getJudgements(), []);
  assert.deepEqual(coordinator.getSnapshot().shadowJudgements, []);
  assert.deepEqual(coordinator.getScorePartitions(), []);
  coordinator.pause(200, "menu");
  assert.equal(coordinator.getSnapshot().session.state, "paused_manual");
  assert.deepEqual(coordinator.resume(300), { accepted: true, reason: null });
  assert.equal(coordinator.getSnapshot().session.state, "playing");
  coordinator.advance({ timestampMs: 400, clock: clock(2000, false, 2000) });
  assert.equal(coordinator.getSnapshot().session.state, "completed");
  assert.equal(coordinator.getSnapshot().session.timelinePositionMs, 2000);
  assert.deepEqual(coordinator.getSnapshot().judgements, []);
  assert.deepEqual(coordinator.getSnapshot().scorePartitions, []);
  const completedGeneration = coordinator.getSnapshot().generation;
  assert.equal(coordinator.requestStart(500, request).accepted, true);
  assert.equal(coordinator.getSnapshot().generation, completedGeneration + 1);
  assert.equal(coordinator.getSnapshot().session.timelinePositionMs, 0);
  assert.deepEqual(coordinator.getSnapshot().activeEventIds, []);
  assert.throws(() => coordinator.requestStart(501, { schema: "aerobeat/gameplay_session_start", version: 1, purpose: "visual_test", extra: true }), /exact public contract/u);
  let accessorCalls = 0;
  const accessorRequest = { schema: "aerobeat/gameplay_session_start", version: 1 };
  Object.defineProperty(accessorRequest, "purpose", { enumerable: true, get() { accessorCalls += 1; return "visual_test"; } });
  assert.throws(() => coordinator.requestStart(501, accessorRequest), /exact public contract/u);
  assert.equal(accessorCalls, 0);
  coordinator.destroy();
  assert.equal(coordinator.getSnapshot().session.state, "destroyed");
  assert.equal(isGameplaySessionSnapshot(coordinator.getSnapshot().session), true);
}

// Explicit Play restart remains calibration-gated while the legacy one-argument request stays compatible.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "explicit-play" });
  coordinator.configureContent(config([event("play-a", 1000, "hook_left")]));
  const playRequest = { schema: "aerobeat/gameplay_session_start", version: 1, purpose: "play" };
  assert.deepEqual(coordinator.requestStart(0, playRequest), { accepted: false, reason: "calibration_required" });
  assert.equal(coordinator.getSnapshot().session.purpose, "play");
  assert.equal(coordinator.getSnapshot().session.state, "calibrating");
  coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) });
  assert.equal(coordinator.requestStart(0).accepted, true);
}

// Sparse and huge timestamp jumps can advance only one countdown step, and every new step dwells from its actual transition.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "sparse-countdown", countdownStepMs: 1000 });
  coordinator.configureContent(config([]));
  coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) });
  coordinator.requestStart(0);
  coordinator.advance({ timestampMs: 100_000, clock: clock(0, false) });
  assert.deepEqual([coordinator.getSnapshot().session.state, coordinator.getSnapshot().countdown.value], ["countdown", 2]);
  coordinator.advance({ timestampMs: 100_000, clock: clock(0, false) });
  assert.equal(coordinator.getSnapshot().countdown.value, 2, "a second call at the transition timestamp cannot consume the new step");
  coordinator.advance({ timestampMs: 100_999, clock: clock(0, false) });
  assert.equal(coordinator.getSnapshot().countdown.value, 2);
  coordinator.advance({ timestampMs: 101_000, clock: clock(0, false) });
  assert.equal(coordinator.getSnapshot().countdown.value, 1);
  coordinator.advance({ timestampMs: 1_000_000, clock: clock(0, false) });
  assert.equal(coordinator.getSnapshot().session.state, "playing");
  assert.equal(coordinator.getSnapshot().session.timelinePositionMs, 0);
}

// Safety and lease loss cancel a sparse countdown immediately rather than waiting for the active step dwell.
{
  const tracking = createAeroGameplaySessionCoordinator({ sessionId: "sparse-tracking-cancel", countdownStepMs: 1000 });
  tracking.configureContent(config([]));
  tracking.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) });
  tracking.requestStart(0);
  tracking.advance({ timestampMs: 100_000, clock: clock(0, false) });
  assert.equal(tracking.getSnapshot().countdown.value, 2);
  tracking.advance({ timestampMs: 100_001, clock: clock(0, false), input: input(100_001, null, { paused: true, fresh: true }) });
  assert.equal(tracking.getSnapshot().session.state, "paused_tracking");
  assert.equal(tracking.getSnapshot().countdown.state, "cancelled");

  const lease = createAeroGameplaySessionCoordinator({ sessionId: "sparse-lease-cancel", instanceId: "game-a", countdownStepMs: 1000 });
  lease.configureContent(config([]));
  lease.setLeaseSnapshot({ schema: "aerobeat/media_lease_snapshot", version: 1, ownerInstanceId: "game-a", generation: 1, state: "owned", resources: ["camera", "audio"] });
  lease.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) });
  lease.requestStart(0);
  lease.advance({ timestampMs: 100_000, clock: clock(0, false) });
  assert.equal(lease.getSnapshot().countdown.value, 2);
  lease.setLeaseSnapshot({ schema: "aerobeat/media_lease_snapshot", version: 1, ownerInstanceId: "game-b", generation: 2, state: "owned", resources: ["camera", "audio"] });
  assert.equal(lease.getSnapshot().session.state, "paused_manual");
  assert.equal(lease.getSnapshot().session.pauseReason, "media_lease_unavailable");
  assert.equal(lease.getSnapshot().countdown.state, "cancelled");
}

// Countdown rejects advancing audio.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "countdown-audio" });
  coordinator.configureContent(config([]));
  coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) });
  coordinator.requestStart(0);
  coordinator.advance({ timestampMs: 10, clock: clock(10, true) });
  assert.equal(coordinator.getSnapshot().session.state, "paused_manual");
  assert.equal(coordinator.getSnapshot().session.pauseReason, "countdown_audio_not_frozen");
}

// Countdown rejects paused-clock drift and preserves the frozen gameplay position.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "countdown-drift" });
  coordinator.configureContent(config([]));
  coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) });
  coordinator.requestStart(0);
  coordinator.advance({ timestampMs: 10, clock: clock(1, false) });
  assert.equal(coordinator.getSnapshot().session.state, "paused_manual");
  assert.equal(coordinator.getSnapshot().session.pauseReason, "countdown_audio_not_frozen");
  assert.equal(coordinator.getSnapshot().session.timelinePositionMs, 0);
}

// A running audio-clock rollback fails closed without rewinding gameplay truth.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "clock-rollback" });
  readyPlaying(coordinator, [event("future", 5000, "hook_left")]);
  coordinator.advance({ timestampMs: 3100, clock: clock(1000, true), input: input(3100, null) });
  coordinator.advance({ timestampMs: 3200, clock: clock(900, true), input: input(3200, null) });
  assert.equal(coordinator.getSnapshot().session.state, "paused_manual");
  assert.equal(coordinator.getSnapshot().session.pauseReason, "audio_clock_rollback");
  assert.equal(coordinator.getSnapshot().session.timelinePositionMs, 1000);
}

// Inclusive -180ms semantic straight boundary and exact 100ms start qualification.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "semantic" });
  readyPlaying(coordinator, [event("straight", 1000, "straight_left")]);
  const sample = evidence("frame-semantic", 3100, ["straight_left"]);
  coordinator.advance({ timestampMs: 3100, clock: clock(820, true), input: input(3100, sample, { qualifications: [{ hand: "left", semanticStartTimestampMs: 3000, semanticDurationMs: 100, semanticQualified: true, spatialStartTimestampMs: null, spatialDurationMs: 0, spatialQualified: false, acceptedSubcellColumns: [] }] }) });
  assert.equal(coordinator.getJudgements()[0].result, "hit");
  assert.equal(coordinator.getJudgements()[0].timingOffsetMs, -180);
  assert.equal(coordinator.getJudgements()[0].committedTimelinePositionMs, 820);
  assert.equal(isGameplayJudgement(coordinator.getJudgements()[0]), true);
  const partition = coordinator.getScorePartitions()[0];
  assert.equal(partition.localOnly, true);
  assert.equal(partition.ranked, false);
  assert.equal(partition.rulesetId, "boxing_semantic_track_v1");
  assert.equal(partition.recipeId, "row_family_balanced_height_v1");
  assert.equal(partition.mapHash.value, HASH);
  assert.equal(partition.scoreIdentityHash.value, HASH);
  assert.equal(partition.profileId, "profile");
  assert.equal(partition.profileVersion, "1");
  assert.equal(partition.profileHash, HASH);
  assert.equal(partition.profileClass, "between_run_ruleset");
  assert.equal(partition.regenerationRequired, false);
  assert.deepEqual(partition.scoringSettings, { comboBonusPerHit: 0, hitPoints: 1, missPenalty: 0 });
  assert.equal(partition.scoringSettingsIdentity, "scoring-v1:1,0,0");
  assert.match(partition.partitionId, new RegExp(`${HASH}\\|${HASH}\\|profile\\|1\\|${HASH}\\|between_run_ruleset\\|live\\|scoring-v1:1,0,0$`, "u"));
}

// Inclusive +180ms boundary and 150ms freshness fail closed beyond the limit.
{
  const boundary = createAeroGameplaySessionCoordinator({ sessionId: "plus-boundary" });
  readyPlaying(boundary, [event("hook", 1000, "hook_left")]);
  boundary.advance({ timestampMs: 4000, clock: clock(1180, true), input: input(4000, evidence("frame-plus", 4000, ["hook_left"])) });
  assert.equal(boundary.getJudgements()[0].timingOffsetMs, 180);
  assert.equal(boundary.getJudgements()[0].committedTimelinePositionMs, 1180);

  const freshBoundary = createAeroGameplaySessionCoordinator({ sessionId: "fresh-boundary" });
  readyPlaying(freshBoundary, [event("fresh-hook", 1000, "hook_left")]);
  freshBoundary.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, evidence("frame-fresh", 3850, ["hook_left"])) });
  assert.equal(freshBoundary.getJudgements()[0].result, "hit");

  const stale = createAeroGameplaySessionCoordinator({ sessionId: "stale" });
  readyPlaying(stale, [event("stale-hook", 1000, "hook_left")]);
  const old = evidence("frame-stale", 3000, ["hook_left"]);
  stale.advance({ timestampMs: 3151, clock: clock(1000, true), input: input(3151, old) });
  stale.advance({ timestampMs: 3300, clock: clock(1181, true) });
  assert.deepEqual(stale.getJudgements()[0].diagnostics, ["stale_input"]);
  assert.equal(stale.getJudgements()[0].result, "miss");
  assert.equal(stale.getJudgements()[0].committedTimelinePositionMs, 1181);
}

// All four Boxing candidate identities configure independently.
{
  for (const rulesetId of ["boxing_semantic_track_v1", "boxing_spatial_grid_v1"]) for (const recipeId of ["row_family_balanced_height_v1", "cut_family_source_height_v1"]) {
    const coordinator = createAeroGameplaySessionCoordinator({ sessionId: `${rulesetId}-${recipeId}` });
    const extra = rulesetId === "boxing_spatial_grid_v1" ? { spatialTarget: { targetCell: 5, acceptedSubcells: [20], sourceCell: 9, entryDirection: "up" } } : {};
    coordinator.configureContent(config([event("candidate", 1000, "hook_left", extra)], variant(rulesetId, recipeId)));
    assert.equal(coordinator.getSnapshot().selectedVariant.rulesetId, rulesetId);
    assert.equal(coordinator.getSnapshot().selectedVariant.recipeId, recipeId);
  }
}

// Consume the actual content-runtime envelope; authored beat fields drive gameplay.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "content-envelope" });
  const authoredBeat = { start: 1, type: "hook_left", eventId: "runtime-hook", sourceEventIds: ["source-runtime-hook"], spatialTarget: { targetCell: 5, acceptedSubcells: [20], sourceCell: 9, entryDirection: "up" } };
  const resolved = { schema: "aerobeat/resolved_content_event", version: 3, eventId: "runtime-hook", variantId: "variant", chartId: "chart-variant", centerTimestampMs: 1000, authoredBeat };
  readyPlaying(coordinator, [resolved]);
  coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, evidence("frame-runtime", 4000, ["hook_left"])) });
  const judgement = coordinator.getJudgements()[0];
  assert.equal(judgement.result, "hit");
  assert.equal(judgement.version, 2);
  assert.equal(judgement.sessionPurpose, "play");
  assert.equal(judgement.committedTimelinePositionMs, 1000);
  assert.equal(isGameplayJudgement(judgement), true);
}

// Spatial grid: exact accepted subcell, cardinal entry, and straight qualification.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "spatial" });
  const spatial = variant("boxing_spatial_grid_v1", "cut_family_source_height_v1");
  readyPlaying(coordinator, [event("spatial-straight", 1000, "straight_left", { spatialTarget: { targetCell: 5, acceptedSubcells: [20], sourceCell: 9, entryDirection: "up", qualificationMs: 100 } })], spatial);
  const sample = evidence("frame-spatial", 4000, ["straight_left"]);
  sample.entries = [{ schema: "aerobeat/body_grid_cell_entry", version: 1, anchor: "left_wrist", calibrationId: "cal-1", measurementTimestampMs: 4000, fromCell: 9, toCell: 5, direction: "up", provenance: "measured" }];
  coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, sample, { qualifications: [{ hand: "left", semanticStartTimestampMs: 3800, semanticDurationMs: 200, semanticQualified: true, spatialStartTimestampMs: 3900, spatialDurationMs: 100, spatialQualified: true, acceptedSubcellColumns: [4] }] }) });
  assert.equal(coordinator.getJudgements()[0].result, "hit");
  assert.equal(coordinator.getJudgements()[0].rulesetId, "boxing_spatial_grid_v1");
}

// Spatial crossed-guard checkpoints consume the same measured wrist sample.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "crossed-guard" });
  const spatial = variant("boxing_spatial_grid_v1", "row_family_balanced_height_v1");
  readyPlaying(coordinator, [event("crossed", 1000, "guard", { guardTarget: { leftCell: 6, rightCell: 5, crossed: true } })], spatial);
  const sample = evidence("frame-crossed", 4000, ["crossed_guard"]);
  sample.anchors.find((entry) => entry.anchor === "left_wrist").cell = 6;
  sample.anchors.find((entry) => entry.anchor === "right_wrist").cell = 5;
  coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, sample) });
  assert.equal(coordinator.getJudgements()[0].result, "hit");
}

// Flow maps every Beat Saber arrow direction 0..7 into exact eight-way measured evidence.
{
  const flow = variant("flow_grid_v2", "row_family_balanced_height_v1");
  const directionCases = [[0,"up"],[1,"down"],[2,"left"],[3,"right"],[4,"up-left"],[5,"up-right"],[6,"down-left"],[7,"down-right"]];
  for (const [numericDirection, measuredDirection] of directionCases) {
    const hit = createAeroGameplaySessionCoordinator({ sessionId: `flow-hit-${numericDirection}` });
    readyPlaying(hit, [event(`flow-${numericDirection}`, 500, "note", { hand: "left", placement: 5, direction: numericDirection })], flow);
    const hitSample = evidence(`frame-flow-${numericDirection}`, 3500, []);
    hitSample.entries = [{ schema: "aerobeat/body_grid_cell_entry", version: 1, anchor: "left_wrist", calibrationId: "cal-1", measurementTimestampMs: 3500, fromCell: 9, toCell: 5, direction: measuredDirection, provenance: "measured" }];
    hit.advance({ timestampMs: 3500, clock: clock(500, true), input: input(3500, hitSample) });
    assert.deepEqual(hit.getJudgements().map((entry) => [entry.result, entry.diagnostics]), [["hit", []]]);

    const miss = createAeroGameplaySessionCoordinator({ sessionId: `flow-miss-${numericDirection}` });
    readyPlaying(miss, [event(`flow-wrong-${numericDirection}`, 500, "note", { hand: "left", placement: 5, direction: numericDirection })], flow);
    const missSample = evidence(`frame-flow-wrong-${numericDirection}`, 3500, []);
    const wrongDirection = directionCases[(numericDirection + 1) % directionCases.length][1];
    missSample.entries = [{ schema: "aerobeat/body_grid_cell_entry", version: 1, anchor: "left_wrist", calibrationId: "cal-1", measurementTimestampMs: 3500, fromCell: 9, toCell: 5, direction: wrongDirection, provenance: "measured" }];
    miss.advance({ timestampMs: 3500, clock: clock(681, true), input: input(3500, missSample) });
    assert.deepEqual(miss.getJudgements().map((entry) => [entry.result, entry.diagnostics]), [["miss", ["wrong_direction"]]]);
  }
}

// Beat Saber dot direction 8 is represented by an omitted direction and needs cell entry only.
{
  const flow = variant("flow_grid_v2", "row_family_balanced_height_v1");
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "flow-dot" });
  readyPlaying(coordinator, [event("flow-dot", 500, "note", { hand: "left", placement: 5 })], flow);
  const dotSample = evidence("frame-flow-dot", 3500, []);
  dotSample.entries = [{ schema: "aerobeat/body_grid_cell_entry", version: 1, anchor: "left_wrist", calibrationId: "cal-1", measurementTimestampMs: 3500, fromCell: 9, toCell: 5, direction: "down-right", provenance: "measured" }];
  coordinator.advance({ timestampMs: 3500, clock: clock(500, true), input: input(3500, dotSample) });
  assert.deepEqual(coordinator.getJudgements().map((entry) => [entry.result, entry.diagnostics]), [["hit", []]]);

  const noEntry = createAeroGameplaySessionCoordinator({ sessionId: "flow-dot-no-entry" });
  readyPlaying(noEntry, [event("flow-dot-no-entry", 500, "note", { hand: "left", placement: 5 })], flow);
  noEntry.advance({ timestampMs: 3500, clock: clock(681, true), input: input(3500, evidence("frame-flow-dot-no-entry", 3500, [])) });
  assert.deepEqual(noEntry.getJudgements().map((entry) => [entry.result, entry.diagnostics]), [["miss", ["no_input"]]]);

  for (const invalidDirection of [-1, 8, 9, 1.5, "UP", "up_left", "diagonal", null]) {
    const invalid = createAeroGameplaySessionCoordinator({ sessionId: `flow-invalid-${String(invalidDirection)}` });
    assert.throws(() => invalid.configureContent(config([event("invalid-flow", 500, "note", { hand: "left", placement: 5, direction: invalidDirection })], flow)), /Flow note direction is unsupported/u);
  }
}

// Boxing spatial targets remain cardinal-only even though measured evidence is eight-way.
{
  const spatial = variant("boxing_spatial_grid_v1", "cut_family_source_height_v1");
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "boxing-diagonal-target" });
  assert.throws(() => coordinator.configureContent(config([event("diagonal-hook", 500, "hook_left", { spatialTarget: { targetCell: 5, acceptedSubcells: [20], sourceCell: 9, entryDirection: "up-left" } })], spatial)), /Spatial entry direction is invalid/u);
}

// Flow wrong-direction evidence misses, while non-note source events are explicitly ignored.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "flow-diagnostics" });
  const flow = variant("flow_grid_v2", "row_family_balanced_height_v1");
  readyPlaying(coordinator, [event("wrong-flow", 500, "note", { hand: "left", placement: 5, direction: "up" }), event("flow-bomb", 900, "bomb", { placement: 6 })], flow);
  const sample = evidence("frame-flow-wrong", 3500, []);
  sample.entries = [{ schema: "aerobeat/body_grid_cell_entry", version: 1, anchor: "left_wrist", calibrationId: "cal-1", measurementTimestampMs: 3500, fromCell: 1, toCell: 5, direction: "down", provenance: "measured" }];
  coordinator.advance({ timestampMs: 3500, clock: clock(681, true), input: input(3500, sample) });
  coordinator.advance({ timestampMs: 3700, clock: clock(900, true), input: input(3700, null) });
  assert.deepEqual(coordinator.getJudgements().map((entry) => [entry.eventId, entry.result, entry.diagnostics]), [["wrong-flow", "miss", ["wrong_direction"]], ["flow-bomb", "ignored", []]]);
}

// Source-geometry Flow obstacles validate transactionally; obstacle truth is separate from note judgements.
{
  const flow = variant("flow_grid_v2", "row_family_balanced_height_v1");
  const sourceGeometry={schema:"aerobeat/obstacle_source_geometry",version:1,coordinateSpace:"beatsaber_v2_legacy_obstacle",kind:"v2_type_1",x:1,y:2,width:1,height:3};const gameplayGeometry={schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",x:1,y:0,width:1,height:3};
  const valid = [
    canonicalFlowEvent("canonical-bomb", 500, { start: 1, type: "bomb", placement: 11 }),
    canonicalFlowEvent("canonical-obstacle", 700, { start: 1.4, end: 2, type: "obstacle", sourceGeometry,gameplayGeometry,gridMask:[1,5,9] }, 1000),
    canonicalFlowEvent("canonical-arc", 900, { start: 1.8, end: 2.4, type: "arc", hand: "left", startPlacement: 8, endPlacement: 3, startDirection: 0, endDirection: 8 }, 1200),
    canonicalFlowEvent("canonical-burst", 1100, { start: 2.2, end: 2.6, type: "burst", hand: "right", placement: 10, tailPlacement: 2, direction: 8, checkpointCount: 4 }, 1300)
  ];
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "flow-canonical-non-notes" });
  readyPlaying(coordinator, valid, flow);
  coordinator.advance({ timestampMs: 5000, clock: clock(1300, true), input: input(5000, null) });
  assert.deepEqual(coordinator.getJudgements().map((entry) => [entry.eventId, entry.result]), [["canonical-bomb", "ignored"], ["canonical-arc", "ignored"], ["canonical-burst", "ignored"]]);
  assert.equal(coordinator.getObstacleOutcomes()[0].result, "unevaluated_tracking");

  const stable = createAeroGameplaySessionCoordinator({ sessionId: "flow-invalid-non-note-transaction" });
  stable.configureContent(config([event("stable-bomb", 500, "bomb", { placement: 4 })], flow));
  const before = JSON.stringify(stable.getSnapshot());
  const invalid = [
    canonicalFlowEvent("mask-mismatch", 500, { start: 1, end: 2, type:"obstacle",sourceGeometry,gameplayGeometry,gridMask:[1] }, 1000),
    canonicalFlowEvent("duration-zero", 500, { start: 1, end: 1, type: "obstacle", sourceGeometry,gameplayGeometry,gridMask:[1,5,9] }, 500),
    canonicalFlowEvent("authored-shadow", 500, { start: 1, end: 2, type: "obstacle", sourceGeometry,gameplayGeometry,gridMask:[1,5,9], intervalEndTimestampMs: 1000 }, 1000)
  ];
  for (const candidate of invalid) { assert.throws(() => stable.configureContent(config([candidate], flow))); assert.equal(JSON.stringify(stable.getSnapshot()), before); }
}

// Sparse 15 fps endpoints retain analytical 25 ms wall collision across one or many display-rate repeats.
{
  const flow = variant("flow_grid_v2", null);
  const sourceGeometry={schema:"aerobeat/obstacle_source_geometry",version:1,coordinateSpace:"beatsaber_v2_legacy_obstacle",kind:"v2_type_1",x:1,y:2,width:1,height:3};const gameplayGeometry={schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",x:1,y:0,width:1,height:3};
  const walls = [canonicalFlowEvent("a-wall", 700, { start: 1.4, end: 1.45, type: "obstacle", sourceGeometry,gameplayGeometry,gridMask:[1,5,9] }, 725), canonicalFlowEvent("b-wall", 700, { start: 1.4, end: 1.45, type: "obstacle", sourceGeometry,gameplayGeometry,gridMask:[1,5,9] }, 725)];
  const setNose = (sample, x, y = 0) => { const nose = sample.anchors.find((entry) => entry.anchor === "nose"); nose.x = x; nose.y = y; return sample; };
  for (const repeatOffsets of [[16], [10, 20, 30, 40, 50]]) {
    const coordinator = createAeroGameplaySessionCoordinator({ sessionId: `continuous-wall-${repeatOffsets.length}` });
    readyPlaying(coordinator, [event("combo-note", 500, "note", { hand: "left", placement: 5 }), ...walls], flow);
    const note = evidence(`combo-frame-${repeatOffsets.length}`, 3500, []);
    note.entries = [{ schema: "aerobeat/body_grid_cell_entry", version: 1, anchor: "left_wrist", calibrationId: "cal-1", measurementTimestampMs: 3500, fromCell: 9, toCell: 5, direction: "down-right", provenance: "measured" }];
    coordinator.advance({ timestampMs: 3500, clock: clock(500, true), input: input(3500, note) });
    const first = setNose(evidence(`wall-before-${repeatOffsets.length}`, 3680, []), 0.125);
    coordinator.advance({ timestampMs: 3680, clock: clock(680, true), input: input(3680, first) });
    for (const offset of repeatOffsets) coordinator.advance({ timestampMs: 3680 + offset, clock: clock(680 + offset, true), input: input(3680, first) });
    const second = setNose(evidence(`wall-after-${repeatOffsets.length}`, 3740, []), 0.875);
    coordinator.advance({ timestampMs: 3740, clock: clock(740, true), input: input(3740, second) });
    assert.equal(coordinator.getObstacleOutcomes().every(isObstacleOutcome), true);
    assert.deepEqual(coordinator.getObstacleOutcomes().map((entry) => [entry.eventId, entry.result, entry.consequenceApplied]), [["a-wall", "contact", true], ["b-wall", "contact", false]]);
    const partition = coordinator.getScorePartitions()[0];
    assert.deepEqual([partition.hits, partition.misses, partition.score, partition.maxCombo, partition.combo, partition.obstacleContacts], [1, 0, 1, 1, 0, 1], "overlapping walls reset one combo with zero score delta and unchanged note counts");
    assert.deepEqual(coordinator.getJudgements().map((entry) => [entry.eventId, entry.result]), [["combo-note", "hit"]], "obstacles never add or rewrite note judgements");
  }
}

// Repeated valid frames also preserve complete measured avoidance coverage without creating score truth.
{
  const flow = variant("flow_grid_v2", null);
  const sourceGeometry={schema:"aerobeat/obstacle_source_geometry",version:1,coordinateSpace:"beatsaber_v2_legacy_obstacle",kind:"v2_type_1",x:1,y:2,width:1,height:3};const gameplayGeometry={schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",x:1,y:0,width:1,height:3};
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "repeated-wall-avoidance" });
  readyPlaying(coordinator, [canonicalFlowEvent("avoided-wall", 700, { start: 1.4, end: 1.45, type: "obstacle", sourceGeometry,gameplayGeometry,gridMask:[1,5,9] }, 725)], flow);
  const first = evidence("avoid-before", 4000, []); const firstNose = first.anchors.find((entry) => entry.anchor === "nose"); firstNose.x = 0.125; firstNose.y = 0.5;
  coordinator.advance({ timestampMs: 4000, clock: clock(680, true), input: input(4000, first) });
  for (const offset of [10, 20, 30, 40, 50]) coordinator.advance({ timestampMs: 4000 + offset, clock: clock(680 + offset, true), input: input(4000, first) });
  const second = evidence("avoid-after", 4060, []); const secondNose = second.anchors.find((entry) => entry.anchor === "nose"); secondNose.x = 0.125; secondNose.y = 0.5;
  coordinator.advance({ timestampMs: 4060, clock: clock(740, true), input: input(4060, second) });
  assert.deepEqual(coordinator.getObstacleOutcomes().map((entry) => entry.result), ["avoided"]);
  assert.equal(coordinator.getScorePartitions().length, 0);
  assert.equal(coordinator.getJudgements().length, 0);
}

// Repeated display advances preserve sustained aggregate occupancy; only a measured leave/re-entry starts another consequence.
{
  const flow = variant("flow_grid_v2", null);
  const sourceGeometry={schema:"aerobeat/obstacle_source_geometry",version:1,coordinateSpace:"beatsaber_v2_legacy_obstacle",kind:"v2_type_1",x:1,y:2,width:1,height:3};const gameplayGeometry={schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",x:1,y:0,width:1,height:3};
  const wall = canonicalFlowEvent("sustained-wall", 600, { start: 1.2, end: 2.4, type: "obstacle", sourceGeometry,gameplayGeometry,gridMask:[1,5,9] }, 1200);
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "sustained-wall" });
  readyPlaying(coordinator, [wall], flow);
  const send = (frameId, measured, timeline, x) => { const sample = evidence(frameId, measured, []); const nose = sample.anchors.find((entry) => entry.anchor === "nose"); nose.x = x; nose.y = 0; coordinator.advance({ timestampMs: measured, clock: clock(timeline, true), input: input(measured, sample) }); return sample; };
  send("sustained-before", 3500, 500, 0.125);
  const inside = send("sustained-inside", 3650, 650, 0.5);
  assert.equal(coordinator.getScorePartitions()[0].obstacleContacts, 1);
  for (const offset of [16, 32, 48]) coordinator.advance({ timestampMs: 3650 + offset, clock: clock(650 + offset, true), input: input(3650, inside) });
  send("sustained-inside-fresh", 3700, 700, 0.5);
  assert.equal(coordinator.getScorePartitions()[0].obstacleContacts, 1, "repeats and fresh inside samples cannot repeat the overlap consequence");
  send("sustained-leave", 3800, 800, 0.875);
  send("sustained-reenter", 3900, 900, 0.5);
  assert.equal(coordinator.getScorePartitions()[0].obstacleContacts, 2, "measured leave and re-entry deterministically create a new episode");
  const final = send("sustained-after", 4250, 1250, 0.875);
  assert.ok(final);
  assert.deepEqual(coordinator.getObstacleOutcomes().map((entry) => entry.result), ["contact"]);
  const partition = coordinator.getScorePartitions()[0];
  assert.deepEqual([partition.hits, partition.misses, partition.score, partition.obstacleContacts], [0, 0, 0, 2]);
  assert.equal(coordinator.getJudgements().length, 0);
}

// Every invalid or discontinuous boundary still severs the sparse interpolation chain.
{
  const flow = variant("flow_grid_v2", null);
  const sourceGeometry={schema:"aerobeat/obstacle_source_geometry",version:1,coordinateSpace:"beatsaber_v2_legacy_obstacle",kind:"v2_type_1",x:1,y:2,width:1,height:3};const gameplayGeometry={schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",x:1,y:0,width:1,height:3};
  const wall = () => canonicalFlowEvent("boundary-wall", 700, { start: 1.4, end: 1.45, type: "obstacle", sourceGeometry,gameplayGeometry,gridMask:[1,5,9] }, 725);
  const setNose = (sample, x) => { const nose = sample.anchors.find((entry) => entry.anchor === "nose"); nose.x = x; nose.y = 0; return sample; };
  const assertSevered = (label, insert, secondTimestampMs = 4060, secondCalibrationId = "cal-1") => {
    const coordinator = createAeroGameplaySessionCoordinator({ sessionId: `boundary-${label}` });
    readyPlaying(coordinator, [wall()], flow);
    const first = setNose(evidence("boundary-before", 4000, []), 0.125);
    coordinator.advance({ timestampMs: 4000, clock: clock(680, true), input: input(4000, first) });
    insert(coordinator, first);
    const second = setNose(evidence("boundary-after", secondTimestampMs, []), 0.875);
    second.calibrationId = secondCalibrationId;
    for (const anchorEntry of second.anchors) anchorEntry.calibrationId = secondCalibrationId;
    coordinator.advance({ timestampMs: secondTimestampMs, clock: clock(740, true), input: input(secondTimestampMs, second, { calibrationId: secondCalibrationId }) });
    assert.deepEqual(coordinator.getObstacleOutcomes().map((entry) => entry.result), ["unevaluated_tracking"], `${label} must prevent clipping across the boundary`);
    assert.equal(coordinator.getScorePartitions().length, 0, `${label} uncertainty is nonpenalizing`);
    assert.equal(coordinator.getJudgements().length, 0, `${label} cannot create note truth`);
  };
  assertSevered("invalid-fresh", (coordinator) => { const invalid = setNose(evidence("boundary-invalid", 4010, []), 0.5); invalid.anchors.find((entry) => entry.anchor === "nose").confidence = 0.49; coordinator.advance({ timestampMs: 4010, clock: clock(690, true), input: input(4010, invalid) }); });
  assertSevered("invalid-duplicate", (coordinator) => { const invalid = setNose(evidence("boundary-before", 4000, []), 0.125); invalid.anchors.find((entry) => entry.anchor === "nose").confidence = 0.49; coordinator.advance({ timestampMs: 4010, clock: clock(690, true), input: input(4000, invalid) }); });
  assertSevered("conflicting-duplicate", (coordinator) => { const conflicting = setNose(evidence("boundary-before", 4000, []), 0.5); coordinator.advance({ timestampMs: 4010, clock: clock(690, true), input: input(4000, conflicting) }); });
  assertSevered("stale-duplicate", (coordinator, first) => coordinator.advance({ timestampMs: 4151, clock: clock(700, true), input: input(4000, first) }), 4160);
  assertSevered("measurement-rollback", (coordinator) => coordinator.advance({ timestampMs: 4010, clock: clock(690, true), input: input(3990, setNose(evidence("boundary-rollback", 3990, []), 0.125)) }));
  assertSevered("gap-over-150ms", () => {}, 4160);
  assertSevered("calibration-change", (coordinator) => { const changed = setNose(evidence("boundary-calibration", 4010, []), 0.125); changed.calibrationId = "cal-2"; for (const anchorEntry of changed.anchors) anchorEntry.calibrationId = "cal-2"; coordinator.advance({ timestampMs: 4010, clock: clock(730, true), input: input(4010, changed, { calibrationId: "cal-2" }) }); }, 4060, "cal-2");

  const lost = createAeroGameplaySessionCoordinator({ sessionId: "boundary-tracking-loss" });
  readyPlaying(lost, [wall()], flow);
  lost.advance({ timestampMs: 4000, clock: clock(680, true), input: input(4000, setNose(evidence("lost-before", 4000, []), 0.125)) });
  lost.advance({ timestampMs: 4010, clock: clock(690, true), input: input(4010, null, { paused: true, fresh: true }) });
  const recovered = setNose(evidence("lost-after", 7030, []), 0.875); recovered.calibrationId = "cal-2"; for (const anchorEntry of recovered.anchors) anchorEntry.calibrationId = "cal-2";
  lost.advance({ timestampMs: 4020, clock: clock(680, false), input: input(4020, null, { calibrationId: "cal-2" }) });
  lost.advance({ timestampMs: 5020, clock: clock(680, false) }); lost.advance({ timestampMs: 6020, clock: clock(680, false) }); lost.advance({ timestampMs: 7020, clock: clock(680, false) });
  lost.advance({ timestampMs: 7030, clock: clock(740, true), input: input(7030, recovered, { calibrationId: "cal-2" }) });
  assert.deepEqual(lost.getObstacleOutcomes().map((entry) => entry.result), ["unevaluated_tracking"], "tracking loss severs continuity through recovery");
  assert.equal(lost.getScorePartitions().length, 0);
}

// Same-frame guard/punch overlap is exclusive, while disjoint squat+punch is concurrent.
{
  const overlap = createAeroGameplaySessionCoordinator({ sessionId: "overlap" });
  readyPlaying(overlap, [event("a-guard", 1000, "guard", { guardTarget: { leftCell: 5, rightCell: 6 } }), event("b-hook", 1000, "hook_left")]);
  overlap.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, evidence("frame-overlap", 4000, ["guard", "hook_left"])) });
  assert.deepEqual(overlap.getJudgements().map((entry) => [entry.result, entry.diagnostics]), [["hit", []], ["miss", ["blocked_overlap"]]]);

  const disjoint = createAeroGameplaySessionCoordinator({ sessionId: "disjoint" });
  readyPlaying(disjoint, [event("a-squat", 1000, "squat", { checkpoint: { kind: "instantaneous", noseSafeCells: [1] } }), event("b-hook", 1000, "hook_left")]);
  disjoint.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, evidence("frame-disjoint", 4000, ["squat", "hook_left"])) });
  assert.deepEqual(disjoint.getJudgements().map((entry) => entry.result), ["hit", "hit"]);
}

// Wrong evidence never consumes the later positive action in the same timing window.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "positive-only" });
  readyPlaying(coordinator, [event("positive-hook", 1000, "hook_left")]);
  coordinator.advance({ timestampMs: 3900, clock: clock(900, true), input: input(3900, evidence("wrong-frame", 3900, ["hook_right"])) });
  assert.equal(coordinator.getJudgements().length, 0);
  coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, evidence("right-frame", 4000, ["hook_left"])) });
  assert.equal(coordinator.getJudgements()[0].result, "hit");
}

// One action cannot satisfy duplicate targets; no input becomes a deterministic miss.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "consume" });
  readyPlaying(coordinator, [event("a-hook", 1000, "hook_left"), event("b-hook", 1000, "hook_left"), event("empty", 1500, "hook_right")]);
  coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, evidence("frame-consume", 4000, ["hook_left"])) });
  assert.deepEqual(coordinator.getJudgements().slice(0, 2).map((entry) => entry.diagnostics), [[], ["action_consumed"]]);
  coordinator.advance({ timestampMs: 4700, clock: clock(1681, true), input: input(4700, null) });
  assert.equal(coordinator.getJudgements().find((entry) => entry.eventId === "empty")?.result, "miss");
}

// Tracking loss clears evidence, freezes/cancels, and requires a fresh calibration before countdown.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "tracking" });
  readyPlaying(coordinator, [event("late", 9000, "hook_left")]);
  coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, null, { paused: true, fresh: true }) });
  assert.equal(coordinator.getSnapshot().session.state, "paused_tracking");
  coordinator.advance({ timestampMs: 4500, clock: clock(1000, false), input: input(4500, null, { calibrationId: "cal-1" }) });
  assert.equal(coordinator.getSnapshot().session.state, "paused_tracking", "the invalidated calibration cannot resume gameplay");
  assert.equal(coordinator.getSnapshot().safety.freshCalibrationRequired, true);
  coordinator.advance({ timestampMs: 5000, clock: clock(1000, false), input: input(5000, null, { calibrationId: "cal-2" }) });
  assert.equal(coordinator.getSnapshot().session.state, "countdown");
  assert.equal(coordinator.getSnapshot().countdown.reason, "tracking_resume");
  assert.equal(coordinator.getSnapshot().countdown.value, 3);
  coordinator.advance({ timestampMs: 50_000, clock: clock(0, false) });
  assert.equal(coordinator.getSnapshot().countdown.value, 2, "tracking recovery cannot skip directly through a sparse countdown");
  coordinator.advance({ timestampMs: 50_999, clock: clock(0, false) });
  assert.equal(coordinator.getSnapshot().countdown.value, 2);
  coordinator.advance({ timestampMs: 51_000, clock: clock(0, false) });
  assert.equal(coordinator.getSnapshot().countdown.value, 1);
  coordinator.advance({ timestampMs: 52_000, clock: clock(0, false) });
  assert.equal(coordinator.getSnapshot().session.state, "playing");
  assert.equal(coordinator.getSnapshot().session.timelinePositionMs, 0);
}

// Paused future swap preserves judged and active IDs, replaces only future events.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "swap" });
  readyPlaying(coordinator, [event("past", 1000, "hook_left"), event("active", 2000, "hook_right"), event("old-future", 3000, "squat")]);
  coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, evidence("frame-past", 4000, ["hook_left"])) });
  coordinator.setActiveEventIds(["active"]);
  coordinator.pause(4100);
  const nextConfiguration = config([{ ...event("replacement", 3000, "weave_left"), variantId: "variant-next", chartId: "chart-variant-next" }], variant("boxing_semantic_track_v1", "cut_family_source_height_v1", "variant-next"));
  nextConfiguration.profileIdentity = { ...nextConfiguration.profileIdentity, profileVersion: "2", contentHash: "b".repeat(64) };
  coordinator.applyFutureContent(nextConfiguration);
  const snapshot = coordinator.getSnapshot();
  assert.deepEqual(snapshot.judgedEventIds, ["past"]);
  assert.deepEqual(snapshot.activeEventIds, ["active"]);
  assert.equal(snapshot.selectedVariant.variantId, "variant-next");
  coordinator.resume(4100);
  coordinator.advance({ timestampMs: 5100, clock: clock(1000, false) });
  coordinator.advance({ timestampMs: 6100, clock: clock(1000, false) });
  coordinator.advance({ timestampMs: 7100, clock: clock(1000, false) });
  coordinator.advance({ timestampMs: 8000, clock: clock(2000, true), input: input(8000, evidence("active-old-frame", 8000, ["hook_right"])) });
  const activeJudgement = coordinator.getJudgements().find((entry) => entry.eventId === "active");
  assert.equal(activeJudgement?.recipeId, "row_family_balanced_height_v1");
  assert.equal(activeJudgement?.sessionPurpose, "play");
  assert.equal(coordinator.getScorePartitions().some((entry) => entry.variantId === "variant" && entry.profileVersion === "1"), true);
}

// Same-variant swaps retain immutable old event truth and deterministic ID ownership.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "same-variant-swap" });
  const initial = config([event("same-past", 1000, "hook_left"), event("same-active", 3000, "squat"), event("same-future", 4000, "hook_right")]);
  initial.scoringSettings = { comboBonusPerHit: 0.05, hitPoints: 1.25, missPenalty: 0 };
  coordinator.configureContent(initial);
  coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) });
  coordinator.requestStart(0);
  coordinator.advance({ timestampMs: 1000, clock: clock(0, false) }); coordinator.advance({ timestampMs: 2000, clock: clock(0, false) }); coordinator.advance({ timestampMs: 3000, clock: clock(0, false) });
  coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, evidence("same-past-frame", 4000, ["hook_left"])) });
  coordinator.setActiveEventIds(["same-active"]);
  coordinator.pause(4100);
  const revisedVariant = { ...variant("boxing_semantic_track_v1", "cut_family_source_height_v1", "variant"), chartId: "chart-variant-revised", mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: "b".repeat(64) }, scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: "c".repeat(64) } };
  const revised = config([
    { ...event("same-active", 3000, "weave_left"), chartId: revisedVariant.chartId },
    { ...event("same-replacement", 3000, "weave_left"), chartId: revisedVariant.chartId },
    { ...event("same-stale", 900, "hook_right"), chartId: revisedVariant.chartId },
    { ...event("same-future", 3500, "weave_right"), chartId: revisedVariant.chartId }
  ], revisedVariant);
  revised.profileIdentity = { ...revised.profileIdentity, profileId: "profile-locked", profileVersion: "2", contentHash: "b".repeat(64) };
  revised.scoringSettings = { comboBonusPerHit: 0, hitPoints: 1, missPenalty: 0 };
  coordinator.applyFutureContent(revised);
  assert.deepEqual(coordinator.getSnapshot().activeEventIds, ["same-active"]);
  assert.equal(coordinator.getSnapshot().judgedEventIds.includes("same-past"), true);
  coordinator.resume(4100);
  coordinator.advance({ timestampMs: 5100, clock: clock(1000, false) }); coordinator.advance({ timestampMs: 6100, clock: clock(1000, false) }); coordinator.advance({ timestampMs: 7100, clock: clock(1000, false) });
  coordinator.advance({ timestampMs: 8000, clock: clock(3000, true), input: input(8000, evidence("same-collision-frame", 8000, ["squat", "weave_left"])) });
  coordinator.advance({ timestampMs: 8500, clock: clock(3500, true), input: input(8500, evidence("same-future-frame", 8500, ["weave_right"])) });
  const oldPartition = coordinator.getScorePartitions().find((entry) => entry.profileId === "profile");
  const newPartition = coordinator.getScorePartitions().find((entry) => entry.profileId === "profile-locked");
  assert.equal(oldPartition?.chartId, "chart-variant");
  assert.equal(oldPartition?.mapHash.value, HASH);
  assert.equal(oldPartition?.scoreIdentityHash.value, HASH);
  assert.equal(oldPartition?.profileHash, HASH);
  assert.equal(oldPartition?.scoringSettings.hitPoints, 1.25);
  assert.equal(oldPartition?.score, 2.55, "old past and active events retain prototype-wide scoring");
  assert.equal(newPartition?.chartId, "chart-variant-revised");
  assert.equal(newPartition?.mapHash.value, "b".repeat(64));
  assert.equal(newPartition?.scoreIdentityHash.value, "c".repeat(64));
  assert.equal(newPartition?.profileHash, "b".repeat(64));
  assert.equal(newPartition?.scoringSettings.hitPoints, 1);
  assert.equal(newPartition?.score, 2, "new replacement and same-ID future event use locked scoring");
  assert.equal(coordinator.getJudgements().filter((entry) => entry.eventId === "same-active").length, 1, "preserved active event owns exact ID collision");
  assert.equal(coordinator.getJudgements().some((entry) => entry.eventId === "same-stale"), false, "stale replacement events are not admitted");
  assert.equal(coordinator.getJudgements().find((entry) => entry.eventId === "same-active")?.recipeId, "row_family_balanced_height_v1");
  assert.equal(coordinator.getJudgements().find((entry) => entry.eventId === "same-future")?.recipeId, "cut_family_source_height_v1");
}

// Shadow diagnostics never consume live evidence or change score partitions.
{
  const shadow = { ...variant("boxing_semantic_track_v1", "cut_family_source_height_v1", "shadow"), resolvedEvents: [{ ...event("shadow-hook", 1000, "hook_left"), variantId: "shadow", chartId: "chart-shadow" }] };
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "shadow" });
  coordinator.configureContent(config([event("live-hook", 1000, "hook_left")], variant(), [shadow]));
  coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) });
  coordinator.requestStart(0);
  coordinator.advance({ timestampMs: 1000, clock: clock(0, false) });
  coordinator.advance({ timestampMs: 2000, clock: clock(0, false) });
  coordinator.advance({ timestampMs: 3000, clock: clock(0, false) });
  coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, evidence("frame-shadow", 4000, ["hook_left"])) });
  assert.equal(coordinator.getJudgements()[0].result, "hit");
  assert.equal(coordinator.getSnapshot().shadowJudgements.length, 1);
  assert.equal(coordinator.getScorePartitions()[0].hits, 1);
}

// Shadows reject stale evidence and remain side-effect free.
{
  const shadow = { ...variant("boxing_semantic_track_v1", "cut_family_source_height_v1", "stale-shadow"), resolvedEvents: [{ ...event("stale-shadow-hook", 1000, "hook_left"), variantId: "stale-shadow", chartId: "chart-stale-shadow" }] };
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "stale-shadow" });
  coordinator.configureContent(config([event("later-live", 5000, "hook_right")], variant(), [shadow]));
  coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) });
  coordinator.requestStart(0);
  coordinator.advance({ timestampMs: 1000, clock: clock(0, false) });
  coordinator.advance({ timestampMs: 2000, clock: clock(0, false) });
  coordinator.advance({ timestampMs: 3000, clock: clock(0, false) });
  coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, evidence("stale-shadow-frame", 3849, ["hook_left"])) });
  assert.equal(coordinator.getSnapshot().shadowJudgements.length, 0);
  assert.equal(coordinator.getScorePartitions().length, 0);
}

// Candidate identity is exact and composites cannot claim ranked score partitions.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "variant-identity" });
  assert.throws(() => coordinator.configureContent(config([], { ...variant(), mode: "flow" })), /Flow variants require/u);
  assert.throws(() => coordinator.configureContent(config([], { ...variant("flow_grid_v2"), mode: "boxing" })), /Boxing variants require/u);
  assert.throws(() => coordinator.configureContent(config([], { ...variant(), ranked: true, provenance: { kind: "composite" } })), /unranked/u);
}

// Lease participation pauses but never arbitrates; instances are isolated.
{
  const left = createAeroGameplaySessionCoordinator({ sessionId: "left", instanceId: "left" });
  const right = createAeroGameplaySessionCoordinator({ sessionId: "right", instanceId: "right" });
  readyPlaying(left, [event("left-event", 5000, "hook_left")]);
  readyPlaying(right, [event("right-event", 5000, "hook_left")]);
  const lease = { schema: "aerobeat/media_lease_snapshot", version: 1, ownerInstanceId: "left", generation: 1, state: "owned", resources: ["camera", "audio"] };
  left.setLeaseSnapshot(lease);
  right.setLeaseSnapshot(lease);
  assert.equal(left.getSnapshot().session.state, "playing");
  assert.equal(right.getSnapshot().session.pauseReason, "media_lease_unavailable");
}

// Actual public audio clock shape, including optional undefined duration, is accepted.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "public-audio-clock" });
  coordinator.configureContent(config([]));
  const publicClock = createPlaybackClock().snapshot(0);
  coordinator.advance({ timestampMs: 0, clock: publicClock, input: input(0, null) });
  assert.equal(coordinator.getSnapshot().session.timelinePositionMs, 0);
  assert.equal(coordinator.getSnapshot().safety.ready, true);
}

// Unsafe clocks and tracking loss preserve the last safe audio timeline.
{
  const stopped = createAeroGameplaySessionCoordinator({ sessionId: "stopped-clock-freeze" });
  readyPlaying(stopped, [event("future-stopped", 5000, "hook_left")]);
  stopped.advance({ timestampMs: 3100, clock: clock(500, false) });
  assert.equal(stopped.getSnapshot().session.timelinePositionMs, 0);
  assert.equal(stopped.getSnapshot().session.pauseReason, "audio_clock_not_playing");

  const lost = createAeroGameplaySessionCoordinator({ sessionId: "tracking-clock-freeze" });
  readyPlaying(lost, [event("future-lost", 5000, "hook_left")]);
  lost.advance({ timestampMs: 3100, clock: clock(500, true), input: input(3100, null, { paused: true, fresh: true }) });
  assert.equal(lost.getSnapshot().session.timelinePositionMs, 0);
  assert.equal(lost.getSnapshot().session.state, "paused_tracking");
}

// Manual pause remains frozen under ordinary frames; only explicit stopped-clock synchronization seeks.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "explicit-paused-seek" });
  readyPlaying(coordinator, [event("seek-future", 5000, "hook_left")]);
  coordinator.advance({ timestampMs: 3100, clock: clock(1000, true) });
  coordinator.pause(3200);
  coordinator.advance({ timestampMs: 3300, clock: clock(2000, false) });
  assert.equal(coordinator.getSnapshot().session.timelinePositionMs, 1000);
  const beforeRejectedSeek = coordinator.getSnapshot();
  assert.throws(() => coordinator.synchronizePausedClock({ timestampMs: 3400, clock: clock(2000, true) }), /stopped audio clock/u);
  assert.equal(coordinator.getSnapshot(), beforeRejectedSeek);
  coordinator.synchronizePausedClock({ timestampMs: 3400, clock: createPlaybackClock({ durationSeconds: 10 }).snapshot(0) });
  assert.equal(coordinator.getSnapshot().session.timelinePositionMs, 0);
  coordinator.synchronizePausedClock({ timestampMs: 3500, clock: clock(2000, false) });
  assert.equal(coordinator.getSnapshot().session.timelinePositionMs, 2000);
}

// Failed configuration and frame validation are transactional and publish no hidden state.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "transactional" });
  coordinator.configureContent(config([], variant(), []));
  const configured = coordinator.getSnapshot();
  assert.throws(() => coordinator.configureContent({ ...config([], variant()), packageId: "replacement", selectedVariant: { ...variant(), rulesetId: "invalid" } }), /unsupported/u);
  assert.equal(coordinator.getSnapshot(), configured);
  coordinator.applyFutureContent(config([], variant()));
  readyPlaying(coordinator, [event("transaction-future", 5000, "hook_left")]);
  const beforeInvalidFrame = coordinator.getSnapshot();
  assert.throws(() => coordinator.advance({ timestampMs: 4000, clock: clock(500, true), input: input(4000, { invalid: true }) }), /public contract/u);
  assert.equal(coordinator.getSnapshot(), beforeInvalidFrame);
  coordinator.pause(3500);
  const beforeInvalidSwap = coordinator.getSnapshot();
  assert.throws(() => coordinator.applyFutureContent({ ...config([], variant("boxing_semantic_track_v1", "cut_family_source_height_v1", "transaction-next")), profileIdentity: { invalid: true } }), /tuning contract/u);
  assert.equal(coordinator.getSnapshot(), beforeInvalidSwap);
}

// Duplicate lineage/actions/active IDs and malformed qualification starts fail closed.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "identity-bounds" });
  assert.throws(() => coordinator.configureContent(config([event("lineage-a", 1000, "hook_left", { sourceEventIds: ["source-shared"] }), event("lineage-b", 2000, "hook_right", { sourceEventIds: ["source-shared"] })])), /one event owner/u);
  coordinator.configureContent(config([event("future-identity", 5000, "hook_left")]));
  assert.throws(() => coordinator.setActiveEventIds(["same", "same"]), /unique/u);
  coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) });
  coordinator.requestStart(0);
  coordinator.advance({ timestampMs: 1000, clock: clock(0, false) });
  coordinator.advance({ timestampMs: 2000, clock: clock(0, false) });
  coordinator.advance({ timestampMs: 3000, clock: clock(0, false) });
  const duplicateActions = evidence("duplicate-action-frame", 4000, ["hook_left", "hook_left"]);
  assert.throws(() => coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, duplicateActions) }), /action IDs must be unique/u);
  const forgedQualification = [{ hand: "left", semanticStartTimestampMs: -100, semanticDurationMs: 100, semanticQualified: true, spatialStartTimestampMs: null, spatialDurationMs: 0, spatialQualified: false, acceptedSubcellColumns: [] }];
  assert.throws(() => coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, evidence("forged-straight", 4000, ["straight_left"]), { qualifications: forgedQualification }) }), /non-negative/u);
}

// A configured lease gates start immediately rather than waiting for a later frame.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "lease-gate", instanceId: "game-a" });
  coordinator.configureContent(config([]));
  coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) });
  coordinator.setLeaseSnapshot({ schema: "aerobeat/media_lease_snapshot", version: 1, ownerInstanceId: "game-b", generation: 1, state: "owned", resources: ["camera", "audio"] });
  assert.deepEqual(coordinator.requestStart(0), { accepted: false, reason: "media_lease_unavailable" });
}

// Lifecycle commands reject invalid state re-entry and unknown active identities.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "lifecycle" });
  readyPlaying(coordinator, [event("known-active", 5000, "hook_left")]);
  assert.throws(() => coordinator.requestStart(3000), /calibrating state/u);
  assert.throws(() => coordinator.resume(3000), /paused session/u);
  assert.throws(() => coordinator.setActiveEventIds(["unknown-active"]), /current content/u);
  coordinator.pause(3000);
  assert.equal(coordinator.resume(3000).accepted, true);
}

// Descriptor-safe boundaries, listener isolation, rollback, destroy, and no bytes/media leakage.
{
  let getterCalled = false;
  const malicious = {};
  Object.defineProperty(malicious, "packageId", { enumerable: true, get() { getterCalled = true; return "bad"; } });
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "security", onListenerError() {} });
  assert.throws(() => coordinator.configureContent(malicious), /accessors/u);
  assert.equal(getterCalled, false);
  coordinator.configureContent(config([]));
  let arrayGetterCalled = false;
  const maliciousIds = [];
  Object.defineProperty(maliciousIds, "0", { enumerable: true, get() { arrayGetterCalled = true; return "event"; } });
  Object.defineProperty(maliciousIds, "length", { value: 1 });
  assert.throws(() => coordinator.setActiveEventIds(maliciousIds), /accessors/u);
  assert.equal(arrayGetterCalled, false);
  let notifications = 0;
  coordinator.subscribe(() => { notifications += 1; throw new Error("listener"); });
  coordinator.configureContent(config([]));
  assert.ok(notifications >= 2);
  assert.throws(() => coordinator.advance({ timestampMs: -1, clock: clock(0, false) }), /non-negative/u);
  assert.equal(JSON.stringify(coordinator.getSnapshot()).includes("Uint8Array"), false);
  coordinator.destroy();
  assert.equal(coordinator.getSnapshot().session.state, "destroyed");
  assert.throws(() => coordinator.reset(), /destroyed/u);
}

assert.equal(aeroGameplaySessionCapabilities.visualTestSession, true);
assert.equal(aeroGameplaySessionCapabilities.commitmentTimedJudgements, true);
assert.equal(aeroGameplaySessionCapabilities.publicLeaderboards, false);
console.log("Gameplay session deterministic validation passed.");
