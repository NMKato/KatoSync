import {test} from "node:test";
import assert from "node:assert/strict";
import {parseMeshDeviceAllowance,readMeshDeviceAllowance} from
 "../supabase/functions/mesh-device-enrollment/device-entitlement.ts";
import {handleMeshEnrollmentChallenge} from
 "../supabase/functions/mesh-device-enrollment/handler.ts";
import {readFileSync} from "node:fs";
const owner="11111111-1111-4111-8111-111111111111";
const origin="https://xbnnlyyxiilklsygxcof.supabase.co";
const env={SUPABASE_URL:origin,SUPABASE_ANON_KEY:"test-anon",
 SUPABASE_SERVICE_ROLE_KEY:"test-service",KATOSYNC_MESH_ENROLLMENT_STAGE:"challenge-and-discovery"};

test("Free has zero Mesh devices; explicit Pro allowance is at most 10",()=>{
 assert.deepEqual(parseMeshDeviceAllowance([]),{kind:"free",max:0});
 assert.deepEqual(parseMeshDeviceAllowance([{allowed_devices:10}]),{kind:"assigned",max:10});
 assert.deepEqual(parseMeshDeviceAllowance([{allowed_devices:5}]),{kind:"assigned",max:5});
 for(const bad of [[{allowed_devices:0}],[{allowed_devices:11}],
    [{allowed_devices:"10"}],[{allowed_devices:2}, {allowed_devices:10}],
    [{allowed_devices:10,secret:"extra"}],null,{}]){
  assert.deepEqual(parseMeshDeviceAllowance(bad),{kind:"unavailable",max:0});
 }
});

test("server reads only owner-scoped policy; error never becomes a Free success",async()=>{
 const calls:string[]=[];
 const requester=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input)); calls.push(url.toString());
  assert.equal(url.origin,origin);
  assert.equal(url.pathname,"/rest/v1/mesh_owner_policy");
  assert.equal(url.searchParams.get("owner_user_id"),"eq."+owner);
  assert.equal(url.searchParams.get("limit"),"2");
  assert.equal((init?.headers as Record<string,string>)["Accept-Profile"],"katosync");
  return Response.json([{allowed_devices:10}]);
 };
 const headers={apikey:"test-service",Authorization:"Bearer test-service"};
 assert.deepEqual(await readMeshDeviceAllowance(owner,headers,requester as typeof fetch),
  {kind:"assigned",max:10});
 assert.equal(calls.length,1);
 assert.deepEqual(await readMeshDeviceAllowance("invalid",headers,requester as typeof fetch),
  {kind:"unavailable",max:0});
 assert.equal(calls.length,1);
 assert.deepEqual(await readMeshDeviceAllowance(owner,headers,
  (async()=>new Response("not found",{status:503})) as typeof fetch),
  {kind:"unavailable",max:0});
});

test("Free account is denied even at challenge issuance, before a write",async()=>{
 const calls:string[]=[];
 const requester=async(input:RequestInfo|URL)=>{
  const url=new URL(String(input));calls.push(url.pathname);
  if(url.pathname==="/auth/v1/user")return Response.json({id:owner,is_anonymous:false});
  if(url.pathname.endsWith("/account_memberships"))return Response.json([{
   user_id:owner,access_state:"active",authorized_at:"2026-10-28T12:00:00Z",revoked_at:null
  }]);
  if(url.pathname.endsWith("/mesh_owner_policy"))return Response.json([]);
  throw new Error("Unexpected write: "+url.pathname);
 };
 const req=new Request("https://local.example/challenge",{method:"POST",
   headers:{Authorization:"Bearer "+"a".repeat(70),"Content-Type":"application/json"},
   body:JSON.stringify({publicKey:"A".repeat(43)})});
 const result=await handleMeshEnrollmentChallenge(req,env,requester as typeof fetch);
 assert.equal(result.status,403);
 assert.deepEqual(await result.json(),{error:"MESH_PRO_REQUIRED"});
 assert.deepEqual(calls,["/auth/v1/user","/rest/v1/account_memberships","/rest/v1/mesh_owner_policy"]);
});

test("native UI keeps plan denial distinct and does not pair devices",()=>{
 const rust=readFileSync(new URL("../src-tauri/src/mesh_enrollment_client.rs",import.meta.url),"utf8");
 const ui=readFileSync(new URL("../src/components/MeshConnectionCard.tsx",import.meta.url),"utf8");
 assert.match(rust,/MESH_DISCOVERY_PRO_REQUIRED/);
 assert.match(ui,/mesh\\.directory\\.proRequired|mesh.directory.proRequired/);
 assert.match(ui,/MESH_DISCOVERY_PRO_REQUIRED/);
 for(const lang of ["de","en","es","ru"]){
  const text=readFileSync(new URL("../src/i18n/locales/"+lang+".ts",import.meta.url),"utf8");
  assert.ok(text.includes('"mesh.directory.proRequired":'),lang);
 }
});
