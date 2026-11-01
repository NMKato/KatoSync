// NMKato Solutions – Stage 3H: STAGED Edge relay, disabled by default.
// Public Ed25519 challenge/response messages only. No SAS approval/trust/TLS.
import {requireKatoSyncMembership} from "../mesh-device-enrollment/membership-gate.ts";
import {resolveMeshRelayOrigin} from "./origin-gate.ts";
import {parseRelayEnvelope,parseRelayListProof,verifyRelayEnvelope,
 verifyRelayListProof,type RelayEnvelope,type RelayListProof,type RelayInvite} from "./protocol.ts";
const SCHEMA="katosync";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEAD={"content-type":"application/json","cache-control":"no-store"};
const fail=(status:number,error:string)=>Response.json({error},{status,headers:HEAD});
type Env={SUPABASE_URL:string;SUPABASE_ANON_KEY:string;SUPABASE_SERVICE_ROLE_KEY:string;KATOSYNC_MESH_PAIRING_RELAY_STAGE:string;
 KATOSYNC_MESH_RELAY_QA_MODE?:string;KATOSYNC_MESH_RELAY_QA_PROJECT_REF?:string;DENO_DEPLOYMENT_ID?:string};
type Device={device_id:string;owner_user_id:string;signing_public_key:string;membership_state:string;revoked_at:string|null};
type Row={message_id:string;owner_user_id:string;request_id:string;sender_device_id:string;recipient_device_id:string;
 kind:"challenge"|"response";payload_b64:string;nonce:string;signature:string;expires_at:string};
