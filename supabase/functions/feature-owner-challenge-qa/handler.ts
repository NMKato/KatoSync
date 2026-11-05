// NMKato Solutions – one-time project owner key possession QA endpoint.
// This service NEVER creates projects, grants, reviewers or admin decisions.
// The only user-side effect is a nonce and its atomic consumption after
// an independently verified Ed25519 signature by the pre-provisioned key.
import {verifyOwnerKeyPossession40, type OwnerKeyPossession40} from
  "../../../src/lib/featureOwnerKeyProof40.ts";
import {
  canonicalSupabase,allowedProject,allowedUuid,
} from "../feature-approver-grant-qa/contract.ts";

type Transport=typeof fetch;
export type ChallengeEnv={
 SUPABASE_URL:string;
 SUPABASE_ANON_KEY:string;
 SUPABASE_SERVICE_ROLE_KEY:string;
 KATOSYNC_FEATURE_APPROVAL_STAGE:string;
};
type Config={transport?:Transport;now?:()=>number};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function response(code:number,body:Record<string,unknown>):Response{
 return new Response(JSON.stringify(body),{
  status:code,
  headers:{"Content-Type":"application/json","Cache-Control":"no-store"}
 });
}
const fail=(code:number,error:string)=>response(code,{error});
function exactKeys(o:unknown,keys:readonly string[]):o is Record<string,unknown>{
 return o!==null&&typeof o==="object"&&!Array.isArray(o)&&
 Object.keys(o).length===keys.length&&Object.keys(o).every(k=>keys.includes(k));
}
async function boundedJson(res:Response,max:number):Promise<unknown>{
 if(!res.ok)return null;
 const claimed=Number(res.headers.get("content-length")??"0");
 if(claimed>max)return null;
 const reader=res.body?.getReader();
 if(!reader)return null;
 let n=0;const parts:Uint8Array[]=[];
 try{for(;;){
  const p=await reader.read();if(p.done)break;
  n+=p.value.byteLength;
  if(n>max)return null;
  parts.push(p.value);
 }}finally{reader.releaseLock();}
 const bytes=new Uint8Array(n);let index=0;
 for(const p of parts){bytes.set(p,index);index+=p.byteLength;}
 try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
 catch{return null;}
}
async function boundedRequest(req:Request,max:number):Promise<unknown>{
 if(Number(req.headers.get("content-length")??"0")>max)return null;
 const reader=req.body?.getReader();if(!reader)return null;
 let n=0;const parts:Uint8Array[]=[];
 try{for(;;){
  const p=await reader.read();if(p.done)break;
  n+=p.value.byteLength;
  if(n>max)return null;
  parts.push(p.value);
 }}finally{reader.releaseLock();}
 const bytes=new Uint8Array(n);let offset=0;
 for(const p of parts){bytes.set(p,offset);offset+=p.byteLength;}
 try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
 catch{return null;}
}
function row(v:unknown):Record<string,unknown>|null{
 return Array.isArray(v)&&v.length===1&&
 v[0]!==null&&typeof v[0]==="object"&&!Array.isArray(v[0])
 ?v[0]:null;
}
async function serviceApi(
 fetcher:Transport,env:ChallengeEnv,path:string,body:Record<string,unknown>,
):Promise<unknown>{
 const result=await fetcher(canonicalSupabase+"/rest/v1/rpc/"+path,{
  method:"POST",redirect:"error",cache:"no-store",
  signal:AbortSignal.timeout(8000),
  headers:{
   "apikey":env.SUPABASE_SERVICE_ROLE_KEY,
   "Authorization":"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,
   "Content-Profile":"katosync",
   "Content-Type":"application/json","Accept":"application/json"
  },
  body:JSON.stringify(body)
 });
 return boundedJson(result,4096);
}
async function readTable(
 fetcher:Transport,env:ChallengeEnv,table:string,filter:Record<string,string>
):Promise<unknown>{
 const url=new URL(canonicalSupabase+"/rest/v1/"+table);
 for(const [key,val] of Object.entries(filter))url.searchParams.set(key,val);
 const result=await fetcher(url.toString(),{
  method:"GET",redirect:"error",cache:"no-store",
  signal:AbortSignal.timeout(8000),
  headers:{
   "apikey":env.SUPABASE_SERVICE_ROLE_KEY,
   "Authorization":"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,
   "Accept-Profile":"katosync","Accept":"application/json"
  }
 });
 return boundedJson(result,4096);
}
function memberIsActive(r:Record<string,unknown>|null,uid:string,nowMs:number):boolean{
 return !!r&&r.user_id===uid&&r.access_state==="active"&&
 r.revoked_at===null&&typeof r.authorized_at==="string"&&
 Number.isFinite(Date.parse(r.authorized_at))&&
 Date.parse(r.authorized_at)<=nowMs;
}
function parseTimestamp(raw:unknown):number{
 return typeof raw==="string"?Date.parse(raw):NaN;
}
export async function handleOwnerChallenge(
 req:Request,env:ChallengeEnv,cfg:Config={}
):Promise<Response>{
 if(req.method!=="POST")return fail(405,"CHALLENGE_METHOD_NOT_ALLOWED");
 if(env.KATOSYNC_FEATURE_APPROVAL_STAGE!=="qa"||
    env.SUPABASE_URL!==canonicalSupabase||
    env.SUPABASE_ANON_KEY.length<20||
    env.SUPABASE_SERVICE_ROLE_KEY.length<20||
    env.SUPABASE_ANON_KEY===env.SUPABASE_SERVICE_ROLE_KEY)
  return fail(503,"CHALLENGE_NOT_CONFIGURED");
 const bearer=req.headers.get("authorization")??"";
 if(!/^Bearer [^\s]{20,8192}$/.test(bearer)||
    bearer.slice(7)===env.SUPABASE_SERVICE_ROLE_KEY)
  return fail(401,"CHALLENGE_LOGIN_REQUIRED");
 const body=await boundedRequest(req,2048);
 const action=exactKeys(body,["action","projectId"])&&body.action==="issue"?"issue":
 exactKeys(body,["action","projectId","challengeId","proof"])&&body.action==="verify"?"verify":null;
 if(!action||typeof (body as Record<string,unknown>).projectId!=="string"||
    !allowedProject.test((body as Record<string,unknown>).projectId as string))
  return fail(400,"CHALLENGE_REQUEST_INVALID");
 const projectId=(body as Record<string,unknown>).projectId as string;
 const fetcher=cfg.transport??fetch; const now=(cfg.now??Date.now)();
 try{
  const identity=await fetcher(canonicalSupabase+"/auth/v1/user",{
   method:"GET",redirect:"error",cache:"no-store",
   signal:AbortSignal.timeout(8000),
   headers:{"apikey":env.SUPABASE_ANON_KEY,"Authorization":bearer}
  });
  const user=await boundedJson(identity,16384);
  if(!user||typeof user!=="object"||Array.isArray(user)||
     typeof (user as Record<string,unknown>).id!=="string"||
     !allowedUuid.test((user as Record<string,unknown>).id as string))
   return fail(401,"CHALLENGE_LOGIN_REQUIRED");
  const uid=(user as Record<string,unknown>).id as string;
  const membership=row(await readTable(fetcher,env,"account_memberships",{
   select:"user_id,access_state,authorized_at,revoked_at",
   user_id:"eq."+uid,limit:"2"
  }));
  if(!memberIsActive(membership,uid,now))return fail(403,"CHALLENGE_NOT_AUTHORIZED");
  if(action==="issue"){
   // DB function locks a separately ADMIN-created pending grant and generates
   // the 32-byte nonce inside Postgres, with concurrency and issue rate limits.
   const issued=row(await serviceApi(fetcher,env,"feature_owner_challenge_issue",{
    p_project_id:projectId,p_subject_uid:uid
   }));
   if(!issued||issued.project_id!==projectId||issued.subject_uid!==uid||
      !UUID.test(String(issued.challenge_id))||
      typeof issued.nonce!=="string"||
      !/^[A-Za-z0-9_-]{43}$/.test(issued.nonce)||
      !Number.isSafeInteger(issued.issued_at_ms)||
      !Number.isSafeInteger(issued.expires_at_ms)||
      (issued.expires_at_ms as number) <=now||
      (issued.expires_at_ms as number)-(issued.issued_at_ms as number)>300000)
    return fail(403,"CHALLENGE_NOT_AUTHORIZED");
   return response(200,{
    challengeId:issued.challenge_id,
    challenge:{
     protocol:"katosync.owner-key-challenge/v1",
     projectId,subjectUid:uid,nonce:issued.nonce,
     issuedAtMs:issued.issued_at_ms,expiresAtMs:issued.expires_at_ms,
    },
    grantsRights:false,
   });
  }
  const received=body as Record<string,unknown>;
  if(typeof received.challengeId!=="string"||!UUID.test(received.challengeId)||
     !exactKeys(received.proof,[
      "protocol","projectId","subjectUid","publicKeyBase64Url",
      "nonce","signedAtMs","signature",
     ]))
   return fail(400,"CHALLENGE_PROOF_INVALID");
  const stored=row(await readTable(fetcher,env,"feature_owner_challenges",{
   select:"challenge_id,grant_id,project_id,subject_uid,nonce,issued_at,expires_at,consumed_at,canceled_at",
   challenge_id:"eq."+received.challengeId,project_id:"eq."+projectId,
   subject_uid:"eq."+uid,limit:"2"
  }));
  if(!stored||stored.challenge_id!==received.challengeId||
     stored.project_id!==projectId||stored.subject_uid!==uid||
     stored.consumed_at!==null||stored.canceled_at!==null||
     !UUID.test(String(stored.grant_id)))
   return fail(409,"CHALLENGE_REPLAY_OR_EXPIRED");
  const grant=row(await readTable(fetcher,env,"feature_approver_grants",{
   select:"grant_id,project_id,subject_uid,state,owner_key_id,owner_signing_public_key",
   grant_id:"eq."+stored.grant_id,project_id:"eq."+projectId,subject_uid:"eq."+uid,
   limit:"2"
  }));
  const ownerProof=received.proof as OwnerKeyPossession40;
  if(!grant||grant.grant_id!==stored.grant_id||
     grant.state!=="pending"||
     ownerProof.publicKeyBase64Url!==grant.owner_signing_public_key)
   return fail(403,"CHALLENGE_NOT_AUTHORIZED");
  const independent={
   protocol:"katosync.owner-key-challenge/v1",
   projectId,subjectUid:uid,nonce:stored.nonce,
   issuedAtMs:parseTimestamp(stored.issued_at),
   expiresAtMs:parseTimestamp(stored.expires_at)
  };
  const verified=await verifyOwnerKeyPossession40(ownerProof,independent,projectId,uid,now);
  if(!verified||verified.ownerKeyId!==grant.owner_key_id)
   return fail(403,"CHALLENGE_SIGNATURE_INVALID");
  // The DB enforces a single atomic success even if requests race. Proof
  // verification does not set grant.state='active' or add review decisions.
  const consumed=await serviceApi(fetcher,env,"feature_owner_challenge_consume",{
   p_challenge_id:received.challengeId,p_project_id:projectId,p_subject_uid:uid,
   p_key_id:verified.ownerKeyId,p_signature:ownerProof.signature
  });
  if(consumed!==true)return fail(409,"CHALLENGE_REPLAY_OR_EXPIRED");
  return response(200,{
   state:"proof_consumed_pending_independent_review",
   ownerKeyId:verified.ownerKeyId,grantsRights:false,
  });
 }catch{
  return fail(503,"CHALLENGE_UNAVAILABLE");
 }
}
