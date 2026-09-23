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
  return { variantId: id, chartId: `chart-${id}`, mode: rulesetId === "flow_colliders_v1" || rulesetId === "flow_grid_v2" ? "flow" : "boxing", rulesetId, recipeId: rulesetId === "flow_colliders_v1" || rulesetId === "flow_grid_v2" ? null : recipeId, modifierIds: [], ranked: false, mapHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, scoreIdentityHash: { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }, provenance: { baseVariantId: id } };
}

function event(eventId, centerTimestampMs, type, extra = {}) {
  const base = { schema: "aerobeat/resolved_content_event", version: 3, eventId, variantId: "variant", chartId: "chart-variant", centerTimestampMs, sourceEventIds: [`source-${eventId}`], type };
  if (!["squat","weave_left","weave_right"].includes(type)) return { ...base, ...extra };
  const geometry = type === "squat" ? { x:0,y:2,width:4,height:1 } : type === "weave_left" ? { x:3,y:0,width:1,height:3 } : { x:0,y:0,width:1,height:3 };
  const gridMask = Array.from({length:geometry.width*geometry.height},(_,index)=>(geometry.y+Math.floor(index/geometry.width))*4+geometry.x+index%geometry.width);
  const noseSafeCells = Array.from({length:12},(_,cell)=>cell).filter((cell)=>!gridMask.includes(cell));
  return { ...base, intervalStartTimestampMs:centerTimestampMs, intervalEndTimestampMs:centerTimestampMs+200, sourceGeometry:{schema:"aerobeat/obstacle_source_geometry",version:1,coordinateSpace:"beatsaber_v3_obstacle_rect",kind:"v3_rect",...geometry}, gameplayGeometry:{schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",...geometry}, gridMask, blockedCells:[...gridMask], checkpoint:{kind:"instantaneous",freshnessMs:150,timingWindowMs:180,noseSafeCells}, ...extra };
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
  return { ...(options.sourceIdentity === undefined ? {} : { sourceIdentity: options.sourceIdentity }), calibration: { calibrationId: options.calibrationId ?? "cal-1", readiness: options.ready === false ? "calibration_required" : "countdown" }, tracking: { gameplayPaused: options.paused === true, freshCalibrationRequired: options.fresh === true }, countdownFrozen: options.paused === true, latestEvidence, straightQualifications: options.qualifications ?? [] };
}

function config(events, selected = variant(), shadowVariants = []) {
  return { packageId: "package-1", selectedVariant: selected, resolvedEvents: events, profileIdentity: { schema: "aerobeat/prototype_tuning_identity", version: 1, profileId: "profile", profileVersion: "1", contentHash: HASH, class: "between_run_ruleset", regenerationRequired: false }, shadowVariants };
}

function clock(positionMs, playing, durationMs = null) { return { contextTimeSeconds: positionMs / 1000, positionSeconds: positionMs / 1000, ...(durationMs === null ? {} : { durationSeconds: durationMs / 1000, progress: durationMs === 0 ? 0 : Math.min(1, positionMs / durationMs) }), playing }; }

function visualTestInteraction(epoch, activationTimelineMs) { return { schema: "aerobeat/visual_test_interaction", version: 1, mode: "production_judgement", epoch, activationTimelineMs }; }
function productionInput(measured, latestEvidence, options = {}) { return input(measured, latestEvidence, { ...options, sourceIdentity: options.sourceIdentity ?? "visual-test-pointer" }); }
function equipmentPosesForEvidence(sample, mode, options = {}) {
  const identity = { schema: "aerobeat/equipment_config_identity", version: 1, algorithm: "sha256", value: options.identity ?? "b".repeat(64) };
  return ["left_wrist", "right_wrist"].map((role) => { const anchor = sample.anchors.find((entry) => entry.anchor === role); return { role, mode, anchor: { x: anchor.x * 4 - 0.5, y: 2.5 - anchor.y * 3, z: 0 }, scale: options.scale ?? 1, orientation: options.orientation ?? { x: 0, y: 0, z: 0, w: 1 }, geometryIdentity: mode === "flow" ? "aerobeat/saber_capsule_v1" : "aerobeat/glove_obb_v1", configIdentity: identity }; });
}
function setAnchorPosition(sample, name, sx, sy) { const target = sample.anchors.find((entry) => entry.anchor === name); target.x = (sx + 0.5) / 4; target.y = (2.5 - sy) / 3; return sample; }
function readyVisualTest(coordinator, events, selected) {
  coordinator.configureContent(config(events, selected), { purpose: "visual_test" });
  assert.equal(coordinator.requestStart(0, { schema: "aerobeat/gameplay_session_start", version: 1, purpose: "visual_test" }).accepted, true);
  assert.equal(coordinator.getSnapshot().session.state, "playing");
}

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
  coordinator.pause(450, "menu");
  assert.equal(coordinator.getSnapshot().session.state, "completed", "ordinary pause cannot destroy terminal completion truth");
  coordinator.synchronizePausedClock({ timestampMs: 451, clock: clock(1500, false, 2000) });
  assert.deepEqual({ state: coordinator.getSnapshot().session.state, position: coordinator.getSnapshot().session.timelinePositionMs, reason: coordinator.getSnapshot().session.pauseReason }, { state: "paused_manual", position: 1500, reason: "explicit_seek" });
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

// Visual Test production judgement is an exact, explicit, future-only authority; absence retains zero outcomes.
{
  const flow = variant("flow_colliders_v1", null);
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "visual-production-flow" });
  readyVisualTest(coordinator, [
    event("flow-left-a", 1000, "note", { hand: "left", placement: 5 }),
    event("flow-left-b", 1000, "note", { hand: "left", placement: 5 }),
    event("flow-miss", 1300, "note", { hand: "right", placement: 6 }),
    event("flow-after-miss", 1600, "note", { hand: "left", placement: 5 })
  ], flow);
  const baseline = setAnchorPosition(evidence("visual-flow-base", 850, []), "left_wrist", 0, 1);
  coordinator.advance({ timestampMs: 850, clock: clock(850, true), input: productionInput(850, baseline), equipmentPoses: equipmentPosesForEvidence(baseline, "flow"), interaction: visualTestInteraction(1, 850) });
  assert.deepEqual(coordinator.getJudgements(), [], "activation frame only seeds collider history");
  const chord = setAnchorPosition(evidence("visual-flow-chord", 1000, []), "left_wrist", 1, 1);
  coordinator.advance({ timestampMs: 1000, clock: clock(1000, true), input: productionInput(1000, chord), equipmentPoses: equipmentPosesForEvidence(chord, "flow"), interaction: visualTestInteraction(1, 850) });
  assert.deepEqual(coordinator.getJudgements().map((entry) => [entry.eventId, entry.result, entry.sessionPurpose]), [["flow-left-a", "hit", "visual_test"], ["flow-left-b", "hit", "visual_test"]]);
  const missFrame = setAnchorPosition(setAnchorPosition(evidence("visual-flow-miss", 1481, []), "left_wrist", 3.4, 2), "right_wrist", 3.4, 2);
  coordinator.advance({ timestampMs: 1481, clock: clock(1481, true), input: productionInput(1481, missFrame), equipmentPoses: equipmentPosesForEvidence(missFrame, "flow"), interaction: visualTestInteraction(1, 850) });
  const finalHit = setAnchorPosition(evidence("visual-flow-final", 1600, []), "left_wrist", 1, 1);
  coordinator.advance({ timestampMs: 1600, clock: clock(1600, true), input: productionInput(1600, finalHit), equipmentPoses: equipmentPosesForEvidence(finalHit, "flow"), interaction: visualTestInteraction(1, 850) });
  assert.deepEqual(coordinator.getJudgements().map((entry) => [entry.eventId, entry.result]), [["flow-left-a", "hit"], ["flow-left-b", "hit"], ["flow-miss", "miss"], ["flow-after-miss", "hit"]]);
  assert.deepEqual(coordinator.getScorePartitions().map((entry) => ({ ranked: entry.ranked, localOnly: entry.localOnly, hits: entry.hits, misses: entry.misses, combo: entry.combo, maxCombo: entry.maxCombo })), [{ ranked: false, localOnly: true, hits: 3, misses: 1, combo: 1, maxCombo: 2 }]);
}

// Direction enforcement and exact activation exclusion use the unchanged Flow evaluator.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "visual-production-flow-direction" });
  readyVisualTest(coordinator, [event("excluded-at-activation", 900, "note", { hand: "left", placement: 5 }), event("direction-hit", 1000, "note", { hand: "left", placement: 5, direction: "right" })], variant("flow_colliders_v1", null));
  const baseline = setAnchorPosition(evidence("direction-base", 900, []), "left_wrist", 0, 1);
  coordinator.advance({ timestampMs: 900, clock: clock(900, true), input: productionInput(900, baseline), equipmentPoses: equipmentPosesForEvidence(baseline, "flow"), interaction: visualTestInteraction(4, 900) });
  const contact = setAnchorPosition(evidence("direction-contact", 1000, []), "left_wrist", 1, 1);
  coordinator.advance({ timestampMs: 1000, clock: clock(1000, true), input: productionInput(1000, contact), equipmentPoses: equipmentPosesForEvidence(contact, "flow"), interaction: visualTestInteraction(4, 900) });
  assert.deepEqual(coordinator.getJudgements().map((entry) => [entry.eventId, entry.result]), [["direction-hit", "hit"]], "center <= activation never retro-misses and authored direction still scores");
}

// Boxing Collider chords and misses use the same production evaluator and local-only score path.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "visual-production-boxing" });
  readyVisualTest(coordinator, [
    event("boxing-left", 1000, "straight_left", { spatialTarget: { targetCell: 5, acceptedSubcells: [], sourceCell: -1 } }),
    event("boxing-right", 1000, "straight_right", { spatialTarget: { targetCell: 6, acceptedSubcells: [], sourceCell: -1 } }),
    event("boxing-miss", 1300, "straight_left", { spatialTarget: { targetCell: 5, acceptedSubcells: [], sourceCell: -1 } })
  ], variant("boxing_collider_v1", null));
  const boxingBase = evidence("boxing-base", 900, []);
  coordinator.advance({ timestampMs: 900, clock: clock(900, true), input: productionInput(900, boxingBase), equipmentPoses: equipmentPosesForEvidence(boxingBase, "boxing"), interaction: visualTestInteraction(1, 900) });
  const chord = evidence("boxing-chord", 1000, []);
  setAnchorPosition(chord, "left_wrist", 1, 1); setAnchorPosition(chord, "right_wrist", 2, 1);
  coordinator.advance({ timestampMs: 1000, clock: clock(1000, true), input: productionInput(1000, chord), equipmentPoses: equipmentPosesForEvidence(chord, "boxing"), interaction: visualTestInteraction(1, 900) });
  const boxingLate = evidence("boxing-late", 1481, []);
  coordinator.advance({ timestampMs: 1481, clock: clock(1481, true), input: productionInput(1481, boxingLate), equipmentPoses: equipmentPosesForEvidence(boxingLate, "boxing"), interaction: visualTestInteraction(1, 900) });
  assert.deepEqual(coordinator.getJudgements().map((entry) => [entry.eventId, entry.result, entry.sessionPurpose]), [["boxing-left", "hit", "visual_test"], ["boxing-right", "hit", "visual_test"], ["boxing-miss", "miss", "visual_test"]]);
  assert.deepEqual(coordinator.getScorePartitions().map((entry) => [entry.ranked, entry.localOnly, entry.hits, entry.misses, entry.combo, entry.maxCombo]), [[false, true, 2, 1, 0, 2]]);
}

