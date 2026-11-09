// NMKato Solutions: QA-only Stage4E migration candidate and emergency freeze.
// No Supabase network, no DDL outside the disposable Unix socket fixture.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";

const read=(name:string)=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
const candidate=read("release-candidates/stage4e/qa_only_hardening_candidate.sql");
const freeze=read("release-candidates/stage4e/qa_only_emergency_freeze.sql");
const qa=read("tests/sql/mesh_stage4e_release_candidate_disposable_qa.sql");
const runner=read("scripts/qa-mesh-postgres-local.sh");

test("QA gate rejects live network/unchecked SQL; candidate absent from Supabase migration discovery",()=>{
 for(const source of [candidate,freeze]){
  assert.match(source,/current_setting\('katosync\.qa_disposable',\s*true\)/);
  assert.match(source,/IS DISTINCT FROM 'unix-socket-qa-only'/);
  assert.match(source,/inet_server_addr\(\) IS NOT NULL/);
  assert.match(source,/KATOSYNC_STAGE4E_QA_ONLY_REFUSED/);
  assert.doesNotMatch(source,/(?:\\i|\\ir)\s+.*(?:https?:\/\/|postgres)/i);
 }
 const actual=readdirSync(new URL("../supabase/migrations/",import.meta.url))
  .filter(x=>x.endsWith(".sql")).sort();
 assert.equal(actual.length,7);
 assert.equal(actual.includes("qa_only_hardening_candidate.sql"),false);
 assert.equal(actual.includes("qa_only_emergency_freeze.sql"),false);
});
test("explicit premium policy only, Free 0, Pro <=10, wallclock expiry and per-owner locked count",()=>{
 assert.match(candidate,/ALTER TABLE katosync\.mesh_owner_policy ALTER COLUMN allowed_devices DROP DEFAULT/);
 assert.match(candidate,/max_devices IS NULL OR max_devices < 1 OR max_devices > 10/);
 assert.match(candidate,/pg_advisory_xact_lock/);
 assert.match(candidate,/FOR SHARE/);
 assert.match(candidate,/clock_timestamp\(\)/);
 assert.match(candidate,/used_devices>=max_devices/);
 assert.match(candidate,/KATOSYNC_MESH_ENTITLEMENT_REQUIRED/);
 assert.match(candidate,/KATOSYNC_MESH_DEVICE_QUOTA/);
 assert.doesNotMatch(candidate,/coalesce\s*\(\s*(?:allowed|max_devices)\s*,\s*2\s*\)/i);
 assert.match(candidate,/SECURITY INVOKER SET search_path = ''/);
});
test("never transfer original signed device identity, but keep normal status updates available",()=>{
 for(const field of ["device_id","owner_user_id","signing_public_key","fingerprint"]){
  assert.match(candidate,new RegExp("NEW\\."+field+" IS DISTINCT FROM OLD\\."+field));
 }
 assert.match(candidate,/BEFORE UPDATE ON katosync\.mesh_devices/);
 assert.match(candidate,/KATOSYNC_MESH_DEVICE_IDENTITY_IMMUTABLE/);
 assert.match(candidate,/REVOKE ALL ON FUNCTION katosync\.mesh_device_identity_immutability_guard\(\)/);
 assert.doesNotMatch(candidate,/SECURITY DEFINER/);
 assert.doesNotMatch(candidate,/UPDATE\s+katosync\.mesh_devices\s+SET/i);
});
test("freeze remains fail-closed and never reinstates the vulnerable trigger",()=>{
 assert.match(freeze,/KATOSYNC_MESH_ENROLLMENT_FROZEN/);
 assert.match(freeze,/CREATE OR REPLACE FUNCTION katosync\.mesh_device_quota_guard\(\)/);
 assert.match(freeze,/KATOSYNC_STAGE4E_IDENTITY_GUARD_REQUIRED/);
 const executable=freeze.split("\n").filter(line=>!line.trimStart().startsWith("--")).join("\n");
 assert.doesNotMatch(executable,/DROP\s+TRIGGER|DROP\s+TABLE|DELETE\s+FROM|coalesce\s*\(/i);
});
test("real SQL QA uses only explicit transaction-local opt-in and verifies emergency freeze",()=>{
 assert.match(runner,/quota-stage4e-release-candidate\) TEST_FILE="\$ROOT\/tests\/sql\/mesh_stage4e_release_candidate_disposable_qa\.sql"/);
 assert.match(runner,/listen_addresses=''/);
 assert.match(runner,/MESH_QA_UNEXPECTED_TCP_LISTENER/);
 assert.match(runner,/mktemp -d \/tmp\/ksmeshqa/);
 assert.match(qa,/SELECT pg_catalog\.set_config\('katosync\.qa_disposable','unix-socket-qa-only',true\)/g);
 assert.match(qa,/\\ir \.\.\/\.\.\/release-candidates\/stage4e\/qa_only_hardening_candidate\.sql/);
 assert.match(qa,/\\ir \.\.\/\.\.\/release-candidates\/stage4e\/qa_only_emergency_freeze\.sql/);
 for(const marker of [
  "KATOSYNC_STAGE4E_CANDIDATE_PREFLIGHT_INSTALL_PASS",
  "KATOSYNC_STAGE4E_CANDIDATE_FREE0_PRO10_EXPIRY_IMMUTABILITY_PASS",
  "KATOSYNC_STAGE4E_CANDIDATE_EMERGENCY_FREEZE_DENIES_NEW_AND_PRESERVES_EXISTING_PASS",
  "RELEASE_QA_FREE_INSERT_ACCEPTED",
  "RELEASE_QA_PRO_ELEVEN_ACCEPTED",
  "RELEASE_QA_EXPIRED_ACCEPTED",
  "RELEASE_QA_REVOKED_ACCEPTED",
  "RELEASE_QA_OWNER_TRANSFER_ACCEPTED",
  "RELEASE_QA_POLICY_WITHOUT_EXPLICIT_QUOTA_ACCEPTED"
 ])assert.ok(qa.includes(marker),marker);
 assert.doesNotMatch(qa,/SUPABASE_DB_URL|SERVICE_ROLE_KEY|pg_net|dblink|https?:\/\//i);
});
test("old applied migration and QA fixtures stay untouched and hashes checked",()=>{
 const original=read("supabase/migrations/20261028202403_katosync_mesh_owned_schema.sql");
 assert.match(original,/coalesce\(allowed,2\)/);
 const fixture=read("tests/fixtures/migrations/20261103162500_mesh_entitlement_expiry_guard.sql");
 assert.match(fixture,/expiration <= pg_catalog\.now\(\)/);
 const safety=read("tests/releaseMigrationSafety.test.ts");
 assert.match(safety,/44111b4eb7feb3bef726caca49eef151b2d30b9af4eeeccd9532f8c23e356069/);
});
