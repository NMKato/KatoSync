import {test} from "node:test";
import assert from "node:assert/strict";
import {
 acceptanceReceiptDigest40,acceptanceScopeDigest40,verifyFeatureAcceptanceLedger40,
 type AcceptanceAuthority40,type AcceptanceSnapshot40,type AcceptanceScope40
} from "../src/lib/featureAcceptanceLedger40.ts";
import {forecastAcceptedRoadmap40} from "../src/lib/smartProjectProgress40.ts";

const sha=(c:string)=>c.repeat(40);
const now=Date.parse("2026-11-04T12:00:00Z");
const scope:AcceptanceScope40={
  projectId:"project-a",planJournalSequence:17,tasks:[
    {featureId:"a",lane:"mvp",weight:2,acceptanceCriteria:"signed pass",ciChecks:[{workflow:"ci",job:"a"}]},
    {featureId:"b",lane:"mvp",weight:1,acceptanceCriteria:"signed pass",ciChecks:[{workflow:"ci",job:"b"}]},
    {featureId:"c",lane:"mvp",weight:1,acceptanceCriteria:"signed pass",ciChecks:[{workflow:"ci",job:"c"}]},
    {featureId:"d",lane:"mvp",weight:1,acceptanceCriteria:"signed pass",ciChecks:[{workflow:"ci",job:"d"}]},
    {featureId:"other",lane:"side",weight:5,acceptanceCriteria:"signed pass",ciChecks:[{workflow:"ci",job:"side"}]}
  ]
};
const authority:AcceptanceAuthority40={
  async verifyOwnerSignature(s){return s.owner.signature==="owner-sig:"+s.owner.decisionId;},
  async verifyCi(c,s){
    return c.runId>0&&c.workflow==="ci"&&
      s.acceptedFeatureIds.includes(c.job)&&c.headSha===s.headSha;
  },
  async verifyDescendant(a,b){return a!==b&&a<b;}
};
async function create(ids:string[],at:string,head:string,
  previousHash:string|null):Promise<AcceptanceSnapshot40>{
  const snapshot:Omit<AcceptanceSnapshot40,"hash">={
    schemaVersion:"katosync.feature-acceptance/v1",
    projectId:"project-a",planJournalSequence:17,
    scopeDigest:await acceptanceScopeDigest40(scope),
    headSha:sha(head),acceptedAt:at,acceptedFeatureIds:ids,
    ci:ids.map((id,i)=>({workflow:"ci",job:id,runId:100+i,headSha:sha(head)})),
    owner:{decisionId:"decision-"+head,signerKeyId:"pinned-owner",
      signature:"owner-sig:decision-"+head},
    previousHash
  };
  return {...snapshot,hash:await acceptanceReceiptDigest40(snapshot)};
}
async function history(){
  const a=await create(["a"],"2026-10-01T12:00:00.000Z","a",null);
  const b=await create(["a","b"],"2026-10-14T12:00:00.000Z","b",a.hash);
  const c=await create(["a","b","c"],"2026-11-01T12:00:00.000Z","c",b.hash);
  return [a,b,c];
}
async function check(snapshots:readonly AcceptanceSnapshot40[],overrides:
  Record<string,unknown>={}){
  return verifyFeatureAcceptanceLedger40({scope,currentHeadSha:sha("c"),
    snapshots,authority,nowMs:now,...overrides});
}
async function reseal(receipt:AcceptanceSnapshot40):Promise<AcceptanceSnapshot40>{
  return {...receipt,hash:await acceptanceReceiptDigest40(receipt)};
}
function fails(result:Awaited<ReturnType<typeof check>>,reason:string){
  assert.equal(result.status,"unavailable");
  if(result.status==="unavailable"){
    assert.equal(result.reason,reason);
    assert.equal(result.verifiedPercent,null);
    assert.deepEqual(result.milestones,[]);
  }
}

test("only fully trusted owner+CI+Git snapshots produce accepted feature percent",async()=>{
  const result=await check(await history());
  assert.equal(result.status,"verified");
  if(result.status!=="verified")return;
  assert.equal(result.verifiedPercent,80);
  assert.equal(result.receiptCount,3);
  assert.deepEqual(result.acceptedFeatures,["a","b","c"]);
  assert.deepEqual(result.milestones.map(m=>m.verifiedPercent),[40,60,80]);
  assert.ok(result.milestones.every(m=>m.ownerApproved&&m.ciVerified));
  const forecast=forecastAcceptedRoadmap40({
    projectId:"project-a",planJournalSequence:17,verifiedPercent:80,
    milestones:result.milestones,nowMs:now,blocked:false
  });
  assert.equal(forecast.status,"range");
});

