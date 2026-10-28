// NMKato Solutions: complete two-device challenge/signature/discovery simulation.
// Uses the REAL Edge handlers and WebCrypto, but only synthetic users and in-memory REST.
import {test} from "node:test";
import assert from "node:assert/strict";
import {handleMeshEnrollmentChallenge} from "../supabase/functions/mesh-device-enrollment/handler.ts";
import {completeMeshDeviceDiscovery} from "../supabase/functions/mesh-device-enrollment/complete.ts";
const ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co";
const OWNER="11111111-1111-4111-8111-111111111111";
const env={SUPABASE_URL:ORIGIN,SUPABASE_ANON_KEY:"test-publishable",SUPABASE_SERVICE_ROLE_KEY:"test-server-only",
  KATOSYNC_MESH_ENROLLMENT_STAGE:"challenge-and-discovery"};
const token="synthetic-test-token-for-owner-123456789";
const b64=(v:Uint8Array)=>Buffer.from(v).toString("base64url");
type Stored={challenge_id:string;owner_user_id:string;signing_public_key:string;nonce:string;created_at:string;expires_at:string;consumed_at:null|string};
type Device={signing_public_key:string;owner_user_id:string;membership_state:string};
function makeDB(){
 const challenges:Stored[]=[], devices:Device[]=[];
 const dispatch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const u=new URL(String(input)); assert.equal(u.origin,ORIGIN);
  if(u.pathname.startsWith("/rest/v1/")){
   const header=init?.method==="PATCH"||init?.method==="POST"?"Content-Profile":"Accept-Profile";
   assert.equal((init?.headers as Record<string,string>)?.[header],"katosync");
  }
  const body=init?.body ? JSON.parse(String(init.body)):null;
  if(u.pathname.endsWith("/account_memberships"))return Response.json([{
    user_id:OWNER,access_state:"active",authorized_at:"2026-10-28T12:00:00Z",revoked_at:null
  }]);
  if(u.pathname==="/auth/v1/user")return Response.json({id:OWNER,is_anonymous:false});
  if(u.pathname.endsWith("/mesh_enrollment_challenges")){
   if(init?.method==="POST"){
    const id=crypto.randomUUID(), now=new Date().toISOString();
    const d={challenge_id:id,created_at:now,consumed_at:null,...body};
    challenges.push(d);
    return Response.json([d],{status:201});
   }
   if(init?.method==="PATCH"){
    const key=u.searchParams.get("challenge_id")?.replace("eq.","");
    const c=challenges.find(x=>x.challenge_id===key&&x.consumed_at===null);
    if(!c)return Response.json([]);
    c.consumed_at=body.consumed_at;
    return Response.json([{challenge_id:c.challenge_id}]);
   }
   if(u.searchParams.has("created_at"))
    return Response.json(challenges.filter(x=>Date.parse(x.created_at)>Date.now()-60_000).slice(0,3).map(x=>({challenge_id:x.challenge_id})));
   const id=u.searchParams.get("challenge_id")?.replace("eq.","");
   return Response.json(challenges.filter(x=>x.challenge_id===id));
  }
  if(u.pathname.endsWith("/mesh_owner_policy"))return Response.json([]);
  if(u.pathname.endsWith("/mesh_devices")){
   if(init?.method==="POST"){
    devices.push(body);
    return new Response(null,{status:201});
   }
   return Response.json(devices.map(x=>({
    signing_public_key:x.signing_public_key,device_id:crypto.randomUUID(),
    membership_state:x.membership_state,revoked_at:null
   })));
  }
  throw Error("unexpected route: "+u.pathname);
 };
 return {dispatch:dispatch as typeof fetch,challenges,devices};
}
function userRequest(endpoint:string,payload:unknown):Request{
 return new Request("https://unit.local/"+endpoint,{
  method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
  body:JSON.stringify(payload)});
}
async function issueAndSign(db:ReturnType<typeof makeDB>,keyPair:CryptoKeyPair){
 const publicKey=b64(new Uint8Array(await crypto.subtle.exportKey("raw",keyPair.publicKey)));
 const r=await handleMeshEnrollmentChallenge(userRequest("challenge",{publicKey}),env,db.dispatch);
 assert.equal(r.status,200);
 const c=await r.json() as {challengeId:string;nonce:string;publicKey:string;expiresAt:string};
 const message=["katosync-mesh-device-enrollment-proof-v1",OWNER,c.challengeId,c.nonce,c.publicKey,String(Date.parse(c.expiresAt))].join("\n");
 const signature=b64(new Uint8Array(await crypto.subtle.sign("Ed25519",keyPair.privateKey,new TextEncoder().encode(message))));
 return {challengeId:c.challengeId,nonce:c.nonce,publicKey:c.publicKey,expiresAt:c.expiresAt,signature,protocol:"katosync-mesh-enrollment-proof-v1",deviceName:"QA-Mac",platformOs:"macos"};
}
test("two real Ed25519 keypairs are discovered only after signed one-time challenge",async()=>{
 const db=makeDB();
 for(let i=0;i<2;i++){
  const kp=await crypto.subtle.generateKey({name:"Ed25519"},true,["sign","verify"]);
  const proof=await issueAndSign(db,kp);
  const accepted=await completeMeshDeviceDiscovery(userRequest("complete",proof),env,db.dispatch);
  assert.equal(accepted.status,200);
  assert.deepEqual(await accepted.json(),{discovered:true,paired:false,transportReady:false,remoteJobsEnabled:false});
  const replay=await completeMeshDeviceDiscovery(userRequest("complete",proof),env,db.dispatch);
  assert.equal(replay.status,403);
 }
 assert.equal(db.devices.length,2);
 assert.ok(db.devices.every(d=>d.membership_state==="discovered" && d.owner_user_id===OWNER));
 assert.ok(db.challenges.every(c=>c.consumed_at!==null));
});
test("third distinct device cannot exceed default 2-device quota",async()=>{
 const db=makeDB();
 for(let i=0;i<3;i++){
  const kp=await crypto.subtle.generateKey({name:"Ed25519"},true,["sign","verify"]);
  const proof=await issueAndSign(db,kp);
  const res=await completeMeshDeviceDiscovery(userRequest("complete",proof),env,db.dispatch);
  assert.equal(res.status,i===2?429:200);
 }
 assert.equal(db.devices.length,2);
});
