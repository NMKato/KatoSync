// NMKato Solutions — KatoSync 4.0: evidence-grounded project progress and forecast.
// IMPORTANT: Repository activity is evidence of activity, never proof of completion.
// A reported roadmap percentage and a verified/owner-accepted percentage NEVER mix.
import type {AgentJob, RegistryProject} from "../types.ts";
import type {ProjectMvpProgress, MvpScopeTask} from "../components/ProjectMvpIndicator.tsx";

const DAY_MS=86_400_000;
const JOB_FRESH_MS=180_000;
const SCAN_FRESH_MS=48*60*60*1000;
const MAX_FUTURE_DAYS=365;

export interface AcceptedMilestone40 {
  projectId:string;
  planJournalSequence:number;
  // This value is produced only after feature-level tests + owner acceptance.
  verifiedPercent:number;
  at:string;
  headSha:string;
  evidenceReceipt:string;
  ownerApproved:true;
  ciVerified:true;
}
export type ForecastResult40 =
  | {status:"unavailable";reason:"no_verified_progress"|"insufficient_history"|
      "history_outdated"|"blocked"|"scope_changed"|"rate_unreliable"|"already_complete"}
  | {status:"range";earliest:string;latest:string;confidence:"low"|"medium";samples:number;
      measuredDays:number;assumedUninterruptedWork:boolean};
export interface ActiveProjectJob40 {
  jobId:string;
  owner:AgentJob["owner"];
  phase:string;
  status:AgentJob["status"];
  title:string;
  fresh:boolean;
  updatedAt:string|null;
}
export type RepoEvidence40="consistent"|"stale"|"dirty"|"conflict"|"unknown";
export interface SmartProjectProgress40 {
  projectId:string;
  scope:"configured"|"missing";
  reportedPercent:number|null;
  verifiedPercent:number|null;
  repoEvidence:RepoEvidence40;
  repoHead:string|null;
  repoBranch:string|null;
  openTaskCount:number;
  nextRoadmapMilestones:Array<{id:string;title:string;reportedStatus:string}>;
  nextSafeActions:string[];
  roadmapBlockers:number;
  repositoryFindings:number;
  statusDocumentCount:number;
  documentedFocus:string|null;
  currentWaveSource:"documented"|"code_truth"|"none";
  claimedTests:{pass:number;fail:number;stale:number};
  activeJobs:ActiveProjectJob40[];
  forecast:ForecastResult40;
  sourceNotes:string[];
}

function asDay(value:string):number|null{
  const ms=Date.parse(value);
  return Number.isFinite(ms)?ms:null;
}
function safePct(value:number|null|undefined):value is number{
  return typeof value==="number"&&Number.isInteger(value)&&value>=0&&value<=100;
}
function shaValid(value:string):boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
}
function weightedClaims(tasks:MvpScopeTask[]):{total:number;done:number;open:number;blocked:number}{
  const considered=tasks.filter(t=>t.lane==="mvp");
  const total=considered.reduce((sum,t)=>sum+t.weight,0);
  const done=considered.filter(t=>t.reportedStatus==="claimed_done")
    .reduce((sum,t)=>sum+t.weight,0);
  const open=considered.filter(t=>t.reportedStatus!=="claimed_done").length;
  const blocked=considered.filter(t=>t.reportedStatus==="claimed_blocked").length;
  return {total,done,open,blocked};
}

