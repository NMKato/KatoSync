// Created by NMKato Solutions
// OPTIONAL GitHub project kickoff. Preview only: no network, repo or issue creation.
import type {ContinuityBlueprintPreview} from "./continuityBlueprint.ts";
import {redactSecrets} from "./projectExclusions.ts";

export type KickoffScope="product"|"feature";
export type KickoffLane="mvp"|"side";
export interface KickoffInput {
 title:string;intent:string;scope:KickoffScope;githubEnabled:boolean;
 existingRepository?:string|null;
 blueprint?:Pick<ContinuityBlueprintPreview,"projectId"|"blueprintId"|"mvpScope"|"decisions"|"nextSteps">|null;
}
export interface KickoffTicket{
 featureId:string;title:string;lane:KickoffLane;weight:number;status:"Backlog";
 acceptanceCriteria:string;issueBody:string;
}
export interface KickoffPreview{
 schema:"katosync.project-kickoff-preview/v1";
 title:string;scope:KickoffScope;
 mode:"local_only"|"reuse_repository"|"propose_private_repository"|"needs_repository_selection";
 githubEnabled:boolean;existingRepository:string|null;repositoryProposal:string|null;
 board:"none"|"reuse_or_propose_one_board"|"after_repository_selection";
 visibility:"not_applicable"|"private_proposed"|"existing_unverified";
 statuses:readonly ["Backlog","Ready","In Progress","In Review","Done","Blocked"];
 tickets:KickoffTicket[];remainingTasksNotIncluded:number;
 setupChecklist:readonly string[];
 approvalRequired:true;remoteWritesPerformed:false;instructionsAreUntrusted:true;
 agentStartupPolicy:{planOnly:true;reuseBeforeCreate:true;defaultPrivate:true;
  publicSharingRequiresApproval:true;remoteWritesRequireApproval:true;
  mustVerifyCiBeforeClosing:true;};
}
const STATUSES=["Backlog","Ready","In Progress","In Review","Done","Blocked"] as const;
const REPO=/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;
const FEATURE=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/;
const MAX_TICKETS=12;
function cleanText(value:string,max:number):string{
 if(typeof value!=="string")throw new Error("invalid_text");
 return redactSecrets(value.trim().replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ")).slice(0,max);
}
function repoName(title:string):string{
 const out=title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,70).replace(/-+$/,"");
 return out||"new-project";
}
function uniqueId(value:string,seen:Set<string>,fallback:string):string{
 let key=value.replace(/[^a-zA-Z0-9._:-]/g,"-").replace(/^-+/,"").slice(0,78);
 if(!FEATURE.test(key))key=fallback;
 if(!seen.has(key)){seen.add(key);return key;}
 let n=2;
 while(seen.has(key.slice(0,74)+"-"+n))n++;
 key=key.slice(0,74)+"-"+n;seen.add(key);return key;
}
function makeTicket(id:string,title:string,lane:KickoffLane,weight:number,criteria:string,project:string):KickoffTicket{
 const name=cleanText(title,150)||"Untitled item";
 const acceptance=cleanText(criteria,400)||"Review measurable acceptance criteria";
 const featureId=cleanText(id,80);
 const body=[
  "**Project:** "+cleanText(project,120),
  "**Feature ID:** "+featureId,
  "**Track:** "+lane.toUpperCase(),
  "**MVP weight:** "+weight,
  "**Status:** Backlog (proposal only)",
  "**Acceptance criteria:** "+acceptance,
  "",
  "- [ ] Review scope and requirements",
  "- [ ] Implement using a linked pull request",
  "- [ ] Run feature-specific tests and CI",
  "- [ ] Obtain review before closure",
  "",
  "KatoSync proposal: review every field before publication. No issue created."
 ].join("\n");
 return {featureId,title:name,lane,weight,status:"Backlog",acceptanceCriteria:acceptance,issueBody:body};
}
export function buildProjectKickoff(input:KickoffInput):KickoffPreview{
 const title=cleanText(input.title,120);
 const intent=cleanText(input.intent,700);
 if(!title)throw new Error("project_title_required");
 if(input.scope!=="product"&&input.scope!=="feature")throw new Error("invalid_scope");
 const existing=input.existingRepository?.trim()||null;
 if(input.githubEnabled&&existing&&!REPO.test(existing))throw new Error("invalid_repository");
 const blueprint=input.blueprint;
 if(blueprint&&typeof blueprint.projectId!=="string")throw new Error("invalid_blueprint");
 const raw:{id:string;title:string;lane:KickoffLane;weight:number;criteria:string}[]=[];
 if(blueprint?.mvpScope?.length){
  for(const item of blueprint.mvpScope.slice(0,24))
   raw.push({id:item.featureId,title:item.title,lane:item.lane,weight:item.weight,criteria:item.acceptanceCriteria});
 }else if(blueprint?.decisions?.length){
  for(const item of blueprint.decisions.slice(0,16))
   raw.push({id:item.id,title:item.title,lane:"mvp",weight:1,criteria:"Review architecture choice: "+item.choice});
 }else if(blueprint?.nextSteps?.length){
  blueprint.nextSteps.slice(0,12).forEach((step,i)=>
   raw.push({id:"STEP-"+(i+1),title:step,lane:"mvp",weight:1,
    criteria:"Define measurable acceptance criteria and verify the result"}));
 }else{
  raw.push(
   {id:"SCOPE",title:"Confirm MVP scope and acceptance criteria",lane:"mvp",weight:1,
    criteria:intent?"Confirm the project objective: "+intent:"Document objective and acceptance criteria"},
   {id:"FOUNDATION",title:"Establish versioning and baseline",lane:"mvp",weight:1,
    criteria:"Review local project baseline; GitHub optional"},
   {id:"QA",title:"Plan tests, review and release blockers",lane:"mvp",weight:1,
    criteria:"Define feature tests, security and owner review"}
  );
 }
 const seen=new Set<string>();
 if(blueprint && new Set(raw.map(item=>item.id)).size!==raw.length)throw new Error("duplicate_feature_id");
 const tickets=raw.slice(0,MAX_TICKETS).map((item,i)=>makeTicket(
  uniqueId(item.id,seen,"TASK-"+(i+1)),item.title,item.lane,item.weight,item.criteria,title));
 const enabled=input.githubEnabled===true;
 const mode:KickoffPreview["mode"]=!enabled?"local_only":existing?"reuse_repository":
  input.scope==="feature"?"needs_repository_selection":"propose_private_repository";
 return {
  schema:"katosync.project-kickoff-preview/v1",title,scope:input.scope,mode,
  githubEnabled:enabled,existingRepository:enabled?existing:null,
  repositoryProposal:enabled&&mode==="propose_private_repository"?repoName(title):null,
  board:!enabled?"none":mode==="needs_repository_selection"?"after_repository_selection":"reuse_or_propose_one_board",
  visibility:!enabled?"not_applicable":existing?"existing_unverified":"private_proposed",statuses:STATUSES,tickets,
  remainingTasksNotIncluded:Math.max(0,raw.length-tickets.length),
  setupChecklist:enabled?["review_blueprint","verify_repository","check_privacy","reuse_or_create_board","review_issues","define_ci","owner_approval"]:
    ["review_blueprint","local_baseline","local_task_queue","define_ci"],
  approvalRequired:true,remoteWritesPerformed:false,instructionsAreUntrusted:true,
  agentStartupPolicy:{planOnly:true,reuseBeforeCreate:true,defaultPrivate:true,
    publicSharingRequiresApproval:true,remoteWritesRequireApproval:true,
    mustVerifyCiBeforeClosing:true}
 };
}
