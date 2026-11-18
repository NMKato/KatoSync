// KatoSync Stage4AK — source-only, non-routable RC66K → device-revoke QA bridge.
// A signed RC66K control-plane ACK is NOT device delivery or execution authority.
// A separate pinned task-scoped signature and actual device persistence are mandatory.
import crypto from "node:crypto";
import {
  DOMAIN_NOTICE, DOMAIN_ACK, SCOPE, makeSigned, verifyRevoke,
  verifyDeviceReceipt, persistRevocation
} from "./qa-stage4aj-physical-revoke.mjs";

const ACK_TYP="katosync-rc66k-qa-invalidate-ack+jws";
const ACK_KIND="RC66K_CONTROL_PLANE_QA_ACK";
const err=(code)=>{throw new Error("STAGE4AK_DENY_"+code);};
const sha=(data)=>crypto.createHash("sha256").update(data).digest("hex");
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isObj=(x)=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const exact=(obj,fields)=>isObj(obj)&&Object.keys(obj).length===fields.length&&fields.every(s=>Object.hasOwn(obj,s));
const fields=["auditId","leaseToken","workerId","ownerId","grantId","deviceId","consentId","action","version","kind","controlPlaneInvalidated","receivingSystem","issuedAtMs","expiresAtMs"];
const claimFields=["auditId","leaseToken","workerId","ownerId","grantId","deviceId","consentId","action","leasedUntilMs","attempt"];
const validB64url=(s)=>typeof s==="string"&&/^[A-Za-z0-9_-]+$/.test(s);
const decode=(s)=>{if(!validB64url(s))err("BASE64");const b=Buffer.from(s,"base64url");if(b.toString("base64url")!==s)err("BASE64_CANONICAL");return b;};

export function verifyPinnedRc66kControlAck({claim,envelope,pinnedAckKey,pinnedKid,nowMs}){
  if(!exact(claim,claimFields)||!exact(envelope,["payloadText","jws","sha256"])||
     !["revoke_device"].includes(claim.action)||!Number.isSafeInteger(claim.attempt)||
     claim.attempt<1||claim.attempt>20||
     !Number.isSafeInteger(claim.leasedUntilMs)||claim.leasedUntilMs<=nowMs||
     !["auditId","leaseToken","workerId","ownerId","grantId","deviceId","consentId"].every(k=>uuid.test(claim[k]))||
     typeof pinnedKid!=="string"||!/^[A-Za-z0-9_-]{8,80}$/.test(pinnedKid)||
     typeof envelope.payloadText!=="string"||envelope.payloadText.length>2048||
     !/^[a-f0-9]{64}$/.test(envelope.sha256)||sha(envelope.payloadText)!==envelope.sha256||
     typeof envelope.jws!=="string"||envelope.jws.length>4096
  )err("CLAIM_OR_HASH");
  const parts=envelope.jws.split(".");
  if(parts.length!==3)err("JWS_SEGMENTS");
  const [head,payload,sig]=parts;
  const rawHeader=decode(head);
  if(rawHeader.length>300)err("HEADER_SIZE");
  let protectedHeader;
  try{protectedHeader=JSON.parse(rawHeader.toString("utf8"));}catch{err("HEADER_JSON");}
  if(!exact(protectedHeader,["alg","kid","typ"])||
    protectedHeader.alg!=="EdDSA"||protectedHeader.kid!==pinnedKid||
    protectedHeader.typ!==ACK_TYP)err("HEADER_PIN");
  if(decode(payload).toString("utf8")!==envelope.payloadText)err("PAYLOAD_BYTES");
  const signedInput=Buffer.from(head+"."+payload);
  const sigBytes=decode(sig);
  if(sigBytes.length!==64||!crypto.verify(null,signedInput,pinnedAckKey,sigBytes))
    err("ACK_SIGNATURE");
  let ack;
  try{ack=JSON.parse(envelope.payloadText);}catch{err("ACK_JSON");}
  if(!exact(ack,fields)||
     ack.version!==1||ack.kind!==ACK_KIND||ack.controlPlaneInvalidated!==true||
     ack.receivingSystem!=="synthetic-control-plane"||
     ["auditId","leaseToken","workerId","ownerId","grantId","deviceId","consentId","action"]
       .some(k=>ack[k]!==claim[k])||
     !Number.isSafeInteger(ack.issuedAtMs)||!Number.isSafeInteger(ack.expiresAtMs)||
     ack.issuedAtMs>nowMs||ack.expiresAtMs<=nowMs||
     ack.expiresAtMs-ack.issuedAtMs!==30_000)err("ACK_SCOPE_OR_TIME");
  return Object.freeze({
    auditId:ack.auditId,ownerId:ack.ownerId,grantId:ack.grantId,
    consentId:ack.consentId,deviceId:ack.deviceId,
    signedAckSha256:envelope.sha256,
    // Strictly no device-ACK, Mesh permission or execution capability.
    productionDeliveryConfirmed:false,remoteExecutionAllowed:false
  });
}
const trustedFields=["ownerId","tenantId","grantId","consentId","clientId",
  "ownerSessionId","projectId","taskId","recipientDeviceId",
  "localDeviceKey","peerDeviceKey","sequence","rc66kAckSha256","auditId"];
