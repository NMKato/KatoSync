// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalIdentityKey, groupDiscoveredRepos } from "../src/lib/projectDiscovery.ts";
import {
  hasSecretPattern,
  isExcludedDirName,
  isExcludedRelativePath,
  isSecretFileName,
  normalizeRemote,
  redactSecrets,
  sanitizeRemoteUrl
} from "../src/lib/projectExclusions.ts";
import { evaluateFocus, projectKey, resolveFocusProjectId } from "../src/lib/projectFocus.ts";
import {
  addDiscoveredProjects,
  applyProbe,
  buildFocusPolicy,
  buildRepoMap,
  canonicalProjectId,
  emptyRegistry,
  legacyScanRoots,
  linkProfileId,
  missingProfileProjects,
  parseRegistry,
  projectDisplayName,
  reconcileLegacy,
  removeProject,
  repoPathFor,
  resolveFinding,
  updateFocus
} from "../src/lib/projectRegistry.ts";
import { collectClaims, parseStatusClaims, verifyProject } from "../src/lib/projectVerification.ts";
import { buildContextCapsule } from "../src/lib/projectCapsule.ts";
import { planAutoLanes, type AutoLanePlannerInput } from "../src/lib/autoLanePlanner.ts";
import { normalizeAgentSyncState } from "../src/lib/agentJobModel.ts";
import type { ActionPlan, ActionTask, AgentLane, DocFact, ProjectProbe, RepoFacts } from "../src/types.ts";

const NOW = "2026-10-05T12:00:00.000Z";

function repo(path: string, patch: Partial<RepoFacts> = {}): RepoFacts {
  return {
    path,
    commonDir: `${path}/.git`,
    mainWorktreePath: path,
    isLinkedWorktree: false,
    remote: null,
    branch: "main",
    detached: false,
    headSha: "aaaaaaa1111111",
    headDate: "2026-10-05T08:00:00Z",
    dirtyCount: 0,
    untrackedCount: 0,
    ahead: 0,
    behind: 0,
    recentShas: ["aaaaaaa", "bbbbbbb", "ccccccc"],
    worktrees: [],
    ...patch
  };
}

function doc(path: string, kind: DocFact["kind"], content: string | null, patch: Partial<DocFact> = {}): DocFact {
  return { path, kind, bytes: content?.length ?? 0, modifiedAt: "2026-10-05T07:00:00Z", content, excluded: null, ...patch };
}

function probe(docs: DocFact[], repoPatch: Partial<RepoFacts> = {}): ProjectProbe {
  return {
    repo: repo("/work/demo", { remote: "https://github.com/acme/Demo.git", ...repoPatch }),
    docs,
    manifests: [{ kind: "package.json", path: "package.json", name: "demo", version: "2.0.0", hints: ["React", "Vite"] }],
    scannedAt: NOW
  };
}

// ===== Exclusions =====
test("secret and path exclusions cover env files, keys, certs, build outputs and caches", () => {
  for (const name of [".env", ".env.local", "id_rsa", "server.pem", "cert.p12", "apikey.txt", "my_secret.md", "release.keystore", ".npmrc"]) {
    assert.equal(isSecretFileName(name), true, name);
  }
  assert.equal(isSecretFileName("README.md"), false);
  for (const dir of ["node_modules", "DerivedData", "build", "dist", "target", "Pods", ".cache", ".git", ".ssh", "Library"]) {
    assert.equal(isExcludedDirName(dir), true, dir);
  }
  assert.equal(isExcludedDirName("KatoSync"), false);
  assert.equal(isExcludedRelativePath("docs/ARCHITECTURE.md"), false);
  assert.equal(isExcludedRelativePath("node_modules/pkg/README.md"), true);
  assert.equal(isExcludedRelativePath("config/.env.production"), true);
  assert.equal(isExcludedRelativePath("../outside.md"), true);
  assert.equal(isExcludedRelativePath("/etc/passwd"), true);
  assert.equal(isExcludedRelativePath("DerivedData/Build/status.md"), true);
});

test("secret content is detected and redacted; remote credentials are stripped", () => {
  assert.equal(hasSecretPattern("OPENAI_API_KEY=abc"), true);
  assert.equal(hasSecretPattern("Nichts Geheimes hier"), false);
  assert.equal(redactSecrets("token: PASSWORD = hunter2").includes("PASSWORD"), false);
  assert.equal(sanitizeRemoteUrl("https://user:ghp_secret@github.com/acme/demo.git"), "https://github.com/acme/demo.git");
  assert.equal(sanitizeRemoteUrl("git@github.com:acme/demo.git"), "git@github.com:acme/demo.git");
  assert.equal(normalizeRemote("https://token@GitHub.com/Acme/Demo.git"), "github.com/acme/demo");
  assert.equal(normalizeRemote("git@github.com:Acme/Demo.git"), "github.com/acme/demo");
  assert.equal(normalizeRemote("ssh://git@github.com:22/Acme/Demo"), "github.com/acme/demo");
});

