// NMKato Solutions — KatoSync 4.0 native-independent, read-only proof of key
// possession. An Ed25519 proof is NOT a project grant or an owner approval.
// A separately administered, one-time challenge must be consumed server-side.
export const PROOF_PROTOCOL40 = "katosync.owner-key-possession/v1";
const PROOF_DOMAIN40 = "KatoSync owner-key-possession v1\n";
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export type AdminKeyChallenge40 = {
  protocol: "katosync.owner-key-challenge/v1";
  projectId: string;
  subjectUid: string;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
};
export type OwnerKeyPossession40 = {
  protocol: typeof PROOF_PROTOCOL40;
  projectId: string;
  subjectUid: string;
  publicKeyBase64Url: string;
  nonce: string;
  signedAtMs: number;
  signature: string;
};
function onlyKeys(value:unknown,expected:string[]):value is Record<string,unknown>{
 if(value===null||typeof value!=="object"||Array.isArray(value))return false;
 const keys=Object.keys(value as object);
 return keys.length===expected.length&&keys.every(k=>expected.includes(k));
}
function decodeCanonical(raw:string,expected:number):Uint8Array|null{
 if(!BASE64URL.test(raw))return null;
 try{
  const alphabet=raw.replace(/-/g,"+").replace(/_/g,"/");
  const binary=atob(alphabet+"=".repeat((4-raw.length%4)%4));
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(bytes.length!==expected)return null;
  let base64="";for(const byte of bytes)base64+=String.fromCharCode(byte);
  if(btoa(base64).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")!==raw)return null;
  return bytes;
 }catch{return null;}
}
export function ownerProofBytes40(proof:OwnerKeyPossession40):Uint8Array{
 return new TextEncoder().encode(PROOF_DOMAIN40+JSON.stringify([
  proof.protocol,proof.projectId,proof.subjectUid,
  proof.publicKeyBase64Url,proof.nonce,proof.signedAtMs
 ]));
}
function asBuffer(bytes:Uint8Array):ArrayBuffer{
 const result=new ArrayBuffer(bytes.length);
 new Uint8Array(result).set(bytes);
 return result;
}
/** Returns only a key fingerprint, NOT owner permissions, and consumes no grant. */
export async function verifyOwnerKeyPossession40(
 proof:unknown,
 independentChallenge:unknown,
 expectedProject:string,
 expectedSubjectUid:string,
 nowMs:number
):Promise<{ownerKeyId:string}|null>{
 const grantKeys=["protocol","projectId","subjectUid","publicKeyBase64Url","nonce","signedAtMs","signature"];
 const challengeKeys=["protocol","projectId","subjectUid","nonce","issuedAtMs","expiresAtMs"];
 if(!onlyKeys(proof,grantKeys)||!onlyKeys(independentChallenge,challengeKeys)||
   !ID.test(expectedProject)||!UUID.test(expectedSubjectUid)||
   !Number.isSafeInteger(nowMs))return null;
 const p=proof as OwnerKeyPossession40,c=independentChallenge as AdminKeyChallenge40;
 if(p.protocol!==PROOF_PROTOCOL40||c.protocol!=="katosync.owner-key-challenge/v1"||
   p.projectId!==expectedProject||c.projectId!==expectedProject||
   p.subjectUid!==expectedSubjectUid||c.subjectUid!==expectedSubjectUid||
   typeof p.publicKeyBase64Url!=="string"||typeof p.nonce!=="string"||
   typeof p.signature!=="string"||p.nonce!==c.nonce||
   !Number.isSafeInteger(p.signedAtMs)||
   !Number.isSafeInteger(c.issuedAtMs)||!Number.isSafeInteger(c.expiresAtMs)||
   c.issuedAtMs>nowMs+5000||c.expiresAtMs<=nowMs||
   c.expiresAtMs-c.issuedAtMs>300000||
   p.signedAtMs<c.issuedAtMs||p.signedAtMs>nowMs+5000||
   p.signedAtMs>=c.expiresAtMs)return null;
 const pub=decodeCanonical(p.publicKeyBase64Url,32);
 const nonce=decodeCanonical(p.nonce,32);
 const signature=decodeCanonical(p.signature,64);
 if(!pub||!nonce||!signature)return null;
 try{
  const verifyingKey=await crypto.subtle.importKey("raw",asBuffer(pub),"Ed25519",false,["verify"]);
  const valid=await crypto.subtle.verify("Ed25519",verifyingKey,asBuffer(signature),
    asBuffer(ownerProofBytes40(p)));
  if(!valid)return null;
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",asBuffer(pub)));
  return {ownerKeyId:"ed25519-sha256:"+Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("")};
 }catch{return null;}
}
