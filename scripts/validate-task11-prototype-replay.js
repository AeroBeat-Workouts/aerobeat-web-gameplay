// @ts-check

import assert from "node:assert/strict";
import fs from "node:fs";
import { canonicalPrototypeProfileJson, createAeroGameplaySessionCoordinator, createAeroPrototypeProfileRegistry, sha256PrototypeProfileHex } from "../src/index.js";

const HASH = "a".repeat(64);
const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/task11-prototype-replay-v1.json", import.meta.url), "utf8"));
const fixtureHash = fixture.fixtureHash;
delete fixture.fixtureHash;
assert.equal(fixtureHash, `sha256:${sha256PrototypeProfileHex(canonicalPrototypeProfileJson(fixture))}`);
assert.equal(fixture.candidateMatrix.length, 5);
assert.equal(new Set(fixture.requiredScenarios).size, 26);
assert.deepEqual(fixture.modifierIds, ["any_punch", "cross_body", "crossed_guard", "no_squats", "no_weaves"]);

function variant(candidate, modifierIds = []) { return { variantId: candidate.id, chartId: candidate.chartId ?? `chart-${candidate.id}`, mode: candidate.mode, rulesetId: candidate.rulesetId, recipeId: candidate.recipeId, modifierIds, ranked: false, mapHash: hash(), scoreIdentityHash: hash(), provenance: { baseVariantId: candidate.id } }; }
function hash() { return { schema: "aerobeat/content_hash", version: 1, algorithm: "sha256", value: HASH }; }
function event(candidate, eventId, centerTimestampMs, type, extra = {}) { return { schema: "aerobeat/resolved_content_event", version: 1, eventId, variantId: candidate.id, chartId: candidate.chartId ?? `chart-${candidate.id}`, centerTimestampMs, sourceEventIds: [`source-${eventId}`], type, ...extra }; }
function anchor(name, measured, overrides = {}) { const defaults = { nose: [1,2], left_shoulder: [4,16], right_shoulder: [7,23], left_elbow: [4,16], right_elbow: [7,23], left_wrist: [5,20], right_wrist: [5,20] }; const [cell, subcell] = defaults[name]; return { schema: "aerobeat/body_grid_anchor_snapshot", version: 1, anchor: name, calibrationId: "cal-1", measurementTimestampMs: measured, valid: true, confidence: 1, rawX: 0.5, rawY: 0.5, x: 0.5, y: 0.5, cell, subcell, ...overrides }; }
function evidence(frameId, measured, actions, entries = []) { return { schema: "aerobeat/gameplay_evidence_snapshot", version: 1, calibrationId: "cal-1", measuredSourceFrameId: frameId, measurementTimestampMs: measured, provenance: "measured", activeBoxingActions: actions, anchors: ["nose","left_shoulder","right_shoulder","left_elbow","right_elbow","left_wrist","right_wrist"].map((name) => anchor(name, measured)), entries }; }
function input(measured, latestEvidence, options = {}) { return { calibration: { calibrationId: options.calibrationId ?? "cal-1", readiness: "countdown" }, tracking: { gameplayPaused: options.paused === true, freshCalibrationRequired: options.fresh === true }, countdownFrozen: options.paused === true, latestEvidence, straightQualifications: options.qualifications ?? [] }; }
function clock(positionMs, playing) { return { contextTimeSeconds: positionMs / 1000, durationSeconds: undefined, positionSeconds: positionMs / 1000, playing }; }
function profile(profileId = "aero.scoring.prototype-wide") { const registry = createAeroPrototypeProfileRegistry(); registry.select(profileId, { sessionState: "idle" }); return registry.getActive("between_run_ruleset"); }
function config(candidate, events, extras = {}) { const scoring = profile(extras.scoringProfileId); return { packageId: "task11-package", selectedVariant: variant(candidate, extras.modifierIds ?? []), resolvedEvents: events, profileIdentity: scoring.identity, scoringSettings: scoring.settings, shadowVariants: extras.shadowVariants ?? [] }; }
function ready(coordinator, configuration) { coordinator.configureContent(configuration); coordinator.advance({ timestampMs: 0, clock: clock(0, false), input: input(0, null) }); assert.equal(coordinator.requestStart(0).accepted, true); coordinator.advance({ timestampMs: 1000, clock: clock(0, false) }); coordinator.advance({ timestampMs: 2000, clock: clock(0, false) }); coordinator.advance({ timestampMs: 3000, clock: clock(0, false) }); assert.equal(coordinator.getSnapshot().session.state, "playing"); }

