// NMKato Solutions — KatoSync 4.0, trust-gated feature-acceptance history.
// A JSON receipt or hash chain is not a proof. ONLY independently verified
// owner signatures, GitHub CI runs and Git ancestry can unlock these values.
// Never wire an untrusted browser/LLM callback as AcceptanceAuthority40.
import type {AcceptedMilestone40} from "./smartProjectProgress40.ts";

const MAX_RECEIPTS=512;
const SHA=/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;
const HASH=/^[a-f0-9]{64}$/i;
const MAX_FUTURE_CLOCK_SKEW_MS=60_000;

export interface AcceptanceScopeTask40 {
  featureId:string;
  lane:"mvp"|"side";
  weight:number;
  acceptanceCriteria:string;
  ciChecks:readonly {workflow:string;job:string}[];
}
export interface AcceptanceScope40 {
  projectId:string;
  planJournalSequence:number;
  tasks:readonly AcceptanceScopeTask40[];
}
export interface AcceptanceCiReceipt40 {
  workflow:string;
  job:string;
  runId:number;
  headSha:string;
}
export interface AcceptanceOwnerApproval40 {
  decisionId:string;
  signerKeyId:string;
  signature:string;
}
export interface AcceptanceSnapshot40 {
  schemaVersion:"katosync.feature-acceptance/v1";
  projectId:string;
  planJournalSequence:number;
  scopeDigest:string;
  headSha:string;
  acceptedAt:string;
  acceptedFeatureIds:string[];
  ci:AcceptanceCiReceipt40[];
  owner:AcceptanceOwnerApproval40;
  previousHash:string|null;
  hash:string;
}

/**
 * All three callbacks MUST be implemented by a native/server-side authority.
 * verifyOwnerSignature must cryptographically check the signed canonical
 * snapshot against a pinned owner's key, explicit decision and project scope.
 * verifyCi must query authenticated GitHub data for the exact workflow/job,
 * run ID, passing conclusion and immutable HEAD (not accept a client flag).
 * verifyDescendant must inspect real Git ancestry, not compare SHA strings.
 */
export interface AcceptanceAuthority40 {
  verifyOwnerSignature(snapshot:AcceptanceSnapshot40):Promise<boolean>;
  verifyCi(ci:AcceptanceCiReceipt40,snapshot:AcceptanceSnapshot40):Promise<boolean>;
  verifyDescendant(ancestorSha:string,descendantSha:string,projectId:string):Promise<boolean>;
}
export type LedgerFailure40=
  "invalid_scope"|"missing_ledger"|"malformed_receipt"|"wrong_plan_or_project"|
  "chain_broken"|"scope_changed"|"signature_unverified"|"ci_unverified"|"git_unverified"|
  "future_or_unordered"|"stale_head"|"regressed_features";
export type AcceptanceLedgerResult40=
  | {status:"unavailable";reason:LedgerFailure40;verifiedPercent:null;milestones:[]}
  | {status:"verified";verifiedPercent:number;milestones:AcceptedMilestone40[];
     acceptedFeatures:string[];latestHead:string;receiptCount:number};

function unavailable(reason:LedgerFailure40):AcceptanceLedgerResult40{
  return {status:"unavailable",reason,verifiedPercent:null,milestones:[]};
}
function validText(text:unknown,max=160):text is string{
  return typeof text==="string"&&text.length>0&&text.length<=max&&text.trim()===text;
}
function orderedUnique(items:readonly string[]):boolean{
  return items.every((item,i)=>validText(item,100)&&(i===0||items[i-1]<item));
}
function ciKey(ci:{workflow:string;job:string}):string{
  return JSON.stringify([ci.workflow,ci.job]);
}
function validScope(scope:AcceptanceScope40):boolean{
  if(!scope||!Array.isArray(scope.tasks)||!validText(scope.projectId)||
    !Number.isSafeInteger(scope.planJournalSequence)||scope.planJournalSequence<=0||
    scope.tasks.length===0||scope.tasks.length>24)return false;
  const featureIds=new Set<string>();
  let mvp=0;
  for(const task of scope.tasks){
    if(!task||!Array.isArray(task.ciChecks)||
       !validText(task.featureId,80)||featureIds.has(task.featureId)||
       !["mvp","side"].includes(task.lane)||!Number.isSafeInteger(task.weight)||
       task.weight<1||task.weight>5||!validText(task.acceptanceCriteria,400)||
       task.ciChecks.length>12)return false;
    featureIds.add(task.featureId);
    if(task.lane==="mvp")mvp++;
    const ci=new Set<string>();
    for(const check of task.ciChecks){
      if(!check||!validText(check.workflow,120)||!validText(check.job,120)||
         ci.has(ciKey(check)))return false;
      ci.add(ciKey(check));
    }
  }
  return mvp>0;
}
function isRecord(v:unknown):v is Record<string,unknown>{
  return v!==null&&typeof v==="object"&&!Array.isArray(v);
}
function shapeValid(snapshot:AcceptanceSnapshot40):boolean{
  if(!isRecord(snapshot)||snapshot.schemaVersion!=="katosync.feature-acceptance/v1"||
    !validText(snapshot.projectId)||!Number.isSafeInteger(snapshot.planJournalSequence)||
    !HASH.test(snapshot.scopeDigest)||!SHA.test(snapshot.headSha)||
    !validText(snapshot.acceptedAt,40)||
    !Array.isArray(snapshot.acceptedFeatureIds)||
    !orderedUnique(snapshot.acceptedFeatureIds)||snapshot.acceptedFeatureIds.length>24||
    !Array.isArray(snapshot.ci)||snapshot.ci.length>120||
    !isRecord(snapshot.owner)||!validText(snapshot.owner.decisionId)||
    !validText(snapshot.owner.signerKeyId)||
    !validText(snapshot.owner.signature,512)||
    (snapshot.previousHash!==null&&!HASH.test(snapshot.previousHash))||
    !HASH.test(snapshot.hash))return false;
  const seen=new Set<string>();
  for(const check of snapshot.ci){
    if(!isRecord(check)||!validText(check.workflow,120)||
       !validText(check.job,120)||!Number.isSafeInteger(check.runId)||
       check.runId<=0||!SHA.test(check.headSha)||
       seen.has(ciKey(check)))return false;
    seen.add(ciKey(check));
  }
  return true;
}

