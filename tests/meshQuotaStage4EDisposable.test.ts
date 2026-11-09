// QA-only Stage4E contract. Never connects to live Supabase.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const sql=read("tests/sql/mesh_quota_stage4e_disposable_qa.sql");
const runner=read("scripts/qa-mesh-postgres-local.sh");
const proposal=read("tests/fixtures/migrations/20261103162500_mesh_entitlement_expiry_guard.sql");
test("quota SQL runs only against disposable Unix-only PostgreSQL",()=>{
 assert.match(runner,/quota-stage4e\) TEST_FILE=.*mesh_quota_stage4e_disposable_qa\.sql/);
 assert.match(runner,/listen_addresses=''/);
 assert.match(runner,/MESH_QA_UNEXPECTED_TCP_LISTENER/);
 assert.match(sql,/\\ir \.\.\/fixtures\/migrations\/20261103162500_mesh_entitlement_expiry_guard\.sql/);
 assert.match(sql,/KATOSYNC_STAGE4E_DISPOSABLE_QUOTA_FREE0_PRO10_EXPIRY_DENY_PASS/);
 assert.doesNotMatch(sql,/https?:\/\/|SERVICE_ROLE_KEY|SUPABASE_DB_URL|pg_net|dblink/i);
});
test("quota QA exercises real inserts, denials and client-role restrictions",()=>{
 for(const marker of ["QUOTA_QA_FREE_WAS_ALLOWED","QUOTA_QA_OVER_QUOTA_ALLOWED",
  "QUOTA_QA_EXPIRED_ALLOWED","QUOTA_QA_REMOVED_POLICY_ALLOWED",
  "QUOTA_QA_PRO_TEN_INCOMPLETE","QUOTA_QA_PRO_ELEVEN_ALLOWED",
  "QUOTA_QA_PUBLIC_EXECUTION_RIGHTS"])assert.ok(sql.includes(marker),marker);
 assert.match(sql,/GET STACKED DIAGNOSTICS message=MESSAGE_TEXT/);
 assert.match(sql,/KATOSYNC_MESH_ENTITLEMENT_REQUIRED/);
 assert.match(sql,/KATOSYNC_MESH_DEVICE_QUOTA/);
});
test("Stage4E source remains inert; missing policy denies zero-to-two fallback",()=>{
 assert.match(proposal,/CREATE OR REPLACE FUNCTION katosync\.mesh_device_quota_guard/);
 assert.match(proposal,/pg_advisory_xact_lock/);
 assert.match(proposal,/max_devices IS NULL/);
 assert.match(proposal,/expiration <= pg_catalog\.now\(\)/);
 assert.match(proposal,/current_devices>=max_devices/);
 assert.doesNotMatch(proposal,/coalesce\(max_devices,2\)/i);
});
