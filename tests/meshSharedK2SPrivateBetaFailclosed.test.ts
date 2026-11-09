// NMKato Solutions — KatoSync owner self-beta on the existing K2S DB.
// No production writes from tests. Actual DDL verified on disposable PG17.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const get=(name:string)=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
const sql=get("release-candidates/stage4e/shared-k2s/20261109145621_katosync_shared_beta_failclosed_device_quota.sql");
const fixture=get("tests/sql/mesh_shared_k2s_private_beta_failclosed_qa.sql");
const runner=get("scripts/qa-mesh-postgres-local.sh");
const workflow=get(".github/workflows/pr-fast-gate.yml");

test("migration is scoped to KatoSync, not KatoOS Auth, billing or shared tenants",()=>{
 assert.match(sql,/ALTER TABLE katosync\.mesh_owner_policy/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION katosync\.mesh_device_quota_guard/);
 assert.match(sql,/CREATE FUNCTION katosync\.mesh_device_identity_immutability_guard/);
 assert.doesNotMatch(sql,/\b(?:ALTER|UPDATE|DELETE|INSERT|DROP|TRUNCATE)\s+(?:TABLE\s+)?(?:public|auth|stripe|cms|kai_workflow_private)\./i);
 assert.doesNotMatch(sql,/supabase functions deploy|supabase db push|https:\/\//i);
 assert.doesNotMatch(sql,/remoteJobsEnabled\s*:\s*true|grantsRights\s*:\s*true/);
});
test("Free0 requires explicit server-provisioned policy and active membership",()=>{
 assert.match(sql,/ALTER COLUMN allowed_devices DROP DEFAULT/);
 assert.match(sql,/max_devices IS NULL OR max_devices<1 OR max_devices>10/);
 assert.match(sql,/policy_expires_at/);
 assert.match(sql,/expiry<=pg_catalog\.clock_timestamp\(\)/);
 assert.match(sql,/pg_catalog\.pg_advisory_xact_lock/);
 assert.match(sql,/FROM katosync\.mesh_owner_policy p[\s\S]*?FOR SHARE;/);
 assert.match(sql,/FROM katosync\.account_memberships m[\s\S]*?FOR SHARE;/);
 assert.match(sql,/m\.access_state='active'/);
 assert.match(sql,/m\.revoked_at IS NULL/);
 assert.match(sql,/used_devices>=max_devices/);
 assert.match(sql,/current_user<>'service_role'/);
 assert.doesNotMatch(sql,/COALESCE\s*\(\s*max_devices\s*,\s*2/i);
});
test("existing devices remain unchanged and identities cannot transfer or resurrect",()=>{
 assert.match(sql,/NEW\.device_id IS DISTINCT FROM OLD\.device_id/);
 assert.match(sql,/NEW\.owner_user_id IS DISTINCT FROM OLD\.owner_user_id/);
 assert.match(sql,/NEW\.signing_public_key IS DISTINCT FROM OLD\.signing_public_key/);
 assert.match(sql,/NEW\.fingerprint IS DISTINCT FROM OLD\.fingerprint/);
 assert.match(sql,/OLD\.membership_state='revoked'/);
 assert.match(sql,/KATOSYNC_MESH_REVOKED_DEVICE_CANNOT_RESURRECT/);
 assert.match(sql,/BEFORE UPDATE ON katosync\.mesh_devices/);
 assert.doesNotMatch(sql,/DELETE FROM katosync\.mesh_devices|TRUNCATE katosync|UPDATE katosync\.mesh_devices/i);
});
test("migration refuses unexpected schema, trigger or grant states",()=>{
 for(const marker of [
  "KATOSYNC_SELF_BETA_MISSING_BASE_SCHEMA",
  "KATOSYNC_SELF_BETA_UNEXPECTED_EXISTING_QUOTA_GUARD",
  "KATOSYNC_SELF_BETA_IDENTITY_TRIGGER_ALREADY_PRESENT",
  "KATOSYNC_SELF_BETA_REQUIRED_QUOTA_TRIGGER_MISSING",
  "KATOSYNC_SELF_BETA_CLIENT_WRITES_NOT_ISOLATED"])
  assert.ok(sql.includes(marker),marker);
 assert.match(sql,/REVOKE ALL ON FUNCTION katosync\.mesh_device_quota_guard/);
 assert.match(sql,/REVOKE ALL ON FUNCTION katosync\.mesh_device_identity_immutability_guard/);
 assert.doesNotMatch(sql,/GRANT .*\b(?:anon|authenticated)\b/i);
});
test("PG17 QA proves missing plan, revoked membership, expiry, Pro10 and invalid identity",()=>{
 for(const marker of [
  "KATOSYNC_SHARED_BETA_DEFAULT_OFF_AND_ROLES_PASS",
  "KATOSYNC_SHARED_BETA_FREE0_EXPIRED_MEMBER_PRO10_IDENTITY_PASS",
  "KATOSYNC_SHARED_BETA_LOCAL_PG17_NO_KATOOS_DATA_PASS",
  "KATOSYNC_SHARED_BETA_FREE0_UNEXPECTED_INSERT",
  "KATOSYNC_SHARED_BETA_NONMEMBER_UNEXPECTED_INSERT",
  "KATOSYNC_SHARED_BETA_EXPIRED_UNEXPECTED_INSERT",
  "KATOSYNC_SHARED_BETA_ELEVENTH_DEVICE_INSERTED",
  "KATOSYNC_SHARED_BETA_DEVICE_KEY_REBOUND",
  "KATOSYNC_SHARED_BETA_REVOKED_DEVICE_RESURRECTED"])
  assert.ok(fixture.includes(marker),marker);
 assert.match(runner,/shared-beta-failclose\) TEST_FILE/);
 assert.match(runner,/listen_addresses=''/);
 assert.match(runner,/MESH_QA_UNEXPECTED_TCP_LISTENER/);
 assert.match(runner,/mktemp -d \/tmp\/ksmeshqa/);
});
test("CI invokes the owner-private K2S quota QA without any network or cloud DDL",()=>{
 assert.match(workflow,/shared-beta-failclose/);
 assert.match(workflow,/--network none --read-only/);
 assert.match(workflow,/KATOSYNC_PG_BIN=\/usr\/local\/bin/);
 assert.doesNotMatch(workflow,/supabase db push|supabase functions deploy/i);
});
