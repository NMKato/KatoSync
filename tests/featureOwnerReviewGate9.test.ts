import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomBytes,webcrypto} from "node:crypto";
import {handleReviewerReview,type Env} from "../supabase/functions/feature-owner-review-qa/handler.ts";
import {reviewerSigningBytes40,type IndependentOwnerReview40
} from "../src/lib/independentOwnerReview40.ts";

const base="https://xbnnlyyxiilklsygxcof.supabase.co";
const endpoint=base+"/functions/v1/feature-owner-review-qa";
const reviewer="11111111-1111-4111-8111-111111111111";
const subject="22222222-2222-4222-8222-222222222222";
const grantId="33333333-3333-4333-8333-333333333333";
const challengeId="44444444-4444-4444-8444-444444444444";
const decisionId="55555555-5555-4555-8555-555555555555";
const now=Date.UTC(2026,10,5,10,30,0);
const bearer="Bearer valid-user-reviewer-access-token-long";
const reason="Independent reviewer checked owner proof and project membership";
const env:Env={
 SUPABASE_URL:base,SUPABASE_ANON_KEY:"qa-test-anon-key-with-more-than-twenty",
 SUPABASE_SERVICE_ROLE_KEY:"qa-test-service-secret-with-more-than-twenty",
 KATOSYNC_FEATURE_APPROVAL_STAGE:"qa"
};
const ownerKeyId="ed25519-sha256:"+"e".repeat(64);
const send=(body:unknown,auth=bearer)=>new Request(endpoint,{
 method:"POST",headers:{Authorization:auth,"Content-Type":"application/json"},
 body:JSON.stringify(body)
});
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
type Mode={authFailed?:boolean;member?:string;reviewer?:string;key?:string;
 grant?:string;self?:boolean;project?:string;proof?:boolean;duplicate?:boolean;
 keyMismatch?:boolean};
