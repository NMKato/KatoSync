// Created by NMKato Solutions
// RC71 source isolation guard. Native Rust integration tests perform real
// loopback HTTP Upgrade and ticket-header inspection on macOS and Windows.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src-tauri/src/mesh_rc71_rc69_ticket_qa.rs', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const harness = readFileSync(new URL('../qa/rc69-presence-harness/src/lib.rs', import.meta.url), 'utf8');

test('RC71 exact private DO route and single-use ticket header, no token-in-URL', () => {
  assert.match(source, /RC69_PRIVATE_ROUTE: &str = "\/private\/rc69\/device-wss"/);
  assert.match(source, /X-KatoSync-Relay-Ticket/);
  assert.match(source, /TICKET_TTL_MS: u64 = 30_000/);
  assert.match(source, /secret\.len\(\) != 64/);
  assert.match(source, /rc69\.challenge/);
  assert.match(source, /rc67-beta-native-v1/);
  assert.doesNotMatch(source, /format!\([^\n]*\?token|format!\([^\n]*\?ticket/);
});

test('RC71 rejects unsigned server challenges without granting devices or dispatching tools', () => {
  assert.match(source, /RC71_UNSIGNED_QA_CHALLENGE_REJECTED/);
  assert.match(source, /close_quarantined_socket/);
  assert.match(source, /RC71_QA_ENDPOINT_REJECTED/);
  assert.match(source, /RC71_QA_TICKET_REJECTED/);
  assert.doesNotMatch(source, /connected_authenticated|deviceAccessEnabled: true|meshConnected: true/);
  assert.doesNotMatch(source, /sign_presence_jws|sign_git_status_result_jws|read_registered_git_status_after_verified_grant|Command::new/);
});

test('RC71 remains isolated QA-only, with no Tauri IPC, auto-start or production listener', () => {
  assert.match(lib, /#\[cfg\(feature = "katoos-auth-qa"\)\]\s*#\[allow\(dead_code\)\]\s*mod mesh_rc71_rc69_ticket_qa;/);
  assert.match(harness, /src-tauri\/src\/mesh_rc71_rc69_ticket_qa\.rs/);
  assert.doesNotMatch(source, /#\[tauri::command\]/);
  assert.doesNotMatch(lib, /mesh_rc71_rc69_ticket_qa::probe_private_rc69_qa_upgrade/);
});

test('RC71 real local handshake and negative replay/auth tests are included in Rust source', () => {
  assert.match(source, /actual_ticket_header_and_unsigned_challenge_are_rejected_fail_closed/);
  assert.match(source, /denies_non_private_path_bad_ticket_or_expired_ticket/);
  assert.match(source, /parses_exact_unsigned_qa_challenge_but_never_trusts_it/);
  assert.match(source, /bad_route_never_reaches_network/);
  assert.match(source, /accept_hdr_async/);
});
