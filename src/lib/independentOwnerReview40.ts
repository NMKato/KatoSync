// NMKato Solutions – KatoSync Gate 9 independent HUMAN reviewer signing.
// Ed25519 possession and a signed decision NEVER assign a project role by
// themselves. Key enrollment requires a separate trusted administrator.
export const REVIEW_PROTOCOL40="katosync.owner-independent-review/v1" as const;
export const REVIEW_DOMAIN40="KatoSync independent-owner-review v1\n";

export interface IndependentOwnerReview40 {
 protocol:typeof REVIEW_PROTOCOL40;
 grantId:string;
 challengeId:string;
 projectId:string;
 subjectUid:string;
 ownerKeyId:string;
 grantRevision:number;
 reviewerUid:string;
 reviewerKeyId:string;
 reviewerKeyRevision:number;
 reviewerPublicKey:string;
 decision:"approved"|"rejected";
 reason:string;
 signedAtMs:number;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY=/^ed25519-sha256:[0-9a-f]{64}$/;
const PROJECT=/^[A-Za-z0-9_.:-]{1,80}$/;
function canonical(raw:string,n:number):Uint8Array|null{
 if(typeof raw!=="string"||!(n===32?/^[A-Za-z0-9_-]{43}$/:/^[A-Za-z0-9_-]{86}$/).test(raw))return null;
 try{
  const binary=atob(raw.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-raw.length%4)%4));
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(bytes.length!==n)return null;
  let str="";for(const byte of bytes)str+=String.fromCharCode(byte);
  if(btoa(str).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")!==raw)return null;
  return bytes;
 }catch{return null;}
}
function buffer(bytes:Uint8Array):ArrayBuffer{
 const target=new ArrayBuffer(bytes.byteLength);
 new Uint8Array(target).set(bytes);
 return target;
}
export function reviewerSigningBytes40(v:IndependentOwnerReview40):Uint8Array{
 return new TextEncoder().encode(REVIEW_DOMAIN40+JSON.stringify([
  v.protocol,v.grantId,v.challengeId,v.projectId,v.subjectUid,v.ownerKeyId,
  v.grantRevision,v.reviewerUid,v.reviewerKeyId,v.reviewerKeyRevision,
  v.reviewerPublicKey,v.decision,v.reason,v.signedAtMs
 ]));
}
export async function verifyIndependentOwnerReview40(
 input:unknown,signature:string,
 expectedReviewerUid:string,expectedKeyId:string,
 nowMs:number
):Promise<boolean>{
 if(!input||typeof input!=="object"||Array.isArray(input))return false;
 const v=input as IndependentOwnerReview40;
 if(Object.keys(v).length!==14||!Object.keys(v).every(k=>[
  "protocol","grantId","challengeId","projectId","subjectUid","ownerKeyId",
  "grantRevision","reviewerUid","reviewerKeyId","reviewerKeyRevision",
  "reviewerPublicKey","decision","reason","signedAtMs"
 ].includes(k)))return false;
 if(v.protocol!==REVIEW_PROTOCOL40||!UUID.test(v.grantId)||!UUID.test(v.challengeId)||
    !PROJECT.test(v.projectId)||!UUID.test(v.subjectUid)||
    !UUID.test(v.reviewerUid)||v.subjectUid===v.reviewerUid||
    v.reviewerUid!==expectedReviewerUid||!KEY.test(v.ownerKeyId)||
    !KEY.test(v.reviewerKeyId)||v.reviewerKeyId!==expectedKeyId||
    !Number.isSafeInteger(v.grantRevision)||v.grantRevision<1||
    !Number.isSafeInteger(v.reviewerKeyRevision)||v.reviewerKeyRevision<1||
    !["approved","rejected"].includes(v.decision)||
    typeof v.reason!=="string"||v.reason!==v.reason.trim()||
    v.reason.length<12||v.reason.length>1000||/[\x00-\x1f\x7f]/.test(v.reason)||
    !Number.isSafeInteger(v.signedAtMs)||!Number.isSafeInteger(nowMs)||
    v.signedAtMs>nowMs+5000||v.signedAtMs<nowMs-60000)return false;
 const key=canonical(v.reviewerPublicKey,32);
 const proof=canonical(signature,64);
 if(!key||!proof)return false;
 try{
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",buffer(key)));
  const hash=Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
  if(v.reviewerKeyId!=="ed25519-sha256:"+hash)return false;
  const verifying=await crypto.subtle.importKey("raw",buffer(key),"Ed25519",false,["verify"]);
  return await crypto.subtle.verify("Ed25519",verifying,buffer(proof),buffer(reviewerSigningBytes40(v)));
 }catch{return false;}
}
