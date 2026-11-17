// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../src-tauri/src/mesh_os_event_channel_qa.rs", import.meta.url), "utf8");
const native = readFileSync(new URL("../src-tauri/src/mesh_os_event_native_pipe_qa.rs", import.meta.url), "utf8");
const callbackNative = readFileSync(new URL("../scripts/qa-stage4ab32b-macos-native-callback.m", import.meta.url), "utf8");
const callbackRust = readFileSync(new URL("../src-tauri/src/mesh_os_event_native_ffi_qa.rs", import.meta.url), "utf8");
const supervisor = readFileSync(new URL("../src-tauri/src/mesh_live_supervisor_qa.rs", import.meta.url), "utf8");
const ownerGuard = readFileSync(new URL("../src-tauri/src/mesh_supervisor_guard_qa.rs", import.meta.url), "utf8");
const admissionBridge = readFileSync(new URL("../src-tauri/src/mesh_live_admission_recheck_qa.rs", import.meta.url), "utf8");
const canonicalAdmission = readFileSync(new URL("../src-tauri/src/mesh_admission.rs", import.meta.url), "utf8");

test("in-flight OS event bridge is only compiled as QA tests, not app runtime", () => {
  assert.match(lib, /#\[cfg\(all\(test, feature = "stage4j-qa"\)\)\]\s*mod mesh_os_event_channel_qa;/);
  assert.match(bridge, /heartbeat_or_fail_closed/);
  assert.match(bridge, /tokio::select!/);
  assert.match(bridge, /biased;/);
  assert.match(bridge, /events\.try_recv\(\)/);
  assert.match(bridge, /lease\.on_network_loss\(\)/);
  assert.match(bridge, /OsEventLeaseFence/);
});

test("no OS mutation, CLI, runtime IPC, remote execution or authority minting", () => {
  const code = bridge.split("\n").filter(line => !line.trimStart().startsWith("//")).join("\n");
  for (const denied of [
    /std::process::Command|tokio::process::Command|Command::new/,
    /std::fs::|File::create|std::env::set_var/,
    /tauri::|invoke_handler|remote_jobs_enabled\s*:\s*true/,
    /networksetup|systemsetup|pmset|tailscale\s+(?:up|down)/,
    /keyring::|keychain|listen\(|TcpListener|TcpStream/,
    /after_verified_open_channel\(/,
  ]) {
    // Lease fixture construction is permitted inside the #[cfg(test)] unit
    // tests, but never in the actual bridge implementation.
    const implementation = code.split("#[cfg(test)]")[0];
    assert.doesNotMatch(implementation, denied);
  }
});


test("native Apple-to-Rust bridge is ignored-by-default QA only and DENY only", () => {
  assert.ok(lib.includes('mod mesh_os_event_native_pipe_qa;'));
  assert.ok(lib.includes('target_os = "macos"'));
  assert.ok(native.includes('KATOSYNC_STAGE4AB32B_OS_OBSERVER_BIN'));
  assert.ok(native.includes('heartbeat_or_fail_closed'));
  assert.ok(native.includes('verified_in_channel_heartbeat(2, Instant::now())'));
  assert.ok(native.includes('.is_err()'));
  assert.equal(native.split('#[ignore = ').length - 1, 2);
  assert.ok(native.includes('stdout(Stdio::piped())'));
  assert.ok(native.includes('env_clear()'));
  assert.ok(native.includes('kill_on_drop(true)'));
  assert.ok(!native.includes('TcpListener::bind'));
  assert.ok(!native.includes('networksetup'));
});

test("native same-process callback is gated, bounded and denies only", () => {
  assert.ok(lib.includes('mod mesh_os_event_native_ffi_qa;'));
  assert.ok(lib.includes('target_os = "macos"'));
  assert.ok(callbackNative.includes('OWNER_LAUNCHED_PASSIVE_OS_OBSERVER_ONLY'));
  assert.ok(callbackNative.includes('NSWorkspaceWillSleepNotification'));
  assert.ok(callbackNative.includes('NSWorkspaceDidWakeNotification'));
  assert.ok(callbackNative.includes('nw_path_monitor_create_with_type'));
  assert.ok(callbackNative.includes('dispatch_sync(queue, ^{});'));
  assert.ok(callbackNative.includes('active = NO;'));
  assert.ok(callbackNative.includes('dateWithTimeIntervalSinceNow:5.0'));
  assert.ok(callbackRust.includes('KATOSYNC_STAGE4AB32B_OS_OBSERVER_DYLIB'));
  assert.ok(callbackRust.includes('heartbeat_or_fail_closed'));
  assert.ok(callbackRust.includes('blocking_send(event)'));
  assert.ok(callbackRust.includes('spawn_blocking'));
  assert.equal(callbackRust.split('#[ignore = ').length - 1, 3);
  assert.ok(callbackRust.includes('genuine_pinned_tls13_supervisor_heartbeat_is_denied_by_native_callback'));
  assert.ok(callbackRust.includes('heartbeat_client_for_os_callback_qa'));
  assert.ok(callbackRust.includes('guarded_supervisor_cycle('));
  assert.ok(callbackRust.includes('TlsConnector::from'));
  assert.ok(callbackRust.includes('TlsAcceptor::from'));
  assert.ok(callbackRust.includes('ProtocolVersion::TLSv1_3'));
  assert.ok(supervisor.includes('#[cfg(test)]'));
  assert.ok(supervisor.includes('pub(crate) async fn heartbeat_client_for_os_callback_qa'));
  for (const forbidden of [
    /networksetup|systemsetup|pmset|tailscale/,
    /NSTask|posix_spawn|fork\(|execv\(|system\(/,
    /Keychain|SecItem|NSURLSession|listener|remote_job/,
  ]) {
    const source = callbackNative.split("\n").filter(line => !line.trimStart().startsWith("//")).join("\n");
    assert.doesNotMatch(source, forbidden);
  }
});

test("supervisor owner/enrollment rechecks and OS denial share a QA-only cycle", () => {
  assert.ok(lib.includes('mod mesh_supervisor_guard_qa;'));
  assert.ok(lib.includes('#[cfg(all(test, feature = "stage4j-qa"))]'));
  for (const required of [
    'precheck()', 'postcheck()', 'heartbeat_or_fail_closed(',
    'lease.on_owner_or_peer_revoked()',
    'lease.verified_in_channel_heartbeat(sequence, Instant::now())',
    'revoked_owner_before_heartbeat_never_sends_or_renews',
    'revoked_enrollment_after_valid_tls_ack_still_denies_renewal',
    'queued_sleep_preempts_valid_owner_checks_and_ready_heartbeat',
    'native_link_loss_interrupts_pending_real_io_and_postcheck_never_runs',
    'vanished_native_event_producer_denies_even_with_fresh_owner_checks',
    'old_denied_lease_cannot_resume_after_wifi_available',
  ]) {
    assert.ok(ownerGuard.includes(required), 'missing QA safety control: ' + required);
  }
  for (const forbidden of [
    'TcpListener::bind', 'std::process::Command',
    'networksetup', 'systemsetup', 'pmset',
    'tauri::command', 'invoke_handler', 'keyring::',
  ]) {
    assert.ok(!ownerGuard.includes(forbidden), 'unexpected QA authority source: ' + forbidden);
  }
});

test("canonical owner/enrollment live-read adapter is test-only, opt-in and read-only", () => {
  assert.match(lib, /#\[cfg\(all\(test, feature = "stage4j-qa"\)\)\]\s*mod mesh_live_admission_recheck_qa;/);
  assert.ok(admissionBridge.includes('KATOSYNC_STAGE4AB32B_REAL_ADMISSION_READ_ONLY_QA'));
  assert.ok(admissionBridge.includes('OWNER_LAUNCHED_READ_ONLY_ADMISSION_RECHECK_ONLY'));
  assert.ok(admissionBridge.includes('SingleQaPermit'));
  assert.ok(admissionBridge.includes('require_owner_opt_ins()'));
  assert.ok(admissionBridge.includes('guarded_supervisor_cycle('));
  assert.ok(admissionBridge.includes('Duration::from_secs(45)'));
  assert.equal(admissionBridge.split('mesh_admission::recheck_after_probe(admitted, requested_fingerprint)').length - 1, 2);
  assert.ok(canonicalAdmission.includes('pub(crate) async fn recheck_after_probe('));
  assert.ok(canonicalAdmission.includes('same_account_still_verified(&admitted.owner_uid)'));
  assert.ok(canonicalAdmission.includes('approved_peer_for_account('));
  assert.ok(canonicalAdmission.includes('require_both_devices_enrolled('));
  const implementation = admissionBridge.split('#[cfg(test)]')[0];
  for (const forbidden of [
    'tauri::command', 'TcpListener::bind', 'Command::new(',
    'ensure_supabase_access_token', 'KATOSYNC_AUTH_ANON_KEY',
    'set_password(', 'ensure_identity(', 'service_role',
    'execute_sql', 'insert(', 'update(', 'delete(',
  ]) {
    assert.ok(!implementation.includes(forbidden), 'new authority or direct backend path: ' + forbidden);
  }
});
