// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import {
  addAutoLaneClaim,
  pickAutoLaneRunner,
  planAutoLanes,
  pruneAutoLaneClaims,
  releaseAutoLaneClaim,
  type AutoLanePlannerInput
} from "../src/lib/autoLanePlanner.ts";
import { normalizeAgentSyncState, type AgentJobModelInput } from "../src/lib/agentJobModel.ts";
import type { ActionPlan, ActionTask, AgentLane, AutoLaneClaim, ProviderStatus } from "../src/types.ts";

const NOW = "2026-10-04T12:00:00.000Z";

function task(taskId: string, projectId: string, patch: Partial<ActionTask> = {}): ActionTask {
  return {
    taskId,
    priority: 1,
    projectId,
    title: `Task ${taskId}`,
    taskType: "code_task",
    targetRunner: "codex_cli",
    riskLevel: "medium",
    requiresApproval: true,
    status: "pending",
    ...patch
  };
}

function plan(planId: string, tasks: ActionTask[], patch: Partial<ActionPlan> = {}): ActionPlan {
  return {
    planId,
    source: "mistral",
    agentName: "planner",
    createdAt: "2026-10-04T08:00:00.000Z",
    status: "approved",
    executionMode: "sequential",
    dailyLimit: 5,
    riskLevel: "medium",
    requiresUserReview: true,
    tasks,
    ...patch
  };
}

function lane(id: AgentLane["id"], eligible: boolean, patch: Partial<AgentLane> = {}): AgentLane {
  return {
    id,
    kind: id === "local_control" ? "substrate" : id === "remote_orchestrator" ? "orchestrator" : "model_provider",
    intelligent: id !== "local_control",
    rank: 0,
    connectivity: eligible ? "connected" : "limited",
    activity: "idle",
    eligible,
    ...patch
  };
}

const READY_LANES = [lane("codex", true), lane("claude", true), lane("local", false), lane("remote_orchestrator", false), lane("local_control", true)];

function input(patch: Partial<AutoLanePlannerInput> = {}): AutoLanePlannerInput {
  return {
    enabled: true,
    actionPlans: [
      plan("p1", [task("a1", "alpha"), task("a2", "alpha")]),
      plan("p2", [task("b1", "beta")])
    ],
    selectedOrder: ["a1", "a2", "b1"],
    repos: { alpha: "repo-alpha", beta: "repo-beta" },
    claims: [],
    inFlightTaskIds: [],
    startSafety: { safe: true, reason: "safe" },
    lanes: READY_LANES,
    preferredRunner: "codex_cli",
    providerPriority: ["codex", "claude", "local", "local_control"],
    dailyCount: 0,
    dailyLimit: 5,
    maxConcurrent: 1,
    ...patch
  };
}

const laneOf = (result: ReturnType<typeof planAutoLanes>, projectId: string) =>
  result.lanes.find((entry) => entry.projectId === projectId);

test("candidate selection: only selected + approved runnable tasks, never auto-approve", () => {
  const result = planAutoLanes(input({
    actionPlans: [
      plan("p1", [task("a1", "alpha"), task("x1", "alpha", { targetRunner: "manual_review" })]),
      plan("p2", [task("b1", "beta")], { status: "pending_user_review" }),
      plan("p3", [task("c1", "gamma")])
    ],
    selectedOrder: ["a1", "x1", "b1"],
    repos: { alpha: "repo-alpha", beta: "repo-beta", gamma: "repo-gamma" }
  }));
  // c1 ist nicht ausgewaehlt, x1 kein lokaler Runner -> keine Lane / kein Lane-Mitglied.
  assert.equal(laneOf(result, "gamma"), undefined);
  assert.deepEqual(laneOf(result, "alpha")?.taskIds, ["a1"]);
  // Ausgewaehlt, aber Plan nicht freigegeben -> sichtbar gesperrt, nie gestartet.
  assert.equal(laneOf(result, "beta")?.state, "blocked");
  assert.equal(laneOf(result, "beta")?.reason, "approval_required");
  assert.equal(laneOf(result, "beta")?.nextStep, "approve_plan");
  assert.deepEqual(result.dispatch.map((entry) => entry.taskId), ["a1"]);
});

