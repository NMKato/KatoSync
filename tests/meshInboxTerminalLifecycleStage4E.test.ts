// NMKato Solutions: QA-only inbox terminal lifecycle, never a live migration.
// Real PG17 behavior is covered by the separate hermetic runner.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const get=(name:string)=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
const hash=(name:string)=>{
 const raw=get(name);
 assert.equal(/\r(?!\n)/.test(raw),false,"noncanonical lone CR in "+name);
 // Git's canonical LF blob is the SHA-pinned object on all OSes, even when
 // Git-for-Windows materializes a CRLF working tree.
 return createHash("sha256").update(raw.replace(/\r\n/g,"\n")).digest("hex");
};
const generator=get("scripts/qa-mesh-inbox-lifecycle-overlay.mjs");
const fixture=get("tests/sql/mesh_inbox_terminal_lifecycle_disposable_qa.sql");
const runner=get("scripts/qa-mesh-postgres-local.sh");
const race=get("tests/qa/meshInboxLifecycleRaceStage4E.mjs");

test("all original historic inbox and Stage4E SQL acceptance guards remain immutable",()=>{
 assert.equal(hash("tests/fixtures/migrations/20261030072543_mesh_recipient_signed_inbox_atomic_decisions.sql"),
  "ca57d61435f7f3620ec2f311d93a188210ef12d25ac7a520f74b781ac634197e");
 assert.equal(hash("tests/fixtures/migrations/20261030074910_mesh_resolution_proof_binding.sql"),
  "cd1b2e9c1e52b28e7012f4cccaf5ce193c5f6e317ee190e28e272d4d5bab8281");
 assert.equal(hash("tests/sql/mesh_stage4e_atomic_write_overlay_qa.sql"),
  "a1afad3bb0327456155774b2393d921366733c4abb915e7f5e88457052ef085b");
 const historic=get("tests/fixtures/migrations/20261030093323_mesh_inbox_recipient_key_continuity.sql");
 assert.match(historic,/mesh_inbox_recipient_key_resolution_guard/);
 assert.match(historic,/p\.signing_public_key=d\.signing_public_key/);
});
test("Windows CRLF changes checkout bytes, but never the SHA-pinned canonical Git source",()=>{
 const original=get("tests/sql/mesh_stage4e_atomic_write_overlay_qa.sql");
 const lf=original.replace(/\r\n/g,"\n");
 const crlf=lf.replace(/\n/g,"\r\n");
 const expected="a1afad3bb0327456155774b2393d921366733c4abb915e7f5e88457052ef085b";
 const checksum=(value:string)=>createHash("sha256").update(value).digest("hex");
 assert.equal(checksum(lf),expected);
 assert.notEqual(checksum(crlf),expected,"Windows materialization must be distinguishable");
 assert.equal(checksum(crlf.replace(/\r\n/g,"\n")),expected);
 assert.notEqual(checksum(crlf.replace(/\r\n/g,"\n").replace(
  "KATOSYNC_MESH_ENTITLEMENT_REQUIRED","ALTERED_ENTITLEMENT_GUARD")),expected);
});

