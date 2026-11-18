// Created by NMKato Solutions
// Source-level assertions for a never-exposed RC69 local Git read adapter.
// Native scope/negative behavior is tested with real Rust source in the
// independent macOS/Windows harness; this test prevents accidental wiring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const native = readFileSync(new URL('../src-tauri/src/mesh_rc69_readonly_qa.rs', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('RC69 local Git reader is feature-gated and has no exposed IPC or MCP handler', () => {
  assert.match(lib, /#\[cfg\(feature = "katoos-auth-qa"\)\]\s*#\[allow\(dead_code\)\]\s*mod mesh_rc69_readonly_qa;/);
  assert.doesNotMatch(native, /#\[tauri::command\]/);
  assert.doesNotMatch(native, /WebSocket|TcpListener|reqwest::Client|shell\s*=|\.spawn\(/);
  assert.doesNotMatch(lib, /mesh_rc69_readonly_qa::read_registered_git_status_after_verified_grant/);
});

test('RC69 Git status uses registered project root, no MCP-provided path or args', () => {
  assert.match(native, /project_registry::project_registry_load\(\)/);
  assert.match(native, /crate::project_registry::run_git/);
  assert.match(native, /fs::canonicalize\(git_root\)/);
  assert.match(native, /if actual != canonical/);
  assert.match(native, /requested_project_id != granted_project_id/);
  for (const arg of ['rev-parse', '--show-toplevel', '--verify', 'HEAD', '--porcelain=v1', '-uno']) {
    assert.ok(native.includes(arg), arg);
  }
});

test('RC69 status receipt excludes source paths and file contents', () => {
  const struct = native.split('pub(crate) struct NativeGitStatus {')[1]?.split('}')[0] ?? '';
  for (const name of ['project_id', 'head_sha', 'branch', 'dirty', 'provenance']) {
    assert.ok(struct.includes(name), name);
  }
  assert.doesNotMatch(struct, /root|path|content|diff|file|token/);
});
