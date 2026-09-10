// @ts-check
import assert from "node:assert/strict";
import { createAeroGameplaySessionCoordinator, createFlowColliderSettings, defaultFlowColliderSettings as publicDefaultFlowColliderSettings, flowColliderSettingsBounds, flowColliderSettingsIdentity, maximumColliderSampleFreshnessMs, maximumColliderSampleGapMs } from "../src/index.js";
import { clipWristSegmentToTarget, defaultFlowColliderSettings, isContinuousColliderSegment, matchesAuthoredDirection, measuredColliderSample, pointContactsFlowTarget, targetCenterForPlacement } from "../src/flow-collider-collision.js";

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
  assert.ok(clipWristSegmentToTarget(event,sample(851,-.5,1,851,"a149"),sample(1000,2.5,1,1000,"b149"),.125,180),"149ms gap remains continuous");
  assert.ok(clipWristSegmentToTarget(event,sample(850,-.5,1,850,"a150"),sample(1000,2.5,1,1000,"b150"),.125,180),"150ms gap remains continuous");
  assert.equal(clipWristSegmentToTarget(event,sample(849,-.5,1,849,"a151"),sample(1000,2.5,1,1000,"b151"),.125,180),null,">150ms gap cannot tunnel");
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
  const lower=measuredColliderSample(evidence("lower",900,[1,0]),{sourceIdentity:"camera-a"},"left_wrist",900,900);const upper=measuredColliderSample(evidence("upper",1000,[1,1]),{sourceIdentity:"camera-a"},"left_wrist",1000,1000);assert.equal(matchesAuthoredDirection("up",lower,upper,0),true,"input y-down is converted once to authored up-positive canonical sy");assert.equal(matchesAuthoredDirection("down",lower,upper,45),false);
}

// Default overlap-only permits a stationary wrist and ignores the authored arrow.
{
  const c=ready([beat("stationary",1000,"note",{hand:"left",placement:5,direction:"down"})]);
  send(c,1000,1000,[1,1],[3,1],[3,2]);
  assert.deepEqual(c.getJudgements().map(j=>[j.eventId,j.result,j.timingOffsetMs]),[["stationary","hit",0]]);
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

// A normal uninterrupted same-generation segment at the inclusive 150ms gap remains valid.
{
  const c=ready([beat("continuous-150",1000,"note",{hand:"left",placement:5})]);send(c,850,850,[-.5,1],[3,1],[3,2],"camera-a","continuous-start");send(c,1000,1000,[2,1],[3,1],[3,2],"camera-a","continuous-end");assert.equal(c.getJudgements()[0].result,"hit");
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

console.log("Flow Colliders swept, directional, hazard, privacy, and lifecycle validation passed.");
