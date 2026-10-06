// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import {
  HUB_NODE_ID,
  LOCAL_BRAIN_NODE_ID,
  MEMORY_STORE_NODE_ID,
  THIS_DEVICE_NODE_ID,
  buildVisionGraph,
  filterVisionGraph,
  initials,
  layoutVisionGraph,
  memoryFreshness,
  memoryTruth,
  nodeMatchesFilter,
  projectFreshness,
  runtimeFreshness,
  shortNodeId,
  truthFromVerification,
  type VisionGraph,
  type VisionGraphInput
} from "../src/lib/visionGraph.ts";
import type { LocalBrainStatus } from "../src/lib/localBrainCatalog.ts";
import type {
  AgentJob,
  AgentLane,
  AgentSyncState,
  MemoryFabricOverview,
  ProjectMemoryOverview,
  ProjectRegistry,
  RegistryProject
} from "../src/types.ts";

const NOW = "2026-10-06T12:00:00.000Z";
const ago = (minutes: number) => new Date(Date.parse(NOW) - minutes * 60_000).toISOString();
const DEVICE_ID = "ks-11111111-1111-1111-1111-111111111111";
const HEAD = "1111111111111111111111111111111111111111";
const NEXT_HEAD = "2222222222222222222222222222222222222222";

function project(id: string, patch: Partial<RegistryProject> = {}): RegistryProject {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    identityKey: `remote:github.com/acme/${id}`,
    aliases: [],
    rootPath: `/Users/someone/Projects/${id}`,
    commonDir: null,
    remote: `https://github.com/acme/${id}.git`,
    addedAt: ago(600),
    source: "discovery",
    focus: { status: "active", priority: "P1", autoMode: "inherit", origin: "user", updatedAt: ago(600) },
    scan: {
      scannedAt: ago(30),
      branch: "main",
      headSha: HEAD,
      headDate: ago(60),
      dirtyCount: 0,
      worktrees: [],
      docs: [],
      manifests: []
    },
    verification: { state: "verified", findings: [], checkedAt: ago(30), headSha: HEAD },
    capsule: null,
    resolutions: {},
    ...patch
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

function lane(id: AgentLane["id"], patch: Partial<AgentLane> = {}): AgentLane {
  return {
    id,
    kind: id === "local_control" ? "substrate" : id === "remote_orchestrator" ? "orchestrator" : "model_provider",
    intelligent: id !== "local_control",
    rank: 0,
    connectivity: "connected",
    activity: "idle",
    checkedAt: ago(2),
    eligible: true,
    ...patch
  };
}

function job(id: string, projectId: string, owner: AgentJob["owner"], status: AgentJob["status"]): AgentJob {
  return {
    id,
    source: "runner",
    projectId,
    task: "Task",
    owner,
    status,
    phase: status,
    startedAt: ago(5),
    lastActivityAt: ago(1),
    handoffs: [],
    events: []
  };
}

function agentSync(lanes: AgentLane[], jobs: AgentJob[] = [], remote: Partial<AgentSyncState["remote"]> = {}): AgentSyncState {
  return {
    currentJob: null,
    nextJob: null,
    jobs,
    lanes,
    events: [],
    handoffs: [],
    counts: {} as AgentSyncState["counts"],
    queueCount: 0,
    startSafety: { safe: true, reason: "safe" },
    localControl: "idle",
    remote: {
      transport: "unknown",
      orchestrator: "unavailable",
      ownership: "none",
      leaseActive: false,
      eligible: false,
      ...remote
    },
    scheduler: {} as AgentSyncState["scheduler"],
    autoLanes: {} as AgentSyncState["autoLanes"],
    generatedAt: NOW
  };
}

function memoryProject(projectId: string, patch: Partial<ProjectMemoryOverview> = {}): ProjectMemoryOverview {
  return {
    projectId,
    name: projectId,
    gitHead: HEAD,
    gitBranch: "main",
    indexedAt: ago(20),
    sources: 3,
    chunks: 12,
    observed: 1,
    verified: 2,
    canonical: 0,
    ...patch
  };
}

function memory(projects: ProjectMemoryOverview[], identities: MemoryFabricOverview["identities"] = []): MemoryFabricOverview {
  return {
    schemaVersion: "katosync.memory-overview/v1",
    fabricSchemaVersion: "katosync.memory-fabric/v1",
    available: true,
    projects,
    identities
  };
}

const brain: LocalBrainStatus = {
  supported: true,
  target: "aarch64-apple-darwin",
  ramGb: 32,
  ramFit: "recommended",
  runtimeId: "llama_cpp",
  runtimeVersion: "b1",
  runtimeInstalled: true,
  modelId: "gemma",
  modelName: "Gemma Local Brain",
  modelInstalled: true,
  modelSizeBytes: 1,
  quantization: "Q4_0",
  license: "Apache-2.0",
  sourceRepo: "example/model",
  sourceRevision: "rev",
  textReady: true,
  codeReady: true,
  toolsReady: false,
  audioReady: false,
  running: true,
  endpoint: "http://127.0.0.1:17842/v1",
  modelAlias: "kato-local-brain",
  visionReady: false
};

function fullInput(patch: Partial<VisionGraphInput> = {}): VisionGraphInput {
  return {
    nativeRuntime: true,
    config: { device: { deviceId: DEVICE_ID, deviceName: "Studio Mac" }, libraryId: "" },
    registry: registry([project("alpha"), project("beta", { aliases: ["beta-legacy"] })]),
    agentSync: agentSync(
      [
        lane("codex", { rank: 0, model: "gpt-5" }),
        lane("claude", { rank: 1, connectivity: "limited", activity: "waiting" }),
        lane("local", { rank: 2, model: "kato-local-brain" }),
        lane("remote_orchestrator", { connectivity: "disconnected", activity: "offline" }),
        lane("local_control", { connectivity: "connected" })
      ],
      [job("j1", "beta-legacy", "codex", "running"), job("j2", "ghost", "claude", "running")]
    ),
    providerStatuses: [],
    localBrain: brain,
    memory: memory([memoryProject("alpha"), memoryProject("orphan")], [{ nodeId: DEVICE_ID, displayName: "REX", kind: "rex_main" }]),
    now: NOW,
    ...patch
  };
}

const ids = (graph: VisionGraph) => graph.nodes.map((node) => node.id);
const edge = (graph: VisionGraph, id: string) => graph.edges.find((entry) => entry.id === id);

test("projection reflects the canonical sources and nothing else", () => {
  const graph = buildVisionGraph(fullInput());
  assert.equal(graph.runtime, "desktop");
  assert.deepEqual(graph.omitted, []);
  const nodeIds = ids(graph);
  for (const expected of [
    HUB_NODE_ID,
    THIS_DEVICE_NODE_ID,
    "project:alpha",
    "project:beta",
    MEMORY_STORE_NODE_ID,
    "memory:alpha",
    "memory:orphan",
    LOCAL_BRAIN_NODE_ID,
    "lane:codex",
    "lane:claude",
    "service:local_control"
  ]) {
    assert.ok(nodeIds.includes(expected), `missing ${expected}`);
  }
  // Local lane IS the managed Local Brain -> one node, not two.
  assert.ok(!nodeIds.includes("lane:local"));
  // The REX identity is bound to this device's node ID.
  const rex = graph.nodes.find((node) => node.id === LOCAL_BRAIN_NODE_ID)!;
  assert.equal(rex.label, "REX");
  assert.equal(rex.asset, "kai");
  assert.equal(graph.nodes.find((node) => node.id === HUB_NODE_ID)!.asset, "katosync");
  // Job on an alias resolves to the canonical project; unknown projects never become nodes.
  assert.ok(edge(graph, "works_on:lane:codex->project:beta"));
  assert.ok(!nodeIds.some((id) => id.includes("ghost")));
  assert.ok(!graph.edges.some((entry) => entry.to.includes("ghost")));
  // Orphan knowledge stays visible but is not linked to a fabricated project.
  assert.ok(!graph.edges.some((entry) => entry.from === "memory:orphan" && entry.kind === "knows"));
  assert.ok(edge(graph, "knows:memory:alpha->project:alpha"));
  assert.ok(edge(graph, `retrieves_from:${LOCAL_BRAIN_NODE_ID}->${MEMORY_STORE_NODE_ID}`));
  assert.ok(edge(graph, `runs_on:${LOCAL_BRAIN_NODE_ID}->${THIS_DEVICE_NODE_ID}`));
  assert.ok(edge(graph, `routes_to:${HUB_NODE_ID}->${LOCAL_BRAIN_NODE_ID}`));
});

test("unavailable sources are omitted, never invented", () => {
  const graph = buildVisionGraph(
    fullInput({
      config: { device: { deviceId: "", deviceName: "" }, libraryId: "" },
      registry: null,
      agentSync: null,
      localBrain: null,
      memory: { ...memory([]), available: false }
    })
  );
  assert.deepEqual(ids(graph), [HUB_NODE_ID]);
  assert.deepEqual(graph.edges, []);
  assert.deepEqual([...graph.omitted].sort(), ["agent_lanes", "device_identity", "local_brain", "memory_fabric", "project_registry"]);
});

test("browser preview never shows demo provider lanes or brain state", () => {
  const graph = buildVisionGraph(fullInput({ nativeRuntime: false }));
  assert.equal(graph.runtime, "browser_preview");
  assert.ok(!graph.nodes.some((node) => node.id.startsWith("lane:") || node.id.startsWith("service:local_control")));
  assert.ok(!ids(graph).includes(LOCAL_BRAIN_NODE_ID));
  assert.ok(!graph.edges.some((entry) => entry.kind === "works_on"));
  assert.ok(graph.omitted.includes("agent_lanes"));
});

test("not configured lanes and an unavailable orchestrator are not drawn", () => {
  const graph = buildVisionGraph(
    fullInput({
      localBrain: null,
      agentSync: agentSync([lane("codex", { connectivity: "not_configured", activity: "offline" }), lane("local", { connectivity: "unknown", activity: "unknown" }), lane("remote_orchestrator")])
    })
  );
  assert.ok(!ids(graph).includes("lane:codex"));
  assert.ok(!ids(graph).includes("lane:local"));
  assert.ok(!ids(graph).includes("service:remote_orchestrator"));
});

test("node and edge ids are unique and every edge has both endpoints", () => {
  const input = fullInput();
  // Duplicate jobs for the same lane/project must collapse to one edge.
  input.agentSync!.jobs.push(job("j3", "beta", "codex", "queued"));
  const graph = buildVisionGraph(input);
  const nodeIds = ids(graph);
  assert.equal(new Set(nodeIds).size, nodeIds.length);
  const edgeIds = graph.edges.map((entry) => entry.id);
  assert.equal(new Set(edgeIds).size, edgeIds.length);
  for (const entry of graph.edges) {
    assert.ok(nodeIds.includes(entry.from) && nodeIds.includes(entry.to), entry.id);
    assert.notEqual(entry.from, entry.to);
  }
  assert.equal(graph.edges.filter((entry) => entry.kind === "works_on" && entry.to === "project:beta").length, 1);
  assert.equal(edge(graph, "works_on:lane:codex->project:beta")!.activity, "active");
});

test("graph output carries no secrets, endpoints or absolute machine paths", () => {
  const graph = buildVisionGraph(fullInput({ config: { device: { deviceId: DEVICE_ID, deviceName: "Studio Mac" }, libraryId: "lib-secret-id" }, libraryVerified: true }));
  const json = JSON.stringify(graph);
  assert.ok(!json.includes("/Users/"), "no absolute paths");
  assert.ok(!json.includes("127.0.0.1"), "no endpoints");
  assert.ok(!json.includes("lib-secret-id"), "no library id");
  assert.ok(!json.includes(DEVICE_ID), "node id is only shown shortened");
  assert.ok(json.includes(shortNodeId(DEVICE_ID)));
  assert.ok(ids(graph).includes("service:mistral_library"));
});

test("truth and freshness mapping", () => {
  assert.equal(truthFromVerification("verified"), "verified");
  assert.equal(truthFromVerification("docs_mismatch"), "observed");
  assert.equal(truthFromVerification("unscanned"), "unknown");
  assert.equal(truthFromVerification(null), "unknown");

  assert.equal(projectFreshness(project("a")), "fresh");
  assert.equal(projectFreshness(project("a", { scan: null })), "unknown");
  assert.equal(projectFreshness(project("a", { verification: null })), "unknown");
  assert.equal(projectFreshness(project("a", { verification: { state: "status_stale", findings: [], checkedAt: NOW, headSha: HEAD } })), "stale");
  assert.equal(projectFreshness(project("a", { verification: { state: "verified", findings: [], checkedAt: NOW, headSha: NEXT_HEAD } })), "head_moved");

  assert.equal(memoryTruth(memoryProject("a", { canonical: 1 })), "canonical");
  assert.equal(memoryTruth(memoryProject("a", { canonical: 0, verified: 2 })), "verified");
  assert.equal(memoryTruth(memoryProject("a", { canonical: 0, verified: 0, observed: 1 })), "observed");
  assert.equal(memoryTruth(memoryProject("a", { canonical: 0, verified: 0, observed: 0 })), "unknown");

  assert.equal(memoryFreshness(memoryProject("a"), project("a")), "fresh");
  assert.equal(memoryFreshness(memoryProject("a", { gitHead: NEXT_HEAD }), project("a")), "head_moved");
  assert.equal(memoryFreshness(memoryProject("a"), null), "unknown");
  assert.equal(memoryFreshness(memoryProject("a", { gitHead: null }), project("a")), "unknown");

  assert.equal(runtimeFreshness(ago(5), NOW), "fresh");
  assert.equal(runtimeFreshness(ago(60), NOW), "stale");
  assert.equal(runtimeFreshness(null, NOW), "unknown");
  assert.equal(runtimeFreshness("not-a-date", NOW), "unknown");

  const graph = buildVisionGraph(fullInput());
  const claude = graph.nodes.find((node) => node.id === "lane:claude")!;
  assert.equal(claude.activity, "waiting");
  assert.equal(claude.truth, "verified");
  assert.equal(claude.scope, "cloud");
  assert.equal(graph.nodes.find((node) => node.id === "lane:codex")!.activity, "ready");
  assert.equal(graph.nodes.find((node) => node.id === "memory:alpha")!.freshness, "fresh");
  assert.equal(graph.nodes.find((node) => node.id === "memory:orphan")!.freshness, "unknown");
  assert.equal(graph.nodes.find((node) => node.id === "project:beta")!.activity, "active");
  const stopped = buildVisionGraph(fullInput({ localBrain: { ...brain, running: false } }));
  assert.equal(stopped.nodes.find((node) => node.id === LOCAL_BRAIN_NODE_ID)!.activity, "offline");
});

test("filters keep KatoSync as anchor and search highlights instead of hiding", () => {
  const graph = buildVisionGraph(fullInput());
  const projects = filterVisionGraph(graph, "projects", "");
  assert.deepEqual(projects.nodes.map((node) => node.id).sort(), [HUB_NODE_ID, "project:alpha", "project:beta"].sort());
  assert.ok(projects.edges.every((entry) => entry.kind === "knows" && entry.from === HUB_NODE_ID));
  assert.equal(projects.matches.size, 0);

  const models = filterVisionGraph(graph, "models", "");
  assert.ok(models.nodes.some((node) => node.id === LOCAL_BRAIN_NODE_ID));
  assert.ok(models.nodes.some((node) => node.id === "lane:codex"));
  assert.ok(!models.nodes.some((node) => node.kind === "project"));

  const cloud = filterVisionGraph(graph, "cloud", "");
  assert.ok(cloud.nodes.filter((node) => node.id !== HUB_NODE_ID).every((node) => node.scope === "cloud"));
  const local = filterVisionGraph(graph, "local", "");
  assert.ok(local.nodes.every((node) => node.scope === "local" || node.scope === "lan"));
  const knowledge = filterVisionGraph(graph, "knowledge", "");
  assert.ok(knowledge.nodes.some((node) => node.id === MEMORY_STORE_NODE_ID));
  assert.ok(knowledge.nodes.some((node) => node.id === "memory:alpha"));
  assert.ok(nodeMatchesFilter(graph.nodes.find((node) => node.id === THIS_DEVICE_NODE_ID)!, "devices"));

  const search = filterVisionGraph(graph, "all", "  BETA ");
  assert.equal(search.nodes.length, graph.nodes.length);
  assert.ok(search.matches.has("project:beta"));
  assert.ok(!search.matches.has("project:alpha"));
});

test("layout is deterministic and places every visible node", () => {
  const graph = buildVisionGraph(fullInput());
  const first = layoutVisionGraph(graph.nodes, graph.edges);
  const second = layoutVisionGraph([...graph.nodes].reverse(), graph.edges);
  assert.equal(first.size, graph.nodes.length);
  for (const node of graph.nodes) {
    assert.deepEqual(first.get(node.id), second.get(node.id), node.id);
  }
  assert.deepEqual(first.get(HUB_NODE_ID), { x: 0, y: 0, r: 34 });
});

test("initials and short node ids", () => {
  assert.equal(initials("KatoSync"), "KS");
  assert.equal(initials("Studio Mac"), "SM");
  assert.equal(initials("alpha"), "AL");
  assert.equal(initials("REX"), "REX");
  assert.equal(initials(""), "?");
  assert.equal(shortNodeId(DEVICE_ID), "ks-11111111…");
});
