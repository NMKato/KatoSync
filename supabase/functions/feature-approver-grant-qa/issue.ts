// NMKato Solutions – read-only, server-signed QA approver grant endpoint.
// Never trusts client role, owner-key, UID or issuer key material.
// No self-service provisioning; server-only active rows + active membership.
// Intentionally no CORS, no mutating endpoint and no public issuer secret.
import {
 allowedProject,allowedUuid,boundKeyId,bytesToUrlBase64,canonicalSupabase,exactArrayBuffer,
 leaseMs,protocol,signingBytes,sqlUtc,
 type Grant,
} from "./contract.ts";

export type Env = {
 SUPABASE_URL:string;
 SUPABASE_ANON_KEY:string;
 SUPABASE_SERVICE_ROLE_KEY:string;
 KATOSYNC_FEATURE_APPROVAL_STAGE:string;
 KATOSYNC_APPROVER_ISSUER_PKCS8_B64:string;
};
type Transport = typeof fetch;
type Options = {transport?:Transport;now?:()=>number};
const fail=(code:number,error:string)=>new Response(JSON.stringify({error}),{
 status:code,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}
});
const ok=(data:Grant)=>new Response(JSON.stringify(data),{
 status:200,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}
});
async function readBounded(
 response:Response, max:number
):Promise<unknown>{
 if(!response.ok)return null;
 if(Number(response.headers.get("content-length")??0)>max)return null;
 const reader=response.body?.getReader();
 if(!reader)return null;
 let count=0;
 const segments:Uint8Array[]=[];
 try{
  for(;;){
   const part=await reader.read();
   if(part.done)break;
   count+=part.value.byteLength;
   if(count>max)return null;
   segments.push(part.value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(count);
 let offset=0;
 for(const segment of segments){bytes.set(segment,offset);offset+=segment.length;}
 try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
 catch{return null;}
}
function isRecord(v:unknown):v is Record<string,unknown>{
 return v!==null&&typeof v==="object"&&!Array.isArray(v);
}
function exactRow(v:unknown):Record<string,unknown>|null{
 return Array.isArray(v)&&v.length===1&&isRecord(v[0])?v[0]:null;
}
function validIso(v:unknown,nowMs:number):boolean{
 return typeof v==="string"&&sqlUtc(v,nowMs);
}
function urlFor(table:string,filters:Record<string,string>):string{
 const u=new URL(canonicalSupabase+"/rest/v1/"+table);
 for(const [k,v] of Object.entries(filters))u.searchParams.set(k,v);
 return u.toString();
}
async function readTable(
 transport:Transport,env:Env,table:string,
 filters:Record<string,string>
):Promise<unknown>{
 const result=await transport(urlFor(table,filters),{
  method:"GET",redirect:"error",cache:"no-store",
  signal:AbortSignal.timeout(7000),
  headers:{
   "apikey":env.SUPABASE_SERVICE_ROLE_KEY,
   "Authorization":"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,
   "Accept-Profile":"katosync",
   "Accept":"application/json"
  }
 });
 return readBounded(result,4096);
}
function validEnv(env:Env):boolean{
 return env.KATOSYNC_FEATURE_APPROVAL_STAGE==="qa"
  &&env.SUPABASE_URL===canonicalSupabase
  &&env.SUPABASE_ANON_KEY.length>10
  &&env.SUPABASE_SERVICE_ROLE_KEY.length>10
  &&env.SUPABASE_ANON_KEY!==env.SUPABASE_SERVICE_ROLE_KEY
  &&env.KATOSYNC_APPROVER_ISSUER_PKCS8_B64.length>20;
}
function secretBytes(value:string):Uint8Array{
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(value)||value.length>4096)
  throw new Error("APPROVER_ISSUER_SECRET_INVALID");
 const raw=atob(value);
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
export async function issueFeatureApprovalGrant(
 req:Request,env:Env,options:Options={}
):Promise<Response>{
 if(req.method!=="GET")return fail(405,"APPROVER_METHOD_NOT_ALLOWED");
 // Authentication and authority config are independent. No grant ever issued
 // unless explicit QA opt-in plus trusted issuer secret already exist.
 if(!validEnv(env))return fail(503,"APPROVER_NOT_CONFIGURED");
 const url=new URL(req.url);
 const ids=url.searchParams.getAll("projectId");
 if(ids.length!==1||!allowedProject.test(ids[0])||
    [...url.searchParams.keys()].some(k=>k!=="projectId"))
  return fail(400,"APPROVER_PROJECT_INVALID");
 const projectId=ids[0];
 const bearer=req.headers.get("authorization")??"";
 if(!/^Bearer [^\s]{20,8192}$/.test(bearer) ||
    bearer.slice(7)===env.SUPABASE_SERVICE_ROLE_KEY)
  return fail(401,"APPROVER_LOGIN_REQUIRED");
 const transport=options.transport??fetch;
 const nowMs=(options.now??Date.now)();
 try{
  const issuerUser=await transport(canonicalSupabase+"/auth/v1/user",{
   method:"GET",redirect:"error",cache:"no-store",
   signal:AbortSignal.timeout(7000),
   headers:{
    "apikey":env.SUPABASE_ANON_KEY,
    "Authorization":bearer,
    "Accept":"application/json"
   }
  });
  const verified=await readBounded(issuerUser,16384);
  if(!isRecord(verified)||typeof verified.id!=="string"||
     !allowedUuid.test(verified.id))
   return fail(401,"APPROVER_LOGIN_REQUIRED");
  const uid=verified.id;
  const membership=exactRow(await readTable(transport,env,"account_memberships",{
   select:"user_id,access_state,authorized_at,revoked_at",
   user_id:"eq."+uid,limit:"2"
  }));
  if(!membership||membership.user_id!==uid ||
     membership.access_state!=="active" ||
     !validIso(membership.authorized_at,nowMs) ||
     membership.revoked_at!==null)
   return fail(403,"APPROVER_NOT_AUTHORIZED");
  const project=exactRow(await readTable(transport,env,"feature_approval_projects",{
   select:"project_id,state,approved_at,revoked_at",
   project_id:"eq."+projectId,limit:"2"
  }));
  if(!project||project.project_id!==projectId ||
     project.state!=="active"||
     !validIso(project.approved_at,nowMs)||
     project.revoked_at!==null)
   return fail(403,"APPROVER_NOT_AUTHORIZED");
  const grant=exactRow(await readTable(transport,env,"feature_approver_grants",{
   select:"project_id,subject_uid,role,permission,owner_key_id,owner_signing_public_key,grant_revision,state,authorized_at,revoked_at",
   project_id:"eq."+projectId,subject_uid:"eq."+uid,state:"eq.active",limit:"2"
  }));
  let validatedOwnerKeyId:string|null=null;
  if(grant&&typeof grant.owner_signing_public_key==="string"){
   try{validatedOwnerKeyId=await boundKeyId(grant.owner_signing_public_key);}
   catch{return fail(403,"APPROVER_NOT_AUTHORIZED");}
  }
  if(!grant||grant.project_id!==projectId||grant.subject_uid!==uid||
     !["project_owner","feature_approver"].includes(String(grant.role))||
     grant.permission!=="approve_feature_acceptance"||
     grant.state!=="active"||
     grant.revoked_at!==null||
     !validIso(grant.authorized_at,nowMs)||
     !Number.isSafeInteger(grant.grant_revision)||
     (grant.grant_revision as number)<=0||
     typeof grant.owner_signing_public_key!=="string"||
     typeof grant.owner_key_id!=="string"||
     grant.owner_key_id!==validatedOwnerKeyId)
    return fail(403,"APPROVER_NOT_AUTHORIZED");
  const lease:Grant={
   protocol,subjectUid:uid,projectId,
   role:String(grant.role),permission:"approve_feature_acceptance",
   keyId:grant.owner_key_id,signingPublicKey:grant.owner_signing_public_key,
   grantRevision:grant.grant_revision as number,state:"active",
   issuedAtMs:nowMs,expiresAtMs:nowMs+leaseMs,
   revokedAtMs:null,issuerSignature:""
  };
  const issuer=await crypto.subtle.importKey(
   "pkcs8",exactArrayBuffer(secretBytes(env.KATOSYNC_APPROVER_ISSUER_PKCS8_B64)),
   "Ed25519",false,["sign"]
  );
  const signature=await crypto.subtle.sign("Ed25519",issuer,exactArrayBuffer(signingBytes(lease)));
  lease.issuerSignature=bytesToUrlBase64(new Uint8Array(signature));
  return ok(lease);
 }catch{
  // Never log tokens, query data or crypto key material.
  return fail(503,"APPROVER_UNAVAILABLE");
 }
}