export function forecastAcceptedRoadmap40(input:{
  projectId:string;
  planJournalSequence:number|null;
  verifiedPercent:number|null;
  milestones:readonly AcceptedMilestone40[];
  nowMs:number;
  blocked:boolean;
}):ForecastResult40{
  const unavailable=(reason:Extract<ForecastResult40,{status:"unavailable"}>["reason"]):ForecastResult40=>
    ({status:"unavailable",reason});
  const {projectId,planJournalSequence,verifiedPercent,milestones,nowMs,blocked}=input;
  if(blocked)return unavailable("blocked");
  if(!safePct(verifiedPercent)||!planJournalSequence||!Number.isFinite(nowMs))return unavailable("no_verified_progress");
  if(verifiedPercent===100)return unavailable("already_complete");
  // Only an immutable owner+CI-approved accepted milestone can establish velocity.
  // No synthetic data and no conversion from claimed checkpoint or commit counts.
  if(milestones.length<3)return unavailable("insufficient_history");
  if(milestones.some(m=>m.projectId!==projectId||
    m.planJournalSequence!==planJournalSequence||
    !m.ownerApproved||!m.ciVerified||!safePct(m.verifiedPercent)||
    !shaValid(m.headSha)||!/^\S{12,256}$/.test(m.evidenceReceipt)||
    asDay(m.at)===null)){
    return unavailable("scope_changed");
  }
  const points=milestones.map(m=>({...m,ms:asDay(m.at)!}))
    .sort((a,b)=>a.ms-b.ms);
  const seenHeads=new Set<string>();
  for(const point of points){
    const head=point.headSha.toLowerCase();
    if(seenHeads.has(head))return unavailable("rate_unreliable");
    seenHeads.add(head);
    if(point.ms>nowMs||point.ms<=0)return unavailable("rate_unreliable");
  }
  const latest=points[points.length-1];
  if(latest.verifiedPercent!==verifiedPercent)return unavailable("scope_changed");
  if(nowMs-latest.ms>7*DAY_MS)return unavailable("history_outdated");
  const totalDays=(latest.ms-points[0].ms)/DAY_MS;
  if(totalDays<7)return unavailable("insufficient_history");
  const velocities:number[]=[];
  for(let i=1;i<points.length;i++){
    const previous=points[i-1];
    const current=points[i];
    const delta=current.verifiedPercent-previous.verifiedPercent;
    const days=(current.ms-previous.ms)/DAY_MS;
    if(delta<0||days<1)return unavailable("rate_unreliable");
    if(delta>0)velocities.push(delta/days);
  }
  if(velocities.length<2)return unavailable("insufficient_history");
  const rates=[...velocities].sort((a,b)=>a-b);
  const slow=Math.max(.01,rates[0]*.65);
  const fast=Math.min(25,rates[rates.length-1]*1.2);
  const remaining=100-verifiedPercent;
  const earlyDays=Math.ceil(remaining/fast);
  const lateDays=Math.ceil(remaining/slow);
  if(earlyDays>MAX_FUTURE_DAYS||lateDays>MAX_FUTURE_DAYS||
    earlyDays<1||lateDays<earlyDays)return unavailable("rate_unreliable");
  const isoDay=(offsetDays:number)=>new Date(nowMs+offsetDays*DAY_MS)
    .toISOString().slice(0,10);
  return {
    status:"range",
    earliest:isoDay(earlyDays),
    latest:isoDay(lateDays),
    confidence:points.length>=5&&totalDays>=21?"medium":"low",
    samples:points.length,
    measuredDays:Math.floor(totalDays),
    assumedUninterruptedWork:true
  };
}