// ===== Discovery grouping / canonical identity =====
test("worktrees and clones of one repository collapse into a single canonical project", () => {
  const main = repo("/work/KatoSync", { remote: "https://github.com/NMKato/KatoSync.git", commonDir: "/work/KatoSync/.git" });
  const wtA = repo("/work/KatoSync-feat-a", { remote: "https://x:tok@github.com/NMKato/KatoSync.git", commonDir: "/work/KatoSync/.git", mainWorktreePath: "/work/KatoSync", isLinkedWorktree: true, branch: "feat/a", dirtyCount: 2 });
  const wtB = repo("/work/KatoSync-feat-b", { remote: "git@github.com:NMKato/KatoSync.git", commonDir: "/work/KatoSync/.git", mainWorktreePath: "/work/KatoSync", isLinkedWorktree: true, branch: "feat/b" });
  const other = repo("/work/GENXLine", { remote: "https://github.com/NMKato/GENXLine.git", commonDir: "/work/GENXLine/.git" });
  const grouped = groupDiscoveredRepos([wtB, other, wtA, main]);
  assert.equal(grouped.length, 2);
  const katosync = grouped.find((project) => project.id === "katosync");
  assert.ok(katosync);
  assert.equal(katosync.rootPath, "/work/KatoSync");
  assert.equal(katosync.checkoutCount, 3);
  assert.equal(katosync.dirtyCount, 2);
  assert.equal(katosync.profileId, "katosync");
  assert.equal(grouped.find((project) => project.id === "genxline")?.profileId, "genxline");
  // Reihenfolge der Eingabe darf das Ergebnis nicht aendern.
  assert.deepEqual(groupDiscoveredRepos([main, wtA, wtB, other]), grouped);
});

test("KatoOs_MAA_KAI is recognised as the KatoOS Beta focus project", () => {
  const grouped = groupDiscoveredRepos([
    repo("/work/KatoOs_MAA_KAI", { remote: "https://github.com/NMKato/KatoOs_MAA_KAI.git" })
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].profileId, "katoos-beta");
  assert.equal(grouped[0].id, "katoos-beta");
});

test("identity falls back to the shared git dir without a remote; linked-only discovery uses the main worktree as root", () => {
  const a = repo("/w/app", { commonDir: "/w/app/.git" });
  const linked = repo("/w/app-wt", { commonDir: "/w/app/.git", mainWorktreePath: "/w/app", isLinkedWorktree: true });
  assert.equal(canonicalIdentityKey(a), canonicalIdentityKey(linked));
  assert.equal(canonicalIdentityKey(a), "local:/w/app/.git");
  const onlyLinked = groupDiscoveredRepos([linked]);
  assert.equal(onlyLinked.length, 1);
  assert.equal(onlyLinked[0].rootPath, "/w/app");
});

test("project ids are stable, collision-free and recognise the approved focus profile without inventing projects", () => {
  const kai = repo("/w/KAI-Desktop-Agent", { remote: "https://github.com/NMKato/KAI-Desktop-Agent.git" });
  const dup1 = repo("/w/a/tool", { remote: "https://github.com/one/tool.git" });
  const dup2 = repo("/w/b/tool", { remote: "https://github.com/two/tool.git" });
  const grouped = groupDiscoveredRepos([kai, dup1, dup2]);
  assert.equal(grouped.find((project) => project.profileId === "kai-desktop")?.id, "kai-desktop");
  const tools = grouped.filter((project) => project.name === "tool");
  assert.equal(tools.length, 2);
  assert.notEqual(tools[0].id, tools[1].id);
  assert.ok(tools.some((project) => project.id === "tool"));
  // Stabil: zweiter Lauf mit Registry liefert dieselben IDs.
  const registry = addDiscoveredProjects(emptyRegistry(NOW), grouped, NOW);
  const again = groupDiscoveredRepos([dup2, kai, dup1], registry);
  assert.deepEqual(again.map((project) => project.id).sort(), grouped.map((project) => project.id).sort());
  assert.ok(again.every((project) => project.alreadyRegistered));
  // Nichts erfunden: katoos-beta fehlt und wird nur gemeldet.
  assert.deepEqual(missingProfileProjects(registry).map((entry) => entry.id), ["katosync", "katoos-beta", "genxline"]);
});

test("known focus profile projects are seeded active; unknown projects start active but manual; migration imports start parked", () => {
  const grouped = groupDiscoveredRepos([
    repo("/w/KatoSync", { remote: "https://github.com/NMKato/KatoSync.git" }),
    repo("/w/Foo", { remote: "https://github.com/NMKato/Foo.git" })
  ]);
  const registry = addDiscoveredProjects(emptyRegistry(NOW), grouped, NOW);
  const katosync = registry.projects.find((project) => project.id === "katosync");
  const foo = registry.projects.find((project) => project.id === "foo");
  assert.deepEqual([katosync?.focus.status, katosync?.focus.priority, katosync?.focus.autoMode], ["active", "P0", "inherit"]);
  assert.deepEqual([foo?.focus.status, foo?.focus.autoMode], ["active", "off"]);
  const migrated = addDiscoveredProjects(emptyRegistry(NOW), groupDiscoveredRepos([repo("/w/Bar", { remote: "https://github.com/NMKato/Bar.git" })]), NOW, "migration");
  assert.deepEqual([migrated.projects[0].focus.status, migrated.projects[0].focus.origin], ["parked", "migration"]);
  // Erneutes Hinzufuegen ueberschreibt nichts.
  assert.equal(addDiscoveredProjects(registry, grouped, NOW), registry);
});

