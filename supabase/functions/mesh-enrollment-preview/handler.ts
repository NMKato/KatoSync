// Stage 3P: isolated enrollment proof verification; NEVER writes discovery/trust.
import {resolveMeshRelayOrigin,MESH_LIVE_ORIGIN} from "../mesh-pairing-relay/origin-gate.ts";
import {requireMeshRelayMembership} from "../mesh-pairing-relay/qa-membership.ts";
import {parseEnrollmentV2,verifyEnrollmentV2} from "./protocol.ts";
import type {ChallengeRow} from "./protocol.ts";
type Env={
 SUPABASE_URL:string;SUPABASE_ANON_KEY:string;SUPABASE_SERVICE_ROLE_KEY:string;
 KATOSYNC_MESH_RELAY_QA_MODE?:string;KATOSYNC_MESH_RELAY_QA_PROJECT_REF?:string;
 DENO_DEPLOYMENT_ID?:string;KATOSYNC_MESH_ENROLLMENT_V2_QA_STAGE:string;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEAD={"cache-control":"no-store","content-type":"application/json"};
const fail=(status:number,error:string)=>Response.json({error},{status,headers:HEAD});
async function readInput(req:Request,max:number):Promise<string>{
 const reader=req.body?.getReader();
 if(!reader)throw Error("EMPTY_REQUEST");
 const chunks:Uint8Array[]=[];
 let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.byteLength;
   if(size>max)throw Error("REQUEST_TOO_LARGE");
   chunks.push(value);
  }
  return new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(chunks.flatMap(x=>Array.from(x))));
 }finally{reader.releaseLock();}
}
async function bounded(response:Response,max:number):Promise<unknown>{
 const raw=await response.text();
 if(raw.length>max)throw Error("QA_RESPONSE_TOO_LARGE");
 return JSON.parse(raw);
}
export async function handleEnrollmentPreviewV2(
 req:Request,e:Env,request:typeof fetch=fetch,now=Date.now()
):Promise<Response>{
 if(req.method!=="POST")return fail(405,"METHOD_NOT_ALLOWED");
 const origin=resolveMeshRelayOrigin(e);
 if(e.KATOSYNC_MESH_ENROLLMENT_V2_QA_STAGE!=="verify-only"||
    e.KATOSYNC_MESH_RELAY_QA_MODE!=="isolated-preview-only"||
    !origin||origin===MESH_LIVE_ORIGIN||
    !e.SUPABASE_ANON_KEY||!e.SUPABASE_SERVICE_ROLE_KEY)
    return fail(503,"QA_PREVIEW_NOT_CONFIGURED");
 const bearer=req.headers.get("authorization")??"";
 if(!/^Bearer [A-Za-z0-9_.-]{30,8192}$/.test(bearer))return fail(401,"LOGIN_REQUIRED");
 if(!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return fail(400,"BAD_REQUEST");
 try{
  let raw:string;
  try{raw=await readInput(req,2048);}catch{return fail(400,"BAD_PROOF");}
  const proof=parseEnrollmentV2(JSON.parse(raw));
  if(!proof||proof.origin!==origin)return fail(400,"BAD_PROOF");
  const userReply=await request(origin+"/auth/v1/user",{
   method:"GET",headers:{authorization:bearer,apikey:e.SUPABASE_ANON_KEY},
   redirect:"error",signal:AbortSignal.timeout(8000)
  });
  if(!userReply.ok)return fail(401,"LOGIN_REQUIRED");
  const account=await bounded(userReply,2048) as {id?:unknown;is_anonymous?:unknown};
  if(!account||typeof account.id!=="string"||!UUID.test(account.id)||
     account.is_anonymous===true)return fail(401,"LOGIN_REQUIRED");
  const owner=account.id;
  const admin={apikey:e.SUPABASE_SERVICE_ROLE_KEY,
   Authorization:"Bearer "+e.SUPABASE_SERVICE_ROLE_KEY};
  const member=await requireMeshRelayMembership(owner,admin,request,origin);
  if(member!=="active")return fail(member==="not_member"?403:503,"MEMBERSHIP_REQUIRED");
  const url=new URL(origin+"/rest/v1/mesh_enrollment_challenges");
  url.searchParams.set("select","challenge_id,owner_user_id,signing_public_key,nonce,expires_at,consumed_at");
  url.searchParams.set("challenge_id","eq."+proof.challengeId);
  url.searchParams.set("owner_user_id","eq."+owner);
  url.searchParams.set("limit","2");
  const check=await request(url,{
   method:"GET",headers:{...admin,"Accept-Profile":"katosync"},
   redirect:"error",signal:AbortSignal.timeout(8000)
  });
  if(!check.ok)return fail(503,"QA_CHALLENGE_UNAVAILABLE");
  const rows=await bounded(check,2048);
  if(!Array.isArray(rows)||rows.length!==1)return fail(403,"QA_CHALLENGE_INVALID");
  if(!await verifyEnrollmentV2(proof,owner,origin,rows[0] as ChallengeRow,now))
   return fail(403,"QA_SIGNATURE_INVALID");
  const latest=await requireMeshRelayMembership(owner,admin,request,origin);
  if(latest!=="active")return fail(latest==="not_member"?403:503,"MEMBERSHIP_REQUIRED");
  return Response.json({
   result:"QA_ENROLLMENT_SIGNATURE_VERIFIED",verifyOnly:true,discovered:false,
   paired:false,transportReady:false,remoteJobsEnabled:false
  },{status:200,headers:HEAD});
 }catch{return fail(503,"QA_PREVIEW_UNAVAILABLE");}
}
