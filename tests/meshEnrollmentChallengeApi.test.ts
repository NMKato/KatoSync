// Created by NMKato Solutions: no network or credentials in enrollment tests.
import {test} from "node:test";
import assert from "node:assert/strict";
import {handleMeshEnrollmentChallenge} from "../supabase/functions/mesh-device-enrollment/handler.ts";

const origin="https://xbnnlyyxiilklsygxcof.supabase.co";
const uid="11111111-1111-4111-8111-111111111111";
const env={SUPABASE_URL:origin,SUPABASE_ANON_KEY:"qa-publishable-key",SUPABASE_SERVICE_ROLE_KEY:"server-only-test-secret",KATOSYNC_MESH_ENROLLMENT_STAGE:"challenge-only"};
const body={publicKey:"A".repeat(43)};
function makeReq(data:unknown=body,token="example-verified-jwt-credential-for-tests"){
 return new Request("https://local.example/enrollment",{
  method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},
  body:JSON.stringify(data)
 });
}
function fakeRemote(recentCount=0,authOk=true,insertOk=true){
 let queries=0,inserted:unknown=null;
 const call=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  assert.ok(url.startsWith(origin));
  if(url.includes("/rest/v1/")){
   const header=init?.method==="POST"?"Content-Profile":"Accept-Profile";
   assert.equal((init?.headers as Record<string,string>)?.[header],"katosync");
   assert.ok(!url.includes("katosync_mesh_"));
  }
  if(url.includes("/rest/v1/account_memberships"))return Response.json([{
    user_id:uid,access_state:"active",authorized_at:"2026-10-28T12:00:00Z",revoked_at:null
  }]);
  if(url.endsWith("/auth/v1/user")){
   assert.equal(init?.headers && (init.headers as Record<string,string>).Authorization?.startsWith("Bearer "),true);
   return Response.json(authOk?{id:uid,is_anonymous:false}:{error:"bad"},{status:authOk?200:401});
  }
  if(url.includes("select=challenge_id")){
   queries++;
   assert.ok(url.includes("owner_user_id=eq."));
   return Response.json(Array.from({length:recentCount},()=>({challenge_id:crypto.randomUUID()})));
  }
  if(url.endsWith("/rest/v1/mesh_enrollment_challenges")){
   assert.equal(init?.method,"POST");
   inserted=JSON.parse(String(init?.body));
   return Response.json(insertOk?[{challenge_id:"22222222-2222-4222-8222-222222222222"}]:{error:"failed"},{status:insertOk?201:403});
  }
  throw Error("Unrecognized route");
 };
 return {call:call as typeof fetch,inspection:()=>({queries,inserted})};
}
test("default is fail-closed; no backend call",async()=>{
 let calls=0;
 const r=await handleMeshEnrollmentChallenge(makeReq(),{...env,KATOSYNC_MESH_ENROLLMENT_STAGE:"" },(async()=>{calls++;throw Error();}) as typeof fetch);
 assert.equal(r.status,503);assert.equal(calls,0);
});
test("reject malformed public key before auth",async()=>{
 const r=await handleMeshEnrollmentChallenge(makeReq({publicKey:"../private-key",ownerUserId:uid}),env);
 assert.equal(r.status,400);
});
test("no anonymous/invalid bearer registration",async()=>{
 let writes=0;const remote=fakeRemote();
 const r=await handleMeshEnrollmentChallenge(makeReq(body,"short"),env,(async(...args)=>{writes++;return remote.call(...args)}) as typeof fetch);
 assert.equal(r.status,401);assert.equal(writes,0);
});
test("issuer rejects JWT, no nonce and no database writes",async()=>{
 const remote=fakeRemote(0,false);
 const r=await handleMeshEnrollmentChallenge(makeReq(),env,remote.call);
 assert.equal(r.status,401);assert.equal(remote.inspection().queries,0);
});
test("valid account can request one bounded public challenge, not enroll a device",async()=>{
 const remote=fakeRemote();
 const r=await handleMeshEnrollmentChallenge(makeReq(),env,remote.call);
 assert.equal(r.status,200);
 const result=await r.json();
 assert.equal(result.protocol,"katosync-mesh-enrollment-challenge-v1");
 assert.equal(result.paired,false);assert.equal(result.transportReady,false);
 assert.equal(result.discoveryOnly,true);assert.equal(result.nonce.length,43);
 assert.equal(result.publicKey,body.publicKey);
 const data=remote.inspection().inserted as {owner_user_id:string;signing_public_key:string;nonce:string;expires_at:string};
 assert.equal(data.owner_user_id,uid);
 assert.equal(data.signing_public_key,body.publicKey);
 assert.equal(data.nonce,result.nonce);
 assert.ok(Date.parse(data.expires_at)-Date.now()<=90000);
 assert.ok(!JSON.stringify(result).includes(env.SUPABASE_SERVICE_ROLE_KEY));
});
test("strict per-account challenge rate limit",async()=>{
 const remote=fakeRemote(3);
 const r=await handleMeshEnrollmentChallenge(makeReq(),env,remote.call);
 assert.equal(r.status,429);assert.equal(remote.inspection().inserted,null);
});
test("service-write failure cannot pretend successful enrollment",async()=>{
 const remote=fakeRemote(0,true,false);
 const r=await handleMeshEnrollmentChallenge(makeReq(),env,remote.call);
 assert.equal(r.status,503);assert.equal((await r.json()).error,"MESH_REGISTRY_UNAVAILABLE");
});

test("concurrent DB challenge rate rejection maps to 429 without leaking DB error",async()=>{
 let dbCalls=0;
 const request=async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.includes("/rest/v1/account_memberships"))return Response.json([{
    user_id:uid,access_state:"active",authorized_at:"2026-10-28T12:00:00Z",revoked_at:null
   }]);
   if(url.endsWith("/auth/v1/user"))return Response.json({id:"11111111-1111-4111-8111-111111111111"});
   if(url.includes("select=challenge_id"))return Response.json([]);
   if(init?.method==="POST"){dbCalls++;return Response.json({code:"23514",message:"KATOSYNC_MESH_CHALLENGE_RATE_LIMIT"},{status:409});}
   throw Error("Unexpected call");
 };
 const response=await handleMeshEnrollmentChallenge(makeReq(),env,request as typeof fetch);
 assert.equal(response.status,429);
 assert.deepEqual(await response.json(),{error:"RATE_LIMIT"});
 assert.equal(dbCalls,1);
});
