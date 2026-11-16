import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root = new URL("../", import.meta.url);
const reconnect = readFileSync(new URL("src-tauri/src/mesh_reconnect_qa.rs", root), "utf8");
const supervisor = readFileSync(new URL("src-tauri/src/mesh_live_supervisor_qa.rs", root), "utf8");
const lease = readFileSync(new URL("src-tauri/src/mesh_durable_lease_qa.rs", root), "utf8");
const entry = readFileSync(new URL("src-tauri/src/lib.rs", root), "utf8");

test("AB3 CLI is QA-only with distinct fourth opt-in and no WebIPC or daemon", () => {
  assert.match(entry, /#\[cfg\(feature = "stage4j-qa"\)\]\s*mod mesh_reconnect_qa;/);
  assert.match(entry, /--stage4ab3-reconnect-qa-twice/);
  assert.match(reconnect, /KATOSYNC_STAGE4AB3_RECONNECT_QA_TWICE/);
  assert.match(reconnect, /OWNER_LAUNCHED_REAUTH_TWICE_QA_ONLY/);
  assert.doesNotMatch(reconnect.split("\n").filter(s => !s.trimStart().startsWith("//")).join("\n"),
    /#\[tauri::command\]|LaunchAgent|Command::new\(|std::fs|execute_command|remote_job/);
});

test("two distinct open sessions are authorized, measured and closed under one QA concurrency guard", () => {
  assert.match(reconnect, /SingleQaPermit::acquire/);
  assert.match(reconnect, /for cycle in 0\.\.2/);
  assert.match(reconnect, /run_once_under_existing_qa_permit\(&_permit, args\.clone\(\)\)\.await/);
  assert.match(reconnect, /FIRST_MTLS_SESSION_CLOSED_VERIFIED/);
  assert.match(supervisor, /pub\(crate\) async fn run_once_under_existing_qa_permit\(_permit: &SingleQaPermit/);
  assert.match(supervisor, /require_all_opt_ins\(\)\?/);
  assert.match(supervisor, /server_session_init\(&mut tls, new_nonce\(\)\)/);
  assert.match(supervisor, /client_session_init\(&mut tls, new_nonce\(\)\)/);
  assert.match(supervisor, /mesh_admission::recheck_after_probe\(&admitted, peer_fingerprint\)/);
  assert.match(supervisor, /lease\.close\(\)/);
  assert.match(lease, /impl Drop for LiveTlsLease/);
});

test("revocation and lost connectivity clear current TLS authentication without remote rights", () => {
  for(const needle of [
    "on_owner_or_peer_revoked", "on_sleep_or_wake", "on_network_loss",
    "self.machine.revoked_or_owner_changed()", "self.machine.sleep_or_wake()", "self.machine.network_lost()",
    "remote_jobs_enabled: false", "remote_read_only_dispatch: false", "cross_device_writes: false"
  ]) assert.ok(lease.includes(needle),needle);
  assert.ok(lease.includes("fn stage4ab3_qa_bridge_revocation_sleep_and_network_loss_fail_closed("));
});

test("future retry policy rejects changed owner and limits exponential time backoff", () => {
  for (const needle of [
    "classify_retry(", "StopRevoked", "StopBudgetExceeded", "StopPermissionDenied",
    "Duration::from_secs(2)", "Duration::from_secs(4)", "Duration::from_secs(8)"
  ]) assert.ok(reconnect.includes(needle),needle);
  assert.match(reconnect, /MAX_TEST_DURATION: Duration = Duration::from_secs\(235\)/);
  assert.match(reconnect, /Any failure closes the socket and stops WITHOUT fallback/);
});
