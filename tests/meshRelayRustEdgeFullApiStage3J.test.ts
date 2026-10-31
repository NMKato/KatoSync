// NMKato Solutions – Stage 3J: actual Rust Ed25519 signatures → Edge handler
// → mock REST → recipient-signed read → reversed response → mock REST → read.
// Public deterministic-time fixture, no network, no real keys, no live DB.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {handleMeshPairingRelay} from "../supabase/functions/mesh-pairing-relay/relay.ts";
import type {RelayEnvelope,RelayInvite,RelayListProof} from "../supabase/functions/mesh-pairing-relay/protocol.ts";
const fixtureInput=process.env.KATOSYNC_STAGE3J_RUST_FIXTURE;
const f=JSON.parse(readFileSync(fixtureInput??new URL("./fixtures/meshRelayRustEd25519Stage3J.public.json",import.meta.url),"utf8")) as {
 owner:string;nowMs:number;sourceDeviceId:string;targetDeviceId:string;
 sourcePublicKey:string;targetPublicKey:string;requestId:string;invite:RelayInvite;
 challenge:RelayEnvelope;response:RelayEnvelope;listInitiator:RelayListProof;listRecipient:RelayListProof;
};
const ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co";
const env={SUPABASE_URL:ORIGIN,SUPABASE_ANON_KEY:"qa-fake-publishable",
 SUPABASE_SERVICE_ROLE_KEY:"qa-mocked-no-server",KATOSYNC_MESH_PAIRING_RELAY_STAGE:"qa-relay"};
const make=(action:"send"|"list",payload:unknown,token="Bearer synthetic-test-token-12345678901234567890")=>
 new Request("https://mocked.dev/functions/v1/mesh-pairing-relay",{method:"POST",
 headers:{authorization:token,"content-type":"application/json"},body:JSON.stringify({action,payload})});