// ===== Verification: docs vs git =====
test("claims parser reads date, branch, head, version, wave, PR refs and human gates; ignores nothing silently", () => {
  const claims = parseStatusClaims(
    [
      "# Status",
      "Stand: 2026-07-16",
      "- Branch: `feat/old`",
      "- HEAD: 1234abc",
      "- Version: 2.0.0",
      "- Aktuelle Welle: Twilio Provisioning",
      "- PR #12 ist noch im Review",
      "- PR #9 merged",
      "- Human Gate: Freigabe ausstehend für Release"
    ].join("\n")
  );
  assert.equal(claims.updatedAt, "2026-07-16");
  assert.equal(claims.branch, "feat/old");
  assert.equal(claims.headSha, "1234abc");
  assert.equal(claims.version, "2.0.0");
  assert.equal(claims.waveText, "Twilio Provisioning");
  assert.deepEqual(claims.prRefs.map((ref) => [ref.ref, ref.pending]), [["PR #12", true], ["PR #9", false]]);
  assert.equal(claims.humanGates.length, 1);
});

test("policy headings and guardrail references are not treated as active human gates", () => {
  const claims = parseStatusClaims(
    [
      "# Status",
      "Stand: 2026-10-05",
      "## Human gate policy",
      "WAIT_HUMAN ist exceptional, not routine.",
      "- Human Gates nicht automatisch ueberfahren.",
      "- Human Gate: Freigabe ausstehend für visuellen Release"
    ].join("\n")
  );
  assert.deepEqual(claims.humanGates, ["- Human Gate: Freigabe ausstehend für visuellen Release"]);
});

test("fresh handoff truth does not inherit stale branch, PR or gate claims from old status docs", () => {
  const merged = collectClaims([
    doc(
      "PROJECT_HANDOFF.md",
      "handoff",
      "Stand: 2026-10-05\n\n## Naechster sicherer Schritt\n- Read-only THEORG-Pfad live abnehmen"
    ),
    doc(
      "PROJECT_STATUS_FLOW.md",
      "status",
      "Stand: 2026-07-31\nBranch: feat/windows-uia\nHEAD: 3e1b927\n- PR #208 Draft offen\n- Human Gate: Freigabe ausstehend"
    )
  ]);
  assert.ok(merged);
  assert.equal(merged.claims.updatedAt, "2026-10-05");
  assert.equal(merged.claims.branch, null);
  assert.equal(merged.claims.headSha, null);
  assert.deepEqual(merged.claims.prRefs, []);
  assert.deepEqual(merged.claims.humanGates, []);
});

test("an undated prompt with fresh checkout mtime cannot override an explicitly dated handoff", () => {
  const merged = collectClaims([
    doc(
      "PROJECT_HANDOFF_AUTOQ.md",
      "handoff",
      "Stand: 2026-10-05\nBranch: autoq/theorg-e2e-20261005\n\n## Naechster sicherer Schritt\n- Current THEORG read-only acceptance",
      { modifiedAt: "2026-10-05T08:00:00Z" }
    ),
    doc(
      "PROJECT_HANDOFF_PROMPT.md",
      "handoff",
      "Branch: feat/windows-uia\nHEAD: 3e1b927\n\n## Naechster sicherer Schritt\n- Historical prompt",
      { modifiedAt: "2026-10-05T21:43:00Z" }
    )
  ]);
  assert.ok(merged);
  assert.equal(merged.claims.updatedAt, "2026-10-05");
  assert.equal(merged.claims.branch, "autoq/theorg-e2e-20261005");
  assert.equal(merged.claims.headSha, null);
});

test("stale status docs are reported against newer commits and offer safe choices instead of auto-fixing", () => {
  const stale = probe([doc("PROJECT_STATUS_FLOW.md", "status", "Stand: 2026-07-16\n- Branch: main\n- Aktuelle Welle: Telefon")]);
  const result = verifyProject({ probe: stale, resolutions: {}, now: NOW });
  assert.equal(result.state, "status_stale");
  const finding = result.findings.find((entry) => entry.id === "stale_date");
  assert.deepEqual(finding?.choices, ["use_code_truth", "keep_docs_baseline", "inspect"]);
  assert.equal(finding?.docValue, "2026-07-16");
  assert.equal(finding?.codeValue, "2026-10-05");
});

test("current docs on a clean tree are verified; no readable status doc is never 'verified'", () => {
  const ok = verifyProject({ probe: probe([doc("PROJECT_STATUS_FLOW.md", "status", "Stand: 2026-10-05\nBranch: main\nVersion: 2.0.0")]), resolutions: {}, now: NOW });
  assert.equal(ok.state, "verified");
  assert.equal(ok.findings.length, 0);
  const none = verifyProject({ probe: probe([doc("README.md", "readme", "Hello world project")]), resolutions: {}, now: NOW });
  assert.equal(none.state, "no_status_doc");
  const excluded = verifyProject({ probe: probe([doc("PROJECT_STATUS_FLOW.md", "status", null, { excluded: "secret_pattern" })]), resolutions: {}, now: NOW });
  assert.equal(excluded.state, "no_status_doc");
});

