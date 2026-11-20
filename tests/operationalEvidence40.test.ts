// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import { buildOperationalEvidence } from "../src/lib/operationalEvidence40.ts";
import type { ProviderStatus, RegistryProject } from "../src/types.ts";

const now = new Date(2026, 10, 20, 12, 0, 0);
const dayBefore = new Date(2026, 10, 19, 11, 0, 0).toISOString();
const today = new Date(2026, 10, 20, 10, 0, 0).toISOString();
const future = new Date(2026, 10, 21, 10, 0, 0).toISOString();
const old = new Date(2026, 9, 18, 10, 0, 0).toISOString();

function cloud(provider: "codex" | "claude", ready: boolean): ProviderStatus {
  return {
    provider, label: provider, state: "connected", reason: "ready",
    installed: true, authenticated: ready, available: ready, enabled: true,
    failoverAllowed: true, capabilities: [], checkedAt: today, secretStored: false
  } as ProviderStatus;
}
function project(name: string, when: string | null, verified = false): RegistryProject {
  return {
    id: name, name, identityKey: name, aliases: [], rootPath: "/synthetic/" + name,
    commonDir: null, remote: null, addedAt: old, source: "discovery",
    focus: { status: "active", priority: "P1", autoMode: "inherit", origin: "user", updatedAt: today },
    scan: when ? { scannedAt: today, branch: "main", headSha: "a".repeat(40),
      headDate: when, dirtyCount: 0, worktrees: [], docs: [], manifests: [] } : null,
    verification: verified ? { state: "verified", headSha: "a".repeat(40), checkedAt: today, findings: [] } : null,
    capsule: null, resolutions: {}
  };
}

test("seven-day history shows only genuine, deduplicated, timestamped events", () => {
  const e = buildOperationalEvidence({
    now,
    events: [
      { id: "job-1", at: dayBefore, kind: "state" },
      { id: "job-1", at: dayBefore, kind: "state" },
      { id: "job-2", at: today, kind: "activity" },
      { id: "future", at: future, kind: "state" },
      { id: "old", at: old, kind: "state" },
      { id: "bad", at: "not-a-time", kind: "state" }
    ],
    transitions: [
      { provider: "codex", from: "connecting", to: "connected", at: today },
      { provider: "codex", from: "connecting", to: "connected", at: today },
      { provider: "claude", from: "connect", to: "connected", at: future }
    ],
    statuses: [cloud("codex", true), cloud("claude", false)],
    projects: [project("Earlier", dayBefore, true), project("Future", future)]
  });
  assert.equal(e.days.length, 7);
  assert.equal(e.days[5].jobs, 1);
  assert.equal(e.days[6].jobs, 1);
  assert.equal(e.days[6].transitions, 1);
  assert.equal(e.totalJobEvents, 2);
  assert.equal(e.totalTransitions, 1);
  assert.deepEqual(e.providers, { available: 1, total: 2 });
  assert.deepEqual(e.commits.map((commit) => ({ name: commit.name, state: commit.state })),
    [{ name: "Earlier", state: "verified" }]);
});

test("no data yields no synthetic activity and no fabricated push timestamp", () => {
  const e = buildOperationalEvidence({ now, events: [], transitions: [], statuses: [], projects: [] });
  assert.equal(e.hasEvents, false);
  assert.equal(e.days.every((day) => day.jobs === 0 && day.transitions === 0), true);
  assert.deepEqual(e.commits, []);
  assert.deepEqual(e.providers, { available: 0, total: 2 });
});

test("git commit evidence is not claimed to be verified without matching HEAD", () => {
  const oldProject = project("NoVerifiedHead", dayBefore);
  const e = buildOperationalEvidence({
    now, events: [], transitions: [], statuses: [], projects: [oldProject, project("NoDate", null)]
  });
  assert.equal(e.commits.length, 1);
  assert.equal(e.commits[0].state, "observed");
  assert.equal(e.commits[0].shortSha, "aaaaaaaa");
});
