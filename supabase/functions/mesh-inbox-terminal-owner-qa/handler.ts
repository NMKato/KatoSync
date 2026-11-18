// KatoSync Stage4E | NEW non-deployed authenticated owner cancellation QA.
// No pairing, device trust, transport or remote execution rights.
import {evaluateMembership} from "../mesh-device-enrollment/membership-gate.ts";

export type Env={
 SUPABASE_URL:string; SUPABASE_ANON_KEY:string; SUPABASE_SERVICE_ROLE_KEY:string;
 KATOSYNC_INBOX_TERMINAL_OWNER_STAGE:string;
 KATOSYNC_INBOX_TERMINAL_OWNER_PROJECT_REF:string;
};
type Config={fetcher?:typeof fetch};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT=/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const QA=/^https:\/\/([a-z0-9]{20})\.supabase\.co$/;
const LIVE="xbnnlyyxiilklsygxcof";
function deny(status:number,error:string):Response{
 return Response.json({error},{status,headers:{"Cache-Control":"no-store"}});
}
function enabled(e:Env):boolean{
 const m=QA.exec(e.SUPABASE_URL);
 return !!m&&m[1]!==LIVE&&
  e.KATOSYNC_INBOX_TERMINAL_OWNER_STAGE==="qa-cancel-only"&&
  e.KATOSYNC_INBOX_TERMINAL_OWNER_PROJECT_REF===m[1]&&
  e.SUPABASE_ANON_KEY.length>=20&&
  e.SUPABASE_SERVICE_ROLE_KEY.length>=20&&
  e.SUPABASE_ANON_KEY!==e.SUPABASE_SERVICE_ROLE_KEY&&
  !e.SUPABASE_ANON_KEY.startsWith("sb_secret_")&&
  !e.SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_publishable_");
}
async function limited(response:Response,bytes:number):Promise<unknown>{
 if(!response.ok||response.type==="opaqueredirect")return null;
 const size=response.headers.get("content-length");
 if(size!==null&&(!/^\d{1,7}$/.test(size)||Number(size)>bytes))return null;
 if(!response.body)return null;
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let length=0;
 try{for(;;){
  const next=await reader.read();if(next.done)break;
  length+=next.value.byteLength;if(length>bytes)return null;
  chunks.push(next.value);
 }}finally{reader.releaseLock();}
 const data=new Uint8Array(length);let at=0;
 for(const x of chunks){data.set(x,at);at+=x.byteLength;}
 try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(data));}
 catch{return null;}
}
async function requestBody(req:Request):Promise<unknown>{
 const n=req.headers.get("content-length");
 if(n!==null&&(!/^\d{1,7}$/.test(n)||Number(n)>320))return null;
 return limited(new Response(req.body),320);
}
function exact(raw:unknown):raw is {action:string;requestId:string}{
 return raw!==null&&typeof raw==="object"&&!Array.isArray(raw)&&
  Object.keys(raw).length===2&&
  Object.keys(raw).every(k=>["action","requestId"].includes(k))&&
  (raw as Record<string,unknown>).action==="cancel"&&
  typeof (raw as Record<string,unknown>).requestId==="string"&&
  UUID.test((raw as {requestId:string}).requestId);
}
function serviceHeaders(e:Env){
 const h={apikey:e.SUPABASE_SERVICE_ROLE_KEY,"Accept-Profile":"katosync"};
 // New sb_secret_* keys are API keys, NOT JWTs. The platform gateway
 // authorizes them through apikey; legacy service-role JWTs still need Bearer.
 return e.SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_secret_")?h:
  {...h,Authorization:"Bearer "+e.SUPABASE_SERVICE_ROLE_KEY};
}
async function verifiedUser(e:Env,bearer:string,request:typeof fetch):Promise<string|null>{
 const r=await request(e.SUPABASE_URL+"/auth/v1/user",{
  method:"GET",redirect:"error",cache:"no-store",
  signal:AbortSignal.timeout(8000),
  headers:{apikey:e.SUPABASE_ANON_KEY,Authorization:bearer}
 });
 const body=await limited(r,16384);
 if(!body||typeof body!=="object"||Array.isArray(body))return null;
 const u=body as Record<string,unknown>;
 return typeof u.id==="string"&&UUID.test(u.id)&&
  u.role==="authenticated"&&u.is_anonymous!==true?u.id:null;
}
async function member(owner:string,e:Env,request:typeof fetch){
 const url=new URL(e.SUPABASE_URL+"/rest/v1/account_memberships");
 url.searchParams.set("select","user_id,access_state,authorized_at,revoked_at");
 url.searchParams.set("user_id","eq."+owner);
 url.searchParams.set("limit","2");
 const response=await request(url.toString(),{
  method:"GET",redirect:"error",cache:"no-store",
  headers:serviceHeaders(e),signal:AbortSignal.timeout(8000)
 });
 return evaluateMembership(await limited(response,2048),owner);
}
/** Owner is authenticated by KATOOS Auth, not accepted as an input parameter.
 * The SQL RPC requires its own owner/request-locked terminal-only contract. */
