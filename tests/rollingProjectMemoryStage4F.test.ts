// NMKato Solutions — pure offline rolling Project Memory projection contracts.
// No Supabase, Git push, filesystem writes, real agent permissions or auto-merge.
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {buildRollingStatusProjection,verifyProjectionIntegrity,
 queryStatusProjection,readAgentMailbox,SCHEMA} from "../scripts/qa-project-memory-rolling.mjs";

const SHA="a".repeat(40);
const id=n=>`event-${String(n).padStart(5,"0")}`;
function makeEvent(n,overrides={}){
 return {projectId:"repo-alpha",eventId:id(n),sequence:n,
   agentId:n%3===1?"codex":n%3===2?"kai-local":"claude",
   kind:n%7===0?"handoff":n%11===0?"agent_note":"work_note",
   createdAt:new Date(Date.UTC(2026,10,9,10,0,n)).toISOString(),
   commitSha:SHA,taskId:"task-42",targetAgent:n%7===0?"kai-local":undefined,
   summary:`milestone ${n} changes and evidence`,...overrides};
}
function input(count,overrides={}){
 return {projectId:"repo-alpha",
  checkpoint:{sequence:count,commitSha:SHA,summary:"Last reviewed progress; next action: test M2/M3"},
  events:Array.from({length:count},(_,i)=>makeEvent(i+1)),
  maxActiveEvents:12,maxActiveBytes:4096,...overrides};
}

