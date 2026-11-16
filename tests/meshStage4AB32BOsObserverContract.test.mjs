// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const src = fileURLToPath(new URL("../scripts/qa-stage4ab32b-macos-os-events.m", import.meta.url));
const source = readFileSync(src, "utf8");
const gate = "KATOSYNC_STAGE4AB32B_OS_EVENT_QA_READ_ONLY";

// Never infer that a working Wi-Fi path or a wake notification is Mesh auth.
test("passive native observer is short lived, denied by default and read-only", () => {
  assert.match(source, /NSWorkspaceWillSleepNotification/);
  assert.match(source, /NSWorkspaceDidWakeNotification/);
  assert.match(source, /nw_path_monitor_create_with_type\\(nw_interface_type_wifi\\)/);
  assert.match(source, /dateWithTimeIntervalSinceNow:5\\.0/);
  assert.match(source, /MESH_STAGE4AB32B_OS_EVENT_QA_OPT_IN_REQUIRED/);
  const code = source.split("\n").filter(line => !line.trimStart().startsWith("//")).join("\n");
  for (const forbidden of [
    /networksetup/, /systemsetup/, /pmset/, /NSTask/, /posix_spawn/, /execve/,
    /nw_listener_create/, /nw_connection_create/, /LaunchAgent/, /SMAppService/,
    /IOAllowPowerChange/, /keychain|SecItemAdd|SecItemUpdate/,
  ]) assert.doesNotMatch(code, forbidden);
});

test("real macOS frameworks compile and bounded observer denies then exits", { timeout: 180_000 }, (t) => {
  if (process.platform !== "darwin") return t.skip("macOS-specific native observer");
  const dir = mkdtempSync(join(tmpdir(), "katosync-stage4ab32b-native-observer-"));
  const binary = join(dir, "qa-event-observer");
  try {
    const cc = spawnSync("clang", [
      "-fobjc-arc", "-fblocks", "-framework", "AppKit",
      "-framework", "Network", "-framework", "Foundation", src, "-o", binary,
    ], { encoding: "utf8", timeout: 150_000 });
    assert.equal(cc.status, 0, cc.stderr || cc.error?.message || "clang failed");
    const cleanEnv = { ...process.env };
    delete cleanEnv[gate];
    const noOptIn = spawnSync(binary, [], { env: cleanEnv, encoding: "utf8", timeout: 2_500 });
    assert.equal(noOptIn.status, 64, noOptIn.stderr || noOptIn.error?.message);
    assert.match(noOptIn.stderr, /MESH_STAGE4AB32B_OS_EVENT_QA_OPT_IN_REQUIRED/);
    const readOnly = spawnSync(binary, [], {
      env: { ...cleanEnv, [gate]: "OWNER_LAUNCHED_PASSIVE_OS_OBSERVER_ONLY" },
      encoding: "utf8", timeout: 13_000,
    });
    assert.equal(readOnly.status, 0, readOnly.stderr || readOnly.error?.message || "observer failed");
    const frames = readOnly.stdout.trim().split("\n").filter(Boolean);
    assert.ok(frames.includes("KATOSYNC_OS_QA_EVENT_V1:OBSERVING"));
    assert.ok(frames.includes("KATOSYNC_OS_QA_EVENT_V1:STOPPED"));
    for (const frame of frames) assert.match(frame,
      /^KATOSYNC_OS_QA_EVENT_V1:(OBSERVING|STOPPED|WIFI_PATH_AVAILABLE|WIFI_PATH_LOST|SLEEP_BEGIN|WAKE)$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