export async function handleInboxTerminalOwnerQA(
 req:Request,e:Env,cfg:Config={}
):Promise<Response>{
 if(req.method!=="POST")return deny(405,"METHOD_NOT_ALLOWED");
 if(!enabled(e))return deny(503,"INBOX_TERMINAL_QA_DISABLED");
 if(req.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")
  return deny(415,"JSON_REQUIRED");
 const bearer=req.headers.get("authorization")??"";
 if(bearer.length>8192||bearer.length<30||!JWT.test(bearer)||
    bearer.slice(7)===e.SUPABASE_SERVICE_ROLE_KEY||
    bearer.includes("sb_secret_")||bearer.includes("sb_publishable_"))
  return deny(401,"LOGIN_REQUIRED");
 const body=await requestBody(req);
 if(!exact(body))return deny(400,"INVALID_TERMINAL_REQUEST");
 const request=cfg.fetcher??fetch;
 try{
  const owner=await verifiedUser(e,bearer,request);
  if(!owner)return deny(401,"LOGIN_REQUIRED");
  // A valid token alone is not permission to use KatoSync.
  for(let i=0;i<2;i++){
   const membership=await member(owner,e,request);
   if(membership==="not_member")return deny(403,"KATOSYNC_MEMBERSHIP_REQUIRED");
   if(membership!=="active")return deny(503,"KATOSYNC_MEMBERSHIP_UNAVAILABLE");
  }
  // ONLY disposable QA overlay exposes this RPC. No client-supplied owner,
  // SQL state, role, subscription or optional trust flag reaches it.
  const response=await request(
   e.SUPABASE_URL+"/rest/v1/rpc/mesh_inbox_terminal_close_qa",{
    method:"POST",redirect:"error",cache:"no-store",
    signal:AbortSignal.timeout(8000),
    headers:{...serviceHeaders(e),"Content-Profile":"katosync",
     "Content-Type":"application/json",Accept:"application/json"},
    body:JSON.stringify({p_owner:owner,p_request:body.requestId,
     p_terminal:"cancelled"})
   });
  const result=await limited(response,128);
  if(result==="closed"||result==="already_closed")
   return Response.json({requestId:body.requestId,state:"cancelled",
    alreadyClosed:result==="already_closed",paired:false,
    transportReady:false,remoteJobsEnabled:false},
    {status:200,headers:{"Cache-Control":"no-store"}});
  if(result==="not_found")return deny(404,"INVITE_NOT_FOUND");
  if(result==="not_pending"||result==="wrong_deadline")
   return deny(409,"INVITE_NOT_CANCELLABLE");
  return deny(503,"INBOX_TERMINAL_UNAVAILABLE");
 }catch{return deny(503,"INBOX_TERMINAL_UNAVAILABLE");}
}
