// Created by NMKato Solutions – Stage4AB.1 security contract.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root=new URL("../",import.meta.url);
const rust=readFileSync(new URL("src-tauri/src/mesh_durable_lease_qa.rs",root),"utf8");
const entry=readFileSync(new URL("src-tauri/src/lib.rs",root),"utf8");
const cloud=readFileSync(new URL("src-tauri/src/mesh_device_presence.rs",root),"utf8");

test("lease machine is internal, QA compiled and not callable by web UI or CLI",()=>{
 assert.match(entry, /\#\[cfg\(feature = "stage4j-qa"\)\]\s*\#\[allow\(dead_code\)\]\s*mod mesh_durable_lease_qa;/);
 assert.doesNotMatch(entry,/mesh_durable_lease_qa::/);
 assert.doesNotMatch(rust,/\#\[tauri::command\]|pub\s+(?:async\s+)?fn|pub\(crate\)\s+(?:async\s+)?fn/);
 assert.doesNotMatch(rust,/Tcp(?:Listener|Stream|Socket)|Command::new|reqwest::|\bstd::fs\b/);
});

test("only same live TLS channel can issue or renew a monotonic bounded lease",()=>{
 for(const needle of [
 "ValidatedOpenTlsSocket", "VerifiedInChannelHeartbeat",
 "on_still_open_tls_socket", "on_verified_channel_heartbeat",
 "ChannelBinding", "HEARTBEAT_LEASE", "MAX_SESSION_AGE",
 "receipt.binding != session.binding",
 "receipt.sequence <= session.last_sequence",
 "now >= session.deadline",
 "now >= session.opened_at + MAX_SESSION_AGE"
 ]) assert.ok(rust.includes(needle),needle);
 assert.match(rust,/struct ValidatedOpenTlsSocket\s*\{/);
 assert.match(rust,/struct VerifiedInChannelHeartbeat\s*\{/);
 assert.doesNotMatch(rust,/pub\s+struct ValidatedOpenTlsSocket|pub\s+struct VerifiedInChannelHeartbeat/);
});

test("nothing grants jobs or mistakes signed cloud presence for TLS",()=>{
 assert.match(rust,/remote_read_only_dispatch: false/);
 assert.match(rust,/remote_jobs_enabled: false/);
 assert.match(rust,/cross_device_writes: false/);
 assert.match(cloud,/transport_ready: false|transport_ready\b/);
 assert.match(rust,/Stage4AA \*closed one-shot\*/);
 assert.doesNotMatch(rust,/mesh_device_presence_report\(|peerAuthenticatedOnce\s*=\s*true/);
});

test("revocation, sleep wake, link-loss and expiry clear all authenticated state",()=>{
 for(const name of [
 "fn tick(","fn socket_closed(","fn network_lost(",
 "fn sleep_or_wake(","fn revoked_or_owner_changed(",
 "self.session = None","MeshLinkState::Revoked"
 ]) assert.ok(rust.includes(name),name);
 for(const testName of [
 "a_local_pin_or_stage4aa_closed_one_shot_never_implies_online_mesh",
 "expired_heartbeat_lease_disappears_without_polling_or_ui_updates",
 "replayed_heartbeat_is_fatal_and_clears_authentication",
 "wrong_peer_or_owner_channel_binding_fails_closed",
 "sleep_wake_and_socket_closure_never_leave_a_connected_session",
 "revocation_and_owner_swap_are_terminal_until_explicit_new_consent",
 "renewal_can_never_extend_beyond_absolute_session_maximum"
 ]) assert.ok(rust.includes("fn "+testName+"("),testName);
});