test("no ledger or malformed scope cannot create a verified zero percent",async()=>{
  fails(await check([]),"missing_ledger");
  fails(await check(await history(),{scope:{...scope,planJournalSequence:0}}),"invalid_scope");
  fails(await check(await history(),{authority:null}),"invalid_scope");
});
test("forged owner approval fails even with matching hashes",async()=>{
  const list=await history();
  list[2]=await reseal({...list[2],owner:{...list[2].owner,signature:"fake"}});
  fails(await check(list),"signature_unverified");
});
test("a successful CI boolean in JSON cannot replace authenticated CI verification",async()=>{
  const list=await history();
  fails(await check(list,{authority:{...authority,verifyCi:async()=>false}}),"ci_unverified");
});
test("different HEAD for a required check is never feature acceptance",async()=>{
  const list=await history();
  list[2]=await reseal({...list[2],
    ci:list[2].ci.map((c,i)=>i===0?{...c,headSha:sha("d")}:c)});
  fails(await check(list),"ci_unverified");
});
test("changed receipt content without recomputed digest breaks chain",async()=>{
  const list=await history();
  list[1]={...list[1],acceptedFeatureIds:["a","c"]};
  fails(await check(list),"chain_broken");
});
test("re-hashed replacement still requires owner signature independent of hash",async()=>{
  const list=await history();
  list[2]=await reseal({...list[2],owner:{...list[2].owner,decisionId:"fake-owner"}});
  fails(await check(list),"signature_unverified");
});
test("wrong plan revision and project isolation fail closed",async()=>{
  const list=await history();
  fails(await check(list,{scope:{...scope,planJournalSequence:18}}),"wrong_plan_or_project");
  fails(await check(list,{scope:{...scope,projectId:"project-b"}}),"wrong_plan_or_project");
});
test("roadmap weight or acceptance criteria change cannot reuse old journal sequence",async()=>{
  const list=await history();
  const changed={...scope,tasks:scope.tasks.map((task,i)=>
    i===0?{...task,weight:3}:task)};
  fails(await check(list,{scope:changed}),"scope_changed");
  const criteria={...scope,tasks:scope.tasks.map((task,i)=>
    i===0?{...task,acceptanceCriteria:"different"}:task)};
  fails(await check(list,{scope:criteria}),"scope_changed");
});
test("HEAD moved without re-acceptance invalidates latest reported verification",async()=>{
  fails(await check(await history(),{currentHeadSha:sha("d")}),"stale_head");
});
test("unknown feature cannot be accepted by a valid-looking receipt",async()=>{
  const list=await history();
  list[2]=await reseal({...list[2],acceptedFeatureIds:["a","b","unknown"]});
  fails(await check(list),"malformed_receipt");
});
test("missing required CI job and unbound test claims fail closed",async()=>{
  const list=await history();
  list[2]=await reseal({...list[2],ci:list[2].ci.slice(0,2)});
  fails(await check(list),"ci_unverified");
});
test("Git ancestry must be independently established",async()=>{
  fails(await check(await history(),{
    authority:{...authority,verifyDescendant:async()=>false}
  }),"git_unverified");
});
test("rewritten or reordered history cannot preserve verified percent",async()=>{
  const list=await history();
  list[2]=await reseal({...list[2],previousHash:"f".repeat(64)});
  fails(await check(list),"chain_broken");
  const reordered=await history();
  fails(await check([reordered[1],reordered[0],reordered[2]]),"chain_broken");
});
test("regression to fewer approved features is not allowed",async()=>{
  const list=await history();
  list[2]=await reseal({...list[2],acceptedFeatureIds:["a"],ci:list[2].ci.slice(0,1)});
  fails(await check(list),"regressed_features");
});
test("duplicate head and approval ID cannot artificially inflate velocity",async()=>{
  const list=await history();
  list[2]=await reseal({...list[2],headSha:list[1].headSha});
  fails(await check(list),"malformed_receipt");
  const another=await history();
  another[2]=await reseal({...another[2],owner:{...another[1].owner}});
  fails(await check(another),"malformed_receipt");
});
test("future, nondeterministic timestamps and unsafe scope cannot pass",async()=>{
  const list=await history();
  list[2]=await reseal({...list[2],acceptedAt:"2026-12-01T12:00:00.000Z"});
  fails(await check(list),"future_or_unordered");
  const old=await history();
  old[2]=await reseal({...old[2],acceptedAt:"2026-10-12T12:00:00.000Z"});
  fails(await check(old),"future_or_unordered");
  const other=await history();
  fails(await check(other,{scope:{...scope,tasks:[scope.tasks[0],scope.tasks[0]]}}),"invalid_scope");
});