// A stable scope fingerprint catches changes to weight, CI or acceptance criteria
// even when an external plan journal sequence is accidentally reused.
export async function acceptanceScopeDigest40(scope:AcceptanceScope40):Promise<string>{
  // Ordinal UTF-16 ordering is stable across locales and can be reproduced by Rust.
  // localeCompare depends on machine locale and is unsafe for signed scope digests.
  const ordinal=(a:string,b:string)=>a===b?0:(a<b?-1:1);
  const tasks=[...scope.tasks].sort((a,b)=>ordinal(a.featureId,b.featureId))
    .map(t=>[t.featureId,t.lane,t.weight,t.acceptanceCriteria,
      [...t.ciChecks].map(c=>[c.workflow,c.job]).sort((a,b)=>
        ordinal(JSON.stringify(a),JSON.stringify(b)))]);
  const bytes=new TextEncoder().encode(JSON.stringify([
    "katosync-acceptance-scope/v1",scope.projectId,scope.planJournalSequence,tasks
  ]));
  const digest=await globalThis.crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}

// Exact bytes to sign and verify with a pinned owner Ed25519 public key.
// Signature and hash are intentionally EXCLUDED from the signing payload.
export function acceptanceOwnerSigningPayload40(receipt:Omit<AcceptanceSnapshot40,"hash">):Uint8Array{
  return new TextEncoder().encode("KatoSync feature-acceptance v1\n"+JSON.stringify([
    receipt.schemaVersion,receipt.projectId,receipt.planJournalSequence,
    receipt.scopeDigest,receipt.headSha,receipt.acceptedAt,
    receipt.acceptedFeatureIds,
    receipt.ci.map(c=>[c.workflow,c.job,c.runId,c.headSha]),
    receipt.owner.decisionId,receipt.owner.signerKeyId,receipt.previousHash
  ]));
}

// Explicit field selection makes digest independent of JS object insertion order.
// Hash chaining is only tamper-evidence; the external signature authority is essential.
export async function acceptanceReceiptDigest40(receipt:Omit<AcceptanceSnapshot40,"hash">):
  Promise<string>{
  const stable=JSON.stringify([
    receipt.schemaVersion,receipt.projectId,receipt.planJournalSequence,
    receipt.scopeDigest,receipt.headSha,receipt.acceptedAt,receipt.acceptedFeatureIds,
    receipt.ci.map(c=>[c.workflow,c.job,c.runId,c.headSha]),
    [receipt.owner.decisionId,receipt.owner.signerKeyId,receipt.owner.signature],
    receipt.previousHash
  ]);
  const bytes=new TextEncoder().encode(stable);
  const buffer=await globalThis.crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,"0")).join("");
}

/**
 * Fail-closed pure verification boundary. It does not store receipts and does
 * NOT authorize UI-reported completion until a real native/server authority
 * supplies the history and independently authenticates every evidence source.
 */
