// NMKato Solutions — Gate 11: offline PUBLIC-key proof of possession only.
// No network, Supabase, service-role, Keychain, private-key generation or rights.
// A valid proof is NOT human identity verification, admin enrollment or approval.
import {createHash,createPublicKey,randomBytes,verify} from "node:crypto";

export const POP_PROTOCOL="katosync.reviewer-enrollment-pop-qa/v1";
const DOMAIN="KatoSync independent-reviewer-enrollment-possession QA v1\n";
const TTL_MS=120_000;
const SKEW_MS=5_000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROJECT=/^[a-zA-Z0-9_.:-]{1,80}$/;
const KEY=/^ed25519-sha256:[0-9a-f]{64}$/;
const EXACT=["protocol","reviewerUid","ownerUid","projectId","reviewerPublicKey",
  "reviewerKeyId","nonce","issuedAtMs","expiresAtMs"];
const SPKI_PREFIX=Buffer.from("302a300506032b6570032100","hex");
function invalid(code){throw new Error(code);}
function object(v){return v!==null&&typeof v==="object"&&!Array.isArray(v);}
function bytes(raw,len){
  if(typeof raw!=="string"||!new RegExp("^[A-Za-z0-9_-]{"+(len===32?43:86)+"}$").test(raw))
    invalid("POP_ENCODING_INVALID");
  const b=Buffer.from(raw,"base64url");
  if(b.length!==len||b.toString("base64url")!==raw)invalid("POP_ENCODING_INVALID");
  return b;
}
function safeTime(t){return Number.isSafeInteger(t)&&t>0;}
function validFields(c){
  if(!object(c)||Object.keys(c).length!==EXACT.length||
    !Object.keys(c).every(k=>EXACT.includes(k)))invalid("POP_CHALLENGE_INVALID");
  if(c.protocol!==POP_PROTOCOL||!UUID.test(c.reviewerUid)||
    !UUID.test(c.ownerUid)||c.reviewerUid===c.ownerUid||
    !PROJECT.test(c.projectId)||!KEY.test(c.reviewerKeyId)||
    !safeTime(c.issuedAtMs)||!safeTime(c.expiresAtMs)||
    c.expiresAtMs-c.issuedAtMs!==TTL_MS)
    invalid("POP_CHALLENGE_INVALID");
  const pub=bytes(c.reviewerPublicKey,32);
  const nonce=bytes(c.nonce,32);
  if(nonce.length!==32)invalid("POP_CHALLENGE_INVALID");
  if("ed25519-sha256:"+createHash("sha256").update(pub).digest("hex")!==c.reviewerKeyId)
    invalid("POP_KEY_FINGERPRINT_MISMATCH");
  return pub;
}
export function reviewerPoPSigningBytes(challenge){
  validFields(challenge);
  return Buffer.from(DOMAIN+JSON.stringify([
    challenge.protocol,challenge.reviewerUid,challenge.ownerUid,
    challenge.projectId,challenge.reviewerPublicKey,challenge.reviewerKeyId,
    challenge.nonce,challenge.issuedAtMs,challenge.expiresAtMs
  ]),"utf8");
}
export function prepareReviewerPoP({reviewerUid,ownerUid,projectId,reviewerPublicKey},nowMs=Date.now()){
  if(!safeTime(nowMs)||nowMs>Number.MAX_SAFE_INTEGER-TTL_MS)
    invalid("POP_TIME_INVALID");
  const key=bytes(reviewerPublicKey,32);
  const challenge={
    protocol:POP_PROTOCOL,reviewerUid,ownerUid,projectId,reviewerPublicKey,
    reviewerKeyId:"ed25519-sha256:"+createHash("sha256").update(key).digest("hex"),
    nonce:randomBytes(32).toString("base64url"),
    issuedAtMs:nowMs,expiresAtMs:nowMs+TTL_MS
  };
  validFields(challenge);
  return Object.freeze({
    challenge:Object.freeze(challenge),
    signingMessageBase64url:reviewerPoPSigningBytes(challenge).toString("base64url"),
    state:"awaiting_independent_reviewer_key_signature_no_rights",
    grantsRights:false
  });
}
export function verifyReviewerPoP(challenge,signature,nowMs=Date.now()){
  if(!safeTime(nowMs))invalid("POP_TIME_INVALID");
  const pub=validFields(challenge);
  if(challenge.issuedAtMs>nowMs+SKEW_MS||nowMs>challenge.expiresAtMs)
    invalid("POP_CHALLENGE_EXPIRED");
  const proof=bytes(signature,64);
  let ok=false;
  try{
    const key=createPublicKey({key:Buffer.concat([SPKI_PREFIX,pub]),format:"der",type:"spki"});
    ok=verify(null,reviewerPoPSigningBytes(challenge),key,proof);
  }catch{ok=false;}
  if(!ok)invalid("POP_SIGNATURE_INVALID");
  return Object.freeze({
    status:"public_key_possession_only_not_enrolled",
    projectId:challenge.projectId,reviewerUid:challenge.reviewerUid,
    ownerUid:challenge.ownerUid,reviewerKeyId:challenge.reviewerKeyId,
    reviewerPublicKey:challenge.reviewerPublicKey,
    issuedAtMs:challenge.issuedAtMs,expiresAtMs:challenge.expiresAtMs,
    grantsRights:false,reviewerAuthorized:false,reviewerKeyPinned:false,
    requiresIndependentHumanWitness:true,
    requiresSeparatePrivilegedAdminEnrollment:true
  });
}
