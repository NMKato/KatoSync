// NMKato Solutions — Stage 3O: isolated tenant read-only integration preflight.
// NEVER auto-enrolls devices, accepts invitations, pairs peers, or performs writes.
import {resolveMeshRelayOrigin,MESH_LIVE_ORIGIN} from "../mesh-pairing-relay/origin-gate.ts";
import {requireMeshRelayMembership} from "../mesh-pairing-relay/qa-membership.ts";

type Env={
 SUPABASE_URL:string;
 SUPABASE_ANON_KEY:string;
 SUPABASE_SERVICE_ROLE_KEY:string;
 KATOSYNC_MESH_RELAY_QA_MODE?:string;
 KATOSYNC_MESH_RELAY_QA_PROJECT_REF?:string;
 DENO_DEPLOYMENT_ID?:string;
 KATOSYNC_MESH_PREVIEW_READINESS_STAGE:string;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEAD={"content-type":"application/json","cache-control":"no-store"};
const fail=(status:number,error:string)=>Response.json({error},{status,headers:HEAD});
// Only fixed, owner-filtered schema availability probes, never data retrieval.
const TABLES=[
 "mesh_enrollment_challenges","mesh_owner_policy","mesh_devices",
 "mesh_invites","mesh_inbox_proofs","mesh_pairing_relay_messages",
 "mesh_pairing_relay_reads"
] as const;
async function readBodyBounded(req:Request,max:number):Promise<string>{
 const reader=req.body?.getReader();
 if(!reader)throw Error("EMPTY_PREVIEW_REQUEST");
 const chunks:Uint8Array[]=[];
 let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.byteLength;
   if(size>max)throw Error("PREVIEW_REQUEST_TOO_LARGE");
   chunks.push(value);
  }
  return new TextDecoder("utf-8",{fatal:true}).decode(
   Uint8Array.from(chunks.flatMap(x=>Array.from(x))));
 }finally{reader.releaseLock();}
}
async function jsonLimited(response:Response,max:number):Promise<unknown>{
 const data=await response.text();
 if(data.length>max)throw Error("PREVIEW_RESPONSE_TOO_LARGE");
 return JSON.parse(data);
}
export async function handleMeshPreviewReadiness(
 req:Request,env:Env,request:typeof fetch=fetch
):Promise<Response>{
 if(req.method!=="POST")return fail(405,"METHOD_NOT_ALLOWED");
 const origin=resolveMeshRelayOrigin(env);
 // Exclude the original KATOOS tenant, even if its schema is healthy.
 if(env.KATOSYNC_MESH_PREVIEW_READINESS_STAGE!=="read-only-probe"||
    env.KATOSYNC_MESH_RELAY_QA_MODE!=="isolated-preview-only"||
    !origin||origin===MESH_LIVE_ORIGIN||
    !env.SUPABASE_ANON_KEY||!env.SUPABASE_SERVICE_ROLE_KEY||
    env.SUPABASE_ANON_KEY===env.SUPABASE_SERVICE_ROLE_KEY)
   return fail(503,"QA_PREVIEW_NOT_CONFIGURED");
 const bearer=req.headers.get("authorization")??"";
 if(!/^Bearer [A-Za-z0-9_.-]{30,8192}$/.test(bearer))return fail(401,"LOGIN_REQUIRED");
 if(!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
   return fail(400,"BAD_REQUEST");
 try{
  let command:unknown;
  try{command=JSON.parse(await readBodyBounded(req,128));}
  catch{return fail(400,"BAD_REQUEST");}
  if(!command||typeof command!=="object"||Array.isArray(command)||
     Object.keys(command).length!==1||
     (command as Record<string,unknown>).action!=="probe")return fail(400,"BAD_REQUEST");
  const identity=await request(origin+"/auth/v1/user",{
   method:"GET",headers:{authorization:bearer,apikey:env.SUPABASE_ANON_KEY},
   redirect:"error",signal:AbortSignal.timeout(8000)
  });
  if(!identity.ok)return fail(401,"LOGIN_REQUIRED");
  const user=await jsonLimited(identity,2048) as {id?:unknown;is_anonymous?:unknown};
  if(!user||typeof user.id!=="string"||!UUID.test(user.id)||user.is_anonymous===true)
   return fail(401,"LOGIN_REQUIRED");
  const owner=user.id,privileged={
   apikey:env.SUPABASE_SERVICE_ROLE_KEY,
   Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY
  };
  const current=await requireMeshRelayMembership(owner,privileged,request,origin);
  if(current!=="active")return fail(current==="not_member"?403:503,
   current==="not_member"?"KATOSYNC_MEMBERSHIP_REQUIRED":"MEMBERSHIP_UNAVAILABLE");
  // Never issue a write. Query only a single projected owner identity row.
  for(const table of TABLES){
   const url=new URL(origin+"/rest/v1/"+table);
   url.searchParams.set("select","owner_user_id");
   url.searchParams.set("owner_user_id","eq."+owner);
   url.searchParams.set("limit","1");
   const result=await request(url,{
    method:"GET",headers:{...privileged,"Accept-Profile":"katosync"},
    redirect:"error",signal:AbortSignal.timeout(8000)
   });
   if(!result.ok)return fail(503,"PREVIEW_SCHEMA_UNAVAILABLE");
   const records=await jsonLimited(result,2048);
   if(!Array.isArray(records)||records.length>1||
      records.some(row=>!row||typeof row!=="object"||
        (row as Record<string,unknown>).owner_user_id!==owner))
      return fail(503,"PREVIEW_SCHEMA_UNAVAILABLE");
  }
  // Detect revoked ownership during the sequence before returning readiness.
  const fresh=await requireMeshRelayMembership(owner,privileged,request,origin);
  if(fresh!=="active")return fail(fresh==="not_member"?403:503,
    fresh==="not_member"?"KATOSYNC_MEMBERSHIP_REQUIRED":"MEMBERSHIP_UNAVAILABLE");
  return Response.json({
   result:"QA_SCHEMA_READ_ONLY_READY",probeOnly:true,authenticated:true,
   tenantOriginVerified:true,requiredTablesVerified:TABLES.length,
   discoveryEnabled:false,inviteSendEnabled:false,inviteDecisionsEnabled:false,
   paired:false,transportReady:false,remoteJobsEnabled:false
  },{status:200,headers:HEAD});
 }catch{return fail(503,"QA_PREVIEW_UNAVAILABLE");}
}
