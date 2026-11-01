// NMKato Solutions — Stage 3O. No Supabase calls, credentials, devices or writes.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {handleMeshPreviewReadiness} from
 "../supabase/functions/mesh-preview-readiness/handler.ts";
const REF="abcdefghijklmnopqrst";
const QA="https://"+REF+".supabase.co";
const PROD="https://xbnnlyyxiilklsygxcof.supabase.co";
const OWNER="11111111-1111-4111-8111-111111111111";
const OTHER="99999999-9999-4999-8999-999999999999";
const TABLES=["mesh_enrollment_challenges","mesh_owner_policy","mesh_devices",
 "mesh_invites","mesh_inbox_proofs","mesh_pairing_relay_messages",
 "mesh_pairing_relay_reads"];
const env=(changes:Record<string,string>={})=>({
 SUPABASE_URL:QA,SUPABASE_ANON_KEY:"unit-test-public-key",
 SUPABASE_SERVICE_ROLE_KEY:"unit-test-private-server-key",
 KATOSYNC_MESH_PREVIEW_READINESS_STAGE:"read-only-probe",
 KATOSYNC_MESH_RELAY_QA_MODE:"isolated-preview-only",
 KATOSYNC_MESH_RELAY_QA_PROJECT_REF:REF,
 DENO_DEPLOYMENT_ID:REF+"_11111111-1111-4111-8111-111111111111_1",
 ...changes
});
const request=(changes:{method?:string;body?:string;token?:string;contentType?:string}={})=>
 new Request("https://local.invalid/functions/v1/mesh-preview-readiness",{
  method:changes.method??"POST",
  headers:{authorization:changes.token??"Bearer synthetic-test-only-account-token-1234567890",
   "content-type":changes.contentType??"application/json"},
  ...(changes.method==="GET"?{}:{body:changes.body??'{"action":"probe"}'})
 });
const active=()=>({user_id:OWNER,access_state:"active",
 authorized_at:new Date(Date.now()-60_000).toISOString(),revoked_at:null});