test("QA synthesis validates pinned baseline, patches only exact terminal branch and cleans up",()=>{
 for(const name of ["mesh_inbox_resolution_guard","mesh_inbox_resolution_proof_guard",
  "mesh_atomic_write_entitlement_qa"])
  assert.ok(generator.includes(name),name);
 for(const marker of ["KATOSYNC_INBOX_LIFECYCLE_DISPOSABLE_REQUIRED",
  "KATOSYNC_INBOX_LIFECYCLE_UNEXPECTED_DIRECTORY",
  "KATOSYNC_INBOX_LIFECYCLE_SHA_PINNED_OVERRIDE_PREPARED",
  "LOCAL_DISPOSABLE_PG17","unix-socket-qa-only",
  "KATOSYNC_MESH_INBOX_INVALID_TERMINAL",
  "KATOSYNC_MESH_INBOX_TERMINAL_PROOF_MISMATCH",
  "KATOSYNC_MESH_ATOMIC_TERMINAL_DENIED"])
  assert.ok(generator.includes(marker),marker);
 assert.match(generator,/\^\\\/tmp\\\/ksmeshqa/);
 assert.match(generator,/pg_catalog\.inet_server_addr\(\) IS NOT NULL/);
 assert.match(generator,/current_user<>'service_role'/);
 assert.match(generator,/p_old\.state IS DISTINCT FROM 'pending'/);
 assert.match(generator,/p_old\.resolution_proof_id IS NOT NULL/);
 assert.match(generator,/p_new\.resolution_proof_id IS NOT NULL/);
 assert.match(generator,/pg_catalog\.to_jsonb\(p_old\)-'state'-'resolved_at'/);
 assert.match(generator,/pg_catalog\.to_jsonb\(p_new\)-'state'-'resolved_at'/);
 assert.match(generator,/CREATE OR REPLACE FUNCTION/);
 assert.match(generator,/new\.state IN \('cancelled','expired'\)/i);
 assert.match(generator,/writeFileSync\(destination,pieces\.join/);
 assert.doesNotMatch(generator,/supabase db push|functions deploy|SUPABASE_SERVICE_ROLE_KEY/i);
});
test("QA generator refuses invocation without exact local ephemeral PG17 context",()=>{
 const path=new URL("../scripts/qa-mesh-inbox-lifecycle-overlay.mjs",import.meta.url);
 for(const [vars,args] of [
  [{},["/tmp/not-disposable.sql"]],
  [{KATOSYNC_INBOX_LIFECYCLE_QA_ONLY:"LOCAL_DISPOSABLE_PG17"},["/tmp/not-disposable.sql"]],
  [{KATOSYNC_INBOX_LIFECYCLE_QA_ONLY:"LOCAL_DISPOSABLE_PG17"},[
    "/tmp/ksmeshqa.ABCDEF/../unsafe.sql"]]
 ] as const){
  const r=spawnSync(process.execPath,[fileURLToPath(path),...args],{
   encoding:"utf8",timeout:2000,env:{...process.env,...vars}});
  assert.notEqual(r.status,0,"unsafe generator invocation succeeded");
  assert.equal(r.stdout,"","unsafe generator produced output");
 }
});
test("a closure is owner and request scoped; audit and nonreplay are transactionally bound",()=>{
 assert.match(generator,/mesh_inbox_terminal_close_qa\(/);
 assert.match(generator,/WHERE i\.owner_user_id=p_owner AND i\.request_id=p_request FOR UPDATE/);
 assert.match(generator,/WHERE owner_user_id=p_owner AND request_id=p_request/);
 assert.match(generator,/mesh_inbox_lifecycle_audit_qa/);
 assert.match(generator,/AFTER UPDATE OF state ON katosync\.mesh_invites/);
 assert.match(generator,/request_id uuid NOT NULL UNIQUE/);
 assert.match(generator,/previous_state text NOT NULL CHECK\(previous_state='pending'\)/);
 assert.match(generator,/terminal_state text NOT NULL CHECK\(terminal_state IN \('cancelled','expired'\)\)/);
 assert.match(generator,/RETURN 'already_closed'/);
 assert.match(generator,/RETURN 'not_pending'/);
 assert.match(generator,/RETURN 'wrong_deadline'/);
 assert.match(generator,/p_new\.resolved_at < t-interval '5 seconds'/);
 assert.match(generator,/p_new\.resolved_at > t\+interval '2 seconds'/);
});
test("real PG fixture enforces original signed decision, expiry/revocation, audit, privileges",()=>{
 assert.match(fixture,/\\ir mesh_inbox_edge_e2e_setup\.sql/);
 assert.match(fixture,/\\ir mesh_stage4e_atomic_write_overlay_qa\.sql/);
 assert.match(fixture,/\\i :inbox_lifecycle_overlay/);
 for(const marker of [
  "KATOSYNC_INBOX_LIFECYCLE_LEGACY_SIGNED_DECISION_UNCHANGED_PASS",
  "KATOSYNC_INBOX_LIFECYCLE_OWNER_SCOPE_PAYLOAD_LOCK_PASS",
  "KATOSYNC_INBOX_LIFECYCLE_CANCEL_EXPIRE_AFTER_REVOCATION_PASS",
  "KATOSYNC_INBOX_LIFECYCLE_CLIENT_GRANTS_AND_AUDIT_PASS",
  "KATOSYNC_INBOX_LIFECYCLE_CONCURRENT_FIXTURE_READY",
  "INBOX_LIFECYCLE_CANCEL_NOT_IDEMPOTENT",
  "INBOX_LIFECYCLE_EXPIRE_NOT_IDEMPOTENT",
  "INBOX_LIFECYCLE_PREEXISTING_DECISION_REWRITTEN",
  "INBOX_LIFECYCLE_CANCEL_REOPENED",
  "INBOX_LIFECYCLE_SIGNED_PAYLOAD_MUTATED"])
  assert.ok(fixture.includes(marker),marker);
 assert.doesNotMatch(fixture,/https?:\/\/|SUPABASE_SERVICE_ROLE_KEY|pg_net|dblink/i);
});
test("race test uses two different local sessions, row lock and checks exact winning state",()=>{
 assert.match(runner,/inbox-lifecycle\) TEST_FILE=/);
 assert.match(runner,/KATOSYNC_INBOX_LIFECYCLE_QA_ONLY=LOCAL_DISPOSABLE_PG17/);
 assert.match(runner,/KATOSYNC_INBOX_LIFECYCLE_RACE_ALLOW=LOCAL_DISPOSABLE_PG17/);
 assert.match(runner,/listen_addresses=''/);
 assert.match(runner,/MESH_QA_UNEXPECTED_TCP_LISTENER/);
 assert.ok(race.includes('ksmeshqa'), 'no protected disposable socket pattern');
 assert.match(race,/SELECT request_id FROM katosync\.mesh_invites/);
 assert.match(race,/FOR UPDATE/);
 assert.match(race,/SELECT pg_sleep\(1\.6\)/);
 assert.match(race,/const first=launch/);
 assert.match(race,/const second=launch/);
 assert.match(race,/LATE_RECIPIENT_DECISION_DENIED_PASS/);
 assert.match(race,/IDEMPOTENT_AUDIT_NO_DUPLICATE_PASS/);
});
test("no new deployed migration or public Edge function, no client rights granted",()=>{
 const migrations=readdirSync(new URL("../supabase/migrations/",import.meta.url)).filter(x=>x.endsWith(".sql"));
 assert.equal(migrations.length,7);
 assert.doesNotMatch(generator,/GRANT EXECUTE ON FUNCTION katosync\.mesh_inbox_terminal_close_qa\(uuid,uuid,text\)[\s\S]*?TO authenticated/);
 assert.match(generator,/REVOKE ALL ON FUNCTION katosync\.mesh_inbox_terminal_close_qa\(uuid,uuid,text\)/);
 assert.match(generator,/ALTER TABLE katosync\.mesh_inbox_lifecycle_audit_qa ENABLE ROW LEVEL SECURITY/);
});