async function fixture(mode:Mode={}){
 const kp=await webcrypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
 const pub=new Uint8Array(await webcrypto.subtle.exportKey("raw",kp.publicKey));
 const reviewerPublicKey=Buffer.from(pub).toString("base64url");
 const reviewerKeyId="ed25519-sha256:"+createHash("sha256").update(pub).digest("hex");
 const state={writes:0,identityReads:0,authHeaders:0};
 const fetcher=async(raw:RequestInfo|URL,opts?:RequestInit)=>{
  const uri=new URL(String(raw)),headers=new Headers(opts?.headers);
  if(uri.pathname==="/auth/v1/user"){
   state.identityReads++;
   assert.equal(headers.get("authorization"),bearer);
   assert.equal(headers.get("apikey"),env.SUPABASE_ANON_KEY);
   return mode.authFailed?json({error:"session-expired"},401):json({id:reviewer});
  }
  assert.equal(headers.get("authorization"),"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(headers.get("apikey"),env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(opts?.redirect,"error");
  state.authHeaders++;
  if(uri.pathname.endsWith("/account_memberships"))return json([{
   user_id:uri.searchParams.get("user_id")==="eq."+subject?subject:reviewer,
   access_state:mode.member??"active",
   authorized_at:new Date(now-3600000).toISOString(),revoked_at:null
  }]);
  if(uri.pathname.endsWith("/feature_approval_reviewers"))return json([{
   reviewer_uid:reviewer,state:mode.reviewer??"active",
   authorized_at:new Date(now-3600000).toISOString(),revoked_at:null
  }]);
  if(uri.pathname.endsWith("/feature_reviewer_signing_keys"))return json([{
   reviewer_uid:reviewer,state:mode.key??"active",
   approved_at:new Date(now-3600000).toISOString(),revoked_at:null,
   reviewer_key_id:reviewerKeyId,public_key:reviewerPublicKey,
   key_revision:1
  }]);
  if(uri.pathname.endsWith("/feature_approver_grants"))return json([{
   grant_id:grantId,project_id:"katosync",
   subject_uid:mode.self?reviewer:subject,
   owner_key_id:ownerKeyId,grant_revision:7,state:mode.grant??"pending",
   revoked_at:null
  }]);
  if(uri.pathname.endsWith("/feature_approval_projects"))return json([{
   project_id:"katosync",state:mode.project??"active",
   approved_at:new Date(now-3600000).toISOString(),revoked_at:null
  }]);
  if(uri.pathname.endsWith("/feature_owner_challenges"))return json([{
   challenge_id:challengeId,grant_id:grantId,project_id:"katosync",
   subject_uid:mode.self?reviewer:subject,
   consumed_at:mode.proof===false?null:new Date(now-20000).toISOString(),
   canceled_at:null,proof_key_id:mode.keyMismatch?"ed25519-sha256:"+"f".repeat(64):ownerKeyId
  }]);
  if(uri.pathname.endsWith("/rpc/feature_owner_review_submit")){
   state.writes++;
   const data=JSON.parse(String(opts?.body));
   assert.equal(data.p_grant_id,grantId);
   assert.equal(data.p_challenge_id,challengeId);
   assert.equal(data.p_reviewer_uid,reviewer);
   assert.equal(data.p_decision,"approved");
   assert.equal(data.p_reason,reason);
   assert.equal(data.p_key_id,reviewerKeyId);
   assert.equal(typeof data.p_signature,"string");
   if(mode.duplicate || state.writes>1)return json(null);
   return json(decisionId);
  }
  throw Error("UNKNOWN_SERVER_PATH");
 };
 const sign=async(review:IndependentOwnerReview40)=>{
  const bytes=reviewerSigningBytes40(review);
  return Buffer.from(await webcrypto.subtle.sign("Ed25519",kp.privateKey,
   new Uint8Array(bytes).buffer as ArrayBuffer)).toString("base64url");
 };
 const config={fetcher:fetcher as typeof fetch,now:()=>now};
 const payload={grantId,challengeId,decision:"approved",reason};
 return {config,sign,state,payload,reviewerKeyId};
}
test("valid signed reviewer attestation is persisted but NEVER activates the owner",async()=>{
 const f=await fixture();
 const prepared=await handleReviewerReview(send({action:"prepare",...f.payload}),env,f.config);
 assert.equal(prepared.status,200);
 const p=await prepared.json();
 assert.equal(p.state,"awaiting_reviewers_ed25519_signature");
 assert.equal(p.grantsRights,false);
 assert.equal(p.review.reviewerUid,reviewer);
 assert.equal(p.review.subjectUid,subject);
 assert.equal(p.review.grantRevision,7);
 const signature=await f.sign(p.review);
 const outcome=await handleReviewerReview(send({
  action:"attest",...f.payload,signedAtMs:p.review.signedAtMs,signature
 }),env,f.config);
 assert.equal(outcome.status,200);
 assert.deepEqual(await outcome.json(),{
  decisionId,state:"review_signed_pending_separate_activation",grantsRights:false
 });
 assert.equal(f.state.writes,1);
 assert.ok(f.state.authHeaders>=8);
});
test("self-review, inactive reviewer, revoked signing key and missing owner proof deny",async()=>{
 for(const mode of [{self:true},{reviewer:"pending"},{reviewer:"revoked"},
  {member:"suspended"},{key:"revoked"},{key:"pending"},
  {grant:"active"},{project:"staged"},{proof:false},{keyMismatch:true}]){
  const f=await fixture(mode);
  const response=await handleReviewerReview(send({action:"prepare",...f.payload}),env,f.config);
  assert.equal(response.status,403,JSON.stringify(mode));
  assert.equal(f.state.writes,0);
 }
});
test("wrong request, no login or disabled QA stage cannot prepare/sign",async()=>{
 const f=await fixture();
 assert.equal((await handleReviewerReview(send({action:"approve",...f.payload}),env,f.config)).status,400);
 assert.equal((await handleReviewerReview(send({action:"prepare",...f.payload,admin:true}),env,f.config)).status,400);
 assert.equal((await handleReviewerReview(send({action:"prepare",...f.payload},"Bearer invalid"),env,f.config)).status,401);
 assert.equal((await handleReviewerReview(send({action:"prepare",...f.payload}),
  {...env,KATOSYNC_FEATURE_APPROVAL_STAGE:""},f.config)).status,503);
 assert.equal((await handleReviewerReview(send({action:"prepare",...f.payload}),
  {...env,SUPABASE_URL:"https://example.invalid"},f.config)).status,503);
});
test("fake signature, changed approval reason, review replay and rotated key fail",async()=>{
 const f=await fixture();
 const prep=await handleReviewerReview(send({action:"prepare",...f.payload}),env,f.config);
 const p=await prep.json();
 const signature=await f.sign(p.review);
 for(const signatureInput of [randomBytes(64).toString("base64url"),signature.slice(1),
  (signature[0]==="A"?"B":"A")+signature.slice(1)]){
  const r=await handleReviewerReview(send({action:"attest",...f.payload,
   signedAtMs:p.review.signedAtMs,signature:signatureInput
  }),env,f.config);
  assert.equal(r.status,403);
 }
 const badReason=await handleReviewerReview(send({action:"attest",...f.payload,
  reason:"Forged approval without reviewing ownership",
  signedAtMs:p.review.signedAtMs,signature
 }),env,f.config);
 assert.equal(badReason.status,403);
 assert.equal(f.state.writes,0);
 const duplicate=await fixture({duplicate:true});
 const prepDup=await handleReviewerReview(send({action:"prepare",...duplicate.payload}),env,duplicate.config);
 const preparedDup=(await prepDup.json()).review;
 const sigDup=await duplicate.sign(preparedDup);
 const second=await handleReviewerReview(send({action:"attest",...duplicate.payload,
  signedAtMs:preparedDup.signedAtMs,signature:sigDup
 }),env,duplicate.config);
 assert.equal(second.status,409);
});
