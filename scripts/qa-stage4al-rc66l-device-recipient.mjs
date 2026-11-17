// KatoSync Stage4AL — private, test-only RC66L JWS device recipient.
// NO production Mesh socket, IPC, local-control dispatch or executable job.
// The trusted TLS session evidence must come from native live socket on deploy.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const NOTICE_TYP="katosync-rc66l-qa-mesh-device-revoke+jws";
export const DEVICE_TYP="katosync-rc66l-qa-device-persisted+jws";
export const DEVICE_KIND="RC66L_QA_DEVICE_PERSISTENCE_RECEIPT";
const NOTICE_KIND="RC66L_QA_PINNED_MESH_DEVICE_REVOKE";
const OUTBOX_TAG="KatoSync-Stage4AL-RC66L-durable-revoke-qa-v1\n";
const MARKER="rc66l-device-revoked.lock";
const SHA=x=>crypto.createHash("sha256").update(x).digest("hex");
const H=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KEY_ID=/^[a-zA-Z0-9_-]{8,80}$/;
const validUuid=x=>typeof x==="string"&&UUID.test(x);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const exact=(x,keys)=>obj(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const deny=code=>{throw Error("STAGE4AL_RECIPIENT_DENY_"+code);};
export const NOTICE_KEYS=["version","kind","auditId","workerId","leaseToken",
  "ownerId","tenantId","grantId","consentId","deviceId","clientId",
  "ownerSessionId","projectId","taskId","localDeviceKey","peerDeviceKey",
  "sequence","controlPlaneAckSha256","issuedAtMs","expiresAtMs"];
export const RECEIPT_KEYS=["version","kind","auditId","deviceId","taskId",
  "sequence","noticeSha256","persisted","issuedAtMs"];
export const TRUSTED_KEYS=["auditId","ownerId","tenantId","grantId","consentId",
  "deviceId","clientId","ownerSessionId","projectId","taskId",
  "localDeviceKey","peerDeviceKey","sequence","controlPlaneAckSha256"];
export const CHANNEL_KEYS=["tlsVersion","mutualPeerAuthorized","socketStillOpen",
  "ownerId","localDeviceKey","peerDeviceKey","tlsSessionNonceSha256",
  "lastHeartbeatAtMs","openedAtMs","deadlineMs"];

const decodeSegment=s=>{
  if(typeof s!=="string"||!/^[A-Za-z0-9_-]+$/.test(s))deny("BASE64");
  const out=Buffer.from(s,"base64url");
  if(out.toString("base64url")!==s)deny("CANONICAL_BASE64");
  return out;
};
function parsePinnedNotice(jws,pub,kid){
  if(typeof jws!=="string"||jws.length>4096||!KEY_ID.test(kid||"")||!pub)deny("PIN");
  const segments=jws.split(".");
  if(segments.length!==3)deny("JWS_PARTS");
  const [h,p,s]=segments;
  if(h.length>400||p.length>2700||s.length!==86)deny("JWS_SIZE");
  let header;
  try{header=JSON.parse(decodeSegment(h).toString("utf8"));}
  catch{deny("HEADER_JSON");}
  if(!exact(header,["alg","kid","typ"])||
    header.alg!=="EdDSA"||header.kid!==kid||header.typ!==NOTICE_TYP)
    deny("PROTECTED_HEADER");
  const signed=Buffer.from(h+"."+p);
  const sig=decodeSegment(s);
  if(sig.length!==64||!crypto.verify(null,signed,pub,sig))deny("SIGNATURE");
  let payload;
  const text=decodeSegment(p).toString("utf8");
  if(Buffer.byteLength(text)>2048)deny("PAYLOAD_SIZE");
  try{payload=JSON.parse(text);}catch{deny("PAYLOAD_JSON");}
  if(JSON.stringify(payload)!==text||!exact(payload,NOTICE_KEYS))deny("CANONICAL_FIELDS");
  return payload;
}
// Must be sourced independently from the current native authenticated channel,
// NOT constructed from the sender's JWS. The QA fixture supplies a synthetic
// sealed channel proof, which does NOT establish production socket validity.
function requireTrustedChannel(channel,expected,now){
  if(!exact(channel,CHANNEL_KEYS)||channel.tlsVersion!=="TLSv1.3"||
    channel.mutualPeerAuthorized!==true||channel.socketStillOpen!==true||
    channel.ownerId!==expected.ownerId||
    channel.localDeviceKey!==expected.localDeviceKey||
    channel.peerDeviceKey!==expected.peerDeviceKey||
    !H.test(channel.tlsSessionNonceSha256)||
    !Number.isSafeInteger(channel.lastHeartbeatAtMs)||
    !Number.isSafeInteger(channel.openedAtMs)||
    !Number.isSafeInteger(channel.deadlineMs)||
    channel.openedAtMs>now||channel.lastHeartbeatAtMs>now||
    now-channel.lastHeartbeatAtMs>5_000||
    channel.deadlineMs<=now||channel.deadlineMs-channel.openedAtMs>300_000)
    deny("UNTRUSTED_MESH_CHANNEL");
}
function requireManifest(expected,notice,now){
  if(!exact(expected,TRUSTED_KEYS)||!exact(notice,NOTICE_KEYS)||
    notice.version!==1||notice.kind!==NOTICE_KIND||
    !["auditId","ownerId","tenantId","grantId","consentId","deviceId",
      "clientId","ownerSessionId","projectId","taskId"].every(k=>validUuid(expected[k]))||
    !["workerId","leaseToken"].every(k=>validUuid(notice[k]))||
    !H.test(expected.localDeviceKey)||!H.test(expected.peerDeviceKey)||
    expected.localDeviceKey===expected.peerDeviceKey||
    !H.test(expected.controlPlaneAckSha256)||
    Object.keys(expected).some(k=>notice[k]!==expected[k])||
    !Number.isSafeInteger(notice.sequence)||notice.sequence<1||
    !Number.isSafeInteger(notice.issuedAtMs)||
    !Number.isSafeInteger(notice.expiresAtMs)||
    notice.issuedAtMs>now||notice.expiresAtMs<=now||
    now-notice.issuedAtMs>15_000||
    notice.expiresAtMs-notice.issuedAtMs!==15_000)
    deny("WRONG_SCOPE_OR_TIME");
}
function canonicalPrivateRoot(dir){
  const link=fs.lstatSync(dir);
  if(!link.isDirectory()||link.isSymbolicLink()||(link.mode&0o077)!==0)
    deny("UNSAFE_ROOT");
  const real=fs.realpathSync(dir);
  if(!real.startsWith("/private/tmp/katosync-stage4al-")&&
     !real.startsWith("/tmp/katosync-stage4al-"))deny("FIXTURE_ONLY");
  return real;
}
function persistOrReconfirm(dir,seq,noticeHash){
  const filename=path.join(dir,MARKER);
  const bytes=OUTBOX_TAG+seq+"\n"+noticeHash+"\n";
  let fd;
  try{
    fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|
      fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);
  }catch(e){
    if(e.code!=="EEXIST")deny("CREATE_FAILED");
    // A truncated, symlinked or changed marker is poison, never authorization.
    let st;
    try{st=fs.lstatSync(filename);}
    catch{deny("MARKER_IO");}
    if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0||
       st.size!==Buffer.byteLength(bytes)||
       fs.readFileSync(filename,"utf8")!==bytes)deny("CORRUPT_OR_NEW_SEQUENCE");
    return "already_persisted";
  }
  try{
    fs.writeFileSync(fd,bytes);
    fs.fsyncSync(fd);
  }catch{deny("FSYNC_FAILED");}
  finally{fs.closeSync(fd);}
  try{
    const d=fs.openSync(dir,"r");try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
  }catch{deny("DIR_SYNC_FAILED");}
  return "persisted";
}
export function startupQaState(dir){
  // Every restart begins CLOSED. No marker is not proof of authorization.
  let resolved;
  try{resolved=canonicalPrivateRoot(dir);}catch{return "REVOKED_OR_POISONED";}
  try{
    fs.lstatSync(path.join(resolved,MARKER));
    return "REVOKED_OR_POISONED";
  }catch(e){
    if(e.code==="ENOENT")return "CLOSED_PENDING_SERVER_RECONCILIATION";
    return "REVOKED_OR_POISONED";
  }
}
export function receivePinnedRc66lDeviceRevoke({
  signedNoticeJws,trustedScope,pinnedServerPublicKey,pinnedServerKid,
  independentTlsChannel,deviceSigningPrivateKey,deviceSigningKid,
  privateJournalDir,nowMs
}){
  if(!Number.isSafeInteger(nowMs)||!KEY_ID.test(deviceSigningKid||"")||
     !deviceSigningPrivateKey)deny("UNTRUSTED_RUNTIME");
  const notice=parsePinnedNotice(signedNoticeJws,pinnedServerPublicKey,pinnedServerKid);
  requireManifest(trustedScope,notice,nowMs);
  requireTrustedChannel(independentTlsChannel,trustedScope,nowMs);
  const dir=canonicalPrivateRoot(privateJournalDir);
  const noticeSha256=SHA(signedNoticeJws);
  const result=persistOrReconfirm(dir,notice.sequence,noticeSha256);
  const receipt={version:1,kind:DEVICE_KIND,auditId:notice.auditId,
    deviceId:notice.deviceId,taskId:notice.taskId,sequence:notice.sequence,
    noticeSha256,persisted:true,issuedAtMs:nowMs};
  const header={alg:"EdDSA",kid:deviceSigningKid,typ:DEVICE_TYP};
  const unsigned=Buffer.from(JSON.stringify(header)).toString("base64url")+"."+
    Buffer.from(JSON.stringify(receipt)).toString("base64url");
  const signature=crypto.sign(null,Buffer.from(unsigned),deviceSigningPrivateKey)
    .toString("base64url");
  return Object.freeze({
    status:result,
    jws:unsigned+"."+signature,
    meshState:"REVOKED_QA_ONLY",
    remoteExecutionAllowed:false,
    deviceAccessEnabled:false
  });
}
