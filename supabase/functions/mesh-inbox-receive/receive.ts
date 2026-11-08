// NMKato Solutions — Stage 2O. Device-attested inbox and single-use decisions.
// No automatic pairing, transport authorization, SAS skipping, or remote jobs.
import {requireKatoSyncMembership} from "../mesh-device-enrollment/membership-gate.ts";
import {verifyStoredSignedMeshInvite} from "../mesh-inbox-send/send.ts";

const ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co", SCHEMA="katosync";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const B43=/^[A-Za-z0-9_-]{43}$/, B86=/^[A-Za-z0-9_-]{86}$/;
const PROTOCOL="katosync-mesh-inbox-recipient-v1";
const LIST_SENTINEL="00000000-0000-4000-8000-000000000000";
const HEAD={"content-type":"application/json","cache-control":"no-store"};
const fail=(status:number,error:string)=>Response.json({error},{status,headers:HEAD});
const encoder=new TextEncoder();
const b64=(v:Uint8Array)=>btoa(String.fromCharCode(...v)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
const decode=(s:string)=>{
 const bytes=Uint8Array.from(atob(s.replaceAll("-","+").replaceAll("_","/").padEnd(Math.ceil(s.length/4)*4,"=")),c=>c.charCodeAt(0));
 if(b64(bytes)!==s)throw Error("noncanonical base64url");
 return bytes;
};
type Proof={protocol:string;deviceId:string;action:"list"|"accept"|"reject";requestId:string;nonce:string;expiresAt:number;signature:string};
type Env={SUPABASE_URL:string;SUPABASE_ANON_KEY:string;SUPABASE_SERVICE_ROLE_KEY:string;KATOSYNC_MESH_INBOX_RECEIVE_STAGE:string};
type Device={device_id:string;owner_user_id:string;signing_public_key:string;membership_state:string;revoked_at:string|null};
type Invite={request_id:string;owner_user_id:string;source_device_id:string;target_device_id:string;state:string;expires_at:string;signed_offer:unknown;dispatch_signature:string};
function parse(raw:unknown):Proof|null{
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).length!==7)return null;
 const p=raw as Record<string,unknown>;
 if(p.protocol!==PROTOCOL||typeof p.deviceId!=="string"||!UUID.test(p.deviceId)||
    !["list","accept","reject"].includes(String(p.action))||
    typeof p.requestId!=="string"||!UUID.test(p.requestId)||
    (p.action==="list")!==(p.requestId===LIST_SENTINEL)||
    typeof p.nonce!=="string"||!B43.test(p.nonce)||
    typeof p.signature!=="string"||!B86.test(p.signature)||
    typeof p.expiresAt!=="number"||!Number.isSafeInteger(p.expiresAt))return null;
 const now=Date.now();
 if(p.expiresAt*1000<=now+1000||p.expiresAt*1000>now+90_000)return null;
 return raw as Proof;
}
async function verifyDeviceProof(p:Proof,owner:string,publicKey:string):Promise<boolean>{
 try{
  const keyBytes=decode(publicKey),nonce=decode(p.nonce),sig=decode(p.signature);
  if(keyBytes.length!==32||nonce.length!==32||sig.length!==64)return false;
  const key=await crypto.subtle.importKey("raw",keyBytes,{name:"Ed25519"},false,["verify"]);
  const message=[p.protocol,owner,p.deviceId,p.action,p.requestId,p.nonce,String(p.expiresAt)].join("|");
  return crypto.subtle.verify("Ed25519",key,sig,encoder.encode(message));
 }catch{return false;}
}
function validInvite(row:unknown,owner:string,target:string):row is Invite{
 if(!row||typeof row!=="object"||Array.isArray(row))return false;
 const x=row as Record<string,unknown>;
 return typeof x.request_id==="string"&&UUID.test(x.request_id)&&x.owner_user_id===owner&&
  x.target_device_id===target&&typeof x.source_device_id==="string"&&UUID.test(x.source_device_id)&&
  x.source_device_id!==target&&x.state==="pending"&&typeof x.expires_at==="string"&&
  Number.isFinite(Date.parse(x.expires_at))&&Date.parse(x.expires_at)>Date.now()&&
  typeof x.dispatch_signature==="string"&&B86.test(x.dispatch_signature)&&
  x.signed_offer!==null&&typeof x.signed_offer==="object"&&!Array.isArray(x.signed_offer);
}
const serverHeaders=(env:Env)=>({
  apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY
});
export async function handleMeshInboxReceive(req:Request,env:Env,request:typeof fetch=fetch):Promise<Response>{
 if(req.method!=="POST")return fail(405,"METHOD_NOT_ALLOWED");
 if(env.KATOSYNC_MESH_INBOX_RECEIVE_STAGE!=="qa-inbox"||env.SUPABASE_URL!==ORIGIN||
    !env.SUPABASE_ANON_KEY||!env.SUPABASE_SERVICE_ROLE_KEY)return fail(503,"INBOX_NOT_CONFIGURED");
 const bearer=req.headers.get("authorization")??"";
 if(!/^Bearer [A-Za-z0-9_.-]{30,8192}$/.test(bearer))return fail(401,"LOGIN_REQUIRED");
 if(!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return fail(400,"BAD_REQUEST");
 let proof:Proof|null;
 try{const raw=await req.text();if(raw.length>1300)return fail(400,"BAD_REQUEST");proof=parse(JSON.parse(raw));}
 catch{return fail(400,"BAD_REQUEST");}
 if(!proof)return fail(400,"BAD_PROOF");
 try{
  // A signed device proof without an online authorized user is insufficient.
  const userResponse=await request(ORIGIN+"/auth/v1/user",{
    headers:{Authorization:bearer,apikey:env.SUPABASE_ANON_KEY},signal:AbortSignal.timeout(8000)
  });
  if(!userResponse.ok)return fail(401,"LOGIN_REQUIRED");
  const user=await userResponse.json() as {id?:unknown;is_anonymous?:unknown};
  if(typeof user.id!=="string"||!UUID.test(user.id)||user.is_anonymous===true)return fail(401,"LOGIN_REQUIRED");
  const owner=user.id,headers=serverHeaders(env);
  const membership=await requireKatoSyncMembership(owner,headers,request);
  if(membership!=="active")return fail(membership==="not_member"?403:503,
    membership==="not_member"?"KATOSYNC_MEMBERSHIP_REQUIRED":"MEMBERSHIP_UNAVAILABLE");
  const deviceURL=new URL(ORIGIN+"/rest/v1/mesh_devices");
  deviceURL.searchParams.set("select","device_id,owner_user_id,signing_public_key,membership_state,revoked_at");
  deviceURL.searchParams.set("owner_user_id","eq."+owner);
  deviceURL.searchParams.set("device_id","eq."+proof.deviceId);
  deviceURL.searchParams.set("limit","2");
  const res=await request(deviceURL,{headers:{...headers,"Accept-Profile":SCHEMA},signal:AbortSignal.timeout(8000)});
  if(!res.ok)return fail(503,"REGISTRY_UNAVAILABLE");
  const devices:unknown=await res.json();
  if(!Array.isArray(devices)||devices.length!==1)return fail(403,"DEVICE_NOT_REGISTERED");
  const device=devices[0] as Device;
  if(device.owner_user_id!==owner||device.device_id!==proof.deviceId||
     device.membership_state!=="discovered"||device.revoked_at!==null||
     typeof device.signing_public_key!=="string"||!B43.test(device.signing_public_key))
    return fail(403,"DEVICE_NOT_ELIGIBLE");
  if(!await verifyDeviceProof(proof,owner,device.signing_public_key))return fail(403,"INVALID_DEVICE_SIGNATURE");

  // Bind one valid signature to one use. DB unique index + transaction rate guard.
  const used=await request(ORIGIN+"/rest/v1/mesh_inbox_proofs",{
    method:"POST",headers:{...headers,"Content-Profile":SCHEMA,"content-type":"application/json",Prefer:"return=representation"},
    body:JSON.stringify({owner_user_id:owner,device_id:proof.deviceId,signing_public_key:device.signing_public_key,nonce:proof.nonce,
      action:proof.action,request_id:proof.requestId,expires_at:new Date(proof.expiresAt*1000).toISOString()}),
    signal:AbortSignal.timeout(8000)
  });
  if(!used.ok){
    if(used.status===409)return fail(409,"PROOF_ALREADY_USED");
    if(used.status===400){
      const e=await used.json().catch(()=>null) as {code?:unknown;message?:unknown}|null;
      if(e?.code==="23514"&&e.message==="KATOSYNC_MESH_INBOX_PROOF_RATE_LIMIT")return fail(429,"RATE_LIMIT");
    }
    return fail(503,"INBOX_UNAVAILABLE");
  }

  // A receipt confirms the exact, newly inserted single-use proof. Never allow
  // arbitrary client supplied proof IDs to select a different recipient/action.
  const proofRows:unknown=await used.json().catch(()=>null);
  if(!Array.isArray(proofRows)||proofRows.length!==1)return fail(503,"INBOX_PROOF_UNCONFIRMED");
  const saved=proofRows[0] as Record<string,unknown>;
  if(typeof saved.proof_id!=="string"||!UUID.test(saved.proof_id)||
     saved.owner_user_id!==owner||saved.device_id!==proof.deviceId||
     saved.signing_public_key!==device.signing_public_key||
     saved.action!==proof.action||saved.request_id!==proof.requestId||
     saved.nonce!==proof.nonce||typeof saved.expires_at!=="string"||
     Date.parse(saved.expires_at)!==proof.expiresAt*1000)
    return fail(503,"INBOX_PROOF_UNCONFIRMED");
  // Long network stalls or account revocation must not authorize a late
  // read/update just because the signature passed at request ingress.
  if(proof.expiresAt*1000<=Date.now())return fail(409,"PROOF_EXPIRED");

  // Owner membership can be revoked while checking signature; re-check before data access.
  const fresh=await requireKatoSyncMembership(owner,headers,request);
  if(fresh!=="active")return fail(fresh==="not_member"?403:503,
    fresh==="not_member"?"KATOSYNC_MEMBERSHIP_REQUIRED":"MEMBERSHIP_UNAVAILABLE");

  const inboxURL=new URL(ORIGIN+"/rest/v1/mesh_invites");
  inboxURL.searchParams.set("select","request_id,owner_user_id,source_device_id,target_device_id,state,expires_at,signed_offer,dispatch_signature");
  inboxURL.searchParams.set("owner_user_id","eq."+owner);
  inboxURL.searchParams.set("target_device_id","eq."+proof.deviceId);
  inboxURL.searchParams.set("state","eq.pending");
  inboxURL.searchParams.set("expires_at","gt."+new Date().toISOString());
  if(proof.action==="list"){
    inboxURL.searchParams.set("limit","10");
    inboxURL.searchParams.set("order","created_at.desc");
    const listing=await request(inboxURL,{headers:{...headers,"Accept-Profile":SCHEMA},signal:AbortSignal.timeout(8000)});
    if(!listing.ok)return fail(503,"INBOX_UNAVAILABLE");
    const rows:unknown=await listing.json();
    if(!Array.isArray(rows)||rows.length>10||!rows.every(x=>validInvite(x,owner,proof.deviceId)))
      return fail(503,"INBOX_INVALID_RESPONSE");
    // Never promote a signed-in owner's *unverified database row* into a
    // readable invitation. Re-check each original sender against the live
    // account-scoped roster and independently verify both Ed25519 signatures.
    // One batched roster query keeps the device lookup bounded to <= 10.
    const pending=rows as Invite[];
    if(pending.length){
      const sourceIds=[...new Set(pending.map(x=>x.source_device_id))];
      const sourceURL=new URL(ORIGIN+"/rest/v1/mesh_devices");
      sourceURL.searchParams.set("select","device_id,owner_user_id,signing_public_key,membership_state,revoked_at");
      sourceURL.searchParams.set("owner_user_id","eq."+owner);
      sourceURL.searchParams.set("device_id","in.("+sourceIds.join(",")+")");
      sourceURL.searchParams.set("limit",String(sourceIds.length+1));
      const sourcesResponse=await request(sourceURL,{
        headers:{...headers,"Accept-Profile":SCHEMA},signal:AbortSignal.timeout(8000)
      });
      if(!sourcesResponse.ok)return fail(503,"INBOX_SOURCE_UNAVAILABLE");
      const sourceRows:unknown=await sourcesResponse.json();
      if(!Array.isArray(sourceRows)||sourceRows.length!==sourceIds.length)
        return fail(503,"INBOX_SOURCE_UNVERIFIED");
      const sourceKeys=new Map<string,string>();
      for(const item of sourceRows){
        if(!item||typeof item!=="object"||Array.isArray(item))
          return fail(503,"INBOX_SOURCE_UNVERIFIED");
        const source=item as Device;
        if(!sourceIds.includes(source.device_id)||sourceKeys.has(source.device_id)||
          source.owner_user_id!==owner||source.membership_state!=="discovered"||
          source.revoked_at!==null||typeof source.signing_public_key!=="string"||
          !B43.test(source.signing_public_key))
          return fail(503,"INBOX_SOURCE_UNVERIFIED");
        sourceKeys.set(source.device_id,source.signing_public_key);
      }
      for(const invitation of pending){
        const signedOffer=invitation.signed_offer as Record<string,unknown>;
        if(sourceKeys.get(invitation.source_device_id)!==signedOffer.publicKey||
          !await verifyStoredSignedMeshInvite({
            protocol:"katosync-mesh-inbox-send-v1",
            sourceDeviceId:invitation.source_device_id,
            targetDeviceId:invitation.target_device_id,
            signedOffer:invitation.signed_offer,
            dispatchSignature:invitation.dispatch_signature
          },owner))
          return fail(503,"INBOX_SOURCE_UNVERIFIED");
      }
      if(proof.expiresAt*1000<=Date.now())return fail(409,"PROOF_EXPIRED");
    }
    const invitations=pending.map(x=>({
      requestId:x.request_id,sourceDeviceId:x.source_device_id,
      targetDeviceId:x.target_device_id,expiresAt:x.expires_at,
      signedOffer:x.signed_offer,dispatchSignature:x.dispatch_signature
    }));
    return Response.json({invitations,discoveryOnly:true,paired:false,transportReady:false,remoteJobsEnabled:false},
      {status:200,headers:HEAD});
  }

  // Single conditional UPDATE is the actual decision lock. No pre-read race.
  inboxURL.searchParams.set("request_id","eq."+proof.requestId);
  inboxURL.searchParams.set("select","request_id,owner_user_id,target_device_id,state,resolved_at");
  const decision=proof.action==="accept"?"accepted":"rejected";
  if(proof.expiresAt*1000<=Date.now())return fail(409,"PROOF_EXPIRED");
  const updated=await request(inboxURL,{
    method:"PATCH",headers:{...headers,"Content-Profile":SCHEMA,"content-type":"application/json",Prefer:"return=representation"},
    body:JSON.stringify({state:decision,resolved_at:new Date().toISOString(),
      resolution_proof_id:saved.proof_id}),signal:AbortSignal.timeout(8000)
  });
  if(!updated.ok)return fail(503,"INBOX_UNAVAILABLE");
  const rows:unknown=await updated.json();
  if(!Array.isArray(rows)||rows.length>1)return fail(503,"INBOX_INVALID_RESPONSE");
  if(rows.length===0)return fail(409,"INVITE_NOT_PENDING");
  const x=rows[0] as Record<string,unknown>;
  if(x.owner_user_id!==owner||x.target_device_id!==proof.deviceId||x.request_id!==proof.requestId||
     x.state!==decision||typeof x.resolved_at!=="string")return fail(503,"INBOX_INVALID_RESPONSE");
  return Response.json({requestId:proof.requestId,state:decision,decisionOnly:true,
    paired:false,transportReady:false,remoteJobsEnabled:false},{status:200,headers:HEAD});
 }catch{return fail(503,"INBOX_UNAVAILABLE");}
}
