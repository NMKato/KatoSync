// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/signed_job_qa.rs",import.meta.url),"utf8");
const lease=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa.rs",import.meta.url),"utf8");
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const native=readFileSync(new URL("../.github/workflows/stage4ac-native-macos-qa.yml",import.meta.url),"utf8");
const local=readFileSync(new URL("../src-tauri/src/local_control/agent_scope.rs",import.meta.url),"utf8");

test("one canonical Mesh lease, one QA-only signed job candidate, no parallel session engine",()=>{
 assert.match(lib,/#\[cfg\(feature = "stage4j-qa"\)\]\s*#\[allow\(dead_code\)\]\s*mod mesh_durable_lease_qa;/);
 assert.match(lease,/mod signed_job_qa;/);
 assert.match(source,/use super::MeshLeaseMachine/);
 assert.match(source,/lease\.snapshot\(now\)\.live_peer_authenticated/);
 assert.match(source,/session\.last_sequence == 0/);
 assert.doesNotMatch(source,/struct MeshLeaseMachine|struct PeerSession|TcpListener|TcpStream|TlsConnector|TlsAcceptor|tokio::spawn/);
});
test("exact read-only Git actions, no generic command or OS/UI access",()=>{
 assert.match(source,/enum Action\s*\{[^}]*GitHead\s*=\s*1,\s*GitStatusShort\s*=\s*2/s);
 assert.match(source,/execution_authorized:\s*false/);
 assert.match(source,/requires_native_executor_recheck:\s*true/);
 for(const banned of ["Command::new","std::process","Shell","ExecuteFile","McpCommand","tauri::command","set_var(","open("])
  assert.ok(!source.includes(banned),"Forbidden API or shell token "+banned);
 assert.match(local,/job\.mode != "agent_read_only"/);
 assert.match(local,/if scope\.source != "local"/);
});
test("server signature not spoofable from request-controlled booleans or only paired device",()=>{
 for(const needle of [
  "VerifyingKey","Signature::from_bytes",
  "KatoSync-Stage4AC-signed-readonly-permit-v1",
  "owner_session_id","client_id","project_id",
  "peer_device_public_key","local_device_public_key",
  "expected_head","issued_at_ms","expires_at_ms","owner_step_up_at_ms",
  "owner_session_active","client_device_project_grant_active",
  "REVOCATION_CHECK_MAX_AGE_MS"
 ])assert.ok(source.includes(needle),needle);
 assert.match(source,/pinned_signer\s*\.verify\(/);
 assert.doesNotMatch(source,/\bpub\s+(?:async\s+)?fn\s+propose/);
 assert.doesNotMatch(source,/remote_jobs_enabled:\s*true/);
});
test("idempotency and TTL cannot be omitted from task proposal",()=>{
 for(const phrase of [
  "GRANT_MAX_DURATION_MS","GRANT_MAX_ISSUED_AGE_MS",
  "MAX_LEDGER_ITEMS","ReplayLedger","task_ids.contains","nonces.contains",
  "Denial::Replay","Denial::CapacityExceeded",
  "Denial::ClosedLease","Denial::StaleAuthority"
 ])assert.ok(source.includes(phrase),phrase);
 assert.match(source,/duplicate_task_id_or_nonce_is_denied/);
 assert.match(source,/wrong_signer_and_modified_action_both_fail/);
 assert.match(source,/closed_or_expired_mesh_lease_cannot_dispatch/);
 assert.match(source,/different_owner_or_peer_or_local_device_never_dispatches/);
});
test("native CI exercises real signed-message verification with no deploy",()=>{
 assert.match(native,/mesh_durable_lease_qa::signed_job_qa::tests/);
 assert.match(native,/tests\/meshStage4ACSignedJobContract.test.mjs/);
 assert.match(native,/cargo test --locked/);
 assert.match(native,/STAGE4AC_SIGNED_GRANT_QA_ONLY_NO_REMOTE/);
 assert.doesNotMatch(native,/wrangler deploy|supabase db push|codesign -s|cargo tauri build/);
});
