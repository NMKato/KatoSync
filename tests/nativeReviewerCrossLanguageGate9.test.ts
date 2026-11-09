// NMKato Solutions — cross-language synthetic Ed25519 Gate9 trust-domain QA.
// Test seed is public deterministic fixture ONLY; never an actual reviewer key.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash,createPrivateKey,createPublicKey,sign} from "node:crypto";
import {readFileSync} from "node:fs";
import {REVIEW_PROTOCOL40,reviewerSigningBytes40,verifyIndependentOwnerReview40}
 from "../src/lib/independentOwnerReview40.ts";

const digest="d0942d714bed03bf4192288172d5a3737edafdd1a2bc26c3ca4c18fff1b9f82d";
const expectedSig="5h-b9UQ7Sp0IeAcR-17mFa49xXI_Dksj4ZvaBTLu50v3KHY3NlszUyd02kKIkfvggg3ze02eGbP551hkm0fWAA";
const now=1793829600000;

function fixture(){
 const der=Buffer.concat([Buffer.from("302e020100300506032b657004220420","hex"),
  Buffer.alloc(32,41)]);
 const privateKey=createPrivateKey({key:der,format:"der",type:"pkcs8"});
 const raw=Buffer.from(createPublicKey(privateKey).export({format:"der",type:"spki"})).subarray(-32);
 const keyId="ed25519-sha256:"+createHash("sha256").update(raw).digest("hex");
 const review={
  protocol:REVIEW_PROTOCOL40,grantId:"33333333-3333-4333-8333-333333333333",
  challengeId:"44444444-4444-4444-8444-444444444444",projectId:"katosync",
  subjectUid:"22222222-2222-4222-8222-222222222222",
  ownerKeyId:"ed25519-sha256:"+"e".repeat(64),grantRevision:3,
  reviewerUid:"11111111-1111-4111-8111-111111111111",
  reviewerKeyId:keyId,reviewerKeyRevision:2,
  reviewerPublicKey:raw.toString("base64url"),decision:"approved" as const,
  reason:"Independent synthetic QA reviewer checked owner proof",
  signedAtMs:now
 };
 return {review,privateKey};
}
test("native Rust and KATOOS Edge share the exact 14-field Ed25519 bytes",async()=>{
 const {review,privateKey}=fixture();
 const bytes=Buffer.from(reviewerSigningBytes40(review));
 assert.equal(createHash("sha256").update(bytes).digest("hex"),digest);
 const signature=sign(null,bytes,privateKey).toString("base64url");
 assert.equal(signature,expectedSig);
 assert.equal(await verifyIndependentOwnerReview40(review,signature,
  review.reviewerUid,review.reviewerKeyId,now),true);
 const rust=readFileSync(new URL(
  "../src-tauri/src/memory_fabric/acceptance_ledger/reviewer_attestation.rs",
  import.meta.url),"utf8");
 assert.ok(rust.includes(digest));
 assert.ok(rust.includes(expectedSig));
 assert.match(rust,/\.verify_strict\(/);
 assert.match(rust,/deny_unknown_fields/);
 assert.match(rust,/owner_proof_consumed/);
 assert.match(rust,/reviewer_active/);
});
test("signed review never grants rights or permits self-review and changed fields",async()=>{
 const {review,privateKey}=fixture();
 const signature=sign(null,Buffer.from(reviewerSigningBytes40(review)),privateKey).toString("base64url");
 for(const altered of [
  {...review,subjectUid:review.reviewerUid},
  {...review,decision:"rejected" as const},
  {...review,grantRevision:review.grantRevision+1},
  {...review,reviewerKeyRevision:review.reviewerKeyRevision+1},
  {...review,projectId:"other"}
 ])assert.equal(await verifyIndependentOwnerReview40(altered,signature,
  review.reviewerUid,review.reviewerKeyId,now),false);
 const rust=readFileSync(new URL(
  "../src-tauri/src/memory_fabric/acceptance_ledger/reviewer_attestation.rs",
  import.meta.url),"utf8");
 assert.doesNotMatch(rust,/\#\[tauri::command\]/);
 assert.doesNotMatch(rust,/Command::new\(|reqwest::|UPDATE\s+feature_approver_grants/i);
});