test("critical, deferred, completed and rejected tasks are never dispatched", () => {
  const critical = planAutoLanes(input({
    actionPlans: [plan("p1", [task("a1", "alpha", { riskLevel: "critical" }), task("a2", "alpha")])],
    selectedOrder: ["a1", "a2"]
  }));
  assert.equal(laneOf(critical, "alpha")?.state, "blocked");
  assert.equal(laneOf(critical, "alpha")?.reason, "manual_gate");
  // Die kritische Aufgabe sperrt die Projektreihenfolge: a2 springt nicht vor.
  assert.equal(critical.dispatch.length, 0);

  const skipped = planAutoLanes(input({
    actionPlans: [plan("p1", [
      task("a0", "alpha", { status: "completed" }),
      task("a1", "alpha", { status: "deferred" }),
      task("a2", "alpha", { status: "rejected" }),
      task("a3", "alpha")
    ])],
    selectedOrder: ["a0", "a1", "a2", "a3"]
  }));
  assert.deepEqual(skipped.dispatch.map((entry) => entry.taskId), ["a3"]);
});

test("per-project ordering: earlier task blocks later tasks until terminal/merge state", () => {
  const first = planAutoLanes(input());
  assert.deepEqual(laneOf(first, "alpha")?.taskIds, ["a1", "a2"]);
  assert.equal(laneOf(first, "alpha")?.headTaskId, "a1");
  assert.ok(!first.dispatch.some((entry) => entry.taskId === "a2"));

  // Reihenfolge folgt der Board-Auswahl, nicht der Plan-Reihenfolge.
  const reordered = planAutoLanes(input({ selectedOrder: ["a2", "a1", "b1"] }));
  assert.equal(laneOf(reordered, "alpha")?.headTaskId, "a2");

  const mergePending = planAutoLanes(input({
    actionPlans: [plan("p1", [task("a1", "alpha", { status: "executed" }), task("a2", "alpha")])],
    selectedOrder: ["a1", "a2"]
  }));
  assert.equal(laneOf(mergePending, "alpha")?.state, "waiting");
  assert.equal(laneOf(mergePending, "alpha")?.reason, "merge_pending");
  assert.equal(laneOf(mergePending, "alpha")?.nextStep, "review_merge");
  assert.equal(mergePending.dispatch.length, 0);

  const merged = planAutoLanes(input({
    actionPlans: [plan("p1", [task("a1", "alpha", { status: "completed" }), task("a2", "alpha")])],
    selectedOrder: ["a1", "a2"]
  }));
  assert.deepEqual(merged.dispatch.map((entry) => entry.taskId), ["a2"]);
});

test("independent projects are parallel-eligible, one writer per repo", () => {
  const parallel = planAutoLanes(input({ maxConcurrent: 2 }));
  assert.deepEqual(parallel.dispatch.map((entry) => entry.taskId).sort(), ["a1", "b1"]);

  const sameRepo = planAutoLanes(input({ maxConcurrent: 2, repos: { alpha: "repo-shared", beta: "repo-shared" } }));
  assert.deepEqual(sameRepo.dispatch.map((entry) => entry.taskId), ["a1"]);
  assert.equal(laneOf(sameRepo, "beta")?.state, "queued");
  assert.equal(laneOf(sameRepo, "beta")?.reason, "repo_busy");

  // Heute ein Runner-Slot: das zweite Projekt bleibt sichtbar eingereiht statt "idle".
  const single = planAutoLanes(input());
  assert.equal(single.dispatch.length, 1);
  assert.equal(laneOf(single, "beta")?.state, "queued");
  assert.equal(laneOf(single, "beta")?.reason, "runner_slot");

  // Round-Robin: das zuletzt gestartete Projekt kommt nach dem anderen dran.
  const fair = planAutoLanes(input({ lastDispatchAt: { alpha: "2026-10-04T11:59:00.000Z" } }));
  assert.deepEqual(fair.dispatch.map((entry) => entry.projectId), ["beta"]);
});

