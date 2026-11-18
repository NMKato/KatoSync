import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {DOMAIN_NOTICE,makeSigned,bodyFor,SCOPE} from "../scripts/qa-stage4aj-physical-revoke.mjs";
import {verifyPinnedRc66kControlAck,receiveSignedRc66kBoundRevoke,validateSignedDeviceReply}
  from "../scripts/qa-stage4ak-rc66k-mesh-bridge.mjs";

const NOW=1_800_000_000_000;
const key=()=>crypto.generateKeyPairSync("ed25519");
const priv=k=>k.privateKey.export({format:"pem",type:"pkcs8"});
const pub=k=>k.publicKey.export({format:"pem",type:"spki"});
const ackSigner=key(),noticeSigner=key(),deviceSigner=key();
const uuid=()=>crypto.randomUUID();
const sha=s=>crypto.createHash("sha256").update(s).digest("hex");
const b64=s=>Buffer.from(s).toString("base64url");
const claim={
  auditId:uuid(),leaseToken:uuid(),workerId:uuid(),ownerId:uuid(),
  grantId:uuid(),deviceId:uuid(),consentId:uuid(),
  action:"revoke_device",leasedUntilMs:NOW+25_000,attempt:1,
};
const claimPayload=(extra={})=>({
  version:1,kind:"RC66K_CONTROL_PLANE_QA_ACK",
  controlPlaneInvalidated:true,receivingSystem:"synthetic-control-plane",
  auditId:claim.auditId,leaseToken:claim.leaseToken,workerId:claim.workerId,
  ownerId:claim.ownerId,grantId:claim.grantId,deviceId:claim.deviceId,
  consentId:claim.consentId,action:claim.action,issuedAtMs:NOW-100,
  expiresAtMs:NOW+29_900,...extra
});
function envelope(payload=claimPayload(),signer=ackSigner,kid="pinnedQA_Server1"){
  const text=JSON.stringify(payload);
  const h=b64(JSON.stringify({alg:"EdDSA",typ:"katosync-rc66k-qa-invalidate-ack+jws",kid}));
  const s=b64(text), unsigned=h+"."+s;
  return {payloadText:text,sha256:sha(text),
    jws:unsigned+"."+crypto.sign(null,Buffer.from(unsigned),priv(signer)).toString("base64url")};
}
const ack=envelope();
const manifest={
  auditId:claim.auditId,ownerId:claim.ownerId,tenantId:uuid(),
  grantId:claim.grantId,consentId:claim.consentId,
  clientId:uuid(),ownerSessionId:uuid(),projectId:uuid(),taskId:uuid(),
  localDeviceKey:sha("pinned-local-device"),
  peerDeviceKey:sha("pinned-peer-device"),
  recipientDeviceId:claim.deviceId,sequence:5,rc66kAckSha256:ack.sha256
};
assert.deepEqual(Object.keys(manifest).sort(),[...SCOPE].sort());
const pinned=Object.freeze({...manifest});
const notice=()=>makeSigned(DOMAIN_NOTICE,bodyFor(manifest,NOW),priv(noticeSigner));
const args=(dir,overrides={})=>({
  claim,envelope:ack,pinnedAckKey:pub(ackSigner),
  pinnedKid:"pinnedQA_Server1",notice:notice(),manifest,
  trustedScope:pinned,pinnedNoticeIssuer:pub(noticeSigner),
  devicePrivateKey:priv(deviceSigner),privateJournalDir:dir,nowMs:NOW,
  ...overrides
});
const dir=()=>fs.mkdtempSync(path.join(os.tmpdir(),"katosync-stage4ak-"));
const cleanup=p=>fs.rmSync(p,{recursive:true,force:true});

