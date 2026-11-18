// Created by NMKato Solutions
// The actual native loopback HTTP upgrade, Ed25519 validation, and policy
// close are executed from Rust QA source by GitHub macOS/Windows matrix.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const q=readFileSync(new URL('../src-tauri/src/mesh_rc71_rc69_ticket_qa.rs',import.meta.url),'utf8');
const pin=readFileSync(new URL('../src-tauri/src/mesh_rc72_signed_server_qa.rs',import.meta.url),'utf8');
const lib=readFileSync(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8');

test('RC73 joins ticketed outbound RC71 WSS to independently pinned RC72 Ed25519 verifier',()=>{
  assert.match(q,/pub\(crate\) async fn probe_private_rc70_pinned_upgrade/);
  assert.match(q,/verify_rc70_challenge_packet/);
  assert.match(q,/PinnedServerContext/);
  assert.match(q,/X-KatoSync-Relay-Ticket/);
  assert.match(q,/RC69_PRIVATE_ROUTE/);
  assert.match(q,/close_quarantined_socket\(&mut socket\)\.await/);
  assert.match(pin,/pin\.verifying_key/);
});

test('RC73 cannot claim authenticated device or execute/read local tools, even after verified JWS',()=>{
  const contract=q.split('pub(crate) async fn probe_private_rc70_pinned_upgrade')[1]?.split('#[cfg(test)]')[0]??'';
  assert.ok(contract.includes('verify_rc70_challenge_packet'));
  assert.ok(contract.includes('close_quarantined_socket'));
  assert.doesNotMatch(contract,/sign_presence_jws|sign_git_status_result_jws|read_registered_git_status_after_verified_grant|keyring|\.send\(|Command::new\(/);
  assert.doesNotMatch(lib,/mesh_rc71_rc69_ticket_qa::probe_private_rc70_pinned_upgrade/);
});

test('RC73 actual native WebSocket crypto QA covers positive pin, bad pin, replay, wrong session, unsigned proof',()=>{
  assert.match(q,/real_ticketed_wss_verifies_signed_rc70_challenge_but_closes_qa_socket/);
  assert.match(q,/real_ticketed_wss_denies_wrong_pin_replay_wrong_session_and_unsigned_proof/);
  assert.match(q,/accept_hdr_async/);
  assert.match(q,/CloseCode::Policy/);
  assert.match(q,/for mode in 1\.\.=4/);
});