function backend(opts:{identity?:number;membership?:"active"|"suspended"|"revoked_after_first";
 brokenTable?:string;poisonTable?:string;largeTable?:string}={}){
 const paths:string[]=[];
 let checks=0;
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));paths.push(url.pathname);
  assert.equal(url.origin,QA,"all calls must remain in the same isolated preview");
  assert.equal(init?.method??"GET","GET","QA must never write to PostgREST");
  assert.equal(init?.redirect??"error","error","no cross-origin redirects");
  if(url.pathname==="/auth/v1/user"){
   assert.equal(init?.headers?.constructor,Object);
   return opts.identity===401?Response.json({error:"invalid"},{status:401}):
    Response.json({id:OWNER,is_anonymous:false});
  }
  if(url.pathname==="/rest/v1/account_memberships"){
   checks++;
   if(opts.membership==="suspended")return Response.json([{...active(),access_state:"suspended"}]);
   if(opts.membership==="revoked_after_first"&&checks>1)
    return Response.json([{...active(),access_state:"revoked",revoked_at:new Date().toISOString()}]);
   return Response.json([active()]);
  }
  const table=url.pathname.slice("/rest/v1/".length);
  assert.ok(TABLES.includes(table),"unexpected table "+table);
  assert.equal(url.searchParams.get("select"),"owner_user_id");
  assert.equal(url.searchParams.get("owner_user_id"),"eq."+OWNER);
  assert.equal(url.searchParams.get("limit"),"1");
  if(table===opts.brokenTable)return Response.json({code:"PGRST205"},{status:404});
  if(table===opts.poisonTable)return Response.json([{owner_user_id:OTHER}]);
  if(table===opts.largeTable)return Response.json([{owner_user_id:OWNER,note:"X".repeat(3000)}]);
  return Response.json([]);
 };
 return {paths,fetcher};
}
test("QA-only preview passes online user, active membership and seven owner-filtered schema reads",async()=>{
 const b=backend();
 const res=await handleMeshPreviewReadiness(request(),env(),b.fetcher);
 assert.equal(res.status,200);
 assert.deepEqual(await res.json(),{
  result:"QA_SCHEMA_READ_ONLY_READY",probeOnly:true,authenticated:true,
  tenantOriginVerified:true,requiredTablesVerified:7,
  discoveryEnabled:false,inviteSendEnabled:false,inviteDecisionsEnabled:false,
  paired:false,transportReady:false,remoteJobsEnabled:false
 });
 assert.equal(b.paths.length,10);
 assert.equal(b.paths.filter(x=>x==="/rest/v1/account_memberships").length,2);
 for(const t of TABLES)assert.ok(b.paths.includes("/rest/v1/"+t));
});
test("wrong project, missing preview deployment, production mode and invalid keys deny before any network",async()=>{
 const scenarios=[
  {SUPABASE_URL:PROD},
  {SUPABASE_URL:"https://evil.invalid"},
  {SUPABASE_URL:QA+"/auth/v1"},
  {KATOSYNC_MESH_PREVIEW_READINESS_STAGE:""},
  {KATOSYNC_MESH_RELAY_QA_MODE:""},
  {KATOSYNC_MESH_RELAY_QA_PROJECT_REF:"xxxxxxxxxxxxxxxxxxxx"},
  {DENO_DEPLOYMENT_ID:""},
  {DENO_DEPLOYMENT_ID:"xbnnlyyxiilklsygxcof_11111111-1111-4111-8111-111111111111_1"},
  {SUPABASE_SERVICE_ROLE_KEY:"unit-test-public-key"},
  {SUPABASE_ANON_KEY:""}
 ];
 for(const variant of scenarios){
  let calls=0;
  const denied=await handleMeshPreviewReadiness(request(),env(variant),async()=>{
   calls++;throw Error("UNEXPECTED_NETWORK");
  });
  assert.equal(denied.status,503,JSON.stringify(variant));
  assert.equal(calls,0,JSON.stringify(variant));
 }
});
test("only exact POST probe accepted; invalid auth input cannot reach SQL",async()=>{
 for(const opts of [{method:"GET"},{body:'{"action":"probe","trust":true}'},
  {body:"{}"},{body:"X".repeat(250)},
  {contentType:"text/plain"},
  {token:"Bearer invalid"}]){
  let calls=0;
  const denied=await handleMeshPreviewReadiness(request(opts),env(),async()=>{
   calls++;throw Error("UNEXPECTED_NETWORK");
  });
  assert.ok([400,401,405].includes(denied.status));
  assert.equal(calls,0);
 }
});
test("expired online JWT and suspended membership fail closed",async()=>{
 const expired=backend({identity:401});
 assert.equal((await handleMeshPreviewReadiness(request(),env(),expired.fetcher)).status,401);
 assert.deepEqual(expired.paths,["/auth/v1/user"]);
 const suspended=backend({membership:"suspended"});
 const res=await handleMeshPreviewReadiness(request(),env(),suspended.fetcher);
 assert.equal(res.status,403);
 assert.ok(suspended.paths.every(p=>!TABLES.some(t=>p==="/rest/v1/"+t)));
});
test("revocation after seven table checks prevents false readiness",async()=>{
 const b=backend({membership:"revoked_after_first"});
 const res=await handleMeshPreviewReadiness(request(),env(),b.fetcher);
 assert.equal(res.status,403);
 assert.ok(b.paths.includes("/rest/v1/mesh_pairing_relay_reads"));
});
test("missing migrations, oversized responses and cross-owner rows fail closed",async()=>{
 for(const options of [{brokenTable:"mesh_inbox_proofs"},{poisonTable:"mesh_devices"},
  {largeTable:"mesh_invites"}]){
  const b=backend(options);
  const res=await handleMeshPreviewReadiness(request(),env(),b.fetcher);
  assert.equal(res.status,503);
  assert.notEqual((await res.json()).result,"QA_SCHEMA_READ_ONLY_READY");
 }
});
test("reviewed production Inbox source hashes remain unchanged",()=>{
 const root=new URL("../",import.meta.url);
 const hashes={
  "supabase/functions/mesh-inbox-send/send.ts":"74d27e69f91140fba8141b55d7bef1f6d96bf7c83226b1df81d4c5d03bd103ba",
  "supabase/functions/mesh-inbox-receive/receive.ts":"bd76bbf3fa5c530760b510259f7a4f927c406f0d3c94aaf3e3fdd66dc4f4d099",
  "supabase/functions/mesh-device-enrollment/membership-gate.ts":"a51592178bd4a899b31686125f807836c0fed35de41453f820f459f95bf45f0c"
 };
 for(const [name,expected] of Object.entries(hashes)){
  const actual=createHash("sha256").update(readFileSync(new URL(name,root))).digest("hex");
  assert.equal(actual,expected,name);
 }
});
