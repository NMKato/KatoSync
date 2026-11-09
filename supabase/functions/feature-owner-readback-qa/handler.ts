// NMKato Solutions — KATOOS QA-only, read-only, owner-scoped signed review.
// No CORS, grant activation, admin enrollment, DDL or device permissions.
import {REVIEW_PROTOCOL40,verifyIndependentOwnerReview40,
 type IndependentOwnerReview40} from "../../../src/lib/independentOwnerReview40.ts";
import {canonicalSupabase,allowedUuid} from "../feature-approver-grant-qa/contract.ts";

export type Env={SUPABASE_URL:string;SUPABASE_ANON_KEY:string;
 SUPABASE_SERVICE_ROLE_KEY:string;KATOSYNC_FEATURE_APPROVAL_STAGE:string};
type Config={fetcher?:typeof fetch;now?:()=>number};
type RecordRow=Record<string,unknown>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keyId=/^ed25519-sha256:[0-9a-f]{64}$/;
const obj=(v:unknown):v is RecordRow=>!!v&&typeof v==="object"&&!Array.isArray(v);
const at=(v:unknown)=>typeof v==="string"?Date.parse(v):NaN;
const one=(v:unknown):RecordRow|null=>Array.isArray(v)&&v.length===1&&obj(v[0])?v[0]:null;
function response(code:number,payload:RecordRow):Response{
 return new Response(JSON.stringify(payload),{status:code,headers:{
  "Content-Type":"application/json","Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff"}});
}
const fail=(code:number,error:string)=>response(code,{error});
async function bounded(r:Request|Response,limit:number):Promise<unknown>{
 if(r instanceof Response&&!r.ok)return null;
 const n=Number(r.headers.get("content-length")??0);
 if(!Number.isFinite(n)||n<0||n>limit)return null;
 const reader=r.body?.getReader();if(!reader)return null;
 let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){
  const c=await reader.read();if(c.done)break;
  size+=c.value.byteLength;if(size>limit)return null;
  chunks.push(c.value);
 }}finally{reader.releaseLock();}
 const out=new Uint8Array(size);let cursor=0;
 for(const c of chunks){out.set(c,cursor);cursor+=c.byteLength;}
 try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(out));}
 catch{return null;}
}
async function read(f:typeof fetch,e:Env,t:string,q:Record<string,string>){
 const u=new URL(canonicalSupabase+"/rest/v1/"+t);
 for(const [k,v] of Object.entries(q))u.searchParams.set(k,v);
 const r=await f(u.toString(),{
  method:"GET",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000),
  headers:{apikey:e.SUPABASE_SERVICE_ROLE_KEY,
   Authorization:"Bearer "+e.SUPABASE_SERVICE_ROLE_KEY,
   "Accept-Profile":"katosync",Accept:"application/json"}});
 return one(await bounded(r,8192));
}
const member=(r:RecordRow|null,uid:string,now:number)=>
 !!r&&r.user_id===uid&&r.access_state==="active"&&r.revoked_at===null&&
 Number.isFinite(at(r.authorized_at))&&at(r.authorized_at)<=now;
const active=(r:RecordRow|null,now:number,timeField:string)=>
 !!r&&r.state==="active"&&r.revoked_at===null&&
 Number.isFinite(at(r[timeField]))&&at(r[timeField])<=now;

/** The response is a SERVER ASSERTION, not a native cryptographic trust anchor.
 * Native must independently pin the reviewer key and verify fresh authority.
 */
