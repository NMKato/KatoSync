// Stage 3Q: real Edge handler + Rust-produced signatures; synthetic GET-only backend.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {handleInboxPreviewV2} from "../supabase/functions/mesh-inbox-preview/handler.ts";
const fixture=JSON.parse(readFileSync(new URL("./fixtures/meshInboxRustV2Stage3Q.public.json",import.meta.url),"utf8"));
const QA="https://abcdefghijklmnopqrst.supabase.co";
const LIVE="https://xbnnlyyxiilklsygxcof.supabase.co";
const OWNER=fixture.owner,REF="abcdefghijklmnopqrst";
const env=(changes:Record<string,string>={})=>({
 SUPABASE_URL:QA,SUPABASE_ANON_KEY:"public-qa-test",
 SUPABASE_SERVICE_ROLE_KEY:"private-qa-test",
 KATOSYNC_MESH_RELAY_QA_MODE:"isolated-preview-only",
 KATOSYNC_MESH_RELAY_QA_PROJECT_REF:REF,
 DENO_DEPLOYMENT_ID:REF+"_11111111-1111-4111-8111-111111111111_1",
 KATOSYNC_MESH_INBOX_V2_QA_STAGE:"verify-only",...changes
});
const request=(action:string,payload:unknown)=>new Request("https://qa.invalid/function",{
 method:"POST",
 headers:{authorization:"Bearer synthetic-integration-token-test-12345678",
  "content-type":"application/json"},
 body:JSON.stringify({action,payload})
});
const active=()=>({user_id:OWNER,access_state:"active",
 authorized_at:new Date(Date.now()-60000).toISOString(),revoked_at:null});
function fakeBackend(options:{revoked?:boolean;badOwner?:boolean;missing?:boolean;authDenied?:boolean}={}){
 const routes:string[]=[];
 const backend:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));
  routes.push(url.pathname);
  assert.equal(url.origin,QA,"no cross-tenant request");
  assert.equal(init?.method??"GET","GET","never mutate database");
  assert.equal(init?.redirect,"error","redirect must fail closed");
  if(url.pathname==="/auth/v1/user"){
   return options.authDenied?Response.json({error:"login"},{status:401}):
    Response.json({id:OWNER,is_anonymous:false});
  }
  if(url.pathname==="/rest/v1/account_memberships")return Response.json([active()]);
  if(url.pathname==="/rest/v1/mesh_devices"){
   assert.equal(url.searchParams.get("owner_user_id"),"eq."+OWNER);
   const source=fixture.send.sourceDeviceId,target=fixture.send.targetDeviceId;
   const ids=url.searchParams.get("device_id")??"";
   const make=(device_id:string,signing_public_key:string)=>({
     device_id,signing_public_key,
     owner_user_id:options.badOwner?"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa":OWNER,
     membership_state:"discovered",revoked_at:options.revoked?"2026-11-01T00:00:00Z":null
   });
   if(options.missing)return Response.json([]);
   if(ids.includes("in.("))return Response.json([
    make(source,fixture.sourcePublicKey),make(target,fixture.targetPublicKey)]);
   if(ids==="eq."+target)return Response.json([make(target,fixture.targetPublicKey)]);
   throw Error("BAD_DEVICE_QUERY:"+ids);
  }
  throw Error("UNEXPECTED_ROUTE:"+url.pathname);
 };
 return {backend,routes};
}
test("verify-only Edge endpoint accepts original Rust-signed send and recipient read proofs",async()=>{
 for(const [action,payload] of [
  ["verify-send",fixture.send],["verify-recipient",fixture.recipient]
 ] as const){
  const b=fakeBackend();
  const result=await handleInboxPreviewV2(request(action,payload),env(),b.backend,fixture.nowMs);
  assert.equal(result.status,200,JSON.stringify(await result.clone().json()));
  const receipt=await result.json();
  assert.equal(receipt.verifyOnly,true);
  assert.equal(receipt.invitationCreated,false);
  assert.equal(receipt.decisionApplied,false);
  assert.equal(receipt.paired,false);
  assert.equal(receipt.remoteJobsEnabled,false);
  assert.deepEqual(b.routes,[
   "/auth/v1/user","/rest/v1/account_memberships",
   "/rest/v1/mesh_devices","/rest/v1/account_memberships"
  ]);
 }
});
test("wrong deployment/project/production origin denies before any network request",async()=>{
 for(const change of [
  {SUPABASE_URL:LIVE},
  {SUPABASE_URL:QA+"/wrong"},
  {KATOSYNC_MESH_RELAY_QA_PROJECT_REF:"xxxxxxxxxxxxxxxxxxxx"},
  {DENO_DEPLOYMENT_ID:""},
  {KATOSYNC_MESH_INBOX_V2_QA_STAGE:""},
  {KATOSYNC_MESH_RELAY_QA_MODE:""},
  {SUPABASE_SERVICE_ROLE_KEY:"public-qa-test"}
 ]){
  let count=0;
  const result=await handleInboxPreviewV2(request("verify-send",fixture.send),
   env(change),async()=>{count++;throw Error("NO_NETWORK");},fixture.nowMs);
  assert.equal(result.status,503,JSON.stringify(change));
  assert.equal(count,0);
 }
});
test("tampering, unauthorized user, invalid owner and missing/revoked roster fail closed",async()=>{
 const bad=await handleInboxPreviewV2(
  request("verify-send",{...fixture.send,targetDeviceId:"44444444-4444-4444-8444-444444444444"}),
  env(),fakeBackend().backend,fixture.nowMs);
 assert.equal(bad.status,403);
 for(const variant of [{revoked:true},{badOwner:true},{missing:true}]){
  const b=fakeBackend(variant);
  const res=await handleInboxPreviewV2(request("verify-recipient",fixture.recipient),
   env(),b.backend,fixture.nowMs);
  assert.equal(res.status,403);
 }
 const unauth=fakeBackend({authDenied:true});
 assert.equal((await handleInboxPreviewV2(request("verify-recipient",fixture.recipient),
  env(),unauth.backend,fixture.nowMs)).status,401);
});
test("cannot accept unsigned auto-invites, unknown actions or oversized input",async()=>{
 for(const [action,payload] of [
  ["send",fixture.send],
  ["verify-send",{...fixture.send,origin:LIVE}],
  ["verify-recipient",{...fixture.recipient,action:"accept"}],
  ["verify-send",{...fixture.send,unknown:"X".repeat(2800)}],
 ] as const){
  let hits=0;
  const res=await handleInboxPreviewV2(request(action,payload),env(),
   async()=>{hits++;throw Error("NETWORK_FORBIDDEN");},fixture.nowMs);
  assert.equal(res.status,400);
  assert.equal(hits,0);
 }
});
