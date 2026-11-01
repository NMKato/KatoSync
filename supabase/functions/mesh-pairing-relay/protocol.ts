// NMKato Solutions – Stage 3H: relay only; never peer trust or mTLS.
export const RELAY_PROTOCOL="katosync-mesh-pairing-relay-v1";
export const RELAY_LIST_PROTOCOL="katosync-mesh-pairing-relay-list-v1";
const ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const B43=/^[A-Za-z0-9_-]{43}$/,B86=/^[A-Za-z0-9_-]{86}$/;
const enc=new TextEncoder();
type Obj=Record<string,unknown>;
type Offer={protocol:string;publicKey:string;nonce:string;expiresAt:number;accountScope:string;signature:string};
export type RelayEnvelope={protocol:string;requestId:string;senderDeviceId:string;recipientDeviceId:string;kind:"challenge"|"response";payloadB64:string;nonce:string;expiresAt:number;signature:string};
export type RelayListProof={protocol:string;deviceId:string;nonce:string;expiresAt:number;signature:string};
export type RelayInvite={request_id:string;owner_user_id:string;source_device_id:string;target_device_id:string;state:string;expires_at:string;signed_offer:unknown};
const obj=(v:unknown):Obj|null=>v&&typeof v==="object"&&!Array.isArray(v)?v as Obj:null;
const exact=(v:Obj|null,k:string[])=>!!v&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const base64=(v:Uint8Array)=>btoa(String.fromCharCode(...v)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
function bytes(v:string,max:number):Uint8Array{
 if(v.length>max||!/^[A-Za-z0-9_-]+$/.test(v))throw Error("bad_b64");
 const out=Uint8Array.from(atob(v.replaceAll("-","+").replaceAll("_","/").padEnd(Math.ceil(v.length/4)*4,"=")),c=>c.charCodeAt(0));
 if(base64(out)!==v)throw Error("noncanonical_b64");
 return out;
}
async function hash(v:string):Promise<string>{
 return base64(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(v))));
}
async function signatureValid(publicKey:string,sig:string,payload:string):Promise<boolean>{
 try{
  const pub=bytes(publicKey,43),signature=bytes(sig,86);
  if(pub.length!==32||signature.length!==64)return false;
  const key=await crypto.subtle.importKey("raw",pub,{name:"Ed25519"},false,["verify"]);
  return await crypto.subtle.verify("Ed25519",key,signature,enc.encode(payload));
 }catch{return false;}
}
export async function accountScope(owner:string,origin=ORIGIN):Promise<string>{
 if(!UUID.test(owner)||!(origin===ORIGIN||/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(origin)))throw Error("owner_or_origin");
 return hash("katosync-mesh-v1-account-scope:"+origin+":"+owner);
}
function validOffer(v:unknown):v is Offer{
 const o=obj(v);
 return exact(o,["protocol","publicKey","nonce","expiresAt","accountScope","signature"])&&!!o&&
 o.protocol==="katosync-mesh-pairing-v1"&&typeof o.publicKey==="string"&&B43.test(o.publicKey)&&
 typeof o.nonce==="string"&&B43.test(o.nonce)&&typeof o.accountScope==="string"&&B43.test(o.accountScope)&&
 typeof o.signature==="string"&&B86.test(o.signature)&&typeof o.expiresAt==="number"&&Number.isSafeInteger(o.expiresAt);
}
// Rust serde uses struct declaration order, while PostgreSQL JSONB may
// return the exact same signed fields in a DIFFERENT order. Construct the
// serde-v1 canonical value before hashing; never hash server JSONB text.
function canonicalOffer(o:Offer):string{
 return JSON.stringify({protocol:o.protocol,publicKey:o.publicKey,nonce:o.nonce,
  expiresAt:o.expiresAt,accountScope:o.accountScope,signature:o.signature});
}
function canonicalChallenge(c:Obj,offer:Offer):string{
 return JSON.stringify({protocol:c.protocol,offer:JSON.parse(canonicalOffer(offer)),
  responderPublicKey:c.responderPublicKey,responderNonce:c.responderNonce,
  expiresAt:c.expiresAt,signature:c.signature});
}
export function parseRelayEnvelope(v:unknown):RelayEnvelope|null{
 const p=obj(v);
 if(!exact(p,["protocol","requestId","senderDeviceId","recipientDeviceId","kind","payloadB64","nonce","expiresAt","signature"])||!p||
  p.protocol!==RELAY_PROTOCOL||typeof p.requestId!=="string"||!UUID.test(p.requestId)||
  typeof p.senderDeviceId!=="string"||!UUID.test(p.senderDeviceId)||
  typeof p.recipientDeviceId!=="string"||!UUID.test(p.recipientDeviceId)||p.senderDeviceId===p.recipientDeviceId||
  !["challenge","response"].includes(String(p.kind))||typeof p.payloadB64!=="string"||
  p.payloadB64.length<20||p.payloadB64.length>11000||typeof p.nonce!=="string"||!B43.test(p.nonce)||
  typeof p.signature!=="string"||!B86.test(p.signature)||
  typeof p.expiresAt!=="number"||!Number.isSafeInteger(p.expiresAt))return null;
 try{if(bytes(p.payloadB64,11000).length>8192||bytes(p.nonce,43).length!==32)return null;}
 catch{return null;}
 return p as RelayEnvelope;
}
export function parseRelayListProof(v:unknown):RelayListProof|null{
 const p=obj(v);
 if(!exact(p,["protocol","deviceId","nonce","expiresAt","signature"])||!p||
  p.protocol!==RELAY_LIST_PROTOCOL||typeof p.deviceId!=="string"||!UUID.test(p.deviceId)||
  typeof p.nonce!=="string"||!B43.test(p.nonce)||typeof p.signature!=="string"||!B86.test(p.signature)||
  typeof p.expiresAt!=="number"||!Number.isSafeInteger(p.expiresAt))return null;
 return p as RelayListProof;
}
export async function verifyRelayListProof(p:RelayListProof,owner:string,key:string,now=Date.now(),origin=ORIGIN):Promise<boolean>{
 // Protocol v1 signed read lacks tenant origin. Refuse preview reads until
 // native v2 signing includes the origin, preventing cloned-tenant replay.
 return origin===ORIGIN&&p.expiresAt*1000>now+1000&&p.expiresAt*1000<=now+90000&&
 signatureValid(key,p.signature,[p.protocol,owner,p.deviceId,p.nonce,String(p.expiresAt)].join("|"));
}
// Validates the OUTER sender signature, ORIGINAL signed offer, and INNER
// Ed25519 challenge/response. JSON field order is protocol-v1 canonical:
// supplied by the existing Rust MeshOffer/PairingChallenge struct serializers.
export async function verifyRelayEnvelope(
 p:RelayEnvelope,owner:string,sourceKey:string,targetKey:string,invite:RelayInvite,now=Date.now(),origin=ORIGIN
):Promise<boolean>{
 try{
  if(!UUID.test(owner)||!B43.test(sourceKey)||!B43.test(targetKey)||sourceKey===targetKey||
   invite.owner_user_id!==owner||invite.request_id!==p.requestId||invite.state!=="accepted"||
   !validOffer(invite.signed_offer))return false;
  const o=invite.signed_offer,until=Date.parse(invite.expires_at);
  if(!Number.isFinite(until)||until<=now||o.expiresAt*1000!==until||
   p.expiresAt*1000<=now+1000||p.expiresAt*1000>until||p.expiresAt*1000>now+310000||
   o.accountScope!==await accountScope(owner,origin)||o.publicKey!==sourceKey)return false;
  const from=p.kind==="challenge"?invite.target_device_id:invite.source_device_id;
  const to=p.kind==="challenge"?invite.source_device_id:invite.target_device_id;
  const signer=p.kind==="challenge"?targetKey:sourceKey;
  if(p.senderDeviceId!==from||p.recipientDeviceId!==to)return false;
  if(!await signatureValid(sourceKey,o.signature,
   [o.protocol,o.accountScope,o.publicKey,o.nonce,String(o.expiresAt)].join("|")))return false;
  if(!await signatureValid(signer,p.signature,[p.protocol,owner,p.requestId,from,to,p.kind,
   p.payloadB64,p.nonce,String(p.expiresAt)].join("|")))return false;
  const content=obj(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes(p.payloadB64,11000))));
  if(!content)return false;
  const c=p.kind==="challenge"?content:obj(content.challenge);
  if(p.kind==="response"&&(!exact(content,["protocol","challenge","signature"])||
    content.protocol!=="katosync-mesh-response-v1"||
    typeof content.signature!=="string"||!B86.test(content.signature)))return false;
  if(!exact(c,["protocol","offer","responderPublicKey","responderNonce","expiresAt","signature"])||!c||
   c.protocol!=="katosync-mesh-challenge-v1"||!validOffer(c.offer)||
   canonicalOffer(c.offer)!==canonicalOffer(o)||c.responderPublicKey!==targetKey||
   typeof c.responderNonce!=="string"||!B43.test(c.responderNonce)||
   typeof c.signature!=="string"||!B86.test(c.signature)||
   typeof c.expiresAt!=="number"||!Number.isSafeInteger(c.expiresAt)||
   c.expiresAt*1000<=now||c.expiresAt*1000>until||
   p.expiresAt>c.expiresAt)return false;
  const challengePayload=[c.protocol,await hash(canonicalOffer(c.offer)),o.accountScope,
   targetKey,c.responderNonce,String(c.expiresAt)].join("|");
  if(!await signatureValid(targetKey,c.signature,challengePayload))return false;
  if(p.kind==="challenge")return true;
  return signatureValid(sourceKey,content.signature as string,
   ["katosync-mesh-response-v1",await hash(canonicalChallenge(c,c.offer))].join("|"));
 }catch{return false;}
}