// Authority boundary rejects malformed/automatic/unauthorized calls transactionally without invoking accessors.
{
  const flow = variant("flow_colliders_v1", null);
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "visual-production-boundary" });
  readyVisualTest(coordinator, [event("future", 500, "note", { hand: "left", placement: 5 })], flow);
  const strictEvidence = evidence("strict", 0, []);
  const strictInput = productionInput(0, strictEvidence);
  const strictPoses = equipmentPosesForEvidence(strictEvidence, "flow");
  const before = coordinator.getSnapshot();
  assert.throws(() => coordinator.advance({ timestampMs: 0, clock: clock(0, true), input: strictInput, interaction: { ...visualTestInteraction(1, 0), extra: true } }), /unknown or symbolic fields/u);
  assert.equal(coordinator.getSnapshot(), before);
  assert.throws(() => coordinator.advance({ timestampMs: 0, clock: clock(0, true), input: strictInput, interaction: { ...visualTestInteraction(1, 0), mode: "automatic_feedback" } }), /identity is invalid/u);
  assert.throws(() => coordinator.advance({ timestampMs: 0, clock: clock(0, true), interaction: visualTestInteraction(1, 0) }), /strict input evidence/u);
  let accessorCalls = 0; const hostile = { schema: "aerobeat/visual_test_interaction", version: 1, mode: "production_judgement", epoch: 1 };
  Object.defineProperty(hostile, "activationTimelineMs", { enumerable: true, get() { accessorCalls += 1; return 0; } });
  assert.throws(() => coordinator.advance({ timestampMs: 0, clock: clock(0, true), input: strictInput, interaction: hostile }), /accessors or hidden fields/u);
  assert.equal(accessorCalls, 0);
  coordinator.advance({ timestampMs: 0, clock: clock(0, true), input: strictInput, equipmentPoses: strictPoses, interaction: visualTestInteraction(1, 0) });
  assert.throws(() => coordinator.advance({ timestampMs: 1, clock: clock(1, true), input: productionInput(1, evidence("strict-2", 1, [])), interaction: visualTestInteraction(1, 1) }), /immutable within an epoch/u);

  const play = createAeroGameplaySessionCoordinator({ sessionId: "play-authority-rejected", countdownStepMs: 1 });
  readyPlaying(play, [event("play", 500, "straight_left")]);
  assert.throws(() => play.advance({ timestampMs: 3001, clock: clock(4, true), input: input(3001, evidence("play-authority", 3001, [])), interaction: visualTestInteraction(1, 4) }), /visual_test purpose/u);

  const nonCollider = createAeroGameplaySessionCoordinator({ sessionId: "visual-non-collider" });
  readyVisualTest(nonCollider, [event("grid", 500, "hook_left")], variant());
  assert.throws(() => nonCollider.advance({ timestampMs: 0, clock: clock(0, true), input: strictInput, interaction: visualTestInteraction(1, 0) }), /collider ruleset/u);
}

// Pause/seek/resume and epoch/source/frame discontinuities cannot bridge history or retroactively score.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "visual-production-lifecycle" });
  readyVisualTest(coordinator, [event("past-after-seek", 500, "note", { hand: "left", placement: 5 }), event("future-after-seek", 1200, "note", { hand: "left", placement: 5 }), event("later-after-rollback", 2000, "note", { hand: "right", placement: 6 })], variant("flow_colliders_v1", null));
  const first = setAnchorPosition(evidence("life-base", 0, []), "left_wrist", 0, 1);
  coordinator.advance({ timestampMs: 0, clock: clock(0, true), input: productionInput(0, first), equipmentPoses: equipmentPosesForEvidence(first, "flow"), interaction: visualTestInteraction(1, 0) });
  coordinator.pause(100, "menu");
  coordinator.synchronizePausedClock({ timestampMs: 101, clock: clock(1000, false) });
  coordinator.resume(102);
  assert.throws(() => coordinator.advance({ timestampMs: 1000, clock: clock(1000, true), input: productionInput(1000, evidence("stale-epoch", 1000, [])), interaction: visualTestInteraction(1, 1000) }), /epochs must increase/u);
  const seed = setAnchorPosition(evidence("life-seed", 1000, []), "left_wrist", 0, 1);
  coordinator.advance({ timestampMs: 1000, clock: clock(1000, true), input: productionInput(1000, seed), equipmentPoses: equipmentPosesForEvidence(seed, "flow"), interaction: visualTestInteraction(2, 1000) });
  const duplicate = setAnchorPosition(evidence("life-seed", 1100, []), "left_wrist", 1, 1);
  coordinator.advance({ timestampMs: 1100, clock: clock(1100, true), input: productionInput(1100, duplicate), equipmentPoses: equipmentPosesForEvidence(duplicate, "flow"), interaction: visualTestInteraction(2, 1000) });
  assert.deepEqual(coordinator.getJudgements(), [], "duplicate identity cannot bridge the recovery baseline");
  const stale = setAnchorPosition(evidence("life-stale", 900, []), "left_wrist", 1, 1);
  assert.throws(() => coordinator.advance({ timestampMs: 1149, clock: clock(1149, true), input: productionInput(900, stale), equipmentPoses: equipmentPosesForEvidence(stale, "flow"), interaction: visualTestInteraction(2, 1000) }), /current valid measured wrist/u);
  assert.deepEqual(coordinator.getJudgements(), [], "stale evidence rejects transactionally and cannot bridge history");
  const sourceSeed = setAnchorPosition(evidence("life-source-seed", 1150, []), "left_wrist", -0.5, 1);
  coordinator.advance({ timestampMs: 1150, clock: clock(1150, true), input: productionInput(1150, sourceSeed, { sourceIdentity: "source-b" }), equipmentPoses: equipmentPosesForEvidence(sourceSeed, "flow"), interaction: visualTestInteraction(2, 1000) });
  assert.deepEqual(coordinator.getJudgements(), [], "source transition re-baselines without a swept hit");
  const hit = setAnchorPosition(evidence("life-hit", 1200, []), "left_wrist", 1, 1);
  coordinator.advance({ timestampMs: 1200, clock: clock(1200, true), input: productionInput(1200, hit, { sourceIdentity: "source-b" }), equipmentPoses: equipmentPosesForEvidence(hit, "flow"), interaction: visualTestInteraction(2, 1000) });
  assert.deepEqual(coordinator.getJudgements().map((entry) => [entry.eventId, entry.result]), [["future-after-seek", "hit"]]);
  const rollback = evidence("rollback", 1201, []);
  coordinator.advance({ timestampMs: 1201, clock: clock(1199, true), input: productionInput(1201, rollback), equipmentPoses: equipmentPosesForEvidence(rollback, "flow"), interaction: visualTestInteraction(2, 1000) });
  assert.deepEqual([coordinator.getSnapshot().session.state, coordinator.getSnapshot().session.pauseReason, coordinator.getJudgements().length], ["paused_manual", "audio_clock_rollback", 1]);
}

// The authority changes only truthful purpose: normalized production judgement and score semantics retain Play golden parity.
{
  const selected = variant("flow_colliders_v1", null);
  const events = [event("golden-parity", 1000, "note", { hand: "left", placement: 5 })];
  const play = createAeroGameplaySessionCoordinator({ sessionId: "golden-play", countdownStepMs: 1 });
  readyPlaying(play, events, selected);
  const playBase = setAnchorPosition(evidence("golden-play-base", 3900, []), "left_wrist", 3.4, 2);
  play.advance({ timestampMs: 3900, clock: clock(900, true), input: productionInput(3900, playBase), equipmentPoses: equipmentPosesForEvidence(playBase, "flow") });
  const playHit = setAnchorPosition(evidence("golden-play-hit", 4000, []), "left_wrist", 1, 1);
  play.advance({ timestampMs: 4000, clock: clock(1000, true), input: productionInput(4000, playHit), equipmentPoses: equipmentPosesForEvidence(playHit, "flow") });

  const visual = createAeroGameplaySessionCoordinator({ sessionId: "golden-visual" });
  readyVisualTest(visual, events, selected);
  const visualBase = setAnchorPosition(evidence("golden-visual-base", 900, []), "left_wrist", 3.4, 2);
  visual.advance({ timestampMs: 900, clock: clock(900, true), input: productionInput(900, visualBase), equipmentPoses: equipmentPosesForEvidence(visualBase, "flow"), interaction: visualTestInteraction(1, 900) });
  const visualHit = setAnchorPosition(evidence("golden-visual-hit", 1000, []), "left_wrist", 1, 1);
  visual.advance({ timestampMs: 1000, clock: clock(1000, true), input: productionInput(1000, visualHit), equipmentPoses: equipmentPosesForEvidence(visualHit, "flow"), interaction: visualTestInteraction(1, 900) });

  const judgementTruth = (entry) => ({ eventId: entry.eventId, rulesetId: entry.rulesetId, recipeId: entry.recipeId, result: entry.result, beatCenterTimestampMs: entry.beatCenterTimestampMs, committedTimelinePositionMs: entry.committedTimelinePositionMs, timingOffsetMs: entry.timingOffsetMs, diagnostics: entry.diagnostics, shadow: entry.shadow });
  assert.deepEqual(judgementTruth(visual.getJudgements()[0]), judgementTruth(play.getJudgements()[0]));
  assert.deepEqual([play.getJudgements()[0].sessionPurpose, visual.getJudgements()[0].sessionPurpose], ["play", "visual_test"]);
  const scoreTruth = (entry) => ({ hits: entry.hits, misses: entry.misses, ignored: entry.ignored, score: entry.score, combo: entry.combo, maxCombo: entry.maxCombo, obstacleContacts: entry.obstacleContacts, bombContacts: entry.bombContacts });
  assert.deepEqual(scoreTruth(visual.getScorePartitions()[0]), scoreTruth(play.getScorePartitions()[0]));
}

// Purpose-aware configuration never publishes Play calibration for Test and preserves an active Visual Test across exact ruleset replacement.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "purpose-aware-visual-test", instanceId: "game-a" });
  const publications = [];
  coordinator.subscribe((snapshot) => publications.push({ state: snapshot.session.state, purpose: snapshot.session.purpose, rulesetId: snapshot.session.rulesetId, timelinePositionMs: snapshot.session.timelinePositionMs }));
  publications.length = 0;
  const visualConfiguration = { purpose: "visual_test" };
  coordinator.configureContent(config([], variant("flow_colliders_v1", null, "visual-flow")), visualConfiguration);
  assert.deepEqual(publications, [{ state: "idle", purpose: "visual_test", rulesetId: "flow_colliders_v1", timelinePositionMs: 0 }]);
  coordinator.setLeaseSnapshot({ schema: "aerobeat/media_lease_snapshot", version: 1, ownerInstanceId: "game-a", generation: 1, state: "owned", resources: ["audio"] });
  coordinator.requestStart(0, { schema: "aerobeat/gameplay_session_start", version: 1, purpose: "visual_test" });
  coordinator.advance({ timestampMs: 400, clock: clock(400, true, 2000) });
  publications.length = 0;
  coordinator.configureContent(config([], variant("boxing_spatial_grid_v1", "row_family_balanced_height_v1", "visual-grid")), visualConfiguration);
  assert.deepEqual(publications, [{ state: "playing", purpose: "visual_test", rulesetId: "boxing_spatial_grid_v1", timelinePositionMs: 400 }]);
  assert.equal(coordinator.getSnapshot().session.calibrationId, null);
  assert.equal(coordinator.getSnapshot().session.ranked, false);
  assert.throws(() => coordinator.configureContent(config([]), { purpose: "visual_test", extra: true }), /unknown or symbolic fields/u);
  assert.throws(() => coordinator.configureContent(config([]), { purpose: "invalid" }), /purpose is invalid/u);
  const accessorOptions = {};
  let accessorCalls = 0;
  Object.defineProperty(accessorOptions, "purpose", { enumerable: true, get() { accessorCalls += 1; return "visual_test"; } });
  assert.throws(() => coordinator.configureContent(config([]), accessorOptions), /accessors or hidden fields/u);
  assert.equal(accessorCalls, 0);
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