test("docs/code mismatches: unknown documented commit, missing branch and manifest version", () => {
  const result = verifyProject({
    probe: probe([doc("PROJECT_STATUS_FLOW.md", "status", "Stand: 2026-10-05\nBranch: feat/gone\nHEAD: deadbee1\nVersion: 1.0.0")]),
    resolutions: {},
    now: NOW
  });
  assert.equal(result.state, "docs_mismatch");
  assert.deepEqual(result.findings.map((entry) => entry.id).sort(), ["mismatch_branch", "mismatch_head", "mismatch_version"]);
});

test("documented head behind HEAD is stale; dirty tree, pending PR, unpushed commits and human gate are surfaced", () => {
  const behind = verifyProject({
    probe: probe([doc("PROJECT_HANDOFF.md", "handoff", "Stand: 2026-10-05\nHEAD: ccccc12\nBranch: main")], { recentShas: ["aaaaaaa", "bbbbbbb", "ccccc12"] }),
    resolutions: {},
    now: NOW
  });
  assert.equal(behind.findings.find((entry) => entry.id === "stale_head")?.detail.includes("2 Commits"), true);

  const busy = verifyProject({
    probe: probe(
      [doc("PROJECT_STATUS_FLOW.md", "status", "Stand: 2026-10-05\nBranch: main\n- PR #7 Draft offen\n- Human Gate: wartet auf Freigabe")],
      { dirtyCount: 3, ahead: 2 }
    ),
    resolutions: {},
    now: NOW
  });
  const ids = busy.findings.map((entry) => entry.id).sort();
  assert.deepEqual(ids, ["dirty", "human_gate", "pr_pending", "unpushed"]);
  // Prioritaet der Schlagzeile: human_gate vor dirty vor review_pending.
  assert.equal(busy.state, "human_gate");
});

test("a user decision resolves a finding only for the HEAD it was made on", () => {
  const stale = probe([doc("PROJECT_STATUS_FLOW.md", "status", "Stand: 2026-07-16\nBranch: main")]);
  let registry = addDiscoveredProjects(emptyRegistry(NOW), groupDiscoveredRepos([stale.repo]), NOW);
  const id = registry.projects[0].id;
  registry = applyProbe(registry, id, stale, NOW);
  assert.equal(registry.projects[0].verification?.state, "status_stale");
  registry = resolveFinding(registry, id, "stale_date", "keep_docs_baseline", NOW);
  assert.equal(registry.projects[0].verification?.state, "verified");
  assert.equal(registry.projects[0].verification?.findings[0].resolved, "keep_docs_baseline");
  // Rescan auf gleichem HEAD behaelt die Entscheidung, neuer HEAD verwirft sie.
  registry = applyProbe(registry, id, stale, NOW);
  assert.equal(registry.projects[0].verification?.state, "verified");
  const moved = { ...stale, repo: { ...stale.repo, headSha: "fffffff9999999", recentShas: ["fffffff", "aaaaaaa"] } };
  registry = applyProbe(registry, id, moved, NOW);
  assert.equal(registry.projects[0].verification?.state, "status_stale");
});

// ===== Capsule =====
test("capsule is compact, provider-neutral, redacted and path-free", () => {
  const p = probe([
    doc("README.md", "readme", "# Demo\n\n[![badge](x)](y)\n\nDemo ist eine lokale Desktop-App für Projektgedächtnis mit MVVM und Repository-Muster.\n"),
    doc("AGENTS.md", "agents", "# Regeln\n\n- Niemals Zugangsdaten loggen.\n- Kein automatisches Merge.\n- Nutze PASSWORD = geheim nie im Text\n"),
    doc("PROJECT_STATUS_FLOW.md", "status", "Stand: 2026-10-05\nAktuelle Welle: Registry Slice\n\n## Next Safe Steps\n- Tests ergänzen\n- [x] erledigt\n- PR öffnen\n")
  ], { worktrees: [{ path: "/private/home/user/demo-wt", branch: "feat/x", headSha: "abc", detached: false, locked: false, dirtyCount: 1 }] });
  const verification = verifyProject({ probe: p, resolutions: {}, now: NOW });
  const capsule = buildContextCapsule({ projectId: "demo", name: "Demo", probe: p, verification, resolutions: {}, now: NOW });
  assert.equal(capsule.schema, "katosync.project-capsule/v1");
  assert.match(capsule.purpose, /lokale Desktop-App/);
  assert.ok(capsule.architecture.includes("MVVM") && capsule.architecture.includes("Repository"));
  assert.ok(capsule.guardrails.includes("Niemals Zugangsdaten loggen."));
  assert.equal(capsule.currentWave.text, "Registry Slice");
  assert.equal(capsule.currentWave.basis, "documented");
  assert.deepEqual(capsule.nextSafeWork, ["Tests ergänzen", "PR öffnen"]);
  assert.deepEqual(capsule.branches, [{ name: "demo-wt", branch: "feat/x", dirty: true }]);
  const json = JSON.stringify(capsule);
  assert.equal(json.includes("/private/home"), false);
  assert.equal(/PASSWORD\s*=/.test(json), false);
  // Der Worktree ist veraendert: ehrlich "dirty", nicht "verified".
  assert.equal(capsule.lastVerification.state, "dirty_worktree");
});

