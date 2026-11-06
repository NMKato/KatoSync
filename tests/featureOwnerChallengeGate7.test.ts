// NMKato Solutions – challenge API QA, no live identities or grants.
import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes,webcrypto,createHash} from "node:crypto";
import {handleOwnerChallenge,type ChallengeEnv} from
 "../supabase/functions/feature-owner-challenge-qa/handler.ts";
import {ownerProofBytes40,type OwnerKeyPossession40} from
 "../src/lib/featureOwnerKeyProof40.ts";

const origin="https://xbnnlyyxiilklsygxcof.supabase.co";
const url=origin+"/functions/v1/feature-owner-challenge-qa";
const uid="11111111-1111-4111-8111-111111111111";
const challengeId="22222222-2222-4222-8222-222222222222";
const grantId="33333333-3333-4333-8333-333333333333";
const now=Date.UTC(2026,10,5,9,40);
const nonce=randomBytes(32).toString("base64url");
const bearer="Bearer access-token-longer-than-twenty-valid";
const env:ChallengeEnv={
 SUPABASE_URL:origin,
 SUPABASE_ANON_KEY:"qa-anon-key-test-longer-than-twenty",
 SUPABASE_SERVICE_ROLE_KEY:"qa-service-secret-test-longer-than-twenty",
 KATOSYNC_FEATURE_APPROVAL_STAGE:"qa"
};
const request=(data:unknown,auth=bearer)=>new Request(url,{
 method:"POST",headers:{authorization:auth,"content-type":"application/json"},
 body:JSON.stringify(data)
});
const blob=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
type Mode={memberState?:string;grantState?:string;consumeResult?:boolean;
 expired?:boolean;issueBlocked?:boolean;badKey?:boolean;authFailed?:boolean};