export async function verifyFeatureAcceptanceLedger40(input:{
  scope:AcceptanceScope40;
  currentHeadSha:string;
  snapshots:readonly AcceptanceSnapshot40[];
  authority:AcceptanceAuthority40;
  nowMs:number;
}):Promise<AcceptanceLedgerResult40>{
  const {scope,currentHeadSha,snapshots,authority,nowMs}=input;
  if(!validScope(scope)||!SHA.test(currentHeadSha)||!Number.isFinite(nowMs)||
    !authority||typeof authority.verifyOwnerSignature!=="function"||
    typeof authority.verifyCi!=="function"||
    typeof authority.verifyDescendant!=="function")return unavailable("invalid_scope");
  if(!Array.isArray(snapshots)||snapshots.length===0)return unavailable("missing_ledger");
  if(snapshots.length>MAX_RECEIPTS)return unavailable("malformed_receipt");
  const expectedScopeHash=await acceptanceScopeDigest40(scope);
  const tasks=new Map(scope.tasks.map(t=>[t.featureId,t]));
  const totalWeight=scope.tasks.filter(t=>t.lane==="mvp")
    .reduce((n,t)=>n+t.weight,0);
  const milestoneHistory:AcceptedMilestone40[]=[];
  let previous:AcceptanceSnapshot40|null=null;
  let previousAccepted=new Set<string>();
  const heads=new Set<string>();
  const ownerDecisions=new Set<string>();
  for(const snapshot of snapshots){
    if(!shapeValid(snapshot))return unavailable("malformed_receipt");
    if(snapshot.projectId!==scope.projectId||
       snapshot.planJournalSequence!==scope.planJournalSequence)
      return unavailable("wrong_plan_or_project");
    if(snapshot.scopeDigest.toLowerCase()!==expectedScopeHash)
      return unavailable("scope_changed");
    const ms=Date.parse(snapshot.acceptedAt);
    if(!Number.isFinite(ms)||new Date(ms).toISOString()!==snapshot.acceptedAt||
       ms>nowMs+MAX_FUTURE_CLOCK_SKEW_MS||
       (previous!==null&&ms<=Date.parse(previous.acceptedAt)))
      return unavailable("future_or_unordered");
    if(heads.has(snapshot.headSha.toLowerCase())||
       ownerDecisions.has(snapshot.owner.decisionId))
      return unavailable("malformed_receipt");
    heads.add(snapshot.headSha.toLowerCase());
    ownerDecisions.add(snapshot.owner.decisionId);
    if(snapshot.previousHash!==(previous?.hash??null))return unavailable("chain_broken");
    try{
      if(await acceptanceReceiptDigest40(snapshot)!==snapshot.hash.toLowerCase())
        return unavailable("chain_broken");
    }catch{return unavailable("chain_broken");}
    if(previous!==null){
      let ancestor=false;
      try{
        ancestor=await authority.verifyDescendant(previous.headSha,snapshot.headSha,scope.projectId);
      }catch{return unavailable("git_unverified");}
      if(!ancestor)return unavailable("git_unverified");
    }
    const next=new Set<string>();
    const requiredCi=new Set<string>();
    let acceptedWeight=0;
    for(const featureId of snapshot.acceptedFeatureIds){
      const task=tasks.get(featureId);
      if(!task||task.lane!=="mvp")return unavailable("malformed_receipt");
      if(task.ciChecks.length===0)return unavailable("ci_unverified");
      next.add(featureId);
      acceptedWeight+=task.weight;
      for(const c of task.ciChecks)requiredCi.add(ciKey(c));
    }
    if([...previousAccepted].some(id=>!next.has(id)))
      return unavailable("regressed_features");
    if(requiredCi.size!==snapshot.ci.length||
       snapshot.ci.some((ci:AcceptanceCiReceipt40)=>!requiredCi.has(ciKey(ci))||
         ci.headSha.toLowerCase()!==snapshot.headSha.toLowerCase()))
      return unavailable("ci_unverified");
    try{
      if(!await authority.verifyOwnerSignature(snapshot))
        return unavailable("signature_unverified");
    }catch{return unavailable("signature_unverified");}
    try{
      for(const ci of snapshot.ci){
        if(!await authority.verifyCi(ci,snapshot))
          return unavailable("ci_unverified");
      }
    }catch{return unavailable("ci_unverified");}
    const verifiedPercent=Math.floor(acceptedWeight*100/totalWeight);
    milestoneHistory.push({
      projectId:scope.projectId,planJournalSequence:scope.planJournalSequence,
      headSha:snapshot.headSha,at:snapshot.acceptedAt,
      verifiedPercent,evidenceReceipt:snapshot.hash,
      ownerApproved:true,ciVerified:true
    });
    previousAccepted=next;
    previous=snapshot;
  }
  if(!previous||previous.headSha.toLowerCase()!==currentHeadSha.toLowerCase())
    return unavailable("stale_head");
  const last=milestoneHistory[milestoneHistory.length-1];
  return {status:"verified",verifiedPercent:last.verifiedPercent,
    acceptedFeatures:[...previousAccepted].sort(),latestHead:previous.headSha,
    receiptCount:snapshots.length,milestones:milestoneHistory};
}
