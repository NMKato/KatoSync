// NMKato Solutions — signed, owner-scoped, low-frequency presence report.
// This proves a recent key-owner report, NEVER a trusted peer or reachable socket.
import {requireKatoSyncMembership} from "./membership-gate.ts";
import {readMeshDeviceAllowance} from "./device-entitlement.ts";
const ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co";
const SCHEMA="katosync";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY=/^[A-Za-z0-9_-]{43}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const MIN_REFRESH_MS=5*60_000;
const JSON_HEADERS={"content-type":"application/json","cache-control":"no-store"};
const fail=(status:number,error:string)=>new Response(JSON.stringify({error}),{status,headers:JSON_HEADERS});
type Env={SUPABASE_URL:string;SUPABASE_ANON_KEY:string;SUPABASE_SERVICE_ROLE_KEY:string;KATOSYNC_MESH_ENROLLMENT_STAGE:string};
export type HeartbeatProof={
  protocol:"katosync-mesh-device-heartbeat-v1";
  deviceId:string;publicKey:string;observedAtMs:number;signature:string;
};
type DeviceRow={
 device_id:string;owner_user_id:string;signing_public_key:string;
 membership_state:string;revoked_at:string|null;last_seen_at:string|null;
};
const decode=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")
  .padEnd(Math.ceil(s.length/4)*4,"=")),c=>c.charCodeAt(0));
