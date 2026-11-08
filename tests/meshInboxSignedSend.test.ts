// NMKato Solutions — isolated signed Mesh inbox tests; no live tokens/network.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {submitSignedMeshInvite} from "../supabase/functions/mesh-inbox-send/send.ts";

const ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co";
const uid="11111111-1111-4111-8111-111111111111";
const source="22222222-2222-4222-8222-222222222222";
const target="33333333-3333-4333-8333-333333333333";
const requestId="44444444-4444-4444-8444-444444444444";
const env={SUPABASE_URL:ORIGIN,SUPABASE_ANON_KEY:"qa-anon",SUPABASE_SERVICE_ROLE_KEY:"qa-secret",KATOSYNC_MESH_INBOX_STAGE:"send-only"};
const enc=new TextEncoder();
const b64=(v:Uint8Array)=>Buffer.from(v).toString("base64url");
type Options={authenticated?:boolean;membership?:boolean;targetOwner?:string;sourceKey?:string;targetRevoked?:boolean;writeError?:{code:string;message:string;status:number};registryFailure?:boolean};
async function fixture(){
 const signing=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
 const pub=b64(new Uint8Array(await crypto.subtle.exportKey("raw",signing.publicKey)));
 const scope=b64(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode("katosync-mesh-v1-account-scope:"+ORIGIN+":"+uid))));
 const nonce=b64(crypto.getRandomValues(new Uint8Array(32)));
 const expiresAt=Math.floor(Date.now()/1000)+240;
 const offerPayload=["katosync-mesh-pairing-v1",scope,pub,nonce,String(expiresAt)].join("|");
 const signature=b64(new Uint8Array(await crypto.subtle.sign("Ed25519",signing.privateKey,enc.encode(offerPayload))));
 const dispatch=["katosync-mesh-inbox-send-v1",scope,source,target,nonce,String(expiresAt)].join("|");
 const dispatchSignature=b64(new Uint8Array(await crypto.subtle.sign("Ed25519",signing.privateKey,enc.encode(dispatch))));
 return {protocol:"katosync-mesh-inbox-send-v1",sourceDeviceId:source,targetDeviceId:target,
   signedOffer:{protocol:"katosync-mesh-pairing-v1",publicKey:pub,nonce,expiresAt,accountScope:scope,signature},dispatchSignature};
}
function api(body:unknown){
 return new Request("https://example.test/send",{method:"POST",headers:{"content-type":"application/json",
  authorization:"Bearer test-signed-jwt-credential-long-enough-to-pass"},body:JSON.stringify(body)});
}
function backend(publicKey:string,opts:Options={}){
 const calls={reads:0,writes:0,body:null as Record<string,unknown>|null,seen: new Set<string>()};
 const fetcher=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=String(input),headers=init?.headers as Record<string,string>|undefined;
  assert.ok(url.startsWith(ORIGIN),"No external connections permitted");
  if(url.includes("/rest/v1/"))assert.equal(headers?.[init?.method==="POST"?"Content-Profile":"Accept-Profile"],"katosync");
  if(url.endsWith("/auth/v1/user"))return opts.authenticated===false?Response.json({error:"no"},{status:401}):Response.json({id:uid,is_anonymous:false});
  if(url.includes("account_memberships"))return Response.json(opts.membership===false?[]:[{user_id:uid,access_state:"active",authorized_at:"2026-10-28T12:00:00Z",revoked_at:null}]);
  if(url.includes("mesh_devices")){
    calls.reads++;
    if(opts.registryFailure)return Response.json({error:"down"},{status:503});
    return Response.json([
      {device_id:source,owner_user_id:uid,signing_public_key:opts.sourceKey??publicKey,membership_state:"discovered",revoked_at:null},
      {device_id:target,owner_user_id:opts.targetOwner??uid,signing_public_key:"B".repeat(43),
        membership_state:opts.targetRevoked?"revoked":"discovered",revoked_at:opts.targetRevoked?"2026-10-29T12:00:00Z":null}
    ]);
  }
  if(url.endsWith("/rest/v1/mesh_invites")){
    assert.equal(init?.method,"POST");calls.writes++;
    calls.body=JSON.parse(String(init?.body));
    const nonce=String(calls.body?.nonce);
    if(opts.writeError)return Response.json(opts.writeError,{status:opts.writeError.status});
    if(calls.seen.has(nonce))return Response.json({code:"23505",message:"nonce conflict"},{status:409});
    calls.seen.add(nonce);
    return Response.json([{request_id:requestId}],{status:201});
  }
  throw Error("unexpected route "+url);
 };
 return {call:fetcher as typeof fetch,calls};
}
test("default disabled: no DB read, no DB write",async()=>{
 const f=await fixture(),remote=backend(f.signedOffer.publicKey);
 const r=await submitSignedMeshInvite(api(f),{...env,KATOSYNC_MESH_INBOX_STAGE:""},remote.call);
 assert.equal(r.status,503);assert.equal(remote.calls.reads,0);assert.equal(remote.calls.writes,0);
});
test("valid signed source->target creates queue-only invite, with no trust",async()=>{
 const f=await fixture(),remote=backend(f.signedOffer.publicKey);
 const r=await submitSignedMeshInvite(api(f),env,remote.call),p=await r.json();
 assert.equal(r.status,202);assert.equal(p.deliveryOnly,true);
 assert.deepEqual([p.paired,p.transportReady,p.remoteJobsEnabled],[false,false,false]);
 assert.equal(remote.calls.writes,1);assert.equal(remote.calls.body?.source_device_id,source);
 assert.equal(remote.calls.body?.target_device_id,target);assert.equal(remote.calls.body?.nonce,f.signedOffer.nonce);
 assert.equal(remote.calls.body?.dispatch_signature,f.dispatchSignature);
 assert.ok(!JSON.stringify(p).includes(env.SUPABASE_SERVICE_ROLE_KEY));
});
test("recipient switch invalidates target-bound signature",async()=>{
 const f=await fixture(),remote=backend(f.signedOffer.publicKey);
 f.targetDeviceId="55555555-5555-4555-8555-555555555555";
 const r=await submitSignedMeshInvite(api(f),env,remote.call);
 assert.equal(r.status,403);assert.equal(remote.calls.writes,0);
});
test("invalid payload and self-invites rejected before network",async()=>{
 const f=await fixture();
 for(const body of [{...f,targetDeviceId:source}, {...f,unknown:"metadata"}, {...f,signedOffer:{...f.signedOffer,nonce:"not-base64"}}]){
  let count=0;
  const response=await submitSignedMeshInvite(api(body),env,(async()=>{count++;throw Error();}) as typeof fetch);
  assert.equal(response.status,400);assert.equal(count,0);
 }
});
test("stale offer cannot be delivered",async()=>{
 const f=await fixture(),remote=backend(f.signedOffer.publicKey);
 f.signedOffer.expiresAt=Math.floor(Date.now()/1000)-1;
 const r=await submitSignedMeshInvite(api(f),env,remote.call);
 assert.equal(r.status,403);assert.equal(remote.calls.writes,0);
});
test("different account, wrong signing key and revoked target are blocked",async()=>{
 const f=await fixture();
 for(const opts of [{targetOwner:"99999999-9999-4999-8999-999999999999"},{sourceKey:"C".repeat(43)},{targetRevoked:true}]){
  const remote=backend(f.signedOffer.publicKey,opts);
  const response=await submitSignedMeshInvite(api(f),env,remote.call);
  assert.equal(response.status,403);assert.equal(remote.calls.writes,0);
 }
});
test("JWT rejection, KatoSync membership gate, registry outage all fail closed",async()=>{
 const f=await fixture();
 for(const [opts,status] of [[{authenticated:false},401],[{membership:false},403],[{registryFailure:true},503]] as const){
  const remote=backend(f.signedOffer.publicKey,opts);
  assert.equal((await submitSignedMeshInvite(api(f),env,remote.call)).status,status);
  assert.equal(remote.calls.writes,0);
 }
});
test("DB replay, queue contention, rate and outage cannot produce a success receipt",async()=>{
 const f=await fixture();
 for(const [dbError,status,error] of [
  [{code:"23505",message:"duplicate",status:409},409,"INVITE_ALREADY_USED"],
  [{code:"23514",message:"KATOSYNC_MESH_INVITE_ALREADY_PENDING",status:409},409,"ALREADY_PENDING"],
  [{code:"23514",message:"KATOSYNC_MESH_INVITE_RATE_LIMIT",status:409},429,"RATE_LIMIT"],
  [{code:"08006",message:"internal: not public",status:503},503,"INBOX_UNAVAILABLE"]
 ] as const){
  const remote=backend(f.signedOffer.publicKey,{writeError:dbError});
  const result=await submitSignedMeshInvite(api(f),env,remote.call);
  assert.equal(result.status,status);assert.deepEqual(await result.json(),{error});
 }
});
test("database gate enforces owner-serialized rate, same pair and no direct client write",()=>{
 const sql=readFileSync(new URL("../supabase/migrations/20261029211243_mesh_inbox_signed_send_guard.sql",import.meta.url),"utf8");
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/recent_count >= 3/);
 assert.match(sql,/pending_pair_count > 0/);
 assert.match(sql,/grant insert on katosync\.mesh_invites to service_role/);
 assert.doesNotMatch(sql,/grant\s+insert\s+on\s+katosync\.mesh_invites\s+to\s+(anon|authenticated)/);
});
