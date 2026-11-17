import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {
  NOTICE_TYP,DEVICE_TYP,DEVICE_KIND,NOTICE_KEYS,TRUSTED_KEYS,RECEIPT_KEYS,
  receivePinnedRc66lDeviceRevoke,startupQaState
} from "../scripts/qa-stage4al-rc66l-device-recipient.mjs";
const NOW=1_800_000_000_000;
const UUID=()=>crypto.randomUUID();
const SHA=x=>crypto.createHash("sha256").update(x).digest("hex");
const server=crypto.generateKeyPairSync("ed25519");
const device=crypto.generateKeyPairSync("ed25519");
const sid="rc66l_server_issuer_QA",did="rc66l_recipient_M3_QA";
const trust={
  auditId:UUID(),ownerId:UUID(),tenantId:UUID(),grantId:UUID(),
  consentId:UUID(),deviceId:UUID(),clientId:UUID(),ownerSessionId:UUID(),
  projectId:UUID(),taskId:UUID(),localDeviceKey:SHA("recipient-ed25519"),
  peerDeviceKey:SHA("source-peer-ed25519"),sequence:12,
  controlPlaneAckSha256:SHA("synthetic-rc66k-ack-QA-not-a-production-receipt")
};
assert.deepEqual(Object.keys(trust).sort(),[...TRUSTED_KEYS].sort());
const notice={
  version:1,kind:"RC66L_QA_PINNED_MESH_DEVICE_REVOKE",
  auditId:trust.auditId,workerId:UUID(),leaseToken:UUID(),
  ownerId:trust.ownerId,tenantId:trust.tenantId,grantId:trust.grantId,
  consentId:trust.consentId,deviceId:trust.deviceId,clientId:trust.clientId,
  ownerSessionId:trust.ownerSessionId,projectId:trust.projectId,
  taskId:trust.taskId,localDeviceKey:trust.localDeviceKey,
  peerDeviceKey:trust.peerDeviceKey,sequence:trust.sequence,
  controlPlaneAckSha256:trust.controlPlaneAckSha256,
  issuedAtMs:NOW-100,expiresAtMs:NOW+14_900
};
assert.deepEqual(Object.keys(notice).sort(),[...NOTICE_KEYS].sort());
const channel={
  tlsVersion:"TLSv1.3",mutualPeerAuthorized:true,socketStillOpen:true,
  ownerId:trust.ownerId,localDeviceKey:trust.localDeviceKey,
  peerDeviceKey:trust.peerDeviceKey,
  tlsSessionNonceSha256:SHA("TEST_ONLY_SEALED_MESH_CHANNEL"),
  lastHeartbeatAtMs:NOW-250,openedAtMs:NOW-1200,deadlineMs:NOW+12000
};
function signed(fields=notice,priv=server.privateKey,kid=sid){
  const h=Buffer.from(JSON.stringify({alg:"EdDSA",typ:NOTICE_TYP,kid})).toString("base64url");
  const p=Buffer.from(JSON.stringify(fields)).toString("base64url");
  const input=h+"."+p;
  return input+"."+crypto.sign(null,Buffer.from(input),priv).toString("base64url");
}
const expectedJws=signed();
const tmp=()=>{const d=fs.mkdtempSync(path.join("/tmp","katosync-stage4al-"));
  fs.chmodSync(d,0o700);return d;};
const rm=d=>fs.rmSync(d,{recursive:true,force:true});
const arg=(dir,extra={})=>({
  signedNoticeJws:expectedJws,trustedScope:trust,
  pinnedServerPublicKey:server.publicKey,pinnedServerKid:sid,
  independentTlsChannel:channel,deviceSigningPrivateKey:device.privateKey,
  deviceSigningKid:did,privateJournalDir:dir,nowMs:NOW,...extra
});
function verifyReceipt(jws){
  const seg=jws.split(".");
  assert.equal(seg.length,3);
  const head=JSON.parse(Buffer.from(seg[0],"base64url").toString());
  const r=JSON.parse(Buffer.from(seg[1],"base64url").toString());
  assert.equal(crypto.verify(null,Buffer.from(seg[0]+"."+seg[1]),
    device.publicKey,Buffer.from(seg[2],"base64url")),true);
  assert.equal(head.typ,DEVICE_TYP);
  assert.equal(r.kind,DEVICE_KIND);
  assert.deepEqual(Object.keys(r).sort(),[...RECEIPT_KEYS].sort());
  assert.equal(r.noticeSha256,SHA(expectedJws));
  assert.equal(r.persisted,true);
  return r;
}
const denied=fn=>assert.throws(fn,/STAGE4AL_RECIPIENT_DENY_/);

