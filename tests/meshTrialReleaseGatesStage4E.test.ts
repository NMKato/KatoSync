import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(file:string)=>readFileSync(new URL("../"+file,import.meta.url),"utf8");
const claims=read("tests/fixtures/migrations/20261103162300_mesh_one_time_trial_claims.sql");
const guard=read("tests/fixtures/migrations/20261103162500_mesh_entitlement_expiry_guard.sql");
const edge=read("supabase/functions/mesh-device-enrollment/device-entitlement.ts");
test("unique trial claim and no authenticated client writes",()=>{
 assert.ok(claims.includes("owner_user_id uuid PRIMARY KEY"));
 assert.ok(claims.includes("INTERVAL '336 hours'"));
 assert.ok(claims.includes("ENABLE ROW LEVEL SECURITY"));
 assert.ok(claims.includes("REVOKE ALL ON katosync.mesh_trial_claims FROM PUBLIC, anon, authenticated"));
 assert.ok(claims.includes("GRANT SELECT ON katosync.mesh_trial_claims TO authenticated"));
 assert.ok(!claims.includes("GRANT INSERT ON katosync.mesh_trial_claims TO authenticated"));
});
test("quota guard denies no policy and expired trial under original lock",()=>{
 assert.ok(guard.includes("CREATE OR REPLACE FUNCTION katosync.mesh_device_quota_guard"));
 assert.ok(guard.includes("pg_advisory_xact_lock"));
 assert.ok(guard.includes("max_devices IS NULL"));
 assert.ok(guard.includes("expiration <= pg_catalog.now()"));
 assert.ok(guard.includes("current_devices>=max_devices"));
 assert.ok(!guard.includes("coalesce(max_devices,2)"));
});
test("Edge checks server-side expiry before enrollment",()=>{
 assert.ok(edge.includes("policy_expires_at"));
 assert.ok(edge.includes("expiryMs<=nowMs"));
 assert.ok(edge.includes('url.searchParams.set("select","allowed_devices,policy_expires_at")'));
});