// A stable record from a trusted LOCAL Mesh project/device registry, not the
// incoming network packet or model text, is required for exact scope matching.
function checkPinnedMeshScope({manifest,trustedScope,receipt}){
  if(!exact(manifest,SCOPE)||!exact(trustedScope,trustedFields)||
     trustedFields.some(k=>manifest[k]!==trustedScope[k])||
     !Number.isSafeInteger(trustedScope.sequence)||trustedScope.sequence<1||
     !/^[a-f0-9]{64}$/.test(trustedScope.localDeviceKey)||
     !/^[a-f0-9]{64}$/.test(trustedScope.peerDeviceKey)||
     !uuid.test(trustedScope.ownerId)||!uuid.test(trustedScope.recipientDeviceId)||
     !uuid.test(trustedScope.grantId)||!uuid.test(trustedScope.consentId)||
     trustedScope.auditId!==receipt.auditId||trustedScope.ownerId!==receipt.ownerId||
     trustedScope.grantId!==receipt.grantId||
     trustedScope.consentId!==receipt.consentId||
     trustedScope.recipientDeviceId!==receipt.deviceId||
     trustedScope.rc66kAckSha256!==receipt.signedAckSha256)err("MESH_SCOPE");
}
// Atomicity limitation: no production server lease or app-level lock exists.
// The isolated QA journal is irrevocable. Production needs an ordered, durable
// device ledger and authoritative reconciliation before reopening a lease.
export function receiveSignedRc66kBoundRevoke({
  claim,envelope,pinnedAckKey,pinnedKid,
  notice,manifest,trustedScope,pinnedNoticeIssuer,devicePrivateKey,
  privateJournalDir,nowMs
}){
  const ack=verifyPinnedRc66kControlAck({
    claim,envelope,pinnedAckKey,pinnedKid,nowMs
  });
  checkPinnedMeshScope({manifest,trustedScope,receipt:ack});
  const verifiedNotice=verifyRevoke(notice,manifest,pinnedNoticeIssuer,nowMs);
  const status=persistRevocation(privateJournalDir,verifiedNotice);
  if(status!=="revoked_persisted"&&status!=="replay_denied")
     err("DURABLE_MARKER");
  const receiptBody={
    kind:"STAGE4AJ_QA_DEVICE_ACK",version:1,status,
    auditId:verifiedNotice.auditId,taskId:verifiedNotice.taskId,
    sequence:verifiedNotice.sequence,
    recipientDeviceId:verifiedNotice.recipientDeviceId,
    noticeSha256:sha(notice.payloadText)
  };
  return Object.freeze({
    status,
    signedDeviceReceipt:makeSigned(DOMAIN_ACK,receiptBody,devicePrivateKey),
    canonicalMeshState:"REVOKE_REQUIRED_NOT_RUNTIME_CONNECTED",
    remoteExecutionAllowed:false,deviceAccessEnabled:false,
    controlPlaneAckVerified:true,deviceMarkerPersisted:status==="revoked_persisted"
  });
}
export function validateSignedDeviceReply(result,manifest,pinnedDeviceKey,notice){
  if(!result||!["revoked_persisted","replay_denied"].includes(result.status)||
     result.remoteExecutionAllowed!==false)err("INVALID_REPLY");
  return verifyDeviceReceipt(
    result.signedDeviceReceipt,manifest,pinnedDeviceKey,
    sha(notice.payloadText),result.status
  );
}
