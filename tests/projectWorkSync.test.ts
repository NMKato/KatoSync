import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectWorkSync, updateProjectWorkTask } from "../src/lib/projectWorkSync.ts";
import type { ProjectRegistry, RegistryProject } from "../src/types.ts";

const now = "2026-10-05T19:30:00.000Z";

function project(overrides: Partial<RegistryProject> & Pick<RegistryProject, "id" | "name">): RegistryProject {
  return {
    id: overrides.id,
    name: overrides.name,
    identityKey: overrides.identityKey ?? overrides.id,
    aliases: overrides.aliases ?? [],
    rootPath: overrides.rootPath ?? `/work/${overrides.id}`,
    commonDir: overrides.commonDir ?? null,
    remote: overrides.remote ?? null,
    addedAt: overrides.addedAt ?? now,
    source: overrides.source ?? "discovery",
    focus:
      overrides.focus ??
      {
        status: "active",
        priority: "P1",
        autoMode: "inherit",
        origin: "user",
        updatedAt: now
      },
    scan:
      overrides.scan ??
      {
        scannedAt: now,
        branch: "main",
        headSha: "abc1234",
        headDate: now,
        dirtyCount: 0,
        worktrees: [
          {
            path: overrides.rootPath ?? `/work/${overrides.id}`,
            branch: "main",
            headSha: "abc1234",
            detached: false,
            locked: false,
            dirtyCount: 0
          }
        ],
        docs: [],
        manifests: []
      },
    verification:
      overrides.verification ??
      {
        state: "verified",
        findings: [],
        checkedAt: now,
        headSha: "abc1234"
      },
    capsule:
      overrides.capsule ??
      {
        schema: "katosync.project-capsule/v1",
        projectId: overrides.id,
        name: overrides.name,
        generatedAt: now,
        purpose: "",
        architecture: [],
        guardrails: [],
        currentWave: { text: null, basis: "none" },
        branches: [],
        lastVerification: { state: "verified", checkedAt: now, headSha: "abc1234" },
        nextSafeWork: ["Implement safe slice", "Run focused tests"],
        sources: ["PROJECT_STATUS_FLOW.md"]
      },
    resolutions: overrides.resolutions ?? {}
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
    updatedAt: now
  };
}

test("AutoQ generates selected local tasks only from active auto-enabled mapped clean projects", () => {
  const p = project({ id: "genxline", name: "GENXLine" });
  const result = buildProjectWorkSync(registry([p]), { genxline: p.rootPath }, [], now);
  assert.equal(result.plans.length, 1);
  assert.equal(result.selectedTaskIds.length, 2);
  assert.equal(result.report.readyCount, 2);
  assert.equal(result.plans[0].source, "project_registry_autoq");
  assert.equal(result.plans[0].status, "approved");
});

test("AutoQ never queues human-gated, manual or dirty projects", () => {
  const human = project({
    id: "genxline",
    name: "GENXLine",
    verification: {
      state: "human_gate",
      findings: [{ id: "g", state: "human_gate", severity: "warn", detail: "visual review", choices: ["inspect"] }],
      checkedAt: now,
      headSha: "abc"
    }
  });
  const manual = project({
    id: "legacy",
    name: "Legacy",
    focus: { status: "active", priority: "P2", autoMode: "off", origin: "user", updatedAt: now }
  });
  const dirty = project({
    id: "katosync",
    name: "KatoSync",
    scan: {
      scannedAt: now,
      branch: "main",
      headSha: "abc",
      headDate: now,
      dirtyCount: 4,
      worktrees: [{ path: "/work/katosync", branch: "main", headSha: "abc", detached: false, locked: false, dirtyCount: 4 }],
      docs: [],
      manifests: []
    }
  });
  const result = buildProjectWorkSync(
    registry([human, manual, dirty]),
    { genxline: human.rootPath, legacy: manual.rootPath, katosync: dirty.rootPath },
    [],
    now
  );
  assert.equal(result.plans.length, 0);
  assert.equal(result.report.gatedCount, 2);
  assert.deepEqual(
    result.report.projects.map((entry) => entry.gate).sort(),
    ["human_gate", "manual_project", "worktree_dirty"].sort()
  );
});

test("AutoQ requires an explicit worktree mapping and preserves terminal local ledger state", () => {
  const p = project({ id: "kai-desktop", name: "KAI Desktop" });
  const blocked = buildProjectWorkSync(registry([p]), {}, [], now);
  assert.equal(blocked.plans.length, 0);
  assert.equal(blocked.report.projects[0].gate, "worktree_unmapped");

  const first = buildProjectWorkSync(registry([p]), { "kai-desktop": p.rootPath }, [], now);
  const completed = updateProjectWorkTask(first.plans, first.selectedTaskIds[0], "completed");
  const second = buildProjectWorkSync(registry([p]), { "kai-desktop": p.rootPath }, completed, now);
  assert.equal(second.selectedTaskIds.length, 1);
  assert.equal(second.plans[0].tasks.find((task) => task.status === "completed")?.status, "completed");
});

test("empty queue replenishes from fresh READY project truth", () => {
  const p = project({ id: "katosync", name: "KatoSync" });
  const first = buildProjectWorkSync(registry([p]), { katosync: p.rootPath }, [], now);
  const completed = first.selectedTaskIds.reduce(
    (plans, taskId) => updateProjectWorkTask(plans, taskId, "completed"),
    first.plans
  );
  const empty = buildProjectWorkSync(registry([p]), { katosync: p.rootPath }, completed, now);
  assert.equal(empty.report.readyCount, 0);

  const refreshed = project({
    id: "katosync",
    name: "KatoSync",
    capsule: {
      ...p.capsule!,
      nextSafeWork: ["Implement refreshed runtime acceptance"]
    }
  });
  const replenished = buildProjectWorkSync(registry([refreshed]), { katosync: refreshed.rootPath }, completed, now);
  assert.equal(replenished.report.readyCount, 1);
  assert.equal(replenished.plans[0].tasks[0].title, "Implement refreshed runtime acceptance");
  assert.equal(replenished.plans[0].tasks[0].status, "pending");
});

test("historical failure does not block a fresh runnable project item", () => {
  const p = project({ id: "katosync", name: "KatoSync" });
  const first = buildProjectWorkSync(registry([p]), { katosync: p.rootPath }, [], now);
  const failed = updateProjectWorkTask(first.plans, first.selectedTaskIds[0], "failed");
  const refreshed = project({
    id: "katosync",
    name: "KatoSync",
    capsule: {
      ...p.capsule!,
      nextSafeWork: ["Run independent fresh verification"]
    }
  });
  const next = buildProjectWorkSync(registry([refreshed]), { katosync: refreshed.rootPath }, failed, now);
  assert.equal(next.report.readyCount, 1);
  assert.equal(next.plans[0].tasks[0].status, "pending");
});