// The retired Flow Grid ruleset is no longer an accepted variant input: historical reads are enforced at the authoring/content boundary.
{
  const gridCoordinator = createAeroGameplaySessionCoordinator({ sessionId: "retired-grid-input" });
  assert.throws(() => gridCoordinator.configureContent(config([event("grid-retired", 500, "note", { hand: "left", placement: 5 })], variant("flow_grid_v2"))), /Variant ruleset is unsupported/u);
}// Boxing spatial targets remain cardinal-only even though measured evidence is eight-way.
{
  const spatial = variant("boxing_spatial_grid_v1", "cut_family_source_height_v1");
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "boxing-diagonal-target" });
  assert.throws(() => coordinator.configureContent(config([event("diagonal-hook", 500, "hook_left", { spatialTarget: { targetCell: 5, acceptedSubcells: [20], sourceCell: 9, entryDirection: "up-left" } })], spatial)), /Spatial entry direction is invalid/u);
  const sentinel=createAeroGameplaySessionCoordinator({sessionId:"boxing-source-sentinel"});sentinel.configureContent(config([event("sentinel-hook",500,"hook_left",{spatialTarget:{targetCell:5,acceptedSubcells:[20],sourceCell:-1,entryDirection:"up"}})],spatial));assert.equal(sentinel.getSnapshot().selectedVariant.rulesetId,"boxing_spatial_grid_v1","authoring's explicit -1 source-cell sentinel must survive gameplay validation");const invalidSentinel=createAeroGameplaySessionCoordinator({sessionId:"boxing-invalid-source-sentinel"});assert.throws(()=>invalidSentinel.configureContent(config([event("invalid-sentinel-hook",500,"hook_left",{spatialTarget:{targetCell:5,acceptedSubcells:[20],sourceCell:-2,entryDirection:"up"}})],spatial)),/source cell/u);
}

// Non-note Flow source events remain explicitly ignored under the swept colliders ruleset.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "flow-diagnostics" });
  const flow = variant("flow_colliders_v1");
  readyPlaying(coordinator, [event("wrong-flow", 500, "note", { hand: "left", placement: 5, direction: "up" }), event("flow-bomb", 900, "bomb", { placement: 6 })], flow);
  const sample = evidence("frame-flow-wrong", 3500, []);
  sample.entries = [{ schema: "aerobeat/body_grid_cell_entry", version: 1, anchor: "left_wrist", calibrationId: "cal-1", measurementTimestampMs: 3500, fromCell: 1, toCell: 5, direction: "down", provenance: "measured" }];
  coordinator.advance({ timestampMs: 3500, clock: clock(681, true), input: productionInput(3500, sample), equipmentPoses: equipmentPosesForEvidence(sample, "flow") });
  const settle = setAnchorPosition(setAnchorPosition(evidence("frame-flow-settle", 3700, []), "left_wrist", -0.5, 2), "right_wrist", -0.5, 2);
  coordinator.advance({ timestampMs: 3700, clock: clock(900, true), input: productionInput(3700, settle), equipmentPoses: equipmentPosesForEvidence(settle, "flow") });
  assert.deepEqual(coordinator.getJudgements().map((entry) => [entry.eventId, entry.result]), [["wrong-flow", "miss"]], "unscored expired note commits; the bomb settles separately as a flow hazard outcome");
}
// Bombs and walls settle exclusively through flow hazard outcomes under the swept colliders ruleset.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "flow-hazard-settlement" });
  readyPlaying(coordinator, [event("hazard-bomb", 500, "bomb", { placement: 6 }), canonicalFlowEvent("hazard-wall", 800, { start: 2, end: 4, type: "obstacle", sourceGeometry: { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v3_obstacle_rect", kind: "v3_rect", x: 0, y: 0, width: 4, height: 1 }, gameplayGeometry: { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", x: 0, y: 0, width: 4, height: 1 }, gridMask: [0, 1, 2, 3] }, 1200)], variant("flow_colliders_v1"));
  const hazardStart = evidence("frame-hazard", 3500, []);
  coordinator.advance({ timestampMs: 3500, clock: clock(500, true), input: productionInput(3500, hazardStart), equipmentPoses: equipmentPosesForEvidence(hazardStart, "flow") });
  for (const [wallMs, songMs] of [[4200, 800], [5000, 1250]]) {
    const sample = evidence(`frame-hazard-${songMs}`, wallMs, []);
    coordinator.advance({ timestampMs: wallMs, clock: clock(songMs, true), input: productionInput(wallMs, sample), equipmentPoses: equipmentPosesForEvidence(sample, "flow") });
  }
  const hazardSettle = evidence("frame-hazard-settle", 6000, []);
  coordinator.advance({ timestampMs: 6000, clock: clock(1400, true), input: productionInput(6000, hazardSettle), equipmentPoses: equipmentPosesForEvidence(hazardSettle, "flow") });
  const hazards = coordinator.getHazardOutcomes();
  assert.equal(hazards.some((outcome) => outcome.kind === "bomb"), true, "bomb contact avoided or contacted settles as a hazard outcome");
  assert.equal(hazards.some((outcome) => outcome.kind === "wall"), true, "wall interval settles as a hazard outcome");
  assert.deepEqual(coordinator.getJudgements(), [], "bombs and walls never produce synthetic note judgements");
}
// Source-geometry Flow obstacles validate transactionally; obstacle truth is separate from note judgements.
{
  const flow = variant("flow_colliders_v1", "row_family_balanced_height_v1");
  const sourceGeometry={schema:"aerobeat/obstacle_source_geometry",version:1,coordinateSpace:"beatsaber_v2_legacy_obstacle",kind:"v2_type_1",x:1,y:2,width:1,height:3};const gameplayGeometry={schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",x:1,y:0,width:1,height:3};
  const valid = [
    canonicalFlowEvent("canonical-bomb", 500, { start: 1, type: "bomb", placement: 11 }),
    canonicalFlowEvent("canonical-obstacle", 700, { start: 1.4, end: 2, type: "obstacle", sourceGeometry,gameplayGeometry,gridMask:[1,5,9] }, 1000),
    canonicalFlowEvent("canonical-arc", 900, { start: 1.8, end: 2.4, type: "arc", hand: "left", startPlacement: 8, endPlacement: 3, startDirection: 0, endDirection: 8 }, 1200),
    canonicalFlowEvent("canonical-burst", 1100, { start: 2.2, end: 2.6, type: "burst", hand: "right", placement: 10, tailPlacement: 2, direction: 8, checkpointCount: 4 }, 1300)
  ];
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "flow-canonical-non-notes" });
  readyPlaying(coordinator, valid, flow);
  const canonicalSettle = evidence("canonical-settle", 5000, []);
  coordinator.advance({ timestampMs: 5000, clock: clock(1300, true), input: productionInput(5000, canonicalSettle), equipmentPoses: equipmentPosesForEvidence(canonicalSettle, "flow") });
  assert.deepEqual(coordinator.getJudgements().map((entry) => [entry.eventId, entry.result]), [["canonical-arc", "ignored"], ["canonical-burst", "ignored"]], "bombs no longer receive ignored judgements; arcs and bursts remain non-scoring");
  assert.equal(coordinator.getHazardOutcomes().some((outcome) => outcome.kind === "bomb"), true, "the swept bomb settles through a flow hazard outcome");
  assert.equal(coordinator.getHazardOutcomes().filter((outcome) => outcome.kind === "wall").length, 1, "swept wall contact settles as a flow hazard outcome, not an obstacle outcome");

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

{
  // The sparse/repeated-frame swept wall-collision contract is owned by validate-flow-collider-collision.
  // Here only the cross-variant boundary is pinned: flow-mode obstacles settle as flow hazard outcomes,
  // never as legacy obstacle outcomes or synthetic note judgements.
  const flow = variant("flow_colliders_v1");
  const geometry = { sourceGeometry: { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v3_obstacle_rect", kind: "v3_rect", x: 1, y: 0, width: 1, height: 3 }, gameplayGeometry: { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", x: 1, y: 0, width: 1, height: 3 } };
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "wall-settlement-boundary" });
  readyPlaying(coordinator, [canonicalFlowEvent("a-wall", 700, { start: 1.4, end: 1.45, type: "obstacle", ...geometry, gridMask: [1, 5, 9] }, 725)], flow);
  for (const offset of [16, 32, 48]) {
    const sample = evidence(`frame-${offset}`, 3600 + offset, []);
    sample.anchors.find((entry) => entry.anchor === "nose").x = 0.125;
    coordinator.advance({ timestampMs: 3600 + offset, clock: clock(690 + offset / 4, true), input: productionInput(3600 + offset, sample), equipmentPoses: equipmentPosesForEvidence(sample, "flow") });
  }
  const settlement = evidence("wall-settlement", 5000, []);
  coordinator.advance({ timestampMs: 5000, clock: clock(900, true), input: productionInput(5000, settlement), equipmentPoses: equipmentPosesForEvidence(settlement, "flow") });
  assert.deepEqual(coordinator.getObstacleOutcomes(), [], "flow walls never emit legacy obstacle outcomes under the colliders ruleset");
  assert.equal(coordinator.getHazardOutcomes().filter((outcome) => outcome.kind === "wall").length, 1, "the wall interval settles exactly once through a flow hazard outcome");
  assert.equal(coordinator.getJudgements().length, 0, "walls and bombs never produce synthetic note judgements");
}

