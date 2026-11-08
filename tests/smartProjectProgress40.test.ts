import {test} from "node:test";
import assert from "node:assert/strict";
import {computeSmartProjectProgress40,forecastAcceptedRoadmap40,type AcceptedMilestone40}
  from "../src/lib/smartProjectProgress40.ts";
import type {AgentJob,RegistryProject} from "../src/types.ts";
import type {ProjectMvpProgress} from "../src/components/ProjectMvpIndicator.tsx";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const now=Date.parse("2026-11-04T12:00:00Z");
const sha=(ch:string)=>ch.repeat(40);
function milestone(date:string,percent:number,hex:string):AcceptedMilestone40{
 return {projectId:"my-project",planJournalSequence:10,at:date,verifiedPercent:percent,
  headSha:sha(hex),evidenceReceipt:"signed-acceptance-evidence-2026",
  ownerApproved:true,ciVerified:true};
}
const samples=[
 milestone("2026-10-01T12:00:00Z",20,"a"),
 milestone("2026-10-14T12:00:00Z",40,"b"),
 milestone("2026-11-01T12:00:00Z",65,"c")
];
function runForecast(milestones:readonly AcceptedMilestone40[]=samples,overrides:Record<string,unknown>={}){
 return forecastAcceptedRoadmap40({projectId:"my-project",planJournalSequence:10,
  verifiedPercent:65,milestones,nowMs:now,blocked:false,...overrides});
}
const project={
 id:"my-project",
 scan:{branch:"main",headSha:sha("c"),dirtyCount:0,scannedAt:"2026-11-04T11:00:00Z"},
 verification:{state:"verified",headSha:sha("c"),findings:[],checkedAt:"2026-11-04T11:00:00Z"}
} as unknown as RegistryProject;
const claim={
 featureId:"a",title:"A",lane:"mvp",weight:3,acceptanceCriteria:"tested",
 reportedStatus:"claimed_done",statusJournalSequence:11,verified:false,
 ciChecks:[],testClaim:"claimed_pass_current_head",testName:"smoke",
 testJournalSequence:12
} as ProjectMvpProgress["tasks"][number];
const progress={
 projectId:"my-project",planJournalSequence:10,planStatus:"imported_unverified",
 mvpTaskCount:2,sideTaskCount:0,totalWeight:5,reportedDoneWeight:3,
 reportedPercent:60,verifiedPercent:null,tasks:[claim,
  {...claim,featureId:"b",weight:2,reportedStatus:"claimed_pending"}],
 testsClaimedPass:1,testsClaimedFail:0,testsOutdated:0
} as ProjectMvpProgress;

