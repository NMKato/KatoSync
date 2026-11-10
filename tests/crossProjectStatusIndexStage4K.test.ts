// NMKato Solutions — no-privilege cross-project PROJECT_STATUS_FLOW index
import test from "node:test";
import assert from "node:assert/strict";
import {buildCrossProjectStatusIndex} from "../scripts/qa-cross-project-status-index.mjs";
import {buildRollingStatusProjection} from "../scripts/qa-project-memory-rolling.mjs";
const project=(projectId:string)=>{
 const SHA="a".repeat(40);
 return buildRollingStatusProjection({
   projectId,checkpoint:{sequence:2,commitSha:SHA,summary:"Checked project milestone"},
   events:[1,2].map(i=>({
      projectId, eventId:projectId+"-event-"+i,sequence:i,
      agentId:i===1?"codex":"local",
      kind:i===1?"checkpoint":"agent_note",
      createdAt:"2026-11-10T13:00:0"+i+"Z",
      commitSha:SHA,summary:"Project-only information "+i
   }))
 });
};
test("cross-project index reuses independently verified scoped status projections",()=>{
 const p=buildCrossProjectStatusIndex([project("genxline"),project("katosync")],{
   permittedProjectIds:["katosync","genxline"]
 });
 assert.deepEqual(p.records.map(x=>x.projectId),["genxline","katosync"]);
 assert.ok(p.records.every(x=>x.headCandidate==="a".repeat(40)));
 assert.ok(p.records.every(x=>x.trust==="projection-only-not-verified"));
 assert.ok(p.records.every(x=>x.statusSummaryCandidate==="Checked project milestone"));
 assert.equal(p.canonical,false);
 assert.equal(p.automaticMergeAllowed,false);
 assert.equal(p.remoteJobsEnabled,false);
 assert.equal(p.writerAuthorized,false);
});
test("unauthorized projects and private agent notes never leak into index",()=>{
 const p=buildCrossProjectStatusIndex([project("katosync"),project("private-proj")],{
  permittedProjectIds:["katosync"]
 });
 assert.equal(p.records.length,1);
 assert.equal(p.records[0].projectId,"katosync");
 assert.doesNotMatch(JSON.stringify(p),/private-proj|Project-only information/);
});
test("tampered projection and duplicate project reject before indexing",()=>{
 const a=project("katosync");
 assert.throws(()=>buildCrossProjectStatusIndex([a,{...a,currentMarkdown:"edited"}],{
  permittedProjectIds:["katosync"]}),/STAGE4K_DIRECTORY_DUPLICATE_OR_INVALID_PROJECT/);
 assert.throws(()=>buildCrossProjectStatusIndex([{...a,currentMarkdown:"edited"}],{
  permittedProjectIds:["katosync"]}),/STAGE4K_DIRECTORY_PROJECTION_INTEGRITY_DENIED/);
});
test("scope is mandatory and restricted to explicit project IDs",()=>{
 const a=project("katosync");
 assert.throws(()=>buildCrossProjectStatusIndex([a],{}),/STAGE4K_DIRECTORY_SCOPE_REQUIRED/);
 assert.throws(()=>buildCrossProjectStatusIndex([a],{permittedProjectIds:["../secret"]}),/STAGE4K_DIRECTORY_SCOPE_REQUIRED/);
 assert.throws(()=>buildCrossProjectStatusIndex([a],{permittedProjectIds:["katosync","katosync"]}),/STAGE4K_DIRECTORY_DUPLICATE_PERMISSIONS/);
});
