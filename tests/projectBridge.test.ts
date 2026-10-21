// Created by NMKato Solutions
// Native stdio MCP + local CLI contract tests against synthetic repos ONLY.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const CLI = resolve("scripts/project-bridge/cli.mjs");
const MCP = resolve("scripts/project-bridge/mcp.mjs");
const SH = "abcdef1234567890abcdef1234567890abcdef12";

function git(repo: string, ...args: string[]) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "katosync-bridge-test-"));
  const repo = join(root, "test-proj");
  mkdirSync(repo);
  git(repo, "init", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# Test project\n");
  writeFileSync(join(repo, "PROJECT_STATUS_FLOW.md"), "# Test\nTOKEN=do-not-share\n");
  writeFileSync(join(repo, "MEMORY.md"), "PASSWORD=do-not-share\n");
  writeFileSync(join(repo, ".env.production"), "SECRET=do-not-share\n");
  git(repo, "add", "README.md", "PROJECT_STATUS_FLOW.md", "MEMORY.md");
  git(repo, "-c", "user.email=unit@invalid.local", "-c", "user.name=Test", "commit", "-m", "initial");
  const head = git(repo, "rev-parse", "HEAD");
  const registry = join(root, "project-registry.json");
  const record = {
    schemaVersion: 1,
    projects: [
      { id: "our-demo", name: "Synthetic project", source: "creation", rootPath: repo, scan: { headSha: head } },
      { id: "other-private", name: "Not allowed", source: "discovery", rootPath: repo, scan: { headSha: head } }
    ]
  };
  writeFileSync(registry, JSON.stringify(record));
  return { root, repo, head, registry, record };
}

function cli(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 10000 });
}

/** Non-admin Windows often disallows symlink creation. Authorization and path
 * rejection are still tested; only the OS-privileged symlink branch is skipped. */
function createTestSymlink(target: string, link: string, kind: "file" | "dir"): boolean {
  try {
    symlinkSync(target, link, kind);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EACCES")) return false;
    throw error;
  }
}

test("CLI is deny-by-default without an explicit per-project allowlist", () => {
  const f = fixture();
  try {
    const response = cli(["list", "--registry", f.registry]);
    assert.notEqual(response.status, 0);
    assert.match(response.stderr, /explicit_project_allowlist_required/);
    assert.equal(response.stdout, "");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("CLI lists only approved Registry IDs and omits device paths, private projects and content", () => {
  const f = fixture();
  try {
    const result = cli(["list", "--registry", f.registry, "--allow-project-id", "our-demo"]);
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.projects.map((p: { id: string }) => p.id), ["our-demo"]);
    assert.doesNotMatch(result.stdout, /other-private|do-not-share|test-proj|rootPath|tmp\//);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("fresh CLI context has Git truth, explicit KUAS, safe references and no permissions", () => {
  const f = fixture();
  try {
    const args = ["--registry", f.registry, "--allow-project-id", "our-demo"];
    const result = cli(["get", "our-demo", ...args]);
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.git.headSha, f.head);
    assert.equal(output.git.branch, "main");
    assert.equal(output.git.dirtyCount, 1); // ignored: .env.production is intentionally untracked
    assert.equal(output.policy.version, "kuas/v1");
    assert.equal(output.policy.profile, "community");
    assert.equal(output.policy.sha256.length, 64);
    assert.ok(output.policy.instructions.includes("[human_gate]"));
    assert.ok(output.documents.referencesOnly.includes("PROJECT_STATUS_FLOW.md"));
    assert.equal(output.authorization.codeWritesAllowed, false);
    assert.equal(output.authorization.cloudUploadAllowed, false);
    assert.doesNotMatch(result.stdout, /TOKEN=|PASSWORD=|SECRET=|do-not-share|test-proj|rootPath/);
    assert.notEqual(cli(["get", "other-private", ...args]).status, 0);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("registered Git HEAD drift is detected and arbitrary root path aliasing is rejected", () => {
  const f = fixture();
  try {
    f.record.projects[0].scan.headSha = SH;
    writeFileSync(f.registry, JSON.stringify(f.record));
    const args = ["--registry", f.registry, "--allow-project-id", "our-demo"];
    const drift = JSON.parse(cli(["get", "our-demo", ...args]).stdout);
    assert.equal(drift.git.headChangedSinceRegistry, true);
    assert.ok(drift.reasons.includes("head_changed_since_registry"));
    // The registered project root must be the actual Git root, not a parent/child arbitrary path.
    f.record.projects[0].rootPath = join(f.repo, "docs");
    mkdirSync(join(f.repo, "docs"));
    writeFileSync(f.registry, JSON.stringify(f.record));
    const invalid = cli(["get", "our-demo", ...args]);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /registry_root_mismatch/);
    const link = join(f.root, "repo-link");
    if (createTestSymlink(f.repo, link, "dir")) {
      f.record.projects[0].rootPath = link;
      writeFileSync(f.registry, JSON.stringify(f.record));
      const redirected = cli(["get", "our-demo", ...args]);
      assert.notEqual(redirected.status, 0);
      assert.match(redirected.stderr, /registered_root_unavailable/);
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("registry symlink and denied project requests fail safely", () => {
  const f = fixture();
  try {
    const link = join(f.root, "registry-symlink.json");
    if (createTestSymlink(f.registry, link, "file")) {
      const denied = cli(["get", "our-demo", "--registry", link, "--allow-project-id", "our-demo"]);
      assert.notEqual(denied.status, 0);
      assert.match(denied.stderr, /registry_unavailable/);
    }
    const traversal = cli(["get", "../../x", "--registry", f.registry, "--allow-project-id", "our-demo"]);
    assert.notEqual(traversal.status, 0);
    assert.doesNotMatch(traversal.stderr, /\/tmp\/|private/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("official MCP client can connect, list tools and call read-only context; unauthorized call fails", async () => {
  const f = fixture();
  const client = new Client({ name: "katosync-bridge-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP, "--registry", f.registry, "--allow-project-id", "our-demo"]
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(t => t.name).sort(), ["project_context_get", "project_list"]);
    const list = await client.callTool({ name: "project_list", arguments: {} });
    assert.equal(list.isError, undefined);
    assert.equal(list.structuredContent?.projects?.[0]?.id, "our-demo");
    const context = await client.callTool({ name: "project_context_get", arguments: { projectId: "our-demo" } });
    assert.equal(context.isError, undefined);
    assert.equal(context.structuredContent?.git?.headSha, f.head);
    assert.equal(context.structuredContent?.authorization?.codeWritesAllowed, false);
    const denied = await client.callTool({ name: "project_context_get", arguments: { projectId: "other-private" } });
    assert.equal(denied.isError, true);
    assert.match(String(denied.content?.[0]?.text), /project_not_allowed/);
  } finally {
    await client.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