test("weighted claimed percentage is reported, never considered feature-verified",()=>{
 const result=computeSmartProjectProgress40({project,progress,jobs:[],nowMs:now});
 assert.equal(result.reportedPercent,60);
 assert.equal(result.verifiedPercent,null);
 assert.equal(result.repoEvidence,"consistent");
 assert.equal(result.claimedTests.pass,1);
 assert.equal(result.forecast.status,"unavailable");
 if(result.forecast.status==="unavailable")assert.equal(result.forecast.reason,"no_verified_progress");
});
test("missing or forged roadmap denominator does not render invented completion",()=>{
 const missing=computeSmartProjectProgress40({project,progress:null,jobs:[],nowMs:now});
 assert.equal(missing.reportedPercent,null);
 assert.equal(missing.scope,"missing");
 const forged=computeSmartProjectProgress40({project,
  progress:{...progress,totalWeight:50},jobs:[],nowMs:now});
 assert.equal(forged.reportedPercent,null);
});
test("status docs and source of current work remain labelled as documentary evidence",()=>{
 const documented={...project,
  scan:{...project.scan!,docs:[
   {path:"PROJECT_STATUS_FLOW.md",kind:"status",modifiedAt:null,excluded:null},
   {path:"MEMORY.md",kind:"context",modifiedAt:null,excluded:null},
   {path:"HANDOFF.md",kind:"handoff",modifiedAt:null,excluded:null}
  ]},
  capsule:{currentWave:{text:"Stage 4.0 Agent Birth",basis:"documented"}}
 } as unknown as RegistryProject;
 const report=computeSmartProjectProgress40({project:documented,progress,jobs:[],nowMs:now});
 assert.equal(report.statusDocumentCount,2);
 assert.equal(report.documentedFocus,"Stage 4.0 Agent Birth");
 assert.equal(report.currentWaveSource,"documented");
 assert.equal(report.verifiedPercent,null);
});
test("repository success is not feature acceptance",()=>{
 const result=computeSmartProjectProgress40({project,progress,jobs:[],nowMs:now});
 assert.equal(result.repoEvidence,"consistent");
 assert.equal(result.verifiedPercent,null);
 assert.ok(result.sourceNotes.some(x=>x.includes("kein Feature-Test")));
});
test("uncommitted, mismatched or stale git evidence is not shown as consistent",()=>{
 const dirty={...project,scan:{...project.scan!,dirtyCount:2}} as RegistryProject;
 const conflict={...project,verification:{...project.verification!,headSha:sha("d")}} as RegistryProject;
 const old={...project,scan:{...project.scan!,scannedAt:"2026-10-01T11:00:00Z"}} as RegistryProject;
 for(const [p,state] of [[dirty,"dirty"],[conflict,"conflict"],[old,"stale"]] as const){
  assert.equal(computeSmartProjectProgress40({project:p,progress,jobs:[],nowMs:now}).repoEvidence,state);
 }
});
test("only exact project jobs are shown, stale worker calls never imply current activity",()=>{
 const jobs=[
  {id:"current",projectId:"my-project",status:"running",owner:"codex",phase:"verify",
   task:"GitHub PR prüfen",lastActivityAt:"2026-11-04T11:59:00Z"},
  {id:"stale",projectId:"my-project",status:"running",owner:"local",phase:"execute",
   task:"Background analysis",lastActivityAt:"2026-10-25T00:00:00Z"},
  {id:"other",projectId:"other-project",status:"running",owner:"claude",phase:"execute",
   task:"Ignore"}] as AgentJob[];
 const result=computeSmartProjectProgress40({project,progress,jobs,nowMs:now});
 assert.deepEqual(result.activeJobs.map(j=>j.jobId),["current","stale"]);
 assert.deepEqual(result.activeJobs.map(j=>j.fresh),[true,false]);
});
test("roadmap blocker and open findings keep forecast suppressed",()=>{
 const blockedProgress={...progress,verifiedPercent:65,
  tasks:[{...claim,reportedStatus:"claimed_blocked"},progress.tasks[1]]};
 const result=computeSmartProjectProgress40({project,progress:blockedProgress,
  jobs:[],acceptedMilestones:samples,nowMs:now});
 assert.equal(result.roadmapBlockers,1);
 assert.deepEqual(result.forecast,{status:"unavailable",reason:"blocked"});
});
test("forecast requires multiple separately owner-accepted, CI verified milestones",()=>{
 assert.deepEqual(runForecast([]),{status:"unavailable",reason:"insufficient_history"});
 assert.deepEqual(runForecast(samples.slice(0,2)),{status:"unavailable",reason:"insufficient_history"});
 assert.deepEqual(runForecast(samples.map((s,i)=>i===1?{...s,ownerApproved:false}:s) as AcceptedMilestone40[]),
  {status:"unavailable",reason:"scope_changed"});
 assert.deepEqual(runForecast(samples.map((s,i)=>i===1?{...s,ciVerified:false}:s) as AcceptedMilestone40[]),
  {status:"unavailable",reason:"scope_changed"});
});
test("accepted evidence forecasts a bounded range, never a fake exact date",()=>{
 const result=runForecast();
 assert.equal(result.status,"range");
 if(result.status!=="range")return;
 assert.ok(result.earliest>="2026-11-05");
 assert.ok(result.latest>=result.earliest);
 assert.equal(result.confidence,"low");
 assert.equal(result.samples,3);
 assert.equal(result.assumedUninterruptedWork,true);
});
test("changed scope/head and outdated acceptance suppress forecasts",()=>{
 assert.deepEqual(runForecast(samples,{planJournalSequence:11}),
  {status:"unavailable",reason:"scope_changed"});
 assert.deepEqual(runForecast(samples,{verifiedPercent:90}),
  {status:"unavailable",reason:"scope_changed"});
 const old=samples.map(s=>({...s,at:s.at.replace("2026-11-01","2026-10-20")}));
 assert.deepEqual(runForecast(old),{status:"unavailable",reason:"history_outdated"});
});
test("duplicate heads, percentage regressions and too-fast samples are unreliable",()=>{
 assert.deepEqual(runForecast(samples.map((s,i)=>i===1?{...s,headSha:sha("a")}:s)),
  {status:"unavailable",reason:"rate_unreliable"});
 assert.deepEqual(runForecast(samples.map((s,i)=>i===1?{...s,verifiedPercent:10}:s)),
  {status:"unavailable",reason:"rate_unreliable"});
 assert.deepEqual(runForecast(samples.map((s,i)=>i===1?{...s,at:"2026-10-01T12:00:00Z"}:s)),
  {status:"unavailable",reason:"rate_unreliable"});
});
test("blocking or insufficient velocity prevents ETA even after many commits",()=>{
 assert.deepEqual(runForecast(samples,{blocked:true}),{status:"unavailable",reason:"blocked"});
 const flat=[milestone("2026-10-01T12:00:00Z",50,"a"),
  milestone("2026-10-20T12:00:00Z",50,"b"),
  milestone("2026-11-01T12:00:00Z",65,"c")];
 assert.deepEqual(runForecast(flat),{status:"unavailable",reason:"insufficient_history"});
});
test("real UI is connected to the project portfolio and its canonical active jobs",()=>{
 const portfolio=read("src/components/ProjectMvpPortfolio.tsx");
 const cockpit=read("src/components/AgentSyncWorkspace.tsx");
 const ui=read("src/components/ProjectProgressIntelligence40.tsx");
 assert.ok(cockpit.includes("jobs={vm.agentSync.jobs}"));
 assert.ok(portfolio.includes("ProjectProgressIntelligence40"));
 assert.ok(ui.includes('continuity_mvp_progress'));
 assert.ok(ui.includes("gemeldeter Fortschritt"));
 assert.ok(ui.includes("Unabhängig abgenommen"));
 assert.ok(ui.includes("Voraussichtlicher Abschluss"));
 assert.ok(ui.includes("nicht live bestätigt"));
 assert.ok(ui.includes("forecast.status"));
});