// Exact Flow plus four Boxing candidate identities all execute through public envelopes.
for (const candidate of fixture.candidateMatrix) {
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: `matrix-${candidate.id}` });
  if (candidate.mode === "flow") {
    const note = event(candidate, "flow-note", 1000, "note", { hand: "left", placement: 5, direction: "up" });
    ready(coordinator, config(candidate, [note]));
    const sample = evidence("flow-frame", 4000, [], [{ schema: "aerobeat/body_grid_cell_entry", version: 1, anchor: "left_wrist", calibrationId: "cal-1", measurementTimestampMs: 4000, fromCell: 9, toCell: 5, direction: "up", provenance: "measured" }]);
    coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, sample) });
  } else {
    const extra = candidate.rulesetId === "boxing_spatial_grid_v1" ? { spatialTarget: { targetCell: 5, acceptedSubcells: [20], sourceCell: 9, entryDirection: "up" } } : {};
    ready(coordinator, config(candidate, [event(candidate, "candidate-hook", 1000, "hook_left", extra)]));
    const entries = candidate.rulesetId === "boxing_spatial_grid_v1" ? [{ schema: "aerobeat/body_grid_cell_entry", version: 1, anchor: "left_wrist", calibrationId: "cal-1", measurementTimestampMs: 4000, fromCell: 9, toCell: 5, direction: "up", provenance: "measured" }] : [];
    coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, evidence(`frame-${candidate.id}`, 4000, ["hook_left"], entries)) });
  }
  assert.equal(coordinator.getJudgements()[0].result, "hit");
  assert.equal(coordinator.getScorePartitions()[0].localOnly, true);
  assert.equal(coordinator.getScorePartitions()[0].scoringSettings.hitPoints, 1.25);
}

// Both hands and all punch families, including exact 100ms straight qualification and spatial cardinal truth.
const spatial = fixture.candidateMatrix.find((entry) => entry.id === "spatial-cut");
for (const [action, hand, direction, sourceCell] of [["straight_left","left","up",9],["straight_right","right","up",10],["hook_left","left","left",6],["hook_right","right","right",4],["uppercut_left","left","up",9],["uppercut_right","right","up",10]]) {
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: `action-${action}` });
  const target = { spatialTarget: { targetCell: 5, acceptedSubcells: [20], sourceCell, entryDirection: direction } };
  ready(coordinator, config(spatial, [event(spatial, action, 1000, action, target)], { modifierIds: fixture.modifierIds }));
  const entry = { schema: "aerobeat/body_grid_cell_entry", version: 1, anchor: `${hand}_wrist`, calibrationId: "cal-1", measurementTimestampMs: 4000, fromCell: sourceCell, toCell: 5, direction, provenance: "measured" };
  const qualifications = action.startsWith("straight") ? [{ hand, semanticStartTimestampMs: 3900, semanticDurationMs: 100, semanticQualified: true, spatialStartTimestampMs: 3900, spatialDurationMs: 100, spatialQualified: true, acceptedSubcellColumns: [4] }] : [];
  coordinator.advance({ timestampMs: 4000, clock: clock(1000, true), input: input(4000, evidence(`frame-${action}`, 4000, [action], [entry]), { qualifications }) });
  assert.equal(coordinator.getJudgements()[0].result, "hit", action);
  assert.deepEqual(coordinator.getSnapshot().selectedVariant.modifierIds, fixture.modifierIds);
}

