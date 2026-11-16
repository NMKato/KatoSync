// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(new URL("../scripts/qa-stage4ab32b-recovery-preflight.sh", import.meta.url));
const source = readFileSync(script, "utf8");

function simulatedReadOnlyHost({ alternateActive = false, defaultActive = true, socketOpen = false } = {}) {
  const bin = mkdtempSync(join(tmpdir(), "katosync-ab32b-recovery-"));
  const fake = (name, body) => writeFileSync(join(bin, name), "#!/bin/sh\n" + body + "\n", { mode: 0o755 });
  fake("route", "printf 'interface: en0\\n'");
  fake("networksetup", "printf 'Hardware Port: Wi-Fi\\nDevice: en0\\nHardware Port: Ethernet\\nDevice: en4\\n'");
  fake("ifconfig", `if [ "$1" = "en0" ]; then
  echo "status: ${defaultActive ? "active" : "inactive"}"
elif [ "$1" = "en4" ]; then
  echo "status: ${alternateActive ? "active" : "inactive"}"
fi`);
  fake("lsof", socketOpen
    ? "printf 'COMMAND PID USER FD TYPE NODE NAME\\nqa 123 test 6u IPv4 TCP:39402\\n'"
    : "exit 1");
  try {
    return spawnSync("/bin/sh", [script], {
      encoding: "utf8",
      timeout: 4000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    });
  } finally {
    rmSync(bin, { force: true, recursive: true });
  }
}

test("preflight cannot mutate routing, sleep, Wi-Fi, keychain or device authority", () => {
  assert.match(source, /MESH_STAGE4AB32B_INDEPENDENT_RECOVERY_NOT_ATTESTED/);
  assert.match(source, /MESH_STAGE4AB32B_HARDWARE_FAULT_NOT_AUTHORIZED/);
  const executable = source.split("\n").filter(line => !/^\s*#/.test(line)).join("\n");
  for (const denied of [
    /sudo\s/, /networksetup\s+-set/, /ifconfig\s+.*\s+down/,
    /pmset\s+.*\s+sleepnow/, /launchctl\s+/, /kill\s+-/,
    /tailscale\s+(down|up|logout)/, /security\s+delete/,
  ]) assert.doesNotMatch(executable, denied);
  const check = spawnSync("/bin/sh", ["-n", script], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
});

test("only default active WLAN, without alternate recovery: fail closed", () => {
  const run = simulatedReadOnlyHost();
  assert.equal(run.status, 4, run.stdout + run.stderr);
  assert.match(run.stdout, /MESH_STAGE4AB32B_ALTERNATE_ACTIVE_PHYSICAL_COUNT=0/);
  assert.match(run.stdout, /MESH_STAGE4AB32B_HARDWARE_FAULT_NOT_AUTHORIZED/);
});

test("even active second interface cannot prove independent owner recovery", () => {
  const run = simulatedReadOnlyHost({ alternateActive: true });
  assert.equal(run.status, 5, run.stdout + run.stderr);
  assert.match(run.stdout, /MESH_STAGE4AB32B_ALTERNATE_ACTIVE_PHYSICAL_COUNT=1/);
  assert.match(run.stdout, /MESH_STAGE4AB32B_INDEPENDENT_RECOVERY_NOT_ATTESTED/);
});

test("unavailable default physical link denies physical fault", () => {
  const run = simulatedReadOnlyHost({ defaultActive: false });
  assert.equal(run.status, 6, run.stdout + run.stderr);
  assert.match(run.stdout, /MESH_STAGE4AB32B_DEFAULT_LINK_UNAVAILABLE/);
});

test("old live QA socket prevents concurrent fault rehearsal", () => {
  const run = simulatedReadOnlyHost({ socketOpen: true });
  assert.equal(run.status, 7, run.stdout + run.stderr);
  assert.match(run.stdout, /MESH_STAGE4AB32B_EXISTING_QA_CHANNEL/);
  assert.match(run.stdout, /MESH_STAGE4AB32B_HARDWARE_FAULT_NOT_AUTHORIZED/);
});
