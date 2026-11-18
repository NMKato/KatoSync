// Created by NMKato Solutions
// RC70 source gate. Real websocket handshake, disconnect, and negative payload
// tests compile and run from the exact native Rust source in GitHub matrix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const native = readFileSync(new URL('../src-tauri/src/mesh_rc70_outbound_wss_qa.rs', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');

test('RC70 outbound relay is QA feature only, never auto-started and has no IPC', () => {
  assert.match(lib, /#\[cfg\(feature = "katoos-auth-qa"\)\]\s*#\[allow\(dead_code\)\]\s*mod mesh_rc70_outbound_wss_qa;/);
  assert.doesNotMatch(lib, /mesh_rc70_outbound_wss_qa::supervise_quarantined_outbound_wss/);
  assert.doesNotMatch(native, /#\[tauri::command\]/); // TCP listener exists only in #[cfg(test)] mock server.
});

test('RC70 pinned WSS remote endpoint, TLS roots, payload cap and bounded retry', () => {
  assert.match(native, /RELAY_HOST: &str = "remote-mcp\.katoos\.de"/);
  assert.match(native, /MAX_SIGNED_FRAME_BYTES: usize = 24_576/);
  assert.match(native, /MAX_RECONNECT_DELAY: Duration = Duration::from_secs\(16\)/);
  assert.match(native, /rustls|connect_async_with_config/);
  assert.match(cargo, /tokio-tungstenite = \{[^\n]+rustls-tls-webpki-roots[^\n]+optional = true/);
  assert.match(cargo, /katoos-auth-qa = \[[^\n]+dep:tokio-tungstenite/);
  assert.match(native, /RC70_UNVERIFIED_RELAY_ENDPOINT/);
});

test('RC70 never grants native tools or online presence from bare TLS/WebSocket', () => {
  assert.match(native, /TransportOpenUnverified/);
  assert.match(native, /ContractRequired/);
  assert.match(native, /RC70_SERVER_CHALLENGE_CONTRACT_REQUIRED/);
  assert.doesNotMatch(native, /connected_authenticated|meshConnected: true|deviceAccessEnabled: true/);
  assert.doesNotMatch(native, /presence\.heartbeat|tool\.result|Command::new\(/);
});

test('RC70 test-only loopback exception cannot compile into app', () => {
  assert.match(native, /#\[cfg\(test\)\]\s*let local =/);
  assert.match(native, /#\[cfg\(not\(test\)\)\]\s*let local = false/);
  assert.match(native, /actual_loopback_websocket_rejects_unsigned_application_frame/);
  assert.match(native, /shutdown_during_reconnect_never_claims_authenticated_device/);
});