// Standard/crossed guards and disjoint obstacle+punch versus overlapping guard/punch.
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "guards-concurrency" });
  const candidate = fixture.candidateMatrix.find((entry) => entry.id === "spatial-row");
  ready(coordinator, config(candidate, [event(candidate,"a-guard",1000,"guard",{guardTarget:{leftCell:5,rightCell:5}}),event(candidate,"b-hook",1000,"hook_left",{spatialTarget:{targetCell:5,acceptedSubcells:[20]}})]));
  coordinator.advance({ timestampMs: 4000, clock: clock(1000,true), input: input(4000,evidence("guard-overlap",4000,["guard","hook_left"])) });
  assert.deepEqual(coordinator.getJudgements().map((item)=>item.diagnostics), [[],["blocked_overlap"]]);
}
{
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "crossed-disjoint" });
  const candidate = fixture.candidateMatrix.find((entry) => entry.id === "spatial-row");
  ready(coordinator, config(candidate, [event(candidate,"a-crossed",1000,"guard",{guardTarget:{leftCell:5,rightCell:5,crossed:true}}),event(candidate,"b-squat",1500,"squat",{checkpoint:{kind:"instantaneous",noseSafeCells:[1]}}),event(candidate,"c-hook",1500,"hook_left",{spatialTarget:{targetCell:5,acceptedSubcells:[20]}})]));
  coordinator.advance({ timestampMs: 4000, clock: clock(1000,true), input: input(4000,evidence("crossed",4000,["crossed_guard"])) });
  coordinator.advance({ timestampMs: 4500, clock: clock(1500,true), input: input(4500,evidence("disjoint",4500,["squat","hook_left"])) });
  assert.deepEqual(coordinator.getJudgements().map((item)=>item.result), ["hit","hit","hit"]);
}

// Inclusive 180ms timing, exact 150ms freshness, positive-only matching, and one-action consumption.
{
  const candidate = fixture.candidateMatrix.find((entry) => entry.id === "semantic-cut");
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "boundary-replay" });
  ready(coordinator, config(candidate, [event(candidate,"boundary-a",1000,"hook_left"),event(candidate,"boundary-b",1360,"hook_left")]));
  coordinator.advance({ timestampMs:4000,clock:clock(820,true),input:input(4000,evidence("wrong-frame",4000,["hook_right"])) });
  assert.equal(coordinator.getJudgements().length,0,"negative evidence cannot consume the event");
  coordinator.advance({ timestampMs:4100,clock:clock(820,true),input:input(3950,evidence("boundary-frame",3950,["hook_left"])) });
  assert.equal(coordinator.getJudgements()[0].result,"hit");
  coordinator.advance({ timestampMs:4200,clock:clock(1180,true) });
  assert.equal(coordinator.getJudgements().length,1,"one measured action is consumed only once");
  coordinator.advance({ timestampMs:4350,clock:clock(1180,true),input:input(4200,evidence("fresh-frame",4200,["hook_left"])) });
  assert.equal(coordinator.getJudgements()[1].result,"hit");
  assert.equal(coordinator.getScorePartitions()[0].score,2.55);
  assert.equal(Number.isFinite(coordinator.getScorePartitions()[0].score),true);
  assert.equal(JSON.parse(JSON.stringify(coordinator.getScorePartitions()[0])).score,2.55);
  assert.equal(coordinator.getScorePartitions()[0].profileHash,"9480db443e563c53e8277405ad8949138669cdb3ed97f773fd7fad39432b7345");
}

// Tracking loss requires a new calibration and keeps the full countdown frozen.
{
  const candidate = fixture.candidateMatrix.find((entry) => entry.id === "semantic-row");
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "tracking-replay" });
  ready(coordinator, config(candidate, [event(candidate,"late",9000,"hook_left")]));
  coordinator.advance({ timestampMs: 4000, clock: clock(1000,true), input: input(4000,null,{paused:true,fresh:true}) });
  assert.equal(coordinator.getSnapshot().session.state,"paused_tracking");
  coordinator.advance({ timestampMs: 4500, clock: clock(0,false), input: input(4500,null,{calibrationId:"cal-1"}) });
  assert.equal(coordinator.getSnapshot().session.state,"paused_tracking");
  coordinator.advance({ timestampMs: 5000, clock: clock(0,false), input: input(5000,null,{calibrationId:"cal-2"}) });
  assert.equal(coordinator.getSnapshot().session.state,"countdown");
  coordinator.advance({ timestampMs: 6000, clock: clock(0,false) }); coordinator.advance({ timestampMs: 7000, clock: clock(0,false) }); coordinator.advance({ timestampMs: 8000, clock: clock(0,false) });
  assert.equal(coordinator.getSnapshot().session.state,"playing"); assert.equal(coordinator.getSnapshot().session.timelinePositionMs,0);
}

