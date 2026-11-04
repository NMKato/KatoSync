import assert from "node:assert/strict";
import test from "node:test";
import {createHash,webcrypto} from "node:crypto";
import {issueFeatureApprovalGrant,type Env} from "../supabase/functions/feature-approver-grant-qa/issue.ts";
import {
 boundKeyId,bytesToUrlBase64,canonicalSupabase,issuerDomain,signingBytes,
 type Grant
} from "../supabase/functions/feature-approver-grant-qa/contract.ts";
const subtle=webcrypto.subtle;
const NOW=Date.UTC(2026,10,4,22,0,0);
const UID="11111111-1111-4111-8111-111111111111";
const bearer="Bearer "+"user-access-token-012345678901234567890";
const base=canonicalSupabase+"/functions/v1/feature-approver-grant-qa?projectId=project-a";
type Mode={membership?:string;project?:string;grant?:string;auth?:boolean;duplicate?:boolean;key?:string};
function get(url:string, auth=bearer):Request{return new Request(url,{headers:{Authorization:auth}});}
async function fixture(){
 const issuer=await subtle.generateKey("Ed25519",true,["sign","verify"]);
 const owner=await subtle.generateKey("Ed25519",true,["sign","verify"]);
 const issuerPkcs8=new Uint8Array(await subtle.exportKey("pkcs8",issuer.privateKey));
 const ownerPublic=bytesToUrlBase64(new Uint8Array(await subtle.exportKey("raw",owner.publicKey)));
 const ownerKeyId=await boundKeyId(ownerPublic);
 const env:Env={
  SUPABASE_URL:canonicalSupabase,
  SUPABASE_ANON_KEY:"anon-qa-test-key-with-long-text",
  SUPABASE_SERVICE_ROLE_KEY:"service-role-qa-test-key-with-long-text",
  KATOSYNC_FEATURE_APPROVAL_STAGE:"qa",
  KATOSYNC_APPROVER_ISSUER_PKCS8_B64:Buffer.from(issuerPkcs8).toString("base64")
 };
 const transport=(mode:Mode={})=>async(raw:RequestInfo|URL, options?:RequestInit)=>{
  const url=new URL(String(raw));
  const inAuth=url.pathname==="/auth/v1/user";
  if(inAuth){
   assert.equal(options?.headers&&new Headers(options.headers).get("apikey"),env.SUPABASE_ANON_KEY);
   assert.equal(options?.headers&&new Headers(options.headers).get("authorization"),bearer);
   return new Response(JSON.stringify(mode.auth===false?{error:"expired"}:{id:UID}),{
    status:mode.auth===false?401:200
   });
  }
  assert.equal(new Headers(options?.headers).get("Accept-Profile"),"katosync");
  assert.equal(new Headers(options?.headers).get("authorization"),
   "Bearer "+env.SUPABASE_SERVICE_ROLE_KEY);
  let row:Record<string,unknown>|null=null;
  if(url.pathname.endsWith("/account_memberships")){
   assert.equal(url.searchParams.get("user_id"),"eq."+UID);
   row={user_id:UID,access_state:mode.membership??"active",
    authorized_at:new Date(NOW-3600000).toISOString(),revoked_at:null};
  }else if(url.pathname.endsWith("/feature_approval_projects")){
   assert.equal(url.searchParams.get("project_id"),"eq.project-a");
   row={project_id:"project-a",state:mode.project??"active",
    approved_at:new Date(NOW-3600000).toISOString(),revoked_at:null};
  }else if(url.pathname.endsWith("/feature_approver_grants")){
   assert.equal(url.searchParams.get("subject_uid"),"eq."+UID);
   assert.equal(url.searchParams.get("project_id"),"eq.project-a");
   row={project_id:"project-a",subject_uid:UID,role:mode.grant??"project_owner",
    permission:"approve_feature_acceptance",
    owner_key_id:ownerKeyId,
    owner_signing_public_key:mode.key??ownerPublic,
    grant_revision:1,state:"active",
    authorized_at:new Date(NOW-3600000).toISOString(),revoked_at:null};
  }else throw new Error("UNEXPECTED_BACKEND_URL");
  return new Response(JSON.stringify(mode.duplicate?[row,row]:[row]),{status:200});
 };
 return {issuer,owner,env,transport,ownerKeyId,ownerPublic};
}
test("QA issuer grant signs exact independent Ed25519 payload and 60-second lease",async()=>{
 const f=await fixture();
 const response=await issueFeatureApprovalGrant(get(base),f.env,{
  transport:f.transport() as typeof fetch,now:()=>NOW
 });
 assert.equal(response.status,200);
 assert.equal(response.headers.get("Cache-Control"),"no-store");
 const grant=await response.json() as Grant;
 assert.equal(grant.subjectUid,UID);
 assert.equal(grant.projectId,"project-a");
 assert.equal(grant.keyId,f.ownerKeyId);
 assert.equal(grant.signingPublicKey,f.ownerPublic);
 assert.equal(grant.issuedAtMs,NOW);
 assert.equal(grant.expiresAtMs,NOW+60_000);
 const base64=grant.issuerSignature.replace(/-/g,"+").replace(/_/g,"/");
 const signature=Uint8Array.from(Buffer.from(base64,"base64"));
 assert.equal(await subtle.verify("Ed25519",f.issuer.publicKey,signature,signingBytes(grant)),true);
 assert.equal(new TextDecoder().decode(signingBytes(grant)).startsWith(issuerDomain),true);
 grant.role="viewer";
 assert.equal(await subtle.verify("Ed25519",f.issuer.publicKey,signature,signingBytes(grant)),false);
});
test("unconfigured issuer, disabled stage, wrong URL, no access token fail closed",async()=>{
 const f=await fixture();
 const missing={...f.env,KATOSYNC_APPROVER_ISSUER_PKCS8_B64:""};
 assert.equal((await issueFeatureApprovalGrant(get(base),missing)).status,503);
 const disabled={...f.env,KATOSYNC_FEATURE_APPROVAL_STAGE:""};
 assert.equal((await issueFeatureApprovalGrant(get(base),disabled)).status,503);
 const generic={...f.env,SUPABASE_URL:"https://attacker.invalid"};
 assert.equal((await issueFeatureApprovalGrant(get(base),generic)).status,503);
 assert.equal((await issueFeatureApprovalGrant(get(base,"Bearer invalid"),f.env)).status,401);
 assert.equal((await issueFeatureApprovalGrant(get(base,"Bearer "+f.env.SUPABASE_SERVICE_ROLE_KEY),f.env)).status,401);
 assert.equal((await issueFeatureApprovalGrant(new Request(base,{method:"POST"}),f.env)).status,405);
 assert.equal((await issueFeatureApprovalGrant(get(base+"&role=project_owner"),f.env)).status,400);
 assert.equal((await issueFeatureApprovalGrant(get(base+"&projectId=project-b"),f.env)).status,400);
 assert.equal((await issueFeatureApprovalGrant(get(base.replace("project-a","../attack")),f.env)).status,400);
});
test("no active KATOOS member, explicit project and exact approver row => no signature",async()=>{
 const f=await fixture();
 for(const mode of [
  {auth:false},{membership:"pending"},{membership:"revoked"},
  {project:"staged"},{project:"suspended"},{grant:"viewer"},
  {grant:"reader"},{key:"not-an-ed25519-pubkey"},
  {duplicate:true}
 ]){
  const result=await issueFeatureApprovalGrant(get(base),f.env,{
   transport:f.transport(mode) as typeof fetch,now:()=>NOW
  });
  assert.ok(result.status===401||result.status===403,JSON.stringify(mode));
  assert.equal((await result.text()).includes("issuerSignature"),false);
 }
});
test("reissued owner key fingerprint and error responses never reveal keys or roles",async()=>{
 const f=await fixture();
 const result=await issueFeatureApprovalGrant(get(base),f.env,{
  transport:async()=>{throw new Error("sensitive-remote-token");},now:()=>NOW
 });
 assert.equal(result.status,503);
 const body=await result.text();
 assert.equal(body.includes("sensitive-remote-token"),false);
 assert.equal(body.includes(f.env.SUPABASE_SERVICE_ROLE_KEY),false);
});

test("Edge/Rust fixed issuer-grant signing bytes have identical SHA-256",()=>{
 const issue=1793829600000;
 const g:Grant={
  protocol:"katosync-project-feature-approver-grant/v1",
  subjectUid:UID,projectId:"project-a",role:"project_owner",
  permission:"approve_feature_acceptance",
  keyId:"ed25519-sha256:"+"f".repeat(64),
  signingPublicKey:"A".repeat(43),grantRevision:3,state:"active",
  issuedAtMs:issue,expiresAtMs:issue+60000,revokedAtMs:null,
  issuerSignature:""
 };
 const bytes=signingBytes(g);
 assert.equal(bytes.length,347);
 assert.equal(createHash("sha256").update(bytes).digest("hex"),
  "1f874636616a22ee30ff57ce3f355f92dfedb59ffc437c4c302af6a3a1466561");
});
