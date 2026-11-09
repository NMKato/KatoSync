// NMKato Solutions — native Deno 2 runtime QA, never touches real KATOOS.
// Permissionless synthetic fetch adapter and owner-scoped policy evaluation.
import {withFreshMeshEntitlement} from "../../supabase/functions/mesh-entitlement-boundary-qa/guard.ts";
const origin="https://abcdefghijklmnopqrst.supabase.co";
const owner="11111111-1111-4111-8111-111111111111";
const env={origin,anonKey:"anon-test-credential-0123456789012",
 serviceKey:"private-test-credential-0123456789",stage:"qa-entitlement-boundary"};
const bearer="Bearer "+"k".repeat(60);
const request=()=>new Request("https://qa.test/signed-envelope",{method:"POST",
 headers:{authorization:bearer,"content-type":"application/json"},
 body:'{"action":"list"}'});
function equal(actual:unknown,expected:unknown,reason:string){
 if(actual!==expected)throw Error(reason+": "+String(actual)+" != "+String(expected));
}
function fake(modes:string[],membership:boolean[]=[true,true,true,true]){
 let p=0,m=0,writes=0;
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  equal(url.origin,origin,"unexpected network target");
  if(url.pathname==="/auth/v1/user")return Response.json({id:owner,is_anonymous:false});
  if(url.pathname==="/rest/v1/account_memberships"){
   const allowed=membership[m++]??true;
   return Response.json(allowed?[{user_id:owner,access_state:"active",
    authorized_at:"2026-11-09T08:00:00Z",revoked_at:null}]:[]);
  }
  if(url.pathname==="/rest/v1/mesh_owner_policy"){
   const mode=modes[p++]??"active";
   if(mode==="free")return Response.json([]);
   if(mode==="offline")return new Response("down",{status:503});
   if(mode==="expired")return Response.json([{
    allowed_devices:10,policy_expires_at:new Date(Date.now()-5_000).toISOString()
   }]);
   return Response.json([{
    allowed_devices:10,policy_expires_at:new Date(Date.now()+60_000).toISOString()
   }]);
  }
  if(url.pathname==="/rest/v1/mesh_invites"){
   equal(init?.redirect,"error","redirect forbid");
   writes++;
   return Response.json([{ok:true}]);
  }
  throw Error("unexpected synthetic fetch path");
 };
 return {fetcher,count:()=>({policies:p,members:m,writes})};
}
Deno.test("permissionless native Deno: disabled QA flag cannot start handler",async()=>{
 let hit=false;
 const f=fake(["active"]);
 const answer=await withFreshMeshEntitlement(request(),{...env,stage:""},
  f.fetcher,async()=>{hit=true;return Response.json({ok:true});});
 equal(answer.status,503,"disabled status");equal(hit,false,"handler called");
 equal(f.count().policies,0,"policy queried");
});
Deno.test("permissionless native Deno: Free zero cannot send signed Mesh data",async()=>{
 const f=fake(["free"]);let touched=false;
 const response=await withFreshMeshEntitlement(request(),env,f.fetcher,async()=>{
  touched=true;return Response.json({ok:true});
 });
 equal(response.status,403,"Free status");
 equal(touched,false,"Free handler started");
 equal(f.count().writes,0,"Free wrote data");
});
Deno.test("permissionless native Deno: mid-request expiry blocks write and result",async()=>{
 const f=fake(["active","expired"]);
 const response=await withFreshMeshEntitlement(request(),env,f.fetcher,async guarded=>{
  const blocked=await guarded(origin+"/rest/v1/mesh_invites",{method:"POST"});
  equal(blocked.status,403,"write blocked");
  return Response.json({paired:true,remoteJobsEnabled:true});
 });
 equal(response.status,403,"final denied");
 equal(f.count().writes,0,"expiring trial wrote Mesh");
});
Deno.test("permissionless native Deno: valid signed-handler result still grants no job rights",async()=>{
 const f=fake(["active","active","active"]);
 const response=await withFreshMeshEntitlement(request(),env,f.fetcher,async guarded=>{
  const r=await guarded(origin+"/rest/v1/mesh_invites",{method:"POST"});
  equal(r.status,200,"write allowed for authorized owner");
  return Response.json({deliveryOnly:true,paired:false,remoteJobsEnabled:false});
 });
 equal(response.status,200,"authorized response");
 const body=await response.json();
 equal(body.remoteJobsEnabled,false,"no job rights");
 equal(f.count().writes,1,"expected exactly one synthetic write");
});
Deno.test("permissionless native Deno: revoked member fails before sensitive write",async()=>{
 const f=fake(["active"],[true,false]);
 const response=await withFreshMeshEntitlement(request(),env,f.fetcher,async guarded=>{
  await guarded(origin+"/rest/v1/mesh_invites",{method:"POST"});
  return Response.json({ok:true});
 });
 equal(response.status,403,"revocation denial");
 equal(f.count().writes,0,"revoked member wrote Mesh");
});
Deno.test("permissionless native Deno: wrong tenant blocked without upstream request",async()=>{
 const f=fake(["active"]);
 const response=await withFreshMeshEntitlement(request(),env,f.fetcher,async guarded=>{
  const x=await guarded("https://xbnnlyyxiilklsygxcof.supabase.co/rest/v1/mesh_invites",{method:"POST"});
  equal(x.status,503,"origin denied");
  return Response.json({deliveryOnly:true});
 });
 equal(response.status,503,"cross-tenant response");
 equal(f.count().writes,0,"cross-tenant write");
});
