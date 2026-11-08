// Created by NMKato Solutions
// Transport-UNTRUSTED Realtime signaling. Never treat this as peer approval.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL=/^[A-Za-z0-9_-]{43}$/;
const FORBIDDEN=new Set(["accesstoken","refreshtoken","password","privatekey","seed","sessiontoken","secret","authorization","paired","trusted","remotejobsenabled","transportready"]);
export type MeshSignalKind="offer"|"challenge"|"response";
export type MeshSignalEnvelope={
  protocol:"katosync-mesh-signal-v1";
  kind:MeshSignalKind;
  ownerId:string;
  senderDeviceId:string;
  targetDeviceId:string;
  sentAt:number;
  expiresAt:number;
  signedMessage:Record<string,unknown>;
};
export function meshOwnerTopic(ownerId:string):string|null{
  return UUID.test(ownerId)?"katosync-mesh-owner:v1:"+ownerId:null;
}
function hasSecretField(v:unknown,depth=0):boolean{
  if(depth>6)return true;
  if(!v||typeof v!=="object")return false;
  if(Array.isArray(v))return v.some(x=>hasSecretField(x,depth+1));
  return Object.entries(v).some(([k,value])=>
    FORBIDDEN.has(k.replace(/[_-]/g,"").toLowerCase())||
    hasSecretField(value,depth+1)
  );
}
const SIGNATURE=/^[A-Za-z0-9_-]{86}$/;
const fields=(v:Record<string,unknown>,names:string)=>
  Object.keys(v).sort().join(",")===names;
function validOffer(x:Record<string,unknown>):boolean{
  return fields(x,"accountScope,expiresAt,nonce,protocol,publicKey,signature")&&
    x.protocol==="katosync-mesh-pairing-v1"&&
    BASE64URL.test(x.publicKey as string)&&BASE64URL.test(x.nonce as string)&&
    BASE64URL.test(x.accountScope as string)&&
    SIGNATURE.test(x.signature as string)&&Number.isInteger(x.expiresAt);
}
function validChallenge(x:Record<string,unknown>):boolean{
  if(!fields(x,"expiresAt,offer,protocol,responderNonce,responderPublicKey,signature")||
     x.protocol!=="katosync-mesh-challenge-v1"||
     !BASE64URL.test(x.responderNonce as string)||
     !BASE64URL.test(x.responderPublicKey as string)||
     !SIGNATURE.test(x.signature as string)||!Number.isInteger(x.expiresAt)||
     !x.offer||typeof x.offer!=="object"||Array.isArray(x.offer))return false;
  const offer=x.offer as Record<string,unknown>;
  return validOffer(offer)&&(x.expiresAt as number)<=(offer.expiresAt as number);
}
function validResponse(x:Record<string,unknown>):boolean{
  if(!fields(x,"challenge,protocol,signature")||
     x.protocol!=="katosync-mesh-response-v1"||
     !SIGNATURE.test(x.signature as string)||!x.challenge||
     typeof x.challenge!=="object"||Array.isArray(x.challenge))return false;
  return validChallenge(x.challenge as Record<string,unknown>);
}
export function parseMeshSignalEnvelope(
  raw:unknown, ownerId:string, localDeviceId:string, nowSeconds:number
):MeshSignalEnvelope|null{
  if(!UUID.test(ownerId)||!UUID.test(localDeviceId)||!Number.isInteger(nowSeconds))return null;
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
  const x=raw as Record<string,unknown>;
  if(Object.keys(x).sort().join(",")!==
    "expiresAt,kind,ownerId,protocol,senderDeviceId,sentAt,signedMessage,targetDeviceId")return null;
  if(x.protocol!=="katosync-mesh-signal-v1"||!["offer","challenge","response"].includes(x.kind as string)||
    x.ownerId!==ownerId||!UUID.test(x.senderDeviceId as string)||
    x.senderDeviceId===localDeviceId||x.targetDeviceId!==localDeviceId)return null;
  if(!Number.isInteger(x.sentAt)||!Number.isInteger(x.expiresAt))return null;
  const sent=x.sentAt as number,expires=x.expiresAt as number;
  if(sent>nowSeconds+10||sent<nowSeconds-310||expires<=nowSeconds||
    expires>sent+300||expires<=sent)return null;
  if(!x.signedMessage||typeof x.signedMessage!=="object"||
    Array.isArray(x.signedMessage)||hasSecretField(x.signedMessage))return null;
  const data=x.signedMessage as Record<string,unknown>;
  const required={
    offer:"katosync-mesh-pairing-v1",
    challenge:"katosync-mesh-challenge-v1",
    response:"katosync-mesh-response-v1"
  } as const;
  if(data.protocol!==required[x.kind as MeshSignalKind])return null;
  if(x.kind==="offer"&&(!validOffer(data)||data.expiresAt!==expires))return null;
  if(x.kind==="challenge"&&(!validChallenge(data)||data.expiresAt!==expires))return null;
  if(x.kind==="response"&&(
    !validResponse(data)||
    (data.challenge as Record<string,unknown>).expiresAt!==expires))return null;
  try{
    if(JSON.stringify(x).length>8192)return null;
  }catch{return null;}
  return x as MeshSignalEnvelope;
}
