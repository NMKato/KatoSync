import {test} from "node:test";
import assert from "node:assert/strict";
import {meshRegistrationAgentName,presentMeshRegistrations} from "../src/lib/meshDirectoryPresentation35.ts";
const now=Date.parse("2026-11-03T22:25:00.000Z");
const m2stage3="21-3A-B3-7F-00-00-00-00-00-00-00-00-00-00-00-01";
const m2stage35="13-B6-6F-06-00-00-00-00-00-00-00-00-00-00-00-02";
const m3stage3="0C-C9-2C-0E-00-00-00-00-00-00-00-00-00-00-00-03";
const m3stage35="C4-0B-3A-E5-00-00-00-00-00-00-00-00-00-00-00-04";
const row=(id:string,fingerprint:string,ageMin:number)=>({
  deviceId:id,fingerprint,
  lastSeenAt:new Date(now-ageMin*60000).toISOString(),
  membershipState:"discovered" as "discovered"|"revoked"
});
const roster=[
  row("M2-old",m2stage3,540),
  row("M3-old",m3stage3,540),
  row("M2-new",m2stage35,32),
  row("M3-new",m3stage35,1)
];
test("four app identities on two Macs are shown as four registrations, never four physical devices",()=>{
  const result=presentMeshRegistrations({devices:roster,localFingerprint:m3stage35,nowMs:now});
  assert.equal(result.totalIdentities,4);
  assert.equal(result.own?.deviceId,"M3-new");
  assert.deepEqual(result.recentlyReported.map(d=>d.deviceId),["M2-new"]);
  assert.deepEqual(result.olderEntries.map(d=>d.deviceId),["M2-old","M3-old"]);
  assert.equal(result.registeredPeers,3);
});
test("the current app is not a selectable peer, including case and separator changes",()=>{
  const result=presentMeshRegistrations({devices:roster,
    localFingerprint:m3stage35.replace(/-/g,"").toLowerCase(),nowMs:now});
  assert.equal(result.own?.deviceId,"M3-new");
  assert.ok(![...result.recentlyReported,...result.olderEntries].some(d=>d.deviceId==="M3-new"));
});
test("old, missing, future-skewed, revoked timestamps are not interpreted as online proof",()=>{
  const extra=[
    row("missing",m2stage3,0),row("future",m2stage35,-80),
    row("revoked",m3stage3,1),row("old",m3stage35,200)
  ];
  extra[0].lastSeenAt="invalid";
  extra[2].membershipState="revoked";
  const result=presentMeshRegistrations({devices:extra,localFingerprint:null,nowMs:now});
  assert.equal(result.recentlyReported.length,0);
  assert.equal(result.olderEntries.length,4);
});
test("duplicate device rows do not inflate counts or create an extra selectable instance",()=>{
  const result=presentMeshRegistrations({devices:[roster[0],roster[0],roster[1]],
    localFingerprint:null,nowMs:now});
  assert.equal(result.totalIdentities,2);
  assert.equal(result.registeredPeers,2);
});

test("public-key-derived agent names match native Rust bootstrap on M2 and M3",()=>{
 const fp=(suffix:string,hex:string)=>"0".repeat(24)+suffix+"00"+hex;
 assert.equal(meshRegistrationAgentName(fp("AF99","79"),"macos"),"KAI Nexus Mac-AF99");
 assert.equal(meshRegistrationAgentName(fp("D048","9D"),"macos"),"KAI Nika Mac-D048");
 assert.equal(meshRegistrationAgentName(fp("1071","88"),"macos"),"KAI Echo Mac-1071");
 assert.equal(meshRegistrationAgentName(fp("87FB","08"),"macos"),"KAI Echo Mac-87FB");
 assert.equal(meshRegistrationAgentName("bad","macos"),null);
});
