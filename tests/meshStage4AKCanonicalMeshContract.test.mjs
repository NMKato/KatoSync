// Stage4AK: contract that the real Rust MeshLeaseMachine stays fail-closed.
// These are static checks; native Rust QA below exercises its actual source.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root = new URL("../src-tauri/src/",import.meta.url);
const core = readFileSync(new URL("mesh_durable_lease_qa.rs",root),"utf8");
const bridge = readFileSync(new URL("mesh_durable_lease_qa/stage4ak_revoke_qa.rs",root),"utf8");
const harness=readFileSync(new URL("../tests/native/stage4ak/build.rs",import.meta.url),"utf8");
test("Stage4AK canonical Mesh source only invokes bridge with cfg(test), no production endpoint",()=>{
  assert.match(core,/#\[cfg\(test\)\]\s*#\[path = "mesh_durable_lease_qa\/stage4ak_revoke_qa\.rs"\]\s*mod stage4ak_revoke_qa;/);
  assert.match(core,/fn revoked_or_owner_changed\(&mut self\)/);
  assert.match(core,/self\.drop_channel\(MeshLinkState::Revoked\)/);
  assert.doesNotMatch(bridge,/tauri::command|TcpListener|TcpStream|reqwest::|std::process::Command/);
});
test("Stage4AK standalone Rust harness extracts original canonical machine, never mocks state",()=>{
  assert.match(harness,/src-tauri\/src\/mesh_durable_lease_qa\.rs/);
  assert.match(harness,/mod inchannel_qa;/);
  assert.match(harness,/mod signed_job_qa;/);
  assert.match(harness,/mesh_durable_lease_qa_stage4ak\.rs/);
  assert.doesNotMatch(harness,/impl MeshLeaseMachine|struct MeshLeaseMachine/);
});
test("pinned signer, exact scope and current binding precede canonical revoke and disk sync",()=>{
  assert.match(bridge,/pinned_control_plane\s*\.verify\(/);
  assert.match(bridge,/s\.rc66k_ack_sha256\s*!=\s*expected\.rc66k_ack_sha256/);
  assert.match(bridge,/active\.binding != expected\.binding/);
  assert.match(bridge,/mesh\.revoked_or_owner_changed\(\)/);
  assert.match(bridge,/\.create_new\(true\)/);
  assert.match(bridge,/f\.sync_all\(\)/);
  assert.match(bridge,/fn restart_closed\(/);
});
test("canonical Rust QA explicitly tests actual live→revoked state and restart closure",()=>{
  for(const marker of [
    "real_canonical_mesh_lease_is_terminated_only_after_signed_scope_verification",
    "foreign_signer_and_wrong_owner_device_session_or_rc66k_digest_never_mutate_live_lease",
    "duplicate_signed_revoke_is_sticky_and_never_reopens_mesh",
    "absent_marker_restart_stays_closed_pending_fresh_server_authority",
    "expired_signature_or_untrusted_directory_cannot_restart_an_active_lease"
  ])assert.ok(bridge.includes(marker),marker);
  assert.match(bridge,/MeshLinkState::Revoked/);
  assert.match(core,/remote_jobs_enabled: false/);
});