test("capsule prefers the freshest singular next-safe-step handoff over historical TODO blocks", () => {
  const p = probe([
    doc(
      "PROJECT_HANDOFF.md",
      "handoff",
      "Stand: 2026-10-05\n\n## Naechster sicherer Schritt\n- Read-only THEORG-Pfad live abnehmen",
      { modifiedAt: "2026-10-05T09:00:00Z" }
    ),
    doc(
      "PROJECT_STATUS_FLOW.md",
      "status",
      "Stand: 2026-07-31\n\n## Nächste Schritte\n- Alte Telefon-Aufgabe\n- Twilio Provisioning",
      { modifiedAt: "2026-07-31T09:00:00Z" }
    )
  ]);
  const verification = verifyProject({ probe: p, resolutions: {}, now: NOW });
  const capsule = buildContextCapsule({ projectId: "kai-desktop", name: "KAI Desktop", probe: p, verification, resolutions: {}, now: NOW });
  assert.deepEqual(capsule.nextSafeWork, ["Read-only THEORG-Pfad live abnehmen"]);
});

test("capsule ignores an undated historical prompt even when its checkout mtime is newer", () => {
  const p = probe([
    doc(
      "PROJECT_HANDOFF_AUTOQ.md",
      "handoff",
      "Stand: 2026-10-05\n\n## Naechster sicherer Schritt\n- Current AutoQ acceptance",
      { modifiedAt: "2026-10-05T08:00:00Z" }
    ),
    doc(
      "PROJECT_HANDOFF_PROMPT.md",
      "handoff",
      "## Naechster sicherer Schritt\n- Historical prompt task",
      { modifiedAt: "2026-10-05T21:43:00Z" }
    )
  ]);
  const verification = verifyProject({ probe: p, resolutions: {}, now: NOW });
  const capsule = buildContextCapsule({ projectId: "kai-desktop", name: "KAI Desktop", probe: p, verification, resolutions: {}, now: NOW });
  assert.deepEqual(capsule.nextSafeWork, ["Current AutoQ acceptance"]);
});

test("capsule switches to code truth only after the user chose it", () => {
  const stale = probe([doc("PROJECT_STATUS_FLOW.md", "status", "Stand: 2026-07-16\nAktuelle Welle: Telefon\nBranch: main")]);
  let registry = addDiscoveredProjects(emptyRegistry(NOW), groupDiscoveredRepos([stale.repo]), NOW);
  const id = registry.projects[0].id;
  registry = applyProbe(registry, id, stale, NOW);
  assert.equal(registry.projects[0].capsule?.currentWave.basis, "documented");
  assert.match(registry.projects[0].capsule?.nextSafeWork[0] ?? "", /abgleichen/);
  registry = resolveFinding(registry, id, "stale_date", "use_code_truth", NOW);
  registry = applyProbe(registry, id, stale, NOW);
  assert.equal(registry.projects[0].capsule?.currentWave.basis, "code_truth");
  assert.match(registry.projects[0].capsule?.currentWave.text ?? "", /Branch main @ aaaaaaa/);
});

test("persisted scan never keeps document bodies, excluded paths or credentials", () => {
  const p = probe([
    doc("PROJECT_STATUS_FLOW.md", "status", "Stand: 2026-10-05"),
    doc("node_modules/x/README.md", "readme", "leak"),
    doc(".env", "context", "SECRET=1")
  ], { remote: "https://u:tok@github.com/acme/Demo.git" });
  let registry = addDiscoveredProjects(emptyRegistry(NOW), groupDiscoveredRepos([p.repo]), NOW);
  registry = applyProbe(registry, registry.projects[0].id, p, NOW);
  const json = JSON.stringify(registry);
  assert.equal(json.includes("leak"), false);
  assert.equal(json.includes("SECRET=1"), false);
  assert.equal(json.includes("tok@"), false);
  assert.equal(json.includes("Stand: 2026-10-05"), false);
  assert.deepEqual(registry.projects[0].scan?.docs.map((entry) => entry.path), ["PROJECT_STATUS_FLOW.md"]);
});

