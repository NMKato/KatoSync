// Created by NMKato Solutions — Stage4U read budget + race/owner safety regression.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {EASY_RELAY_POLL_MS,canPollEasyMeshRelay} from "../src/lib/meshRelayFlowPolicy4U.ts";
const ui=readFileSync(new URL("../src/components/MeshConnectionCard.tsx",import.meta.url),"utf8");
const okay={sessionValid:true,stage:"waiting" as const,hasProof:false,hasOutboundWork:false,hasAcceptedOffer:false,failed:false};

test("one immediate read plus periodic reads remain well below PostgreSQL 12/min/device",()=>{
 assert.ok(EASY_RELAY_POLL_MS>=10_000);
 const worst=1+Math.ceil(60_000/EASY_RELAY_POLL_MS);
 assert.ok(worst<=8,"expected substantial rate-limit headroom");
 assert.match(ui,/setInterval\(refresh,EASY_RELAY_POLL_MS\)/);
 assert.doesNotMatch(ui,/setInterval\(refresh,5_000\)/);
});
test("read budget scheduler gives outbound challenge and response absolute priority",()=>{
 assert.equal(canPollEasyMeshRelay(okay),true);
 for(const patch of [{hasOutboundWork:true},{hasAcceptedOffer:true},
  {failed:true},{sessionValid:false},{hasProof:true},
  {stage:"error" as const},{stage:"approved" as const},{stage:"compare" as const},
  {stage:"expired" as const}]) {
   assert.equal(canPollEasyMeshRelay({...okay,...patch}),false,JSON.stringify(patch));
 }
});
test("a queued send waits for a concurrent read then retries once it finishes",()=>{
 const a=ui.indexOf("if(!easyEnabled||!easySession||!challengeRelayWork||relayBusy||relayError||");
 const b=ui.indexOf("if(!easyEnabled||!easySession||!responseRelayWork||relayBusy||relayError||");
 assert.ok(a>=0&&b>a);
 assert.match(ui,/\},\[easyEnabled,easySession,challengeRelayWork,relayBusy,relayError,easyStage\]\);/);
 assert.match(ui,/\},\[easyEnabled,easySession,responseRelayWork,relayBusy,relayError,easyStage\]\);/);
 assert.match(ui,/easyStage==="error"\|\|relayInFlight\.current/);
 assert.match(ui,/!relayInFlight\.current&&!challengeRelayWork&&!responseRelayWork/);
});
test("rate-limit, native challenge and relay send failures stop the falsely hanging spinner",()=>{
 assert.match(ui,/if\(easyEnabled&&easySession&&\(challengeError\|\|relayError\)\)/);
 assert.match(ui,/setEasyStage\("error"\)/);
 assert.match(ui,/failed:challengeError\|\|relayError/);
});
test("crossed invitations never overwrite an ongoing owner session",()=>{
 assert.match(ui,/\(easyEnabled&&easySession!==null\)\|\|/);
 assert.match(ui,/disabled=\{recipientBusy\|\|\(easyEnabled&&easySession!==null\)\}/);
});
test("SAS click still must be deliberate and never starts remote access",()=>{
 assert.match(ui,/onClick=\{\(\)=>void approveEasyPeer\(\)\}/);
 assert.match(ui,/canQuickApproveSameCode/);
 assert.match(ui,/mesh\.easy\.noTransport/);
 assert.doesNotMatch(ui,/remote_task_execute\(/);
});