export async function handleOwnerReviewReadback(req:Request,e:Env,cfg:Config={}):Promise<Response>{
 if(req.method!=="POST")return fail(405,"READBACK_METHOD_NOT_ALLOWED");
 if(e.KATOSYNC_FEATURE_APPROVAL_STAGE!=="qa"||
   e.SUPABASE_URL!==canonicalSupabase||
   e.SUPABASE_ANON_KEY.length<20||e.SUPABASE_SERVICE_ROLE_KEY.length<20||
   e.SUPABASE_ANON_KEY===e.SUPABASE_SERVICE_ROLE_KEY)
  return fail(503,"READBACK_NOT_CONFIGURED");
 const token=req.headers.get("authorization")??"";
 if(!/^Bearer [^\s]{20,8192}$/.test(token)||
    token.slice(7)===e.SUPABASE_SERVICE_ROLE_KEY)
  return fail(401,"READBACK_LOGIN_REQUIRED");
 const body=await bounded(req,1024);
 if(!obj(body)||Object.keys(body).length!==3||
    !Object.keys(body).every(k=>["action","decisionId","grantId"].includes(k))||
    body.action!=="readback"||
    typeof body.decisionId!=="string"||!uuid.test(body.decisionId)||
    typeof body.grantId!=="string"||!uuid.test(body.grantId))
  return fail(400,"READBACK_REQUEST_INVALID");
 const decisionId=body.decisionId,grantId=body.grantId;
 const now=(cfg.now??Date.now)(),f=cfg.fetcher??fetch;
 if(!Number.isSafeInteger(now))return fail(503,"READBACK_UNAVAILABLE");
 try{
  const auth=await f(canonicalSupabase+"/auth/v1/user",{
   method:"GET",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000),
   headers:{apikey:e.SUPABASE_ANON_KEY,Authorization:token}});
  const who=await bounded(auth,16384);
  const uid=obj(who)?who.id:null;
  if(typeof uid!=="string"||!allowedUuid.test(uid))
   return fail(401,"READBACK_LOGIN_REQUIRED");
  const own=await read(f,e,"account_memberships",{
   select:"user_id,access_state,authorized_at,revoked_at",user_id:"eq."+uid,limit:"2"});
  if(!member(own,uid,now))return fail(403,"READBACK_NOT_AUTHORIZED");

  // Explicit server-role row scoping to caller BEFORE retrieving a decision.
  const grant=await read(f,e,"feature_approver_grants",{
   select:"grant_id,subject_uid,project_id,owner_key_id,grant_revision,state,revoked_at",
   grant_id:"eq."+grantId,subject_uid:"eq."+uid,limit:"2"});
  if(!grant||grant.grant_id!==grantId||grant.subject_uid!==uid||
     // Native Gate10 attests only an independently reviewed PENDING grant.
     // An active grant requires a different current-authority protocol.
     grant.state!=="pending"||
     grant.revoked_at!==null||typeof grant.project_id!=="string"||
     typeof grant.owner_key_id!=="string"||!keyId.test(grant.owner_key_id)||
     !Number.isSafeInteger(grant.grant_revision)||
     (grant.grant_revision as number)<1)
   return fail(403,"READBACK_NOT_AUTHORIZED");
  const proof=await read(f,e,"feature_owner_review_decisions",{
   select:"decision_id,grant_id,challenge_id,reviewer_uid,decision,reason,reviewed_at,reviewer_key_id,reviewer_key_revision,reviewer_public_key,owner_key_id,grant_revision,project_id,subject_uid,signed_at_ms,reviewer_signature,attestation_protocol",
   decision_id:"eq."+decisionId,grant_id:"eq."+grantId,
   subject_uid:"eq."+uid,limit:"2"});
  if(!proof||proof.decision_id!==decisionId||proof.grant_id!==grantId||
    proof.subject_uid!==uid||proof.owner_key_id!==grant.owner_key_id||
    proof.project_id!==grant.project_id||proof.grant_revision!==grant.grant_revision||
    typeof proof.challenge_id!=="string"||!uuid.test(proof.challenge_id)||
    typeof proof.reviewer_uid!=="string"||!uuid.test(proof.reviewer_uid)||
    proof.reviewer_uid===uid||proof.attestation_protocol!==REVIEW_PROTOCOL40||
    typeof proof.reviewer_key_id!=="string"||!keyId.test(proof.reviewer_key_id)||
    !Number.isSafeInteger(proof.reviewer_key_revision)||
    (proof.reviewer_key_revision as number)<1||
    !Number.isSafeInteger(proof.signed_at_ms)||
    !["approved","rejected"].includes(String(proof.decision))||
    typeof proof.reviewer_public_key!=="string"||
    typeof proof.reviewer_signature!=="string"||
    typeof proof.reason!=="string"||
    !Number.isFinite(at(proof.reviewed_at))||
    at(proof.reviewed_at)<(proof.signed_at_ms as number)||
    at(proof.reviewed_at)>(proof.signed_at_ms as number)+60_000||
    at(proof.reviewed_at)>now+5000)
   return fail(409,"READBACK_DECISION_INVALID");
  const reviewerUid=proof.reviewer_uid as string;
  const rm=await read(f,e,"account_memberships",{
   select:"user_id,access_state,authorized_at,revoked_at",
   user_id:"eq."+reviewerUid,limit:"2"});
  const reviewer=await read(f,e,"feature_approval_reviewers",{
   select:"reviewer_uid,state,authorized_at,revoked_at",
   reviewer_uid:"eq."+reviewerUid,limit:"2"});
  const key=await read(f,e,"feature_reviewer_signing_keys",{
   select:"reviewer_uid,reviewer_key_id,public_key,key_revision,state,approved_at,revoked_at",
   reviewer_uid:"eq."+reviewerUid,
   reviewer_key_id:"eq."+proof.reviewer_key_id,limit:"2"});
  const project=await read(f,e,"feature_approval_projects",{
   select:"project_id,state,approved_at,revoked_at",
   project_id:"eq."+grant.project_id,limit:"2"});
  const challenge=await read(f,e,"feature_owner_challenges",{
   select:"challenge_id,grant_id,project_id,subject_uid,consumed_at,canceled_at,proof_key_id",
   challenge_id:"eq."+proof.challenge_id,grant_id:"eq."+grantId,
   subject_uid:"eq."+uid,limit:"2"});
  if(!member(rm,reviewerUid,now)||!active(reviewer,now,"authorized_at")||
     reviewer?.reviewer_uid!==reviewerUid||
     !active(key,now,"approved_at")||
     key?.reviewer_uid!==reviewerUid||
     key?.reviewer_key_id!==proof.reviewer_key_id||
     key?.key_revision!==proof.reviewer_key_revision||
     key?.public_key!==proof.reviewer_public_key||
     !active(project,now,"approved_at")||
     project?.project_id!==grant.project_id||
     !challenge||challenge.challenge_id!==proof.challenge_id||
     challenge.grant_id!==grantId||challenge.subject_uid!==uid||
     challenge.project_id!==grant.project_id||
     challenge.proof_key_id!==grant.owner_key_id||
     challenge.canceled_at!==null||
     !Number.isFinite(at(challenge.consumed_at))||
     at(challenge.consumed_at)>now)
   return fail(403,"READBACK_CURRENT_AUTHORITY_INVALID");
  const v:IndependentOwnerReview40={
   protocol:REVIEW_PROTOCOL40,grantId,challengeId:proof.challenge_id as string,
   projectId:grant.project_id as string,subjectUid:uid,
   ownerKeyId:grant.owner_key_id as string,
   grantRevision:grant.grant_revision as number,
   reviewerUid,reviewerKeyId:proof.reviewer_key_id as string,
   reviewerKeyRevision:proof.reviewer_key_revision as number,
   reviewerPublicKey:proof.reviewer_public_key as string,
   decision:proof.decision as "approved"|"rejected",
   reason:proof.reason as string,signedAtMs:proof.signed_at_ms as number};
  const signature=proof.reviewer_signature as string;
  // Historical signature validation at its issuance timestamp only.
  // The server cannot assert native reviewer trust or change grant state.
  if(!(await verifyIndependentOwnerReview40(
   v,signature,reviewerUid,v.reviewerKeyId,v.signedAtMs)))
   return fail(403,"READBACK_SIGNATURE_INVALID");
  return response(200,{
   protocol:"katosync.owner-review-readback/v1",
   state:"server_signed_review_readback_not_native_authorization",
   subjectUid:uid,decisionId,readbackAtMs:now,
   attestation:v,reviewerSignature:signature,
   authorityEvidenceSource:"server_read_only_untrusted_until_native_recheck",
   grantsRights:false,verifiedPercent:null});
 }catch{return fail(503,"READBACK_UNAVAILABLE");}
}
