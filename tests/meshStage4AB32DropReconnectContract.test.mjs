import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const base = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, base), "utf8");
const fault = read("src-tauri/src/mesh_fault_reconnect_qa.rs");
const supervisor = read("src-tauri/src/mesh_live_supervisor_qa.rs");
const lib = read("src-tauri/src/lib.rs");
const lease = read("src-tauri/src/mesh_durable_lease_qa.rs");

test("AB3.2A is compiled only in QA and requires the new fifth opt-in", () => {
  assert.match(lib, /#\[cfg\(feature = "stage4j-qa"\)\]\s*mod mesh_fault_reconnect_qa;/);
  assert.match(lib, /--stage4ab32-drop-reconnect-qa-once/);
  assert.match(fault, /KATOSYNC_STAGE4AB32_DROP_RECONNECT_QA_ONCE/);
  assert.match(fault, /OWNER_LAUNCHED_DROP_RECONNECT_QA_ONLY/);
  assert.match(fault, /KATOSYNC_STAGE4AB3_RECONNECT_QA_TWICE/);
  assert.match(fault, /MESH_STAGE4AB32_PREVIOUS_REAUTH_QA_OPT_IN_REQUIRED/);
  assert.match(fault, /SingleQaPermit::acquire/);
  assert.doesNotMatch(fault.split("\n").filter(s=>!s.trimStart().startsWith("//")).join("\n"),
    /#\[tauri::command\]|Command::new\(|LaunchAgent|std::fs|remote_job|cross_device_write/);
});

test("real open TLS server channel drops after the first verified heartbeat", () => {
  assert.match(supervisor, /QaFault::ServerDropAfterFirstAuthenticatedHeartbeat/);
  assert.match(supervisor, /lease\.verified_in_channel_heartbeat\(seq, Instant::now\(\)\)\?;\s*if seq == 1 && fault/);
  assert.match(supervisor, /lease\.on_network_loss\(\)/);
  assert.match(supervisor, /MESH_STAGE4AB32_VERIFIED_TLS_STREAM_INTENTIONALLY_DROPPED/);
  assert.match(supervisor, /heartbeat_server\(&mut tls, seq, &session, &admitted, peer_fingerprint\)\.await\?/);
});

test("client must independently observe TLS IO closure, never fake success", () => {
  assert.match(supervisor, /ClientRequireUnexpectedTlsClose/);
  assert.match(supervisor, /Err\(error\) if error == "MESH_STAGE4AB2_HEARTBEAT_IO"/);
  assert.match(supervisor, /MESH_STAGE4AB32_REMOTE_TLS_CLOSED_AFTER_AUTHENTICATED_HB/);
  assert.match(supervisor, /MESH_STAGE4AB32_EXPECTED_DROP_DID_NOT_HAPPEN/);
  assert.match(fault, /observed_expected_drop\(&args\[0\], &error\)/);
  assert.match(fault, /MESH_STAGE4AB32_MISSING_EXPECTED_STREAM_DROP/);
});

test("exactly one reauthorized pinned TLS session after confirmed stream loss", () => {
  assert.match(fault, /run_fault_under_existing_qa_permit\(\s*&permit,\s*args\.clone\(\),\s*injected,\s*\)\s*\.await/);
  assert.match(fault, /run_once_under_existing_qa_permit\(&permit, args\)\.await\?/);
  assert.match(supervisor, /require_all_opt_ins\(\)\?/);
  assert.match(supervisor, /mesh_admission::authorize\(peer_fingerprint\)/);
  assert.match(supervisor, /verify_live_tailnet\(local, peer\)\.await\?/);
  assert.match(supervisor, /client_session_init\(&mut tls, new_nonce\(\)\)/);
  assert.match(supervisor, /server_session_init\(&mut tls, new_nonce\(\)\)/);
  assert.match(lease, /impl Drop for LiveTlsLease/);
  assert.match(fault, /MAX_TEST_DURATION: Duration = Duration::from_secs\(175\)/);
});

test("role cross-pairing denied; no remote jobs or production retry", () => {
  assert.match(supervisor, /MESH_STAGE4AB32_ROLE_OR_FAULT_DENIED/);
  assert.match(fault, /MESH_STAGE4AB32_CONCURRENT_QA_DENIED/);
  for (const name of ["MESH_STAGE4AB2_TLS_REJECTED","MESH_STAGE4AB2_CERT_PIN_DENIED", "MESH_STAGE4AB2_ADMISSION_REVOKED"]) {
    assert.ok(fault.includes(name));
  }
  assert.match(lease, /remote_jobs_enabled: false/);
  assert.match(lease, /cross_device_writes: false/);
});
