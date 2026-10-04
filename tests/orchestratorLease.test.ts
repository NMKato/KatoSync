// Created by NMKato Solutions
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "katosync-orchestrator-lease.py");
const python = spawnSync("python3", ["--version"]);
const skip = python.status !== 0 ? "python3 not available" : false;

function lease(root: string, ...args: string[]) {
  // Strukturierter Aufruf: Executable + getrennte Argumente, keine Shell.
  return spawnSync("python3", [SCRIPT, "--control-root", root, ...args], { encoding: "utf8" });
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "katosync-lease-"));
  mkdirSync(join(root, "rdc-fallback"));
  writeFileSync(
    join(root, "rdc-fallback", "1-job.json"),
    JSON.stringify({ id: "1-job", name: "job", status: "waiting", reason: "codex_usage_limit", providerStates: [{ provider: "codex", state: "quota_limited" }] })
  );
  return root;
}

const item = (root: string) => JSON.parse(readFileSync(join(root, "rdc-fallback", "1-job.json"), "utf8"));

test("orchestrator heartbeat writes a bounded 0600 lease that reports attached", { skip }, () => {
  const root = setup();
  try {
    const beat = lease(root, "heartbeat", "--session", "rdc-1", "--lease-seconds", "99999", "--device", "studio");
    assert.equal(beat.status, 0, beat.stderr);
    const file = join(root, "remote-orchestrator.json");
    const data = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(data.schemaVersion, 1);
    assert.equal(data.leaseSeconds, 1800);
    assert.equal(data.transport.kind, "rdc");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(lease(root, "status").stdout.trim(), "attached");
    assert.equal(lease(root, "detach", "--session", "rdc-1").status, 0);
    assert.equal(lease(root, "status").stdout.trim(), "detached");
    assert.notEqual(lease(root, "heartbeat", "--session", "../escape").status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("claim takes a waiting router job out of the scheduler queue exactly once", { skip }, () => {
  const root = setup();
  try {
    assert.equal(lease(root, "claim", "--session", "rdc-1", "--item", "1-job").status, 0);
    assert.equal(item(root).status, "orchestrator_active");
    assert.equal(item(root).leaseOwner, "rdc-1");
    assert.equal(lease(root, "status").stdout.trim(), "working");
    // Zweiter Writer (andere Session) bekommt den Job nicht.
    assert.notEqual(lease(root, "claim", "--session", "rdc-2", "--item", "1-job").status, 0);
    assert.notEqual(lease(root, "release", "--session", "rdc-2", "--item", "1-job").status, 0);
    assert.equal(lease(root, "release", "--session", "rdc-1", "--item", "1-job", "--status", "completed").status, 0);
    assert.equal(item(root).status, "completed");
    assert.equal(item(root).leaseOwner, undefined);
    assert.equal(lease(root, "status").stdout.trim(), "attached");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("claim refuses while the provider health scheduler is resuming the same job", { skip }, () => {
  const root = setup();
  try {
    writeFileSync(join(root, "provider-health.log"), "2026-10-04T12:00:00+02:00 RESUME name=job branch=feat/x\n");
    const blocked = lease(root, "claim", "--session", "rdc-1", "--item", "1-job");
    assert.equal(blocked.status, 6, blocked.stderr);
    assert.equal(item(root).status, "waiting");
    writeFileSync(join(root, "provider-health.log"), "2026-10-04T12:00:00+02:00 RESUME name=job branch=feat/x\n2026-10-04T12:30:00+02:00 RESUME_DONE name=job exit=75\n");
    assert.equal(lease(root, "claim", "--session", "rdc-1", "--item", "1-job").status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
