import test from "node:test";
import assert from "node:assert/strict";
import {planOwnerWorkstationJob} from "../src/lib/ownerWorkstationPlanner.ts";

const t=Date.parse("2026-11-15T11:00:00Z");
const owner="11111111-1111-4111-8111-111111111111";
const outsider="22222222-2222-4222-8222-222222222222";
const m2="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const m3="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const job={
  id:"task_001",ownerId:owner,projectId:"katosync-core",
  mode:"read-only",requiredCapability:"repo.read",
  workload:"routine",minFreeMemoryGiB:3,cloudEscalationPermitted:false
};
const host={
  deviceId:m2,ownerId:owner,connected:true,signedPresenceFresh:true,
  localAgentRunning:true,modelId:"gemma-4-e4b",modelVerifiedReady:true,
  freeMemoryGiB:5,cpuLoadFraction:0.2,projectWriterLeaseVerified:false,
  desktopPrivacyPermissionsVerified:false,localUserSessionActive:false
};
const grant={
  ownerId:owner,deviceId:m2,projectId:"katosync-core",
  mode:"read-only",approvedCapabilities:["repo.read","status.read"],
  ownerApprovalVerified:true,stepUpVerified:false,revokedAt:null,
  expiresAt:"2026-11-15T17:00:00Z"
};
const provider={
  approvedBackend:"none",credentialsAvailableOnHost:false,
  separateCloudEgressApproved:false,remainingBudget:0
};
const run=(changes={})=>planOwnerWorkstationJob({
  job,hosts:[host],delegations:[grant],provider,nowMs:t,...changes
});
const assertBlocked=x=>{
  assert.equal(x.status,"blocked");
  assert.equal(x.executionAuthorized,false);
  assert.equal(x.requiresFreshServerAuthorization,true);
  assert.equal(x.deviceId,null);
};
test("an owner-approved local Gemma device becomes a candidate, never a permit",()=>{
 const x=run();
 assert.equal(x.status,"candidate");
 assert.equal(x.deviceId,m2);
 assert.equal(x.lane,"device-local-gemma");
 assert.equal(x.executionAuthorized,false);
 assert.equal(x.requiresFreshServerAuthorization,true);
});
test("foreign owner, missing Mesh trust or offline host are never selected",()=>{
 for(const change of [
  {ownerId:outsider},{connected:false},{signedPresenceFresh:false},
  {localAgentRunning:false},{cpuLoadFraction:1},{freeMemoryGiB:1}
 ]) assertBlocked(run({hosts:[{...host,...change}]}));
});
test("never treat stale, revoked, missing, foreign or duplicate delegation as consent",()=>{
 for(const patch of [
  {ownerApprovalVerified:false},{revokedAt:"2026-11-15T08:00:00Z"},
  {expiresAt:"2026-11-15T10:00:00Z"},
  {expiresAt:"2026-11-22T11:00:00Z"},
  {deviceId:m3},{ownerId:outsider},{projectId:"other-project"},
  {approvedCapabilities:["status.read"]}
 ])assertBlocked(run({delegations:[{...grant,...patch}]}));
 assertBlocked(run({delegations:[grant,grant]}));
 assertBlocked(run({delegations:[]}));
});
test("read-only cannot ask for terminal, file writes or GUI control",()=>{
 for(const requiredCapability of [
  "terminal.run","files.write","computer.control","computer.view"
 ]) assertBlocked(run({job:{...job,requiredCapability}}));
});
test("project writer requires granted capability and independently verified fenced lease",()=>{
 const writing={...job,mode:"project-writer",requiredCapability:"files.write"};
 const approval={...grant,mode:"project-writer",approvedCapabilities:["files.write"]};
 assertBlocked(run({job:writing,delegations:[approval]}));
 const result=run({job:writing,hosts:[{...host,projectWriterLeaseVerified:true}],
  delegations:[approval]});
 assert.equal(result.status,"candidate");
 assert.equal(result.executionAuthorized,false);
});
test("owner-workstation allows terminal only after verified owner step-up and lease",()=>{
 const owning={...job,mode:"owner-workstation",requiredCapability:"terminal.run"};
 const g={...grant,mode:"owner-workstation",approvedCapabilities:["terminal.run"]};
 assertBlocked(run({job:owning,delegations:[g]}));
 assertBlocked(run({job:owning,delegations:[{...g,stepUpVerified:true}]}));
 const x=run({job:owning,delegations:[{...g,stepUpVerified:true}],
  hosts:[{...host,projectWriterLeaseVerified:true}]});
 assert.equal(x.status,"candidate");
 assert.equal(x.executionAuthorized,false);
});
test("Computer Use is separate from shell and requires OS permissions and active user",()=>{
 const seeing={...job,mode:"computer-use",requiredCapability:"computer.control"};
 const g={...grant,mode:"computer-use",approvedCapabilities:["computer.control"],
  stepUpVerified:true};
 const writer={...host,projectWriterLeaseVerified:true};
 assertBlocked(run({job:seeing,delegations:[g],hosts:[writer]}));
 assertBlocked(run({job:seeing,delegations:[g],hosts:[{
  ...writer,desktopPrivacyPermissionsVerified:true
 }]}));
 const result=run({job:seeing,delegations:[g],hosts:[{
  ...writer,desktopPrivacyPermissionsVerified:true,localUserSessionActive:true
 }]});
 assert.equal(result.status,"candidate");
 assert.equal(result.executionAuthorized,false);
});
test("explicit target device never silently falls back to a different machine",()=>{
 const j={...job,requestedDeviceId:m3};
 assertBlocked(run({job:j}));
 const available={...host,deviceId:m3,freeMemoryGiB:6};
 const approved={...grant,deviceId:m3};
 const r=run({job:j,hosts:[host,available],
  delegations:[grant,approved]});
 assert.equal(r.deviceId,m3);
 assert.equal(r.executionAuthorized,false);
});
test("resource scheduling chooses available memory then utilization, deterministically",()=>{
 const second={...host,deviceId:m3,freeMemoryGiB:8,cpuLoadFraction:0.5};
 const r=run({hosts:[host,second],delegations:[grant,{...grant,deviceId:m3}]});
 assert.equal(r.deviceId,m3);
 const r2=run({hosts:[host,{...second,freeMemoryGiB:5,cpuLoadFraction:0.1}],
   delegations:[grant,{...grant,deviceId:m3}]});
 assert.equal(r2.deviceId,m3);
});
test("provider escalation only when independently budgeted, authorized and requested",()=>{
 const heavy={...job,workload:"heavy",cloudEscalationPermitted:true};
 const p={approvedBackend:"api",credentialsAvailableOnHost:true,
  separateCloudEgressApproved:true,remainingBudget:10};
 const x=run({job:heavy,provider:p});
 assert.equal(x.lane,"provider-escalation");
 for(const denied of [
  {...p,approvedBackend:"none"},{...p,credentialsAvailableOnHost:false},
  {...p,separateCloudEgressApproved:false},{...p,remainingBudget:0}
 ]) {
   const result=run({job:heavy,provider:denied});
   assert.equal(result.lane,"device-local-gemma");
   assert.equal(result.executionAuthorized,false);
 }
 const ownCli=run({job:heavy,provider:{...p,approvedBackend:"official-cli"}});
 assert.equal(ownCli.lane,"provider-escalation");
 assertBlocked(run({job:heavy,hosts:[{...host,modelVerifiedReady:false}],
   provider:{...p,approvedBackend:"none"}}));
});
test("invalid requests and duplicate inventory fail before candidate selection",()=>{
 for(const patch of [
  {id:"../escape"},{ownerId:"invalid"},{projectId:"../../secret"},
  {minFreeMemoryGiB:-1},{requiredCapability:"root.system"},
  {mode:"unknown"},{requestedDeviceId:"bad"}
 ]) assertBlocked(run({job:{...job,...patch}}));
 assertBlocked(run({hosts:[host,host]}));
 assertBlocked(run({hosts:[{...host,cpuLoadFraction:NaN}]}));
});