// hazardContact: enter→active+sinceMs exact; exit→inactive+releasedAtMs exact;
// continuous occupation across obstacle replacement keeps sinceMs; pause clears;
// non-flow-ruleset / non-play purpose → always inactive.
{
  const flow = variant("flow_colliders_v1");
  const wallGeometry = { sourceGeometry: { schema: "aerobeat/obstacle_source_geometry", version: 1, coordinateSpace: "beatsaber_v3_obstacle_rect", kind: "v3_rect", x: 1, y: 0, width: 1, height: 3 }, gameplayGeometry: { schema: "aerobeat/obstacle_gameplay_geometry", version: 1, coordinateSpace: "aerobeat_top_left_grid", x: 1, y: 0, width: 1, height: 3 }, gridMask: [1, 5, 9] };

  // --- Single wall: enter → active+sinceMs, exit → inactive+releasedAtMs ---
  {
    const c = createAeroGameplaySessionCoordinator({ sessionId: "hc-enter-exit" });
    // Wall 700-800; nose outside→inside→outside
    readyPlaying(c, [canonicalFlowEvent("hc-wall", 700, { start: 1.4, end: 1.6, type: "obstacle", ...wallGeometry }, 800)], flow);
    // Baseline: nose outside at timeline 700
    const base = evidence("hc-base", 3700, []);
    base.anchors.find((a) => a.anchor === "nose").x = 0.125;
    base.anchors.find((a) => a.anchor === "nose").y = 0.5;
    const baseInput = input(3700, base); baseInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 3700, clock: clock(700, true), input: baseInput, equipmentPoses: equipmentPosesForEvidence(base, "flow") });
    // Enter: nose inside at timeline 750
    const inside = evidence("hc-in", 3800, []);
    inside.anchors.find((a) => a.anchor === "nose").x = 0.4;
    inside.anchors.find((a) => a.anchor === "nose").y = 0.3;
    const inInput = input(3800, inside); inInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 3800, clock: clock(750, true), input: inInput, equipmentPoses: equipmentPosesForEvidence(inside, "flow") });
    // sinceMs is the exact segment-clip entry point
    const enterHc = c.getSnapshot().hazardContact;
    assert.equal(enterHc.active, true, "enter: active");
    assert.equal(enterHc.sinceMs, 722.7272727272727, "enter: exact sinceMs from segment clip");
    assert.equal(enterHc.releasedAtMs, null, "enter: releasedAtMs null");
    // Exit: nose outside at timeline 850
    const outside = evidence("hc-out", 3900, []);
    outside.anchors.find((a) => a.anchor === "nose").x = 0.125;
    outside.anchors.find((a) => a.anchor === "nose").y = 0.5;
    const outInput = input(3900, outside); outInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 3900, clock: clock(850, true), input: outInput, equipmentPoses: equipmentPosesForEvidence(outside, "flow") });
    // releasedAtMs clamped to interval end (800) because exit is beyond the wall;
    // sinceMs is retained from the entry (L-B3) so the renderer can recompute the
    // release-moment pulse phase from (sinceMs, releasedAtMs, params).
    const exitHc = c.getSnapshot().hazardContact;
    assert.equal(exitHc.active, false, "exit: inactive");
    assert.equal(exitHc.sinceMs, 722.7272727272727, "exit: sinceMs retained from the exact segment-clip entry");
    assert.equal(exitHc.releasedAtMs, 800, "exit: exact releasedAtMs (clamped to interval end)");
  }

  // --- Continuous occupation across obstacle replacement keeps sinceMs ---
  {
    const c = createAeroGameplaySessionCoordinator({ sessionId: "hc-replace" });
    // Wall A: 700-760, Wall B: 740-800 (overlapping; nose stays inside the combined region)
    const wallA = canonicalFlowEvent("hc-a", 700, { start: 1.4, end: 1.52, type: "obstacle", ...wallGeometry }, 760);
    const wallB = canonicalFlowEvent("hc-b", 740, { start: 1.48, end: 1.6, type: "obstacle", ...wallGeometry }, 800);
    readyPlaying(c, [wallA, wallB], flow);
    // Baseline: nose outside at timeline 700
    const base = evidence("hc-replace-base", 3700, []);
    base.anchors.find((a) => a.anchor === "nose").x = 0.125;
    base.anchors.find((a) => a.anchor === "nose").y = 0.5;
    const baseInput = input(3700, base); baseInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 3700, clock: clock(700, true), input: baseInput, equipmentPoses: equipmentPosesForEvidence(base, "flow") });
    // Enter A at 750
    const inA = evidence("hc-replace-in", 3800, []);
    inA.anchors.find((a) => a.anchor === "nose").x = 0.4;
    inA.anchors.find((a) => a.anchor === "nose").y = 0.3;
    const inAInput = input(3800, inA); inAInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 3800, clock: clock(750, true), input: inAInput, equipmentPoses: equipmentPosesForEvidence(inA, "flow") });
    const enterHc = c.getSnapshot().hazardContact;
    assert.equal(enterHc.active, true, "enter A: active");
    assert.equal(enterHc.releasedAtMs, null, "enter A: releasedAtMs null");
    const enterSinceMs = enterHc.sinceMs;
    // At 780: A exits (end 760), B still inside (end 800) — set never empty
    const inB = evidence("hc-replace-b", 3900, []);
    inB.anchors.find((a) => a.anchor === "nose").x = 0.4;
    inB.anchors.find((a) => a.anchor === "nose").y = 0.3;
    const inBInput = input(3900, inB); inBInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 3900, clock: clock(780, true), input: inBInput, equipmentPoses: equipmentPosesForEvidence(inB, "flow") });
    const hc = c.getSnapshot().hazardContact;
    assert.equal(hc.active, true, "still active after replacement");
    assert.equal(hc.sinceMs, enterSinceMs, "sinceMs stays at original episode start across replacement");
    assert.equal(hc.releasedAtMs, null, "releasedAtMs stays null — no true empty transition");
    // Exit B at 820
    const outB = evidence("hc-replace-out", 4000, []);
    outB.anchors.find((a) => a.anchor === "nose").x = 0.125;
    outB.anchors.find((a) => a.anchor === "nose").y = 0.5;
    const outBInput = input(4000, outB); outBInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 4000, clock: clock(820, true), input: outBInput, equipmentPoses: equipmentPosesForEvidence(outB, "flow") });
    assert.equal(c.getSnapshot().hazardContact.active, false, "exit B: inactive");
    assert.equal(c.getSnapshot().hazardContact.sinceMs, enterSinceMs, "exit B: sinceMs stays at the original episode start (retained across replacement + release)");
    assert.ok(c.getSnapshot().hazardContact.releasedAtMs !== null, "exit B: releasedAtMs set");
  }

  // --- Pause clears the state ---
  {
    const c = createAeroGameplaySessionCoordinator({ sessionId: "hc-pause" });
    readyPlaying(c, [canonicalFlowEvent("hc-pause-wall", 700, { start: 1.4, end: 2.0, type: "obstacle", ...wallGeometry }, 2000)], flow);
    // Baseline: nose outside at timeline 700
    const base = evidence("hc-pause-base", 3700, []);
    base.anchors.find((a) => a.anchor === "nose").x = 0.125;
    base.anchors.find((a) => a.anchor === "nose").y = 0.5;
    const baseInput = input(3700, base); baseInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 3700, clock: clock(700, true), input: baseInput, equipmentPoses: equipmentPosesForEvidence(base, "flow") });
    // Enter at 750
    const inside = evidence("hc-pause-in", 3800, []);
    inside.anchors.find((a) => a.anchor === "nose").x = 0.4;
    inside.anchors.find((a) => a.anchor === "nose").y = 0.3;
    const pauseInput = input(3800, inside); pauseInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 3800, clock: clock(750, true), input: pauseInput, equipmentPoses: equipmentPosesForEvidence(inside, "flow") });
    assert.equal(c.getSnapshot().hazardContact.active, true, "active before pause");
    c.pause(3900);
    assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: null, releasedAtMs: null }, "pause clears hazardContact");
  }

  // --- Non-flow-ruleset → always inactive ---
  {
    const c = createAeroGameplaySessionCoordinator({ sessionId: "hc-non-flow" });
    readyPlaying(c, [event("hc-boxing-squat", 700, "squat")]);
    const sample = evidence("hc-boxing-frame", 3800, ["squat"]);
    sample.anchors.find((a) => a.anchor === "nose").cell = 0;
    sample.anchors.find((a) => a.anchor === "nose").subcell = 0;
    c.advance({ timestampMs: 3800, clock: clock(700, true), input: input(3800, sample) });
    assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: null, releasedAtMs: null }, "boxing squat: hazardContact always inactive");
  }

  // --- Non-play purpose (visual_test) → always inactive ---
  {
    const c = createAeroGameplaySessionCoordinator({ sessionId: "hc-visual", instanceId: "game-a" });
    const flow = variant("flow_colliders_v1");
    c.configureContent(config([canonicalFlowEvent("hc-visual-wall", 700, { start: 1.4, end: 1.45, type: "obstacle", ...wallGeometry }, 725)], flow), { purpose: "visual_test" });
    c.setLeaseSnapshot({ schema: "aerobeat/media_lease_snapshot", version: 1, ownerInstanceId: "game-a", generation: 1, state: "owned", resources: ["audio"] });
    c.requestStart(0, { schema: "aerobeat/gameplay_session_start", version: 1, purpose: "visual_test" });
    assert.equal(c.getSnapshot().session.state, "playing");
    assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: null, releasedAtMs: null }, "visual_test: hazardContact always inactive");
  }

  // --- Run end (completion) clears the state ---
  {
    const c = createAeroGameplaySessionCoordinator({ sessionId: "hc-completed" });
    const wall = canonicalFlowEvent("hc-end-wall", 100, { start: 0.2, end: 0.4, type: "obstacle", ...wallGeometry }, 400);
    readyPlaying(c, [wall], flow);
    const base = evidence("hc-end-base", 3100, []);
    base.anchors.find((a) => a.anchor === "nose").x = 0.125;
    base.anchors.find((a) => a.anchor === "nose").y = 0.5;
    const baseInput = input(3100, base); baseInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 3100, clock: clock(150, true, 500), input: baseInput, equipmentPoses: equipmentPosesForEvidence(base, "flow") });
    const inside = evidence("hc-end-in", 3200, []);
    inside.anchors.find((a) => a.anchor === "nose").x = 0.4;
    inside.anchors.find((a) => a.anchor === "nose").y = 0.3;
    const endInput = input(3200, inside); endInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 3200, clock: clock(250, true, 500), input: endInput, equipmentPoses: equipmentPosesForEvidence(inside, "flow") });
    assert.equal(c.getSnapshot().hazardContact.active, true, "active during play before completion");
    c.stop(4000);
    assert.equal(c.getSnapshot().session.state, "completed");
    assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: null, releasedAtMs: null }, "stop clears hazardContact");
  }

  // --- Hostile/missing evidence paths don't corrupt the state ---
  {
    const c = createAeroGameplaySessionCoordinator({ sessionId: "hc-hostile" });
    const wall = canonicalFlowEvent("hc-hostile-wall", 700, { start: 1.4, end: 1.45, type: "obstacle", ...wallGeometry }, 725);
    readyPlaying(c, [wall], flow);
    // Current wrist evidence with an unavailable nose keeps the presentation state inactive.
    const inactive = evidence("hc-hostile-inactive", 3800, []);
    inactive.anchors.find((a) => a.anchor === "nose").confidence = 0.49;
    c.advance({ timestampMs: 3800, clock: clock(700, true), input: productionInput(3800, inactive, { sourceIdentity: "src-1" }), equipmentPoses: equipmentPosesForEvidence(inactive, "flow") });
    assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: null, releasedAtMs: null }, "unavailable nose evidence: hazardContact stays inactive");
    // Baseline outside at 700
    const base = evidence("hc-hostile-base", 3900, []);
    base.anchors.find((a) => a.anchor === "nose").x = 0.125;
    base.anchors.find((a) => a.anchor === "nose").y = 0.5;
    const baseInput = input(3900, base); baseInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 3900, clock: clock(700, true), input: baseInput, equipmentPoses: equipmentPosesForEvidence(base, "flow") });
    assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: null, releasedAtMs: null }, "baseline outside: still inactive");
    // Enter at 712
    const inside = evidence("hc-hostile-in", 4000, []);
    inside.anchors.find((a) => a.anchor === "nose").x = 0.4;
    inside.anchors.find((a) => a.anchor === "nose").y = 0.3;
    const hostileInput = input(4000, inside); hostileInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 4000, clock: clock(712, true), input: hostileInput, equipmentPoses: equipmentPosesForEvidence(inside, "flow") });
    const hostileEntry = c.getSnapshot().hazardContact;
    assert.equal(hostileEntry.active, true, "active after valid enter");
    assert.ok(typeof hostileEntry.sinceMs === "number" && Number.isFinite(hostileEntry.sinceMs) && hostileEntry.sinceMs >= 700 && hostileEntry.sinceMs <= 712, `hostile: finite entry sinceMs (${hostileEntry.sinceMs})`);
    // Stale evidence (>150ms gap) severs → inactive
    const stale = evidence("hc-hostile-stale", 4400, []);
    stale.anchors.find((a) => a.anchor === "nose").x = 0.4;
    stale.anchors.find((a) => a.anchor === "nose").y = 0.3;
    stale.anchors.find((a) => a.anchor === "nose").measurementTimestampMs = 4200;
    const staleInput = input(4400, stale); staleInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 4400, clock: clock(720, true), input: staleInput, equipmentPoses: equipmentPosesForEvidence(stale, "flow") });
    assert.equal(c.getSnapshot().hazardContact.active, false, "stale evidence severs: hazardContact inactive");
    // L-B2/L-B3 (0.0.61): the severing path must publish the release boundary, not only
    // drop occupation; sinceMs is retained so the renderer's release-moment pulse phase
    // stays recomputable from (sinceMs, releasedAtMs, params).
    assert.equal(c.getSnapshot().hazardContact.sinceMs, hostileEntry.sinceMs, "stale evidence severs: sinceMs retained from the episode entry");
    assert.equal(c.getSnapshot().hazardContact.releasedAtMs, 720, "stale evidence severs: releasedAtMs published at the severing tick (pre-fix it was null)");
  }

  // --- L-B2/L-B3 (0.0.61): non-continuous sample gap BEFORE the interval ends publishes
  // the release boundary for flow walls with the entry sinceMs retained (pre-fix the
  // snapshot stayed {active:false, sinceMs:<entry>, releasedAtMs:null}; L-B2 published
  // releasedAtMs but nulled sinceMs, which the renderer's release-moment pulse phase
  // needs retained) ---
  {
    const c = createAeroGameplaySessionCoordinator({ sessionId: "hc-gap" });
    const wall = canonicalFlowEvent("hc-gap-wall", 700, { start: 1.4, end: 1.6, type: "obstacle", ...wallGeometry }, 1200);
    readyPlaying(c, [wall], flow);
    // Baseline outside at 700
    const base = evidence("hc-gap-base", 3700, []);
    base.anchors.find((a) => a.anchor === "nose").x = 0.125;
    base.anchors.find((a) => a.anchor === "nose").y = 0.5;
    const baseInput = input(3700, base); baseInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 3700, clock: clock(700, true), input: baseInput, equipmentPoses: equipmentPosesForEvidence(base, "flow") });
    assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: null, releasedAtMs: null }, "gap: idle before any contact");
    // Enter at 750
    const inside = evidence("hc-gap-in", 3800, []);
    inside.anchors.find((a) => a.anchor === "nose").x = 0.4;
    inside.anchors.find((a) => a.anchor === "nose").y = 0.3;
    const inInput = input(3800, inside); inInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 3800, clock: clock(750, true), input: inInput, equipmentPoses: equipmentPosesForEvidence(inside, "flow") });
    const enterHc = c.getSnapshot().hazardContact;
    assert.equal(enterHc.active, true, "gap: active inside the wall");
    assert.ok(Number.isFinite(enterHc.sinceMs) && enterHc.sinceMs >= 700 && enterHc.sinceMs <= 750, `gap: sinceMs is the clipped entry (${enterHc.sinceMs})`);
    assert.equal(enterHc.releasedAtMs, null, "gap: releasedAtMs null while the episode is active");
    const gapEntrySinceMs = enterHc.sinceMs;
    // 200 ms sample gap (> maximumObstacleSampleGapMs=150) with the nose now OUTSIDE the
    // wall, while the interval [700,1200] is still open: occupied is severed without an
    // exit boundary and the release boundary must be published at this tick.
    const gap = evidence("hc-gap-out", 4000, []);
    gap.anchors.find((a) => a.anchor === "nose").x = 0.125;
    gap.anchors.find((a) => a.anchor === "nose").y = 0.5;
    const gapInput = input(4000, gap); gapInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 4000, clock: clock(950, true), input: gapInput, equipmentPoses: equipmentPosesForEvidence(gap, "flow") });
    const gapHc = c.getSnapshot().hazardContact;
    assert.equal(gapHc.active, false, "gap: occupied severed after the non-continuous sample gap");
    assert.equal(gapHc.sinceMs, gapEntrySinceMs, "gap: sinceMs retained from the episode entry after the severing gap");
    assert.equal(gapHc.releasedAtMs, 950, "gap: releasedAtMs published at the gap tick (pre-fix it was null)");
    // Past the interval end: the wall finalizes exactly once as a contact and the
    // already-published release tick is not overwritten by the finalize.
    const after = evidence("hc-gap-after", 4300, []);
    after.anchors.find((a) => a.anchor === "nose").x = 0.125;
    after.anchors.find((a) => a.anchor === "nose").y = 0.5;
    const afterInput = input(4300, after); afterInput.sourceIdentity = "src-1";
    c.advance({ timestampMs: 4300, clock: clock(1250, true), input: afterInput, equipmentPoses: equipmentPosesForEvidence(after, "flow") });
    assert.deepEqual(c.getSnapshot().hazardContact, { active: false, sinceMs: gapEntrySinceMs, releasedAtMs: 950 }, "gap: finalize does not overwrite the published release tick or the retained entry sinceMs");
    const wallOutcomes = c.getHazardOutcomes().filter((outcome) => outcome.kind === "wall" && outcome.eventId === "hc-gap-wall");
    assert.equal(wallOutcomes.length, 1, "gap: the wall settles exactly once");
    assert.equal(wallOutcomes[0].result, "contact", "gap: the clipped entry settles as a contact outcome");
  }
}
// Every invalid or discontinuous boundary still severs the sparse interpolation chain.
{
  const flow = variant("flow_colliders_v1");
  const sourceGeometry={schema:"aerobeat/obstacle_source_geometry",version:1,coordinateSpace:"beatsaber_v2_legacy_obstacle",kind:"v2_type_1",x:1,y:2,width:1,height:3};const gameplayGeometry={schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",x:1,y:0,width:1,height:3};
  const wall = () => canonicalFlowEvent("boundary-wall", 700, { start: 1.4, end: 1.45, type: "obstacle", sourceGeometry,gameplayGeometry,gridMask:[1,5,9] }, 725);
  const setNose = (sample, x) => { const nose = sample.anchors.find((entry) => entry.anchor === "nose"); nose.x = x; nose.y = 0; return sample; };
  const assertSevered = (label, insert, secondTimestampMs = 4060, secondCalibrationId = "cal-1") => {
    const coordinator = createAeroGameplaySessionCoordinator({ sessionId: `boundary-${label}` });
    readyPlaying(coordinator, [wall()], flow);
    const outsideBefore = setNose(evidence(`boundary-outside-${label}`, 3750, []), 0.125);
    outsideBefore.anchors.find((entry) => entry.anchor === "nose").y = 0.5;
    coordinator.advance({ timestampMs: 3750, clock: clock(640, true), input: productionInput(3750, outsideBefore), equipmentPoses: equipmentPosesForEvidence(outsideBefore, "flow") });
    const insideSample = setNose(evidence(`boundary-inside-${label}`, 3850, []), 0.125);
    insideSample.anchors.find((entry) => entry.anchor === "nose").y = 0.5;
    coordinator.advance({ timestampMs: 3850, clock: clock(705, true), input: productionInput(3850, insideSample), equipmentPoses: equipmentPosesForEvidence(insideSample, "flow") });
    const holdInside = setNose(evidence(`boundary-hold-${label}`, 3950, []), 0.125);
    holdInside.anchors.find((entry) => entry.anchor === "nose").y = 0.5;
    coordinator.advance({ timestampMs: 3950, clock: clock(760, true), input: productionInput(3950, holdInside), equipmentPoses: equipmentPosesForEvidence(holdInside, "flow") });
    const first = setNose(evidence("boundary-before", 4000, []), 0.125);
    coordinator.advance({ timestampMs: 4000, clock: clock(680, true), input: productionInput(4000, first), equipmentPoses: equipmentPosesForEvidence(first, "flow") });
    insert(coordinator, first);
    const second = setNose(evidence("boundary-after", secondTimestampMs, []), 0.875);
    second.calibrationId = secondCalibrationId;
    for (const anchorEntry of second.anchors) anchorEntry.calibrationId = secondCalibrationId;
    coordinator.advance({ timestampMs: secondTimestampMs, clock: clock(740, true), input: productionInput(secondTimestampMs, second, { calibrationId: secondCalibrationId }), equipmentPoses: equipmentPosesForEvidence(second, "flow") });
    assert.equal(coordinator.getHazardOutcomes().filter((outcome) => outcome.kind === "wall").length, 1, `${label} must settle the wall exactly once; severs prevent clipping but never duplicate or suppress a settled interval`);
    assert.equal(coordinator.getScorePartitions().length, 0, `${label} uncertainty is nonpenalizing`);
    assert.equal(coordinator.getJudgements().length, 0, `${label} cannot create note truth`);
  };
  assertSevered("invalid-fresh", (coordinator) => { const invalid = setNose(evidence("boundary-invalid", 4010, []), 0.5); invalid.anchors.find((entry) => entry.anchor === "nose").confidence = 0.49; coordinator.advance({ timestampMs: 4010, clock: clock(690, true), input: productionInput(4010, invalid), equipmentPoses: equipmentPosesForEvidence(invalid, "flow") }); });
  assertSevered("invalid-duplicate", (coordinator) => { const invalid = setNose(evidence("boundary-before", 4000, []), 0.125); invalid.anchors.find((entry) => entry.anchor === "nose").confidence = 0.49; coordinator.advance({ timestampMs: 4010, clock: clock(690, true), input: productionInput(4000, invalid), equipmentPoses: equipmentPosesForEvidence(invalid, "flow") }); });
  assertSevered("conflicting-duplicate", (coordinator) => { const conflicting = setNose(evidence("boundary-before", 4000, []), 0.5); coordinator.advance({ timestampMs: 4010, clock: clock(690, true), input: productionInput(4000, conflicting), equipmentPoses: equipmentPosesForEvidence(conflicting, "flow") }); });
  assertSevered("stale-nose", (coordinator) => { const stale = setNose(evidence("boundary-stale-nose", 4151, []), 0.125); stale.anchors.find((entry) => entry.anchor === "nose").measurementTimestampMs = 4000; coordinator.advance({ timestampMs: 4151, clock: clock(700, true), input: productionInput(4151, stale), equipmentPoses: equipmentPosesForEvidence(stale, "flow") }); }, 4160);
  assertSevered("measurement-rollback", (coordinator) => { const rollback = setNose(evidence("boundary-rollback", 3990, []), 0.125); coordinator.advance({ timestampMs: 4010, clock: clock(690, true), input: productionInput(3990, rollback), equipmentPoses: equipmentPosesForEvidence(rollback, "flow") }); });
  assertSevered("gap-over-150ms", () => {}, 4160);
  assertSevered("calibration-change", (coordinator) => { const changed = setNose(evidence("boundary-calibration", 4010, []), 0.125); changed.calibrationId = "cal-2"; for (const anchorEntry of changed.anchors) anchorEntry.calibrationId = "cal-2"; coordinator.advance({ timestampMs: 4010, clock: clock(730, true), input: productionInput(4010, changed, { calibrationId: "cal-2" }), equipmentPoses: equipmentPosesForEvidence(changed, "flow") }); }, 4060, "cal-2");

  const lost = createAeroGameplaySessionCoordinator({ sessionId: "boundary-tracking-loss" });
  readyPlaying(lost, [wall()], flow);
  const lostOutside = setNose(evidence("lost-outside", 3750, []), 0.125);
  lostOutside.anchors.find((entry) => entry.anchor === "nose").y = 0.5;
  lost.advance({ timestampMs: 3750, clock: clock(640, true), input: productionInput(3750, lostOutside), equipmentPoses: equipmentPosesForEvidence(lostOutside, "flow") });
  const lostInside = setNose(evidence("lost-inside", 3850, []), 0.125);
  lostInside.anchors.find((entry) => entry.anchor === "nose").y = 0.5;
  lost.advance({ timestampMs: 3850, clock: clock(705, true), input: productionInput(3850, lostInside), equipmentPoses: equipmentPosesForEvidence(lostInside, "flow") });
  const lostHold = setNose(evidence("lost-hold", 3950, []), 0.125);
  lostHold.anchors.find((entry) => entry.anchor === "nose").y = 0.5;
  lost.advance({ timestampMs: 3950, clock: clock(760, true), input: productionInput(3950, lostHold), equipmentPoses: equipmentPosesForEvidence(lostHold, "flow") });
  const lostBefore = setNose(evidence("lost-before", 4000, []), 0.125);
  lost.advance({ timestampMs: 4000, clock: clock(680, true), input: productionInput(4000, lostBefore), equipmentPoses: equipmentPosesForEvidence(lostBefore, "flow") });
  const lostFrame = evidence("lost-frame", 4010, []);
  lost.advance({ timestampMs: 4010, clock: clock(690, true), input: productionInput(4010, lostFrame, { paused: true, fresh: true }), equipmentPoses: equipmentPosesForEvidence(lostFrame, "flow") });
  const recovered = setNose(evidence("lost-after", 7030, []), 0.875); recovered.calibrationId = "cal-2"; for (const anchorEntry of recovered.anchors) anchorEntry.calibrationId = "cal-2";
  lost.advance({ timestampMs: 4020, clock: clock(680, false), input: input(4020, null, { calibrationId: "cal-2" }) });
  lost.advance({ timestampMs: 5020, clock: clock(680, false) }); lost.advance({ timestampMs: 6020, clock: clock(680, false) }); lost.advance({ timestampMs: 7020, clock: clock(680, false) });
  lost.advance({ timestampMs: 7030, clock: clock(740, true), input: productionInput(7030, recovered, { calibrationId: "cal-2" }), equipmentPoses: equipmentPosesForEvidence(recovered, "flow") });
  assert.equal(lost.getHazardOutcomes().filter((outcome) => outcome.kind === "wall").length, 1, "tracking loss still settles the wall interval exactly once");
  assert.equal(lost.getScorePartitions().length, 0);
}

// Same-frame guard/punch overlap is exclusive, while disjoint squat+punch is concurrent.
{
  const overlap = createAeroGameplaySessionCoordinator({ sessionId: "overlap" });
  readyPlaying(overlap, [event("a-guard", 1000, "guard", { guardTarget: { leftCell: 5, rightCell: 6 } }), event("b-hook", 1000, "hook_left")]);
  overlap.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, evidence("frame-overlap", 4000, ["guard", "hook_left"])) });
  assert.deepEqual(overlap.getJudgements().map((entry) => [entry.result, entry.diagnostics]), [["hit", []], ["miss", ["blocked_overlap"]]]);

  const disjoint = createAeroGameplaySessionCoordinator({ sessionId: "disjoint" });
  readyPlaying(disjoint, [event("a-squat", 1000, "squat"), event("b-hook", 1000, "hook_left")]);
  disjoint.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, evidence("frame-disjoint", 4000, ["squat", "hook_left"])) });
  assert.deepEqual(disjoint.getJudgements().map((entry) => entry.result), ["hit", "hit"]);
}

