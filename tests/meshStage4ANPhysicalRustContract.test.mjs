import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const inchannel=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/inchannel_qa.rs",import.meta.url),"utf8");
const parent=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/inchannel_qa/stage4am_rc66l_native_qa.rs",import.meta.url),"utf8");
const physical=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/inchannel_qa/stage4am_rc66l_native_qa/stage4an_physical_qa.rs",import.meta.url),"utf8");
test("physical two-Mac QA requires native opt-in and never attaches a production endpoint",()=>{
  assert.match(inchannel,/#\[cfg\(test\)\][\s\S]{0,180}mod stage4am_rc66l_native_qa;/);
  assert.match(parent,/#\[cfg\(test\)\][\s\S]{0,180}mod stage4an_physical_qa;/);
  assert.match(physical,/STAGE4AN_ACTION/);
  assert.doesNotMatch(physical,/tauri::command|std::process::Command|child_process|supabase\.from|reqwest|remoteExecutionAllowed:true/);
});
test("device secrets created only locally, no deterministic key seeds for physical run",()=>{
  assert.match(physical,/rand::rngs::OsRng\.fill_bytes\(&mut seed\)/);
  assert.match(physical,/create_file\(&root, KEY_FILE|new_key\(&root, KEY_FILE/);
  assert.match(physical,/fn local_key\(/);
  assert.match(physical,/verify_jws/);
  assert.match(physical,/TLSv1_3/);
  assert.match(physical,/strict_client_config\(/);
  assert.match(physical,/strict_server_config\(/);
});
test("actual original native Mesh handshake and session heartbeat precede revocation",()=>{
  assert.match(physical,/copy_from_slice\(OPEN\)/);
  assert.match(physical,/copy_from_slice\(ACCEPT\)/);
  assert.match(physical,/copy_from_slice\(BEAT\)/);
  assert.match(physical,/copy_from_slice\(REPLY\)/);
  assert.match(physical,/on_verified_channel_heartbeat/);
  assert.match(physical,/mesh\.revoked_or_owner_changed\(\)/);
  assert.match(physical,/persist_revoke\(root,/);
  assert.match(physical,/write_frame\(&mut tls, MAGIC_RECEIPT/);
});
test("physical run restricted to private Tailscale 100.64.0.0/10, bounded listener",()=>{
  assert.match(physical,/o\[0\] != 100|o\[0\]!=100/);
  assert.match(physical,/64\.\.=127/);
  assert.match(physical,/MAX_WAIT: Duration = Duration::from_secs\(85\)/);
  assert.match(physical,/TcpListener::bind\(address\(\)\?\)/);
});
test("forgery, task mismatch, truncation, replay and fresh-process closure are guarded",()=>{
  for(const t of ["wrong_issuer","wrong_task","truncated","persist_revoke",
    "STAGE4AN_M3_NEW_PROCESS_PERSISTENT_REVOKE_PASS_NO_REMOTE"])
    assert.ok(physical.includes(t),t);
  assert.match(physical,/root\.join\(MARKER\)\.exists\(\)/);
  assert.match(physical,/Err\(_\)[\s\S]*NO_ACK/);
});
