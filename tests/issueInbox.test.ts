// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import { buildIssueInbox } from "../src/lib/issueInbox.ts";
import type { RegistryProject } from "../src/types.ts";

const scannedAt = "2026-10-19T11:00:00Z";
function project(id: string, remote: string, sha: string | null = "abcd0123456789"): RegistryProject {
  return {
    id,
    name: id,
    identityKey: id,
    aliases: [],
    rootPath: `/tmp/${id}`,
    commonDir: null,
    remote,
    addedAt: scannedAt,
    source: "discovery",
    focus: { status: "active", priority: "P1", autoMode: "off", scope: null, origin: "user", updatedAt: scannedAt },
    scan: sha ? { scannedAt, branch: "dev", headSha: sha, headDate: scannedAt, dirtyCount: 0, worktrees: [], docs: [], manifests: [] } : null,
    verification: null,
    capsule: null,
    resolutions: {}
  };
}
const issues = (repo: string, items: unknown[]) => ({ remote: `git@github.com:NMKato/${repo}.git`, issues: items });
const entry = (repo: string, num: number, labels: unknown[] = []) => ({
  number: num,
  title: "Fix security and authorization",
  url: `https://github.com/nmkato/${repo.toLowerCase()}/issues/${num}`,
  updatedAt: "2026-10-19T09:00:00Z",
  state: "OPEN",
  labels
});

test("maps selected repos to canonical projects, sorts severity, never autoruns", () => {
  const found = buildIssueInbox([
    project("website", "https://github.com/NMKato/KatoOS-Website.git"),
    project("sync", "git@github.com:NMKato/KatoSync.git")
  ], [
    issues("KatoSync", [entry("KatoSync", 64, [{name: "P2"}])]),
    issues("KatoOS-Website", [entry("KatoOS-Website", 229, ["P0", "security"])])
  ], scannedAt);
  assert.deepEqual(found.entries.map((x) => x.key), ["nmkato/katoos-website#229","nmkato/katosync#64"]);
  assert.equal(found.entries[0].securityRelated, true);
  assert.equal(found.entries[0].requiresHumanApproval, true);
  assert.equal(found.entries[0].autoFixAllowed, false);
  assert.equal(found.assessment, "requires_review");
});

test("deduplicates unchanged issue snapshots and retains newest matching issue", () => {
  const a = entry("KatoSync", 64);
  const b = {...a, updatedAt: "2026-10-19T12:00:00Z", labels: ["P1"]};
  const found = buildIssueInbox([project("sync","https://github.com/NMKato/KatoSync")],
    [issues("KatoSync", [a,b,a])], scannedAt);
  assert.equal(found.entries.length, 1);
  assert.equal(found.entries[0].priority, "P1");
});

test("foreign repos, hijacked URLs and closed issues never enter queue", () => {
  const found = buildIssueInbox([project("sync","https://github.com/NMKato/KatoSync")], [
    issues("KatoSync", [
      {...entry("KatoSync", 7),url:"https://evil.example/issues/7"},
      {...entry("KatoSync", 8),url:"https://github.com/nmkato/other/issues/8"},
      {...entry("KatoSync", 9),state:"CLOSED"},
      {...entry("KatoSync", 10),url:"https://github.com/nmkato/katosync/issues/10?inject=1"},
      entry("KatoSync", 11)
    ]),
    issues("OtherRepo",[entry("OtherRepo", 45)])
  ], scannedAt);
  assert.deepEqual(found.entries.map((i)=>i.number),[11]);
  assert.equal(found.invalidIssueCount, 4);
  assert.equal(found.unmatchedRepoCount,1);
});

test("unverified project sha and missing scan cannot authorize auto-fix", () => {
  const found=buildIssueInbox([project("sync","https://github.com/NMKato/KatoSync",null)],
    [issues("KatoSync",[entry("KatoSync",64)])],scannedAt);
  assert.equal(found.entries[0].reviewReason, "project_commit_unverified");
  assert.equal(found.entries[0].autoFixAllowed, false);
});

test("ambiguous linked project never silently claims an issue", () => {
  const found=buildIssueInbox([
    project("syncA","https://github.com/NMKato/KatoSync"),
    project("syncB","git@github.com:NMKato/KatoSync.git")
  ],[issues("KatoSync",[entry("KatoSync",64)])],scannedAt);
  assert.equal(found.entries.length,0);
  assert.equal(found.ambiguousRepoCount,1);
  assert.equal(found.assessment,"requires_review");
});

test("no batches is unknown, not beta-ready", () => {
  assert.equal(buildIssueInbox([],[],scannedAt).assessment,"requires_review");
});
