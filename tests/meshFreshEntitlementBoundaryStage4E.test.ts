// KatoSync Stage4E – synthetic QA-only runtime tests for new boundary.
// No real API secrets, no Supabase connection, no device enrollment or jobs.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {build} from "esbuild";
import {withFreshMeshEntitlement,MESH_ENTITLEMENT_QA_ORIGIN} from
 "../supabase/functions/mesh-entitlement-boundary-qa/guard.ts";

const OWNER="11111111-1111-4111-8111-111111111111";
const QA="https://abcdefghijklmnopqrst.supabase.co";
const TOKEN="Bearer "+"a".repeat(60);
const KEY="test-service-role-secret-only-qa-01234567890";
const ANON="test-anon-public-key-only-qa-0123456789";
type Mode="active"|"free"|"expired"|"malformed"|"unavailable";
function endpoint(origin=MESH_ENTITLEMENT_QA_ORIGIN){
 return {origin,anonKey:ANON,serviceKey:KEY,stage:"qa-entitlement-boundary"};
}
function post(){
 return new Request("https://client.example/mesh",{method:"POST",
  headers:{authorization:TOKEN,"content-type":"application/json"},
  body:JSON.stringify({intent:"signed-mesh-qa"})});
}
function fixture(config:{
 origin?:string;policy?:Mode;policies?:Mode[];memberStates?:boolean[];
 foreignUser?:boolean;anonymous?:boolean;
}={}){
 const origin=config.origin??MESH_ENTITLEMENT_QA_ORIGIN;
 const calls:string[]=[];let policies=0,members=0,sensitive=0;
 const request:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  assert.equal(url.origin,origin,"cannot mix QA tenant with production");
  assert.equal(init?.redirect??"error","error");
  calls.push(url.pathname);
  if(url.pathname==="/auth/v1/user"){
   assert.equal((init?.headers as Record<string,string>).Authorization,TOKEN);
   return Response.json({id:config.foreignUser?"wrong":OWNER,
    is_anonymous:config.anonymous??false});
  }
  if(url.pathname==="/rest/v1/account_memberships"){
   assert.equal(url.searchParams.get("user_id"),"eq."+OWNER);
   const ok=config.memberStates?.[members]??true;members++;
   return Response.json(ok?[{user_id:OWNER,access_state:"active",
     authorized_at:"2026-11-01T00:00:00Z",revoked_at:null}]:[]);
  }
  if(url.pathname==="/rest/v1/mesh_owner_policy"){
   assert.equal(url.searchParams.get("owner_user_id"),"eq."+OWNER);
   assert.equal(url.searchParams.get("select"),"allowed_devices,policy_expires_at");
   assert.equal(url.searchParams.get("limit"),"2");
   const mode=config.policies?.[policies]??config.policy??"active";
   policies++;
   if(mode==="unavailable")return new Response("upstream down",{status:503});
   if(mode==="free")return Response.json([]);
   if(mode==="malformed")return Response.json([{allowed_devices:20,policy_expires_at:"bad"}]);
   if(mode==="expired")return Response.json([{allowed_devices:10,
     policy_expires_at:new Date(Date.now()-1000).toISOString()}]);
   return Response.json([{allowed_devices:10,
     policy_expires_at:new Date(Date.now()+60000).toISOString()}]);
  }
  if(url.pathname==="/rest/v1/mesh_invites"||
    url.pathname==="/rest/v1/mesh_pairing_relay_messages"||
    url.pathname==="/rest/v1/mesh_inbox_proofs"){
   assert.equal(init?.redirect,"error","never follow a bearer-bearing Mesh redirect");
   assert.equal(init?.cache,"no-store","do not reuse old entitlement responses");
   sensitive++;
   return Response.json([{id:"qa-stored"}]);
  }
  throw Error("unexpected-url:"+url.pathname);
 };
 return {request,calls,counts:()=>({policies,members,sensitive})};
}

