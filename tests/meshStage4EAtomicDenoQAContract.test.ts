// NMKato Solutions — static regression gate for Stage4E hermetic QA only.
// Runtime proofs are executed separately in PostgreSQL 17 and Deno 2.9.6.
import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync,readdirSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const overlay=read("tests/sql/mesh_stage4e_atomic_write_overlay_qa.sql");
const sql=read("tests/sql/mesh_stage4e_atomic_write_disposable_qa.sql");
const runner=read("scripts/qa-mesh-postgres-local.sh");
const race=read("tests/qa/meshAtomicEntitlementRaceStage4E.mjs");

test("atomic Stage4E triggers are only QA, with owner row locks in same write transaction",()=>{
 assert.match(overlay,/katosync\.qa_disposable/);
 assert.match(overlay,/unix-socket-qa-only/);
 assert.match(overlay,/inet_server_addr\(\) IS NOT NULL/);
 assert.match(overlay,/SECURITY INVOKER SET search_path=''/);
 assert.match(overlay,/pg_advisory_xact_lock/);
 assert.match(overlay,/FOR SHARE/g);
 assert.match(overlay,/clock_timestamp\(\)/);
 assert.match(overlay,/account_memberships/);
 assert.match(overlay,/mesh_owner_policy/);
 for(const table of ["mesh_invites","mesh_inbox_proofs",
   "mesh_pairing_relay_messages","mesh_pairing_relay_reads",
   "mesh_enrollment_challenges","mesh_devices"])
  assert.ok(overlay.includes("ON katosync."+table),table);
 assert.match(overlay,/BEFORE UPDATE OF last_seen_at/);
 assert.match(overlay,/KATOSYNC_MESH_ACCOUNT_MEMBERSHIP_REQUIRED/);
 assert.match(overlay,/KATOSYNC_MESH_ENTITLEMENT_REQUIRED/);
 assert.doesNotMatch(overlay,/SECURITY DEFINER/);
 assert.doesNotMatch(overlay,/DELETE FROM katosync\.mesh_devices/);
});
test("real disposable SQL includes positive, Free-0, expired, revoked member and emergency device revocation proofs",()=>{
 assert.match(sql,/\\ir mesh_inbox_edge_e2e_setup\.sql/);
 assert.match(sql,/\\ir mesh_stage4e_atomic_write_overlay_qa\.sql/);
 assert.match(sql,/\\ir \.\.\/\.\.\/release-candidates\/stage4e\/qa_only_hardening_candidate\.sql/);
 for(const marker of [
  "KATOSYNC_STAGE4E_ATOMIC_POSITIVE_BOUND_WRITES_PASS",
  "KATOSYNC_STAGE4E_ATOMIC_FREE0_WRITES_BLOCKED_DEVICE_REVOCATION_PASS",
  "KATOSYNC_STAGE4E_ATOMIC_MEMBER_REVOCATION_BLOCKS_WRITE_PASS",
  "KATOSYNC_STAGE4E_ATOMIC_GRANTS_FAIL_CLOSED_PASS",
  "ATOMIC_QA_EXPIRED_TRIAL_ALLOWED",
  "ATOMIC_QA_FREE_INBOX_PROOF_ALLOWED",
  "ATOMIC_QA_FREE_RELAY_WRITE_ALLOWED",
  "ATOMIC_QA_FREE_RELAY_READ_ALLOWED",
  "ATOMIC_QA_FREE_CHALLENGE_ALLOWED",
  "ATOMIC_QA_FREE_HEARTBEAT_ALLOWED"
 ])assert.ok(sql.includes(marker),marker);
 assert.match(sql,/ATOMIC_QA_CANCELLATION_WRONG_DENIAL/);
 assert.doesNotMatch(sql,/SUPABASE_SERVICE_ROLE_KEY|PGHOST=|postgresql:\/\/|https?:\/\//i);
});
test("concurrent revoke race is real PostgreSQL, but socket-only and bounded",()=>{
 assert.match(runner,/quota-stage4e-atomic-writes/);
 assert.match(runner,/listen_addresses=''/);
 assert.match(runner,/MESH_QA_UNEXPECTED_TCP_LISTENER/);
 assert.match(runner,/KATOSYNC_MESH_ATOMIC_RACE_ALLOW=EPHEMERAL_UNIX_SOCKET_ONLY/);
 assert.match(runner,/meshAtomicEntitlementRaceStage4E\.mjs/);
 assert.match(race,/^if\(process\.env\.KATOSYNC_MESH_ATOMIC_RACE_ALLOW/m);
 assert.match(race,/\/tmp\/ksmeshqa/);
 assert.match(race,/pg_try_advisory_lock/);
 assert.match(race,/BEGIN;SET LOCAL ROLE service_role/);
 assert.match(race,/SET policy_expires_at=clock_timestamp\(\)-interval '1 second'/);
 assert.match(race,/KATOSYNC_STAGE4E_ATOMIC_REVOKE_RACE_SERIALIZED_PASS/);
 assert.match(race,/KATOSYNC_STAGE4E_ATOMIC_POST_REVOKE_WRITE_DENIED_PASS/);
 assert.doesNotMatch(race,/https?:\/\/|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
});
test("native Deno tests are isolated from ordinary Node test glob and cannot open network",()=>{
 const names=readdirSync(new URL("../tests/deno/",import.meta.url));
 assert.ok(names.includes("meshEntitlementNativeDenoStage4E.test.ts"));
 assert.ok(names.includes("meshEntrypointDefaultOffStage4E.test.ts"));
 const bridge=read("tests/deno/meshEntitlementNativeDenoStage4E.test.ts");
 const entry=read("tests/deno/meshEntrypointDefaultOffStage4E.test.ts");
 assert.match(bridge,/Deno\.test\(/);
 assert.match(entry,/Deno\.serve/);
 assert.match(entry,/MESH_BOUNDARY_DISABLED/);
 assert.match(entry,/LOGIN_REQUIRED/);
 assert.match(entry,/\/mesh-inbox-send-entitled-qa\/index\.ts/);
 assert.match(entry,/\/mesh-pairing-relay-entitled-qa\/index\.ts/);
 assert.doesNotMatch(entry,/allow-net|listen\(|Deno\.serve\(\{/i);
});
test("old migration files and signed cryptographic handlers remain untouched",()=>{
 const migrations=readdirSync(new URL("../supabase/migrations/",import.meta.url))
  .filter(x=>x.endsWith(".sql"));
 assert.equal(migrations.length,7);
 assert.equal(migrations.some(x=>x.includes("stage4e")),false);
 const oldSource=read("supabase/functions/mesh-inbox-send/send.ts");
 assert.match(oldSource,/verifyStoredSignedMeshInvite/);
 const pinned=read("scripts/qa-mesh-inbox-edge-package-review.mjs");
 assert.match(pinned,/EDGE_SOURCE_HASH_CHANGED_/);
});
