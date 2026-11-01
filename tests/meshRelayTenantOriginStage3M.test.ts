// NMKato Solutions — Stage 3M Cloud-origin integrity is a release blocker.
// Test-only, no network, database, real auth or credential usage.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolveMeshRelayOrigin,MESH_LIVE_ORIGIN} from
 "../supabase/functions/mesh-pairing-relay/origin-gate.ts";
import {accountScope,verifyRelayEnvelope,verifyRelayListProof} from
 "../supabase/functions/mesh-pairing-relay/protocol.ts";
import {handleMeshPairingRelay} from
 "../supabase/functions/mesh-pairing-relay/relay.ts";

const REF="abcdefghijklmnopqrst";
const PREVIEW="https://"+REF+".supabase.co";
const DENO_ID=REF+"_11111111-1111-4111-8111-111111111111_1";
const owner="11111111-1111-4111-8111-111111111111";
const env=(changes:Record<string,string>={})=>({
 SUPABASE_URL:PREVIEW,
 KATOSYNC_MESH_RELAY_QA_MODE:"isolated-preview-only",
 KATOSYNC_MESH_RELAY_QA_PROJECT_REF:REF,
 DENO_DEPLOYMENT_ID:DENO_ID,
 ...changes,
});
const fixture=JSON.parse(readFileSync(new URL(
 "./fixtures/meshRelayRustEd25519Stage3J.public.json",import.meta.url),"utf8"));
const stage=(changes:Record<string,string>={})=>({
 ...env(changes),
 SUPABASE_ANON_KEY:"only-a-synthetic-test-key",
 SUPABASE_SERVICE_ROLE_KEY:"only-a-synthetic-server-test-key",
 KATOSYNC_MESH_PAIRING_RELAY_STAGE:"qa-relay",
});

test("production origin remains fixed and rejects any QA override",()=>{
 assert.equal(resolveMeshRelayOrigin({SUPABASE_URL:MESH_LIVE_ORIGIN}),MESH_LIVE_ORIGIN);
 for(const extra of [{KATOSYNC_MESH_RELAY_QA_MODE:"isolated-preview-only"},
 {KATOSYNC_MESH_RELAY_QA_PROJECT_REF:REF}]){
  assert.equal(resolveMeshRelayOrigin({SUPABASE_URL:MESH_LIVE_ORIGIN,...extra}),null);
 }
});
test("preview origin requires exact ref, hosted runtime identity and explicit opt-in",()=>{
 assert.equal(resolveMeshRelayOrigin(env()),PREVIEW);
 const denied=[
  {KATOSYNC_MESH_RELAY_QA_MODE:""},
  {KATOSYNC_MESH_RELAY_QA_MODE:"yes"},
  {KATOSYNC_MESH_RELAY_QA_PROJECT_REF:"something-else"},
  {SUPABASE_URL:"https://evil.invalid"},
  {SUPABASE_URL:PREVIEW+"/auth/v1"},
  {SUPABASE_URL:"http://"+REF+".supabase.co"},
  {SUPABASE_URL:"https://"+REF+".supabase.co.evil.invalid"},
  {SUPABASE_URL:"https://"+REF+".supabase.co:443"},
  {DENO_DEPLOYMENT_ID:""},
  {DENO_DEPLOYMENT_ID:"xbnnlyyxiilklsygxcof_11111111-1111-4111-8111-111111111111_1"},
  {DENO_DEPLOYMENT_ID:REF+"_invalid_1"},
 ];
 for(const variant of denied)assert.equal(resolveMeshRelayOrigin(env(variant)),null,
  JSON.stringify(variant));
});
test("valid Rust production signatures are rejected in another tenant",async()=>{
 const p=fixture.challenge;
 const invite=fixture.invite;
 assert.notEqual(await accountScope(owner,MESH_LIVE_ORIGIN),await accountScope(owner,PREVIEW));
 assert.equal(await verifyRelayEnvelope(p,owner,fixture.sourcePublicKey,
  fixture.targetPublicKey,invite,fixture.nowMs,MESH_LIVE_ORIGIN),true);
 assert.equal(await verifyRelayEnvelope(p,owner,fixture.sourcePublicKey,
  fixture.targetPublicKey,invite,fixture.nowMs,PREVIEW),false);
 assert.equal(await verifyRelayListProof(fixture.listInitiator,owner,
  fixture.sourcePublicKey,fixture.nowMs,MESH_LIVE_ORIGIN),true);
 // v1 read signatures contain no project origin. Do not enable preview reads.
 assert.equal(await verifyRelayListProof(fixture.listInitiator,owner,
  fixture.sourcePublicKey,fixture.nowMs,PREVIEW),false);
 await assert.rejects(accountScope(owner,"https://evil.invalid"),/owner_or_origin/);
});
test("ref/issuer mismatch rejects requests before any network or SQL",async()=>{
 let calls=0;
 const never:typeof fetch=async()=>{calls++;throw Error("UNEXPECTED_NETWORK");};
 const req=()=>new Request("https://offline.invalid/functions/v1/mesh-pairing-relay",{
  method:"POST",headers:{
   authorization:"Bearer synthetic-test-credential-123456789012345",
   "content-type":"application/json"},
  body:JSON.stringify({action:"send",payload:fixture.challenge}),
 });
 for(const changes of [{KATOSYNC_MESH_RELAY_QA_PROJECT_REF:"wrong"},
  {DENO_DEPLOYMENT_ID:"not-a-deployment"},
  {SUPABASE_URL:MESH_LIVE_ORIGIN}]){
  const reply=await handleMeshPairingRelay(req(),stage(changes),never);
  assert.equal(reply.status,503);
 }
 assert.equal(calls,0);
 const urls:string[]=[];
 const onlyPreview:typeof fetch=async(input)=>{
  urls.push(String(input));
  return Response.json({error:"offline synthetic auth not available"},{status:401});
 };
 const result=await handleMeshPairingRelay(req(),stage(),onlyPreview);
 assert.equal(result.status,401);
 assert.equal(urls.length,1);
 assert.equal(urls[0],PREVIEW+"/auth/v1/user");
});

test("isolated Relay membership uses QA origin without changing pinned Inbox source",async()=>{
 const {requireMeshRelayMembership}=await import(
  "../supabase/functions/mesh-pairing-relay/qa-membership.ts");
 const calls:string[]=[];
 const transport:typeof fetch=async(input)=>{
  calls.push(String(input));
  return Response.json([{user_id:owner,access_state:"active",
   authorized_at:"2026-10-28T12:00:00Z",revoked_at:null}]);
 };
 const headers={apikey:"synthetic",Authorization:"Bearer synthetic"};
 assert.equal(await requireMeshRelayMembership(owner,headers,transport,PREVIEW),"active");
 assert.equal(calls.length,1);
 assert.ok(calls[0].startsWith(PREVIEW+"/rest/v1/account_memberships?"));
 assert.equal(await requireMeshRelayMembership(owner,headers,transport,"https://evil.invalid"),"unavailable");
 assert.equal(calls.length,1,"invalid origin cannot trigger a request");
});