export function computeSmartProjectProgress40(input:{
  project:RegistryProject;
  progress:ProjectMvpProgress|null;
  jobs:readonly AgentJob[];
  acceptedMilestones?:readonly AcceptedMilestone40[];
  nowMs:number;
}):SmartProjectProgress40{
  const {project,progress,jobs,nowMs}=input;
  const verifiedPercent=progress&&safePct(progress.verifiedPercent)?progress.verifiedPercent:null;
  const claimed=progress&&safePct(progress.reportedPercent)?progress.reportedPercent:null;
  const scope=progress?.planStatus==="imported_unverified"&&
    progress.mvpTaskCount>0&&claimed!==null?"configured":"missing";
  const counts=progress?weightedClaims(progress.tasks):{total:0,done:0,open:0,blocked:0};
  // A forged/old plan, or changed roadmap task weights, invalidates reported bar.
  const honestReported=scope==="configured"&&counts.total===progress?.totalWeight&&
    counts.done===progress.reportedDoneWeight&&
    Math.floor(100*counts.done/Math.max(1,counts.total))===claimed?claimed:null;

  const scan=project.scan;
  const verification=project.verification;
  const scannedMs=scan?asDay(scan.scannedAt):null;
  let repoEvidence:RepoEvidence40="unknown";
  if(scan){
    if(scan.dirtyCount>0)repoEvidence="dirty";
    else if(!scan.headSha||!verification?.headSha||
      scan.headSha!==verification.headSha)repoEvidence="conflict";
    else if(scannedMs===null||scannedMs>nowMs||
      nowMs-scannedMs>SCAN_FRESH_MS||verification.state==="status_stale")repoEvidence="stale";
    else if(verification.state==="verified"&&shaValid(scan.headSha))repoEvidence="consistent";
    else repoEvidence="unknown";
  }
  const activeJobs:ActiveProjectJob40[]=jobs.filter(j=>j.projectId===project.id&&
      ["running","verifying","blocked","human_gate","review_ready"].includes(j.status))
    .sort((a,b)=>(asDay(b.lastActivityAt??"")??0)-(asDay(a.lastActivityAt??"")??0))
    .slice(0,5).map(job=>{
      const at=asDay(job.lastActivityAt??"");
      const fresh=at!==null&&at<=nowMs&&nowMs-at<=JOB_FRESH_MS;
      return {jobId:job.id,owner:job.owner,phase:job.phase,
        status:job.status,title:job.task.slice(0,100),fresh,
        updatedAt:job.lastActivityAt??null};
    });

  const repositoryFindings=verification?.findings.filter(f=>
    !f.resolved&&(f.severity==="danger"||f.severity==="warn")).length??0;
  const roadmapBlockers=counts.blocked;
  const blocked=repositoryFindings>0||roadmapBlockers>0||
    jobs.some(j=>j.projectId===project.id&&j.status==="blocked");
  const forecast=forecastAcceptedRoadmap40({
    projectId:project.id,
    planJournalSequence:progress?.planJournalSequence??null,
    verifiedPercent,
    milestones:input.acceptedMilestones??[],
    nowMs,
    blocked
  });
  const statusDocumentCount=scan?.docs?.filter(doc=>
    doc.excluded===null&&(doc.kind==="status"||doc.kind==="handoff")).length??0;
  const nextRoadmapMilestones=(progress?.tasks??[])
    .filter(task=>task.lane==="mvp"&&task.reportedStatus!=="claimed_done")
    .slice(0,3).map(task=>({id:task.featureId,title:task.title,reportedStatus:task.reportedStatus}));
  const nextSafeActions=(project.capsule?.nextSafeWork??[]).slice(0,3).map(x=>x.slice(0,160));
  const documentedFocus=project.capsule?.currentWave.text?.slice(0,160)??null;
  const currentWaveSource=project.capsule?.currentWave.basis??"none";
  return{
    projectId:project.id,scope,
    reportedPercent:honestReported,verifiedPercent,
    repoEvidence,repoHead:scan?.headSha??null,repoBranch:scan?.branch??null,
    openTaskCount:counts.open,nextRoadmapMilestones,nextSafeActions,roadmapBlockers,repositoryFindings,
    statusDocumentCount,documentedFocus,currentWaveSource,
    claimedTests:{
      pass:progress?.testsClaimedPass??0,
      fail:progress?.testsClaimedFail??0,
      stale:progress?.testsOutdated??0
    },
    activeJobs,forecast,
    sourceNotes:[
      "Roadmap: expliziter MVP-Scope und gewichtete gemeldete Checkpoints (kein Feature-Beweis)",
      "Statusdateien: nur im Projekt-Scan erfasste Status-/Handoff-Dokumente und dokumentierter Arbeitsfokus",
      "Repository: Scan, HEAD, Arbeitsbaum und dokumentierte Prüfkonflikte (kein Feature-Test)",
      "GitHub-CI: separate authentifizierte Nachweisprüfung in diesem Projektdossier; allgemeine grüne Tests sind keine Feature-Abnahme",
      "Arbeit: kanonischer Jobstatus mit zeitlich geprüfter Aktivität",
      "Prognose nur aus drei oder mehr unabhängigen owner- und CI-bestätigten historischen Abnahmen"
    ]
  };
}
