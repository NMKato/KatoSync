// NMKato Solutions — no-live-network, owner-scoped KATOOS Gate9 readback QA.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash,webcrypto,randomBytes} from "node:crypto";
import {handleOwnerReviewReadback,type Env}
 from "../supabase/functions/feature-owner-readback-qa/handler.ts";
import {REVIEW_PROTOCOL40,reviewerSigningBytes40,
 type IndependentOwnerReview40} from "../src/lib/independentOwnerReview40.ts";

const base="https://xbnnlyyxiilklsygxcof.supabase.co";
const url=base+"/functions/v1/feature-owner-readback-qa";
const owner="22222222-2222-4222-8222-222222222222";
const reviewer="11111111-1111-4111-8111-111111111111";
const other="99999999-9999-4999-8999-999999999999";
const grantId="33333333-3333-4333-8333-333333333333";
const challengeId="44444444-4444-4444-8444-444444444444";
const decisionId="55555555-5555-4555-8555-555555555555";
const ownerKeyId="ed25519-sha256:"+"e".repeat(64);
const now=Date.UTC(2026,10,8,20,0,0);
const bearer="Bearer readback-test-owner-bearer-not-real-credentials-0000";
const env:Env={
 SUPABASE_URL:base,
 SUPABASE_ANON_KEY:"public-qa-anon-key-long-enough-0000",
 SUPABASE_SERVICE_ROLE_KEY:"server-qa-service-role-not-real-0000",
 KATOSYNC_FEATURE_APPROVAL_STAGE:"qa"
};
const iso=(ms:number)=>new Date(ms).toISOString();
const response=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
const req=(v:unknown,token=bearer)=>new Request(url,{
 method:"POST",headers:{"Content-Type":"application/json",Authorization:token},
 body:JSON.stringify(v)});
const payload={action:"readback",decisionId,grantId};
type Mode={
 uid?:string;member?:string;reviewerMember?:string;grant?:string;
 reviewer?:string;key?:string;project?:string;challenge?:string;
 tamperSignature?:boolean;keyMismatch?:boolean;wrongOwner?:boolean;
 missingDecision?:boolean;selfReviewer?:boolean;
 };