export function parseHeartbeat(raw:unknown,nowMs:number):HeartbeatProof|null {
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||!Number.isSafeInteger(nowMs))return null;
 const obj=raw as Record<string,unknown>;
 if(Object.keys(obj).length!==5||
    obj.protocol!=="katosync-mesh-device-heartbeat-v1"||
    typeof obj.deviceId!=="string"||!UUID.test(obj.deviceId)||
    typeof obj.publicKey!=="string"||!KEY.test(obj.publicKey)||
    !Number.isSafeInteger(obj.observedAtMs)||
    (obj.observedAtMs as number)<nowMs-45_000||
    (obj.observedAtMs as number)>nowMs+10_000||
    typeof obj.signature!=="string"||!SIG.test(obj.signature))return null;
 return obj as unknown as HeartbeatProof;
}
export function heartbeatMessage(owner:string,proof:HeartbeatProof):Uint8Array {
 return new TextEncoder().encode([
   "katosync-mesh-device-heartbeat-v1",owner,proof.deviceId,
   proof.publicKey,String(proof.observedAtMs)
 ].join("\n"));
}
export function validateHeartbeatDevice(raw:unknown,owner:string,proof:HeartbeatProof):DeviceRow|null {
 if(!Array.isArray(raw)||raw.length!==1)return null;
 const row=raw[0] as DeviceRow;
 if(!row||row.owner_user_id!==owner||row.device_id!==proof.deviceId||
    row.signing_public_key!==proof.publicKey||row.revoked_at!==null||
    !["discovered","pending","trusted"].includes(row.membership_state)||
    (row.last_seen_at!==null&&
     (typeof row.last_seen_at!=="string"||!Number.isFinite(Date.parse(row.last_seen_at)))))
    return null;
 return row;
}
export async function handleSignedMeshHeartbeat(
 req:Request,env:Env,request:typeof fetch=fetch,nowMs=Date.now()
):Promise<Response> {
 if(req.method!=="POST")return fail(405,"METHOD_NOT_ALLOWED");
 if(env.SUPABASE_URL!==ORIGIN||env.KATOSYNC_MESH_ENROLLMENT_STAGE!=="challenge-and-discovery"||
    !env.SUPABASE_ANON_KEY||!env.SUPABASE_SERVICE_ROLE_KEY)return fail(503,"NOT_CONFIGURED");
 const bearer=req.headers.get("authorization")??"";
 if(!/^Bearer [A-Za-z0-9_.-]{30,8192}$/.test(bearer))return fail(401,"LOGIN_REQUIRED");
 if(!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return fail(400,"BAD_PROOF");
 let proof:HeartbeatProof|null=null;
 try{
  const body=await req.text();
  if(body.length>950)return fail(400,"BAD_PROOF");
  proof=parseHeartbeat(JSON.parse(body),nowMs);
 }catch{return fail(400,"BAD_PROOF");}
 if(!proof)return fail(400,"BAD_PROOF");
 try{
  const auth=await request(ORIGIN+"/auth/v1/user",{
   headers:{Authorization:bearer,apikey:env.SUPABASE_ANON_KEY},
   signal:AbortSignal.timeout(8000)
  });
  if(!auth.ok)return fail(401,"LOGIN_REQUIRED");
  const user=await auth.json() as {id?:unknown;is_anonymous?:unknown};
  if(typeof user.id!=="string"||!UUID.test(user.id)||user.is_anonymous===true)
    return fail(401,"LOGIN_REQUIRED");
  const uid=user.id;
  const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
  const member=await requireKatoSyncMembership(uid,headers,request);
  if(member==="not_member")return fail(403,"MEMBERSHIP_REQUIRED");
  if(member!=="active")return fail(503,"MEMBERSHIP_UNAVAILABLE");
  const policy=await readMeshDeviceAllowance(uid,headers,request,nowMs);
  if(policy.kind==="free")return fail(403,"MESH_PRO_REQUIRED");
  if(policy.kind!=="assigned")return fail(503,"ENTITLEMENT_UNAVAILABLE");
  const url=new URL(ORIGIN+"/rest/v1/mesh_devices");
  url.searchParams.set("select","device_id,owner_user_id,signing_public_key,membership_state,revoked_at,last_seen_at");
  url.searchParams.set("owner_user_id","eq."+uid);
  url.searchParams.set("device_id","eq."+proof.deviceId);
  url.searchParams.set("limit","2");
  const read=await request(url,{
    headers:{...headers,"Accept-Profile":SCHEMA},signal:AbortSignal.timeout(8000)
  });
  if(!read.ok)return fail(503,"REGISTRY_UNAVAILABLE");
  const raw=await read.text();
  if(raw.length>4096)return fail(503,"REGISTRY_UNAVAILABLE");
  const row=validateHeartbeatDevice(JSON.parse(raw),uid,proof);
  if(!row)return fail(403,"DEVICE_NOT_AUTHORIZED");
  const key=decode(row.signing_public_key),signature=decode(proof.signature);
  if(key.length!==32||signature.length!==64)return fail(400,"BAD_PROOF");
  const verifyKey=await crypto.subtle.importKey("raw",key,{name:"Ed25519"},false,["verify"]);
  if(!await crypto.subtle.verify("Ed25519",verifyKey,signature,heartbeatMessage(uid,proof)))
    return fail(403,"BAD_SIGNATURE");
  const oldMs=row.last_seen_at===null?0:Date.parse(row.last_seen_at);
  if(oldMs<=nowMs-MIN_REFRESH_MS){
    const update=new URL(ORIGIN+"/rest/v1/mesh_devices");
    update.searchParams.set("select","device_id");
    update.searchParams.set("device_id","eq."+proof.deviceId);
    update.searchParams.set("owner_user_id","eq."+uid);
    update.searchParams.set("signing_public_key","eq."+proof.publicKey);
    update.searchParams.set("membership_state","in.(discovered,pending,trusted)");
    update.searchParams.set("revoked_at","is.null");
    const cutoff=new Date(nowMs-MIN_REFRESH_MS).toISOString();
    update.searchParams.set("or","(last_seen_at.is.null,last_seen_at.lte."+cutoff+")");
    const patch=await request(update,{
      method:"PATCH",headers:{...headers,"Content-Profile":SCHEMA,
        "content-type":"application/json",Prefer:"return=representation"},
      body:JSON.stringify({last_seen_at:new Date(nowMs).toISOString()}),
      signal:AbortSignal.timeout(8000)
    });
    if(!patch.ok)return fail(503,"REGISTRY_UNAVAILABLE");
    const updated:unknown=await patch.json();
    if(!Array.isArray(updated)||updated.length>1||
       updated.some(x=>!x||typeof x!=="object"||
         (x as {device_id?:unknown}).device_id!==proof!.deviceId))
      return fail(503,"REGISTRY_UNAVAILABLE");
    // Zero modified rows can mean concurrent revocation or a racing heartbeat;
    // never return an accepted receipt without a confirmed current registration.
    if(updated.length!==1)return fail(409,"PRESENCE_RACE_OR_REVOKED");
  }
  return new Response(JSON.stringify({
    accepted:true,reportedRecently:true,paired:false,transportReady:false,
    remoteJobsEnabled:false,nextPollSeconds:600
  }),{status:200,headers:JSON_HEADERS});
 }catch{return fail(503,"REGISTRY_UNAVAILABLE");}
}