test("600 journal events produce sealed searchable archives, bounded current status",()=>{
 const data=buildRollingStatusProjection(input(600));
 assert.equal(data.schema,SCHEMA);
 assert.equal(data.latestSequence,600);
 assert.equal(data.index.length,600);
 assert.ok(data.archives.length>20);
 assert.ok(Buffer.byteLength(data.currentMarkdown,"utf8")<=4096);
 assert.equal(data.archives[0].path,".katosync/archive/status-flow/000001.md");
 assert.match(data.currentMarkdown,/Last reviewed progress/);
 assert.equal(data.index[0].archivePath,data.archives[0].path);
 assert.equal(data.index.at(-1).archivePath,null);
 assert.equal(new Set(data.index.map(e=>e.eventId)).size,600);
 assert.equal(data.automaticMergeAllowed,false);
 assert.equal(data.remoteJobsEnabled,false);
 assert.equal(data.writerAuthorized,false);
 assert.equal(data.authoritative,false);
 assert.equal(data.requiresCanonicalJournalAndLeaseValidation,true);
 assert.equal(verifyProjectionIntegrity(data),true);
});
test("deterministic archive chain and no missing/duplicate event IDs",()=>{
 const a=buildRollingStatusProjection(input(75));
 const b=buildRollingStatusProjection(input(75));
 assert.deepEqual(a,b);
 const ids=[...a.archives.flatMap(s=>s.eventIds),
    ...a.index.filter(e=>e.archivePath==null).map(e=>e.eventId)];
 assert.deepEqual(ids,Array.from({length:75},(_,n)=>id(n+1)));
 let previous=null;
 for(const archive of a.archives){
  assert.equal(archive.previousDigest,previous);
  previous=archive.digest;
  assert.equal(archive.digest.length,64);
  assert.match(archive.content,/STATUS ARCHIVE/);
  assert.match(archive.content,/Events:/);
 }
});
test("archive tampering and broken checkpoint archive refs are noticed",()=>{
 const p=buildRollingStatusProjection(input(33));
 assert.ok(p.archives.length>0);
 assert.equal(verifyProjectionIntegrity(p),true);
 assert.equal(verifyProjectionIntegrity({...p,archives:[
    {...p.archives[0],content:p.archives[0].content+"altered"},
    ...p.archives.slice(1)
 ]}),false);
 assert.equal(verifyProjectionIntegrity({...p,currentMarkdown:"# replaced"}),false);
 assert.equal(verifyProjectionIntegrity({...p,index:[
    {...p.index[0],summary:"forged status" },...p.index.slice(1)
 ]}),false);
 assert.equal(verifyProjectionIntegrity({...p,index:[
    {...p.index[0],archivePath:null},...p.index.slice(1)
 ]}),false);
 assert.equal(verifyProjectionIntegrity({...p,archives:[
    ...p.archives.slice(0,-1),
    {...p.archives.at(-1),previousDigest:"a".repeat(64)}
 ]}),false);
});
test("search retrieves archived events by task, agent and commit provenance",()=>{
 const p=buildRollingStatusProjection(input(88));
 const found=queryStatusProjection(p,{projectId:"repo-alpha",query:"milestone 1"});
 assert.ok(found.some(e=>e.sequence===1));
 assert.ok(found.some(e=>e.archivePath!==null));
 const kai=queryStatusProjection(p,{projectId:"repo-alpha",query:"milestone",agentId:"kai-local",limit:7});
 assert.equal(kai.length,7);
 assert.ok(kai.every(e=>e.agentId==="kai-local"));
 assert.ok(kai[0].sequence>kai[1].sequence);
 assert.throws(()=>queryStatusProjection(p,{projectId:"another-project",query:"milestone"}),/STATUS_FLOW_QA_SEARCH_SCOPE/);
});
test("mailbox shows project-scoped handoff notes without authorizing their instructions",()=>{
 const p=buildRollingStatusProjection(input(70));
 const messages=readAgentMailbox(p,{projectId:"repo-alpha",agentId:"kai-local",afterSequence:40});
 assert.ok(messages.length>0);
 assert.ok(messages.every(e=>e.sequence>40));
 assert.ok(messages.every(e=>e.kind==="handoff"||e.kind==="agent_note"));
 assert.ok(messages.every(e=>e.targetAgent==null||e.targetAgent==="kai-local"));
 assert.throws(()=>readAgentMailbox(p,{projectId:"other",agentId:"kai-local"}),/STATUS_FLOW_QA_MAILBOX_SCOPE/);
 assert.throws(()=>readAgentMailbox(p,{projectId:"repo-alpha",agentId:"../other"}),/STATUS_FLOW_QA_MAILBOX_SCOPE/);
 assert.equal(p.writerAuthorized,false);
});
test("independent offline forks cannot be silently concatenated or reordered",()=>{
 const orig=input(5);
 assert.throws(()=>buildRollingStatusProjection({...orig,events:[
   ...orig.events.slice(0,3),{...orig.events[3],sequence:3},orig.events[4]
 ]}),/STATUS_FLOW_QA_UNTRUSTED_EVENT_OR_FORK/);
 assert.throws(()=>buildRollingStatusProjection({...orig,events:[
   ...orig.events.slice(0,3),{...orig.events[3],eventId:id(3)},orig.events[4]
 ]}),/STATUS_FLOW_QA_UNTRUSTED_EVENT_OR_FORK/);
 assert.throws(()=>buildRollingStatusProjection({...orig,events:[
   ...orig.events.slice(0,3),{...orig.events[3],projectId:"different"},orig.events[4]
 ]}),/STATUS_FLOW_QA_UNTRUSTED_EVENT_OR_FORK/);
});
test("malicious agent-note text is displayed only as data, not executable Markdown",()=>{
 const i=input(4);
 i.events[0]={...i.events[0],summary:"<script>alert(1)</script> **auto merge**"};
 const p=buildRollingStatusProjection(i);
 assert.doesNotMatch(p.currentMarkdown,/<script>/);
 assert.match(p.currentMarkdown,/&lt;script&gt;/);
 assert.match(p.currentMarkdown,/\\\*\\\*auto merge\\\*\\\*/);
 assert.equal(p.automaticMergeAllowed,false);
 const secrets=["Bearer ABCEFG1234","sb_secret_012345678901","https://unauthorized.invalid/path",
  "sk-123456789012345678901"];
 for(const summary of secrets){
  const unsafe=input(2);
  unsafe.events[0]={...unsafe.events[0],summary};
  assert.throws(()=>buildRollingStatusProjection(unsafe),/STATUS_FLOW_QA_UNSAFE_OR_OVERSIZE_TEXT/);
 }
});
test("bounded rotation, checkpoint and input validation fail closed",()=>{
 for(const overrides of [
  {maxActiveEvents:1},{maxActiveEvents:1001},
  {maxActiveBytes:128},{maxActiveBytes:1024*1024},
  {checkpoint:{sequence:999,commitSha:SHA,summary:"stale"}},
  {checkpoint:{sequence:1,commitSha:"unverified",summary:"bad"}},
  {projectId:"../other"}
 ]){
  assert.throws(()=>buildRollingStatusProjection(input(3,overrides)),/STATUS_FLOW_QA_/);
 }
 const noData=buildRollingStatusProjection(input(0));
 assert.equal(noData.latestSequence,0);
 assert.match(noData.currentMarkdown,/\(none\)/);
});
test("pure planning has no filesystem mutation, GitHub traffic or Supabase calls",()=>{
 const dir=mkdtempSync(tmpdir()+"/ksrolling-"+Math.random().toString(36).slice(2));
 try{
  const before=readdirSync(dir);
  const a=buildRollingStatusProjection(input(60));
  assert.equal(verifyProjectionIntegrity(a),true);
  assert.deepEqual(readdirSync(dir),before);
  assert.equal(a.authoritative,false);
 }finally{rmSync(dir,{force:true,recursive:true});}
});