const service=(e:Env)=>({apikey:e.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+e.SUPABASE_SERVICE_ROLE_KEY});
const head=(e:Env)=>({...service(e),"Accept-Profile":SCHEMA});
const jsonHead=(e:Env)=>({...service(e),"Content-Profile":SCHEMA,"content-type":"application/json",Prefer:"return=representation"});
async function records(url:URL,e:Env,request:typeof fetch,limit:number):Promise<unknown[]|null>{
 const res=await request(url,{headers:head(e),signal:AbortSignal.timeout(8000)});
 if(!res.ok)return null;
 const bytes=await res.text();
 if(bytes.length>32_768)return null;
 const val=JSON.parse(bytes) as unknown;
 return Array.isArray(val)&&val.length<=limit?val:null;
}
async function devices(owner:string,ids:string[],e:Env,request:typeof fetch,origin:string):Promise<Map<string,string>|null>{
 if(ids.length<1||ids.length>2||new Set(ids).size!==ids.length||!ids.every(x=>UUID.test(x)))return null;
 const url=new URL(origin+"/rest/v1/mesh_devices");
 url.searchParams.set("select","device_id,owner_user_id,signing_public_key,membership_state,revoked_at");
 url.searchParams.set("owner_user_id","eq."+owner);
 url.searchParams.set("device_id","in.("+ids.join(",")+")");
 url.searchParams.set("limit",String(ids.length+1));
 const rows=await records(url,e,request,ids.length+1);
 if(!rows||rows.length!==ids.length)return null;
 const mapped=new Map<string,string>();
 for(const record of rows){
  if(!record||typeof record!=="object"||Array.isArray(record))return null;
  const d=record as Device;
  if(!ids.includes(d.device_id)||mapped.has(d.device_id)||d.owner_user_id!==owner||
   d.membership_state!=="discovered"||d.revoked_at!==null||
   typeof d.signing_public_key!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(d.signing_public_key))return null;
  mapped.set(d.device_id,d.signing_public_key);
 }
 if(new Set(mapped.values()).size!==mapped.size)return null;
 return mapped;
}
async function invite(owner:string,id:string,e:Env,request:typeof fetch,origin:string):Promise<RelayInvite|null>{
 if(!UUID.test(id))return null;
 const url=new URL(origin+"/rest/v1/mesh_invites");
 url.searchParams.set("select","request_id,owner_user_id,source_device_id,target_device_id,state,expires_at,signed_offer");
 url.searchParams.set("owner_user_id","eq."+owner);
 url.searchParams.set("request_id","eq."+id);
 url.searchParams.set("limit","2");
 const rows=await records(url,e,request,2);
 if(!rows||rows.length!==1)return null;
 const record=rows[0] as RelayInvite;
 if(!record||record.owner_user_id!==owner||record.request_id!==id||record.state!=="accepted"||
  !UUID.test(String(record.source_device_id))||!UUID.test(String(record.target_device_id))||
  record.source_device_id===record.target_device_id||
  !Number.isFinite(Date.parse(record.expires_at))||Date.parse(record.expires_at)<=Date.now())return null;
 return record;
}
function toEnvelope(row:Row):RelayEnvelope|null{
 if(!row||typeof row!=="object"||Array.isArray(row))return null;
 if(!UUID.test(row.message_id)||!UUID.test(row.request_id)||!UUID.test(row.sender_device_id)||
  !UUID.test(row.recipient_device_id)||!Number.isFinite(Date.parse(row.expires_at)))return null;
 return parseRelayEnvelope({protocol:"katosync-mesh-pairing-relay-v1",requestId:row.request_id,
  senderDeviceId:row.sender_device_id,recipientDeviceId:row.recipient_device_id,kind:row.kind,
  payloadB64:row.payload_b64,nonce:row.nonce,expiresAt:Date.parse(row.expires_at)/1000,
  signature:row.signature});
}
export async function handleMeshPairingRelay(req:Request,e:Env,request:typeof fetch=fetch):Promise<Response>{
 if(req.method!=="POST")return fail(405,"METHOD_NOT_ALLOWED");
 const origin=resolveMeshRelayOrigin(e);
 if(e.KATOSYNC_MESH_PAIRING_RELAY_STAGE!=="qa-relay"||!origin||
  !e.SUPABASE_ANON_KEY||!e.SUPABASE_SERVICE_ROLE_KEY)return fail(503,"RELAY_NOT_CONFIGURED");
 const bearer=req.headers.get("authorization")??"";
 if(!/^Bearer [A-Za-z0-9_.-]{30,8192}$/.test(bearer))return fail(401,"LOGIN_REQUIRED");
 if(!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return fail(400,"BAD_REQUEST");
 let action:"send"|"list",payload:RelayEnvelope|RelayListProof;
 try{
  const raw=await req.text();
  if(raw.length>14000)return fail(400,"BAD_REQUEST");
  const obj=JSON.parse(raw) as unknown;
  if(!obj||typeof obj!=="object"||Array.isArray(obj)||Object.keys(obj).length!==2)return fail(400,"BAD_REQUEST");
  const body=obj as {action?:unknown;payload?:unknown};
  if(body.action==="send"){action="send";const parsed=parseRelayEnvelope(body.payload);
   if(!parsed)return fail(400,"BAD_ENVELOPE");payload=parsed;}
  else if(body.action==="list"){action="list";const parsed=parseRelayListProof(body.payload);
   if(!parsed)return fail(400,"BAD_PROOF");payload=parsed;}
  else return fail(400,"BAD_ACTION");
 }catch{return fail(400,"BAD_REQUEST");}
 try{
  const auth=await request(origin+"/auth/v1/user",{headers:{Authorization:bearer,apikey:e.SUPABASE_ANON_KEY},
   signal:AbortSignal.timeout(8000)});
  if(!auth.ok)return fail(401,"LOGIN_REQUIRED");
  const user=await auth.json() as {id?:unknown;is_anonymous?:unknown};
  if(typeof user.id!=="string"||!UUID.test(user.id)||user.is_anonymous===true)return fail(401,"LOGIN_REQUIRED");
  const owner=user.id;
  const membership=await requireKatoSyncMembership(owner,service(e),request,origin);
  if(membership!=="active")return fail(membership==="not_member"?403:503,
   membership==="not_member"?"MEMBERSHIP_REQUIRED":"MEMBERSHIP_UNAVAILABLE");
  if(action==="send"){
   const msg=payload as RelayEnvelope;
   const inv=await invite(owner,msg.requestId,e,request,origin);
   if(!inv)return fail(403,"INVITE_NOT_ELIGIBLE");
   const roster=await devices(owner,[inv.source_device_id,inv.target_device_id],e,request,origin);
   if(!roster)return fail(403,"DEVICE_NOT_ELIGIBLE");
   if(!await verifyRelayEnvelope(msg,owner,roster.get(inv.source_device_id)??"",
    roster.get(inv.target_device_id)??"",inv,Date.now(),origin))return fail(403,"INVALID_DEVICE_SIGNATURE");
   // Membership and expired invitations must still be valid immediately before INSERT.
   if(await requireKatoSyncMembership(owner,service(e),request,origin)!=="active"||
    Date.parse(inv.expires_at)<=Date.now()||msg.expiresAt*1000<=Date.now())
    return fail(403,"RELAY_NO_LONGER_AUTHORIZED");
   const inserted=await request(origin+"/rest/v1/mesh_pairing_relay_messages",{
    method:"POST",headers:jsonHead(e),body:JSON.stringify({
     owner_user_id:owner,request_id:msg.requestId,sender_device_id:msg.senderDeviceId,
     recipient_device_id:msg.recipientDeviceId,kind:msg.kind,payload_b64:msg.payloadB64,
     nonce:msg.nonce,signature:msg.signature,expires_at:new Date(msg.expiresAt*1000).toISOString()
    }),signal:AbortSignal.timeout(8000)});
   if(!inserted.ok)return fail(inserted.status===409?409:503,
    inserted.status===409?"RELAY_ALREADY_SENT":"RELAY_UNAVAILABLE");
   const rows=await inserted.json() as unknown;
   if(!Array.isArray(rows)||rows.length!==1||typeof rows[0]?.message_id!=="string"||
    !UUID.test(rows[0].message_id)||rows[0].owner_user_id!==owner||
    rows[0].request_id!==msg.requestId||rows[0].sender_device_id!==msg.senderDeviceId||
    rows[0].recipient_device_id!==msg.recipientDeviceId||rows[0].kind!==msg.kind)
    return fail(503,"RELAY_RECEIPT_UNCONFIRMED");
   return Response.json({messageId:rows[0].message_id,deliveryOnly:true,paired:false,
    transportReady:false,remoteJobsEnabled:false},{status:202,headers:HEAD});
  }
  const proof=payload as RelayListProof;
  const registered=await devices(owner,[proof.deviceId],e,request,origin);
  if(!registered||!await verifyRelayListProof(proof,owner,registered.get(proof.deviceId)??"",Date.now(),origin))
   return fail(403,"INVALID_DEVICE_PROOF");
  // Atomic nonce replay defense. No direct authenticated SQL access.
  const used=await request(origin+"/rest/v1/mesh_pairing_relay_reads",{
   method:"POST",headers:jsonHead(e),body:JSON.stringify({owner_user_id:owner,
    device_id:proof.deviceId,nonce:proof.nonce,expires_at:new Date(proof.expiresAt*1000).toISOString()
   }),signal:AbortSignal.timeout(8000)});
  if(!used.ok)return fail(used.status===409?409:503,
   used.status===409?"PROOF_ALREADY_USED":"RELAY_READ_UNAVAILABLE");
  const readRows=await used.json() as unknown;
  if(!Array.isArray(readRows)||readRows.length!==1||readRows[0]?.owner_user_id!==owner||
   readRows[0].device_id!==proof.deviceId||readRows[0].nonce!==proof.nonce||
   Date.parse(String(readRows[0].expires_at))!==proof.expiresAt*1000)
   return fail(503,"READ_PROOF_UNCONFIRMED");
  if(proof.expiresAt*1000<=Date.now()||
   await requireKatoSyncMembership(owner,service(e),request,origin)!=="active")
   return fail(403,"RELAY_NO_LONGER_AUTHORIZED");
  const url=new URL(origin+"/rest/v1/mesh_pairing_relay_messages");
  url.searchParams.set("select","message_id,owner_user_id,request_id,sender_device_id,recipient_device_id,kind,payload_b64,nonce,signature,expires_at");
  url.searchParams.set("owner_user_id","eq."+owner);
  url.searchParams.set("recipient_device_id","eq."+proof.deviceId);
  url.searchParams.set("expires_at","gt."+new Date().toISOString());
  url.searchParams.set("order","created_at.desc");
  url.searchParams.set("limit","10");
  const rows=await records(url,e,request,10);
  if(!rows)return fail(503,"RELAY_UNAVAILABLE");
  const verified:RelayEnvelope[]=[];
  const seen=new Set<string>();
  for(const raw of rows){
   const row=raw as Row,env=toEnvelope(row);
   if(!env||row.owner_user_id!==owner||env.recipientDeviceId!==proof.deviceId||
    seen.has(row.message_id))return fail(503,"RELAY_INVALID_RECORD");
   seen.add(row.message_id);
   const inv=await invite(owner,env.requestId,e,request,origin);
   if(!inv)return fail(503,"RELAY_INVALID_RECORD");
   const roster=await devices(owner,[inv.source_device_id,inv.target_device_id],e,request,origin);
   if(!roster||!await verifyRelayEnvelope(env,owner,roster.get(inv.source_device_id)??"",
    roster.get(inv.target_device_id)??"",inv,Date.now(),origin))return fail(503,"RELAY_INVALID_SIGNATURE");
   verified.push(env);
  }
  if(proof.expiresAt*1000<=Date.now())return fail(409,"PROOF_EXPIRED");
  return Response.json({messages:verified,deliveryOnly:true,paired:false,
   transportReady:false,remoteJobsEnabled:false},{status:200,headers:HEAD});
 }catch{return fail(503,"RELAY_UNAVAILABLE");}
}
