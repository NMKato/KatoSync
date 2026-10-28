// NMKato Solutions — discovery-only registration after key possession proof.
// This does NOT pair devices, authorize a peer, enable transport or writers.
import {inspectEnrollmentRegistry} from "./registry-policy.ts";
const ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64=/^[A-Za-z0-9_-]+$/;
const out=(status:number,error:string)=>new Response(JSON.stringify({error}),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const decode=(raw:string)=>Uint8Array.from(atob(raw.replaceAll("-","+").replaceAll("_","/").padEnd(Math.ceil(raw.length/4)*4,"=")),c=>c.charCodeAt(0));
type Env={SUPABASE_URL:string;SUPABASE_ANON_KEY:string;SUPABASE_SERVICE_ROLE_KEY:string;KATOSYNC_MESH_ENROLLMENT_STAGE:string};
type Proof={protocol:string;challengeId:string;nonce:string;publicKey:string;expiresAt:string;signature:string;deviceName:string;platformOs:string};
export async function completeMeshDeviceDiscovery(req:Request,env:Env,request:typeof fetch=fetch):Promise<Response>{
  if(req.method!=="POST")return out(405,"METHOD_NOT_ALLOWED");
  if(env.KATOSYNC_MESH_ENROLLMENT_STAGE!=="challenge-and-discovery"||env.SUPABASE_URL!==ORIGIN||
      !env.SUPABASE_SERVICE_ROLE_KEY||!env.SUPABASE_ANON_KEY)return out(503,"NOT_CONFIGURED");
  const bearer=req.headers.get("authorization")??"";
  if(!/^Bearer [A-Za-z0-9_.-]{30,8192}$/.test(bearer))return out(401,"LOGIN_REQUIRED");
  let proof:Proof;
  try{
    const raw=await req.text();
    if(raw.length>1600)throw Error();
    proof=JSON.parse(raw) as Proof;
    if(!proof||typeof proof!=="object"||Array.isArray(proof)||Object.keys(proof).length!==8 ||
       proof.protocol!=="katosync-mesh-enrollment-proof-v1"||!UUID.test(proof.challengeId)||
       typeof proof.publicKey!=="string"||proof.publicKey.length!==43||!BASE64.test(proof.publicKey)||
       typeof proof.nonce!=="string"||proof.nonce.length!==43||!BASE64.test(proof.nonce)||
       typeof proof.signature!=="string"||proof.signature.length!==86||!BASE64.test(proof.signature)||
       typeof proof.expiresAt!=="string"||!Number.isFinite(Date.parse(proof.expiresAt))||
       typeof proof.deviceName!=="string"||!/^.{1,80}$/u.test(proof.deviceName)||/[<>\u0000-\u001f]/.test(proof.deviceName)||
       !["macos","windows","linux"].includes(proof.platformOs))throw Error();
  }catch{return out(400,"BAD_PROOF");}
  if(Date.parse(proof.expiresAt)<=Date.now()||Date.parse(proof.expiresAt)>Date.now()+95_000)
    return out(410,"EXPIRED");
  try{
    const user=await request(ORIGIN+"/auth/v1/user",{
      headers:{Authorization:bearer,apikey:env.SUPABASE_ANON_KEY},signal:AbortSignal.timeout(8000)});
    if(!user.ok)return out(401,"LOGIN_REQUIRED");
    const info=await user.json() as {id?:unknown;is_anonymous?:unknown};
    if(typeof info.id!=="string"||!UUID.test(info.id)||info.is_anonymous===true)return out(401,"LOGIN_REQUIRED");
    const uid=info.id;
    const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
    const query=new URL(ORIGIN+"/rest/v1/katosync_mesh_enrollment_challenges");
    query.searchParams.set("select","challenge_id,owner_user_id,signing_public_key,nonce,expires_at,consumed_at");
    query.searchParams.set("challenge_id","eq."+proof.challengeId);
    query.searchParams.set("owner_user_id","eq."+uid);
    const check=await request(query,{headers,signal:AbortSignal.timeout(8000)});
    if(!check.ok)return out(503,"REGISTRY_UNAVAILABLE");
    const records:unknown=await check.json();
    if(!Array.isArray(records)||records.length!==1)return out(404,"CHALLENGE_UNKNOWN");
    const c=records[0] as {owner_user_id:string;signing_public_key:string;nonce:string;expires_at:string;consumed_at:string|null};
    if(c.owner_user_id!==uid||c.signing_public_key!==proof.publicKey||c.nonce!==proof.nonce||c.consumed_at!==null)
      return out(403,"CHALLENGE_INVALID");
    if(Date.parse(c.expires_at)!==Date.parse(proof.expiresAt)||Date.parse(c.expires_at)<=Date.now())
      return out(410,"EXPIRED");
    const key=decode(proof.publicKey),sig=decode(proof.signature);
    if(key.length!==32||sig.length!==64)return out(400,"BAD_PROOF");
    const verificationKey=await crypto.subtle.importKey("raw",key,{name:"Ed25519"},false,["verify"]);
    const payload=new TextEncoder().encode(
      ["katosync-mesh-device-enrollment-proof-v1",uid,proof.challengeId,proof.nonce,proof.publicKey,String(Date.parse(proof.expiresAt))].join("\n"));
    if(!await crypto.subtle.verify("Ed25519",verificationKey,sig,payload))return out(403,"BAD_SIGNATURE");
    // Discovery quota is intentionally separate from trust/remote job grants.
    const existingURL=new URL(ORIGIN+"/rest/v1/katosync_mesh_devices");
    // A previously revoked signing key must NOT be revived by repeating
    // a possession proof. Membership is server-owned, never client supplied.
    existingURL.searchParams.set("select","device_id,signing_public_key,membership_state,revoked_at");
    existingURL.searchParams.set("owner_user_id","eq."+uid);
    existingURL.searchParams.set("limit","11");
    const existing=await request(existingURL,{headers,signal:AbortSignal.timeout(8000)});
    if(!existing.ok)return out(503,"REGISTRY_UNAVAILABLE");
    const current:unknown=await existing.json();
    const inspection=inspectEnrollmentRegistry(current,proof.publicKey);
    if(inspection.kind==="invalid")return out(503,"REGISTRY_UNAVAILABLE");
    if(inspection.kind==="revoked")return out(403,"DEVICE_REVOKED");
    const policyURL=new URL(ORIGIN+"/rest/v1/katosync_mesh_owner_policy");
    policyURL.searchParams.set("select","allowed_devices");
    policyURL.searchParams.set("owner_user_id","eq."+uid);
    policyURL.searchParams.set("limit","1");
    const policy=await request(policyURL,{headers,signal:AbortSignal.timeout(8000)});
    if(!policy.ok)return out(503,"REGISTRY_UNAVAILABLE");
    const policies:unknown=await policy.json();
    if(!Array.isArray(policies)||policies.length>1)return out(503,"REGISTRY_UNAVAILABLE");
    const max=policies.length===0?2:policies[0]?.allowed_devices;
    if(!Number.isInteger(max)||max<1||max>10)return out(503,"REGISTRY_UNAVAILABLE");
    const known=inspection.kind==="known";
    if(!known&&inspection.count>=max)return out(429,"DEVICE_QUOTA");
    // Atomic single-use consumption: racing requests cannot reuse one signed proof.
    const consumeURL=new URL(ORIGIN+"/rest/v1/katosync_mesh_enrollment_challenges");
    consumeURL.searchParams.set("select","challenge_id");
    consumeURL.searchParams.set("challenge_id","eq."+proof.challengeId);
    consumeURL.searchParams.set("owner_user_id","eq."+uid);
    consumeURL.searchParams.set("consumed_at","is.null");
    consumeURL.searchParams.set("expires_at","gt."+new Date().toISOString());
    const consumed=await request(consumeURL,{method:"PATCH",
      headers:{...headers,"content-type":"application/json",Prefer:"return=representation"},
      body:JSON.stringify({consumed_at:new Date().toISOString()}),signal:AbortSignal.timeout(8000)});
    if(!consumed.ok)return out(503,"REGISTRY_UNAVAILABLE");
    const updates:unknown=await consumed.json();
    if(!Array.isArray(updates)||updates.length!==1)return out(409,"CHALLENGE_USED");
    if(!known){
      const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",key));
      const fingerprint=Array.from(digest.slice(0,16),x=>x.toString(16).toUpperCase().padStart(2,"0")).join("-");
      const register=await request(ORIGIN+"/rest/v1/katosync_mesh_devices",{
        method:"POST",headers:{...headers,"content-type":"application/json",Prefer:"return=minimal"},
        body:JSON.stringify({owner_user_id:uid,signing_public_key:proof.publicKey,fingerprint,
          display_name:proof.deviceName,platform_os:proof.platformOs,membership_state:"discovered",
          enrolled_at:new Date().toISOString(),last_seen_at:new Date().toISOString()}),
        signal:AbortSignal.timeout(8000)
      });
      if(!register.ok)return out(503,"REGISTRY_UNAVAILABLE");
    }
    return new Response(JSON.stringify({discovered:true,paired:false,transportReady:false,remoteJobsEnabled:false}),{
      headers:{"content-type":"application/json","cache-control":"no-store"}
    });
  }catch{return out(503,"REGISTRY_UNAVAILABLE");}
}
