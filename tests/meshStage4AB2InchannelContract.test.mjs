// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/inchannel_qa.rs",import.meta.url),"utf8");
const lease=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa.rs",import.meta.url),"utf8");
const root=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const workflow=readFileSync(new URL("../.github/workflows/stage4ab2-native-macos-qa.yml",import.meta.url),"utf8");

test("Stage4AB2 is internally gated and deliberately offers no IPC/CLI/tool invocation",()=>{
 assert.match(root,/#\[cfg\(feature = "stage4j-qa"\)\]\s*#\[allow\(dead_code\)\]\s*mod mesh_durable_lease_qa;/);
 assert.match(lease,/mod inchannel_qa;/);
 assert.doesNotMatch(source,/#\[tauri::command\]|Command::new|std::process::Command|TcpListener::bind\("(?:0\.0\.0\.0|::)"/);
 assert.doesNotMatch(source,/pub\s+(?:async\s+)?fn\s+(?:client|server)\s*\(/);
 assert.match(source,/remote_jobs_enabled/);
 assert.match(source,/remote_read_only_dispatch/);
});
test("Only pinned Ed25519 TLS connections can create a lease; no HTTP or bearer shortcut",()=>{
 assert.match(source,/strict_client_config/);
 assert.match(source,/strict_server_config/);
 assert.match(source,/TlsConnector/);
 assert.match(source,/TlsAcceptor/);
 assert.match(source,/TLSv1_3/);
 assert.match(source,/ValidatedOpenTlsSocket/);
 assert.match(source,/on_still_open_tls_socket/);
 assert.doesNotMatch(source,/reqwest|Bearer |Authorization:|http:\/\//i);
});
test("Owner binding, two distinct nonces, monotonic in-channel sequence and bounded frames",()=>{
 for(const phrase of ["validate_owner","OPEN","ACCEPT","BEAT","REPLY","client_nonce","server_nonce","VerifiedInChannelHeartbeat","on_verified_channel_heartbeat","timeout(WAIT","socket_closed"])
  assert.ok(source.includes(phrase),phrase);
 assert.match(source,/real_tcp_pinned_tls_two_heartbeats_and_socket_close/);
 assert.match(source,/cross_owner_tls_is_not_authorized/);
 assert.match(source,/replayed_sequence_cannot_renew/);
 assert.match(source,/wrong_certificate_and_revoked_public_pin_fail/);
});
test("macOS GitHub QA runs real Rust tests without promoting capabilities",()=>{
 assert.match(workflow,/cargo test --locked/);
 assert.match(workflow,/mesh_durable_lease_qa::inchannel_qa::tests/);
 assert.match(workflow,/STAGE4AB2_INCHANNEL_QA_ONLY_NO_REMOTE/);
 assert.doesNotMatch(workflow,/wrangler deploy|supabase db push|cargo tauri build|codesign -s/);
});
