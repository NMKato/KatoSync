import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  DOMAIN_NOTICE, DOMAIN_ACK, SCOPE, bodyFor,makeSigned,verifyRevoke,
  verifyDeviceReceipt,persistRevocation,
} from "../scripts/qa-stage4aj-physical-revoke.mjs";
const now=1_800_000_000_000;
const kp=()=>crypto.generateKeyPairSync("ed25519");
const pemPrivate=k=>k.privateKey.export({format:"pem",type:"pkcs8"});
const pemPublic=k=>k.publicKey.export({format:"pem",type:"spki"});
const manifest=Object.fromEntries(SCOPE.map((s,i)=>[s,
  s==="sequence"?1:s==="rc66kAckSha256"?"a".repeat(64):
  "QA-"+s+"-"+i]));
const issuer=kp(),device=kp();
const notice=()=>makeSigned(DOMAIN_NOTICE,bodyFor(manifest,now),pemPrivate(issuer));
const sha=s=>crypto.createHash("sha256").update(s).digest("hex");
function receipt(frame,status="revoked_persisted"){
  return makeSigned(DOMAIN_ACK,{
    kind:"STAGE4AJ_QA_DEVICE_ACK",version:1,status,
    auditId:manifest.auditId,taskId:manifest.taskId,sequence:manifest.sequence,
    recipientDeviceId:manifest.recipientDeviceId,
    noticeSha256:sha(frame.payloadText)},pemPrivate(device));
}
test("Stage4AJ issuer-signed event binds full task, owner, device and RC66K correlation",()=>{
  const n=verifyRevoke(notice(),manifest,pemPublic(issuer),now);
  assert.equal(n.ownerSessionId,manifest.ownerSessionId);
  assert.equal(n.peerDeviceKey,manifest.peerDeviceKey);
  assert.equal(n.rc66kAckSha256,manifest.rc66kAckSha256);
  assert.equal(n.sequence,1);
  assert.equal(n.kind,"STAGE4AJ_QA_DEVICE_REVOKE");
});
test("forged signature, wrong pinned key and task/consent/device tamper are denied",()=>{
  const n=notice();
  const wrong=kp();
  assert.throws(()=>verifyRevoke(n,manifest,pemPublic(wrong),now),/DENY_BAD_SIGNATURE/);
  const forged={...n,signature:makeSigned(DOMAIN_NOTICE,bodyFor(manifest,now),pemPrivate(wrong)).signature};
  assert.throws(()=>verifyRevoke(forged,manifest,pemPublic(issuer),now),/DENY_BAD_SIGNATURE/);
  for(const key of ["ownerId","grantId","consentId","ownerSessionId","clientId","projectId","taskId","recipientDeviceId","localDeviceKey","peerDeviceKey","rc66kAckSha256"]){
    const wrongScope={...manifest,[key]:"wrong"};
    assert.throws(()=>verifyRevoke(n,wrongScope,pemPublic(issuer),now),/DENY_SCOPE_/);
  }
});
test("future, expired and incomplete scope fail without a delivery receipt",()=>{
  assert.throws(()=>verifyRevoke(notice(),manifest,pemPublic(issuer),now+31_000),/DENY_CLOCK_OR_SEQUENCE/);
  assert.throws(()=>verifyRevoke(notice(),manifest,pemPublic(issuer),now-10_000),/DENY_CLOCK_OR_SEQUENCE/);
  const broken={...manifest,sequence:0};
  const bad=makeSigned(DOMAIN_NOTICE,bodyFor(broken,now),pemPrivate(issuer));
  assert.throws(()=>verifyRevoke(bad,broken,pemPublic(issuer),now),/DENY_CLOCK_OR_SEQUENCE/);
});
test("device receipt must be separately signed and exactly bound to the notice",()=>{
  const n=notice();const signed=receipt(n);
  assert.equal(verifyDeviceReceipt(signed,manifest,pemPublic(device),sha(n.payloadText),"revoked_persisted").status,"revoked_persisted");
  assert.throws(()=>verifyDeviceReceipt(signed,manifest,pemPublic(issuer),sha(n.payloadText),"revoked_persisted"),/DENY_BAD_SIGNATURE/);
  assert.throws(()=>verifyDeviceReceipt(signed,manifest,pemPublic(device),"b".repeat(64),"revoked_persisted"),/DENY_ACK_BINDING/);
  assert.throws(()=>verifyDeviceReceipt(signed,manifest,pemPublic(device),sha(n.payloadText),"replay_denied"),/DENY_ACK_BINDING/);
});
test("durable file survives reopen and replay is denied; no command execution",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"katosync-stage4aj-unit-"));
  try{
    const n=verifyRevoke(notice(),manifest,pemPublic(issuer),now);
    assert.equal(persistRevocation(dir,n),"revoked_persisted");
    const mark=path.join(dir,"revoked.lock");
    assert.match(fs.readFileSync(mark,"utf8"),/KatoSync-Stage4AJ-QA-REVOCATION-v1/);
    if(process.platform!=="win32") assert.equal(fs.statSync(mark).mode&0o777,0o600);
    assert.equal(persistRevocation(dir,n),"replay_denied");
    assert.ok(fs.existsSync(mark));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("QA script has no production endpoint, shell command or Git mutation",()=>{
  const src=fs.readFileSync(new URL("../scripts/qa-stage4aj-physical-revoke.mjs",import.meta.url),"utf8");
  assert.match(src,/minVersion:"TLSv1\.3",maxVersion:"TLSv1\.3"/);
  assert.match(src,/requestCert:true,rejectUnauthorized:true/);
  assert.match(src,/crypto\.verify\(null/);
  assert.match(src,/O_EXCL/);
  assert.match(src,/STAGE4AJ_REAL_TWO_MAC_MTLS_SIGNED_REVOKE_REPLAY_PASS_NO_REMOTE/);
  assert.doesNotMatch(src,/child_process|execSync|spawn\(|git push|git reset|listen\(443/);
});
