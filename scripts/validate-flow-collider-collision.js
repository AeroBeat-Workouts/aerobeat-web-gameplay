// @ts-check
import assert from "node:assert/strict";
import { createAeroGameplaySessionCoordinator } from "../src/index.js";
import { clipWristSegmentToTarget, defaultFlowColliderSettings, isContinuousColliderSegment, matchesAuthoredDirection, measuredColliderSample, pointContactsFlowTarget, targetCenterForPlacement } from "../src/flow-collider-collision.js";

const HASH="a".repeat(64);
const settings=(overrides={})=>({ ...defaultFlowColliderSettings, ...overrides });
const variant=(id="collider")=>({variantId:id,chartId:`chart-${id}`,mode:"flow",rulesetId:"flow_colliders_v1",recipeId:null,modifierIds:[],ranked:false,localOnly:true,mapHash:{schema:"aerobeat/content_hash",version:1,algorithm:"sha256",value:HASH},scoreIdentityHash:{schema:"aerobeat/content_hash",version:1,algorithm:"sha256",value:HASH},provenance:{kind:"imported"}});
const flowGrid=()=>({...variant("grid"),rulesetId:"flow_grid_v2",localOnly:false});
const beat=(eventId,centerTimestampMs,type="note",extra={})=>({schema:"aerobeat/resolved_content_event",version:3,eventId,variantId:"collider",chartId:"chart-collider",centerTimestampMs,sourceEventIds:[`source-${eventId}`],type,...extra});
const wall=(eventId,start=900,end=1100)=>beat(eventId,start,"obstacle",{intervalStartTimestampMs:start,intervalEndTimestampMs:end,sourceGeometry:{schema:"aerobeat/obstacle_source_geometry",version:1,coordinateSpace:"beatsaber_v3_obstacle_rect",kind:"v3_rect",x:1,y:0,width:1,height:3},gameplayGeometry:{schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",x:1,y:0,width:1,height:3},gridMask:[1,5,9]});
const anchor=(name,measured,sx,sy)=>({schema:"aerobeat/body_grid_anchor_snapshot",version:1,anchor:name,calibrationId:"cal-1",measurementTimestampMs:measured,valid:true,confidence:1,rawX:0.5,rawY:0.5,x:(sx+0.5)/4,y:(2.5-sy)/3,cell:5,subcell:20});
const evidence=(frameId,measured,left=[-0.4,1],right=[3.4,1],nose=[3,2])=>({schema:"aerobeat/gameplay_evidence_snapshot",version:1,calibrationId:"cal-1",measuredSourceFrameId:frameId,measurementTimestampMs:measured,provenance:"measured",activeBoxingActions:[],anchors:[anchor("nose",measured,...nose),anchor("left_shoulder",measured,0,0),anchor("right_shoulder",measured,3,0),anchor("left_elbow",measured,0,0),anchor("right_elbow",measured,3,0),anchor("left_wrist",measured,...left),anchor("right_wrist",measured,...right)],entries:[]});
const input=(measured,latest,overrides={})=>({sourceIdentity:overrides.sourceIdentity??"camera-a",calibration:{calibrationId:overrides.calibrationId??"cal-1",readiness:"countdown"},tracking:{gameplayPaused:false,freshCalibrationRequired:false},countdownFrozen:false,latestEvidence:latest,straightQualifications:[]});
const config=(events,colliderSettings=settings())=>({packageId:"package",selectedVariant:variant(),resolvedEvents:events,profileIdentity:{schema:"aerobeat/prototype_tuning_identity",version:1,profileId:"profile",profileVersion:"1",contentHash:HASH,class:"between_run_ruleset",regenerationRequired:false},flowColliderSettings:colliderSettings});
const clock=(ms,playing)=>({contextTimeSeconds:ms/1000,positionSeconds:ms/1000,playing});
function ready(events,colliderSettings=settings()){const c=createAeroGameplaySessionCoordinator({sessionId:"collider-test",countdownStepMs:1});c.configureContent(config(events,colliderSettings));c.advance({timestampMs:0,clock:clock(0,false),input:input(0,null)});assert.equal(c.requestStart(0).accepted,true);c.advance({timestampMs:1,clock:clock(0,false)});c.advance({timestampMs:2,clock:clock(0,false)});c.advance({timestampMs:3,clock:clock(0,false)});assert.equal(c.getSnapshot().session.state,"playing");return c;}
function send(c,wallMs,songMs,left,right,nose,sourceIdentity="camera-a",frameId=`f-${wallMs}-${songMs}`){const sample=evidence(frameId,wallMs,left,right,nose);c.advance({timestampMs:wallMs,clock:clock(songMs,true),input:input(wallMs,sample,{sourceIdentity})});return sample;}

// Pure canonical footprint: inside, exact tangent, outside, and swept tunnelling.
{
  assert.deepEqual(targetCenterForPlacement(5),{x:1,y:1});
  const event={centerTimestampMs:1000,placement:5};
  const sample=(songTimeMs,sx,sy,measurementTimestampMs=songTimeMs,sourceFrameId=String(measurementTimestampMs),sourceIdentity="camera-a",calibrationId="cal-1")=>Object.freeze({songTimeMs,measurementTimestampMs,sourceFrameId,sourceIdentity,calibrationId,sx,sy});
  assert.equal(pointContactsFlowTarget(event,sample(820,1,1),.125,180),true);
  assert.equal(pointContactsFlowTarget(event,sample(1180,1.5,1),.125,180),true,"inflated exact tangent is inclusive");
  assert.equal(pointContactsFlowTarget(event,sample(1180.001,1,1),.125,180),false);
  assert.equal(pointContactsFlowTarget(event,sample(1000,1.500001,1),.125,180),false);
  assert.ok(clipWristSegmentToTarget(event,sample(900,-.5,1,900,"a"),sample(1000,2.5,1,1000,"b"),.125,180));
  assert.equal(clipWristSegmentToTarget(event,sample(900,-.5,1,900,"a"),sample(1051,2.5,1,1051,"b"),.125,180),null,">150ms gap cannot tunnel");
  assert.ok(clipWristSegmentToTarget(event,sample(850,-.5,1,850,"a"),sample(1000,2.5,1,1000,"b"),.125,180),"150ms gap remains continuous");
}

// Measured-only extraction rejects stale/future/invalid/bounds/calibration and source omissions.
{
  const sample=evidence("frame",1000,[1,1]); const wrapped={sourceIdentity:"camera-a"};
  assert.ok(measuredColliderSample(sample,wrapped,"left_wrist",1000,1000));
  assert.ok(measuredColliderSample(sample,wrapped,"left_wrist",1150,1150));
  assert.equal(measuredColliderSample(sample,wrapped,"left_wrist",1151,1151),null);
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

// Default overlap-only permits a stationary wrist and ignores the authored arrow.
{
  const c=ready([beat("stationary",1000,"note",{hand:"left",placement:5,direction:"down"})]);
  send(c,1000,1000,[1,1],[3,1],[3,2]);
  assert.deepEqual(c.getJudgements().map(j=>[j.eventId,j.result,j.timingOffsetMs]),[["stationary","hit",0]]);
  assert.equal(c.getScorePartitions()[0].ranked,false);assert.equal(c.getScorePartitions()[0].localOnly,true);assert.match(c.getScorePartitions()[0].flowColliderSettingsIdentity,/^sha256:[a-f0-9]{64}$/u);
}

// Optional direction is run-locked, affects identity, and misses only after strict late bound.
{
  const directional=settings({enforceAuthoredDirection:true,directionToleranceDegrees:20});
  const c=ready([beat("directed",1000,"note",{hand:"left",placement:5,direction:"right"})],directional);
  send(c,900,900,[.3,1],[3,1],[3,2]);send(c,1000,1000,[.3,1],[3,1],[3,2]);
  assert.equal(c.getJudgements().length,0);send(c,1180,1180,[.3,1],[3,1],[3,2]);assert.equal(c.getJudgements().length,0,"inclusive late bound remains pending");send(c,1181,1181,[.3,1],[3,1],[3,2]);assert.deepEqual([c.getJudgements()[0].result,c.getJudgements()[0].diagnostics],["miss",["wrong_direction"]]);
  c.pause(1182);assert.throws(()=>c.applyFutureContent(config([],settings({enforceAuthoredDirection:false}))),/locked/u);
  const other=ready([beat("identity",1000,"note",{hand:"left",placement:5})],settings({colliderRadius:.2}));send(other,1000,1000,[1,1],[3,1],[3,2]);assert.notEqual(other.getScorePartitions()[0].flowColliderSettingsIdentity,c.getScorePartitions()[0].flowColliderSettingsIdentity);
}

// One sweep resolves every exact-time same-wrist chord member; staggered members wait for a later contact. Ordering is deterministic.
{
  const events=[beat("right-chord",1000,"note",{hand:"right",placement:7}),beat("left-b",1000,"note",{hand:"left",placement:6}),beat("left-a",1000,"note",{hand:"left",placement:4}),beat("left-duplicate-cell",1000,"note",{hand:"left",placement:4}),beat("later",1010,"note",{hand:"left",placement:6})];
  const run=(ordered)=>{const c=ready(ordered);send(c,900,900,[-.5,1],[3.5,1],[3,2]);send(c,1000,1000,[2.4,1],[3,1],[3,2]);assert.deepEqual(c.getJudgements().map(j=>j.eventId),["left-a","left-b","left-duplicate-cell","right-chord"]);send(c,1010,1010,[2.4,1],[3,1],[3,2]);assert.equal(c.getJudgements().at(-1).eventId,"later");return c.getJudgements().map(j=>[j.eventId,j.result,j.timingOffsetMs]);};
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
}

// Complete dual-wrist passage avoids a bomb; a gap is explicitly unevaluated.
{
  const run=(complete)=>{const c=ready([beat("bomb",1000,"bomb",{placement:5})]);send(c,820,820,[-.4,-.4],[3.4,-.4],[3,2]);if(complete){send(c,970,970,[-.4,-.4],[3.4,-.4],[3,2]);send(c,1120,1120,[-.4,-.4],[3.4,-.4],[3,2]);}send(c,1180,1180,[-.4,-.4],[3.4,-.4],[3,2]);send(c,1181,1181,[-.4,-.4],[3.4,-.4],[3,2]);return c.getHazardOutcomes()[0].result;};
  assert.equal(run(true),"avoided");assert.equal(run(false),"unevaluated_tracking");
}

// Duplicate, rollback, source change, and lifecycle reset cannot fabricate a sweep.
{
  for(const kind of ["duplicate","rollback","source"]){const c=ready([beat(kind,1000,"note",{hand:"left",placement:5})]);send(c,900,900,[-.5,1],[3,1],[3,2],"camera-a","baseline");if(kind==="duplicate")send(c,1000,1000,[2,1],[3,1],[3,2],"camera-a","baseline");else if(kind==="rollback"){const rollback=evidence("rollback",899,[2,1],[3,1],[3,2]);c.advance({timestampMs:1000,clock:clock(1000,true),input:input(899,rollback)});}else send(c,1000,1000,[2,1],[3,1],[3,2],"camera-b","changed");assert.equal(c.getJudgements().length,0,kind);}
  const c=ready([beat("reset",1000,"note",{hand:"left",placement:5})]);send(c,900,900,[-.5,1],[3,1],[3,2]);c.reset(901);assert.equal(c.getSnapshot().session.state,"calibrating");
}

// Bounded settings reject malformed/ranked input without mutation; Flow Grid keeps its old matcher and identity.
{
  const c=createAeroGameplaySessionCoordinator({sessionId:"bounds"});for(const bad of [settings({colliderRadius:-.001}),settings({colliderRadius:.501}),settings({directionToleranceDegrees:91}),settings({timingWindowMs:49}),settings({timingWindowMs:301}),{...settings(),extra:true}])assert.throws(()=>c.configureContent(config([],bad)),/(?:Flow Collider|unknown or symbolic fields)/u);
  assert.throws(()=>c.configureContent({...config([]),selectedVariant:{...variant(),ranked:true}}),/unranked and local-only/u);
  const grid=createAeroGameplaySessionCoordinator({sessionId:"grid"});const gridEvent={...beat("grid-note",1000,"note",{hand:"left",placement:5}),variantId:"grid",chartId:"chart-grid"};grid.configureContent({packageId:"package",selectedVariant:flowGrid(),resolvedEvents:[gridEvent]});assert.equal(grid.getSnapshot().session.rulesetId,"flow_grid_v2");assert.throws(()=>grid.configureContent({packageId:"package",selectedVariant:flowGrid(),resolvedEvents:[],flowColliderSettings:settings()}),/require the Flow Colliders/u);
}

// Public collider state exposes only opaque tuning identity and semantic hazard data, never physical evidence/history.
{
  const c=ready([beat("private-bomb",1000,"bomb",{placement:5})]);send(c,1000,1000,[1,1],[3,1],[3,2]);const publicText=JSON.stringify({hazards:c.getHazardOutcomes(),partitions:c.getScorePartitions()});for(const forbidden of ["colliderRadius","directionToleranceDegrees","measurementTimestampMs","sourceFrameId","sourceIdentity","calibrationId","confidence","rawX","rawY","trajectory","segment","contactEpisodeId","evidenceFrameId"])assert.equal(publicText.includes(forbidden),false,forbidden);
}

console.log("Flow Colliders swept, directional, hazard, privacy, and lifecycle validation passed.");
