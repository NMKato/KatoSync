// Stage 3P Edge handler: isolated QA; no external network or writes.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {handleEnrollmentPreviewV2} from "../supabase/functions/mesh-enrollment-preview/handler.ts";
const f=JSON.parse(readFileSync(new URL("./fixtures/meshEnrollmentRustV2Stage3P.public.json",import.meta.url),"utf8"));
const REF="abcdefghijklmnopqrst";
const QA="https://"+REF+".supabase.co";
const env=(overrides:Record<string,string>={})=>({
 SUPABASE_URL:QA,SUPABASE_ANON_KEY:"public-test-value",
 SUPABASE_SERVICE_ROLE_KEY:"server-test-value",
 KATOSYNC_MESH_RELAY_QA_MODE:"isolated-preview-only",
 KATOSYNC_MESH_RELAY_QA_PROJECT_REF:REF,
 DENO_DEPLOYMENT_ID:REF+"_11111111-1111-4111-8111-111111111111_1",
 KATOSYNC_MESH_ENROLLMENT_V2_QA_STAGE:"verify-only",...overrides
});
const call=(proof:unknown=f.proof)=>new Request(QA+"/functions/v1/mesh-enrollment-preview",{
 method:"POST",headers:{authorization:"Bearer synthetic-local-only-token-12345678901","content-type":"application/json"},
 body:JSON.stringify(proof)
});
function backend(){
 const paths:string[]=[];
 const transport:typeof fetch=async(input,init)=>{
  const u=new URL(String(input));
  paths.push(u.pathname);
  assert.equal(u.origin,QA);
  assert.equal(init?.method??"GET","GET");
  if(u.pathname==="/auth/v1/user")return Response.json({id:f.owner,is_anonymous:false});
  if(u.pathname==="/rest/v1/account_memberships")return Response.json([{
   user_id:f.owner,access_state:"active",authorized_at:new Date(Date.now()-60000).toISOString(),revoked_at:null
  }]);
  if(u.pathname==="/rest/v1/mesh_enrollment_challenges"){
   assert.equal(u.searchParams.get("owner_user_id"),"eq."+f.owner);
   assert.equal(u.searchParams.get("challenge_id"),"eq."+f.proof.challengeId);
   return Response.json([{challenge_id:f.proof.challengeId,owner_user_id:f.owner,
    signing_public_key:f.proof.publicKey,nonce:f.proof.nonce,
    expires_at:f.proof.expiresAt,consumed_at:null}]);
  }
  throw Error("UNEXPECTED_QA_ROUTE");
 };
 return {paths,transport};
}
test("QA endpoint validates rust proof without writing",async()=>{
 const b=backend();
 const res=await handleEnrollmentPreviewV2(call(),env(),b.transport,f.nowMs);
 assert.equal(res.status,200);
 assert.equal((await res.json()).discovered,false);
 assert.equal(b.paths.length,4);
});
test("QA refuses production and mismatched configurations before network",async()=>{
 for(const e of [{SUPABASE_URL:"https://xbnnlyyxiilklsygxcof.supabase.co"},
  {KATOSYNC_MESH_ENROLLMENT_V2_QA_STAGE:""},
  {DENO_DEPLOYMENT_ID:""}]){
  let calls=0;
  const res=await handleEnrollmentPreviewV2(call(),env(e),async()=>{
   calls++;throw Error("NO_NETWORK");
  },f.nowMs);
  assert.equal(res.status,503);
  assert.equal(calls,0);
 }
});
test("tampered signed device name cannot be approved",async()=>{
 const b=backend();
 const tampered={...f.proof,deviceName:"Compromised Device"};
 const res=await handleEnrollmentPreviewV2(call(tampered),env(),b.transport,f.nowMs);
 assert.equal(res.status,403);
 assert.equal(b.paths.includes("/rest/v1/mesh_enrollment_challenges"),true);
});
test("oversized body rejected before auth or database request",async()=>{
 let calls=0;
 const oversized={...f.proof,extra:"X".repeat(5000)};
 const res=await handleEnrollmentPreviewV2(call(oversized),env(),async()=>{
  calls++;throw Error("NO_NETWORK");
 },f.nowMs);
 assert.equal(res.status,400);
 assert.equal(calls,0);
});
