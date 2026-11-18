// Created by NMKato Solutions
import assert from "node:assert/strict";
import {test} from "node:test";
import {buildProjectKickoff} from "../src/lib/projectKickoff.ts";

const base={title:"Family World",intent:"Private family memories",scope:"product" as const,githubEnabled:false};

test("GitHub is OFF by default and local kickoff never implies remote writes",()=>{
 const p=buildProjectKickoff(base);
 assert.equal(p.mode,"local_only");
 assert.equal(p.board,"none");
 assert.equal(p.repositoryProposal,null);
 assert.equal(p.visibility,"not_applicable");
 assert.equal(p.githubEnabled,false);
 assert.equal(p.tickets.length,3);
 assert.equal(p.approvalRequired,true);
 assert.equal(p.remoteWritesPerformed,false);
 assert.equal(p.agentStartupPolicy.planOnly,true);
 assert.equal(p.agentStartupPolicy.remoteWritesRequireApproval,true);
 assert.equal(p.tickets[0].status,"Backlog");
 assert.equal(p.setupChecklist.includes("local_task_queue"),true);
});

test("opt-in product proposes private repo and one board, without provisioning",()=>{
 const p=buildProjectKickoff({...base,githubEnabled:true});
 assert.equal(p.mode,"propose_private_repository");
 assert.equal(p.repositoryProposal,"family-world");
 assert.equal(p.visibility,"private_proposed");
 assert.equal(p.board,"reuse_or_propose_one_board");
 assert.equal(p.remoteWritesPerformed,false);
 assert.equal(p.setupChecklist.includes("owner_approval"),true);
});

test("existing repo is reused for a feature, never cloned into one repo per feature",()=>{
 const p=buildProjectKickoff({...base,scope:"feature",githubEnabled:true,existingRepository:"NMKato/GENXLine"});
 assert.equal(p.mode,"reuse_repository");
 assert.equal(p.existingRepository,"NMKato/GENXLine");
 assert.equal(p.repositoryProposal,null);
 assert.equal(p.visibility,"existing_unverified");
});

test("a feature without a repo needs selection, and no public repo is assumed",()=>{
 const p=buildProjectKickoff({...base,scope:"feature",githubEnabled:true});
 assert.equal(p.mode,"needs_repository_selection");
 assert.equal(p.board,"after_repository_selection");
 assert.equal(p.repositoryProposal,null);
 assert.equal(p.approvalRequired,true);
});

test("Blueprint MVP scope becomes bounded stable issues with feature ID and acceptance",()=>{
 const scope=Array.from({length:16},(_,i)=>({
  featureId:"F-"+(i+1),title:"Feature "+(i+1),lane:i%2===0?"mvp" as const:"side" as const,
  weight:i%5+1,acceptanceCriteria:"Acceptance #"+(i+1),ciChecks:[]
 }));
 const p=buildProjectKickoff({...base,githubEnabled:true,
  blueprint:{projectId:"alpha",blueprintId:"plan",mvpScope:scope,nextSteps:[],decisions:[]}});
 assert.equal(p.tickets.length,12);
 assert.equal(p.remainingTasksNotIncluded,4);
 assert.equal(p.tickets[0].featureId,"F-1");
 assert.equal(p.tickets[0].weight,1);
 assert.equal(p.tickets[1].lane,"side");
 assert.match(p.tickets[0].issueBody,/No issue created/);
 assert.match(p.tickets[0].issueBody,/Feature ID/);
 assert.equal(p.remoteWritesPerformed,false);
});

test("Blueprint decision fallback and no fabricated approvals",()=>{
 const p=buildProjectKickoff({...base,blueprint:{
  projectId:"alpha",blueprintId:"plan",mvpScope:[],nextSteps:[],
  decisions:[{id:"ADR-10",title:"Choose one worker",choice:"Local first",rationale:"Cost",
    alternatives:[],consequences:[],evidence:[],status:"proposed"}]
 }});
 assert.deepEqual(p.tickets.map(t=>t.featureId),["ADR-10"]);
 assert.match(p.tickets[0].acceptanceCriteria,/Local first/);
 assert.equal(p.approvalRequired,true);
});

test("rejects bad owner/repo, empty title, duplicates and impossible workflow scope",()=>{
 for(const existingRepository of [
  "https://evil.example/o/r","o/r/extra","o/r?x=1","../secret","o/r@bad"
 ])assert.throws(()=>buildProjectKickoff({...base,githubEnabled:true,existingRepository}));
 assert.equal(buildProjectKickoff({...base,existingRepository:"NOT A VALID REPO",githubEnabled:false}).mode,"local_only");
 assert.throws(()=>buildProjectKickoff({...base,title:"  "}));
 assert.throws(()=>buildProjectKickoff({...base,scope:"invalid" as "product"}));
 const feature={featureId:"F-1",title:"A",lane:"mvp" as const,weight:1,
  acceptanceCriteria:"Review",ciChecks:[]};
 assert.throws(()=>buildProjectKickoff({...base,blueprint:{
   projectId:"alpha",blueprintId:"plan",mvpScope:[feature,feature],
   nextSteps:[],decisions:[]
 }}),/duplicate_feature_id/);
});
