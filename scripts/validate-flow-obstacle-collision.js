// @ts-check
import assert from "node:assert/strict";
import { addInterval, clipNoseSegment, coversInterval, measuredNoseSample, pointContactsObstacle } from "../src/flow-obstacle-collision.js";
const gameplayGeometry=Object.freeze({schema:"aerobeat/obstacle_gameplay_geometry",version:1,coordinateSpace:"aerobeat_top_left_grid",x:1,y:0,width:1,height:3});
const obstacle=Object.freeze({intervalStartTimestampMs:37039.99938964844,intervalEndTimestampMs:37064.99938964844,gameplayGeometry});
const evidence=(frame,measured,x,y,overrides={})=>({provenance:"measured",measuredSourceFrameId:frame,calibrationId:"cal",measurementTimestampMs:measured,anchors:[{anchor:"nose",calibrationId:"cal",measurementTimestampMs:measured,valid:true,confidence:1,x,y,...overrides}]});
const sample=(songTimeMs,sx,sy,measured=songTimeMs)=>Object.freeze({songTimeMs,sx,sy,measurementTimestampMs:measured,sourceFrameId:String(measured),calibrationId:"cal"});
for(const [label,y] of [["top",1/6],["middle",.5],["bottom",5/6]]){const nose=measuredNoseSample(evidence(label,1000,.375,y),1000,1000);assert.equal(pointContactsObstacle({...obstacle,intervalStartTimestampMs:1000,intervalEndTimestampMs:1001},nose),true,`${label} row nose contacts exact 3c9d wall`);}
const adjacent=measuredNoseSample(evidence("adjacent",1000,.7,.5),1000,1000);assert.equal(pointContactsObstacle({...obstacle,intervalStartTimestampMs:1000,intervalEndTimestampMs:1001},adjacent),false);
assert.equal(pointContactsObstacle(obstacle,sample(37039,1.5,1)),false);assert.equal(pointContactsObstacle(obstacle,sample(37065,1.5,1)),false);
assert.equal(measuredNoseSample(evidence("bad",1000,.375,0,{confidence:.49}),1000,1000),null);
assert.equal(measuredNoseSample(evidence("wrist",1000,.375,0,{anchor:"left_wrist"}),1000,1000),null);
const tunnel=clipNoseSegment(obstacle,sample(37000,0,0,1000),sample(37100,3,0,1100));assert.ok(tunnel);assert(tunnel.startMs>=obstacle.intervalStartTimestampMs&&tunnel.endMs<=obstacle.intervalEndTimestampMs&&tunnel.endMs>tunnel.startMs);
const tangent=clipNoseSegment({...obstacle,intervalStartTimestampMs:0,intervalEndTimestampMs:100},sample(0,.5,-.5,0),sample(100,.5,-.5,100));assert.deepEqual(tangent,{startMs:0,endMs:100});
let union=addInterval([],0,50);union=addInterval(union,50,100);assert.equal(coversInterval(union,0,100),true);assert.equal(coversInterval(addInterval([],0,49),0,100),false);
assert.notEqual(measuredNoseSample(evidence("fresh",1000,.5,0),1150,1150),null);assert.equal(measuredNoseSample(evidence("stale",1000,.5,0),1151,1151),null);
console.log("Sparse measured nose collision covers all normalized obstacle rows.");
