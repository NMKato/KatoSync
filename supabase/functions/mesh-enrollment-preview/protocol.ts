// NMKato Solutions — Stage 3P isolated QA signature-only verification.
export const ENROLLMENT_V2="katosync-mesh-enrollment-proof-v2";
const DOMAIN="katosync-mesh-device-enrollment-proof-v2";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const B43=/^[A-Za-z0-9_-]{43}$/;
const B86=/^[A-Za-z0-9_-]{86}$/;
export type EnrollmentProofV2={
 protocol:string;challengeId:string;origin:string;nonce:string;publicKey:string;
 expiresAt:string;signature:string;deviceName:string;platformOs:string
};
export type ChallengeRow={
 challenge_id:string;owner_user_id:string;signing_public_key:string;
 nonce:string;expires_at:string;consumed_at:string|null
};
function decode(raw:string):Uint8Array|null{
 try{
  const b=Uint8Array.from(atob(raw.replaceAll("-","+").replaceAll("_","/").padEnd(Math.ceil(raw.length/4)*4,"=")),c=>c.charCodeAt(0));
  const check=btoa(String.fromCharCode(...b)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
  return check===raw?b:null;
 }catch{return null;}
}
// Next: strict v2 origin-bound proof validation.
export function parseEnrollmentV2(v:unknown):EnrollmentProofV2|null {
 if (!v || typeof v!=="object" || Array.isArray(v)) return null;
 const p = v as Record<string,unknown>;
 const required=["protocol","challengeId","origin","nonce","publicKey","expiresAt","signature","deviceName","platformOs"];
 if(Object.keys(p).length!==required.length||required.some(key=>!Object.hasOwn(p,key)))return null;
 if(p.protocol!==ENROLLMENT_V2)return null;
 if(typeof p.challengeId!=="string"||!UUID.test(p.challengeId))return null;
 if(typeof p.origin!=="string"||!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(p.origin))return null;
 if(p.origin==="https://xbnnlyyxiilklsygxcof.supabase.co")return null;
 if(typeof p.nonce!=="string"||!B43.test(p.nonce)||decode(p.nonce)?.length!==32)return null;
 if(typeof p.publicKey!=="string"||!B43.test(p.publicKey)||decode(p.publicKey)?.length!==32)return null;
 if(typeof p.signature!=="string"||!B86.test(p.signature)||decode(p.signature)?.length!==64)return null;
 if(typeof p.expiresAt!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|\+00:00)$/.test(p.expiresAt)||
    !Number.isFinite(Date.parse(p.expiresAt)))return null;
 if(typeof p.deviceName!=="string"||p.deviceName.trim().length<1||p.deviceName.length>80)return null;
 if(/[<>\u0000-\u001f]/.test(p.deviceName))return null;
 if(!["macos","windows","linux"].includes(String(p.platformOs)))return null;
 return p as EnrollmentProofV2;
}
export async function verifyEnrollmentV2(
 proof:EnrollmentProofV2, owner:string, origin:string, record:ChallengeRow, now=Date.now()
):Promise<boolean>{
 try {
  if(!parseEnrollmentV2(proof)||proof.origin!==origin||!UUID.test(owner))return false;
  if(record.challenge_id!==proof.challengeId||record.owner_user_id!==owner)return false;
  if(record.signing_public_key!==proof.publicKey||record.nonce!==proof.nonce)return false;
  if(record.consumed_at!==null)return false;
  const expires=Date.parse(proof.expiresAt);
  if(Date.parse(record.expires_at)!==expires||expires<=now+1000||expires>now+95000)return false;
  const rawKey=decode(proof.publicKey),rawSignature=decode(proof.signature);
  if(!rawKey||!rawSignature)return false;
  const key=await crypto.subtle.importKey("raw",rawKey,{name:"Ed25519"},false,["verify"]);
  const message=[DOMAIN,owner,origin,proof.challengeId,proof.nonce,proof.publicKey,
   String(expires),proof.deviceName,proof.platformOs].join("\n");
  return crypto.subtle.verify("Ed25519",key,rawSignature,new TextEncoder().encode(message));
 }catch{return false;}
}
