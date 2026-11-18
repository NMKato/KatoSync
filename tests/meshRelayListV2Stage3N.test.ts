// NMKato Solutions — Stage 3N: v2 signed origin, no Cloud, no pairing.
import {test} from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,randomBytes} from "node:crypto";
import {RELAY_LIST_PROTOCOL,RELAY_LIST_PROTOCOL_V2,
 parseRelayListProof,verifyRelayListProof} from
 "../supabase/functions/mesh-pairing-relay/protocol.ts";
import {handleMeshPairingRelay} from
 "../supabase/functions/mesh-pairing-relay/relay.ts";
const PROD="https://xbnnlyyxiilklsygxcof.supabase.co";
const REF="abcdefghijklmnopqrst",QA="https://"+REF+".supabase.co";
const OWNER="11111111-1111-4111-8111-111111111111";
const DEVICE="22222222-2222-4222-8222-222222222222";
const OTHER="33333333-3333-4333-8333-333333333333";
const pair=generateKeyPairSync("ed25519");
const pub=pair.publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("base64url");
const now=()=>Math.floor(Date.now()/1000);
function proof(origin:string,version:1|2=2){
 const protocol=version===2?RELAY_LIST_PROTOCOL_V2:RELAY_LIST_PROTOCOL;
 const expiresAt=now()+65,nonce=randomBytes(32).toString("base64url");
 const message=version===2?
  [protocol,OWNER,origin,DEVICE,nonce,String(expiresAt)].join("|"):
  [protocol,OWNER,DEVICE,nonce,String(expiresAt)].join("|");
 return {...{protocol,deviceId:DEVICE},...(version===2?{origin}:{}),
  nonce,expiresAt,signature:sign(null,Buffer.from(message),pair.privateKey).toString("base64url")};
}
const selectOrigin=(origin:string)=>{
 const b=origin===QA?{KATOSYNC_MESH_RELAY_QA_MODE:"isolated-preview-only",
  KATOSYNC_MESH_RELAY_QA_PROJECT_REF:REF,
  DENO_DEPLOYMENT_ID:REF+"_11111111-1111-4111-8111-111111111111_1"}:{};
 return {SUPABASE_URL:origin,SUPABASE_ANON_KEY:"synthetic-anon-key",
  SUPABASE_SERVICE_ROLE_KEY:"synthetic-service-key",
  KATOSYNC_MESH_PAIRING_RELAY_STAGE:"qa-relay",...b};
};
function req(p:unknown){
 return new Request("https://qa.invalid/relay",{
  method:"POST",headers:{"content-type":"application/json",
    authorization:"Bearer synthetic-local-token-for-unit-tests-00000000000"},
  body:JSON.stringify({action:"list",payload:p})});
}
test("v2 recipient signature binds exact Supabase project, owner, device, nonce and expiry",async()=>{
 const p=proof(QA);
 assert.deepEqual(parseRelayListProof(p),p);
 assert.equal(await verifyRelayListProof(p,OWNER,pub,Date.now(),QA),true);
 assert.equal(await verifyRelayListProof(p,OWNER,pub,Date.now(),PROD),false);
 assert.equal(await verifyRelayListProof({...p,origin:PROD},OWNER,pub,Date.now(),PROD),false);
 assert.equal(await verifyRelayListProof({...p,deviceId:OTHER},OWNER,pub,Date.now(),QA),false);
 assert.equal(await verifyRelayListProof({...p,nonce:"A".repeat(43)},OWNER,pub,Date.now(),QA),false);
 assert.equal(await verifyRelayListProof({...p,expiresAt:p.expiresAt+4},OWNER,pub,Date.now(),QA),false);
 assert.equal(await verifyRelayListProof(p,OTHER,pub,Date.now(),QA),false);
 assert.equal(await verifyRelayListProof(p,OWNER,"A".repeat(43),Date.now(),QA),false);
});
test("v1 read proof remains backward-compatible on production, never QA",async()=>{
 const legacy=proof(PROD,1);
 assert.deepEqual(parseRelayListProof(legacy),legacy);
 assert.equal(await verifyRelayListProof(legacy,OWNER,pub,Date.now(),PROD),true);
 assert.equal(await verifyRelayListProof(legacy,OWNER,pub,Date.now(),QA),false);
 const modern=proof(PROD,2);
 assert.equal(await verifyRelayListProof(modern,OWNER,pub,Date.now(),PROD),true);
});
test("strict parser denies missing origin, URL tricks, unknown fields and protocol downgrades",()=>{
 const p=proof(QA);
 for(const invalid of [
  {...p,origin:undefined},{...p,origin:QA+"/auth/v1"},
  {...p,origin:"http://"+REF+".supabase.co"},
  {...p,origin:QA+".evil.example"},
  {...p,origin:QA+":443"},
  {...p,extra:"surprise"},
  {...p,protocol:RELAY_LIST_PROTOCOL},
 ]){
  assert.equal(parseRelayListProof(invalid),null,JSON.stringify(invalid).slice(0,160));
 }
 const v1=proof(PROD,1);
 assert.equal(parseRelayListProof({...v1,origin:PROD}),null);
});
test("real Edge handler accepts v2 QA signed read via scoped synthetic REST, never sets trust",async()=>{
 const p=proof(QA);
 const paths:string[]=[];
 const adapter:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));
  assert.equal(url.origin,QA,"no query or writes may reach production");
  const path=url.pathname;paths.push(path);
  if(path==="/auth/v1/user")return Response.json({id:OWNER,is_anonymous:false});
  if(path==="/rest/v1/account_memberships")return Response.json([{
   user_id:OWNER,access_state:"active",authorized_at:"2026-10-29T12:00:00Z",revoked_at:null}]);
  if(path==="/rest/v1/mesh_devices")return Response.json([{
   device_id:DEVICE,owner_user_id:OWNER,signing_public_key:pub,
   membership_state:"discovered",revoked_at:null}]);
  if(path==="/rest/v1/mesh_pairing_relay_reads"){
   assert.equal(init?.method,"POST");
   const body=JSON.parse(String(init?.body));
   assert.equal(body.owner_user_id,OWNER);
   assert.equal(body.device_id,DEVICE);
   assert.equal(body.nonce,p.nonce);
   return Response.json([{owner_user_id:OWNER,device_id:DEVICE,nonce:p.nonce,
    expires_at:new Date(p.expiresAt*1000).toISOString()}],{status:201});
  }
  if(path==="/rest/v1/mesh_pairing_relay_messages"){
   assert.equal(init?.method??"GET","GET");
   return Response.json([]);
  }
  throw Error("UNEXPECTED_QA_ROUTE:"+path);
 };
 const response=await handleMeshPairingRelay(req(p),selectOrigin(QA),adapter);
 assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
 assert.deepEqual(await response.json(),{
  messages:[],deliveryOnly:true,paired:false,transportReady:false,remoteJobsEnabled:false});
 assert.ok(paths.includes("/rest/v1/mesh_pairing_relay_reads"));
 assert.ok(paths.includes("/rest/v1/mesh_pairing_relay_messages"));
});
test("QA v1 never inserts a read-proof row, even when device and membership exist",async()=>{
 let reads=0;
 const adapter:typeof fetch=async(input)=>{
  const u=new URL(String(input));
  assert.equal(u.origin,QA);
  if(u.pathname==="/auth/v1/user")return Response.json({id:OWNER,is_anonymous:false});
  if(u.pathname==="/rest/v1/account_memberships")return Response.json([{
    user_id:OWNER,access_state:"active",authorized_at:"2026-10-29T12:00:00Z",revoked_at:null}]);
  if(u.pathname==="/rest/v1/mesh_devices")return Response.json([{
    device_id:DEVICE,owner_user_id:OWNER,signing_public_key:pub,
    membership_state:"discovered",revoked_at:null}]);
  reads++;throw Error("MUST_NOT_REACH_RELAY_READ_SQL");
 };
 const response=await handleMeshPairingRelay(req(proof(PROD,1)),selectOrigin(QA),adapter);
 assert.equal(response.status,403);
 assert.equal(reads,0);
});
