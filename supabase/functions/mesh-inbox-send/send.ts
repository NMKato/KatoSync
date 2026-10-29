// NMKato Solutions — Stage 2L. Signed, recipient-bound delivery only; NEVER grants peer trust.
import {requireKatoSyncMembership} from "../mesh-device-enrollment/membership-gate.ts";
const ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co",SCHEMA="katosync";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const B43=/^[A-Za-z0-9_-]{43}$/,B86=/^[A-Za-z0-9_-]{86}$/;
const HEAD={"content-type":"application/json","cache-control":"no-store"};
const fail=(status:number,error:string)=>Response.json({error},{status,headers:HEAD});
const enc=new TextEncoder();
const b64=(v:Uint8Array)=>btoa(String.fromCharCode(...v)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
function decode(s:string):Uint8Array {
 const v=Uint8Array.from(atob(s.replaceAll("-","+").replaceAll("_","/").padEnd(Math.ceil(s.length/4)*4,"=")),c=>c.charCodeAt(0));
 if(b64(v)!==s)throw Error("bad encoding");
 return v;
}
type Offer={protocol:string;publicKey:string;nonce:string;expiresAt:number;accountScope:string;signature:string};
type Send={protocol:string;sourceDeviceId:string;targetDeviceId:string;signedOffer:Offer;dispatchSignature:string};
type Env={SUPABASE_URL:string;SUPABASE_ANON_KEY:string;SUPABASE_SERVICE_ROLE_KEY:string;KATOSYNC_MESH_INBOX_STAGE:string};
type Device={device_id:string;owner_user_id:string;signing_public_key:string;membership_state:string;revoked_at:string|null};
function parse(raw:unknown):Send|null{
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).length!==5)return null;
 const b=raw as Record<string,unknown>,o=b.signedOffer as Record<string,unknown>;
 if(b.protocol!=="katosync-mesh-inbox-send-v1"||typeof b.sourceDeviceId!=="string"||
    typeof b.targetDeviceId!=="string"||!UUID.test(b.sourceDeviceId)||!UUID.test(b.targetDeviceId)||
    b.sourceDeviceId===b.targetDeviceId||typeof b.dispatchSignature!=="string"||!B86.test(b.dispatchSignature)||
    !o||typeof o!=="object"||Array.isArray(o)||Object.keys(o).length!==6||
    o.protocol!=="katosync-mesh-pairing-v1"||typeof o.publicKey!=="string"||!B43.test(o.publicKey)||
    typeof o.nonce!=="string"||!B43.test(o.nonce)||typeof o.accountScope!=="string"||!B43.test(o.accountScope)||
    typeof o.expiresAt!=="number"||!Number.isSafeInteger(o.expiresAt)||
    typeof o.signature!=="string"||!B86.test(o.signature))return null;
 return raw as Send;
}
async function verified(body:Send,uid:string):Promise<boolean>{
 const o=body.signedOffer,now=Date.now();
 if(o.expiresAt*1000<=now+2000||o.expiresAt*1000>now+310000)return false;
 const scope=b64(new Uint8Array(await crypto.subtle.digest("SHA-256",
   enc.encode("katosync-mesh-v1-account-scope:"+ORIGIN+":"+uid))));
 if(scope!==o.accountScope)return false;
 const rawKey=decode(o.publicKey),nonce=decode(o.nonce),sig=decode(o.signature),recipientSig=decode(body.dispatchSignature);
 if(rawKey.length!==32||nonce.length!==32||sig.length!==64||recipientSig.length!==64)return false;
 const key=await crypto.subtle.importKey("raw",rawKey,{name:"Ed25519"},false,["verify"]);
 const payload=[o.protocol,o.accountScope,o.publicKey,o.nonce,String(o.expiresAt)].join("|");
 const delivery=[body.protocol,o.accountScope,body.sourceDeviceId,body.targetDeviceId,o.nonce,String(o.expiresAt)].join("|");
 return await crypto.subtle.verify("Ed25519",key,sig,enc.encode(payload))
    &&await crypto.subtle.verify("Ed25519",key,recipientSig,enc.encode(delivery));
}
export async function submitSignedMeshInvite(req:Request,env:Env,request:typeof fetch=fetch):Promise<Response>{
 if(req.method!=="POST")return fail(405,"METHOD_NOT_ALLOWED");
 if(env.KATOSYNC_MESH_INBOX_STAGE!=="send-only"||env.SUPABASE_URL!==ORIGIN||
    !env.SUPABASE_ANON_KEY||!env.SUPABASE_SERVICE_ROLE_KEY)return fail(503,"INBOX_NOT_CONFIGURED");
 const bearer=req.headers.get("authorization")??"";
 if(!/^Bearer [A-Za-z0-9_.-]{30,8192}$/.test(bearer))return fail(401,"LOGIN_REQUIRED");
 if(!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return fail(400,"BAD_REQUEST");
 let body:Send|null;
 try{const raw=await req.text();if(raw.length>2500)return fail(400,"BAD_REQUEST");body=parse(JSON.parse(raw));}
 catch{return fail(400,"BAD_REQUEST");}
 if(!body)return fail(400,"BAD_INVITE");
 try{
  const auth=await request(ORIGIN+"/auth/v1/user",{headers:{Authorization:bearer,apikey:env.SUPABASE_ANON_KEY},signal:AbortSignal.timeout(8000)});
  if(!auth.ok)return fail(401,"LOGIN_REQUIRED");
  const user=await auth.json() as {id?:unknown;is_anonymous?:unknown};
  if(typeof user.id!=="string"||!UUID.test(user.id)||user.is_anonymous===true)return fail(401,"LOGIN_REQUIRED");
  const owner=user.id,headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
  const member=await requireKatoSyncMembership(owner,headers,request);
  if(member!=="active")return fail(member==="not_member"?403:503,member==="not_member"?"KATOSYNC_MEMBERSHIP_REQUIRED":"MEMBERSHIP_UNAVAILABLE");
  if(!await verified(body,owner))return fail(403,"INVALID_DEVICE_SIGNATURE");
  const url=new URL(ORIGIN+"/rest/v1/mesh_devices");
  url.searchParams.set("select","device_id,owner_user_id,signing_public_key,membership_state,revoked_at");
  url.searchParams.set("owner_user_id","eq."+owner);
  url.searchParams.set("device_id","in.("+body.sourceDeviceId+","+body.targetDeviceId+")");
  url.searchParams.set("limit","3");
  const r=await request(url,{headers:{...headers,"Accept-Profile":SCHEMA},signal:AbortSignal.timeout(8000)});
  if(!r.ok)return fail(503,"REGISTRY_UNAVAILABLE");
  const rows:unknown=await r.json();
  if(!Array.isArray(rows)||rows.length!==2)return fail(403,"DEVICE_NOT_REGISTERED");
  const devices=rows as Device[],source=devices.find(x=>x.device_id===body.sourceDeviceId),target=devices.find(x=>x.device_id===body.targetDeviceId);
  if(!source||!target||devices.some(x=>x.owner_user_id!==owner||x.membership_state!=="discovered"||x.revoked_at!==null)||
     source.signing_public_key!==body.signedOffer.publicKey||source.signing_public_key===target.signing_public_key)
    return fail(403,"DEVICE_NOT_ELIGIBLE");
  const current=await requireKatoSyncMembership(owner,headers,request);
  if(current!=="active")return fail(current==="not_member"?403:503,current==="not_member"?"KATOSYNC_MEMBERSHIP_REQUIRED":"MEMBERSHIP_UNAVAILABLE");
  const result=await request(ORIGIN+"/rest/v1/mesh_invites",{
   method:"POST",headers:{...headers,"Content-Profile":SCHEMA,"content-type":"application/json",Prefer:"return=representation"},
   body:JSON.stringify({owner_user_id:owner,source_device_id:body.sourceDeviceId,target_device_id:body.targetDeviceId,
    nonce:body.signedOffer.nonce,signed_offer:body.signedOffer,dispatch_signature:body.dispatchSignature,state:"pending",
    expires_at:new Date(body.signedOffer.expiresAt*1000).toISOString()}),signal:AbortSignal.timeout(8000)
  });
  if(!result.ok){
   if(result.status===400||result.status===409){
    const e=await result.json().catch(()=>null) as {code?:unknown;message?:unknown}|null;
    if(e?.code==="23505")return fail(409,"INVITE_ALREADY_USED");
    if(e?.code==="23514"&&e.message==="KATOSYNC_MESH_INVITE_RATE_LIMIT")return fail(429,"RATE_LIMIT");
    if(e?.code==="23514"&&e.message==="KATOSYNC_MESH_INVITE_ALREADY_PENDING")return fail(409,"ALREADY_PENDING");
   }
   return fail(503,"INBOX_UNAVAILABLE");
  }
  const inserted:unknown=await result.json();
  if(!Array.isArray(inserted)||inserted.length!==1||typeof inserted[0]?.request_id!=="string"||
     !UUID.test(inserted[0].request_id))return fail(503,"INBOX_UNAVAILABLE");
  return Response.json({requestId:inserted[0].request_id,
   expiresAt:new Date(body.signedOffer.expiresAt*1000).toISOString(),
   deliveryOnly:true,paired:false,transportReady:false,remoteJobsEnabled:false},{status:202,headers:HEAD});
 }catch{return fail(503,"INBOX_UNAVAILABLE");}
}