// ===== Registry state, resolution, migration =====
test("registry resolves aliases, repo names and legacy keys; mapping only fails when genuinely unknown", () => {
  let registry = addDiscoveredProjects(
    emptyRegistry(NOW),
    groupDiscoveredRepos([repo("/w/KAI-Desktop-Agent", { remote: "https://github.com/NMKato/KAI-Desktop-Agent.git" })]),
    NOW
  );
  assert.equal(canonicalProjectId(registry, "kai-desktop"), "kai-desktop");
  assert.equal(canonicalProjectId(registry, "KAI-Desktop-Agent"), "kai-desktop");
  assert.equal(canonicalProjectId(registry, "NMKato/KAI-Desktop-Agent"), "kai-desktop");
  assert.equal(projectDisplayName(registry, "kai-desktop"), "KAI-Desktop-Agent");
  assert.equal(canonicalProjectId(registry, "unbekannt"), "unbekannt");
  assert.equal(projectDisplayName(registry, "__no_project__"), null);
  // Die Registry waehlt nie still einen Ausfuehrungsordner (der Runner wechselt dort den Branch).
  assert.equal(repoPathFor(registry, {}, "kai-desktop-agent"), null);
  assert.deepEqual(buildRepoMap(registry, {}, ["kai-desktop", "nope"]), {});
  // Eine ausdrueckliche Zuordnung greift unter jedem aufloesbaren Namen.
  assert.equal(repoPathFor(registry, { "kai-desktop": "/custom" }, "kai-desktop"), "/custom");
  assert.equal(repoPathFor(registry, { "kai-desktop": "/custom" }, "KAI-Desktop-Agent"), "/custom");
  assert.deepEqual(buildRepoMap(registry, { "kai-desktop": "/custom" }, ["KAI-Desktop-Agent"]), { "kai-desktop": "/custom", "KAI-Desktop-Agent": "/custom" });
  // Explizite Verknuepfung statt Raten: katoos-beta zeigt auf ein gewaehltes Projekt.
  registry = addDiscoveredProjects(registry, groupDiscoveredRepos([repo("/w/KatoOs_MAA_KAI", { remote: "https://github.com/NMKato/KatoOs_MAA_KAI.git" })]), NOW);
  const target = registry.projects.find((project) => project.name === "KatoOs_MAA_KAI");
  assert.ok(target);
  assert.equal(canonicalProjectId(registry, "katoos-beta"), "katoos-beta");
  registry = linkProfileId(registry, target.id, "katoos-beta", NOW);
  assert.equal(canonicalProjectId(registry, "katoos-beta"), target.id);
  assert.equal(findFocus(registry, "katoos-beta")?.priority, "P1");
  // Dasselbe Profil nicht zweimal vergeben.
  const other = registry.projects.find((project) => project.id === "kai-desktop");
  assert.equal(linkProfileId(registry, other!.id, "katoos-beta", NOW), registry);
});

function findFocus(registry: ReturnType<typeof emptyRegistry>, raw: string) {
  const policy = buildFocusPolicy(registry);
  const id = resolveFocusProjectId(policy, raw);
  return id ? policy.entries[id] : null;
}

test("ambiguous aliases are dropped instead of guessed", () => {
  let registry = emptyRegistry(NOW);
  registry = addDiscoveredProjects(registry, groupDiscoveredRepos([repo("/w/a", { remote: "https://github.com/one/shared.git" }), repo("/w/b", { remote: "https://github.com/two/shared.git" })]), NOW);
  const policy = buildFocusPolicy(registry);
  // "shared" ist die ID des ersten; das zweite hat ein Hash-Suffix, "two/shared" ist eindeutig.
  assert.equal(Object.keys(policy.entries).length, 2);
  assert.equal(resolveFocusProjectId(policy, "one/shared") !== null, true);
  assert.equal(resolveFocusProjectId(policy, "two/shared") !== null, true);
  assert.notEqual(resolveFocusProjectId(policy, "one/shared"), resolveFocusProjectId(policy, "two/shared"));
});

test("remove only drops the registry entry; focus updates are user-owned", () => {
  let registry = addDiscoveredProjects(emptyRegistry(NOW), groupDiscoveredRepos([repo("/w/Foo", { remote: "https://github.com/NMKato/Foo.git" })]), NOW);
  registry = updateFocus(registry, "foo", { status: "parked", priority: "P2", autoMode: "off" }, NOW);
  assert.equal(registry.projects[0].focus.origin, "user");
  assert.equal(removeProject(registry, "foo", NOW).projects.length, 0);
  assert.equal(removeProject(registry, "unknown", NOW), registry);
});

test("parseRegistry is defensive: bad focus values become parked/manual, junk is rejected", () => {
  assert.equal(parseRegistry(null, NOW), null);
  assert.equal(parseRegistry({ schemaVersion: 2, projects: [] }, NOW), null);
  const parsed = parseRegistry(
    {
      schemaVersion: 1,
      projects: [
        { id: "a", name: "A", identityKey: "local:/a", rootPath: "/a", remote: "https://u:t@github.com/o/a.git", focus: { status: "bogus", priority: "P9", autoMode: "yes" } },
        { id: "a", name: "dup", identityKey: "local:/a2", rootPath: "/a2" },
        { name: "no id" }
      ]
    },
    NOW
  );
  assert.ok(parsed);
  assert.equal(parsed.projects.length, 1);
  assert.deepEqual([parsed.projects[0].focus.status, parsed.projects[0].focus.priority, parsed.projects[0].focus.autoMode], ["parked", "P2", "off"]);
  assert.equal(parsed.projects[0].remote, "https://github.com/o/a.git");
});

