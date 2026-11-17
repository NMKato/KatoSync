// Created by NMKato Solutions
// RC69 is deliberately source-only until server-owned DO WSS challenge/session
// and native device handler are accepted. These are gate/contract tests;
// cryptographic Ed25519 positive/negative tests live in the Rust module.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../src-tauri/src/mesh_rc67_presence_qa.rs', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('RC69 uses owner-authenticated QA feature, no exposed IPC or runtime relay', () => {
  assert.match(lib, /#\[cfg\(feature = "katoos-auth-qa"\)\]\s*#\[allow\(dead_code\)\]\s*mod mesh_rc67_presence_qa;/);
  assert.doesNotMatch(src, /#\[tauri::command\]/);
  assert.doesNotMatch(lib, /mesh_rc67_presence_qa::sign_presence_jws/);
  assert.doesNotMatch(src, /ensure_identity\(/);
  assert.doesNotMatch(src, /WebSocket::connect|TcpListener::bind|reqwest::Client/);
});

test('RC69 native heartbeat matches exact RC67 signed frame, TTL and WSS trust distinction', () => {
  assert.match(src, /katosync-rc67-duplex-relay\+jws/);
  assert.match(src, /const TTL_MS: i64 = 15_000;/);
  for (const name of ['direction:', 'kind:', 'owner_id:', 'tenant_id:', 'grant_id:', 'device_id:', 'session_id:', 'request_id:', 'sequence:', 'issued_at_ms:', 'expires_at_ms:']) {
    assert.ok(src.includes(name), name);
  }
  for (const value of ['device_to_cloud', 'presence.heartbeat', 'outbound-wss', 'rc67-beta-native-v1', 'connected_authenticated', 'EdDSA', 'JWS_TYP']) {
    assert.ok(src.includes(value), value);
  }
  assert.doesNotMatch(src, /nativeMutualTlsVerified\s*:\s*true/);
});

test('RC69 denies write/execute capability advertising and shares existing signing key', () => {
  for (const name of ['katosync_git_status', 'katosync_mesh_peers', 'katosync_list_directory', 'katosync_read_file']) {
    assert.ok(src.includes(name), name);
  }
  const allowlist = src.split('const READ_ONLY_NAMES:')[1]?.split('];')[0] ?? '';
  assert.doesNotMatch(allowlist, /katosync_start_process|katosync_write_file/);
  assert.match(src, /RC67_CAPABILITY_NOT_ADMITTED/);
  assert.match(src, /existing_device_key: &SigningKey/);
  assert.match(src, /mesh_identity::existing_identity/);
  assert.match(src, /wrong_key_fail_signature_validation|wrong_key_fail_signature_validation|tampering_and_wrong_key_fail_signature_validation/);
});
