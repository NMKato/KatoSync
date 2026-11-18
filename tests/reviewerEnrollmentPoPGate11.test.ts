// Gate 11 synthetic/offline key-possession ONLY; no server or privileged writes.
import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {prepareReviewerPoP,reviewerPoPSigningBytes,verifyReviewerPoP}
 from "../scripts/qa-reviewer-enrollment-pop.mjs";

const OWNER="22222222-2222-4222-8222-222222222222";
const REVIEWER="11111111-1111-4111-8111-111111111111";
const OUTSIDER="99999999-9999-4999-8999-999999999999";
const NOW=Date.UTC(2026,10,9,10,0,0);
const CLI=fileURLToPath(new URL("../scripts/qa-reviewer-enrollment-pop-cli.mjs",import.meta.url));
function fixture(t=NOW){
 const keys=generateKeyPairSync("ed25519");
 const der=keys.publicKey.export({format:"der",type:"spki"});
 const pub=der.subarray(-32).toString("base64url");
 const result=prepareReviewerPoP({
  ownerUid:OWNER,reviewerUid:REVIEWER,projectId:"katosync",reviewerPublicKey:pub
 },t);
 const signature=sign(null,reviewerPoPSigningBytes(result.challenge),keys.privateKey)
  .toString("base64url");
 return {keys,pub,result,signature};
}
test("real synthetic Ed25519 key proof remains non-authorizing and binds owner, reviewer and project",()=>{
 const f=fixture(),a=verifyReviewerPoP(f.result.challenge,f.signature,NOW);
 assert.equal(a.status,"public_key_possession_only_not_enrolled");
 assert.equal(a.reviewerUid,REVIEWER);
 assert.equal(a.ownerUid,OWNER);
 assert.equal(a.projectId,"katosync");
 assert.equal(a.reviewerKeyId,f.result.challenge.reviewerKeyId);
 for(const key of ["grantsRights","reviewerAuthorized","reviewerKeyPinned"])
  assert.equal(a[key],false);
 assert.equal(a.requiresIndependentHumanWitness,true);
 assert.equal(a.requiresSeparatePrivilegedAdminEnrollment,true);
 assert.equal(f.result.grantsRights,false);
 assert.equal(f.result.state,"awaiting_independent_reviewer_key_signature_no_rights");
 assert.equal(Buffer.from(f.result.signingMessageBase64url,"base64url").toString("hex"),
  reviewerPoPSigningBytes(f.result.challenge).toString("hex"));
});
test("all nine signed challenge fields resist tampering; same signature cannot transfer",()=>{
 const f=fixture();
 const c=f.result.challenge;
 const bad=[
  {...c,reviewerUid:OUTSIDER},
  {...c,ownerUid:OUTSIDER},
  {...c,projectId:"not-katosync"},
  {...c,reviewerPublicKey:fixture().pub},
  {...c,reviewerKeyId:"ed25519-sha256:"+"f".repeat(64)},
  {...c,nonce:Buffer.alloc(32,2).toString("base64url")},
  {...c,issuedAtMs:c.issuedAtMs+500},
  {...c,expiresAtMs:c.expiresAtMs+500},
  {...c,protocol:"katosync.reviewer-enrollment-pop-qa/v2"}
 ];
 for(const mutated of bad)assert.throws(()=>verifyReviewerPoP(mutated,f.signature,NOW));
});
test("wrong signer, altered signatures, no-padded canonical base64 and invalid key fail closed",()=>{
 const f=fixture();
 const other=fixture();
 const wrong=sign(null,reviewerPoPSigningBytes(f.result.challenge),other.keys.privateKey)
  .toString("base64url");
 assert.throws(()=>verifyReviewerPoP(f.result.challenge,wrong,NOW),/POP_SIGNATURE_INVALID/);
 assert.throws(()=>verifyReviewerPoP(f.result.challenge,f.signature+"=",NOW),/POP_ENCODING_INVALID/);
 assert.throws(()=>verifyReviewerPoP(f.result.challenge,"A".repeat(86),NOW));
 assert.throws(()=>prepareReviewerPoP({
  ownerUid:OWNER,reviewerUid:REVIEWER,projectId:"katosync",reviewerPublicKey:"x"
 },NOW));
});
test("no self-review or malformed UID, malformed challenge shape, or extra authority flags",()=>{
 const f=fixture();
 assert.throws(()=>prepareReviewerPoP({
  ownerUid:REVIEWER,reviewerUid:REVIEWER,projectId:"katosync",reviewerPublicKey:f.pub
 },NOW));
 assert.throws(()=>prepareReviewerPoP({
  ownerUid:OWNER,reviewerUid:"not-a-uid",projectId:"katosync",reviewerPublicKey:f.pub
 },NOW));
 assert.throws(()=>prepareReviewerPoP({
  ownerUid:OWNER,reviewerUid:REVIEWER,projectId:"../katosync",reviewerPublicKey:f.pub
 },NOW));
 assert.throws(()=>verifyReviewerPoP({...f.result.challenge,grantsRights:true},f.signature,NOW));
 const incomplete={...f.result.challenge};delete incomplete.nonce;
 assert.throws(()=>verifyReviewerPoP(incomplete,f.signature,NOW));
});
test("two-minute challenge TTL and future clock skew are strict; no offline proof authorizes",()=>{
 const f=fixture();
 assert.ok(verifyReviewerPoP(f.result.challenge,f.signature,NOW+120_000));
 assert.throws(()=>verifyReviewerPoP(f.result.challenge,f.signature,NOW+120_001),/POP_CHALLENGE_EXPIRED/);
 assert.throws(()=>verifyReviewerPoP(f.result.challenge,f.signature,NOW-5_001),/POP_CHALLENGE_EXPIRED/);
 assert.throws(()=>verifyReviewerPoP(f.result.challenge,f.signature,NaN),/POP_TIME_INVALID/);
 const g=fixture();
 assert.notEqual(f.result.challenge.nonce,g.result.challenge.nonce);
});
test("offline CLI emits no enrollment rights and verifies a signed reviewer proof without network",()=>{
 const f=fixture(Date.now());
 const prepare=spawnSync(process.execPath,[CLI,"prepare",
  "--owner-uid",OWNER,"--reviewer-uid",REVIEWER,
  "--project-id","katosync","--reviewer-public-key",f.pub
 ],{encoding:"utf8",timeout:3000});
 assert.equal(prepare.status,0,prepare.stderr);
 const pending=JSON.parse(prepare.stdout);
 assert.equal(pending.grantsRights,false);
 assert.equal(pending.challenge.reviewerUid,REVIEWER);
 const proof=sign(null,reviewerPoPSigningBytes(pending.challenge),f.keys.privateKey)
  .toString("base64url");
 const verify=spawnSync(process.execPath,[CLI,"verify"],{
  encoding:"utf8",input:JSON.stringify({challenge:pending.challenge,signature:proof}),timeout:3000
 });
 assert.equal(verify.status,0,verify.stderr);
 assert.equal(JSON.parse(verify.stdout).reviewerAuthorized,false);
 const bad=spawnSync(process.execPath,[CLI,"verify"],{
  encoding:"utf8",input:JSON.stringify({
   challenge:pending.challenge,signature:proof,grantRights:true
  }),timeout:3000
 });
 assert.equal(bad.status,1);
 assert.equal(bad.stdout,"");
 assert.match(bad.stderr,/POP_INPUT_INVALID/);
});