test("legacy sourceRoots and projectRepos migrate without touching the old config", () => {
  const legacy = { sourceRoots: ["/w/Katoos-TelefonAssistent"], projectRepos: {} as Record<string, string> };
  const empty = reconcileLegacy(emptyRegistry(NOW), legacy, NOW);
  assert.equal(empty.migration.sourceRoots.status, "pending");
  assert.deepEqual(legacyScanRoots(legacy), ["/w/Katoos-TelefonAssistent"]);
  // Nach dem Hinzufuegen ist der alte Root abgedeckt.
  const added = addDiscoveredProjects(empty, groupDiscoveredRepos([repo("/w/Katoos-TelefonAssistent", { remote: "https://github.com/NMKato/Katoos-TelefonAssistent.git" })]), NOW, "migration");
  const done = reconcileLegacy(added, legacy, NOW);
  assert.equal(done.migration.sourceRoots.status, "done");
  assert.equal(done.projects[0].focus.status, "parked");
  // Eltern-Workspace deckt Kinder ab.
  assert.equal(reconcileLegacy(added, { sourceRoots: ["/w"], projectRepos: {} }, NOW).migration.sourceRoots.status, "done");
  // projectRepos-Schluessel werden Alias des passenden Projekts.
  const aliased = reconcileLegacy(added, { sourceRoots: [], projectRepos: { telefon: "/w/Katoos-TelefonAssistent" } }, NOW);
  assert.equal(aliased.migration.projectRepos.status, "done");
  assert.equal(canonicalProjectId(aliased, "telefon"), added.projects[0].id);
  // Leere Config bleibt "none"; unveraenderte Lage liefert dasselbe Objekt (kein Speicher-Loop).
  assert.equal(reconcileLegacy(emptyRegistry(NOW), { sourceRoots: [], projectRepos: {} }, NOW).migration.sourceRoots.status, "none");
  assert.equal(reconcileLegacy(done, legacy, "2026-10-06T00:00:00Z"), done);
  assert.deepEqual(legacy, { sourceRoots: ["/w/Katoos-TelefonAssistent"], projectRepos: {} });
});

// ===== Focus gate in the Auto-Lane Planner =====
function task(taskId: string, projectId: string, patch: Partial<ActionTask> = {}): ActionTask {
  return { taskId, priority: 1, projectId, title: `Task ${taskId}`, taskType: "code_task", targetRunner: "codex_cli", riskLevel: "medium", requiresApproval: true, status: "pending", ...patch };
}

function plan(planId: string, tasks: ActionTask[], patch: Partial<ActionPlan> = {}): ActionPlan {
  return { planId, source: "mistral", agentName: "planner", createdAt: "2026-07-16T08:00:00.000Z", status: "approved", executionMode: "sequential", dailyLimit: 5, riskLevel: "medium", requiresUserReview: true, tasks, ...patch };
}

const lane = (id: AgentLane["id"], eligible: boolean): AgentLane => ({ id, kind: "model_provider", intelligent: true, rank: 0, connectivity: "connected", activity: "idle", eligible });
const LANES = [lane("codex", true), lane("claude", true)];

function focusRegistry() {
  const repos = [
    repo("/w/KatoSync", { remote: "https://github.com/NMKato/KatoSync.git" }),
    repo("/w/KAI-Desktop-Agent", { remote: "https://github.com/NMKato/KAI-Desktop-Agent.git" }),
    repo("/w/GENXLine", { remote: "https://github.com/NMKato/GENXLine.git" }),
    repo("/w/Katoos-TelefonAssistent", { remote: "https://github.com/NMKato/Katoos-TelefonAssistent.git" }),
    repo("/w/PIGNick", { remote: "https://github.com/NMKato/PIGNick.git" })
  ];
  let registry = addDiscoveredProjects(emptyRegistry(NOW), groupDiscoveredRepos(repos), NOW);
  // Telefon + PIGNick wurden bewusst hinzugefuegt, aber nicht in den Fokus genommen.
  registry = updateFocus(registry, "katoos-telefonassistent", { status: "parked", autoMode: "off" }, NOW);
  registry = updateFocus(registry, "pignick", { status: "archived", autoMode: "off" }, NOW);
  return registry;
}

function plannerInput(registry: ReturnType<typeof emptyRegistry> | null, plans: ActionPlan[], patch: Partial<AutoLanePlannerInput> = {}): AutoLanePlannerInput {
  const tasks = plans.flatMap((entry) => entry.tasks);
  return {
    enabled: true,
    actionPlans: plans,
    selectedOrder: tasks.map((entry) => entry.taskId),
    repos: Object.fromEntries([...new Set(tasks.map((entry) => entry.projectId))].map((id) => [id, `repo-${id}`])),
    claims: [],
    inFlightTaskIds: [],
    startSafety: { safe: true, reason: "safe" },
    lanes: LANES,
    preferredRunner: "codex_cli",
    providerPriority: ["codex", "claude"],
    dailyCount: 0,
    dailyLimit: 5,
    maxConcurrent: 4,
    focus: registry ? buildFocusPolicy(registry) : undefined,
    ...patch
  };
}

test("planner: approved ready work in the four focus projects forms lanes; known IDs resolve", () => {
  const registry = focusRegistry();
  const result = planAutoLanes(plannerInput(registry, [plan("p", [task("t1", "katosync"), task("t2", "kai-desktop"), task("t3", "genxline"), task("t4", "KAI-Desktop-Agent")])]));
  assert.deepEqual(result.dispatch.map((entry) => entry.projectId).sort(), ["KAI-Desktop-Agent", "genxline", "kai-desktop", "katosync"]);
  assert.deepEqual(result.excluded, []);
});

