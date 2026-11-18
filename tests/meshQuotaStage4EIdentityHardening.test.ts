// Stage4E: additional disposable-only defense-in-depth against UPDATE transfer.
// Never talks to Supabase, installs DDL in production, or modifies old QA fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const src=(file:string)=>readFileSync(new URL("../"+file,import.meta.url),"utf8");
const overlay=src("tests/sql/mesh_quota_stage4e_identity_overlay_qa.sql");
const proof=src("tests/sql/mesh_quota_stage4e_identity_disposable_qa.sql");
const runner=src("scripts/qa-mesh-postgres-local.sh");

test("Stage4E identity overlay is QA-only; owner and cryptographic identity cannot change",()=>{
  assert.match(overlay,/CREATE OR REPLACE FUNCTION katosync\.mesh_device_identity_immutability_guard/);
  for(const field of ["device_id","owner_user_id","signing_public_key","fingerprint"])
    assert.match(overlay,new RegExp("NEW\\."+field+" IS DISTINCT FROM OLD\\."+field));
  assert.match(overlay,/BEFORE UPDATE ON katosync\.mesh_devices/);
  assert.match(overlay,/KATOSYNC_MESH_DEVICE_IDENTITY_IMMUTABLE/);
  assert.match(overlay,/SECURITY INVOKER SET search_path = ''/);
  assert.match(overlay,/REVOKE ALL ON FUNCTION katosync\.mesh_device_identity_immutability_guard\(\)/);
  assert.doesNotMatch(overlay,/SECURITY DEFINER|\bhttps?:\/\/|SUPABASE_SERVICE_ROLE_KEY/i);
});
test("real disposable QA first demonstrates insert-only gap then proves update denial and rollback",()=>{
  assert.match(proof,/\\ir mesh_quota_stage4e_disposable_qa\.sql/);
  assert.match(proof,/KATOSYNC_STAGE4E_DISPOSABLE_INSERT_ONLY_TRANSFER_GAP_REPRODUCED/);
  assert.match(proof,/\\ir mesh_quota_stage4e_identity_overlay_qa\.sql/);
  for(const marker of ["IDENTITY_QA_OWNER_TRANSFER_ALLOWED","IDENTITY_QA_KEY_ROTATION_ALLOWED",
    "IDENTITY_QA_FINGERPRINT_MUTATION_ALLOWED","IDENTITY_QA_DEVICE_ID_MUTATION_ALLOWED",
    "IDENTITY_QA_SAFE_METADATA_UPDATE_DENIED","IDENTITY_QA_PUBLIC_MUTATION_OR_EXECUTE",
    "IDENTITY_QA_ROLLBACK_DID_NOT_REMOVE_OVERLAY","IDENTITY_QA_ROLLBACK_CHANGED_DEVICE"])
    assert.ok(proof.includes(marker),marker);
  assert.match(proof,/GET STACKED DIAGNOSTICS message=MESSAGE_TEXT/g);
  assert.match(proof,/KATOSYNC_STAGE4E_DISPOSABLE_IMMUTABLE_OWNER_KEY_FINGERPRINT_ID_PASS/);
  assert.match(proof,/KATOSYNC_STAGE4E_DISPOSABLE_HARDENING_ROLLBACK_PASS/);
  assert.match(proof,/\bROLLBACK;/g);
  assert.doesNotMatch(proof, /SUPABASE_DB_URL|SERVICE_ROLE_KEY|pg_net|dblink|https?:\/\//i);
});
test("runner remains Unix socket only and explicitly routes isolated hardening mode",()=>{
  assert.match(runner,/quota-stage4e-identity\) TEST_FILE="\$ROOT\/tests\/sql\/mesh_quota_stage4e_identity_disposable_qa\.sql"/);
  assert.match(runner,/listen_addresses=''/);
  assert.match(runner,/MESH_QA_UNEXPECTED_TCP_LISTENER/);
  assert.match(runner,/mktemp -d \/tmp\/ksmeshqa/);
});
test("historical migration stays immutable and there is no live migration deployment",()=>{
  const fixture=src("tests/fixtures/migrations/20261103162500_mesh_entitlement_expiry_guard.sql");
  assert.match(fixture,/IF max_devices IS NULL/);
  assert.match(fixture,/expiration <= pg_catalog\.now\(\)/);
  const safety=src("tests/releaseMigrationSafety.test.ts");
  assert.match(safety,/44111b4eb7feb3bef726caca49eef151b2d30b9af4eeeccd9532f8c23e356069/);
  assert.doesNotMatch(runner, /supabase db push|supabase migration up/i);
});
