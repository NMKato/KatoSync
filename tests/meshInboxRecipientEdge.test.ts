// NMKato Solutions — real Ed25519/WebCrypto, all REST mocked. No live credentials.
import {test} from "node:test";
import assert from "node:assert/strict";
import {handleMeshInboxReceive} from "../supabase/functions/mesh-inbox-receive/receive.ts";

const ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co";
const OWNER="11111111-1111-4111-8111-111111111111";
const DEVICE="22222222-2222-4222-8222-222222222222";
const SOURCE="33333333-3333-4333-8333-333333333333";
const INVITE="44444444-4444-4444-8444-444444444444";
const EMPTY="00000000-0000-4000-8000-000000000000";
const env={SUPABASE_URL:ORIGIN,SUPABASE_ANON_KEY:"test-publishable",
 SUPABASE_SERVICE_ROLE_KEY:"test-only-server",KATOSYNC_MESH_INBOX_RECEIVE_STAGE:"qa-inbox"};
const enc=new TextEncoder();
const b64=(bytes:Uint8Array)=>Buffer.from(bytes).toString("base64url");
type Action="list"|"accept"|"reject";
async function fixture(){
 const key=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
 const publicKey=b64(new Uint8Array(await crypto.subtle.exportKey("raw",key.publicKey)));
 const proof=async(action:Action="list",requestId=action==="list"?EMPTY:INVITE)=>{
  const nonce=b64(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt=Math.floor(Date.now()/1000)+65;
  const protocol="katosync-mesh-inbox-recipient-v1";
  const payload=[protocol,OWNER,DEVICE,action,requestId,nonce,String(expiresAt)].join("|");
  const signature=b64(new Uint8Array(await crypto.subtle.sign("Ed25519",key.privateKey,enc.encode(payload))));
  return {protocol,deviceId:DEVICE,action,requestId,nonce,expiresAt,signature};
 };
 return {publicKey,proof};
}
function makeRequest(body:unknown,token="valid-test-access-token-1234567890"){
 return new Request("https://qa.example/inbox",{
  method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify(body)
 });
}
type Options={userRejected?:boolean;memberRejected?:boolean;deviceOwner?:string;
 revoked?:boolean;deviceKey?:string;registryDown?:boolean;failedProof?:boolean;invalidProofReceipt?:boolean;invalidList?:boolean};
function backend(publicKey:string,opts:Options={}){
 const state={updates:0,reads:0,nonceWrites:0,nonces:new Set<string>(),inviteState:"pending"};
 const calls=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),headers=init?.headers as Record<string,string>|undefined;
  assert.ok(url.startsWith(ORIGIN));
  if(url.includes("/rest/v1/"))assert.equal(headers?.[init?.method==="POST"||init?.method==="PATCH"?"Content-Profile":"Accept-Profile"],"katosync");
  if(url.endsWith("/auth/v1/user")){
   if(opts.userRejected)return Response.json({error:"login"},{status:401});
   return Response.json({id:OWNER,is_anonymous:false});
  }
  if(url.includes("/rest/v1/account_memberships"))
   return Response.json(opts.memberRejected?[]:[{user_id:OWNER,access_state:"active",authorized_at:"2026-10-28T12:00:00Z",revoked_at:null}]);
  if(url.includes("/rest/v1/mesh_devices")){
   if(opts.registryDown)return Response.json({error:"down"},{status:503});
   return Response.json([{device_id:DEVICE,owner_user_id:opts.deviceOwner??OWNER,signing_public_key:opts.deviceKey??publicKey,
     membership_state:opts.revoked?"revoked":"discovered",revoked_at:opts.revoked?"2026-10-30T07:00:00Z":null}]);
  }
  if(url.includes("/rest/v1/mesh_inbox_proofs")){
   assert.equal(init?.method,"POST");
   const body=JSON.parse(String(init.body)) as {
     nonce:string;owner_user_id:string;device_id:string;
     action:string;request_id:string;expires_at:string;
   };
   assert.equal(body.owner_user_id,OWNER);assert.equal(body.device_id,DEVICE);
   state.nonceWrites++;
   if(opts.failedProof)return Response.json({error:"unavailable"},{status:503});
   if(state.nonces.has(body.nonce))return Response.json({code:"23505"},{status:409});
   state.nonces.add(body.nonce);
   return Response.json([{proof_id:"55555555-5555-4555-8555-555555555555",
     owner_user_id:body.owner_user_id,device_id:body.device_id,
     action:opts.invalidProofReceipt?"reject":body.action,request_id:body.request_id,nonce:body.nonce,
     expires_at:body.expires_at}],{status:201});
  }
  if(url.includes("/rest/v1/mesh_invites")){
   assert.ok(url.includes("target_device_id=eq."));assert.ok(url.includes("owner_user_id=eq."));
   assert.ok(url.includes("state=eq.pending"));assert.ok(url.includes("expires_at=gt."));
   if(init?.method==="PATCH"){
    state.updates++;
    const body=JSON.parse(String(init.body)) as {
      state:string;resolved_at:string;resolution_proof_id:string;
    };
    assert.equal(body.resolution_proof_id,"55555555-5555-4555-8555-555555555555");
    if(state.inviteState!=="pending")return Response.json([]);
    state.inviteState=body.state;
    return Response.json([{request_id:INVITE,owner_user_id:OWNER,target_device_id:DEVICE,
     state:body.state,resolved_at:body.resolved_at}]);
   }
   state.reads++;
   if(opts.invalidList)return Response.json([{request_id:INVITE,owner_user_id:"fake",target_device_id:DEVICE}]);
   return Response.json(state.inviteState==="pending"?[{
      request_id:INVITE,owner_user_id:OWNER,source_device_id:SOURCE,target_device_id:DEVICE,
      state:"pending",expires_at:new Date(Date.now()+180_000).toISOString(),
      signed_offer:{protocol:"katosync-mesh-pairing-v1"},dispatch_signature:"A".repeat(86)
   }]:[]);
  }
  throw Error("unexpected "+url);
 };
 return {call:calls as typeof fetch,state};
}
test("endpoint is disabled by default, no server access",async()=>{
 const f=await fixture(),b=backend(f.publicKey);
 const p=await f.proof();
 const response=await handleMeshInboxReceive(makeRequest(p),{...env,KATOSYNC_MESH_INBOX_RECEIVE_STAGE:""},b.call);
 assert.equal(response.status,503);assert.equal(b.state.nonceWrites,0);
});
test("real Ed25519 proof can list only target inbox; never returns trust",async()=>{
 const f=await fixture(),b=backend(f.publicKey);
 const result=await handleMeshInboxReceive(makeRequest(await f.proof()),env,b.call);
 assert.equal(result.status,200);const body=await result.json();
 assert.equal(body.invitations.length,1);
 assert.equal(body.invitations[0].requestId,INVITE);
 assert.equal(body.invitations[0].targetDeviceId,DEVICE);
 assert.deepEqual([body.discoveryOnly,body.paired,body.transportReady,body.remoteJobsEnabled],[true,false,false,false]);
 assert.equal(b.state.nonceWrites,1);assert.equal(b.state.reads,1);
});
test("accepted decision updates pending invitation once, without trust",async()=>{
 const f=await fixture(),b=backend(f.publicKey);
 const p=await f.proof("accept",INVITE);
 const first=await handleMeshInboxReceive(makeRequest(p),env,b.call);
 assert.equal(first.status,200);const body=await first.json();
 assert.deepEqual([body.state,body.decisionOnly,body.paired,body.transportReady,body.remoteJobsEnabled],
  ["accepted",true,false,false,false]);
 const replay=await handleMeshInboxReceive(makeRequest(p),env,b.call);
 assert.equal(replay.status,409);assert.equal(b.state.updates,1);
 const newProof=await f.proof("reject",INVITE);
 const after=await handleMeshInboxReceive(makeRequest(newProof),env,b.call);
 assert.equal(after.status,409);assert.equal(b.state.updates,2);
});
test("explicit rejection never grants trust",async()=>{
 const f=await fixture(),b=backend(f.publicKey);
 const res=await handleMeshInboxReceive(makeRequest(await f.proof("reject",INVITE)),env,b.call);
 assert.equal(res.status,200);assert.equal((await res.json()).state,"rejected");
 assert.equal(b.state.inviteState,"rejected");
});
test("recipient and signature cannot be swapped by signed-in owner",async()=>{
 const f=await fixture();
 for(const mutate of [
  (p:Awaited<ReturnType<typeof f.proof>>)=>({...p,deviceId:SOURCE}),
  (p:Awaited<ReturnType<typeof f.proof>>)=>({...p,action:"reject",requestId:INVITE}),
  (p:Awaited<ReturnType<typeof f.proof>>)=>({...p,signature:"B".repeat(86)})
 ]){
  const b=backend(f.publicKey);
  const res=await handleMeshInboxReceive(makeRequest(mutate(await f.proof())),env,b.call);
  assert.ok([400,403].includes(res.status));assert.equal(b.state.nonceWrites,0);
 }
});
test("missing login or membership, foreign/revoked device fail closed",async()=>{
 const f=await fixture();
 for(const [opts,status] of [
  [{userRejected:true},401],[{memberRejected:true},403],
  [{deviceOwner:"99999999-9999-4999-8999-999999999999"},403],
  [{revoked:true},403],[{registryDown:true},503]
 ] as const){
  const b=backend(f.publicKey,opts);
  assert.equal((await handleMeshInboxReceive(makeRequest(await f.proof()),env,b.call)).status,status);
  assert.equal(b.state.nonceWrites,0);
 }
});
test("nonce proof failure blocks data read and decision",async()=>{
 const f=await fixture(),b=backend(f.publicKey,{failedProof:true});
 const r=await handleMeshInboxReceive(makeRequest(await f.proof("accept",INVITE)),env,b.call);
 assert.equal(r.status,503);assert.equal(b.state.updates,0);assert.equal(b.state.reads,0);
});
test("untrusted malformed records cannot be displayed as valid invitations",async()=>{
 const f=await fixture(),b=backend(f.publicKey,{invalidList:true});
 const r=await handleMeshInboxReceive(makeRequest(await f.proof()),env,b.call);
 assert.equal(r.status,503);assert.equal((await r.json()).error,"INBOX_INVALID_RESPONSE");
});
test("malformed action/short bearer/reused list sentinel rejected before registry access",async()=>{
 const f=await fixture(),b=backend(f.publicKey);
 for(const p of [{...await f.proof(),unknown:true},{...await f.proof(),requestId:INVITE},
   {...await f.proof("accept",INVITE),requestId:EMPTY}]){
  const r=await handleMeshInboxReceive(makeRequest(p),env,b.call);
  assert.equal(r.status,400);assert.equal(b.state.nonceWrites,0);
 }
 const p=await f.proof();
 assert.equal((await handleMeshInboxReceive(makeRequest(p,"short"),env,b.call)).status,401);
});

test("a mismatched persisted proof receipt never authorizes accept or listing",async()=>{
 const fixtureData=await fixture();
 for(const action of ["accept","list"] as const){
  const b=backend(fixtureData.publicKey,{invalidProofReceipt:true});
  const requestId=action==="list"?EMPTY:INVITE;
  const response=await handleMeshInboxReceive(makeRequest(await fixtureData.proof(action,requestId)),env,b.call);
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,"INBOX_PROOF_UNCONFIRMED");
  assert.equal(b.state.updates,0);
  assert.equal(b.state.reads,0);
 }
});
test("a valid receipt is never an access grant: strict proof id must be attached to PATCH",async()=>{
 const f=await fixture(),b=backend(f.publicKey);
 const result=await handleMeshInboxReceive(makeRequest(await f.proof("accept",INVITE)),env,b.call);
 assert.equal(result.status,200);
 assert.equal((await result.json()).paired,false);
 assert.equal(b.state.updates,1);
});