// Semantic Track scores defensive action only; Spatial Grid additionally checks the instantaneous calibrated nose-safe cell.
{
  const semantic=createAeroGameplaySessionCoordinator({sessionId:"semantic-obstacle"});readyPlaying(semantic,[event("semantic-weave",1000,"weave_right")]);const semanticSample=evidence("semantic-obstacle-frame",4000,["weave_right"]);semanticSample.anchors=semanticSample.anchors.map((entry)=>entry.anchor==="nose"?{...entry,cell:0,subcell:0}:entry);semantic.advance({timestampMs:4000,clock:clock(1000,true),input:input(4000,semanticSample)});assert.equal(semantic.getJudgements()[0].result,"hit","Semantic Track obstacle judgement must remain action-only");
  const spatial=createAeroGameplaySessionCoordinator({sessionId:"spatial-obstacle"});readyPlaying(spatial,[event("spatial-weave",1000,"weave_right")],variant("boxing_spatial_grid_v1"));const spatialSample=evidence("spatial-obstacle-frame",4000,["weave_right"]);spatialSample.anchors=spatialSample.anchors.map((entry)=>entry.anchor==="nose"?{...entry,cell:0,subcell:0}:entry);spatial.advance({timestampMs:4000,clock:clock(1000,true),input:input(4000,spatialSample)});const spatialExpired=evidence("spatial-obstacle-expired",4181,["weave_right"]);spatialExpired.anchors=spatialExpired.anchors.map((entry)=>entry.anchor==="nose"?{...entry,cell:0,subcell:0}:entry);spatial.advance({timestampMs:4181,clock:clock(1181,true),input:input(4181,spatialExpired)});assert.deepEqual([spatial.getJudgements()[0].result,spatial.getJudgements()[0].diagnostics],["miss",["wrong_cell"]],"Spatial Grid obstacle judgement must require the calibrated instantaneous nose-safe checkpoint");
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
  coordinator.advance({ timestampMs: 4500, clock: clock(1000, false), input: input(4500, null, { calibrationId: "cal-1", fresh: true }) });
  assert.equal(coordinator.getSnapshot().session.state, "paused_tracking", "the input service still requires recalibration (same calibrationId, not yet recovered)");
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

// Partial auto-recovery (same calibrationId, input clears freshCalibrationRequired)
// resumes the session WITHOUT a new calibrationId via the tracking_resume countdown.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "recovery-resume" });
  readyPlaying(coordinator, [event("recover", 9000, "hook_left")]);
  // Tracking loss: input reports paused + fresh.
  coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, null, { paused: true, fresh: true }) });
  assert.equal(coordinator.getSnapshot().session.state, "paused_tracking");
  // Partial recovery: input clears freshCalibrationRequired, same calibrationId.
  coordinator.advance({ timestampMs: 4500, clock: clock(1000, false), input: input(4500, null, { calibrationId: "cal-1" }) });
  assert.equal(coordinator.getSnapshot().session.state, "countdown", "partial recovery auto-resumes via tracking_resume countdown");
  assert.equal(coordinator.getSnapshot().countdown.reason, "tracking_resume");
  assert.equal(coordinator.getSnapshot().countdown.calibrationId, "cal-1", "no new calibrationId was minted by partial recovery");
  // Countdown completes → playing.
  coordinator.advance({ timestampMs: 50_000, clock: clock(0, false) });
  coordinator.advance({ timestampMs: 50_999, clock: clock(0, false) });
  coordinator.advance({ timestampMs: 51_000, clock: clock(0, false) });
  coordinator.advance({ timestampMs: 52_000, clock: clock(0, false) });
  assert.equal(coordinator.getSnapshot().session.state, "playing");
}

