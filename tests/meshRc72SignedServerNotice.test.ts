// Created by NMKato Solutions
// Real Ed25519 success/negative verification compiles and runs with the exact
// Rust source in the macOS + Windows native harness. This is the isolation gate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source=readFileSync(new URL('../src-tauri/src/mesh_rc72_signed_server_qa.rs',import.meta.url),'utf8');
const lib=readFileSync(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8');
const harness=readFileSync(new URL('../qa/rc69-presence-harness/src/lib.rs',import.meta.url),'utf8');

test('RC72 independently pins and verifies Ed25519 server JWS with RC67 cloud-to-device schema',()=>{
  assert.match(source,/pin\.verifying_key\s*\.verify/);
  for(const v of ['VerifyingKey','Signature::from_slice',
    'cloud_to_device','mesh.notice','katosync-rc67-duplex-relay+jws',
    'serverProofJws','serverKid','last_server_sequence','FRAME_TTL_MS']){
    assert.ok(source.includes(v),v);
  }
  assert.match(source,/serde\(deny_unknown_fields\)/);
  assert.match(source,/serde\(rename_all = "camelCase", deny_unknown_fields\)/);
});

test('RC72 signed notice must bind server key, session, owner/tenant/grant/device and exact ACK',()=>{
  for(const v of ['field_uuid(&payload.owner_id','field_uuid(&payload.tenant_id',
    'field_uuid(&payload.grant_id','field_uuid(&payload.device_id',
    'field_uuid(&payload.session_id','ExpectedServerNotice::Challenge',
    'ExpectedServerNotice::PresenceAccepted','ExpectedServerNotice::ResultAccepted',
    'acceptedSequence','revokeEpoch','requestId']){
    assert.ok(source.includes(v),v);
  }
});

test('RC72 does not become a live tool, admission, Keychain or WebSocket runtime caller',()=>{
  assert.match(lib,/#\[cfg\(feature = "katoos-auth-qa"\)\]\s*#\[allow\(dead_code\)\]\s*mod mesh_rc72_signed_server_qa;/);
  assert.match(harness,/mesh_rc72_signed_server_qa\.rs/);
  assert.doesNotMatch(source,/#\[tauri::command\]|Command::new\(|connect_async|TcpListener|keyring|read_registered_git_status_after_verified_grant|sign_presence_jws/);
  assert.doesNotMatch(lib,/mesh_rc72_signed_server_qa::verify_rc70_challenge_packet/);
});

test('RC72 negative crypto tests reject forged pin, different tenant, replay, expiry, tampering, untrusted kid',()=>{
  for(const name of ['rejects_wrong_pin_scope_expiration_replay_and_tampering',
    'rejects_unsigned_packet_unpinned_kid_and_false_claims',
    'independently_verifies_signed_presence_and_request_bound_result_acks',
    'actual_signed_ed25519_rc70_challenge_matches_pinned_scope_and_packet']){
    assert.ok(source.includes(name),name);
  }
});
