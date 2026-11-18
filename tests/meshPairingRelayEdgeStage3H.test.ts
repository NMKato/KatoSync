// NMKato Solutions – Stage3H End-to-End Edge/REST contract, real WebCrypto.
// Entire datastore is in-memory, no real Supabase requests or user credentials.
import {test} from "node:test";
import assert from "node:assert/strict";
import {handleMeshPairingRelay} from "../supabase/functions/mesh-pairing-relay/relay.ts";
import {accountScope,RELAY_PROTOCOL,RELAY_LIST_PROTOCOL,type RelayEnvelope}
 from "../supabase/functions/mesh-pairing-relay/protocol.ts";
const ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co";
const OWNER="11111111-1111-4111-8111-111111111111",A="22222222-2222-4222-8222-222222222222";
const B="33333333-3333-4333-8333-333333333333",INV="44444444-4444-4444-8444-444444444444";
const env={SUPABASE_URL:ORIGIN,SUPABASE_ANON_KEY:"test-publishable",
 SUPABASE_SERVICE_ROLE_KEY:"test-only-credentials",KATOSYNC_MESH_PAIRING_RELAY_STAGE:"qa-relay"};
const enc=new TextEncoder(),b64=(v:Uint8Array)=>Buffer.from(v).toString("base64url");
const hash=async(s:string)=>b64(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(s))));
const sign=async(k:CryptoKey,s:string)=>b64(new Uint8Array(await crypto.subtle.sign("Ed25519",k,enc.encode(s))));
async function fixture(){
 const a=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
 const b=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
 const aPub=b64(new Uint8Array(await crypto.subtle.exportKey("raw",a.publicKey)));
 const bPub=b64(new Uint8Array(await crypto.subtle.exportKey("raw",b.publicKey)));
 const expiry=Math.floor(Date.now()/1000)+220,scope=await accountScope(OWNER);
 const offer={protocol:"katosync-mesh-pairing-v1",publicKey:aPub,nonce:b64(crypto.getRandomValues(new Uint8Array(32))),
  expiresAt:expiry,accountScope:scope,signature:""};
 offer.signature=await sign(a.privateKey,[offer.protocol,scope,aPub,offer.nonce,String(expiry)].join("|"));
 const challenge={protocol:"katosync-mesh-challenge-v1",offer,responderPublicKey:bPub,
  responderNonce:b64(crypto.getRandomValues(new Uint8Array(32))),expiresAt:expiry-10,signature:""};
 challenge.signature=await sign(b.privateKey,[challenge.protocol,await hash(JSON.stringify(offer)),
   scope,bPub,challenge.responderNonce,String(challenge.expiresAt)].join("|"));
 const payload=b64(enc.encode(JSON.stringify(challenge)));
 const c={protocol:RELAY_PROTOCOL,requestId:INV,senderDeviceId:B,recipientDeviceId:A,
  kind:"challenge" as const,payloadB64:payload,nonce:b64(crypto.getRandomValues(new Uint8Array(32))),
  expiresAt:expiry-12,signature:""};
 c.signature=await sign(b.privateKey,[c.protocol,OWNER,INV,B,A,c.kind,payload,c.nonce,String(c.expiresAt)].join("|"));
 const response={protocol:"katosync-mesh-response-v1",challenge,
  signature:await sign(a.privateKey,["katosync-mesh-response-v1",await hash(JSON.stringify(challenge))].join("|"))};
 const encodedResponse=b64(enc.encode(JSON.stringify(response)));
 const reply={protocol:RELAY_PROTOCOL,requestId:INV,senderDeviceId:A,recipientDeviceId:B,
  kind:"response" as const,payloadB64:encodedResponse,
  nonce:b64(crypto.getRandomValues(new Uint8Array(32))),expiresAt:expiry-13,signature:""};
 reply.signature=await sign(a.privateKey,[reply.protocol,OWNER,INV,A,B,reply.kind,encodedResponse,
  reply.nonce,String(reply.expiresAt)].join("|"));
 const list=async(deviceId:string=A)=>{
  const p={protocol:RELAY_LIST_PROTOCOL,deviceId,nonce:b64(crypto.getRandomValues(new Uint8Array(32))),
   expiresAt:Math.floor(Date.now()/1000)+65,signature:""};
  p.signature=await sign(deviceId===A?a.privateKey:b.privateKey,
   [p.protocol,OWNER,p.deviceId,p.nonce,String(p.expiresAt)].join("|"));
  return p;
 };
 return {a,b,aPub,bPub,offer,c,reply,list,expiry};
}
const make=(action:string,payload:unknown)=>new Request("https://staged.example/relay",{
 method:"POST",headers:{authorization:"Bearer valid-test-token-12345678901234567890","content-type":"application/json"},
 body:JSON.stringify({action,payload})
});
type Fixture=Awaited<ReturnType<typeof fixture>>;
function backend(f:Fixture,options:{revoked?:boolean;pending?:boolean;member?:boolean;wrongReceipt?:boolean}={}){
 const state={writes:0,reads:0,proofs:0,messages:[] as Array<Record<string,unknown>>,
  used:new Set<string>()};
 const request=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const u=String(input),url=new URL(u);
  assert.equal(url.origin,ORIGIN);
  if(url.pathname==="/auth/v1/user")return Response.json({id:OWNER,is_anonymous:false});
  if(url.pathname==="/rest/v1/account_memberships")
   return Response.json(options.member===false?[]:[{user_id:OWNER,access_state:"active",authorized_at:"2026-10-28T10:00:00Z",revoked_at:null}]);
  if(url.pathname==="/rest/v1/mesh_devices"){
   const filter=url.searchParams.get("device_id")??"";
   const values=[{device_id:A,owner_user_id:OWNER,signing_public_key:f.aPub,membership_state:"discovered",revoked_at:null},
    {device_id:B,owner_user_id:OWNER,signing_public_key:f.bPub,membership_state:options.revoked?"revoked":"discovered",
     revoked_at:options.revoked?"2026-10-31T00:00:00Z":null}];
   return Response.json(values.filter(v=>filter.includes(v.device_id)));
  }
  if(url.pathname==="/rest/v1/mesh_invites")return Response.json([{
   request_id:INV,owner_user_id:OWNER,source_device_id:A,target_device_id:B,
   state:options.pending?"pending":"accepted",expires_at:new Date(f.expiry*1000).toISOString(),
   signed_offer:f.offer
  }]);
  if(url.pathname==="/rest/v1/mesh_pairing_relay_messages"){
   if(init?.method==="POST"){
    state.writes++;
    const row=JSON.parse(String(init.body)) as Record<string,unknown>;
    if(state.messages.some(x=>x.kind===row.kind))return Response.json({error:"duplicate"},{status:409});
    const saved={...row,message_id:"55555555-5555-4555-8555-555555555555"};
    state.messages.push(saved);
    return Response.json([options.wrongReceipt?{...saved,kind:"response"}:saved],{status:201});
   }
   state.reads++;
   return Response.json(state.messages.filter(x=>x.recipient_device_id===url.searchParams.get("recipient_device_id")?.slice(3)));
  }
  if(url.pathname==="/rest/v1/mesh_pairing_relay_reads"){
   state.proofs++;
   const row=JSON.parse(String(init?.body)) as Record<string,unknown>;
   if(state.used.has(String(row.nonce)))return Response.json({error:"reuse"},{status:409});
   state.used.add(String(row.nonce));
   return Response.json([{...row,proof_id:"66666666-6666-4666-8666-666666666666"}],{status:201});
  }
  throw Error("Unexpected mocked route "+u);
 };
 return {state,request:request as typeof fetch};
}
test("staged relay disabled without explicit QA feature, zero backend calls",async()=>{
 const f=await fixture(),b=backend(f);
 const res=await handleMeshPairingRelay(make("send",f.c),{...env,KATOSYNC_MESH_PAIRING_RELAY_STAGE:""},b.request);
 assert.equal(res.status,503);assert.equal(b.state.writes,0);assert.equal(b.state.proofs,0);
});
test("valid signed challenge stored once and read with fresh signed nonce, no trust",async()=>{
 const f=await fixture(),b=backend(f);
 const sent=await handleMeshPairingRelay(make("send",f.c),env,b.request);
 assert.equal(sent.status,202);
 const receipt=await sent.json();
 assert.deepEqual([receipt.deliveryOnly,receipt.paired,receipt.transportReady,receipt.remoteJobsEnabled],
  [true,false,false,false]);
 assert.equal(b.state.writes,1);
 const readProof=await f.list(),read=await handleMeshPairingRelay(make("list",readProof),env,b.request);
 assert.equal(read.status,200);
 const rows=await read.json();
 assert.equal(rows.messages.length,1);
 assert.equal(rows.messages[0].payloadB64,f.c.payloadB64);
 assert.equal(rows.paired,false);assert.equal(rows.transportReady,false);
 const replay=await handleMeshPairingRelay(make("list",readProof),env,b.request);
 assert.equal(replay.status,409);assert.equal(b.state.proofs,2);
 const duplicate=await handleMeshPairingRelay(make("send",f.c),env,b.request);
 assert.equal(duplicate.status,409);assert.equal(b.state.writes,2);
});
test("bidirectional signed Challenge(B→A) and Response(A→B) are independently delivered",async()=>{
 const f=await fixture(),b=backend(f);
 const sendChallenge=await handleMeshPairingRelay(make("send",f.c),env,b.request);
 assert.equal(sendChallenge.status,202);
 const first=await handleMeshPairingRelay(make("list",await f.list(A)),env,b.request);
 assert.equal(first.status,200);
 assert.deepEqual((await first.json()).messages.map((x:{kind:string})=>x.kind),["challenge"]);
 const sendResponse=await handleMeshPairingRelay(make("send",f.reply),env,b.request);
 assert.equal(sendResponse.status,202);
 const second=await handleMeshPairingRelay(make("list",await f.list(B)),env,b.request);
 assert.equal(second.status,200);
 const result=await second.json();
 assert.equal(result.messages.length,1);
 assert.equal(result.messages[0].kind,"response");
 assert.equal(result.messages[0].recipientDeviceId,B);
 assert.equal(result.messages[0].senderDeviceId,A);
 assert.deepEqual([result.paired,result.transportReady,result.remoteJobsEnabled],[false,false,false]);
 assert.equal(b.state.messages.length,2);
});
test("tampered transport or missing accepted invite fails before database write",async()=>{
 const f=await fixture();
 for(const msg of [{...f.c,signature:"A".repeat(86)},{...f.c,recipientDeviceId:B},
  {...f.c,payloadB64:"A".repeat(100)}]){
  const b=backend(f),res=await handleMeshPairingRelay(make("send",msg),env,b.request);
  assert.ok([400,403].includes(res.status));assert.equal(b.state.writes,0);
 }
 for(const options of [{revoked:true},{pending:true},{member:false}]){
  const b=backend(f,options);
  const res=await handleMeshPairingRelay(make("send",f.c),env,b.request);
  assert.equal(res.status,403);assert.equal(b.state.writes,0);
 }
});
test("malformed, unauthenticated and spoofed receipts do not authorize relay",async()=>{
 const f=await fixture(),b=backend(f,{wrongReceipt:true});
 const bad=await handleMeshPairingRelay(make("send",{...f.c,remoteJobsEnabled:true}),env,b.request);
 assert.equal(bad.status,400);assert.equal(b.state.writes,0);
 const receipt=await handleMeshPairingRelay(make("send",f.c),env,b.request);
 assert.equal(receipt.status,503);assert.equal(b.state.writes,1);
 const auth=new Request("https://staged.example/relay",{method:"POST",
  headers:{"content-type":"application/json"},body:JSON.stringify({action:"send",payload:f.c})});
 assert.equal((await handleMeshPairingRelay(auth,env,b.request)).status,401);
});