test("pinned RC66K compact-JWS checks real Ed25519 and exact outbox claim",()=>{
  const proof=verifyPinnedRc66kControlAck(args("/tmp"));
  assert.equal(proof.signedAckSha256,ack.sha256);
  assert.equal(proof.deviceId,claim.deviceId);
  assert.equal(proof.remoteExecutionAllowed,false);
  assert.equal(proof.productionDeliveryConfirmed,false);
});
test("independent issuer signature + RC66K SHA + pinned Mesh scope precede durable device ACK",()=>{
  const d=dir();
  try{
    const result=receiveSignedRc66kBoundRevoke(args(d));
    assert.equal(result.status,"revoked_persisted");
    assert.equal(result.controlPlaneAckVerified,true);
    assert.equal(result.deviceMarkerPersisted,true);
    assert.equal(result.remoteExecutionAllowed,false);
    assert.equal(result.canonicalMeshState,"REVOKE_REQUIRED_NOT_RUNTIME_CONNECTED");
    assert.ok(fs.existsSync(path.join(d,"revoked.lock")));
    const receipt=validateSignedDeviceReply(result,manifest,pub(deviceSigner),notice());
    assert.equal(receipt.taskId,manifest.taskId);
    assert.equal(receipt.noticeSha256,sha(notice().payloadText));
    const replay=receiveSignedRc66kBoundRevoke(args(d));
    assert.equal(replay.status,"replay_denied");
    assert.equal(replay.deviceMarkerPersisted,false);
    assert.equal(validateSignedDeviceReply(replay,manifest,pub(deviceSigner),notice()).status,"replay_denied");
  }finally{cleanup(d);}
});
test("RC66K wrong key, kid, grant, owner or synthetic approve ACK cannot revoke local journal",()=>{
  const d=dir();
  try{
    const badcases=[
      {pinnedAckKey:pub(key())},
      {pinnedKid:"wrongPin01"},
      {envelope:envelope(claimPayload({grantId:uuid()}))},
      {envelope:envelope(claimPayload({ownerId:uuid()}))},
      {envelope:envelope(claimPayload({action:"approve_device"}))},
      {claim:{...claim,action:"approve_device"}},
      {claim:{...claim,leasedUntilMs:NOW-1}},
      {claim:{...claim,attempt:21}}
    ];
    for(const extra of badcases){
      assert.throws(()=>receiveSignedRc66kBoundRevoke(args(d,extra)),/STAGE4AK_DENY_/);
      assert.equal(fs.existsSync(path.join(d,"revoked.lock")),false);
    }
  }finally{cleanup(d);}
});
test("wrong local trusted task, session, tenant, consent, peer or device blocks before write",()=>{
  const d=dir();
  try{
    for(const field of ["ownerId","tenantId","grantId","consentId","clientId",
      "ownerSessionId","projectId","taskId","recipientDeviceId","localDeviceKey",
      "peerDeviceKey","sequence","auditId","rc66kAckSha256"]){
      const falseScope={...pinned,[field]:field==="sequence"?99:"mismatch"};
      assert.throws(
        ()=>receiveSignedRc66kBoundRevoke(args(d,{trustedScope:falseScope})),
        /STAGE4AK_DENY_MESH_SCOPE/
      );
      assert.equal(fs.existsSync(path.join(d,"revoked.lock")),false);
    }
  }finally{cleanup(d);}
});
test("tampered or foreign task-scoped issuer notice never persists revoke",()=>{
  const d=dir();
  try{
    assert.throws(()=>receiveSignedRc66kBoundRevoke(args(d,{pinnedNoticeIssuer:pub(key())})),/STAGE4AJ_DENY_/);
    const foreign=makeSigned(DOMAIN_NOTICE,bodyFor({...manifest,taskId:uuid()},NOW),priv(noticeSigner));
    assert.throws(()=>receiveSignedRc66kBoundRevoke(args(d,{notice:foreign})),/STAGE4AJ_DENY_SCOPE_taskId/);
    assert.equal(fs.existsSync(path.join(d,"revoked.lock")),false);
  }finally{cleanup(d);}
});
test("expired server receipt and malformed or forged JWS cannot poison recipient",()=>{
  const d=dir();
  try{
    const foreign=envelope(claimPayload(),key());
    const wrongPayload=envelope(claimPayload({issuedAtMs:NOW-40_000,expiresAtMs:NOW-10_000}));
    for(const extra of [
      {envelope:foreign},
      {envelope:wrongPayload},
      {envelope:{...ack,sha256:"0".repeat(64)}},
      {envelope:{...ack,jws:ack.jws+"."}},
      {envelope:{...ack,payloadText:ack.payloadText+" "}}
    ]){
      assert.throws(()=>receiveSignedRc66kBoundRevoke(args(d,extra)),/STAGE4AK_DENY_/);
      assert.equal(fs.existsSync(path.join(d,"revoked.lock")),false);
    }
  }finally{cleanup(d);}
});
test("forged device receipt or altered digest is rejected, with no remote execution",()=>{
  const d=dir();
  try{
    const result=receiveSignedRc66kBoundRevoke(args(d));
    assert.throws(()=>validateSignedDeviceReply(result,manifest,pub(key()),notice()),/STAGE4AJ_DENY_BAD_SIGNATURE/);
    const fake={...result,remoteExecutionAllowed:true};
    assert.throws(()=>validateSignedDeviceReply(fake,manifest,pub(deviceSigner),notice()),/STAGE4AK_DENY_INVALID_REPLY/);
    const otherNotice=makeSigned(DOMAIN_NOTICE,bodyFor(manifest,NOW+1),priv(noticeSigner));
    assert.throws(()=>validateSignedDeviceReply(result,manifest,pub(deviceSigner),otherNotice),/STAGE4AJ_DENY_ACK_BINDING/);
  }finally{cleanup(d);}
});
test("no production MCP, OS shell commands, Cloudflare or Supabase binding in QA bridge",()=>{
  const source=fs.readFileSync(new URL("../scripts/qa-stage4ak-rc66k-mesh-bridge.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(source,/child_process|execSync|spawn\(|supabase\.from|fetch\(|TcpListener|git push|git reset/);
  assert.match(source,/remoteExecutionAllowed:false/);
  assert.match(source,/REVOKE_REQUIRED_NOT_RUNTIME_CONNECTED/);
});
