// Created by NMKato Solutions
// The trusted WSS adapter does not exist yet; these tests guard the exact
// QA-only native Git result JWS envelope against accidental tool promotion.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src-tauri/src/mesh_rc69_result_qa.rs', import.meta.url), 'utf8');
const presence = readFileSync(new URL('../src-tauri/src/mesh_rc67_presence_qa.rs', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('RC69 tool.result signer shares the existing RC67 compact EdDSA frame encoder', () => {
  assert.match(source, /sign_compact_wire_frame/);
  assert.match(presence, /pub\(crate\) fn sign_compact_wire_frame/);
  for (const v of ['device_to_cloud', 'tool.result', 'katosync_git_status', 'request_id: ctx.request_id', 'session_id: ctx.session_id']) {
    assert.ok(source.includes(v), v);
  }
  assert.match(source, /TTL_MS: i64 = 15_000/);
});

test('RC69 result is native Git-status only and refuses unverified values', () => {
  assert.match(source, /result: &'a NativeGitStatus/);
  assert.match(source, /RC69_RESULT_TOOL_NOT_ADMITTED/);
  assert.match(source, /RC69_RESULT_UNVERIFIED_SOURCE/);
  assert.match(source, /local_git_verified_root/);
  assert.doesNotMatch(source, /Command::new|\.spawn\(|TcpListener|WebSocket|reqwest::Client/);
});

test('RC69 signed result is not exposed as IPC, shell or live MCP handler', () => {
  assert.match(lib, /#\[cfg\(feature = "katoos-auth-qa"\)\]\s*#\[allow\(dead_code\)\]\s*mod mesh_rc69_result_qa;/);
  assert.doesNotMatch(source, /#\[tauri::command\]/);
  assert.doesNotMatch(lib, /mesh_rc69_result_qa::sign_git_status_result_jws/);
});
