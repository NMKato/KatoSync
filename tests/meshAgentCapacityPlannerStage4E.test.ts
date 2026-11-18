import {test} from "node:test";
import assert from "node:assert/strict";
import {planMeshAgentCapacity,MESH_FREE_AGENT_LIMIT,MESH_PRO_AGENT_LIMIT,MESH_TRIAL_DAYS} from "../src/lib/meshAgentCapacityPlanner.ts";
const now=Date.parse("2026-11-03T15:10:00Z");
const owner="11111111-1111-4111-8111-111111111111";
const ent={plan:"pro" as const,verifiedByServer:true};
const node=(n:number)=>({
 deviceId:"device-"+String(n).padStart(3,"0"),agentName:"Agent "+n,ownerUserId:owner,
 registered:true,trusted:true,sessionVerified:true,mutualTlsReady:true,
 remoteJobsAuthorized:true,online:true,heartbeatAt:new Date(now-1000).toISOString(),
 capabilities:["codex","claude","local_llm","api"] as const
});
const job=(n:number,repo="repo-"+n)=>({
 taskId:"job-"+n,repoKey:repo,capability:"codex" as const,
 approved:true,resourceScopeApproved:true,writerLeaseRequired:true
});
const plan=(arg:Partial<Parameters<typeof planMeshAgentCapacity>[0]>={})=>planMeshAgentCapacity({
 entitlement:ent,ownerUserId:owner,nowMs:now,nodes:Array.from({length:10},(_,i)=>node(i)),
 leases:[],jobs:Array.from({length:10},(_,i)=>job(i)),...arg
});
test("Free 0 / Pro 10 / trial 14 days is the agent contract",()=>{
 assert.equal(MESH_FREE_AGENT_LIMIT,0);assert.equal(MESH_PRO_AGENT_LIMIT,10);
 assert.equal(MESH_TRIAL_DAYS,14);
 const result=plan();
 assert.equal(result.allowedDevices,10);
 assert.equal(result.readyAgents,10);assert.equal(result.parallelCapacity,10);
 assert.equal(result.assignments.length,10);
 assert.equal(new Set(result.assignments.map(a=>a.deviceId)).size,10);
});
test("Free, unverified and expired trial cannot dispatch any Mesh jobs",()=>{
 for(const entitlement of [
  {plan:"free" as const,verifiedByServer:true},
  {plan:"pro" as const,verifiedByServer:false},
  {plan:"trial" as const,verifiedByServer:true},
  {plan:"trial" as const,verifiedByServer:true,expiresAt:new Date(now).toISOString()},
 ]){
  const result=plan({entitlement});
  assert.equal(result.allowedDevices,0);assert.equal(result.assignments.length,0);
  assert.ok(result.waiting.every(w=>w.reason==="plan_unavailable"));
 }
 const active=plan({entitlement:{plan:"trial",verifiedByServer:true,
  expiresAt:new Date(now+60_000).toISOString()}});
 assert.equal(active.assignments.length,10);
});
test("Offline, revoked trust, expired heartbeat and unapproved transport reduce capacity",()=>{
 const nodes=Array.from({length:10},(_,i)=>node(i));
 nodes[0].online=false;nodes[1].trusted=false;nodes[2].mutualTlsReady=false;
 nodes[3].remoteJobsAuthorized=false;nodes[4].heartbeatAt=new Date(now-61_000).toISOString();
 const result=plan({nodes});
 assert.equal(result.readyAgents,5);assert.equal(result.assignments.length,5);
 assert.equal(result.waiting.length,5);
});
test("Lease and repository ownership remain exclusive even with 10 healthy agents",()=>{
 const leases=[{taskId:"old",deviceId:"device-000",repoKey:"repo-2",active:true}];
 const jobs=[job(1,"repo-2"),job(2,"repo-3"),job(3,"repo-3"),job(4,"repo-4")];
 const result=plan({leases,jobs});
 assert.equal(result.runningAgents,1);assert.equal(result.parallelCapacity,9);
 assert.deepEqual(result.assignments.map(x=>x.taskId),["job-2","job-4"]);
 assert.equal(result.waiting[0].reason,"repository_busy");
 assert.equal(result.waiting[1].reason,"repository_busy");
});
test("Duplicate device entries, duplicate jobs, wrong owners and missing permissions fail closed",()=>{
 const nodes=[node(1),node(1),node(2),{...node(3),ownerUserId:"other-account"}];
 const jobs=[job(1),job(1),{...job(3),approved:false},job(4)];
 const result=plan({nodes,jobs});
 assert.equal(result.readyAgents,1);
 assert.deepEqual(result.assignments.map(x=>x.deviceId),["device-002"]);
 assert.equal(result.waiting[0].reason,"duplicate_task");
 assert.equal(result.waiting[1].reason,"approval_required");
});
test("No more than 10 registered devices or missing server identity",()=>{
 const tooMany=Array.from({length:11},(_,i)=>node(i));
 assert.equal(plan({nodes:tooMany}).assignments.length,0);
 assert.equal(plan({ownerUserId:""}).assignments.length,0);
});

test("Round-robin prefers least recently used trusted agent",()=>{
 const nodes=[{...node(1),lastAssignedAt:new Date(now-20_000).toISOString()},
              {...node(2),lastAssignedAt:new Date(now-90_000).toISOString()}];
 const result=plan({nodes,jobs:[job(1)]});
 assert.equal(result.assignments[0].deviceId,"device-002");
});
test("No API or Claude credentials are part of the scheduler payload",()=>{
 const result=plan({nodes:[{...node(1),capabilities:["claude"]}],jobs:[
   {...job(1),capability:"claude"},
   {...job(2),capability:"api"}
 ]});
 assert.equal(result.assignments.length,1);
 assert.equal(result.waiting[0].reason,"no_agent_capacity");
 assert.ok(!/authorization|token|api_key|privatekey/i.test(JSON.stringify(result)));
});