test("disabled deployment switch, invalid origin, malformed bearer, auth user fail before handler",async()=>{
 for(const env of [
  {...endpoint(),stage:""},
  {...endpoint(),stage:"qa"},
  {...endpoint(),origin:"https://evil.example"},
  {...endpoint(),origin:QA+"/unsafe"},
  {...endpoint(),serviceKey:ANON},
 ]){
  let calls=0;
  const result=await withFreshMeshEntitlement(post(),env,
   (async()=>{calls++;throw Error("network used")}) as typeof fetch,
   async()=>{throw Error("handler started");});
  assert.equal(result.status,503);
  assert.equal(calls,0);
 }
 const noAuth=new Request("https://client.example",{method:"POST"});
 const never=async()=>{throw Error("handler started");};
 assert.equal((await withFreshMeshEntitlement(noAuth,endpoint(),fixture().request,never)).status,401);
 assert.equal((await withFreshMeshEntitlement(post(),endpoint(),fixture({foreignUser:true}).request,never)).status,401);
 assert.equal((await withFreshMeshEntitlement(post(),endpoint(),fixture({anonymous:true}).request,never)).status,401);
});
test("missing/expired/malformed/unavailable policy fail closed without sensitive access",async()=>{
 for(const [mode,status] of [
  ["free",403],["expired",403],["malformed",503],["unavailable",503]
 ] as const){
  const f=fixture({policy:mode});let called=false;
  const res=await withFreshMeshEntitlement(post(),endpoint(),f.request,async()=>{
   called=true;return Response.json({accepted:true});
  });
  assert.equal(res.status,status,mode);
  assert.equal(called,false);
  assert.equal(f.counts().sensitive,0);
 }
});
test("fresh authenticated owner with explicit policy may reach signed handler, no job rights",async()=>{
 const f=fixture();const res=await withFreshMeshEntitlement(
  post(),endpoint(),f.request,async guarded=>{
   const x=await guarded(MESH_ENTITLEMENT_QA_ORIGIN+"/rest/v1/mesh_invites",{
    method:"POST",redirect:"error"});
   assert.equal(x.status,200);
   return Response.json({deliveryOnly:true,paired:false,
    transportReady:false,remoteJobsEnabled:false});
  });
 assert.equal(res.status,200);
 assert.deepEqual(await res.json(),{deliveryOnly:true,paired:false,
  transportReady:false,remoteJobsEnabled:false});
 assert.equal(f.counts().sensitive,1);
 assert.ok(f.counts().policies>=3); // ingress, before DB action, response
});
test("mid-request expiry blocks sensitive write; old permit cannot be reused",async()=>{
 const f=fixture({policies:["active","expired"]});
 const res=await withFreshMeshEntitlement(post(),endpoint(),f.request,async guarded=>{
  const denied=await guarded(MESH_ENTITLEMENT_QA_ORIGIN+"/rest/v1/mesh_invites",
    {method:"POST"});
  assert.equal(denied.status,403);
  return Response.json({deliveryOnly:true});
 });
 assert.equal(res.status,403);
 assert.deepEqual(await res.json(),{error:"MESH_PRO_REQUIRED"});
 assert.equal(f.counts().sensitive,0);
});
test("revoked membership before write blocks even a valid paid policy",async()=>{
 const f=fixture({memberStates:[true,false]});
 const res=await withFreshMeshEntitlement(post(),endpoint(),f.request,async guarded=>{
  await guarded(MESH_ENTITLEMENT_QA_ORIGIN+"/rest/v1/mesh_pairing_relay_messages",{method:"POST"});
  return Response.json({deliveryOnly:true});
 });
 assert.equal(res.status,403);
 assert.equal(f.counts().sensitive,0);
});
test("mid-request policy outage or missing policy also fails closed",async()=>{
 for(const mode of ["unavailable","free"] as const){
  const f=fixture({policies:["active",mode]});
  const res=await withFreshMeshEntitlement(post(),endpoint(),f.request,async guarded=>{
   await guarded(MESH_ENTITLEMENT_QA_ORIGIN+"/rest/v1/mesh_inbox_proofs",{method:"POST"});
   return Response.json({deliveryOnly:true});
  });
  assert.equal(res.status,mode==="free"?403:503);
  assert.equal(f.counts().sensitive,0);
 }
});
test("final response does not return signed delivery after a late policy downgrade",async()=>{
 const f=fixture({policies:["active","active","free"]});
 const res=await withFreshMeshEntitlement(post(),endpoint(),f.request,async guarded=>{
  const first=await guarded(MESH_ENTITLEMENT_QA_ORIGIN+"/rest/v1/mesh_invites",{method:"GET"});
  assert.equal(first.status,200);
  return Response.json({invitations:[{secret:"qa-only"}]});
 });
 assert.equal(res.status,403);
 assert.deepEqual(await res.json(),{error:"MESH_PRO_REQUIRED"});
 // This is NOT an atomic write rollback; only output and pre-write checks.
 assert.equal(f.counts().sensitive,1);
});
test("cross-tenant fetch rejected before network, including live from isolated QA",async()=>{
 for(const origin of [QA,MESH_ENTITLEMENT_QA_ORIGIN]){
  const f=fixture({origin}),other=origin===QA?MESH_ENTITLEMENT_QA_ORIGIN:QA;
  const res=await withFreshMeshEntitlement(post(),endpoint(origin),f.request,
   async guarded=>{
    const denied=await guarded(other+"/rest/v1/mesh_invites",{method:"POST"});
    assert.equal(denied.status,503);
    return Response.json({deliveryOnly:true});
   });
  assert.equal(res.status,503);
  assert.equal(f.counts().sensitive,0);
  assert.ok(f.calls.every(x=>x==="/auth/v1/user"||
   x==="/rest/v1/account_memberships"||x==="/rest/v1/mesh_owner_policy"));
 }
});
test("five NEW QA-only entrypoints enforce boundary; historic originals remain hash-pinned",()=>{
 const root=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
 for(const name of ["mesh-device-enrollment","mesh-device-presence-qa",
   "mesh-inbox-send","mesh-inbox-receive","mesh-pairing-relay"]){
  const source=root("supabase/functions/"+name+"-entitled-qa/index.ts");
  assert.match(source,/withFreshMeshEntitlement\(/,name);
  assert.match(source,/KATOSYNC_MESH_ENTITLEMENT_BOUNDARY_STAGE/,name);
  assert.match(source,/guarded=>/,name);
  assert.match(source,/NOT DEPLOYED/,name);
  assert.doesNotMatch(source,/allowWithoutEntitlement|remoteJobsEnabled:true/i);
  const oldIndex=root("supabase/functions/"+name+"/index.ts");
  assert.doesNotMatch(oldIndex,/withFreshMeshEntitlement\(/);
 }
 for(const [name,expected] of Object.entries({
  "mesh-inbox-send/index.ts":"a53cd30a75f0a24d0cbab97d10d56679068fb18d0f4e99d4efe9c79e9196a916",
  "mesh-inbox-receive/index.ts":"88acdcfc08a23d39cae92460dfffb28666d8952fa3accce79d0fcc535b2c3b7d",
  "mesh-inbox-send/send.ts":"74d27e69f91140fba8141b55d7bef1f6d96bf7c83226b1df81d4c5d03bd103ba",
  "mesh-inbox-receive/receive.ts":"bd76bbf3fa5c530760b510259f7a4f927c406f0d3c94aaf3e3fdd66dc4f4d099",
 })){
  const actual=createHash("sha256").update(root("supabase/functions/"+name)).digest("hex");
  assert.equal(actual,expected,name);
 }
 const oldSend=root("supabase/functions/mesh-inbox-send/send.ts");
 const oldReceive=root("supabase/functions/mesh-inbox-receive/receive.ts");
 assert.match(oldSend,/verifyStoredSignedMeshInvite/);
 assert.match(oldReceive,/verifyDeviceProof/);
});
test("all five isolated QA entrypoints compile in neutral esbuild without deployment",async()=>{
 for(const name of ["mesh-device-enrollment","mesh-device-presence-qa",
  "mesh-inbox-send","mesh-inbox-receive","mesh-pairing-relay"]){
  const file=new URL("../supabase/functions/"+name+"-entitled-qa/index.ts",import.meta.url);
  const bundle=await build({entryPoints:[file.pathname],write:false,
   bundle:true,platform:"neutral",format:"esm",target:"es2022",
   logLevel:"silent",metafile:true});
  assert.equal(bundle.outputFiles.length,1,name);
  const source=Buffer.from(bundle.outputFiles[0].contents).toString("utf8");
  assert.match(source,/MESH_BOUNDARY_DISABLED/,name);
  assert.match(source,/MESH_PRO_REQUIRED/,name);
  assert.match(source,/Deno\.serve/,name);
 }
});
