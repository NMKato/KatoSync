// Created by NMKato Solutions
// Local, read-only, opt-in Project Registry bridge for CLI/MCP.
// No shell, no arbitrary caller paths, no background network listener, no code writes.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_REGISTRY_BYTES = 2 * 1024 * 1024;
const MAX_PROJECTS = 500;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/;
const DOC_PATHS = Object.freeze([
  "PROJECT_STATUS_FLOW.md", "MEMORY.md", "AGENTS.md", "README.md", "docs/TECH_STACK.md"
]);

export class BridgeError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function defaultRegistryPath() {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "KatoSync", "project-registry.json");
  if (process.platform === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "KatoSync", "project-registry.json");
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "KatoSync", "project-registry.json");
}

export function bridgeConfig(args) {
  const config = { registryPath: defaultRegistryPath(), allowedProjectIds: new Set() };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--allow-project-id" && args[i + 1]) {
      const id = args[++i];
      if (!ID_PATTERN.test(id)) throw new BridgeError("invalid_allowed_project_id");
      config.allowedProjectIds.add(id);
    } else if (args[i] === "--registry" && args[i + 1]) {
      const p = args[++i];
      if (!isAbsolute(p)) throw new BridgeError("registry_must_be_absolute_path");
      config.registryPath = p;
    } else throw new BridgeError("unknown_bridge_argument");
  }
  if (!config.allowedProjectIds.size || config.allowedProjectIds.size > 32) {
    throw new BridgeError("explicit_project_allowlist_required");
  }
  return config;
}

function safeDisplay(value, max = 100) {
  if (typeof value !== "string") return "";
  return value.replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/(?:sk-[A-Za-z0-9_-]{10,}|(?:API_KEY|SECRET|TOKEN|PASSWORD)\s*=\s*\S+)/gi, "[redacted]")
    .replace(/\s+/g, " ").slice(0, max).trim();
}

function readRegistry(path) {
  try {
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_REGISTRY_BYTES) throw new BridgeError("registry_unavailable");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.projects) || parsed.projects.length > MAX_PROJECTS) {
      throw new BridgeError("registry_invalid");
    }
    return parsed.projects;
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError("registry_unavailable");
  }
}

function approvedProjects(config) {
  const registered = readRegistry(config.registryPath);
  const seen = new Set();
  const results = [];
  for (const item of registered) {
    if (!item || typeof item !== "object" || !config.allowedProjectIds.has(item.id)) continue;
    if (!ID_PATTERN.test(item.id) || seen.has(item.id)) throw new BridgeError("ambiguous_project_identity");
    seen.add(item.id);
    results.push(item);
  }
  return results;
}

export function listProjects(config) {
  return {
    schemaVersion: "katosync.local-project-bridge/v1",
    scope: "explicit_project_allowlist",
    projects: approvedProjects(config).map(item => ({
      id: item.id,
      name: safeDisplay(item.name),
      source: ["creation", "discovery", "migration"].includes(item.source) ? item.source : "discovery",
      knownToRegistry: true
    })),
    note: "Listed projects are allowed by the local MCP/CLI launch configuration, not approved for code writes or cloud uploads."
  };
}

function fixedGit(root, ...args) {
  try {
    return execFileSync("git", [
      "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
      "-C", root, ...args
    ], {
      encoding: "utf8",
      timeout: 4000,
      maxBuffer: 128 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_PAGER: "cat"
      }
    }).trim();
  } catch {
    throw new BridgeError("git_read_failed");
  }
}

function trustworthyRoot(item) {
  if (typeof item.rootPath !== "string" || !isAbsolute(item.rootPath)) throw new BridgeError("registered_root_invalid");
  let root;
  try {
    if (lstatSync(item.rootPath).isSymbolicLink()) throw new BridgeError("registered_root_invalid");
    root = realpathSync(item.rootPath);
    if (!lstatSync(root).isDirectory()) throw new BridgeError("registered_root_invalid");
  } catch { throw new BridgeError("registered_root_unavailable"); }
  const toplevel = fixedGit(root, "rev-parse", "--show-toplevel");
  if (realpathSync(toplevel) !== root) throw new BridgeError("registry_root_mismatch");
  return root;
}

function allowedDocRefs(root) {
  return DOC_PATHS.filter(relative => {
    try {
      const path = join(root, relative);
      if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) return false;
      // Strictly named, non-symlink parent chains, never read document bytes.
      if (relative.includes("/") && lstatSync(dirname(path)).isSymbolicLink()) return false;
      return true;
    } catch { return false; }
  });
}

export function getProjectContext(config, projectId) {
  if (typeof projectId !== "string" || !ID_PATTERN.test(projectId) || !config.allowedProjectIds.has(projectId)) {
    throw new BridgeError("project_not_allowed");
  }
  const matches = approvedProjects(config).filter(item => item.id === projectId);
  if (matches.length !== 1) throw new BridgeError("project_not_registered_or_ambiguous");
  const project = matches[0];
  const root = trustworthyRoot(project);
  const headSha = fixedGit(root, "rev-parse", "--verify", "HEAD");
  if (!/^[0-9a-f]{40,64}$/i.test(headSha)) throw new BridgeError("git_head_invalid");
  const branchRaw = fixedGit(root, "rev-parse", "--abbrev-ref", "HEAD");
  const branch = branchRaw === "HEAD" ? null : safeDisplay(branchRaw, 120);
  // Git status is observed locally; no paths/filenames are sent to a model.
  const status = fixedGit(root, "status", "--porcelain=v1", "--untracked-files=normal");
  const dirtyCount = status ? status.split("\n").length : 0;
  const registeredHead = typeof project.scan?.headSha === "string" && /^[0-9a-f]{7,64}$/i.test(project.scan.headSha)
    ? project.scan.headSha : null;

  const policyFile = fileURLToPath(new URL("../../src-tauri/policies/kuas-community-v1.txt", import.meta.url));
  const policy = readFileSync(policyFile, "utf8");
  if (!policy.startsWith("KatoSync Universal Agent Standards kuas/v1\n")) throw new BridgeError("kuas_policy_invalid");
  const policyDigest = createHash("sha256").update(policy).digest("hex");
  const changed = registeredHead !== null && registeredHead !== headSha;
  const reason = [
    ...(changed ? ["head_changed_since_registry"] : []),
    ...(dirtyCount ? ["dirty_worktree"] : []),
    ...(registeredHead === null ? ["registered_head_unverified"] : [])
  ];

  return {
    schemaVersion: "katosync.project-context/v1",
    projectId,
    projectName: safeDisplay(project.name),
    observedAt: new Date().toISOString(),
    evidence: "fresh_local_git_read_only",
    assessment: reason.length ? "requires_review" : "observed_git_state",
    reasons: reason,
    git: { headSha, branch, dirtyCount, registeredHead, headChangedSinceRegistry: changed },
    documents: { referencesOnly: allowedDocRefs(root), rawContentsShared: false },
    policy: {
      version: "kuas/v1",
      profile: "community",
      sha256: policyDigest,
      instructions: policy,
      organizationProfileVerified: false
    },
    authorization: {
      projectAllowedForRead: true,
      codeWritesAllowed: false,
      writerLeaseVerified: false,
      cloudUploadAllowed: false,
      independentTestsExecuted: false
    },
    note: "Registry and Git observations only. Do not infer current roadmap/decisions from references. Refresh after changes; retrieve documents using a separate approved provider-specific path. No writes, deployments, or cloud forwarding authorized."
  };
}