// Invalidation (source change) still requires full T-pose: input keeps
// freshCalibrationRequired true until a NEW calibrationId is committed.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "source-invalid" });
  readyPlaying(coordinator, [event("src", 9000, "hook_left")]);
  coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, null, { paused: true, fresh: true }) });
  assert.equal(coordinator.getSnapshot().session.state, "paused_tracking");
  // Source change: input keeps fresh=true even with the same calibrationId.
  coordinator.advance({ timestampMs: 4500, clock: clock(1000, false), input: input(4500, null, { calibrationId: "cal-1", fresh: true }) });
  assert.equal(coordinator.getSnapshot().session.state, "paused_tracking", "source change keeps the session paused");
  assert.equal(coordinator.getSnapshot().safety.freshCalibrationRequired, true);
  // Full T-pose completes: new calibrationId, fresh cleared.
  coordinator.advance({ timestampMs: 5000, clock: clock(1000, false), input: input(5000, null, { calibrationId: "cal-2" }) });
  assert.equal(coordinator.getSnapshot().session.state, "countdown");
  assert.equal(coordinator.getSnapshot().countdown.calibrationId, "cal-2", "full T-pose mints a new calibrationId");
}

// Tracking safety must take precedence over a manual/menu pause. Closing the
// menu while input still requires recalibration restores paused_tracking and its
// cue; authoritative recovered truth on a new calibration generation can then
// enter the normal tracking_resume countdown.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "paused-manual-safety-precedence" });
  readyPlaying(coordinator, [event("late", 9000, "hook_left")]);
  coordinator.pause(4000, "menu_open");
  assert.equal(coordinator.getSnapshot().session.state, "paused_manual");
  coordinator.advance({ timestampMs: 4500, clock: clock(1000, false), input: input(4500, null, { ready: false, fresh: true }) });
  assert.equal(coordinator.getSnapshot().session.state, "paused_tracking", "unsafe input truth overrides paused_manual");
  assert.equal(coordinator.getSnapshot().session.pauseReason, "tracking_lost_recalibration_required");
  coordinator.advance({ timestampMs: 5000, clock: clock(1000, false), input: input(5000, null, { calibrationId: "cal-2", readiness: "countdown" }) });
  assert.equal(coordinator.getSnapshot().session.state, "countdown", "new-generation recovered truth reaches tracking_resume");
  assert.equal(coordinator.getSnapshot().countdown.reason, "tracking_resume");
  assert.equal(coordinator.getSnapshot().countdown.calibrationId, "cal-2");
}

