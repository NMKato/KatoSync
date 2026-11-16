import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root = new URL("../", import.meta.url);
const s = readFileSync(new URL("src-tauri/src/mesh_live_supervisor_qa.rs", root), "utf8");
const a = readFileSync(new URL("src-tauri/src/mesh_admission.rs", root), "utf8");
const l = readFileSync(new URL("src-tauri/src/lib.rs", root), "utf8");
const lease = readFileSync(new URL("src-tauri/src/mesh_durable_lease_qa.rs", root), "utf8");
const tailnet = readFileSync(new URL("src-tauri/src/mesh_tailnet_qa.rs", root), "utf8");

test("QA-only triple-opt-in; no automatic or Tauri IPC device command", () => {
  assert.match(l, /\#\[cfg\(feature = "stage4j-qa"\)\]\s*mod mesh_live_supervisor_qa;/);
  assert.match(l, /--stage4ab2-live-qa-once/);
  assert.match(s, /OWNER_LAUNCHED_LIVE_QA_ONLY/);
  assert.match(s, /require_owner_opt_ins\(\)/);
  assert.match(s, /SingleQaPermit::acquire/);
  const withoutComments=s.split("\n").filter(line=>!line.trimStart().startsWith("//")).join("\n");
  assert.doesNotMatch(withoutComments, /\#\[tauri::command\]|LaunchAgent|Command::new\(|std::fs|remote_job|execute_command/);
});
test("retain Stage4AA Tailnet and KatoOS owner pin enrollment policy independently of transport", () => {
  assert.match(s,/verify_live_tailnet\(local, peer\)\.await/);
  assert.match(s,/policy\(&args\[1\], &args\[2\], port\)/);
  assert.match(s,/mesh_admission::authorize\(peer_fingerprint\)/);
  assert.match(s,/mesh_admission::recheck_after_probe\(&admitted, peer_fingerprint\)/);
  assert.match(s,/strict_client_config\(&identity, &admitted.approved_peer, &server_cert\)/);
  assert.match(s,/strict_server_config\(&identity, &admitted.approved_peer, &client_cert\)/);
  assert.match(s,/SocketAddrV4::new\(local, port\)/);
  assert.match(s,/source\.ip\(\) != IpAddr::V4\(peer\)/);
  assert.match(s,/socket\.local_addr\(\)/);
  assert.match(tailnet,/100.*64.*127/);
  assert.match(a,/MESH_ADMISSION_ENROLLMENT_REVOKED/);
});
test("only existing open mTLS stream with nonce, sequence, timeout and lease can prove liveness", () => {
  for(const phrase of ["TlsAcceptor", "TlsConnector", "client_session_init", "server_session_init",
    "KSM2HELO", "KSM2ACK!", "KSM2PING", "KSM2PONG", "HEARTBEAT_COUNT: u64 = 3",
    "BOUNDED_QA_MAX", "LiveTlsLease::after_verified_open_channel",
    "lease.verified_in_channel_heartbeat", "lease.close()", "timeout(FRAME_TIMEOUT",
    "receipt.sequence <= session.last_sequence"]) {
    assert.ok((s + lease).includes(phrase),phrase);
  }
  assert.match(s, /verify_heartbeat_frame\(&response, HB_ACK_TAG, sequence, session\)/);
  assert.match(s, /verify_heartbeat_frame\(&request, HB_TAG, sequence, session\)/);
  assert.match(s, /server_session_init\(&mut tls, new_nonce\(\)\)/);
  assert.match(s, /client_session_init\(&mut tls, new_nonce\(\)\)/);
});
test("encrypted bounded protocol has replay mismatch and forged ack negative unit tests", () => {
  for(const caseName of [
    "authenticated_stream_frames_bind_nonce_and_strictly_ordered_sequence",
    "forged_server_ack_is_rejected_before_lease_creation",
    "raw_heartbeat_frames_reject_replayed_sequence_or_wrong_session"
  ]) assert.ok(s.includes("fn " + caseName + "("),caseName);
  assert.match(s,/MESH_STAGE4AB2_HEARTBEAT_REPLAY_OR_MISMATCH/);
  assert.match(s,/MESH_STAGE4AB2_BAD_INIT_ACK/);
});
