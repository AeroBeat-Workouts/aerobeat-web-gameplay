// @ts-check
import assert from "node:assert/strict";
import { createAeroGameplaySessionCoordinator, createFlowColliderSettings, defaultFlowColliderSettings as publicDefaultFlowColliderSettings, flowColliderSettingsBounds, flowColliderSettingsIdentity, maximumColliderSampleFreshnessMs, maximumColliderSampleGapMs } from "../src/index.js";
import { authoredDirectionCone, defaultFlowColliderSettings, flowNoteCellBox, gloveBoxContactsBoxingTarget, isContinuousColliderSegment, matchesAuthoredDirection, measuredColliderSample, MINIMUM_SABER_DIRECTION_TRAVEL, saberCapsuleContactsFlowTarget, saberDirectionFromWristHistory, targetCenterForPlacement } from "../src/flow-collider-collision.js";
import { gloveGeometry, saberGeometry } from "@aerobeat/web-contracts/equipment-contracts";

const HASH="a".repeat(64);
const settings=(overrides={})=>({ ...defaultFlowColliderSettings, ...overrides });
const variant=(id="collider")=>({variantId:id,chartId:`chart-${id}`,mode:"flow",rulesetId:"flow_colliders_v1",recipeId:null,modifierIds:[],ranked:false,localOnly:true,mapHash:{schema:"aerobeat/content_hash",version:1,algorithm:"sha256",value:HASH},scoreIdentityHash:{schema:"aerobeat/content_hash",version:1,algorithm:"sha256",value:HASH},provenance:{kind:"imported"}});
const flowGrid=()=>({...variant("grid"),localOnly:false});
const beat=(eventId,centerTimestampMs,type="note",extra={})=>({schema:"aerobeat/resolved_content_event",version:3,eventId,variantId:"collider",chartId:"chart-collider",centerTimestampMs,sourceEventIds:[`source-${eventId}`],type,...extra});
const wall=(eventId,start=900,end=1100)=>beat(eventId,start,"obstacle",{intervalStartTimestampMs:start,intervalEndTimestampMs:end,sourceGeometry:{schema:"aerobeat/obstacle_source_geometry",version:1,coordinateSpace:"beatsaber_v3_obstacle_rect",kind:"v3_rect",x:1,y:0,width:1,height:3},gameplayGeometry:{schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",x:1,y:0,width:1,height:3},gridMask:[1,5,9]});
const anchor=(name,measured,sx,sy)=>({schema:"aerobeat/body_grid_anchor_snapshot",version:1,anchor:name,calibrationId:"cal-1",measurementTimestampMs:measured,valid:true,confidence:1,rawX:0.5,rawY:0.5,x:(sx+0.5)/4,y:(2.5-sy)/3,cell:5,subcell:20});
const evidence=(frameId,measured,left=[-0.4,1],right=[3.4,1],nose=[3,2])=>({schema:"aerobeat/gameplay_evidence_snapshot",version:1,calibrationId:"cal-1",measuredSourceFrameId:frameId,measurementTimestampMs:measured,provenance:"measured",activeBoxingActions:[],anchors:[anchor("nose",measured,...nose),anchor("left_shoulder",measured,0,0),anchor("right_shoulder",measured,3,0),anchor("left_elbow",measured,0,0),anchor("right_elbow",measured,3,0),anchor("left_wrist",measured,...left),anchor("right_wrist",measured,...right)],entries:[]});
const input=(measured,latest,overrides={})=>({sourceIdentity:overrides.sourceIdentity??"camera-a",calibration:{calibrationId:overrides.calibrationId??"cal-1",readiness:overrides.ready===false?"not_ready":"countdown"},tracking:{gameplayPaused:overrides.gameplayPaused===true,freshCalibrationRequired:overrides.freshCalibrationRequired===true},countdownFrozen:false,latestEvidence:latest,straightQualifications:[]});
const config=(events,colliderSettings=settings())=>({packageId:"package",selectedVariant:variant(),resolvedEvents:events,profileIdentity:{schema:"aerobeat/prototype_tuning_identity",version:1,profileId:"profile",profileVersion:"1",contentHash:HASH,class:"between_run_ruleset",regenerationRequired:false},flowColliderSettings:colliderSettings});
const clock=(ms,playing)=>({contextTimeSeconds:ms/1000,positionSeconds:ms/1000,playing});
function ready(events,colliderSettings=settings(),options={}){const c=createAeroGameplaySessionCoordinator({sessionId:"collider-test",countdownStepMs:1,...options});if(options.instanceId)c.setLeaseSnapshot(lease(options.instanceId));c.configureContent(config(events,colliderSettings));c.advance({timestampMs:0,clock:clock(0,false),input:input(0,null)});assert.equal(c.requestStart(0).accepted,true);c.advance({timestampMs:1,clock:clock(0,false)});c.advance({timestampMs:2,clock:clock(0,false)});c.advance({timestampMs:3,clock:clock(0,false)});assert.equal(c.getSnapshot().session.state,"playing");return c;}
function send(c,wallMs,songMs,left,right,nose,sourceIdentity="camera-a",frameId=`f-${wallMs}-${songMs}`){const sample=evidence(frameId,wallMs,left,right,nose);c.advance({timestampMs:wallMs,clock:clock(songMs,true),input:input(wallMs,sample,{sourceIdentity})});return sample;}
function invalidateWrist(sample,name){const wrist=sample.anchors.find((entry)=>entry.anchor===name);wrist.valid=false;wrist.x=null;wrist.y=null;wrist.cell=null;wrist.subcell=null;return sample;}
function withCalibration(sample,calibrationId){sample.calibrationId=calibrationId;for(const entry of sample.anchors)entry.calibrationId=calibrationId;return sample;}
function finishResumeCountdown(c,startMs,timelineMs){assert.equal(c.resume(startMs).accepted,true);c.advance({timestampMs:startMs+1,clock:clock(timelineMs,false)});c.advance({timestampMs:startMs+2,clock:clock(timelineMs,false)});c.advance({timestampMs:startMs+3,clock:clock(timelineMs,false)});assert.equal(c.getSnapshot().session.state,"playing");}
const lease=(owner,generation=1)=>({schema:"aerobeat/media_lease_snapshot",version:1,ownerInstanceId:owner,generation,state:"owned",resources:["camera","audio"]});

{
  assert.deepEqual(targetCenterForPlacement(5),{x:1,y:1});
  assert.deepEqual(flowNoteCellBox({placement:5}),{centerX:1,centerY:1,halfX:.5,halfY:.5},"note cell box is the 1x1 judge-space cell");
  const event={centerTimestampMs:1000,placement:5};
  const sample=(sx,sy,songTimeMs=1000)=>Object.freeze({songTimeMs,sx,sy});
  const WINDOW=180;
  // (a) center hits for any direction — origin term dominates.
  for(const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0],[Math.SQRT1_2,Math.SQRT1_2]]){
    assert.equal(saberCapsuleContactsFlowTarget(event,sample(1,1),Object.freeze({x:dx,y:dy}),WINDOW),true,`center wrist, direction (${dx},${dy})`);
  }
  // Early/late inclusive timing window semantics survive the volume swap.
  assert.equal(saberCapsuleContactsFlowTarget(event,sample(1,1,820),Object.freeze({x:0,y:1}),WINDOW),true,"early boundary inclusive");
  assert.equal(saberCapsuleContactsFlowTarget(event,sample(1,1,1180),Object.freeze({x:0,y:1}),WINDOW),true,"late boundary inclusive");
  assert.equal(saberCapsuleContactsFlowTarget(event,sample(1,1,1180.001),Object.freeze({x:0,y:1}),WINDOW),false,"past the late boundary is outside the window");
  // (b) far outside: even a long beam aimed at the cell cannot reach from 2.5 WU away.
  assert.equal(saberCapsuleContactsFlowTarget(event,sample(3.5,1),Object.freeze({x:-1,y:0}),WINDOW),false,"far wrist misses even with the beam aimed at the cell");
  // (c) reach extension: wrist just outside the cell (x 1.56, 0.06 past the
  // 1.5 cell edge) with a horizontal saber still cuts the cell — this is the
  // INTENDED reach extension of the equipment swap (the old 0.375+0.12
  // inflated box ended at x 1.495 and would have missed the x>1.495 band).
  assert.equal(saberCapsuleContactsFlowTarget(event,sample(1.56,1),Object.freeze({x:-1,y:0}),WINDOW),true,"capsule crossing from just outside into the cell hits (reach extension)");
  // Far miss: the wrist is 1 WU past the cell edge and the 0.75 beam does not
  // bridge the gap even with the 0.18 radius. This is the FAR bound of the
  // new reach envelope: |sx - cellEdge| - (beamLength + radius) > 0 means miss.
  assert.equal(saberCapsuleContactsFlowTarget(event,sample(2.5,1),Object.freeze({x:-1,y:0}),WINDOW),false,"wrist 1 WU past the cell edge: the beam cannot bridge the gap (far miss)");
  assert.equal(saberCapsuleContactsFlowTarget(event,sample(3.5,1),Object.freeze({x:-1,y:0}),WINDOW),false,"wrist 2.5 WU away: the far side of the cell is unreachable");
}


// Measured-only extraction rejects stale/future/invalid/bounds/calibration and source omissions.
{
  const sample=evidence("frame",1000,[1,1]); const wrapped={sourceIdentity:"camera-a"};
  assert.ok(measuredColliderSample(sample,wrapped,"left_wrist",1000,1000));
  assert.ok(measuredColliderSample(sample,wrapped,"left_wrist",1149.999,1149.999));
  assert.equal(measuredColliderSample(sample,wrapped,"left_wrist",1150,1150),null);
  assert.equal(measuredColliderSample(sample,wrapped,"left_wrist",999,999),null);
  assert.equal(measuredColliderSample({...sample,provenance:"predicted"},wrapped,"left_wrist",1000,1000),null);
  assert.equal(measuredColliderSample(sample,{},"left_wrist",1000,1000),null);
  const bad=evidence("bad",1000,[1,1]);bad.anchors.find(a=>a.anchor==="left_wrist").confidence=.49;assert.equal(measuredColliderSample(bad,wrapped,"left_wrist",1000,1000),null);
  const out=evidence("out",1000,[1,1]);out.anchors.find(a=>a.anchor==="left_wrist").x=1.01;assert.equal(measuredColliderSample(out,wrapped,"left_wrist",1000,1000),null);
}

// Eight-way authored vectors, exact tolerance, minimum travel, and identity continuity.
{
  const vectors={up:[0,1],down:[0,-1],left:[-1,0],right:[1,0],"up-left":[-1,1],"up-right":[1,1],"down-left":[-1,-1],"down-right":[1,-1]};
  for(const [direction,[dx,dy]] of Object.entries(vectors)){const first={songTimeMs:900,measurementTimestampMs:900,sourceFrameId:"a",sourceIdentity:"s",calibrationId:"c",sx:1,sy:1};const second={...first,songTimeMs:1000,measurementTimestampMs:1000,sourceFrameId:"b",sx:1+dx,sy:1+dy};assert.equal(matchesAuthoredDirection(direction,first,second,0),true,direction);assert.equal(matchesAuthoredDirection(direction,first,{...second,sx:1-dx,sy:1-dy},45),false,`opposite ${direction}`);}
  const first={songTimeMs:900,measurementTimestampMs:900,sourceFrameId:"a",sourceIdentity:"s",calibrationId:"c",sx:0,sy:0};
  assert.equal(matchesAuthoredDirection("right",first,{...first,songTimeMs:1000,measurementTimestampMs:1000,sourceFrameId:"b",sx:.01},90),false,"minimum travel is enforced");
  assert.equal(isContinuousColliderSegment(first,{...first,songTimeMs:1000,measurementTimestampMs:1000,sourceFrameId:"b",sourceIdentity:"other"}),false);
  assert.equal(isContinuousColliderSegment(first,{...first,songTimeMs:1000,measurementTimestampMs:900,sourceFrameId:"b"}),false);
  assert.equal(isContinuousColliderSegment(first,{...first,songTimeMs:1000,measurementTimestampMs:1000,sourceFrameId:"a"}),false);
}

// 0.0.61 (GATE 1): the PURE saber direction oracle. This exact function
// orients BOTH the visible beam (assembly import) and the gameplay capsule
// ("what you see is what hits"). Moving wrist -> motion direction; stationary
// -> fallback; degenerate input stays safe (never NaN, never throws).
{
  // Moving wrist: displacement over the smoothing window normalizes to the
  // motion direction regardless of magnitude (a fast or slow move points the
  // same way).
  assert.deepEqual(saberDirectionFromWristHistory([{t:900,x:0,y:0},{t:950,x:.2,y:0},{t:1000,x:.4,y:0}],1000),{x:1,y:0},"horizontal motion -> unit x");
  assert.deepEqual(saberDirectionFromWristHistory([{t:900,x:1,y:1},{t:950,x:1,y:1.2},{t:1000,x:1,y:1.4}],1000),{x:0,y:1},"vertical motion -> unit y");
  // Diagonal motion normalizes to a unit vector on the diagonal; the exact
  // IEEE754 value of 0.2/|0.2,0.2| differs in the last ulp from
  // Math.SQRT1_2 (which is 1/sqrt(2)), so assert against the actual
  // normalized displacement instead.
  {
    const diag = saberDirectionFromWristHistory([{t:975,x:0,y:0},{t:1000,x:.2,y:.2}],1000);
    assert.ok(Math.abs(diag.x - diag.y) < 1e-15, "diagonal motion has equal x and y components");
    assert.ok(Math.abs(Math.hypot(diag.x, diag.y) - 1) < 1e-15, "diagonal motion is normalized to a unit vector");
  }
  // Samples outside the 100ms window are ignored: only the motion inside the
  // window steers the beam.
  assert.deepEqual(saberDirectionFromWristHistory([{t:800,x:0,y:0},{t:990,x:0,y:.2},{t:1000,x:0,y:.4}],1000),{x:0,y:1},"only in-window motion counts");
  // Stationary wrist -> the (normalized) fallback, default grid-facing up.
  assert.deepEqual(saberDirectionFromWristHistory([{t:900,x:1,y:1},{t:950,x:1,y:1},{t:1000,x:1,y:1}],1000),{x:0,y:1},"stationary wrist uses the default fallback");
  assert.deepEqual(saberDirectionFromWristHistory([{t:900,x:1,y:1},{t:1000,x:1.01,y:1}],1000),{x:0,y:1},`displacement below the ${MINIMUM_SABER_DIRECTION_TRAVEL} travel threshold falls back`);
  assert.deepEqual(saberDirectionFromWristHistory([{t:900,x:1,y:1},{t:1000,x:2,y:1}],1000,Object.freeze({x:1,y:0}),200),{x:1,y:0},"explicit window and fallback are honored");
  // Degenerate inputs stay safe: empty/short history, corrupt entries, bad
  // arguments all return the fallback (or the normalized default) and never
  // throw or produce NaN.
  assert.deepEqual(saberDirectionFromWristHistory([],1000),{x:0,y:1},"empty history falls back");
  assert.deepEqual(saberDirectionFromWristHistory([null],1000),{x:0,y:1},"null entry falls back");
  assert.deepEqual(saberDirectionFromWristHistory([{t:900,x:0,y:0},{t:850,x:1,y:0}],1000),{x:0,y:1},"non-ascending timestamps fall back");
  assert.deepEqual(saberDirectionFromWristHistory([{t:900,x:NaN,y:0}],1000),{x:0,y:1},"NaN coordinate falls back");
  assert.deepEqual(saberDirectionFromWristHistory("not an array",1000),{x:0,y:1},"non-array input falls back");
  assert.deepEqual(saberDirectionFromWristHistory([{t:900,x:0,y:0},{t:1000,x:1,y:0}],Number.NaN),{x:0,y:1},"non-finite nowMs falls back");
  // A MOVING wrist with a zero-vector fallback still returns the motion
  // direction (the fallback is only used when the wrist is stationary); the
  // zero-vector fallback itself is normalized to the default {x:0,y:1} when
  // the stationary path is taken.
  assert.deepEqual(saberDirectionFromWristHistory([{t:900,x:0,y:0},{t:1000,x:1,y:0}],1000,{x:0,y:0}),{x:1,y:0},"moving wrist ignores the zero-vector fallback (motion wins)");
  assert.deepEqual(saberDirectionFromWristHistory([{t:900,x:1,y:1},{t:1000,x:1,y:1}],1000,{x:0,y:0}),{x:0,y:1},"stationary wrist normalizes the zero-vector fallback to the default");
  assert.deepEqual(saberDirectionFromWristHistory([{t:900,x:0,y:0},{t:1000,x:1,y:0}],1000,Object.freeze({x:2,y:0})),{x:1,y:0},"fallback is normalized to a unit vector");
}

// 0.0.61 (GATE 1): the GLOVE BOX is the boxing detector. Pure overlap
// semantics against the 1x1 reach-row target box, with the shared
// gloveGeometry half-extents (0.34 x 0.28). The retired 0.375+radius
// point-in-inflated-box boundary is intentionally shifted by up to half a
// glove dimension.
{
  // (b) glove centered inside target box -> hit.
  const target={centerTimestampMs:1000,x:1,y:1};
  assert.equal(gloveBoxContactsBoxingTarget(target,Object.freeze({songTimeMs:1000,sx:1,sy:1}),180),true,"glove centered in the target box hits");
  assert.equal(gloveBoxContactsBoxingTarget(target,Object.freeze({songTimeMs:820,sx:1,sy:1}),180),true,"early boundary inclusive");
  assert.equal(gloveBoxContactsBoxingTarget(target,Object.freeze({songTimeMs:1180,sx:1,sy:1}),180),true,"late boundary inclusive");
  assert.equal(gloveBoxContactsBoxingTarget(target,Object.freeze({songTimeMs:1180.001,sx:1,sy:1}),180),false,"past the late boundary misses");
  // Glove just inside the box edge still overlaps (half-glove x 0.34 inside
  // the 1.5 cell edge: wrist at 1.14 keeps the glove's outer edge at 1.48 <
  // 1.5).
  assert.equal(gloveBoxContactsBoxingTarget(target,Object.freeze({songTimeMs:1000,sx:1.14,sy:1}),180),true,"glove near the inner edge still overlaps");
  // (b) glove clearly outside -> miss. The glove's half-extent 0.34 means a
  // wrist at 1.5+0.34=1.84 has its inner edge exactly at 1.5 (no overlap);
  // slightly beyond that misses.
  assert.equal(gloveBoxContactsBoxingTarget(target,Object.freeze({songTimeMs:1000,sx:1.85,sy:1}),180),false,"glove clearly outside the target box misses");
  assert.equal(gloveBoxContactsBoxingTarget(target,Object.freeze({songTimeMs:1000,sx:0,sy:0}),180),false,"glove a full cell away misses");
  // Vertical reach: the y half-extent 0.28 keeps a low glove from reaching the
  // target when the wrist is more than 0.5+0.28=0.78 below the target Y.
  assert.equal(gloveBoxContactsBoxingTarget(target,Object.freeze({songTimeMs:1000,sx:1,sy:0.1}),180),false,"glove below the target row misses on Y");
  // Boundary sanity: the retired 0.375+radius footprint would have accepted a
  // wrist at 1.49 inside the inflated box, but the glove box accepts it too
  // (1.49-0.34=1.15 < 1.5). The intended DIFFERENCE is the reach: a wrist at
  // 1.65 (outside the old 0.375 box, 1.65>1.375+0) is still inside the glove
  // (1.65-0.34=1.31<1.5). This is the half-glove-size boundary shift.
  assert.equal(gloveBoxContactsBoxingTarget(target,Object.freeze({songTimeMs:1000,sx:1.65,sy:1}),180),true,"half-glove-size boundary shift: the glove reaches further than the retired point-in-box");
}

// Measured-only extraction and segment continuity carry over unchanged (the
// direction enforcement still reads the prior/current continuity segment).
{
  const lower=measuredColliderSample(evidence("lower",900,[1,0]),{sourceIdentity:"camera-a"},"left_wrist",900,900);const upper=measuredColliderSample(evidence("upper",1000,[1,1]),{sourceIdentity:"camera-a"},"left_wrist",1000,1000);assert.equal(matchesAuthoredDirection("up",lower,upper,0),true,"input y-down is converted once to authored up-positive canonical sy");assert.equal(matchesAuthoredDirection("down",lower,upper,45),false);
}

// authoredDirectionCone: all eight directions, exact tolerance passthrough, up-positive canonical, null on invalid.
{
  const coneVectors={up:{x:0,y:1},down:{x:0,y:-1},left:{x:-1,y:0},right:{x:1,y:0},"up-left":{x:-Math.SQRT1_2,y:Math.SQRT1_2},"up-right":{x:Math.SQRT1_2,y:Math.SQRT1_2},"down-left":{x:-Math.SQRT1_2,y:-Math.SQRT1_2},"down-right":{x:Math.SQRT1_2,y:-Math.SQRT1_2}};
  for(const [name,vector] of Object.entries(coneVectors)){const cone=authoredDirectionCone(name,45);assert.ok(cone,name);assert.equal(Object.isFrozen(cone),true);assert.deepEqual(cone.center,{x:0,y:0},"center is the origin target point (renderer combines with targetCenterForPlacement)");assert.deepEqual(cone.direction,vector,`${name} unit vector`);assert.equal(Object.isFrozen(cone.direction),true);assert.equal(cone.toleranceDegrees,45,`${name} tolerance passthrough`);}
  for(const value of [0,17.5,90]){const cone=authoredDirectionCone("up",value);assert.equal(cone.toleranceDegrees,value,"exact tolerance passthrough");assert.deepEqual(cone.direction,coneVectors.up);}
  for(const invalid of ["UP","Up","up left","","up_left","down up",1,undefined])assert.equal(authoredDirectionCone(invalid,45),null,`invalid direction ${String(invalid)}`);
}

// Default direction enforcement: an authored-directional note requires the authored direction by default,
// and an explicit overlap-only override restores stationary-wrist scoring.
{
  const enforced=ready([beat("stationary-enforced",1000,"note",{hand:"left",placement:5,direction:"down"})]);
  send(enforced,1000,1000,[1,1],[3,1],[3,2]);
  send(enforced,1181,1181,[1,1],[3,1],[3,2]);
  assert.deepEqual(enforced.getJudgements().map(j=>[j.eventId,j.result,j.diagnostics]),[["stationary-enforced","miss",["wrong_direction"]]],"default enforces the authored direction");
  const c=ready([beat("stationary",1000,"note",{hand:"left",placement:5,direction:"down"})],settings({enforceAuthoredDirection:false}));
  send(c,1000,1000,[1,1],[3,1],[3,2]);
  assert.deepEqual(c.getJudgements().map(j=>[j.eventId,j.result,j.timingOffsetMs]),[["stationary","hit",0]],"explicit overlap-only override still permits a stationary wrist");
  assert.equal(c.getScorePartitions()[0].ranked,false);assert.equal(c.getScorePartitions()[0].localOnly,true);assert.match(c.getScorePartitions()[0].flowColliderSettingsIdentity,/^sha256:[a-f0-9]{64}$/u);
}

// Each wrist is evaluated independently for owned notes and either-wrist bombs.
{
  for(const [owner,invalid] of [["left","right_wrist"],["right","left_wrist"]]){
    const placement=owner==="left"?5:6;const left=owner==="left"?[1,1]:[-.4,1];const right=owner==="right"?[2,1]:[3.4,1];
    const noteRun=ready([beat(`independent-${owner}`,1000,"note",{hand:owner,placement})]);const noteSample=invalidateWrist(evidence(`independent-${owner}`,1000,left,right,[3,2]),invalid);noteRun.advance({timestampMs:1000,clock:clock(1000,true),input:input(1000,noteSample)});assert.equal(noteRun.getJudgements()[0].result,"hit",`${owner} note scores with other wrist invalid`);
    const bombRun=ready([beat(`bomb-${owner}`,1000,"bomb",{placement})]);const bombSample=invalidateWrist(evidence(`bomb-${owner}`,1000,left,right,[3,2]),invalid);bombRun.advance({timestampMs:1000,clock:clock(1000,true),input:input(1000,bombSample)});assert.equal(bombRun.getHazardOutcomes()[0].result,"contact",`${owner} wrist detonates with other wrist invalid`);
  }
}

// Default-enforced direction with a tightened tolerance is run-locked, affects identity, and misses only after strict late bound.
{
  const directional=settings({enforceAuthoredDirection:true,directionToleranceDegrees:20});
  const c=ready([beat("directed",1000,"note",{hand:"left",placement:5,direction:"right"})],directional);
  send(c,900,900,[.3,1],[3,1],[3,2]);send(c,1000,1000,[.3,1],[3,1],[3,2]);
  assert.equal(c.getJudgements().length,0);send(c,1180,1180,[.3,1],[3,1],[3,2]);assert.equal(c.getJudgements().length,0,"inclusive late bound remains pending");send(c,1181,1181,[.3,1],[3,1],[3,2]);assert.deepEqual([c.getJudgements()[0].result,c.getJudgements()[0].diagnostics],["miss",["wrong_direction"]]);
  c.pause(1182);assert.throws(()=>c.applyFutureContent(config([],settings({enforceAuthoredDirection:false}))),/locked/u);
  const other=ready([beat("identity",1000,"note",{hand:"left",placement:5})],settings({colliderRadius:.2}));send(other,1000,1000,[1,1],[3,1],[3,2]);assert.notEqual(other.getScorePartitions()[0].flowColliderSettingsIdentity,c.getScorePartitions()[0].flowColliderSettingsIdentity);
}

// 0.0.61 (GATE 1): chord resolution now uses the per-frame saber capsule, so
// the old "first contact via swept segment" ordering (which sorted by
// segment-start contactMs) is replaced by the uniform per-frame contactMs
// (the sample's songTimeMs). The deterministic tie-break therefore falls back
// to centerTimestampMs then eventId. The permutation-invariance property
// (judgements independent of source array order) still holds.
//
// The test keeps the SAME events and the SAME "later" staggered member, but
// the in-chord order changes: within the 1000 ms chord, left-a (placement 4),
// left-duplicate-cell (placement 4, same eventId tie-break), left-b
// (placement 6) now sort by eventId after the uniform contactMs; right-chord
// sorts after all left-hand candidates because the coordinator's per-hand
// loop processes left first.
{
  const events=[beat("right-chord",1000,"note",{hand:"right",placement:7}),beat("left-b",1000,"note",{hand:"left",placement:6}),beat("left-a",1000,"note",{hand:"left",placement:4}),beat("left-duplicate-cell",1000,"note",{hand:"left",placement:4}),beat("later",1010,"note",{hand:"left",placement:6})];
  const run=(ordered)=>{const c=ready(ordered);send(c,900,900,[-.5,1],[3.5,1],[3,2]);send(c,1000,1000,[2.4,1],[3,1],[3,2]);assert.deepEqual(c.getJudgements().map(j=>j.eventId),["left-a","left-duplicate-cell","right-chord","left-b"]);send(c,1010,1010,[2.4,1],[3,1],[3,2]);assert.equal(c.getJudgements().at(-1).eventId,"later");return c.getJudgements().map(j=>[j.eventId,j.result,j.timingOffsetMs]);};
  assert.deepEqual(run(events),run([...events].reverse()));
}

// Wrong hand cannot score; either wrist detonates a bomb after simultaneous note scoring and breaks combo once.
{
  const events=[beat("note",1000,"note",{hand:"left",placement:5}),beat("bomb",1000,"bomb",{placement:5})];const c=ready(events);send(c,900,900,[-.5,1],[3.4,1],[3,2]);send(c,1000,1000,[1,1],[3.4,1],[3,2]);
  assert.deepEqual(c.getJudgements().map(j=>[j.eventId,j.result]),[["note","hit"]]);assert.deepEqual(c.getHazardOutcomes().map(o=>[o.kind,o.result]),[["bomb","contact"]]);assert.deepEqual({hits:c.getScorePartitions()[0].hits,bombs:c.getScorePartitions()[0].bombContacts,combo:c.getScorePartitions()[0].combo},{hits:1,bombs:1,combo:0});
  const wrong=ready([beat("owned",1000,"note",{hand:"left",placement:5})]);send(wrong,1000,1000,[-.5,1],[1,1],[3,2]);send(wrong,1181,1181,[-.5,1],[1,1],[3,2]);assert.equal(wrong.getJudgements()[0].result,"miss");
}

// Simultaneous note plus overlapping nose-owned walls scores first and applies one deduplicated hazard break; wrists never own walls.
{
  const c=ready([beat("wall-note",1000,"note",{hand:"left",placement:5}),wall("wall-a"),wall("wall-b")]);send(c,900,900,[-.5,1],[3,1],[0,1]);send(c,1000,1000,[1,1],[3,1],[2,1]);assert.equal(c.getScorePartitions()[0].hits,1);assert.equal(c.getScorePartitions()[0].combo,0);assert.equal(c.getScorePartitions()[0].obstacleContacts,1);send(c,1100,1100,[1,1],[3,1],[2,1]);assert.deepEqual(c.getHazardOutcomes().filter(o=>o.kind==="wall").map(o=>[o.eventId,o.result,o.consequenceApplied]),[["wall-a","contact",true],["wall-b","contact",false]]);
  const wristsOnly=ready([wall("wall-a")]);send(wristsOnly,900,900,[1,1],[1,1],[0,1]);send(wristsOnly,1000,1000,[1,1],[1,1],[0,1]);send(wristsOnly,1100,1100,[1,1],[1,1],[0,1]);assert.equal(wristsOnly.getHazardOutcomes()[0].result,"avoided");
  const freshNose=ready([wall("wall-a")]);const freshSample=evidence("fresh-nose",1000,[-.4,1],[3.4,1],[1,1]);freshNose.advance({timestampMs:1149.999,clock:clock(1149.999,true),input:input(1000,freshSample)});assert.equal(freshNose.getHazardOutcomes()[0].result,"contact","nose age below 150ms remains fresh");
  const staleNose=ready([wall("wall-a")]);const staleSample=evidence("stale-nose",1000,[-.4,1],[3.4,1],[1,1]);staleNose.advance({timestampMs:1150,clock:clock(1150,true),input:input(1000,staleSample)});assert.notEqual(staleNose.getHazardOutcomes()[0]?.result,"contact","nose age exactly 150ms is stale");
}

// Complete dual-wrist passage avoids a bomb; a gap is explicitly unevaluated.
{
  const run=(complete)=>{const c=ready([beat("bomb",1000,"bomb",{placement:5})]);send(c,820,820,[-.4,-.4],[3.4,-.4],[3,2]);if(complete){send(c,970,970,[-.4,-.4],[3.4,-.4],[3,2]);send(c,1120,1120,[-.4,-.4],[3.4,-.4],[3,2]);}send(c,1180,1180,[-.4,-.4],[3.4,-.4],[3,2]);send(c,1181,1181,[-.4,-.4],[3.4,-.4],[3,2]);return c.getHazardOutcomes()[0].result;};
  assert.equal(run(true),"avoided");assert.equal(run(false),"unevaluated_tracking");
}

// Audio rollback severs wrist/nose continuity before resume; only a genuine post-resume segment may score.
{
  const c=ready([beat("rollback-note",1000,"note",{hand:"left",placement:5}),wall("rollback-wall")]);
  send(c,900,900,[-.5,1],[3,1],[0,1],"camera-a","pre-rollback");
  c.advance({timestampMs:950,clock:clock(800,true)});assert.deepEqual([c.getSnapshot().session.state,c.getSnapshot().session.pauseReason],["paused_manual","audio_clock_rollback"]);
  finishResumeCountdown(c,951,900);
  send(c,1000,1000,[1,1],[3,1],[1,1],"camera-a","first-inside-after-rollback");assert.equal(c.getJudgements().length,0,"first resumed-inside wrist frame seeds only");assert.equal(c.getHazardOutcomes().length,0,"first resumed-inside nose frame seeds only");
  send(c,1050,1050,[1.2,1],[3,1],[1.2,1],"camera-a","genuine-after-rollback");assert.equal(c.getJudgements()[0].result,"hit","later same-generation post-resume segment scores normally");send(c,1100,1100,[1.2,1],[3,1],[1.2,1],"camera-a","wall-final");assert.equal(c.getHazardOutcomes().find((outcome)=>outcome.kind==="wall")?.result,"contact","later same-generation nose segment contacts");
}

// A stopped audio clock also severs continuity before manual recovery.
{
  const c=ready([beat("stopped-clock-note",1000,"note",{hand:"left",placement:5})]);send(c,900,900,[-.5,1],[3,1],[3,2],"camera-a","pre-stop");c.advance({timestampMs:950,clock:clock(900,false)});assert.deepEqual([c.getSnapshot().session.state,c.getSnapshot().session.pauseReason],["paused_manual","audio_clock_not_playing"]);finishResumeCountdown(c,951,900);send(c,1000,1000,[1,1],[3,1],[3,2],"camera-a","first-inside-after-stop");assert.equal(c.getJudgements().length,0);send(c,1050,1050,[1.2,1],[3,1],[3,2],"camera-a","second-after-stop");assert.equal(c.getJudgements()[0].result,"hit");
}

// Recovery baselines are independent per anchor; unavailable peers remain seed-only until their own first valid sample.
{
  const c=ready([beat("asymmetric-left",1000,"note",{hand:"left",placement:5}),beat("asymmetric-right",1000,"note",{hand:"right",placement:6}),wall("asymmetric-wall")]);send(c,900,900,[-.5,1],[3,1],[0,1]);c.pause(950);finishResumeCountdown(c,951,900);
  const leftOnly=invalidateWrist(invalidateWrist(evidence("left-only-seed",1000,[1,1],[2,1],[1,1]),"right_wrist"),"nose");c.advance({timestampMs:1000,clock:clock(1000,true),input:input(1000,leftOnly)});assert.equal(c.getJudgements().length,0);
  const peersSeed=evidence("peers-seed",1050,[1.2,1],[2,1],[1,1]);c.advance({timestampMs:1050,clock:clock(1050,true),input:input(1050,peersSeed)});assert.deepEqual(c.getJudgements().map((entry)=>entry.eventId),["asymmetric-left"],"left evaluates while newly available right/nose seed only");assert.equal(c.getHazardOutcomes().length,0);
  send(c,1100,1100,[1.2,1],[2.2,1],[1.2,1],"camera-a","peers-second");assert.deepEqual(c.getJudgements().map((entry)=>entry.eventId),["asymmetric-left","asymmetric-right"]);assert.equal(c.getHazardOutcomes().find((outcome)=>outcome.kind==="wall")?.result,"contact");
}

// A first resumed wrist inside a bomb seeds only; its next genuine segment may detonate.
{
  const c=ready([beat("resumed-bomb",1000,"bomb",{placement:5})]);send(c,900,900,[-.5,1],[3,1],[3,2]);c.pause(950);finishResumeCountdown(c,951,900);send(c,1000,1000,[1,1],[3,1],[3,2]);assert.equal(c.getHazardOutcomes().length,0);send(c,1050,1050,[1.2,1],[3,1],[3,2]);assert.equal(c.getHazardOutcomes()[0].result,"contact");
}

// Repeated manual pause re-arms the seed-only epoch without clearing score truth.
{
  const c=ready([beat("accepted-before-pause",800,"note",{hand:"left",placement:5}),beat("repeated-pause",1100,"note",{hand:"left",placement:5})]);send(c,800,800,[1,1],[3,1],[3,2]);assert.equal(c.getJudgements()[0].eventId,"accepted-before-pause");c.pause(950);finishResumeCountdown(c,951,800);send(c,1000,1000,[1,1],[3,1],[3,2]);assert.equal(c.getJudgements().length,1);c.pause(1001);finishResumeCountdown(c,1002,1000);send(c,1050,1050,[1,1],[3,1],[3,2]);assert.equal(c.getJudgements().length,1,"first sample after repeated pause seeds again without clearing accepted truth");send(c,1100,1100,[1.2,1],[3,1],[3,2]);assert.deepEqual(c.getJudgements().map((entry)=>entry.eventId),["accepted-before-pause","repeated-pause"]);
}

// Lease loss, countdown-clock violation, calibration replacement, and tracking recovery each require a new baseline.
{
  const leaseRun=ready([beat("lease-recovery",1000,"note",{hand:"left",placement:5})],settings(),{instanceId:"game"});send(leaseRun,900,900,[-.5,1],[3,1],[3,2]);leaseRun.setLeaseSnapshot(lease("other",2));assert.equal(leaseRun.getSnapshot().session.pauseReason,"media_lease_unavailable");leaseRun.setLeaseSnapshot(lease("game",3));finishResumeCountdown(leaseRun,901,900);send(leaseRun,1000,1000,[1,1],[3,1],[3,2]);assert.equal(leaseRun.getJudgements().length,0);send(leaseRun,1050,1050,[1.2,1],[3,1],[3,2]);assert.equal(leaseRun.getJudgements()[0].result,"hit");

  const countdownRun=ready([beat("countdown-recovery",1000,"note",{hand:"left",placement:5})]);send(countdownRun,900,900,[-.5,1],[3,1],[3,2]);countdownRun.pause(901);assert.equal(countdownRun.resume(902).accepted,true);countdownRun.advance({timestampMs:903,clock:clock(900,true)});assert.equal(countdownRun.getSnapshot().session.pauseReason,"countdown_audio_not_frozen");finishResumeCountdown(countdownRun,904,900);send(countdownRun,1000,1000,[1,1],[3,1],[3,2]);assert.equal(countdownRun.getJudgements().length,0);send(countdownRun,1050,1050,[1.2,1],[3,1],[3,2]);assert.equal(countdownRun.getJudgements()[0].result,"hit");

  const calibrationRun=ready([beat("calibration-recovery",1000,"note",{hand:"left",placement:5})]);send(calibrationRun,900,900,[-.5,1],[3,1],[3,2]);const changed=withCalibration(evidence("new-calibration-seed",1000,[1,1],[3,1],[3,2]),"cal-2");calibrationRun.advance({timestampMs:1000,clock:clock(1000,true),input:input(1000,changed,{calibrationId:"cal-2"})});assert.equal(calibrationRun.getJudgements().length,0);const changedNext=withCalibration(evidence("new-calibration-next",1050,[1.2,1],[3,1],[3,2]),"cal-2");calibrationRun.advance({timestampMs:1050,clock:clock(1050,true),input:input(1050,changedNext,{calibrationId:"cal-2"})});assert.equal(calibrationRun.getJudgements()[0].result,"hit");

  const trackingRun=ready([beat("tracking-recovery",1000,"note",{hand:"left",placement:5})]);send(trackingRun,900,900,[-.5,1],[3,1],[3,2]);trackingRun.advance({timestampMs:950,clock:clock(900,true),input:input(950,null,{ready:false})});assert.equal(trackingRun.getSnapshot().session.state,"paused_tracking");const recovered=withCalibration(evidence("tracking-calibration",960,[1,1],[3,1],[3,2]),"cal-2");trackingRun.advance({timestampMs:960,clock:clock(900,false),input:input(960,recovered,{calibrationId:"cal-2"})});trackingRun.advance({timestampMs:961,clock:clock(900,false)});trackingRun.advance({timestampMs:962,clock:clock(900,false)});trackingRun.advance({timestampMs:963,clock:clock(900,false)});assert.equal(trackingRun.getSnapshot().session.state,"playing");const trackingFirst=withCalibration(evidence("tracking-first",1000,[1,1],[3,1],[3,2]),"cal-2");trackingRun.advance({timestampMs:1000,clock:clock(1000,true),input:input(1000,trackingFirst,{calibrationId:"cal-2"})});assert.equal(trackingRun.getJudgements().length,0);const trackingSecond=withCalibration(evidence("tracking-second",1050,[1.2,1],[3,1],[3,2]),"cal-2");trackingRun.advance({timestampMs:1050,clock:clock(1050,true),input:input(1050,trackingSecond,{calibrationId:"cal-2"})});assert.equal(trackingRun.getJudgements()[0].result,"hit");
}

// 0.0.61 (GATE 1): a 150ms gap is still a valid continuity segment for the
// direction check and the coverage tracking; the hit itself is now the
// per-frame saber capsule at the END sample (the wrist must be at the cell
// or within the beam's reach at that moment). The old "swept-through" case
// (wrist crossed the cell between two samples but ends up outside) is no
// longer a hit by design: the detector is the volume at the sample, not the
// swept path.
{
  const c=ready([beat("continuous-150",1000,"note",{hand:"left",placement:5})]);
  // End sample at the cell center (wrist actually there at the end).
  send(c,850,850,[-.5,1],[3,1],[3,2],"camera-a","continuous-start");
  send(c,1000,1000,[1,1],[3,1],[3,2],"camera-a","continuous-end");
  assert.equal(c.getJudgements()[0].result,"hit","end sample at the cell center hits");
}

// Duplicate, rollback, source change, and lifecycle reset cannot fabricate a sweep.
{
  for(const kind of ["duplicate","rollback","source"]){const c=ready([beat(kind,1000,"note",{hand:"left",placement:5})]);send(c,900,900,[-.5,1],[3,1],[3,2],"camera-a","baseline");if(kind==="duplicate")send(c,1000,1000,[2,1],[3,1],[3,2],"camera-a","baseline");else if(kind==="rollback"){const rollback=evidence("rollback",899,[2,1],[3,1],[3,2]);c.advance({timestampMs:1000,clock:clock(1000,true),input:input(899,rollback)});}else send(c,1000,1000,[2,1],[3,1],[3,2],"camera-b","changed");assert.equal(c.getJudgements().length,0,kind);}
  const c=ready([beat("reset",1000,"note",{hand:"left",placement:5})]);send(c,900,900,[-.5,1],[3,1],[3,2]);c.reset(901);assert.equal(c.getSnapshot().session.state,"calibrating");
}

// Public settings constructor/defaults/bounds are strict, immutable, deterministic, and complete.
{
  assert.equal(maximumColliderSampleFreshnessMs,150);assert.equal(maximumColliderSampleGapMs,150);assert.deepEqual(flowColliderSettingsBounds,{colliderRadius:{minimum:0,maximum:.5},directionToleranceDegrees:{minimum:0,maximum:90},timingWindowMs:{minimum:50,maximum:300}});
  assert.deepEqual(createFlowColliderSettings(),publicDefaultFlowColliderSettings);assert.equal(Object.isFrozen(createFlowColliderSettings()),true);assert.match(flowColliderSettingsIdentity(createFlowColliderSettings()),/^sha256:[a-f0-9]{64}$/u);
  assert.throws(()=>createFlowColliderSettings({...publicDefaultFlowColliderSettings,extra:true}),/every exact field/u);const accessor={...publicDefaultFlowColliderSettings};Object.defineProperty(accessor,"colliderRadius",{enumerable:true,get(){throw new Error("must not execute");}});assert.throws(()=>createFlowColliderSettings(accessor),/accessors/u);
}

// Bounded settings reject malformed/ranked input without mutation; the non-collider Flow variant keeps its old matcher and identity.
{
  const c=createAeroGameplaySessionCoordinator({sessionId:"bounds"});for(const bad of [settings({colliderRadius:-.001}),settings({colliderRadius:.501}),settings({directionToleranceDegrees:91}),settings({timingWindowMs:49}),settings({timingWindowMs:301}),{...settings(),extra:true}])assert.throws(()=>c.configureContent(config([],bad)),/(?:Flow Collider|unknown or symbolic fields)/u);
  assert.doesNotThrow(() => c.configureContent({ ...config([]), selectedVariant: { ...variant(), ranked: true } }), "the sole Flow ruleset is now the ranked authored variant and no longer requires unranked local-only truth");
  const grid=createAeroGameplaySessionCoordinator({sessionId:"grid"});const gridEvent={...beat("grid-note",1000,"note",{hand:"left",placement:5}),variantId:"grid",chartId:"chart-grid"};grid.configureContent({packageId:"package",selectedVariant:flowGrid(),resolvedEvents:[gridEvent]});assert.equal(grid.getSnapshot().session.rulesetId,"flow_colliders_v1");assert.doesNotThrow(()=>grid.configureContent({packageId:"package",selectedVariant:flowGrid(),resolvedEvents:[],flowColliderSettings:settings()}),"Flow Collider settings now bind the sole ranked Flow ruleset, not a retired non-collider variant");
}

// Public collider state exposes only opaque tuning identity and semantic hazard data, never physical evidence/history.
{
  const c=ready([beat("private-bomb",1000,"bomb",{placement:5})]);send(c,1000,1000,[1,1],[3,1],[3,2]);const publicText=JSON.stringify({hazards:c.getHazardOutcomes(),partitions:c.getScorePartitions()});for(const forbidden of ["colliderRadius","directionToleranceDegrees","measurementTimestampMs","sourceFrameId","sourceIdentity","calibrationId","confidence","rawX","rawY","trajectory","segment","contactEpisodeId","evidenceFrameId"])assert.equal(publicText.includes(forbidden),false,forbidden);
}

// F4 (0.0.60): tracking freeze — `provenance: "frozen"` nose frames republish the
// held last-measured position on every tick, so their held timestamp ages past the
// 150ms freshness window by design. evaluateFlowObstacles must EXEMPT frozen frames
// from that gate and treat each (calibrationId, frozenTickId) as a NEW frame, so a
// wall contact fires from the held nose during the freeze, first contact is recorded
// exactly once, and the session stays "playing". Measured frames keep their exact
// byte-identical identity/monotonicity behavior.
{
  const frozenEvidence=(heldFrameId,heldTs,tick,nose)=>({schema:"aerobeat/gameplay_evidence_snapshot",version:1,calibrationId:"cal-1",provenance:"frozen",frozenTickId:tick,measuredSourceFrameId:heldFrameId,measurementTimestampMs:heldTs,activeBoxingActions:[],anchors:[anchor("nose",heldTs,...nose),anchor("left_shoulder",heldTs,0,0),anchor("right_shoulder",heldTs,3,0),anchor("left_elbow",heldTs,0,0),anchor("right_elbow",heldTs,3,0),anchor("left_wrist",heldTs,1,1),anchor("right_wrist",heldTs,3,1)],entries:[]});
  const sendFrozen=(c,songMs,heldFrameId,heldTs,tick,nose)=>{c.advance({timestampMs:songMs,clock:clock(songMs,true),input:input(songMs,frozenEvidence(heldFrameId,heldTs,tick,nose))});};
  // (a) held nose INSIDE the wall column across multiple frozen ticks (held
  // timestamp ages 100ms -> 350ms of wall time, well past the 150ms gate): contact
  // fires on the first frozen tick, holds, the held nose exits the wall while still
  // frozen, and the wall finalizes as a single contact with one hazard consequence.
  {
    const c=ready([wall("fz-wall",900,1450)]);
    send(c,850,850,[-.4,1],[3.4,1],[3,1],"camera-a","fz-in-0");
    sendFrozen(c,950,"fz-in-0",850,1,[1,1]);
    assert.equal(c.getSnapshot().session.state,"playing","frozen nose inside wall: session stays playing");
    assert.equal(c.getHazardOutcomes().length,0,"wall not yet finalized before its interval end");
    const a1=c.getSnapshot().hazardContact;
    assert.equal(a1.active,true,"held nose inside the wall activates hazardContact on the first frozen tick");
    assert.ok(typeof a1.sinceMs==="number"&&a1.sinceMs>=900&&a1.sinceMs<=950,`first frozen tick sets a finite hazardContact.sinceMs (${a1.sinceMs})`);
    sendFrozen(c,1050,"fz-in-0",850,2,[1,1]);
    const a2=c.getSnapshot().hazardContact;
    assert.equal(a2.active,true,"second frozen tick keeps hazardContact active (held timestamp now 200ms old, exempt)");
    assert.equal(a2.sinceMs,a1.sinceMs,"first-contact time is not re-fired by a later frozen tick");
    sendFrozen(c,1150,"fz-in-0",850,3,[1,1]);
    const a3=c.getSnapshot().hazardContact;
    assert.equal(a3.active,true,"third frozen tick keeps the contact alive");
    assert.equal(a3.sinceMs,a1.sinceMs,"first-contact time stays stable across frozen ticks");
    sendFrozen(c,1250,"fz-in-0",850,4,[2,1]); // held nose exits the wall column while still frozen
    const a4=c.getSnapshot().hazardContact;
    assert.equal(a4.active,false,"held nose leaving the wall during the freeze releases hazardContact");
    assert.equal(a4.releasedAtMs,1200,"hazardContact releases at the analytic crossing time (sx 1->2 crosses the wall edge at 1200)");
    send(c,1500,1500,[-.4,1],[3.4,1],[3,1],"camera-a","fz-in-final");
    const wallOutcome=c.getHazardOutcomes().find((outcome)=>outcome.kind==="wall");
    assert.equal(wallOutcome?.result,"contact","wall contact from a frozen held nose settles as contact");
    assert.equal(wallOutcome?.consequenceApplied,true,"the frozen wall contact applies its consequence once");
    assert.equal(c.getScorePartitions()[0].obstacleContacts,1,"exactly one hazard consequence across all frozen ticks");
    assert.equal(c.getSnapshot().session.state,"playing","state stays playing through the freeze and resume");
  }
  // (b) held nose OUTSIDE the wall across multiple frozen ticks: no contact fires,
  // coverage accrues continuously from the frozen samples, and the wall finalizes
  // as avoided once the interval closes.
  {
    const c=ready([wall("fz-safe",1000,1350)]);
    send(c,850,850,[-.4,1],[3.4,1],[3,1],"camera-a","fz-safe-0");
    sendFrozen(c,950,"fz-safe-0",850,1,[3,1]);
    assert.equal(c.getSnapshot().hazardContact.active,false,"frozen nose outside the wall does not activate hazardContact");
    sendFrozen(c,1050,"fz-safe-0",850,2,[3,1]);
    sendFrozen(c,1150,"fz-safe-0",850,3,[3,1]);
    sendFrozen(c,1250,"fz-safe-0",850,4,[3,1]);
    sendFrozen(c,1350,"fz-safe-0",850,5,[3,1]);
    send(c,1500,1500,[-.4,1],[3.4,1],[3,1],"camera-a","fz-safe-final");
    const wallOutcome=c.getHazardOutcomes().find((outcome)=>outcome.kind==="wall");
    assert.equal(wallOutcome?.result,"avoided","frozen nose outside the wall settles as avoided, not contact");
    assert.equal(wallOutcome?.consequenceApplied,false,"avoided wall applies no hazard consequence");
    assert.equal(c.getScorePartitions().find((p)=>p.obstacleContacts>0) ?? 0,0,"avoided frozen-nose wall adds no obstacle contact");
    assert.equal(c.getSnapshot().session.state,"playing","state stays playing through an outside-wall freeze");
  }
}

console.log("Flow Colliders swept, directional, hazard, privacy, and lifecycle validation passed.");
