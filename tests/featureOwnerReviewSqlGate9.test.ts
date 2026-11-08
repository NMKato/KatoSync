// KatoSync Gate 9: independent signed reviewer evidence and authorization.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const sql=readFileSync(new URL(
 "../supabase/migrations/20261105100122_katosync_reviewer_signed_attestation_gate9.sql",
 import.meta.url),"utf8");
const edge=readFileSync(new URL("../supabase/functions/feature-owner-review-qa/handler.ts",
 import.meta.url),"utf8");

test("reviewer keys are admin-enrolled, RLS deny-by-default, irreversible after revocation",()=>{
 assert.match(sql,/CREATE TABLE katosync\.feature_reviewer_signing_keys/);
 assert.match(sql,/ALTER TABLE katosync\.feature_reviewer_signing_keys ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON katosync\.feature_reviewer_signing_keys FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/WHERE state='active'/);
 assert.match(sql,/REVIEWER_KEY_DELETE_FORBIDDEN/);
 assert.match(sql,/REVIEWER_KEY_IMMUTABLE/);
 assert.match(sql,/admin_evidence_ref text NOT NULL/);
 assert.doesNotMatch(sql,/SECURITY DEFINER/);
 assert.doesNotMatch(sql,/INSERT INTO katosync\.feature_reviewer_signing_keys/);
});
test("signed reviewer decision is bound to grant, consumed proof, active second reviewer and current key",()=>{
 assert.match(sql,/ADD COLUMN reviewer_signature text NOT NULL/);
 assert.match(sql,/ADD COLUMN reviewer_key_id text NOT NULL/);
 assert.match(sql,/ADD COLUMN reviewer_public_key text NOT NULL/);
 assert.match(sql,/ADD COLUMN grant_revision bigint NOT NULL/);
 assert.match(sql,/NEW.reviewer_uid<>g.subject_uid/);
 assert.match(sql,/c.consumed_at IS NOT NULL/);
 assert.match(sql,/k.state='active'/);
 assert.match(sql,/k.key_revision=NEW.reviewer_key_revision/);
 assert.match(sql,/k.public_key=NEW.reviewer_public_key/);
 assert.match(sql,/FEATURE_OWNER_SIGNED_REVIEW_NOT_AUTHORIZED/);
 assert.match(sql,/FEATURE_OWNER_SIGNED_APPROVAL_REQUIRED/);
 assert.match(sql,/feature_owner_review_signature_no_replay/);
});
test("Edge endpoint cannot register reviewers or promote/activate projects",()=>{
 assert.match(edge,/verifyIndependentOwnerReview40\(/);
 assert.match(edge,/feature_owner_review_submit/);
 assert.match(edge,/grantsRights:false/);
 assert.match(edge,/\/auth\/v1\/user/);
 assert.doesNotMatch(edge,/feature_approver_audit_guard/);
 assert.doesNotMatch(edge,/UPDATE feature_approver_grants/);
 assert.doesNotMatch(edge,/feature_reviewer_signing_keys.*POST/);
 assert.match(sql,/REVOKE ALL ON FUNCTION katosync\.feature_owner_review_submit\(/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION katosync\.feature_owner_review_submit\(/);
 assert.match(sql,/TO service_role/);
});
