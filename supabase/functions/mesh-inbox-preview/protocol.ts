// Stage 3Q: independent, QA-only inbox v2 signatures.
// Production inbox v1 remains SHA-pinned and unchanged.
import {accountScope} from "../mesh-pairing-relay/protocol.ts";
export const INBOX_SEND_V2="katosync-mesh-inbox-send-v2";
export const INBOX_RECEIVE_V2="katosync-mesh-inbox-recipient-v2";
export const LIST_SENTINEL="00000000-0000-4000-8000-000000000000";
const LIVE="https://xbnnlyyxiilklsygxcof.supabase.co";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const B43=/^[A-Za-z0-9_-]{43}$/,B86=/^[A-Za-z0-9_-]{86}$/;
const QA=/^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
export type Offer={protocol:string;publicKey:string;nonce:string;expiresAt:number;accountScope:string;signature:string};
export type SendV2={protocol:string;origin:string;sourceDeviceId:string;targetDeviceId:string;signedOffer:Offer;dispatchSignature:string};
export type RecipientV2={protocol:string;origin:string;deviceId:string;action:"list"|"accept"|"reject";requestId:string;nonce:string;expiresAt:number;signature:string};
const obj=(v:unknown):Record<string,unknown>|null=>
 v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const exact=(o:Record<string,unknown>|null,fields:string[])=>
 !!o&&Object.keys(o).length===fields.length&&fields.every(k=>Object.hasOwn(o,k));
function decode(raw:string):Uint8Array|null{
 try{
  const bytes=Uint8Array.from(atob(raw.replaceAll("-","+").replaceAll("_","/").padEnd(Math.ceil(raw.length/4)*4,"=")),c=>c.charCodeAt(0));
  const encoded=btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
  return encoded===raw?bytes:null;
 }catch{return null;}
}
function validQA(v:unknown):v is string{return typeof v==="string"&&QA.test(v)&&v!==LIVE;}
function validKey(v:unknown):v is string{return typeof v==="string"&&B43.test(v)&&decode(v)?.length===32;}
function validNonce(v:unknown):v is string{return validKey(v);}
function validSig(v:unknown):v is string{return typeof v==="string"&&B86.test(v)&&decode(v)?.length===64;}
async function signed(key:string,signature:string,words:string[]):Promise<boolean>{
 try{
  const pub=decode(key),sig=decode(signature);
  if(!pub||!sig)return false;
  const imported=await crypto.subtle.importKey("raw",pub,{name:"Ed25519"},false,["verify"]);
  return await crypto.subtle.verify("Ed25519",imported,sig,new TextEncoder().encode(words.join("|")));
 }catch{return false;}
}
export function parseSendV2(value:unknown):SendV2|null{
 const p=obj(value);
 if(!exact(p,["protocol","origin","sourceDeviceId","targetDeviceId","signedOffer","dispatchSignature"])||
   !p||p.protocol!==INBOX_SEND_V2||!validQA(p.origin)||
   typeof p.sourceDeviceId!=="string"||!UUID.test(p.sourceDeviceId)||
   typeof p.targetDeviceId!=="string"||!UUID.test(p.targetDeviceId)||
   p.sourceDeviceId===p.targetDeviceId||!validSig(p.dispatchSignature))return null;
 const o=obj(p.signedOffer);
 if(!exact(o,["protocol","publicKey","nonce","expiresAt","accountScope","signature"])||!o||
   o.protocol!=="katosync-mesh-pairing-v1"||!validKey(o.publicKey)||!validNonce(o.nonce)||
   typeof o.accountScope!=="string"||!B43.test(o.accountScope)||
   typeof o.expiresAt!=="number"||!Number.isSafeInteger(o.expiresAt)||
   !validSig(o.signature))return null;
 return p as SendV2;
}
export async function verifySendV2(
 raw:unknown,owner:string,origin:string,sourceKey:string,now=Date.now()
):Promise<boolean>{
 const p=parseSendV2(raw);
 if(!p||!UUID.test(owner)||p.origin!==origin||!validKey(sourceKey))return false;
 const o=p.signedOffer;
 if(sourceKey!==o.publicKey||o.expiresAt*1000<=now+1000||o.expiresAt*1000>now+310000)return false;
 if(o.accountScope!==await accountScope(owner,origin))return false;
 return await signed(sourceKey,o.signature,[o.protocol,o.accountScope,o.publicKey,o.nonce,String(o.expiresAt)])&&
  await signed(sourceKey,p.dispatchSignature,
   [p.protocol,owner,origin,p.sourceDeviceId,p.targetDeviceId,o.accountScope,o.publicKey,o.nonce,String(o.expiresAt)]);
}
export function parseRecipientV2(value:unknown):RecipientV2|null{
 const p=obj(value);
 if(!exact(p,["protocol","origin","deviceId","action","requestId","nonce","expiresAt","signature"])||
  !p||p.protocol!==INBOX_RECEIVE_V2||!validQA(p.origin)||
  typeof p.deviceId!=="string"||!UUID.test(p.deviceId)||
  !["list","accept","reject"].includes(String(p.action))||
  typeof p.requestId!=="string"||!UUID.test(p.requestId)||
  (p.action==="list")!==(p.requestId===LIST_SENTINEL)||
  !validNonce(p.nonce)||!validSig(p.signature)||
  typeof p.expiresAt!=="number"||!Number.isSafeInteger(p.expiresAt))return null;
 return p as RecipientV2;
}
export async function verifyRecipientV2(
 raw:unknown,owner:string,origin:string,recipientKey:string,now=Date.now()
):Promise<boolean>{
 const p=parseRecipientV2(raw);
 if(!p||!UUID.test(owner)||p.origin!==origin||!validKey(recipientKey)||
   p.expiresAt*1000<=now+1000||p.expiresAt*1000>now+90000)return false;
 return signed(recipientKey,p.signature,
  [p.protocol,owner,origin,p.deviceId,p.action,p.requestId,p.nonce,String(p.expiresAt)]);
}
