import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomBytes,webcrypto} from "node:crypto";
import {REVIEW_PROTOCOL40,REVIEW_DOMAIN40,reviewerSigningBytes40,
 verifyIndependentOwnerReview40,type IndependentOwnerReview40
} from "../src/lib/independentOwnerReview40.ts";

const reviewer="11111111-1111-4111-8111-111111111111";
const subject="22222222-2222-4222-8222-222222222222";
const now=Date.UTC(2026,10,5,10,0,0);
async function fixture(){
 const keys=await webcrypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
 const pub=new Uint8Array(await webcrypto.subtle.exportKey("raw",keys.publicKey));
 const reviewerKeyId="ed25519-sha256:"+createHash("sha256").update(pub).digest("hex");
 const v:IndependentOwnerReview40={
  protocol:REVIEW_PROTOCOL40,
  grantId:"33333333-3333-4333-8333-333333333333",
  challengeId:"44444444-4444-4444-8444-444444444444",
  projectId:"katosync",subjectUid:subject,
  ownerKeyId:"ed25519-sha256:"+"f".repeat(64),
  grantRevision:3,reviewerUid:reviewer,reviewerKeyId,
  reviewerKeyRevision:2,reviewerPublicKey:Buffer.from(pub).toString("base64url"),
  decision:"approved",
  reason:"Independent human review: owner proof and project checked",
  signedAtMs:now
 };
 const sign=async(data:IndependentOwnerReview40)=>{
  const bytes=reviewerSigningBytes40(data);
  return Buffer.from(await webcrypto.subtle.sign("Ed25519",keys.privateKey,
    new Uint8Array(bytes).buffer as ArrayBuffer)).toString("base64url");
 };
 return {v,sign,signature:await sign(v)};
}
test("exact versioned 14-field Ed25519 signed reviewer attestation verifies",async()=>{
 const {v,signature}=await fixture();
 assert.equal((new TextDecoder().decode(reviewerSigningBytes40(v))).startsWith(REVIEW_DOMAIN40),true);
 assert.equal(await verifyIndependentOwnerReview40(v,signature,reviewer,v.reviewerKeyId,now),true);
});
test("signature cannot be transferred to another owner, grant, reviewer, key revision or action",async()=>{
 const {v,signature}=await fixture();
 const alternatives=[
  {...v,subjectUid:reviewer},
  {...v,grantId:"55555555-5555-4555-8555-555555555555"},
  {...v,challengeId:"55555555-5555-4555-8555-555555555555"},
  {...v,reviewerKeyRevision:3},
  {...v,grantRevision:4},
  {...v,decision:"rejected"},
  {...v,reason:"I approve all projects unconditionally"},
  {...v,ownerKeyId:"ed25519-sha256:"+"e".repeat(64)},
  {...v,reviewerUid:subject},
  {...v,projectId:"foreign"},
  {...v,reviewerPublicKey:Buffer.from(randomBytes(32)).toString("base64url")},
  {...v,extra:"elevate"}
 ];
 for(const candidate of alternatives){
  assert.equal(await verifyIndependentOwnerReview40(candidate,signature,reviewer,v.reviewerKeyId,now),false,
   JSON.stringify(candidate));
 }
 assert.equal(await verifyIndependentOwnerReview40(v,randomBytes(64).toString("base64url"),
  reviewer,v.reviewerKeyId,now),false);
});
test("independent reviewer cannot self-authorize or replay stale/future decision",async()=>{
 const {v,sign,signature}=await fixture();
 assert.equal(await verifyIndependentOwnerReview40({...v,subjectUid:reviewer},
  await sign({...v,subjectUid:reviewer}),reviewer,v.reviewerKeyId,now),false);
 assert.equal(await verifyIndependentOwnerReview40(v,signature,reviewer,v.reviewerKeyId,now+70000),false);
 assert.equal(await verifyIndependentOwnerReview40(v,signature,reviewer,v.reviewerKeyId,now-10000),false);
 assert.equal(await verifyIndependentOwnerReview40(v,signature,subject,v.reviewerKeyId,now),false);
 assert.equal(await verifyIndependentOwnerReview40(v,signature,reviewer,
  "ed25519-sha256:"+"0".repeat(64),now),false);
});
