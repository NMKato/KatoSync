// NMKato Solutions — KatoSync 4.0 / QA-ONLY Cloud Mesh entitlement admission.
// This is a non-atomic, fail-closed outer boundary around SHA-pinned inbox and
// relay handlers. It does NOT authorize pairing, TLS, remote jobs, or billing.
// Production deployment is HOLD until the database and all writers enforce
// entitlements atomically, and independent human review completes.
import {parseMeshDeviceAllowance} from "../mesh-device-enrollment/device-entitlement.ts";
import {requireMeshRelayMembership} from "../mesh-pairing-relay/qa-membership.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIVE="https://xbnnlyyxiilklsygxcof.supabase.co";
const QA_ORIGIN=/^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const MAX_POLICY=1024;
type Env={
 origin:string;anonKey:string;serviceKey:string;
 stage:string;
};
type Verdict="active"|"free"|"unavailable"|"not_member";
type Handler=(guardedRequest:typeof fetch)=>Promise<Response>;
const denied=(status:number,error:string)=>
 Response.json({error},{status,headers:{"content-type":"application/json","cache-control":"no-store"}});

function validEnv(e:Env):boolean{
 return e.stage==="qa-entitlement-boundary"&&
  QA_ORIGIN.test(e.origin)&&
  e.anonKey.length>=20&&e.serviceKey.length>=20&&
  e.anonKey!==e.serviceKey;
}
function serviceHeaders(e:Env){
 return {apikey:e.serviceKey,Authorization:"Bearer "+e.serviceKey,
  "Accept-Profile":"katosync"};
}
// Every service-role request in this QA boundary is tenant-locked and may
// never follow an HTTP redirect (including inside historical membership code).
function sameOriginRequest(e:Env,request:typeof fetch):typeof fetch{
 return async(input,init)=>{
  let url:URL;
  try{url=new URL(input instanceof Request?input.url:String(input));}
  catch{return denied(503,"MESH_UPSTREAM_ORIGIN_INVALID");}
  if(url.origin!==e.origin||url.username||url.password||url.hash)
   return denied(503,"MESH_UPSTREAM_ORIGIN_INVALID");
  return request(input,{...init,redirect:"error",cache:"no-store"});
 };
}
async function currentEntitlement(
 owner:string,e:Env,request:typeof fetch,nowMs:number
):Promise<Verdict>{
 if(!UUID.test(owner)||!Number.isSafeInteger(nowMs))return "unavailable";
 try{
  const member=await requireMeshRelayMembership(owner,serviceHeaders(e),
   sameOriginRequest(e,request),e.origin);
  if(member==="not_member")return "not_member";
  if(member!=="active")return "unavailable";
  // Never query live policy for isolated-preview identities.
  const url=new URL(e.origin+"/rest/v1/mesh_owner_policy");
  url.searchParams.set("select","allowed_devices,policy_expires_at");
  url.searchParams.set("owner_user_id","eq."+owner);
  url.searchParams.set("limit","2");
  const result=await request(url.toString(),{
    method:"GET",redirect:"error",cache:"no-store",
    headers:serviceHeaders(e),signal:AbortSignal.timeout(8000)
  });
  if(!result.ok||Number(result.headers.get("content-length")??0)>MAX_POLICY)
   return "unavailable";
  const body=await result.text();
  if(body.length>MAX_POLICY)return "unavailable";
  const policy=parseMeshDeviceAllowance(JSON.parse(body),nowMs);
  return policy.kind==="assigned"?"active":policy.kind==="free"?"free":"unavailable";
 }catch{return "unavailable";}
}
function denyVerdict(v:Verdict):Response{
 return v==="free"?denied(403,"MESH_PRO_REQUIRED"):
  v==="not_member"?denied(403,"KATOSYNC_MEMBERSHIP_REQUIRED"):
  denied(503,"MESH_ENTITLEMENT_UNAVAILABLE");
}
async function verifiedOwner(
 req:Request,e:Env,request:typeof fetch
):Promise<string|null>{
 const bearer=req.headers.get("authorization")??"";
 if(!/^Bearer [A-Za-z0-9_.-]{30,8192}$/.test(bearer)||
   bearer.slice(7)===e.serviceKey)return null;
 try{
  const auth=await request(e.origin+"/auth/v1/user",{
   method:"GET",redirect:"error",cache:"no-store",
   headers:{Authorization:bearer,apikey:e.anonKey},signal:AbortSignal.timeout(8000)
  });
  if(!auth.ok||Number(auth.headers.get("content-length")??0)>16384)return null;
  const text=await auth.text();
  if(text.length>16384)return null;
  const who=JSON.parse(text) as unknown;
  if(!who||typeof who!=="object"||Array.isArray(who))return null;
  const u=who as {id?:unknown;is_anonymous?:unknown};
  return typeof u.id==="string"&&UUID.test(u.id)&&u.is_anonymous!==true?u.id:null;
 }catch{return null;}
}
function meshResource(input:RequestInfo|URL,e:Env):boolean|null{
 let url:URL;
 try{url=new URL(input instanceof Request?input.url:String(input));}
 catch{return null;}
 if(url.origin!==e.origin||url.username||url.password||url.hash)return null;
 if(url.pathname==="/auth/v1/user"||url.pathname==="/rest/v1/account_memberships"||
    url.pathname==="/rest/v1/mesh_owner_policy")return false;
 // All Mesh DB reads/writes that could be paired with cryptographic proof or
 // mutate message state must observe current entitlement. No path variants.
 return url.pathname.startsWith("/rest/v1/mesh_");
}
/** Outer admission + final response check and a fresh recheck before each
 * sensitive Mesh PostgREST operation.  NOT an atomic SQL authorization gate. */
export async function withFreshMeshEntitlement(
 req:Request,e:Env,request:typeof fetch,handler:Handler
):Promise<Response>{
 if(req.method!=="POST")return denied(405,"METHOD_NOT_ALLOWED");
 if(!validEnv(e))return denied(503,"MESH_BOUNDARY_DISABLED");
 const owner=await verifiedOwner(req,e,request);
 if(!owner)return denied(401,"LOGIN_REQUIRED");
 const initial=await currentEntitlement(owner,e,request,Date.now());
 if(initial!=="active")return denyVerdict(initial);
 let stopped:Verdict|null=null;
 const guardedRequest:typeof fetch=async(input,init)=>{
  const target=meshResource(input,e);
  if(target===null){
   stopped="unavailable";
   return denied(503,"MESH_UPSTREAM_ORIGIN_INVALID");
  }
  if(target){
   const recent=await currentEntitlement(owner,e,request,Date.now());
   if(recent!=="active"){
    stopped=recent;
    return denyVerdict(recent);
   }
  }
  // Never follow an upstream redirect with a privileged service-role bearer:
  // historical signed handlers did not uniformly set redirect:"error".
  return sameOriginRequest(e,request)(input,init);
 };
 try{
  const response=await handler(guardedRequest);
  if(stopped!==null)return denyVerdict(stopped);
  if(!response.ok)return response;
  const final=await currentEntitlement(owner,e,request,Date.now());
  if(final!=="active")return denyVerdict(final);
  return response;
 }catch{return denied(503,"MESH_BOUNDARY_UNAVAILABLE");}
}
// Test/use fixtures can assert no other Supabase origin is admitted.
export const MESH_ENTITLEMENT_QA_ORIGIN=LIVE;
