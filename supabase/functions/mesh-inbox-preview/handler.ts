// Stage 3Q: QA-only, GET-only preview verifier, never persists invitations.
import {resolveMeshRelayOrigin,MESH_LIVE_ORIGIN} from "../mesh-pairing-relay/origin-gate.ts";
import {requireMeshRelayMembership} from "../mesh-pairing-relay/qa-membership.ts";
import {parseSendV2,parseRecipientV2,verifySendV2,verifyRecipientV2} from "./protocol.ts";
type Env={
 SUPABASE_URL:string;SUPABASE_ANON_KEY:string;SUPABASE_SERVICE_ROLE_KEY:string;
 KATOSYNC_MESH_RELAY_QA_MODE?:string;KATOSYNC_MESH_RELAY_QA_PROJECT_REF?:string;
 DENO_DEPLOYMENT_ID?:string;KATOSYNC_MESH_INBOX_V2_QA_STAGE:string
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEAD={"cache-control":"no-store","content-type":"application/json"};
const fail=(status:number,error:string)=>Response.json({error},{status,headers:HEAD});
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
async function readJson(response:Response,max:number):Promise<unknown>{
 const text=await response.text();
 if(text.length>max)throw Error("QA_RESPONSE_TOO_LARGE");
 return JSON.parse(text);
}
async function readBounded(req:Request,max:number):Promise<string>{
 const reader=req.body?.getReader();
 if(!reader)throw Error("EMPTY_REQUEST");
 const chunks:Uint8Array[]=[];
 let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.length;
   if(size>max)throw Error("REQUEST_TOO_LARGE");
   chunks.push(value);
  }
  return new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(chunks.flatMap(x=>Array.from(x))));
 }finally{reader.releaseLock();}
}
type Device={device_id:string;owner_user_id:string;signing_public_key:string;membership_state:string;revoked_at:string|null};
const eligible=(d:Device,owner:string)=>d.owner_user_id===owner&&
 d.membership_state==="discovered"&&d.revoked_at===null&&
 typeof d.signing_public_key==="string"&&/^[A-Za-z0-9_-]{43}$/.test(d.signing_public_key);
export async function handleInboxPreviewV2(
 req:Request,e:Env,request:typeof fetch=fetch,now=Date.now()
):Promise<Response>{
 if(req.method!=="POST")return fail(405,"METHOD_NOT_ALLOWED");
 const origin=resolveMeshRelayOrigin(e);
 if(e.KATOSYNC_MESH_INBOX_V2_QA_STAGE!=="verify-only"||
   e.KATOSYNC_MESH_RELAY_QA_MODE!=="isolated-preview-only"||
   !origin||origin===MESH_LIVE_ORIGIN||
   !e.SUPABASE_ANON_KEY||!e.SUPABASE_SERVICE_ROLE_KEY||
   e.SUPABASE_ANON_KEY===e.SUPABASE_SERVICE_ROLE_KEY)
   return fail(503,"QA_INBOX_NOT_CONFIGURED");
 const auth=req.headers.get("authorization")??"";
 if(!/^Bearer [A-Za-z0-9_.-]{30,8192}$/.test(auth))return fail(401,"LOGIN_REQUIRED");
 if(!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
   return fail(400,"BAD_REQUEST");
 try{
  let body:unknown;
  try{body=JSON.parse(await readBounded(req,2500));}
  catch{return fail(400,"BAD_REQUEST");}
  if(!isRecord(body)||Object.keys(body).length!==2||
    !Object.hasOwn(body,"action")||!Object.hasOwn(body,"payload"))return fail(400,"BAD_REQUEST");
  const send=body.action==="verify-send";
  const receive=body.action==="verify-recipient";
  if(!send&&!receive)return fail(400,"BAD_ACTION");
  const p=send?parseSendV2(body.payload):parseRecipientV2(body.payload);
  if(!p||p.origin!==origin)return fail(400,"BAD_PROOF");
  const userResponse=await request(origin+"/auth/v1/user",{
   method:"GET",headers:{authorization:auth,apikey:e.SUPABASE_ANON_KEY},
   redirect:"error",signal:AbortSignal.timeout(8000)
  });
  if(!userResponse.ok)return fail(401,"LOGIN_REQUIRED");
  const user=await readJson(userResponse,2048);
  if(!isRecord(user)||typeof user.id!=="string"||!UUID.test(user.id)||
     user.is_anonymous===true)return fail(401,"LOGIN_REQUIRED");
  const owner=user.id;
  const headers={apikey:e.SUPABASE_SERVICE_ROLE_KEY,
   Authorization:"Bearer "+e.SUPABASE_SERVICE_ROLE_KEY};
  const membership=await requireMeshRelayMembership(owner,headers,request,origin);
  if(membership!=="active")return fail(membership==="not_member"?403:503,"MEMBERSHIP_REQUIRED");
  const source=send?parseSendV2(body.payload):null;
  const recipient=receive?parseRecipientV2(body.payload):null;
  if(send&&!source||receive&&!recipient)return fail(400,"BAD_PROOF");
  const ids=source?[source.sourceDeviceId,source.targetDeviceId]:[recipient!.deviceId];
  const url=new URL(origin+"/rest/v1/mesh_devices");
  url.searchParams.set("select","device_id,owner_user_id,signing_public_key,membership_state,revoked_at");
  url.searchParams.set("owner_user_id","eq."+owner);
  url.searchParams.set("device_id",source?"in.("+ids.join(",")+")":"eq."+ids[0]);
  url.searchParams.set("limit",String(ids.length+1));
  const res=await request(url,{
   method:"GET",headers:{...headers,"Accept-Profile":"katosync"},
   redirect:"error",signal:AbortSignal.timeout(8000)
  });
  if(!res.ok)return fail(503,"QA_ROSTER_UNAVAILABLE");
  const rows=await readJson(res,4096);
  if(!Array.isArray(rows)||rows.length!==ids.length)return fail(403,"QA_ROSTER_INVALID");
  const devices=new Map<string,Device>();
  for(const value of rows){
   if(!isRecord(value))return fail(403,"QA_ROSTER_INVALID");
   const device=value as Device;
   if(!ids.includes(device.device_id)||devices.has(device.device_id)||
      !eligible(device,owner))return fail(403,"QA_ROSTER_INVALID");
   devices.set(device.device_id,device);
  }
  const accepted=source?
   await verifySendV2(source,owner,origin,devices.get(source.sourceDeviceId)!.signing_public_key,now)&&
     devices.get(source.sourceDeviceId)!.signing_public_key!==devices.get(source.targetDeviceId)!.signing_public_key:
   await verifyRecipientV2(recipient,owner,origin,devices.get(recipient!.deviceId)!.signing_public_key,now);
  if(!accepted)return fail(403,"QA_SIGNATURE_INVALID");
  const fresh=await requireMeshRelayMembership(owner,headers,request,origin);
  if(fresh!=="active")return fail(fresh==="not_member"?403:503,"MEMBERSHIP_REQUIRED");
  return Response.json({result:source?"QA_INBOX_SEND_SIGNATURE_VERIFIED":"QA_INBOX_RECIPIENT_SIGNATURE_VERIFIED",
   verifyOnly:true,invitationCreated:false,decisionApplied:false,
   paired:false,transportReady:false,remoteJobsEnabled:false},{status:200,headers:HEAD});
 }catch{return fail(503,"QA_INBOX_UNAVAILABLE");}
}
