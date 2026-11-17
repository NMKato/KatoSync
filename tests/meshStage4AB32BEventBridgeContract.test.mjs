// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../src-tauri/src/mesh_os_event_channel_qa.rs", import.meta.url), "utf8");

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
