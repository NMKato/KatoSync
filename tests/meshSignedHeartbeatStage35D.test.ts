import {test} from "node:test";
import assert from "node:assert/strict";
import {
 handleSignedMeshHeartbeat,heartbeatMessage,parseHeartbeat,validateHeartbeatDevice,
 type HeartbeatProof
} from "../supabase/functions/mesh-device-presence-qa/heartbeat.ts";
const origin="https://xbnnlyyxiilklsygxcof.supabase.co";
const owner="11111111-1111-4111-8111-111111111111";
const device="22222222-2222-4222-8222-222222222222";
const now=Date.parse("2026-11-04T08:40:00Z");
const env={SUPABASE_URL:origin,SUPABASE_ANON_KEY:"anon-qa",
  SUPABASE_SERVICE_ROLE_KEY:"service-role-qa",
  KATOSYNC_MESH_ENROLLMENT_STAGE:"challenge-and-discovery"};
const base64url=(raw:Uint8Array)=>Buffer.from(raw).toString("base64url");
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,
  headers:{"content-type":"application/json"}});
async function fixture(overrides:Record<string,unknown>={},patchEmpty=false){
 const keys=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
 const publicKey=base64url(new Uint8Array(await crypto.subtle.exportKey("raw",keys.publicKey)));
 const proof:HeartbeatProof={
  protocol:"katosync-mesh-device-heartbeat-v1",deviceId:device,
  publicKey,observedAtMs:now,signature:""
 };
 proof.signature=base64url(new Uint8Array(
   await crypto.subtle.sign("Ed25519",keys.privateKey,heartbeatMessage(owner,proof))));
 const row={device_id:device,owner_user_id:owner,signing_public_key:publicKey,
   membership_state:"discovered",revoked_at:null,
   last_seen_at:new Date(now-11*60_000).toISOString(),...overrides};
 const endpoints:string[]=[];
 let patchCount=0;
 const request:typeof fetch=async (input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=new URL(String(input));
  endpoints.push(url.pathname);
  if(url.pathname.endsWith("/auth/v1/user"))return json({id:owner,is_anonymous:false});
  if(url.pathname.endsWith("/rest/v1/account_memberships"))
    return json([{user_id:owner,access_state:"active",authorized_at:"2026-01-01T00:00:00Z",revoked_at:null}]);
  if(url.pathname.endsWith("/rest/v1/mesh_owner_policy"))
    return json([{allowed_devices:10,policy_expires_at:null}]);
  if(url.pathname.endsWith("/rest/v1/mesh_devices")){
   assert.equal(url.searchParams.get("owner_user_id"),"eq."+owner);
   assert.equal(url.searchParams.get("device_id"),"eq."+device);
   if(init?.method==="PATCH"){
    assert.equal(url.searchParams.get("signing_public_key"),"eq."+publicKey);
    assert.equal(url.searchParams.get("revoked_at"),"is.null");
    assert.equal(url.searchParams.get("membership_state"),"in.(discovered,pending,trusted)");
    patchCount++;
    const contents=JSON.parse(String(init.body)) as {last_seen_at:string};
    row.last_seen_at=contents.last_seen_at;
    return json(patchEmpty?[]:[{device_id:device}]);
   }
   return json([row]);
  }
  throw Error("unmocked endpoint");
 };
 const invoke=(p:HeartbeatProof=proof)=>handleSignedMeshHeartbeat(
   new Request(origin+"/functions/v1/mesh-device-enrollment/heartbeat",{
     method:"POST",headers:{Authorization:"Bearer "+"x".repeat(40),
       "content-type":"application/json"},body:JSON.stringify(p)
   }),env,request,now);
 return {proof,row,invoke,endpoints,get patches(){return patchCount}};
}
test("registered Ed25519 holder can send a signed, owner-scoped, bounded last-seen update",async()=>{
 const f=await fixture();
 const res=await f.invoke();
 assert.equal(res.status,200);
 assert.deepEqual(await res.json(),{accepted:true,reportedRecently:true,
  paired:false,transportReady:false,remoteJobsEnabled:false,nextPollSeconds:600});
 assert.equal(f.patches,1);
 assert.equal(Date.parse(f.row.last_seen_at),now);
});
test("repeated signed ping cannot cause more than one database write per five minutes",async()=>{
 const f=await fixture();
 assert.equal((await f.invoke()).status,200);
 assert.equal((await f.invoke()).status,200);
 assert.equal(f.patches,1);
});
test("wrong Ed25519 signature never updates any device",async()=>{
 const f=await fixture();
 const fake={...f.proof,signature:base64url(new Uint8Array(64))};
 assert.equal((await f.invoke(fake)).status,403);
 assert.equal(f.patches,0);
});
test("revoked and owner-mismatched identities cannot refresh presence",async()=>{
 for(const row of [{membership_state:"revoked"}, {revoked_at:new Date(now).toISOString()},
                   {owner_user_id:"33333333-3333-4333-8333-333333333333"}]){
  const f=await fixture(row);
  assert.equal((await f.invoke()).status,403);
  assert.equal(f.patches,0);
 }
});
test("unknown key and invalid payload do not refresh or claim a peer connection",async()=>{
 const f=await fixture({signing_public_key:"x".repeat(43)});
 assert.equal((await f.invoke()).status,403);
 assert.equal(f.patches,0);
 assert.equal(parseHeartbeat({...f.proof,observedAtMs:now-60_000},now),null);
 assert.equal(parseHeartbeat({...f.proof,extra:"unexpected"},now),null);
 assert.equal(validateHeartbeatDevice([],owner,f.proof),null);
});
test("missing bearer, server mode gate and expired signed timestamps fail closed",async()=>{
 const f=await fixture();
 const reject=await handleSignedMeshHeartbeat(new Request(origin+"/heartbeat",{method:"POST",
   headers:{"content-type":"application/json"},body:JSON.stringify(f.proof)}),
   env,async()=>{throw Error("should not call");},now);
 assert.equal(reject.status,401);
 const rejected=await handleSignedMeshHeartbeat(new Request(origin+"/heartbeat",{method:"POST",
   headers:{Authorization:"Bearer "+"x".repeat(40),"content-type":"application/json"},
   body:JSON.stringify(f.proof)}),
   {...env,KATOSYNC_MESH_ENROLLMENT_STAGE:"disabled"},
   async()=>{throw Error("should not call");},now);
 assert.equal(rejected.status,503);
 assert.equal(parseHeartbeat({...f.proof,observedAtMs:now+11_000},now),null);
});
test("no network request can mutate non-KatoSync product tables",async()=>{
 const f=await fixture();
 assert.equal((await f.invoke()).status,200);
 assert.ok(f.endpoints.every(p=>p.includes("/auth/v1/user")||
  p.includes("/rest/v1/account_memberships")||
  p.includes("/rest/v1/mesh_owner_policy")||
  p.includes("/rest/v1/mesh_devices")));
 assert.ok(!f.endpoints.some(p=>/katoos_subscription|picnic|tablerocket/i.test(p)));
});

test("racing revocation or skipped compare-and-set must never claim successful presence",async()=>{
 const f=await fixture({},true);
 const response=await f.invoke();
 assert.equal(response.status,409);
 assert.equal(f.patches,1);
});
