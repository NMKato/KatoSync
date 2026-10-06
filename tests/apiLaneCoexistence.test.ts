// Created by NMKato Solutions
// API-Lane neben Abo-Lanes (Codex/Claude), Local Brain/REX, Vision, Local Control und AutoQ:
// eine zusaetzliche, getrennt abgerechnete Lane – sie ersetzt oder verdeckt keine andere.
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAgentSyncState, type AgentJobModelInput } from "../src/lib/agentJobModel.ts";
import {
  AGENT_LANE_ORDER,
  isIntelligentLane,
  nextLaneAfterFailure,
  normalizeProviderPriority
} from "../src/lib/providerPolicy.ts";
import { WARMUP_PROVIDERS } from "../src/lib/providerWarmupPolicy.ts";
import { LOCAL_BRAIN_NODE_ID, buildVisionGraph } from "../src/lib/visionGraph.ts";
import { AGENT_SYNC_STEPS, modeForStep } from "../src/lib/workspaceMode.ts";
import type { LocalBrainStatus } from "../src/lib/localBrainCatalog.ts";
import type { LocalControlMonitorSnapshot, ProviderId, ProviderStatus } from "../src/types.ts";

const NOW = "2026-10-06T12:00:00.000Z";
const nowMs = Date.parse(NOW);
const ago = (minutes: number) => new Date(nowMs - minutes * 60_000).toISOString();

function provider(id: ProviderId, patch: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    provider: id,
    label: id,
    state: "available",
    reason: "ready",
    installed: true,
    authenticated: true,
    available: true,
    enabled: true,
    failoverAllowed: false,
    capabilities: [],
    checkedAt: ago(2),
    secretStored: false,
    ...patch
  };
}

function snapshot(): LocalControlMonitorSnapshot {
  return {
    available: true,
    state: { daemonPid: 1, status: "idle", currentJobId: null, lastCompletedJobId: null, heartbeatAt: new Date(nowMs - 1000).toISOString(), controlRoot: "~" },
    feed: [],
    activeLanes: [],
    queuedJobs: [],
    recentJobs: [],
    stats: { total: 0, completed: 0, failed: 0, timeout: 0, avgDurationMs: 0 },
    orchestration: { fallbackJobs: [] }
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

const statuses = [
  provider("codex", { model: "gpt-5" }),
  provider("claude", { authKind: "subscription" }),
  provider("api", { model: "gpt-5.6-sol", endpointScope: "remote", secretStored: true }),
  provider("local", { model: "kato-local-brain", endpointScope: "local" }),
  provider("local_control")
];

function input(patch: Partial<AgentJobModelInput> = {}): AgentJobModelInput {
  return {
    actionPlans: [],
    codexRun: { status: "idle" },
    codexEvents: [],
    currentQueueTaskId: null,
    queueRunning: false,
    localControl: snapshot(),
    providerStatuses: statuses,
    providerTransitions: [],
    providerPriority: normalizeProviderPriority(undefined),
    device: "studio",
    now: NOW,
    ...patch
  };
}

test("API lane is an additional intelligent lane next to subscriptions, Local Brain and Local Control", () => {
  const state = normalizeAgentSyncState(input());
  assert.deepEqual(state.lanes.map((lane) => lane.id), AGENT_LANE_ORDER);
  for (const id of ["codex", "claude", "api", "local"] as const) {
    assert.equal(state.lanes.find((lane) => lane.id === id)?.connectivity, "connected", id);
  }
  assert.equal(state.lanes.find((lane) => lane.id === "local_control")?.intelligent, false);
  assert.equal(isIntelligentLane("api"), true);
  // Kein Job laeuft -> keine Lane besitzt Arbeit; API reserviert nichts vorab.
  assert.equal(state.currentJob, null);
  assert.ok(state.lanes.every((lane) => lane.activity !== "running"));
});

test("an unconfigured API lane never hides or blocks Local Brain or subscription lanes", () => {
  const withoutApi = statuses.map((status) =>
    status.provider === "api"
      ? { ...status, state: "unknown" as const, reason: "not_configured" as const, authenticated: false, available: false, secretStored: false }
      : status
  );
  const state = normalizeAgentSyncState(input({ providerStatuses: withoutApi }));
  assert.equal(state.lanes.find((lane) => lane.id === "api")?.connectivity, "not_configured");
  assert.equal(state.lanes.find((lane) => lane.id === "local")?.connectivity, "connected");
  assert.equal(state.lanes.find((lane) => lane.id === "codex")?.connectivity, "connected");
});

test("normal job/test failures never trigger an API provider hop; only capacity signals may hand off", () => {
  const priority = normalizeProviderPriority(undefined);
  const limited = statuses.map((status) =>
    status.provider === "codex" || status.provider === "claude"
      ? { ...status, state: "quota_limited" as const, available: false }
      : status
  );
  assert.equal(nextLaneAfterFailure(limited, priority, "claude", "job_failed", false), null);
  assert.equal(nextLaneAfterFailure(limited, priority, "claude", "quota_limited", false), "api");
});

test("API keys never enter provider warm-up; only subscription CLIs are warmed", () => {
  assert.deepEqual(WARMUP_PROVIDERS, ["codex", "claude"]);
  assert.ok(!WARMUP_PROVIDERS.includes("api"));
});

test("Vision shows the API lane as a cloud node while Local Brain stays the single REX node", () => {
  const agentSync = normalizeAgentSyncState(input());
  const graph = buildVisionGraph({
    nativeRuntime: true,
    config: { device: { deviceId: "ks-11111111-1111-1111-1111-111111111111", deviceName: "Studio Mac" }, libraryId: "" },
    registry: null,
    agentSync,
    providerStatuses: statuses,
    localBrain: brain,
    memory: null,
    now: NOW
  });
  const ids = graph.nodes.map((node) => node.id);
  const api = graph.nodes.find((node) => node.id === "lane:api");
  assert.ok(api, `lane:api missing in ${ids.join(",")}`);
  assert.equal(api?.scope, "cloud");
  assert.equal(api?.label, "API Lane");
  assert.ok(ids.includes(LOCAL_BRAIN_NODE_ID));
  assert.ok(!ids.includes("lane:local"), "Local Brain must not be duplicated as a generic local lane");
  assert.ok(ids.includes("lane:codex") && ids.includes("lane:claude"));
  // Vision exportiert keine Secrets oder Key-Hinweise.
  assert.equal(JSON.stringify(graph).toLowerCase().includes("sk-"), false);
});

test("API setup lives in the Agent Sync Providers step next to Vision, not in Mistral Mode", () => {
  assert.equal(modeForStep("agentProviders"), "agentSync");
  assert.equal(modeForStep("agentVision"), "agentSync");
  assert.ok(AGENT_SYNC_STEPS.indexOf("agentVision") < AGENT_SYNC_STEPS.indexOf("agentProviders"));
});
