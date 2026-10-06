// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";

import { autoQRefreshReason } from "../src/lib/autoQRuntime.ts";
import { addAutoLaneClaim, planAutoLanes, pruneAutoLaneClaims } from "../src/lib/autoLanePlanner.ts";
import { buildProjectWorkSync, updateProjectWorkTask } from "../src/lib/projectWorkSync.ts";
import type { AgentLane, AutoLaneClaim, ProjectRegistry, RegistryProject } from "../src/types.ts";

const NOW = "2026-10-05T22:00:00.000Z";

function project(id: string, work: string): RegistryProject {
  const rootPath = `/isolated/${id}`;
  return {
    id,
    name: id,
    identityKey: id,
    aliases: [],
    rootPath,
    commonDir: null,
    remote: null,
    addedAt: NOW,
    source: "discovery",
    focus: { status: "active", priority: "P0", autoMode: "on", origin: "user", updatedAt: NOW },
    scan: {
      scannedAt: NOW,
      branch: `acceptance/${id}`,
      headSha: "abc1234",
      headDate: NOW,
      dirtyCount: 0,
      worktrees: [{ path: rootPath, branch: `acceptance/${id}`, headSha: "abc1234", detached: false, locked: false, dirtyCount: 0 }],
      docs: [],
      manifests: []
    },
    verification: { state: "verified", findings: [], checkedAt: NOW, headSha: "abc1234" },
    capsule: {
      schema: "katosync.project-capsule/v1",
      projectId: id,
      name: id,
      generatedAt: NOW,
      purpose: "Bounded AutoQ acceptance",
      architecture: [],
      guardrails: [],
      currentWave: { text: "Runtime acceptance", basis: "status" },
      branches: [`acceptance/${id}`],
      lastVerification: { state: "verified", checkedAt: NOW, headSha: "abc1234" },
      nextSafeWork: [work],
      sources: ["PROJECT_STATUS_FLOW.md"]
    },
    resolutions: {}
  };
}

function registry(projects: RegistryProject[]): ProjectRegistry {
  return {
    schemaVersion: 1,
    projects,
    migration: {
      sourceRoots: { status: "none", roots: [], checkedAt: null },
      projectRepos: { status: "none", checkedAt: null }
    },
    updatedAt: NOW
  };
}

function lane(id: AgentLane["id"], eligible: boolean, connectivity: AgentLane["connectivity"]): AgentLane {
  return {
    id,
    kind: id === "local_control" ? "substrate" : "model_provider",
    intelligent: id !== "local_control",
    rank: 0,
    connectivity,
    activity: "idle",
    eligible
  };
}

test("bounded acceptance dispatches three isolated jobs and survives simulated Codex auth/limit failure", () => {
  const projects = [
    project("acceptance-a", "Verify isolated job A"),
    project("acceptance-b", "Verify isolated job B"),
    project("acceptance-c", "Verify isolated job C")
  ];
  const repos = Object.fromEntries(projects.map((entry) => [entry.id, entry.rootPath]));
  const synced = buildProjectWorkSync(registry(projects), repos, [], NOW);
  assert.equal(synced.selectedTaskIds.length, 3);

  const planned = planAutoLanes({
    enabled: true,
    actionPlans: synced.plans,
    selectedOrder: synced.selectedTaskIds,
    repos,
    claims: [],
    inFlightTaskIds: [],
    startSafety: { safe: true, reason: "safe" },
    // Codex simuliert nicht authentifiziert/limitiert; Claude bleibt als gesunde intelligente Lane.
    lanes: [lane("codex", false, "limited"), lane("claude", true, "connected"), lane("local_control", true, "connected")],
    preferredRunner: "codex_cli",
    providerPriority: ["codex", "claude", "local_control"],
    dailyCount: 0,
    dailyLimit: 10,
    maxConcurrent: 3
  });
  assert.equal(planned.dispatch.length, 3);
  assert.deepEqual(new Set(planned.dispatch.map((entry) => entry.projectId)).size, 3);
  assert.ok(planned.dispatch.every((entry) => entry.runner === "claude_cli"));

  const claims = planned.dispatch.reduce<AutoLaneClaim[]>((ledger, dispatch) =>
    addAutoLaneClaim(ledger, {
      taskId: dispatch.taskId,
      projectId: dispatch.projectId,
      repoKey: repos[dispatch.projectId],
      runner: dispatch.runner,
      claimedAt: NOW
    }), []);
  assert.equal(claims.length, 3);
  assert.equal(new Set(claims.map((claim) => claim.repoKey)).size, 3);

  const completed = synced.selectedTaskIds.reduce(
    (plans, taskId) => updateProjectWorkTask(plans, taskId, "completed"),
    synced.plans
  );
  assert.deepEqual(pruneAutoLaneClaims(claims, completed, true), []);
});

test("runtime refresh is bounded, writer-safe and replenishes an emptied queue", () => {
  assert.equal(autoQRefreshReason({
    enabled: false,
    syncing: false,
    writerActive: false,
    laneCount: 0,
    lastRefreshAt: 0,
    now: 99_000
  }), null);
  assert.equal(autoQRefreshReason({
    enabled: true,
    syncing: false,
    writerActive: false,
    laneCount: 0,
    lastRefreshAt: 1_000,
    now: 31_000,
    emptyRefreshMs: 30_000
  }), "queue_empty");
  assert.equal(autoQRefreshReason({
    enabled: true,
    syncing: false,
    writerActive: true,
    laneCount: 0,
    lastRefreshAt: 1_000,
    now: 99_000,
    emptyRefreshMs: 30_000
  }), null);

  const firstProject = project("acceptance-a", "Initial work");
  const first = buildProjectWorkSync(registry([firstProject]), { "acceptance-a": firstProject.rootPath }, [], NOW);
  const completed = updateProjectWorkTask(first.plans, first.selectedTaskIds[0], "completed");
  const freshProject = project("acceptance-a", "Fresh dependency-safe READY work");
  const replenished = buildProjectWorkSync(
    registry([freshProject]),
    { "acceptance-a": freshProject.rootPath },
    completed,
    NOW
  );
  assert.equal(replenished.report.readyCount, 1);
  assert.equal(replenished.plans[0].tasks[0].title, "Fresh dependency-safe READY work");
});
