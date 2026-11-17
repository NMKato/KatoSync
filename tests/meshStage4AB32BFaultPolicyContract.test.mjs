import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const base = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, base), "utf8");
const policy = read("src-tauri/src/mesh_fault_policy_qa.rs");
const lease = read("src-tauri/src/mesh_durable_lease_qa.rs");
const lib = read("src-tauri/src/lib.rs");

test("AB3.2B policy is stage4j-qa-only with no IPC or device-side OS mutation", () => {
  assert.match(lib, /#\[cfg\(feature = "stage4j-qa"\)\]\s*#\[allow\(dead_code\)\]\s*mod mesh_fault_policy_qa;/);
  assert.match(policy, /Stage4AB\.3\.2B/);
  const code = policy.split("\n").filter(line => !line.trimStart().startsWith("//")).join("\n");
  for (const prohibited of [
    /#\[tauri::command\]/, /std::process::Command/, /tokio::process::Command/,
    /TcpListener/, /TcpStream/, /Command::new/, /LaunchAgent/,
    /set_power_state/, /networksetup/, /systemsetup/, /keyring::Entry/,
    /remote_job/, /cross_device_write/
  ]) {
    assert.doesNotMatch(code, prohibited);
  }
});

test("AB3.2B terminal events cannot be reinterpreted as transient network faults", () => {
  for (const kind of [
    "NetworkLost", "SleepOrWake", "PeerRevoked", "OwnerChanged",
    "CertificateOrPinMismatch", "HeartbeatReplay", "Unknown"
  ]) assert.ok(policy.includes(kind));
  assert.match(policy, /if !matches!\(\s*fault,\s*TransportFault::NetworkLost \| TransportFault::SleepOrWake\s*\)/);
  assert.match(policy, /AttemptDecision::StopSecurityEvent/);
});

test("AB3.2B no stale lease, no implicit retry, bounded backoff and fresh TLS requirement", () => {
  assert.match(policy, /on_network_loss\(\)/);
  assert.match(policy, /on_sleep_or_wake\(\)/);
  assert.match(policy, /on_owner_or_peer_revoked\(\)/);
  assert.match(policy, /both_enrollments_current/);
  assert.match(policy, /exact_local_keychain_pin_current/);
  assert.match(policy, /user_consent_current/);
  assert.match(policy, /0 => Duration::from_secs\(2\)/);
  assert.match(policy, /1 => Duration::from_secs\(4\)/);
  assert.match(policy, /2 => Duration::from_secs\(8\)/);
  assert.match(policy, /candidate_session_nonce != previous_session_nonce|previous_session_nonce != candidate_session_nonce/);
  assert.match(policy, /verified_in_channel_heartbeat/);
  assert.match(lease, /pub\(crate\) fn on_network_loss\(/);
  assert.match(lease, /pub\(crate\) fn on_sleep_or_wake\(/);
  assert.match(lease, /pub\(crate\) fn on_owner_or_peer_revoked\(/);
});