test("duplicate prevention: claims and in-flight runs are never dispatched again", () => {
  const claim: AutoLaneClaim = { taskId: "a1", projectId: "alpha", repoKey: "repo-alpha", runner: "codex_cli", claimedAt: NOW };
  const running = planAutoLanes(input({ claims: [claim], inFlightTaskIds: ["a1"], startSafety: { safe: false, reason: "runner_busy" } }));
  assert.equal(laneOf(running, "alpha")?.state, "running");
  assert.equal(laneOf(running, "beta")?.state, "queued");
  assert.equal(running.dispatch.length, 0);

  // Nach einem Neustart: Claim ohne laufenden Besitzer -> gesperrt, nie still neu gestartet.
  const restarted = planAutoLanes(input({ claims: [claim] }));
  assert.equal(laneOf(restarted, "alpha")?.state, "blocked");
  assert.equal(laneOf(restarted, "alpha")?.reason, "interrupted_run");
  assert.deepEqual(restarted.dispatch.map((entry) => entry.taskId), ["b1"]);

  // Server meldet "running", diese Sitzung fuehrt den Task aber nicht aus -> ebenfalls gesperrt.
  const orphan = planAutoLanes(input({
    actionPlans: [plan("p1", [task("a1", "alpha", { status: "running" })])],
    selectedOrder: ["a1"]
  }));
  assert.equal(laneOf(orphan, "alpha")?.reason, "interrupted_run");
  assert.equal(orphan.dispatch.length, 0);

  // Wiederholte Ticks/Rerender liefern dieselbe Entscheidung.
  assert.deepEqual(planAutoLanes(input()).dispatch, planAutoLanes(input()).dispatch);

  // Claim-Ledger ist idempotent und gibt nur erledigte Tasks frei.
  const twice = addAutoLaneClaim(addAutoLaneClaim([], claim), { ...claim, claimedAt: "later" });
  assert.equal(twice.length, 1);
  assert.deepEqual(releaseAutoLaneClaim(twice, "a1"), []);
  const plans = [plan("p1", [task("a1", "alpha", { status: "running" }), task("a2", "alpha", { status: "executed" })])];
  const ledger = [claim, { ...claim, taskId: "a2" }, { ...claim, taskId: "gone" }];
  assert.deepEqual(pruneAutoLaneClaims(ledger, plans).map((entry) => entry.taskId), ["a1"]);
  // Ohne geladene Plans wird nichts verworfen (kein Freigeben auf Verdacht).
  assert.equal(pruneAutoLaneClaims(ledger, []).length, 3);
});

test("a failed or blocked project does not freeze an independent project", () => {
  const result = planAutoLanes(input({
    actionPlans: [
      plan("p1", [task("a1", "alpha", { status: "failed" }), task("a2", "alpha")]),
      plan("p2", [task("b1", "beta")]),
      plan("p3", [task("c1", "gamma")])
    ],
    selectedOrder: ["a1", "a2", "b1", "c1"],
    repos: { alpha: "repo-alpha", beta: "repo-beta" }
  }));
  assert.equal(laneOf(result, "alpha")?.state, "blocked");
  assert.equal(laneOf(result, "alpha")?.reason, "head_failed");
  assert.equal(laneOf(result, "gamma")?.reason, "repo_unmapped");
  assert.deepEqual(result.dispatch.map((entry) => entry.taskId), ["b1"]);

  const missing = planAutoLanes(input({ missingRepos: ["alpha"] }));
  assert.equal(laneOf(missing, "alpha")?.reason, "repo_missing");
  assert.deepEqual(missing.dispatch.map((entry) => entry.taskId), ["b1"]);
});

test("auto mode off keeps work visible as planned without dispatch", () => {
  const result = planAutoLanes(input({ enabled: false }));
  assert.equal(result.enabled, false);
  assert.equal(result.dispatch.length, 0);
  assert.deepEqual(result.lanes.map((entry) => entry.state), ["planned", "planned"]);
  assert.equal(result.counts.planned, 2);
  assert.equal(result.lanes[0].nextStep, "enable_auto_mode");
  assert.equal(result.merge.mode, "manual");
});

test("global gates: start safety, provider availability, failover and daily limit", () => {
  const lease = planAutoLanes(input({ startSafety: { safe: false, reason: "orchestrator_lease" } }));
  assert.equal(lease.dispatch.length, 0);
  assert.equal(laneOf(lease, "alpha")?.state, "waiting");
  assert.equal(laneOf(lease, "alpha")?.detail, "orchestrator_lease");

  const writer = planAutoLanes(input({ startSafety: { safe: false, reason: "worktree_lease_active" } }));
  assert.equal(writer.dispatch.length, 0);

  const retryAt = "2026-10-04T14:00:00.000Z";
  const noLane = planAutoLanes(input({
    lanes: [lane("codex", false, { retryAt }), lane("claude", false), lane("local_control", true)]
  }));
  assert.equal(noLane.dispatch.length, 0);
  assert.equal(laneOf(noLane, "alpha")?.reason, "no_runner_lane");
  assert.equal(laneOf(noLane, "alpha")?.retryAt, retryAt);

  // Codex quota-limitiert -> bestehender Failover-Vertrag: Claude Code uebernimmt.
  assert.equal(pickAutoLaneRunner([lane("codex", false), lane("claude", true)], "codex_cli"), "claude_cli");
  assert.equal(pickAutoLaneRunner([lane("codex", true), lane("claude", true)], "claude_cli"), "claude_cli");
  // Claude nicht in der Nutzerprioritaet -> kein Failover dorthin.
  assert.equal(pickAutoLaneRunner([lane("codex", false), lane("claude", true)], "codex_cli", ["codex", "local_control"]), null);
  const failover = planAutoLanes(input({ lanes: [lane("codex", false), lane("claude", true)] }));
  assert.equal(failover.dispatch[0]?.runner, "claude_cli");

  const limit = planAutoLanes(input({ dailyCount: 5, dailyLimit: 5 }));
  assert.equal(limit.dispatch.length, 0);
  assert.equal(laneOf(limit, "alpha")?.reason, "daily_limit");
  assert.equal(laneOf(limit, "alpha")?.nextStep, "await_daily_reset");
});