type Options={revoked?:boolean;pending?:boolean;wrongOwner?:boolean;wrongReceipt?:boolean};
function fakePostgrest(opts:Options={}){
 const state={writes:0,reads:0,proofWrites:0,events:[] as Record<string,unknown>[],
  seen:new Set<string>(),authCalls:0};
 const fetchMock=async(resource:RequestInfo|URL,options?:RequestInit)=>{
  const url=new URL(String(resource));
  assert.equal(url.origin,ORIGIN);
  const path=url.pathname;
  if(path==="/auth/v1/user"){
   state.authCalls++;
   return Response.json({id:opts.wrongOwner?"99999999-9999-4999-8999-999999999999":f.owner,is_anonymous:false});
  }
  if(path==="/rest/v1/account_memberships"){
   return Response.json([{user_id:opts.wrongOwner?"99999999-9999-4999-8999-999999999999":f.owner,
    access_state:"active",authorized_at:"2026-10-29T10:00:00Z",revoked_at:null}]);
  }
  if(path==="/rest/v1/mesh_devices"){
   const filter=url.searchParams.get("device_id")??"";
   const owner=opts.wrongOwner?"99999999-9999-4999-8999-999999999999":f.owner;
   const devices=[
    {device_id:f.sourceDeviceId,owner_user_id:owner,signing_public_key:f.sourcePublicKey,
     membership_state:"discovered",revoked_at:null},
    {device_id:f.targetDeviceId,owner_user_id:owner,signing_public_key:f.targetPublicKey,
     membership_state:opts.revoked?"revoked":"discovered",revoked_at:opts.revoked?"2026-10-31":null},
   ];
   return Response.json(devices.filter(x=>filter.includes(x.device_id)));
  }
  if(path==="/rest/v1/mesh_invites"){
   return Response.json([{...f.invite,
    owner_user_id:opts.wrongOwner?"99999999-9999-4999-8999-999999999999":f.owner,
    state:opts.pending?"pending":"accepted",
    // Deliberate PostgreSQL-JSONB field reordering.
    signed_offer:Object.fromEntries(Object.entries(f.invite.signed_offer as object).reverse()),
   }]);
  }
  if(path==="/rest/v1/mesh_pairing_relay_messages"){
   if(options?.method==="POST"){
    state.writes++;
    const row=JSON.parse(String(options.body)) as Record<string,unknown>;
    if(state.events.some(x=>x.kind===row.kind))return Response.json({error:"duplicate"},{status:409});
    if(row.kind==="response"&&!state.events.some(x=>x.kind==="challenge"))
     return Response.json({error:"no_challenge"},{status:503});
    const saved={...row,message_id:row.kind==="challenge"?
     "55555555-5555-4555-8555-555555555555":"66666666-6666-4666-8666-666666666666"};
    state.events.push(saved);
    return Response.json([opts.wrongReceipt?{...saved,kind:"challenge"===row.kind?"response":"challenge"}:saved],{status:201});
   }
   state.reads++;
   const target=url.searchParams.get("recipient_device_id")?.slice(3);
   return Response.json(state.events.filter(x=>x.recipient_device_id===target));
  }
  if(path==="/rest/v1/mesh_pairing_relay_reads"){
   state.proofWrites++;
   const row=JSON.parse(String(options?.body)) as Record<string,unknown>;
   const nonce=String(row.nonce);
   if(state.seen.has(nonce))return Response.json({error:"nonce_replay"},{status:409});
   state.seen.add(nonce);
   return Response.json([{...row,proof_id:"77777777-7777-4777-8777-777777777777"}],{status:201});
  }
  throw Error("Unexpected mock REST route: "+url.toString());
 };
 return {state,fetchMock:fetchMock as typeof fetch};
}
async function fixedClock<T>(task:()=>Promise<T>):Promise<T>{
 const original=Date.now;
 Date.now=()=>f.nowMs;
 try{return await task();}
 finally{Date.now=original;}
}
test("Rust-signed bidirectional relay passes the actual QA Edge handler and owner-bound mock database",async()=>{
 await fixedClock(async()=>{
  const b=fakePostgrest();
  const responseBeforeChallenge=await handleMeshPairingRelay(make("send",f.response),env,b.fetchMock);
  assert.equal(responseBeforeChallenge.status,503,"A mock DB must reject a Response before Challenge");
  let result=await handleMeshPairingRelay(make("send",f.challenge),env,b.fetchMock);
  assert.equal(result.status,202);
  assert.deepEqual(await result.json(),{
   messageId:"55555555-5555-4555-8555-555555555555",deliveryOnly:true,
   paired:false,transportReady:false,remoteJobsEnabled:false
  });
  result=await handleMeshPairingRelay(make("list",f.listInitiator),env,b.fetchMock);
  assert.equal(result.status,200);
  const first=await result.json();
  assert.deepEqual(first.messages,[f.challenge]);
  assert.equal(first.paired,false);
  assert.equal(first.transportReady,false);
  result=await handleMeshPairingRelay(make("send",f.response),env,b.fetchMock);
  assert.equal(result.status,202);
  result=await handleMeshPairingRelay(make("list",f.listRecipient),env,b.fetchMock);
  assert.equal(result.status,200);
  const second=await result.json();
  assert.deepEqual(second.messages,[f.response]);
  assert.equal(second.paired,false);
  assert.equal(second.remoteJobsEnabled,false);
  assert.equal(b.state.events.length,2);
  assert.ok(b.state.authCalls>=4);
  const replay=await handleMeshPairingRelay(make("list",f.listInitiator),env,b.fetchMock);
  assert.equal(replay.status,409);
  assert.equal(b.state.events.length,2);
 });
});
test("Rust-signed messages fail-closed on rejected invite, revoked account device or forged outer receipt",async()=>{
 await fixedClock(async()=>{
  for(const setting of [{pending:true},{revoked:true}]){
   const b=fakePostgrest(setting);
   assert.equal((await handleMeshPairingRelay(make("send",f.challenge),env,b.fetchMock)).status,403);
   assert.equal(b.state.events.length,0);
  }
  const b=fakePostgrest({wrongReceipt:true});
  assert.equal((await handleMeshPairingRelay(make("send",f.challenge),env,b.fetchMock)).status,503);
  assert.equal(b.state.events.length,1);
  const x=fakePostgrest();
  assert.equal((await handleMeshPairingRelay(make("send",{...f.challenge,signature:"A".repeat(86)}),env,x.fetchMock)).status,403);
  assert.equal(x.state.writes,0);
  assert.equal((await handleMeshPairingRelay(make("send",f.challenge),
    {...env,KATOSYNC_MESH_PAIRING_RELAY_STAGE:""},x.fetchMock)).status,503);
  assert.equal(x.state.writes,0);
 });
});