async function setup(mode:Mode={}){
 const keys=await webcrypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
 const pub=new Uint8Array(await webcrypto.subtle.exportKey("raw",keys.publicKey));
 const publicKey=Buffer.from(pub).toString("base64url");
 const reviewerKeyId="ed25519-sha256:"+
  createHash("sha256").update(pub).digest("hex");
 const subject=mode.selfReviewer?reviewer:owner;
 const signedAt=now-6000;
 const attest:IndependentOwnerReview40={
  protocol:REVIEW_PROTOCOL40,grantId,challengeId,projectId:"katosync",
  subjectUid:subject,ownerKeyId,grantRevision:7,
  reviewerUid:reviewer,reviewerKeyId,reviewerKeyRevision:2,
  reviewerPublicKey:publicKey,decision:"approved",
  reason:"Independent reviewer checked owner proof and project membership",
  signedAtMs:signedAt
 };
 const signature=Buffer.from(await webcrypto.subtle.sign("Ed25519",keys.privateKey,
  new Uint8Array(reviewerSigningBytes40(attest)).buffer as ArrayBuffer)).toString("base64url");
 const rowDecision={
  decision_id:decisionId,grant_id:grantId,challenge_id:challengeId,
  subject_uid:subject,project_id:"katosync",owner_key_id:ownerKeyId,
  grant_revision:7,reviewer_uid:reviewer,reviewer_key_id:reviewerKeyId,
  reviewer_key_revision:2,reviewer_public_key:publicKey,
  reviewer_signature:mode.tamperSignature?randomBytes(64).toString("base64url"):signature,
  decision:"approved",reason:attest.reason,
  reviewed_at:iso(now-5000),signed_at_ms:signedAt,
  attestation_protocol:REVIEW_PROTOCOL40
 };
 const stats={reads:[] as string[],writes:0,authReads:0};
 const fetcher=async(raw:RequestInfo|URL,opts?:RequestInit)=>{
  const uri=new URL(String(raw)),headers=new Headers(opts?.headers);
  assert.equal(opts?.method,"GET");
  assert.equal(opts?.cache,"no-store");
  assert.equal(opts?.redirect,"error");
  if(uri.pathname==="/auth/v1/user"){
   stats.authReads++;
   assert.equal(headers.get("Authorization"),bearer);
   assert.equal(headers.get("apikey"),env.SUPABASE_ANON_KEY);
   return response({id:mode.uid??owner});
  }
  assert.equal(headers.get("Authorization"),"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(headers.get("apikey"),env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(headers.get("Accept-Profile"),"katosync");
  const table=uri.pathname.split("/").at(-1)??"";
  stats.reads.push(table);
  const subjectId=mode.uid??owner;
  const id=uri.searchParams.get("user_id");
  if(table==="account_memberships"){
   if(id==="eq."+owner)return response([{user_id:owner,
    access_state:mode.member??"active",revoked_at:null,authorized_at:iso(now-3600000)}]);
   if(id==="eq."+reviewer)return response([{user_id:reviewer,
    access_state:mode.reviewerMember??"active",
    revoked_at:null,authorized_at:iso(now-3600000)}]);
   return response([{user_id:subjectId,access_state:"active",
    revoked_at:null,authorized_at:iso(now-3600000)}]);
  }
  if(table==="feature_approver_grants"){
   // Server role must never fetch a grant not filtered to logged-in owner.
   assert.equal(uri.searchParams.get("subject_uid"),"eq."+subjectId);
   if(mode.wrongOwner||subjectId!==owner)return response([]);
   return response([{grant_id:grantId,subject_uid:owner,
    project_id:"katosync",owner_key_id:ownerKeyId,grant_revision:7,
    state:mode.grant??"pending",revoked_at:null}]);
  }
  if(table==="feature_owner_review_decisions"){
   assert.equal(uri.searchParams.get("subject_uid"),"eq."+subjectId);
   if(mode.missingDecision)return response([]);
   return response([rowDecision]);
  }
  if(table==="feature_approval_reviewers")return response([{
   reviewer_uid:reviewer,state:mode.reviewer??"active",
   authorized_at:iso(now-3600000),revoked_at:null}]);
  if(table==="feature_reviewer_signing_keys")return response([{
   reviewer_uid:reviewer,reviewer_key_id:reviewerKeyId,
   public_key:mode.keyMismatch?randomBytes(32).toString("base64url"):publicKey,
   key_revision:2,state:mode.key??"active",
   approved_at:iso(now-3600000),revoked_at:null}]);
  if(table==="feature_approval_projects")return response([{
   project_id:"katosync",state:mode.project??"active",
   approved_at:iso(now-3600000),revoked_at:null}]);
  if(table==="feature_owner_challenges")return response([{
   challenge_id:challengeId,grant_id:grantId,subject_uid:owner,
   project_id:"katosync",proof_key_id:ownerKeyId,
   consumed_at:mode.challenge==="missing"?null:iso(now-120000),
   canceled_at:mode.challenge==="canceled"?iso(now-60000):null}]);
  stats.writes++;
  throw Error("unknown server route: "+uri.pathname);
 };
 return {cfg:{fetcher:fetcher as typeof fetch,now:()=>now},stats,
   signature,attest,owner,publicKey,reviewerKeyId};
}
test("real signed reviewer decision read back by owner without granting rights",async()=>{
 const f=await setup();
 const r=await handleOwnerReviewReadback(req(payload),env,f.cfg);
 assert.equal(r.status,200);
 const body=await r.json();
 assert.equal(body.protocol,"katosync.owner-review-readback/v1");
 assert.equal(body.grantsRights,false);
 assert.equal(body.verifiedPercent,null);
 assert.equal(body.attestation.subjectUid,owner);
 assert.equal(body.attestation.reviewerUid,reviewer);
 assert.equal(body.reviewerSignature,f.signature);
 assert.match(r.headers.get("Cache-Control")??"",/no-store/);
 assert.equal(f.stats.writes,0);
 assert.equal(f.stats.authReads,1);
 assert.equal(f.stats.reads.length,8);
});
test("wrong caller, missing identity and inactive owner must never see reviewer proof",async()=>{
 for(const mode of [{uid:other},{wrongOwner:true},{member:"suspended"}]){
  const f=await setup(mode);
  const r=await handleOwnerReviewReadback(req(payload),env,f.cfg);
  assert.equal(r.status,403,JSON.stringify(mode));
  assert.equal(f.stats.writes,0);
 }
 const f=await setup();
 const invalid=await handleOwnerReviewReadback(req(payload,"Bearer invalid"),env,f.cfg);
 assert.equal(invalid.status,401);
 assert.equal(f.stats.authReads,0);
});
test("revoked reviewer, rotated key, inactive project and missing consumed owner challenge are denied",async()=>{
 for(const mode of [{reviewer:"revoked"},{reviewerMember:"suspended"},
  {key:"revoked"},{keyMismatch:true},{project:"pending"},
  {challenge:"missing"},{challenge:"canceled"},{grant:"revoked"},
  {grant:"active"},
  {tamperSignature:true},{missingDecision:true},{selfReviewer:true}]){
  const f=await setup(mode);
  const r=await handleOwnerReviewReadback(req(payload),env,f.cfg);
  assert.ok([403,409].includes(r.status),JSON.stringify(mode)+" "+r.status);
  assert.equal(f.stats.writes,0);
 }
});
test("unrecognized action, oversized body and disabled QA stage fail before privileged read",async()=>{
 const f=await setup();
 const bad=[{...payload,action:"activate"},{...payload,admin:true},
  {...payload,decisionId:"not-a-uuid"}];
 for(const data of bad){
  const r=await handleOwnerReviewReadback(req(data),env,f.cfg);
  assert.equal(r.status,400);
 }
 assert.equal((await handleOwnerReviewReadback(req(payload),{
  ...env,KATOSYNC_FEATURE_APPROVAL_STAGE:""},f.cfg)).status,503);
 assert.equal((await handleOwnerReviewReadback(req(payload),{
  ...env,SUPABASE_URL:"https://other.invalid"},f.cfg)).status,503);
 assert.equal(f.stats.reads.length,0);
});