// ===== Kanonisches Modell: Auto-Lanes in AgentSyncState =====
function provider(id: ProviderStatus["provider"]): ProviderStatus {
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
    checkedAt: NOW,
    secretStored: false
  };
}

function model(patch: Partial<AgentJobModelInput> = {}): AgentJobModelInput {
  return {
    actionPlans: [plan("p1", [task("a1", "alpha"), task("a2", "alpha")]), plan("p2", [task("b1", "beta")])],
    codexRun: { status: "idle" },
    codexEvents: [],
    currentQueueTaskId: null,
    queueRunning: false,
    localControl: null,
    providerStatuses: [provider("codex"), provider("claude")],
    providerTransitions: [],
    providerPriority: ["codex", "claude", "local", "local_control"],
    preferredRunner: "codex_cli",
    autoLane: {
      enabled: true,
      selectedOrder: ["a1", "a2", "b1"],
      repos: { alpha: "repo-alpha", beta: "repo-beta" },
      claims: [],
      inFlightTaskIds: [],
      dailyCount: 0,
      dailyLimit: 5
    },
    now: NOW,
    ...patch
  };
}

test("canonical state exposes planned work instead of looking idle", () => {
  const state = normalizeAgentSyncState(model());
  assert.equal(state.currentJob, null);
  assert.equal(state.autoLanes.enabled, true);
  assert.equal(state.autoLanes.counts.queued, 2);
  assert.equal(state.autoLanes.dispatch.length, 1);
  const head = state.jobs.find((job) => job.id === state.autoLanes.dispatch[0].taskId);
  assert.equal(head?.laneId, `auto:${state.autoLanes.dispatch[0].projectId}`);
  assert.equal(state.jobs.find((job) => job.id === "a2")?.reason, "lane_follow_up");

  // Ohne Auto-Eingaben bleibt das bestehende Modell unveraendert.
  const legacy = normalizeAgentSyncState(model({ autoLane: null }));
  assert.equal(legacy.autoLanes.lanes.length, 0);
  assert.equal(legacy.startSafety.safe, true);
});

test("claimed auto run is running immediately and blocks further starts", () => {
  const base = model();
  const state = normalizeAgentSyncState(model({
    autoLane: {
      ...base.autoLane!,
      claims: [{ taskId: "a1", projectId: "alpha", repoKey: "repo-alpha", runner: "claude_cli", claimedAt: NOW }],
      inFlightTaskIds: ["a1"]
    },
    codexRun: {
      status: "running",
      startedAt: NOW,
      context: { jobId: "a1", projectId: "alpha", task: "Task a1", source: "action_plan", runner: "claude_cli" }
    }
  }));
  assert.equal(state.currentJob?.id, "a1");
  assert.equal(state.currentJob?.owner, "claude");
  assert.deepEqual(state.startSafety, { safe: false, reason: "runner_busy" });
  assert.equal(state.autoLanes.dispatch.length, 0);
  assert.equal(state.autoLanes.lanes.find((entry) => entry.projectId === "beta")?.reason, "runner_slot");
});

test("orphaned running task is shown blocked, not as the current job", () => {
  const state = normalizeAgentSyncState(model({
    actionPlans: [plan("p1", [task("a1", "alpha", { status: "running" })])],
    autoLane: { ...model().autoLane!, selectedOrder: ["a1"] }
  }));
  assert.equal(state.currentJob, null);
  const job = state.jobs.find((entry) => entry.id === "a1");
  assert.equal(job?.status, "blocked");
  assert.equal(job?.reason, "auto_interrupted_run");
  assert.equal(job?.nextStep, "inspect_evidence");
});