test("planner: stale Twilio/telephony, PIGNick, parked, archived and unmapped tasks are excluded BEFORE ranking and never dispatched", () => {
  const registry = focusRegistry();
  const plans = [
    plan("old", [task("twilio-1", "katoos-telefonassistent"), task("twilio-2", "twilio-provisioning")]),
    plan("pig", [task("pig-1", "pignick")]),
    plan("none", [task("loose-1", "__no_project__")]),
    plan("live", [task("live-1", "katosync")])
  ];
  const result = planAutoLanes(plannerInput(registry, plans));
  assert.deepEqual(result.dispatch.map((entry) => entry.taskId), ["live-1"]);
  assert.deepEqual(result.lanes.map((entry) => entry.projectId), ["katosync"]);
  const reasons = Object.fromEntries(result.excluded.map((entry) => [entry.projectId, entry.reason]));
  assert.equal(reasons["katoos-telefonassistent"], "parked");
  assert.equal(reasons["pignick"], "archived");
  assert.equal(reasons["twilio-provisioning"], "unmapped");
  assert.equal(reasons["__no_project__"], "unmapped");
  // Keine "Freigabe empfehlen"-Lane fuer ausgeschlossene Projekte, auch nicht bei ungeklaertem Plan.
  const pending = planAutoLanes(plannerInput(registry, [plan("old", [task("twilio-1", "katoos-telefonassistent")], { status: "pending_user_review" })]));
  assert.equal(pending.lanes.length, 0);
  assert.equal(pending.excluded[0].reason, "parked");
});

test("planner: per-project manual mode blocks auto dispatch, inherit/on follow the global switch, global off still wins", () => {
  let registry = focusRegistry();
  registry = updateFocus(registry, "genxline", { autoMode: "off" }, NOW);
  registry = updateFocus(registry, "kai-desktop", { autoMode: "on" }, NOW);
  const plans = [plan("p", [task("a", "katosync"), task("b", "kai-desktop"), task("c", "genxline")])];
  const on = planAutoLanes(plannerInput(registry, plans));
  assert.deepEqual(on.dispatch.map((entry) => entry.projectId).sort(), ["kai-desktop", "katosync"]);
  assert.deepEqual(on.excluded.map((entry) => [entry.projectId, entry.reason]), [["genxline", "project_manual"]]);
  const off = planAutoLanes(plannerInput(registry, plans, { enabled: false }));
  assert.equal(off.dispatch.length, 0);
});

test("planner: without a focus policy the legacy behaviour is unchanged; an empty registry blocks all dispatch", () => {
  const plans = [plan("p", [task("a", "alpha")])];
  assert.equal(planAutoLanes(plannerInput(null, plans)).dispatch.length, 1);
  const blocked = planAutoLanes(plannerInput(emptyRegistry(NOW), plans));
  assert.equal(blocked.dispatch.length, 0);
  assert.equal(blocked.excluded[0].reason, "unmapped");
});

test("planner never auto-approves: an unapproved focus project stays blocked behind its approval gate", () => {
  const registry = focusRegistry();
  const result = planAutoLanes(plannerInput(registry, [plan("p", [task("a", "katosync")], { status: "pending_user_review" })]));
  assert.equal(result.dispatch.length, 0);
  assert.equal(result.lanes[0].reason, "approval_required");
});

test("evaluateFocus uses parked/archived/manual/unmapped reasons deterministically", () => {
  const policy = buildFocusPolicy(focusRegistry());
  assert.deepEqual(evaluateFocus(policy, "katosync"), { allowed: true, reason: null, canonicalId: "katosync" });
  assert.equal(evaluateFocus(policy, "PIGNick").reason, "archived");
  assert.equal(evaluateFocus(policy, "").reason, "unmapped");
  assert.equal(projectKey(" KAI Desktop_Agent "), "kai-desktop-agent");
});

// ===== Job model: stale plans do not become current recommendations =====
test("agent job model: out-of-focus plans stay visible but are never the recommended next job", () => {
  const registry = focusRegistry();
  const plans = [
    plan("old", [task("twilio-1", "katoos-telefonassistent")], { status: "approved", createdAt: "2026-07-16T08:00:00Z" }),
    plan("live", [task("live-1", "katosync")], { status: "approved", createdAt: "2026-10-05T08:00:00Z" })
  ];
  const base = {
    actionPlans: plans,
    codexRun: { status: "idle" } as never,
    codexEvents: [],
    currentQueueTaskId: null,
    queueRunning: false,
    localControl: null,
    providerStatuses: [],
    providerTransitions: [],
    providerPriority: [],
    now: NOW
  };
  const legacy = normalizeAgentSyncState(base);
  assert.equal(legacy.nextJob?.id, "twilio-1");
  const focused = normalizeAgentSyncState({ ...base, focus: buildFocusPolicy(registry) });
  assert.equal(focused.nextJob?.id, "live-1");
  const old = focused.jobs.find((job) => job.id === "twilio-1");
  assert.equal(old?.focus, "parked");
  assert.equal(focused.jobs.find((job) => job.id === "live-1")?.focus, undefined);
  // Leere Registry: Empfehlungen bleiben wie bisher sichtbar (Dispatch ist trotzdem gesperrt).
  assert.equal(normalizeAgentSyncState({ ...base, focus: buildFocusPolicy(emptyRegistry(NOW)) }).nextJob?.id, "twilio-1");
});
