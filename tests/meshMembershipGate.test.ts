// Created by NMKato Solutions: never issue Mesh privileges from a KATOOS JWT.
import {test} from "node:test";
import assert from "node:assert/strict";
import {evaluateMembership,requireKatoSyncMembership} from "../supabase/functions/mesh-device-enrollment/membership-gate.ts";
import {handleMeshEnrollmentChallenge} from "../supabase/functions/mesh-device-enrollment/handler.ts";
import {completeMeshDeviceDiscovery} from "../supabase/functions/mesh-device-enrollment/complete.ts";

const owner="11111111-1111-4111-8111-111111111111";
const url="https://xbnnlyyxiilklsygxcof.supabase.co";
const env={SUPABASE_URL:url,SUPABASE_ANON_KEY:"test-anon",SUPABASE_SERVICE_ROLE_KEY:"test-service",KATOSYNC_MESH_ENROLLMENT_STAGE:"challenge-and-discovery"};
const active={user_id:owner,access_state:"active",authorized_at:"2026-10-28T10:00:00Z",revoked_at:null};
const headers={apikey:"test-service",Authorization:"Bearer test-service"};

test("only one authorized active KatoSync membership passes",()=>{
 const now=Date.parse("2026-10-28T20:00:00Z");
 assert.equal(evaluateMembership([active],owner,now),"active");
 for(const entries of [
   [],[{...active,access_state:"pending"}],
   [{...active,access_state:"suspended"}],
   [{...active,access_state:"revoked",revoked_at:"2026-10-28T16:00:00Z"}]
 ])assert.equal(evaluateMembership(entries,owner,now),"not_member");
 for(const entries of [[active,active],[{...active,user_id:"22222222-2222-4222-8222-222222222222"}],
 [{...active,authorized_at:null}],[{...active,authorized_at:"2099-01-01T00:00:00Z"}],
 [{...active,revoked_at:"2026-10-28T16:00:00Z"}],[{...active,access_state:"connected"}],null])
 assert.equal(evaluateMembership(entries,owner,now),"unavailable");
});
test("server membership lookup uses exact owner scope and profile, no permissive fallback",async()=>{
 let calls=0;
 const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{
  calls++;
  const u=new URL(String(input));
  assert.equal(u.pathname,"/rest/v1/account_memberships");
  assert.equal(u.searchParams.get("user_id"),"eq."+owner);
  assert.equal((init?.headers as Record<string,string>)?.["Accept-Profile"],"katosync");
  return Response.json([active]);
 };
 assert.equal(await requireKatoSyncMembership(owner,headers,fetcher as typeof fetch),"active");
 assert.equal(calls,1);
 assert.equal(await requireKatoSyncMembership("wrong",headers,fetcher as typeof fetch),"unavailable");
 assert.equal(calls,1);
 assert.equal(await requireKatoSyncMembership(owner,headers,(async()=>{throw Error("offline");}) as typeof fetch),"unavailable");
});
test("ordinary KATOOS auth account cannot issue Mesh challenges without KatoSync membership",async()=>{
 const writes:string[]=[];
 const request=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const uri=String(input);
  if(uri.endsWith("/auth/v1/user"))return Response.json({id:owner,is_anonymous:false});
  if(uri.includes("account_memberships"))return Response.json([]);
  writes.push(String(init?.method??"GET")); throw Error("Should not reach write");
 };
 const req=new Request("https://test.example/mesh",{method:"POST",headers:{
  Authorization:"Bearer "+ "a".repeat(80),"content-type":"application/json"
 },body:JSON.stringify({publicKey:"A".repeat(43)})});
 const res=await handleMeshEnrollmentChallenge(req,env,request as typeof fetch);
 assert.equal(res.status,403);
 assert.deepEqual(await res.json(),{error:"KATOSYNC_MEMBERSHIP_REQUIRED"});
 assert.deepEqual(writes,[]);
});
test("ordinary KATOOS auth account cannot consume proof or register device",async()=>{
 const writes:string[]=[];
 const request=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const uri=String(input);
  if(uri.endsWith("/auth/v1/user"))return Response.json({id:owner,is_anonymous:false});
  if(uri.includes("account_memberships"))return Response.json([]);
  writes.push(String(init?.method??"GET"));throw Error("Should not reach write");
 };
 const req=new Request("https://test.example/mesh/complete",{method:"POST",headers:{
  Authorization:"Bearer "+ "a".repeat(80),"content-type":"application/json"
 },body:JSON.stringify({
  protocol:"katosync-mesh-enrollment-proof-v1",
  challengeId:"22222222-2222-4222-8222-222222222222",
  nonce:"A".repeat(43),publicKey:"A".repeat(43),
  expiresAt:new Date(Date.now()+30000).toISOString(),
  signature:"A".repeat(86),deviceName:"Mac",platformOs:"macos"
 })});
 const res=await completeMeshDeviceDiscovery(req,env,request as typeof fetch);
 assert.equal(res.status,403);
 assert.deepEqual(await res.json(),{error:"KATOSYNC_MEMBERSHIP_REQUIRED"});
 assert.deepEqual(writes,[]);
});