// Paused future swap preserves past truth and shadow diagnostics never enter user score.
{
  const candidate = fixture.candidateMatrix.find((entry) => entry.id === "semantic-row");
  const coordinator = createAeroGameplaySessionCoordinator({ sessionId: "swap-shadow" });
  const shadowCandidate = { ...variant(candidate), variantId:"shadow", chartId:"chart-shadow", resolvedEvents:[{...event({id:"shadow"},"shadow-hit",1000,"hook_left"),chartId:"chart-shadow"}] };
  ready(coordinator, config(candidate, [event(candidate,"past",1000,"hook_right"),event(candidate,"old-future",3000,"squat",{checkpoint:{kind:"instantaneous",noseSafeCells:[1]}}),event(candidate,"replaceable-future",4000,"hook_right")], { shadowVariants:[shadowCandidate] }));
  coordinator.advance({ timestampMs:4000,clock:clock(1000,true),input:input(4000,evidence("shadow-frame",4000,["hook_left"])) });
  assert.equal(coordinator.getSnapshot().shadowJudgements[0].result,"hit");
  assert.equal(coordinator.getScorePartitions().reduce((sum,item)=>sum+item.hits,0),0);
  coordinator.advance({ timestampMs:4200,clock:clock(1200,true) });
  coordinator.setActiveEventIds(["old-future"]);
  coordinator.pause(4300);
  const next = {...candidate,chartId:"chart-semantic-row-revised",recipeId:"cut_family_source_height_v1"};
  coordinator.applyFutureContent(config(next,[event(next,"old-future",3000,"weave_right",{checkpoint:{kind:"instantaneous",noseSafeCells:[1]}}),event(next,"replacement",3000,"weave_left",{checkpoint:{kind:"instantaneous",noseSafeCells:[1]}}),event(next,"stale-replacement",900,"hook_left"),event(next,"replaceable-future",3500,"weave_right",{checkpoint:{kind:"instantaneous",noseSafeCells:[1]}})], { scoringProfileId:"aero.scoring.locked" }));
  assert.equal(coordinator.getSnapshot().judgedEventIds.includes("past"),true);
  assert.equal(coordinator.getSnapshot().selectedVariant.recipeId,"cut_family_source_height_v1");
  coordinator.resume(4400);
  coordinator.advance({timestampMs:5400,clock:clock(1200,false)}); coordinator.advance({timestampMs:6400,clock:clock(1200,false)}); coordinator.advance({timestampMs:7400,clock:clock(1200,false)});
  coordinator.advance({timestampMs:9200,clock:clock(3000,true),input:input(9200,evidence("swap-settings",9200,["squat","weave_left"]))});
  assert.equal(coordinator.getScorePartitions().find((entry)=>entry.profileId === "aero.scoring.prototype-wide")?.score,1.25,"same-ID preserved event scores with old settings");
  assert.equal(coordinator.getScorePartitions().find((entry)=>entry.profileId === "aero.scoring.locked")?.score,1,"same-variant replacement scores with new settings");
  coordinator.advance({timestampMs:9700,clock:clock(3500,true),input:input(9700,evidence("swap-future",9700,["weave_right"]))});
  const oldPartition = coordinator.getScorePartitions().find((entry)=>entry.profileId === "aero.scoring.prototype-wide");
  const newPartition = coordinator.getScorePartitions().find((entry)=>entry.profileId === "aero.scoring.locked");
  assert.equal(oldPartition.scoringSettings.hitPoints,1.25);
  assert.equal(oldPartition.score,1.25,"preserved old events retain old fractional scoring settings");
  assert.equal(newPartition.scoringSettings.hitPoints,1);
  assert.equal(newPartition.score,2);
  assert.equal(oldPartition.chartId,"chart-semantic-row");
  assert.equal(newPartition.chartId,"chart-semantic-row-revised");
  assert.equal(coordinator.getJudgements().filter((entry)=>entry.eventId === "old-future").length,1,"preserved active event owns a same-ID collision");
  assert.equal(coordinator.getJudgements().some((entry)=>entry.eventId === "stale-replacement"),false);
  assert.equal(coordinator.getJudgements().find((entry)=>entry.eventId === "replaceable-future")?.chartId,"chart-semantic-row-revised");
  assert.notEqual(oldPartition.partitionId,newPartition.partitionId);
}

console.log("Task 11 five-variant prototype replay validation passed.");
