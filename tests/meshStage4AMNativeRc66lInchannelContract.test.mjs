// Stage4AM security contracts: native receiver is confined to cfg(test).
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const native=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/inchannel_qa/stage4am_rc66l_native_qa.rs",import.meta.url),"utf8");
const inchannel=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/inchannel_qa.rs",import.meta.url),"utf8");
const harness=readFileSync(new URL("../tests/native/stage4am/build.rs",import.meta.url),"utf8");
const tls=readFileSync(new URL("../src-tauri/src/mesh_tls.rs",import.meta.url),"utf8");

test("Stage4AM receiver is compiled only for tests and uses canonical authenticated channel",()=>{
  assert.match(inchannel,/#\[cfg\(test\)\][\s\S]{0,180}mod stage4am_rc66l_native_qa;/);
  assert.match(native,/let b = binding\(/);
  assert.match(native,/let mut mesh = lease\(b\)/);
  assert.match(native,/on_verified_channel_heartbeat/);
  assert.match(native,/mesh\.revoked_or_owner_changed\(\)/);
  assert.match(native,/mesh\.snapshot\(Instant::now\(\)\)\.remote_jobs_enabled/);
});
test("transport is a real existing rustls pinned peer, TLS 1.3, and original heartbeat",()=>{
  assert.match(native,/TlsConnector::from\(/);
  assert.match(native,/TlsAcceptor::from\(/);
  assert.match(native,/strict_client_config\(/);
  assert.match(native,/strict_server_config\(/);
  assert.match(native,/MAGIC_REVOKE/);
  assert.match(native,/MAGIC_RECEIPT/);
  assert.match(native,/MAX_JWS: usize = 4096/);
  assert.match(tls,/TLS13_AES_256_GCM_SHA384/);
  assert.match(tls,/WebPkiClientVerifier/);
});
test("signatures and RC66L scope bound to actual native channel, persisted before receipt",()=>{
  assert.match(native,/RC66L_QA_PINNED_MESH_DEVICE_REVOKE/);
  assert.match(native,/RC66L_QA_DEVICE_PERSISTENCE_RECEIPT/);
  assert.match(native,/key\.verify\(/);
  assert.match(native,/uuid_value\(&v, "ownerId"\)/);
  assert.match(native,/b\.local_ed25519/);
  assert.match(native,/b\.peer_ed25519/);
  assert.match(native,/controlPlaneAckSha256/);
  const durableAt=native.search(/persist_revoke\(\s*root,/);
  const receiptAt=native.slice(durableAt).search(/signed_jws\(\s*RECEIPT_TYP/) + durableAt;
  assert.ok(durableAt>0 && receiptAt>durableAt,"persist before device signature");
  assert.match(native,/create_new\(true\)/);
  assert.match(native,/f\.sync_all\(\)/);
  assert.match(native,/File::open\(dir\)/);
});
test("native isolation harness compiles real transport and Mesh source, not a replacement state machine",()=>{
  assert.match(harness,/src-tauri\/src\/mesh_durable_lease_qa\.rs/);
  assert.match(harness,/src-tauri\/src\/mesh_durable_lease_qa\/inchannel_qa\.rs/);
  assert.match(harness,/stage4am_rc66l_native_qa\.rs/);
  assert.doesNotMatch(harness,/struct MeshLeaseMachine|impl MeshLeaseMachine/);
});
test("negative paths include forged issuer, owner/task mixup, truncation, replay and corruption",()=>{
  for(const s of [
    "forged_issuer_or_task_or_owner_on_live_pinned_tls_never_persists",
    "truncated_authenticated_tls_frame_cannot_generate_persisted_receipt",
    "replay_exactly_same_pinned_message_idempotent_but_changed_sequence_denied",
    "corrupted_or_symlinked_marker_remains_poisoned_not_a_grant"
  ])assert.ok(native.includes(s),s);
  assert.doesNotMatch(native,/tauri::command|std::process::Command|child_process|git push|git reset|remoteExecutionAllowed:true|supabase\.from/);
});
