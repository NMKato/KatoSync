import {test} from "node:test";
import assert from "node:assert/strict";
import {completeMeshDeviceDiscovery} from "../supabase/functions/mesh-device-enrollment/complete.ts";
const origin="https://xbnnlyyxiilklsygxcof.supabase.co",owner="11111111-1111-4111-8111-111111111111";
const env={SUPABASE_URL:origin,SUPABASE_ANON_KEY:"publishable-only",SUPABASE_SERVICE_ROLE_KEY:"private-server-credential",KATOSYNC_MESH_ENROLLMENT_STAGE:"challenge-and-discovery"};
const b64=(bytes:Uint8Array)=>Buffer.from(bytes).toString("base64url");
async function fixture(){
 const key=await crypto.subtle.generateKey({name:"Ed25519"},true,["sign","verify"]);
 const publicKey=b64(new Uint8Array(await crypto.subtle.exportKey("raw",key.publicKey)));
 const challengeId="22222222-2222-4222-8222-222222222222";
 const nonce=b64(new Uint8Array(32).fill(7));
 const expiresAt=new Date(Date.now()+70_000).toISOString();
 const text=["katosync-mesh-device-enrollment-proof-v1",owner,challengeId,nonce,publicKey,String(Date.parse(expiresAt))].join("\n");
 const signature=b64(new Uint8Array(await crypto.subtle.sign("Ed25519",key.privateKey,new TextEncoder().encode(text))));
 const proof={protocol:"katosync-mesh-enrollment-proof-v1",challengeId,nonce,publicKey,expiresAt,signature,deviceName:"M2 Pro",platformOs:"macos"};
 function request(data:unknown=proof){return new Request("https://local.example/complete",{method:"POST",headers:{authorization:"Bearer "+"a".repeat(65)},body:JSON.stringify(data)});}
 function backend(options:{invalidAuth?:boolean;used?:boolean;existing?:boolean;revoked?:boolean;quota?:boolean}={}){
  const writes:string[]=[];
  const call=async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input); assert.ok(url.startsWith(origin));
   if(url.endsWith("/auth/v1/user"))return Response.json(options.invalidAuth?{}:{id:owner},{status:options.invalidAuth?401:200});
   if(url.includes("/katosync_mesh_enrollment_challenges")&&init?.method!=="PATCH")
    return Response.json([{challenge_id:challengeId,owner_user_id:owner,signing_public_key:publicKey,nonce,expires_at:expiresAt,consumed_at:options.used?"2026-10-28T08:00:00Z":null}]);
   if(url.includes("/katosync_mesh_enrollment_challenges")&&init?.method==="PATCH"){
    writes.push("consume");return Response.json(options.used?[]:[{challenge_id:challengeId}]);
   }
   if(url.includes("/katosync_mesh_owner_policy"))return Response.json([]);
   if(url.includes("/katosync_mesh_devices")&&init?.method!=="POST")
    return Response.json(options.quota?
      [{signing_public_key:"Z".repeat(43),membership_state:"discovered",revoked_at:null},
       {signing_public_key:"Y".repeat(43),membership_state:"pending",revoked_at:null}]:
      options.revoked?
      [{signing_public_key:publicKey,membership_state:"revoked",revoked_at:"2026-10-28T14:00:00Z"}]:
      options.existing?
      [{signing_public_key:publicKey,membership_state:"trusted",revoked_at:null}]:[]);
   if(url.includes("/katosync_mesh_devices")&&init?.method==="POST"){
    writes.push("register"); const data=JSON.parse(String(init.body));
    assert.equal(data.membership_state,"discovered");
    assert.equal(data.signing_public_key,publicKey);
    assert.equal(data.owner_user_id,owner);
    return new Response(null,{status:201});
   }
   throw Error("Unexpected request");
  };
  return {call:call as typeof fetch,writes};
 }
 return {proof,request,backend};
}
test("signed public key proof can register discovery only, never peer trust",async()=>{
 const f=await fixture(),b=f.backend();
 const response=await completeMeshDeviceDiscovery(f.request(),env,b.call);
 assert.equal(response.status,200);
 const json=await response.json();
 assert.deepEqual(json,{discovered:true,paired:false,transportReady:false,remoteJobsEnabled:false});
 assert.deepEqual(b.writes,["consume","register"]);
});
test("tampered proof is rejected before consuming nonce",async()=>{
 const f=await fixture(),b=f.backend();
 const response=await completeMeshDeviceDiscovery(f.request({...f.proof,deviceName:"M2 Pro",signature:"A".repeat(86)}),env,b.call);
 assert.equal(response.status,403);assert.deepEqual(b.writes,[]);
});
test("consumed challenge and wrong account token cannot enroll",async()=>{
 const f=await fixture(),used=f.backend({used:true}),bad=f.backend({invalidAuth:true});
 assert.equal((await completeMeshDeviceDiscovery(f.request(),env,used.call)).status,403);
 assert.equal((await completeMeshDeviceDiscovery(f.request(),env,bad.call)).status,401);
 assert.equal(used.writes.length+bad.writes.length,0);
});
test("discovery quota fails closed before writes",async()=>{
 const f=await fixture(),b=f.backend({quota:true});
 assert.equal((await completeMeshDeviceDiscovery(f.request(),env,b.call)).status,429);
 assert.equal(b.writes.length,0);
});
test("stage flag off prevents any request to issuer or DB",async()=>{
 const f=await fixture(),b=f.backend();
 assert.equal((await completeMeshDeviceDiscovery(f.request(),{...env,KATOSYNC_MESH_ENROLLMENT_STAGE:"challenge-only"},b.call)).status,503);
 assert.deepEqual(b.writes,[]);
});
test("already-discovered same key never downgrades trust row",async()=>{
 const f=await fixture(),b=f.backend({existing:true});
 assert.equal((await completeMeshDeviceDiscovery(f.request(),env,b.call)).status,200);
 assert.deepEqual(b.writes,["consume"]);
});

test("a revoked device key cannot re-enroll or get a false discovery receipt",async()=>{
 const f=await fixture(),b=f.backend({revoked:true});
 const response=await completeMeshDeviceDiscovery(f.request(),env,b.call);
 assert.equal(response.status,403);
 assert.deepEqual(await response.json(),{error:"DEVICE_REVOKED"});
 assert.deepEqual(b.writes,[]);
});
