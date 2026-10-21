// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectWorkResume, formatProjectWorkResume } from "../src/lib/projectWorkResume.ts";
import type { ProjectProbe, RegistryProject } from "../src/types.ts";

const TIME = "2026-10-19T18:00:00.000Z";
const SHA = "a0123456789abcdef0123456789abcdef0123456";
function project(): RegistryProject {
  return {
    id: "demo", name: "Demo Projekt", identityKey: "github.com/acme/demo", aliases: [],
    rootPath: "/private/home/user/repos/demo", commonDir: "/private/home/user/repos/demo/.git",
    remote: "https://user:secret@github.com/acme/demo.git", addedAt: TIME, source: "discovery",
    focus: { status: "active", priority: "P1", autoMode: "off", scope: null, origin: "user", updatedAt: TIME },
    scan: null, verification: null, capsule: null, resolutions: {}
  };
}
function probe(): ProjectProbe {
  return {
    repo: {
      path: "/private/home/user/repos/demo", commonDir: "/private/home/user/repos/demo/.git",
      mainWorktreePath: "/private/home/user/repos/demo", isLinkedWorktree: false,
      remote: "https://user:secret@github.com/acme/demo.git", branch: "main", detached: false,
      headSha: SHA, headDate: TIME, dirtyCount: 0, untrackedCount: 0,
      ahead: 0, behind: 0, recentShas: [SHA], worktrees: [], iconDataUrl: null
    },
    scannedAt: TIME,
    docs: [
      { path: "PROJECT_STATUS_FLOW.md", kind: "status", bytes: 50, modifiedAt: TIME,
        content: "# Project status\nStand: 2026-10-19\nBranch: main\nCurrent Wave: Build MVP\n## Next steps\n- Add first screen", excluded: null },
      { path: "README.md", kind: "readme", bytes: 18, modifiedAt: TIME,
        content: "# Demo\nSoftware product", excluded: null },
      { path: ".env.production", kind: "memory", bytes: 30, modifiedAt: TIME,
        content: "SECRET=customer-private", excluded: null },
      { path: "node_modules/internal/README.md", kind: "readme", bytes: 20, modifiedAt: TIME,
        content: "PRIVATE SOURCE", excluded: null },
      { path: "MEMORY.md", kind: "memory", bytes: 20, modifiedAt: TIME,
        content: "PASSWORD=hunter2", excluded: "secret_pattern" }
    ],
    manifests: [{ kind: "package.json", path: "package.json", name: "demo", version: "1.0.0", hints: ["React", "TypeScript"] }]
  };
}

test("fresh project resume uses live head and gives only read-only verification evidence", () => {
  const result = buildProjectWorkResume(project(), probe(), SHA, TIME);
  assert.equal(result.schemaVersion, "katosync.project-work-resume/v1");
  assert.equal(result.source, "fresh_local_read_only_scan");
  assert.equal(result.git.headSha, SHA);
  assert.equal(result.git.repository, "github.com/acme/demo");
  assert.equal(result.git.headChangedSinceRegistry, false);
  assert.equal(result.policy.version, "kuas/v1");
  assert.equal(result.policy.profile, "community");
  assert.equal(result.policy.ownerApproved, false);
  assert.match(result.policy.instructions, /\[human_gate\]/);
  assert.match(result.policy.instructions, /\[one_writer\]/);
  assert.match(result.policy.instructions, /\[provider_privacy\]/);
  assert.equal(result.governance.allowsCodeWrites, false);
  assert.equal(result.governance.writerLeaseVerified, false);
  assert.equal(result.verification.ciChecked, false);
  assert.equal(result.verification.testsExecuted, false);
  const serialized = formatProjectWorkResume(result);
  assert.doesNotMatch(serialized, /hunter2|customer-private|user:secret|private\/home|node_modules|\.env\.production/i);
  assert.ok(result.project.docReferences.some((ref) => ref.path === "PROJECT_STATUS_FLOW.md"));
});

test("head movement since last registry snapshot is marked for review", () => {
  const result = buildProjectWorkResume(project(), probe(), "bbbbbbbbbbbbbbbbbb", TIME);
  assert.equal(result.git.headChangedSinceRegistry, true);
  assert.equal(result.assessment, "needs_review");
  assert.ok(result.readinessReasons.includes("head_changed_since_registry_scan"));
});

test("dirty worktree does not become verified or authorized", () => {
  const changed = probe();
  changed.repo.dirtyCount = 3;
  const result = buildProjectWorkResume(project(), changed, SHA, TIME);
  assert.equal(result.assessment, "needs_review");
  assert.ok(result.readinessReasons.includes("dirty_worktree"));
  assert.equal(result.governance.allowsCodeWrites, false);
});

test("missing or excluded status documents cannot be interpreted as ready", () => {
  const noDocs = probe();
  noDocs.docs = noDocs.docs.filter((doc) => doc.kind !== "status");
  const result = buildProjectWorkResume(project(), noDocs, SHA, TIME);
  assert.equal(result.assessment, "needs_review");
  assert.ok(result.readinessReasons.includes("no_verified_status_or_handoff_document"));
  assert.equal(result.verification.state, "no_status_doc");
});

test("missing Git SHA and impossible dirtiness fail closed", () => {
  const noSha = probe();
  noSha.repo.headSha = null;
  assert.throws(() => buildProjectWorkResume(project(), noSha, SHA, TIME), /Git-HEAD/);
  const impossible = probe();
  impossible.repo.dirtyCount = -1;
  assert.throws(() => buildProjectWorkResume(project(), impossible, SHA, TIME), /Git-Arbeitsbaum/);
});

test("packet never exports absolute device paths and does not claim cross-device availability", () => {
  const p = project();
  const report = buildProjectWorkResume(p, probe(), null, TIME);
  assert.equal(report.assessment !== "blocked", true);
  assert.equal(report.governance.providerCloudTransferApproved, false);
  assert.equal(report.governance.effectivePolicyVerified, false);
  assert.equal(report.project.docReferences.every((r) => !r.path.startsWith("/")), true);
  assert.doesNotMatch(JSON.stringify(report), /rootPath|mainWorktreePath|commonDir|KatoContext/);
});

test("integrated read-only context transports KUAS rules but never elevates trust or permits writes", () => {
  const modelContext = buildProjectWorkResume(project(), probe(), SHA, TIME);
  assert.match(modelContext.policy.instructions, /KatoSync Universal Agent Standards kuas\/v1/);
  assert.equal(modelContext.policy.ownerApproved, false);
  assert.equal(modelContext.governance.effectivePolicyVerified, false);
  assert.equal(modelContext.governance.providerCloudTransferApproved, false);
  assert.equal(modelContext.governance.writerLeaseVerified, false);
  assert.equal(modelContext.governance.allowsCodeWrites, false);
  const serialized = formatProjectWorkResume(modelContext);
  assert.ok(serialized.indexOf('"git"') < serialized.indexOf('"policy"'));
});