// D1 recovery seam (mobile-menu + shell-matrix reds): after a tracking loss the
// input service commits a NEW calibrationId before the next scored frame arrives,
// so the snapshot's calibration jumps generations in a single advance. The
// coordinator must treat that as FRESH CALIBRATION TRUTH (recalibration complete),
// not keep re-pausing on a stale latched guard — the previous behavior froze the
// session in paused_tracking forever. Exact expected semantics:
//   • playing→paused_tracking on the loss frame (clean D1 pause);
//   • the recalibrated snapshot resumes via the tracking_resume countdown;
//   • repeated frames with the same new-generation evidence are idempotent.
// The production input service can never hand over cross-generation evidence
// (its commit drops the old frame — see the input repo oracle), so the only
// reachable shape here is evidence tagged with the fresh id.
{
  const freshFrame = (calibrationId) => ({ schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId, measuredSourceFrameId: `measured-frame:cam:${calibrationId}`, measurementTimestampMs: 5000, provenance: "measured", activeBoxingActions: [], anchors: Object.entries({ nose: 1, left_shoulder: 4, right_shoulder: 7, left_elbow: 4, right_elbow: 7, left_wrist: 5, right_wrist: 6 }).map(([name, cell]) => ({ schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId, measurementTimestampMs: 5000, valid: true, confidence: 1, rawX: .5, rawY: .5, x: .5, y: .5, cell, subcell: cell + 1 })), entries: [] });
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "recovery-seam" });
  readyPlaying(coordinator, [event("late", 9000, "hook_left")]);
  // Live scoring on cal-1, then the tracking-loss frame (null evidence, paused+fresh).
  coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, evidence("frame-live", 4000, ["hook_left"])) });
  coordinator.advance({ timestampMs: 4500, clock: clock(1000, true), input: input(4500, null, { paused: true, fresh: true }) });
  assert.equal(coordinator.getSnapshot().session.state, "paused_tracking", "tracking loss pauses cleanly during play");
  assert.equal(coordinator.getSnapshot().session.pauseReason, "tracking_lost_recalibration_required");
  assert.equal(coordinator.getSnapshot().safety.freshCalibrationRequired, true);
  // Recalibration commits cal-2; its first published snapshot already carries
  // fresh=false with the new-generation evidence (service dropped the stale frame).
  coordinator.advance({ timestampMs: 5000, clock: clock(1000, false), input: input(5000, freshFrame("cal-2"), { calibrationId: "cal-2", readiness: "countdown" }) });
  assert.equal(coordinator.getSnapshot().session.state, "countdown", "freshly recalibrated truth resumes via tracking_resume countdown");
  assert.equal(coordinator.getSnapshot().countdown.reason, "tracking_resume");
  assert.equal(coordinator.getSnapshot().countdown.calibrationId, "cal-2");
  // Repeated display frames publish the same new-generation evidence (idempotent).
  coordinator.advance({ timestampMs: 5100, clock: clock(1000, false), input: input(5100, freshFrame("cal-2"), { calibrationId: "cal-2", readiness: "countdown" }) });
  assert.equal(coordinator.getSnapshot().session.state, "countdown");
  // Walk the wall-clock countdown against the frozen audio clock to completion;
  // the app then starts audio on the very next display frame (the browser seam's
  // syncAudioForGameplay), which this unit models as the clock flipping to
  // playing while the timeline is still at the pause position.
  for (const ts of [60_000, 61_000, 62_000]) coordinator.advance({ timestampMs: ts, clock: clock(1000, false) });
  coordinator.advance({ timestampMs: 70_000, clock: clock(1000, true) });
  assert.equal(coordinator.getSnapshot().session.state, "playing", "audio start lands the session in steady play at the frozen timeline");
  assert.equal(coordinator.getSnapshot().session.timelinePositionMs, 1000);
}

// The mirror half of the seam (shell-matrix's exact shape): from paused_tracking,
// a RECOVERED input snapshot — fresh cleared, no pause flags, live calibrated
// evidence on the SAME generation (the anchor-freeze partial auto-recovery that
// never mints a new id) — must resume via the tracking_resume countdown instead
// of parking in paused_tracking forever.
{
  const recoveredFrame = ({ schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal-1", measuredSourceFrameId: "measured-frame:cam:recovered", measurementTimestampMs: 5000, provenance: "measured", activeBoxingActions: [], anchors: Object.entries({ nose: 1, left_shoulder: 4, right_shoulder: 7, left_elbow: 4, right_elbow: 7, left_wrist: 5, right_wrist: 6 }).map(([name, cell]) => ({ schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "cal-1", measurementTimestampMs: 5000, valid: true, confidence: 1, rawX: .5, rawY: .5, x: .5, y: .5, cell, subcell: cell + 1 })), entries: [] });
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "resume-seam" });
  readyPlaying(coordinator, [event("late", 9000, "hook_left")]);
  coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, null, { paused: true, fresh: true }) });
  assert.equal(coordinator.getSnapshot().session.state, "paused_tracking");
  // Partial auto-recovery clears freshCalibrationRequired without minting a new id;
  // its first scored frame carries live evidence on the same generation.
  coordinator.advance({ timestampMs: 5000, clock: clock(1000, false), input: input(5000, recoveredFrame, { calibrationId: "cal-1", readiness: "countdown" }) });
  assert.equal(coordinator.getSnapshot().session.state, "countdown", "recovered same-generation truth resumes via tracking_resume countdown");
  assert.equal(coordinator.getSnapshot().countdown.reason, "tracking_resume");
  // The recovery countdown must walk its digits on a CONTINUOUS wall clock (the
  // suite proves the full digit dwell end-to-end; here each step needs ≥1000ms of
  // monotonic advance from the prior commit) and complete at the pause position.
  // Walk against a CONTINUOUS wall clock. Each step needs ≥1000ms from the prior
  // commit; note t=6000 lands exactly at the countdown start and is the first
  // dwell tick (still "three"), so the full walk spans four steps.
  // A subsequent display frame must not throw (the old frozen-clock symptom) — the
  // session is parked awaiting the app's audio-start commit (paused_manual here in
  // this minimal unit; playing after the seam starts audio in the browser suites).
  coordinator.advance({ timestampMs: 5500, clock: clock(1000, false) });
  assert.ok(["countdown", "paused_manual", "playing"].includes(coordinator.getSnapshot().session.state), "post-recovery frames advance without rejection");
}

// Second half of the seam (mobile-menu + shell-matrix reds): while parked in
// paused_tracking, the coordinator must re-evaluate against the CURRENT committed
// input. With only the stale pre-pause flags (fresh=true from the loss frame) a
// freshly-recalibrated generation that already publishes fresh-cleared truth can
// never flip safetyReady — the scored frame that would clear it cannot arrive
// while the session is paused, so the recovery parks forever. The current-input
// guard releases the latch exactly when upstream truth recovers, and STILL parks
// while that truth demands recalibration.
{
  const lostFrame = () => ({ schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal-1", measuredSourceFrameId: "measured-frame:cam:fresh-t2", measurementTimestampMs: 6500, provenance: "measured", activeBoxingActions: [], anchors: Object.entries({ nose: 1, left_shoulder: 4, right_shoulder: 7, left_elbow: 4, right_elbow: 7, left_wrist: 5, right_wrist: 6 }).map(([name, cell]) => ({ schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "cal-1", measurementTimestampMs: 6500, valid: true, confidence: 1, rawX: .5, rawY: .5, x: .5, y: .5, cell, subcell: cell + 1 })), entries: [] });
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "current-input-recovery" });
  readyPlaying(coordinator, [event("late", 9000, "hook_left")]);
  // Live scoring on cal-1, then the recalibrating snapshot (readiness flip) that
  // the D1 loss window publishes — this is what pauses play.
  coordinator.advance({ timestampMs: 3000, clock: clock(700, true), input: input(3000, evidence("frame-live", 3000, ["hook_left"]), { calibrationId: "cal-1" }) });
  coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, null, { calibrationId: "cal-1", ready: false }) });
  assert.equal(coordinator.getSnapshot().session.state, "paused_tracking", "readiness flip during play enters the tracking pause");
  // Recalibration commits cal-2; the fixed input service drops the old frame at the
  // commit and republishes on the new id — the first recovered snapshot therefore
  // carries fresh-cleared truth AND new-generation evidence in one advance.
  const recoveredFrame = ({ schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal-2", measuredSourceFrameId: "measured-frame:cam:fresh-t2", measurementTimestampMs: 6500, provenance: "measured", activeBoxingActions: [], anchors: Object.entries({ nose: 1, left_shoulder: 4, right_shoulder: 7, left_elbow: 4, right_elbow: 7, left_wrist: 5, right_wrist: 6 }).map(([name, cell]) => ({ schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "cal-2", measurementTimestampMs: 6500, valid: true, confidence: 1, rawX: .5, rawY: .5, x: .5, y: .5, cell, subcell: cell + 1 })), entries: [] });
  coordinator.advance({ timestampMs: 5000, clock: clock(1000, false), input: input(5000, recoveredFrame, { calibrationId: "cal-2" }) });
  assert.equal(coordinator.getSnapshot().session.state, "countdown", "current-input truth releases the paused latch into the tracking_resume countdown");
  assert.equal(coordinator.getSnapshot().countdown.reason, "tracking_resume");
  assert.equal(coordinator.getSnapshot().countdown.calibrationId, "cal-2");
  // A further snapshot that still demands recalibration (readiness back to
  // calibration_required, e.g. an interrupted hold) must park the session again —
  // the guard re-enters the tracking pause instead of walking the countdown.
  coordinator.advance({ timestampMs: 5500, clock: clock(1000, false), input: input(5500, null, { calibrationId: "cal-2", ready: false }) });
  assert.equal(coordinator.getSnapshot().session.state, "paused_tracking", "non-recovered truth re-enters the tracking pause during the resume countdown");
}

// The public input contract itself stays strict: evidence whose calibrationId does
// not match the snapshot's live calibration is a hard violation. The assembly seam
// routes any such throw to its error path instead of swallowing it, so a regression
// like the stale-evidence freeze surfaces instead of freezing the session silently.
{
  const mismatched = (calibrationId) => ({ schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId, measuredSourceFrameId: "measured-frame:cam:pre-loss", measurementTimestampMs: 4000, provenance: "measured", activeBoxingActions: [], anchors: Object.entries({ nose: 1, left_shoulder: 4, right_shoulder: 7, left_elbow: 4, right_elbow: 7, left_wrist: 5, right_wrist: 6 }).map(([name, cell]) => ({ schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId, measurementTimestampMs: 4000, valid: true, confidence: 1, rawX: .5, rawY: .5, x: .5, y: .5, cell, subcell: cell + 1 })), entries: [] });
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "identity-contract" });
  readyPlaying(coordinator, [event("late", 9000, "hook_left")]);
  coordinator.advance({ timestampMs: 4500, clock: clock(1000, true), input: input(4500, null, { paused: true, fresh: true }) });
  assert.throws(() => coordinator.advance({ timestampMs: 5500, clock: clock(1000, false), input: input(5500, mismatched("cal-9"), { calibrationId: "cal-2", readiness: "countdown" }) }), /Input evidence must belong to the snapshot calibration/u, "cross-generation evidence against a live calibrationId is a contract violation");
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
  assert.throws(() => coordinator.configureContent(config([], { ...variant("flow_colliders_v1"), mode: "boxing" })), /Boxing variants require/u);
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

