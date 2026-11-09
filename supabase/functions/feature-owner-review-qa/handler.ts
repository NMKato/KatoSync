// NMKato Solutions – Stage-only independent reviewer signature, no self-grants.
// Privileged SQL is allowed only AFTER verifying the actual reviewer KATOOS
// login and a signature from their separately admin-enrolled Ed25519 key.
// This Edge route has NO grant activation, reviewer enrollment or CORS.
import {REVIEW_PROTOCOL40,verifyIndependentOwnerReview40,
 type IndependentOwnerReview40} from "../../../src/lib/independentOwnerReview40.ts";
import {canonicalSupabase,allowedUuid} from "../feature-approver-grant-qa/contract.ts";

export type Env={
 SUPABASE_URL:string;SUPABASE_ANON_KEY:string;
 SUPABASE_SERVICE_ROLE_KEY:string;KATOSYNC_FEATURE_APPROVAL_STAGE:string;
};
type Config={fetcher?:typeof fetch;now?:()=>number};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY=/^ed25519-sha256:[0-9a-f]{64}$/;
function reply(status:number,data:Record<string,unknown>):Response{
 return new Response(JSON.stringify(data),{
  status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}
 });
}
const fail=(status:number,error:string)=>reply(status,{error});
function row(data:unknown):Record<string,unknown>|null{
 return Array.isArray(data)&&data.length===1&&data[0]!==null&&
 typeof data[0]==="object"&&!Array.isArray(data[0])?data[0]:null;
}
function exact(data:unknown,fields:string[]):data is Record<string,unknown>{
 return data!==null&&typeof data==="object"&&!Array.isArray(data)&&
 Object.keys(data).length===fields.length&&Object.keys(data).every(k=>fields.includes(k));
}
async function smallJson(response:Response,limit:number):Promise<unknown>{
 if(!response.ok)return null;
 if(Number(response.headers.get("content-length")??0)>limit)return null;
 const reader=response.body?.getReader();if(!reader)return null;
 let size=0;const parts:Uint8Array[]=[];
 try{for(;;){
  const next=await reader.read();if(next.done)break;
  size+=next.value.byteLength;if(size>limit)return null;
  parts.push(next.value);
 }}finally{reader.releaseLock();}
 const buffer=new Uint8Array(size);let offset=0;
 for(const part of parts){buffer.set(part,offset);offset+=part.length;}
 try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(buffer));}
 catch{return null;}
}
async function requestJson(req:Request,limit:number):Promise<unknown>{
 if(Number(req.headers.get("content-length")??0)>limit)return null;
 const reader=req.body?.getReader();if(!reader)return null;
 let size=0;const parts:Uint8Array[]=[];
 try{for(;;){
  const next=await reader.read();if(next.done)break;
  size+=next.value.byteLength;if(size>limit)return null;parts.push(next.value);
 }}finally{reader.releaseLock();}
 const buffer=new Uint8Array(size);let offset=0;
 for(const part of parts){buffer.set(part,offset);offset+=part.length;}
 try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(buffer));}
 catch{return null;}
}
async function read(
 fetcher:typeof fetch,env:Env,table:string,query:Record<string,string>
):Promise<unknown>{
 const url=new URL(canonicalSupabase+"/rest/v1/"+table);
 for(const [key,value] of Object.entries(query))url.searchParams.set(key,value);
 const res=await fetcher(url.toString(),{
  method:"GET",redirect:"error",cache:"no-store",
  signal:AbortSignal.timeout(8000),
  headers:{
   apikey:env.SUPABASE_SERVICE_ROLE_KEY,
   Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,
   "Accept-Profile":"katosync",Accept:"application/json"
  }
 });
 return smallJson(res,4096);
}
async function submit(
 fetcher:typeof fetch,env:Env,args:Record<string,unknown>
):Promise<unknown>{
 const res=await fetcher(canonicalSupabase+"/rest/v1/rpc/feature_owner_review_submit",{
  method:"POST",redirect:"error",cache:"no-store",
  signal:AbortSignal.timeout(8000),
  headers:{
   apikey:env.SUPABASE_SERVICE_ROLE_KEY,
   Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,
   "Content-Profile":"katosync","Content-Type":"application/json",
   Accept:"application/json"
  },
  body:JSON.stringify(args)
 });
 return smallJson(res,4096);
}
function active(v:Record<string,unknown>|null,uid:string,now:number):boolean{
 return !!v&&v.state==="active"&&v.revoked_at===null&&
 v.reviewer_uid===uid&&
 typeof v.authorized_at==="string"&&Date.parse(v.authorized_at)<=now&&
 Number.isFinite(Date.parse(v.authorized_at));
}
function activeMember(v:Record<string,unknown>|null,uid:string,now:number):boolean{
 return !!v&&v.user_id===uid&&v.access_state==="active"&&
 v.revoked_at===null&&typeof v.authorized_at==="string"&&
 Number.isFinite(Date.parse(v.authorized_at))&&Date.parse(v.authorized_at)<=now;
}
function validReason(raw:unknown):raw is string{
 return typeof raw==="string"&&raw===raw.trim()&&
 raw.length>=12&&raw.length<=1000&&!/[\x00-\x1f\x7f]/.test(raw);
}
export async function handleReviewerReview(
 req:Request,env:Env,cfg:Config={}
):Promise<Response>{
 if(req.method!=="POST")return fail(405,"REVIEW_METHOD_NOT_ALLOWED");
 if(env.KATOSYNC_FEATURE_APPROVAL_STAGE!=="qa"||
  env.SUPABASE_URL!==canonicalSupabase||
  env.SUPABASE_ANON_KEY.length<20||env.SUPABASE_SERVICE_ROLE_KEY.length<20||
  env.SUPABASE_ANON_KEY===env.SUPABASE_SERVICE_ROLE_KEY)
  return fail(503,"REVIEW_NOT_CONFIGURED");
 const bearer=req.headers.get("authorization")??"";
 if(!/^Bearer [^\s]{20,8192}$/.test(bearer)||
  bearer.slice(7)===env.SUPABASE_SERVICE_ROLE_KEY)
  return fail(401,"REVIEW_LOGIN_REQUIRED");
 const body=await requestJson(req,4096);
 const prepare=exact(body,["action","grantId","challengeId","decision","reason"])&&
  body.action==="prepare";
 const attest=exact(body,["action","grantId","challengeId","decision","reason","signedAtMs","signature"])&&
  body.action==="attest";
 if(!prepare&&!attest)return fail(400,"REVIEW_REQUEST_INVALID");
 const b=body as Record<string,unknown>;
 if(typeof b.grantId!=="string"||!UUID.test(b.grantId)||
    typeof b.challengeId!=="string"||!UUID.test(b.challengeId)||
    !["approved","rejected"].includes(String(b.decision))||!validReason(b.reason))
  return fail(400,"REVIEW_REQUEST_INVALID");
 const now=(cfg.now??Date.now)(),fetcher=cfg.fetcher??fetch;
 try{
  const who=await fetcher(canonicalSupabase+"/auth/v1/user",{
   method:"GET",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000),
   headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:bearer}
  });
  const user=await smallJson(who,16384);
  const uid=user&&typeof user==="object"&&!Array.isArray(user)?(user as Record<string,unknown>).id:null;
  if(typeof uid!=="string"||!allowedUuid.test(uid))
   return fail(401,"REVIEW_LOGIN_REQUIRED");
  const membership=row(await read(fetcher,env,"account_memberships",{
   select:"user_id,access_state,authorized_at,revoked_at",user_id:"eq."+uid,limit:"2"
  }));
  if(!activeMember(membership,uid,now))return fail(403,"REVIEW_NOT_AUTHORIZED");
  const reviewer=row(await read(fetcher,env,"feature_approval_reviewers",{
   select:"reviewer_uid,state,authorized_at,revoked_at",reviewer_uid:"eq."+uid,limit:"2"
  }));
  if(!active(reviewer,uid,now))return fail(403,"REVIEW_NOT_AUTHORIZED");
  const key=row(await read(fetcher,env,"feature_reviewer_signing_keys",{
   select:"reviewer_uid,reviewer_key_id,public_key,key_revision,state,approved_at,revoked_at",
   reviewer_uid:"eq."+uid,state:"eq.active",limit:"2"
  }));
  if(!key||key.reviewer_uid!==uid||key.state!=="active"||
     key.revoked_at!==null||typeof key.approved_at!=="string"||
     !Number.isFinite(Date.parse(key.approved_at))||Date.parse(key.approved_at)>now||
     typeof key.reviewer_key_id!=="string"||!KEY.test(key.reviewer_key_id)||
     typeof key.public_key!=="string"||
     !Number.isSafeInteger(key.key_revision)||(key.key_revision as number)<1)
   return fail(403,"REVIEW_KEY_NOT_AUTHORIZED");
  const grant=row(await read(fetcher,env,"feature_approver_grants",{
   select:"grant_id,project_id,subject_uid,owner_key_id,grant_revision,state,revoked_at",
   grant_id:"eq."+b.grantId,limit:"2"
  }));
  if(!grant||grant.grant_id!==b.grantId||grant.state!=="pending"||
     grant.revoked_at!==null||typeof grant.project_id!=="string"||
     typeof grant.subject_uid!=="string"||!UUID.test(grant.subject_uid)||
     grant.subject_uid===uid||typeof grant.owner_key_id!=="string"||
     !KEY.test(grant.owner_key_id)||!Number.isSafeInteger(grant.grant_revision)||
     (grant.grant_revision as number)<1)
   return fail(403,"REVIEW_NOT_AUTHORIZED");
  const ownerMembership=row(await read(fetcher,env,"account_memberships",{
   select:"user_id,access_state,authorized_at,revoked_at",
   user_id:"eq."+grant.subject_uid,limit:"2"
  }));
  if(!activeMember(ownerMembership,grant.subject_uid as string,now))
   return fail(403,"REVIEW_OWNER_INACTIVE");
  const project=row(await read(fetcher,env,"feature_approval_projects",{
   select:"project_id,state,approved_at,revoked_at",
   project_id:"eq."+grant.project_id,limit:"2"
  }));
  if(!project||project.project_id!==grant.project_id||project.state!=="active"||
     project.revoked_at!==null||typeof project.approved_at!=="string"||
     !Number.isFinite(Date.parse(project.approved_at))||
     Date.parse(project.approved_at)>now)
   return fail(403,"REVIEW_NOT_AUTHORIZED");
  const challenge=row(await read(fetcher,env,"feature_owner_challenges",{
   select:"challenge_id,grant_id,project_id,subject_uid,consumed_at,canceled_at,proof_key_id",
   challenge_id:"eq."+b.challengeId,limit:"2"
  }));
  const consumed=challenge?Date.parse(String(challenge.consumed_at)):NaN;
  if(!challenge||challenge.challenge_id!==b.challengeId||
    challenge.grant_id!==grant.grant_id||
    challenge.project_id!==grant.project_id||
    challenge.subject_uid!==grant.subject_uid||
    challenge.canceled_at!==null||
    challenge.proof_key_id!==grant.owner_key_id||
    !Number.isFinite(consumed)||consumed>now||
    now-consumed>24*3600*1000)
   return fail(403,"REVIEW_PROOF_NOT_VERIFIED");
  const signedAtMs=prepare?now:b.signedAtMs;
  if(!Number.isSafeInteger(signedAtMs)||
     (signedAtMs as number)<consumed)return fail(400,"REVIEW_TIME_INVALID");
  const review:IndependentOwnerReview40={
   protocol:REVIEW_PROTOCOL40,grantId:grant.grant_id as string,
   challengeId:challenge.challenge_id as string,
   projectId:grant.project_id as string,subjectUid:grant.subject_uid as string,
   ownerKeyId:grant.owner_key_id as string,grantRevision:grant.grant_revision as number,
   reviewerUid:uid,reviewerKeyId:key.reviewer_key_id as string,
   reviewerKeyRevision:key.key_revision as number,
   reviewerPublicKey:key.public_key as string,
   decision:b.decision as "approved"|"rejected",reason:b.reason as string,
   signedAtMs:signedAtMs as number
  };
  if(prepare)return reply(200,{
   review,signingProtocol:REVIEW_PROTOCOL40,
   state:"awaiting_reviewers_ed25519_signature",grantsRights:false
  });
  if(typeof b.signature!=="string"||!(await verifyIndependentOwnerReview40(
    review,b.signature,uid,key.reviewer_key_id as string,now)))
   return fail(403,"REVIEW_SIGNATURE_INVALID");
  const decisionId=await submit(fetcher,env,{
   p_grant_id:review.grantId,p_challenge_id:review.challengeId,
   p_reviewer_uid:uid,p_decision:review.decision,p_reason:review.reason,
   p_key_id:review.reviewerKeyId,p_signature:b.signature,p_signed_at_ms:review.signedAtMs
  });
  if(typeof decisionId!=="string"||!UUID.test(decisionId))
   return fail(409,"REVIEW_CONFLICT_OR_REVOKED");
  return reply(200,{
   decisionId,state:"review_signed_pending_separate_activation",
   grantsRights:false
  });
 }catch{
  // Do not leak service-role credentials, JWTs, person IDs or signed payloads.
  return fail(503,"REVIEW_UNAVAILABLE");
 }
}