async function fixture(mode:Mode={}){
 const pair=await webcrypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
 const pub=Buffer.from(await webcrypto.subtle.exportKey("raw",pair.publicKey));
 const publicKeyBase64Url=pub.toString("base64url");
 const keyId="ed25519-sha256:"+createHash("sha256").update(pub).digest("hex");
 const state={consumed:false,issueCount:0,verifyCount:0};
 const transport=async (raw:RequestInfo|URL,opts?:RequestInit):Promise<Response>=>{
  const u=new URL(String(raw));
  if(u.pathname==="/auth/v1/user"){
    assert.equal(new Headers(opts?.headers).get("authorization"),bearer);
    return mode.authFailed?blob({error:"unauth"},401):blob({id:uid});
  }
  assert.equal(new Headers(opts?.headers).get("Authorization"),
   "Bearer "+env.SUPABASE_SERVICE_ROLE_KEY);
  if(u.pathname.endsWith("/account_memberships"))
   return blob([{user_id:uid,access_state:mode.memberState??"active",
    authorized_at:new Date(now-100000).toISOString(),revoked_at:null}]);
  if(u.pathname.endsWith("/rpc/feature_owner_challenge_issue")){
   state.issueCount++;
   const body=JSON.parse(String(opts?.body));
   assert.deepEqual(body,{p_project_id:"katosync",p_subject_uid:uid});
   return blob(mode.issueBlocked?[]:[{
    challenge_id:challengeId,project_id:"katosync",subject_uid:uid,
    nonce,issued_at_ms:now-20000,expires_at_ms:now+120000
   }]);
  }
  if(u.pathname.endsWith("/feature_owner_challenges"))
   return blob([{
    challenge_id:challengeId,grant_id:grantId,project_id:"katosync",
    subject_uid:uid,nonce,
    issued_at:new Date(now-20000).toISOString(),
    expires_at:new Date(mode.expired?now-1:now+120000).toISOString(),
    consumed_at:state.consumed?new Date(now).toISOString():null,canceled_at:null
   }]);
  if(u.pathname.endsWith("/feature_approver_grants"))
   return blob([{
    grant_id:grantId,project_id:"katosync",subject_uid:uid,
    state:mode.grantState??"pending",
    owner_key_id:keyId,owner_signing_public_key:mode.badKey?"tampered":publicKeyBase64Url
   }]);
  if(u.pathname.endsWith("/rpc/feature_owner_challenge_consume")){
   state.verifyCount++;
   const body=JSON.parse(String(opts?.body));
   assert.equal(body.p_key_id,keyId);
   assert.equal(body.p_challenge_id,challengeId);
   if(mode.consumeResult===false || state.consumed)return blob(false);
   state.consumed=true;
   return blob(true);
  }
  throw Error("UNEXPECTED_URL");
 };
 async function sign(input:OwnerKeyPossession40):Promise<OwnerKeyPossession40>{
  const bytes=ownerProofBytes40(input);
  const signature=await webcrypto.subtle.sign(
   "Ed25519",pair.privateKey,new Uint8Array(bytes).buffer as ArrayBuffer
  );
  return {...input,signature:Buffer.from(signature).toString("base64url")};
 }
 const proof=await sign({
  protocol:"katosync.owner-key-possession/v1",projectId:"katosync",
  subjectUid:uid,nonce,publicKeyBase64Url,signedAtMs:now-1000,signature:""
 });
 const opts={transport:transport as typeof fetch,now:()=>now};
 return {state,transport,opts,proof,sign,keyId};
}
test("admin pending key: challenge issue, valid Ed25519 proof, atomic consume and replay denial",async()=>{
 const f=await fixture();
 const issue=await handleOwnerChallenge(request({action:"issue",projectId:"katosync"}),env,f.opts);
 assert.equal(issue.status,200);
 const body=await issue.json();
 assert.equal(body.challengeId,challengeId);
 assert.equal(body.challenge.subjectUid,uid);
 assert.equal(body.challenge.nonce,nonce);
 assert.equal(body.grantsRights,false);
 const verification=await handleOwnerChallenge(request({
  action:"verify",projectId:"katosync",challengeId,proof:f.proof,
 }),env,f.opts);
 assert.equal(verification.status,200);
 assert.deepEqual(await verification.json(),{
  state:"proof_consumed_pending_independent_review",ownerKeyId:f.keyId,
  grantsRights:false
 });
 assert.equal(f.state.verifyCount,1);
 const replay=await handleOwnerChallenge(request({
  action:"verify",projectId:"katosync",challengeId,proof:f.proof
 }),env,f.opts);
 assert.equal(replay.status,409);
 assert.equal(f.state.verifyCount,1);
});
test("login, stage, project, role and previously missing admin provisioning fail closed",async()=>{
 const f=await fixture();
 const cases=[
  [request({action:"issue",projectId:"katosync"},"Bearer invalid"),env,401],
  [request({action:"issue",projectId:"../katosync"}),env,400],
  [request({action:"issue",projectId:"katosync",approved:true}),env,400],
  [request({action:"approve",projectId:"katosync"}),env,400],
  [request({action:"issue",projectId:"katosync"}),{...env,KATOSYNC_FEATURE_APPROVAL_STAGE:""},503],
 ] as const;
 for(const [req,config,status] of cases)
  assert.equal((await handleOwnerChallenge(req,config,f.opts)).status,status);
 const blocked=await fixture({issueBlocked:true});
 assert.equal((await handleOwnerChallenge(request({action:"issue",projectId:"katosync"}),
  env,blocked.opts)).status,403);
 const wrongMember=await fixture({memberState:"pending"});
 assert.equal((await handleOwnerChallenge(request({action:"issue",projectId:"katosync"}),
  env,wrongMember.opts)).status,403);
});
test("no key mismatch, fake signatures, expired lease or revoked grant can consume",async()=>{
 const modes=[{badKey:true},{grantState:"revoked"},{expired:true}];
 for(const mode of modes){
  const f=await fixture(mode);
  const resp=await handleOwnerChallenge(request({
   action:"verify",projectId:"katosync",challengeId,proof:f.proof
  }),env,f.opts);
  assert.equal(resp.status===403||resp.status===409,true);
  assert.equal(f.state.verifyCount,0);
 }
 const fake=await fixture();
 const proof={...fake.proof,signature:randomBytes(64).toString("base64url")};
 assert.equal((await handleOwnerChallenge(request({
  action:"verify",projectId:"katosync",challengeId,proof
 }),env,fake.opts)).status,403);
 assert.equal(fake.state.verifyCount,0);
 const failed=await fixture({consumeResult:false});
 assert.equal((await handleOwnerChallenge(request({
  action:"verify",projectId:"katosync",challengeId,proof:failed.proof
 }),env,failed.opts)).status,409);
});