test("pinned Ed25519 JWS on synthetic Mesh channel persists before signed receipt",()=>{
  const d=tmp();
  try{
    assert.equal(startupQaState(d),"CLOSED_PENDING_SERVER_RECONCILIATION");
    const result=receivePinnedRc66lDeviceRevoke(arg(d));
    assert.equal(result.status,"persisted");
    assert.equal(result.meshState,"REVOKED_QA_ONLY");
    assert.equal(result.remoteExecutionAllowed,false);
    const r=verifyReceipt(result.jws);
    assert.equal(r.taskId,trust.taskId);
    assert.equal(r.sequence,12);
    const f=path.join(d,"rc66l-device-revoked.lock");
    assert.equal(fs.statSync(f).mode&0o777,0o600);
    assert.equal(startupQaState(d),"REVOKED_OR_POISONED");
  }finally{rm(d);}
});
test("authenticated channel is mandatory, not merely a valid server notice",()=>{
  const d=tmp();
  try{
    for(const changes of [
      {socketStillOpen:false},{mutualPeerAuthorized:false},
      {tlsVersion:"TLSv1.2"},{ownerId:UUID()},
      {peerDeviceKey:SHA("foreign-key")},
      {tlsSessionNonceSha256:""},
      {lastHeartbeatAtMs:NOW-6000},{deadlineMs:NOW}
    ]){
      denied(()=>receivePinnedRc66lDeviceRevoke(arg(d,
        {independentTlsChannel:{...channel,...changes}})));
      assert.equal(startupQaState(d),"CLOSED_PENDING_SERVER_RECONCILIATION");
    }
  }finally{rm(d);}
});
test("forged server key, key id, consent, task, session and RC66K digest fail closed",()=>{
  const d=tmp();
  try{
    const foreign=crypto.generateKeyPairSync("ed25519");
    for(const extra of [
      {signedNoticeJws:signed(notice,foreign.privateKey)},
      {pinnedServerPublicKey:foreign.publicKey},
      {pinnedServerKid:"badSigner_QA"},
      {trustedScope:{...trust,consentId:UUID()}},
      {trustedScope:{...trust,taskId:UUID()}},
      {trustedScope:{...trust,ownerSessionId:UUID()}},
      {trustedScope:{...trust,controlPlaneAckSha256:SHA("wrong")}},
      {signedNoticeJws:signed({...notice,issuedAtMs:NOW-20_000,expiresAtMs:NOW-5_000})}
    ]){
      denied(()=>receivePinnedRc66lDeviceRevoke(arg(d,extra)));
      assert.equal(startupQaState(d),"CLOSED_PENDING_SERVER_RECONCILIATION");
    }
  }finally{rm(d);}
});
test("duplicate delivery of byte-exact signed event returns idempotent signed receipt",()=>{
  const d=tmp();
  try{
    const first=receivePinnedRc66lDeviceRevoke(arg(d));
    const second=receivePinnedRc66lDeviceRevoke(arg(d));
    assert.equal(second.status,"already_persisted");
    assert.equal(first.jws,second.jws);
    verifyReceipt(second.jws);
    assert.equal(startupQaState(d),"REVOKED_OR_POISONED");
  }finally{rm(d);}
});
test("sequence change after revocation is denied, not silently reopened",()=>{
  const d=tmp();
  try{
    receivePinnedRc66lDeviceRevoke(arg(d));
    const alt={...notice,sequence:13};
    const altered={...trust,sequence:13};
    denied(()=>receivePinnedRc66lDeviceRevoke(arg(d,
      {signedNoticeJws:signed(alt),trustedScope:altered})));
    assert.equal(startupQaState(d),"REVOKED_OR_POISONED");
  }finally{rm(d);}
});
test("torn or symlinked durable markers poison device state",()=>{
  const d=tmp();
  try{
    const mark=path.join(d,"rc66l-device-revoked.lock");
    fs.writeFileSync(mark,"partial",{mode:0o600});
    assert.equal(startupQaState(d),"REVOKED_OR_POISONED");
    denied(()=>receivePinnedRc66lDeviceRevoke(arg(d)));
    fs.rmSync(mark);
    if(process.platform!=="win32"){
      fs.symlinkSync("missing",mark);
      assert.equal(startupQaState(d),"REVOKED_OR_POISONED");
      denied(()=>receivePinnedRc66lDeviceRevoke(arg(d)));
    }
  }finally{rm(d);}
});
test("world-readable QA journal root is refused; no reauthorization on startup",()=>{
  const d=tmp();
  try{
    fs.chmodSync(d,0o755);
    assert.equal(startupQaState(d),"REVOKED_OR_POISONED");
    denied(()=>receivePinnedRc66lDeviceRevoke(arg(d)));
    assert.equal(fs.existsSync(path.join(d,"rc66l-device-revoked.lock")),false);
  }finally{rm(d);}
});
test("no network listener, agent OS command or production consent bypass introduced",()=>{
  const s=fs.readFileSync(new URL("../scripts/qa-stage4al-rc66l-device-recipient.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(s,/TcpListener|createServer\(|fetch\(|reqwest|child_process|spawn\(|execSync|git push|git reset|remoteExecutionAllowed:true/);
  assert.match(s,/mutualPeerAuthorized/);
  assert.match(s,/socketStillOpen/);
  assert.match(s,/CLOSED_PENDING_SERVER_RECONCILIATION/);
});
test("RC66L server can independently verify actual KatoSync device-signed JWS",{
  skip:!process.env.RC66L_REMOTE_QA_REPO
},async()=>{
  const d=tmp();
  try{
    const repo=process.env.RC66L_REMOTE_QA_REPO;
    const mod=await import(pathToFileURL(path.join(repo,
      "src/auth/rc66l-private-device-receipt-barrier.mjs")).href);
    const result=receivePinnedRc66lDeviceRevoke(arg(d));
    const signed=await mod.verifyPinnedRc66lDeviceReceipt({
      jws:result.jws,notice:{
        auditId:notice.auditId,deviceId:notice.deviceId,
        taskId:notice.taskId,sequence:notice.sequence,
        noticeSha256:SHA(expectedJws),issuedAtMs:notice.issuedAtMs
      },
      pinnedDeviceKey:device.publicKey,pinnedDeviceKid:did,now:NOW
    });
    assert.equal(signed.persisted,true);
    assert.equal(signed.taskId,notice.taskId);
  }finally{rm(d);}
});