// W4-C2a (0.0.60, F4): tracking freeze — the coordinator accepts provenance
// "frozen" evidence in both collider paths while the session stays "playing":
// the 150ms freshness gate is EXEMPTED for frozen frames (the held timestamp
// deliberately ages past it), (calibrationId, frozenTickId) is the per-tick
// frame identity so every tick is a new frame, judgedIds remains the only
// double-hit guard, and a measured frame after a frozen episode resumes
// normal monotonic handling. The held positions are scoring-eligible:
// on-target frozen fist -> HIT, off-target -> MISS.
{
  const bcolVariant = variant("boxing_collider_v1", null);
  const flowVariant = variant("flow_colliders_v1");
  let frozenSeq = 0;
  /** Canonical judge-space (sx, sy) anchor: x = (sx+0.5)/4, y = (2.5-sy)/3. */
  const fAnchor = (name, measured, sx, sy) => ({ schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "cal-1", measurementTimestampMs: measured, valid: true, confidence: 1, rawX: 0.5, rawY: 0.5, x: (sx + 0.5) / 4, y: (2.5 - sy) / 3, cell: 5, subcell: 20 });
  /** Positions-only evidence (empty actions/entries on frozen frames). */
  const fEvidence = (frameId, measured, left, right, frozenTickId) => ({ schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal-1", measuredSourceFrameId: frameId, measurementTimestampMs: measured, provenance: frozenTickId === undefined ? "measured" : "frozen", ...(frozenTickId === undefined ? {} : { frozenTickId }), activeBoxingActions: [], anchors: [fAnchor("nose", measured, 2, 2.5), fAnchor("left_shoulder", measured, 0, 0), fAnchor("right_shoulder", measured, 3, 0), fAnchor("left_elbow", measured, 0, 0), fAnchor("right_elbow", measured, 3, 0), fAnchor("left_wrist", measured, ...left), fAnchor("right_wrist", measured, ...right)], entries: [] });
  const fInput = (latestEvidence) => ({ sourceIdentity: "camera-a", calibration: { calibrationId: "cal-1", readiness: "countdown" }, tracking: { gameplayPaused: false, freshCalibrationRequired: false }, countdownFrozen: false, latestEvidence, straightQualifications: [] });
  const readyB = (label, events, selected) => {
    const c = createAeroGameplaySessionCoordinator({ sessionId: `frozen-${label}-${++frozenSeq}`, countdownStepMs: 1 });
    c.configureContent(config(events, selected));
    c.advance({ timestampMs: 0, clock: clock(0, false), input: fInput(null) });
    assert.equal(c.requestStart(0).accepted, true);
    c.advance({ timestampMs: 1, clock: clock(0, false) });
    c.advance({ timestampMs: 2, clock: clock(0, false) });
    c.advance({ timestampMs: 3, clock: clock(0, false) });
    assert.equal(c.getSnapshot().session.state, "playing");
    return c;
  };
  /** Wall time == song time, measured frame (fresh, age 0). */
  const sendMeasured = (c, songMs, left, right, frameId) => { const sample = fEvidence(frameId, songMs, left, right); return c.advance({ timestampMs: songMs, clock: clock(songMs, true), input: fInput(sample), equipmentPoses: equipmentPosesForEvidence(sample, c.getSnapshot().selectedVariant.mode) }); };
  /** Frozen re-publication of the held frame (heldTs < songMs, tick = episode ordinal). */
  const sendFrozen = (c, songMs, heldTs, left, right, tick) => { const sample = fEvidence("held-1", heldTs, left, right, tick); return c.advance({ timestampMs: songMs, clock: clock(songMs, true), input: fInput(sample), equipmentPoses: equipmentPosesForEvidence(sample, c.getSnapshot().selectedVariant.mode) }); };
  const straightRight = (eventId) => event(eventId, 1000, "straight_right", { spatialTarget: { targetCell: 6, acceptedSubcells: [], sourceCell: -1 } });
  /** Far-future decoy note so a chart's last judged event never completes the session. */
  const future = (eventId) => event(eventId, 5000, "straight_right", { spatialTarget: { targetCell: 5, acceptedSubcells: [], sourceCell: -1 } });

  // (a) Core case: straight_right target (2,1) sits at the held right-wrist
  // position. The note window [820,1180] is open when the frozen ticks arrive,
  // so the note HITS on the first frozen tick (freshness-exempted point
  // contact scored at the current song position) and EXACTLY ONCE across all
  // frozen ticks (judgedIds guard; swept contacts stay impossible because the
  // held segment repeats one source frame / one timestamp).
  {
    const c = readyB("hit", [straightRight("fr-hit"), future("fr-hit-future")], bcolVariant);
    sendMeasured(c, 600, [0, 0], [2, 1], "fr-hit-f1");
    assert.equal(c.getJudgements().length, 0, "held position before the window opens does not score");
    sendFrozen(c, 850, 600, [0, 0], [2, 1], 1);
    assert.equal(c.getSnapshot().session.state, "playing", "session stays playing during the freeze");
    assert.deepEqual(c.getJudgements().map((j) => [j.eventId, j.result, j.committedTimelinePositionMs, j.timingOffsetMs]), [["fr-hit", "hit", 850, -150]], "frozen on-target fist scores a hit at the current song position");
    sendFrozen(c, 900, 600, [0, 0], [2, 1], 2);
    sendFrozen(c, 950, 600, [0, 0], [2, 1], 3);
    assert.equal(c.getSnapshot().session.state, "playing", "session stays playing across later frozen ticks");
    assert.equal(c.getJudgements().length, 1, "a frozen note never hits twice (judgedIds double-hit guard)");
    sendFrozen(c, 1200, 600, [0, 0], [2, 1], 4);
    assert.equal(c.getJudgements().length, 1, "no synthetic miss after a frozen hit");
    assert.equal(c.getSnapshot().session.state, "playing");
  }

  // (b) Off-target: the held position is NOT at the target, so the note
  // misses. Negative events still fire during/after the freeze (finalize uses
  // the advancing song timeline), and the measured frame that ends the freeze
  // resumes normal monotonic handling without being swallowed.
  {
    const c = readyB("miss", [straightRight("fr-miss"), future("fr-miss-future")], bcolVariant);
    sendMeasured(c, 600, [0, 0], [0, 1], "fr-miss-f1");
    sendFrozen(c, 850, 600, [0, 0], [0, 1], 1);
    sendFrozen(c, 900, 600, [0, 0], [0, 1], 2);
    assert.equal(c.getJudgements().length, 0, "off-target frozen fist scores nothing");
    assert.equal(c.getSnapshot().session.state, "playing", "session stays playing during the freeze");
    sendMeasured(c, 950, [0, 0], [0, 1], "fr-miss-f2");
    assert.equal(c.getJudgements().length, 0, "resume measured frame is evaluated normally (monotonic gate passes)");
    assert.equal(c.getSnapshot().session.state, "playing");
    sendMeasured(c, 1181, [0, 0], [0, 1], "fr-miss-f3");
    assert.deepEqual(c.getJudgements().map((j) => [j.eventId, j.result, [...j.diagnostics]]), [["fr-miss", "miss", ["wrong_collider"]]], "off-target note finalizes as a miss once the window closes");
    assert.equal(c.getSnapshot().session.state, "playing");
  }

  // (c) Resume: after off-target frozen ticks, tracking returns and a measured
  // frame carries the fist onto the target — the note hits via the measured
  // path (the freeze-to-measured transition is clean).
  {
    const c = readyB("resume", [straightRight("fr-resume"), future("fr-resume-future")], bcolVariant);
    sendMeasured(c, 600, [0, 0], [0, 1], "fr-resume-f1");
    sendFrozen(c, 850, 600, [0, 0], [0, 1], 1);
    sendFrozen(c, 900, 600, [0, 0], [0, 1], 2);
    sendMeasured(c, 950, [0, 0], [2, 1], "fr-resume-f2");
    assert.deepEqual(c.getJudgements().map((j) => [j.eventId, j.result, j.committedTimelinePositionMs, j.timingOffsetMs]), [["fr-resume", "hit", 950, -50]], "measured frame after the freeze hits normally via the measured path");
    sendMeasured(c, 1200, [0, 0], [2, 1], "fr-resume-f3");
    assert.equal(c.getJudgements().length, 1, "resume hit is not re-scored by later measured frames");
    assert.equal(c.getSnapshot().session.state, "playing");
  }

  // (d) Flow Colliders path: the same frozen acceptance applies to the swept
  // flow collider judge — a directionless note at the held position hits once
  // during the freeze.
  {
    const c = readyB("flow-hit", [event("fr-flow", 1000, "note", { hand: "right", placement: 6 }), event("fr-flow-future", 5000, "note", { hand: "left", placement: 9 })], flowVariant);
    sendMeasured(c, 600, [0, 0], [2, 1], "fr-flow-f1");
    assert.equal(c.getJudgements().length, 0);
    sendFrozen(c, 850, 600, [0, 0], [2, 1], 1);
    assert.equal(c.getSnapshot().session.state, "playing", "flow session stays playing during the freeze");
    assert.deepEqual(c.getJudgements().map((j) => [j.eventId, j.result, j.committedTimelinePositionMs, j.timingOffsetMs]), [["fr-flow", "hit", 850, -150]], "frozen on-target wrist scores the flow note at the current song position");
    sendFrozen(c, 900, 600, [0, 0], [2, 1], 2);
    sendFrozen(c, 950, 600, [0, 0], [2, 1], 3);
    assert.equal(c.getJudgements().length, 1, "flow note never hits twice across frozen ticks");
    assert.equal(c.getSnapshot().session.state, "playing");
  }

  // (e) Hostile frozen evidence fails closed like measured evidence: an
  // invalid frozenTickId is rejected at the contract boundary, and a frozen
  // frame whose anchor no longer matches the held calibration yields no sample
  // (no hit, state stays playing).
  {
    const c = readyB("hostile", [straightRight("fr-hostile"), future("fr-hostile-future")], bcolVariant);
    sendMeasured(c, 600, [0, 0], [2, 1], "fr-hostile-f1");
    const badTick = fEvidence("held-1", 600, [0, 0], [2, 1], 0);
    assert.throws(() => c.advance({ timestampMs: 850, clock: clock(850, true), input: fInput(badTick), equipmentPoses: equipmentPosesForEvidence(badTick, "boxing") }), /public contract/u, "frozenTickId must be a positive integer");
    const staleCal = fEvidence("held-1", 600, [0, 0], [2, 1], 1);
    staleCal.anchors.find((a) => a.anchor === "right_wrist").calibrationId = "cal-other";
    assert.throws(() => c.advance({ timestampMs: 850, clock: clock(850, true), input: fInput(staleCal), equipmentPoses: equipmentPosesForEvidence(staleCal, "boxing") }), /current valid measured wrist/u, "a calibration-mismatched wrist cannot authorize an equipment pose");
    assert.equal(c.getJudgements().length, 0, "rejected frozen frame leaves judgement truth unchanged");
    assert.equal(c.getSnapshot().session.state, "playing");
    sendFrozen(c, 900, 600, [0, 0], [2, 1], 2);
    assert.deepEqual(c.getJudgements().map((j) => [j.eventId, j.result]), [["fr-hostile", "hit"]], "the next clean frozen tick still scores");
  }
}

assert.equal(aeroGameplaySessionCapabilities.visualTestSession, true);
assert.equal(aeroGameplaySessionCapabilities.commitmentTimedJudgements, true);
assert.equal(aeroGameplaySessionCapabilities.publicLeaderboards, false);
console.log("Gameplay session deterministic validation passed.");
