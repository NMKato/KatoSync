// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import {
  REMOTE_HEARTBEAT_FRESH_MS,
  SCHEDULER_STALE_MS,
  agentWorkWaiting,
  monitorProjection,
  normalizeAgentSyncState,
  overviewProjection,
  queueProjection,
  type AgentJobModelInput
} from "../src/lib/agentJobModel.ts";
import type {
  ActionPlan,
  FallbackJobSnapshot,
  LocalControlMonitorSnapshot,
  OrchestrationSnapshot,
  ProviderId,
  ProviderStatus,
  RemoteOrchestratorSnapshot
} from "../src/types.ts";

const NOW = "2026-10-04T12:20:00.000Z";
const nowMs = Date.parse(NOW);
const ago = (minutes: number) => new Date(nowMs - minutes * 60_000).toISOString();
const ahead = (minutes: number) => new Date(nowMs + minutes * 60_000).toISOString();

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

const limited = [
  provider("codex", { state: "quota_limited", available: false, retryHint: "resets in 2h" }),
  provider("claude", { state: "quota_limited", available: false }),
  provider("local", { installed: false, available: false, state: "installed" }),
  provider("local_control")
];

function fallback(patch: Partial<FallbackJobSnapshot> = {}): FallbackJobSnapshot {
  return {
    id: "1791-katosync-27",
    name: "katosync-27",
    branch: "feat/cockpit",
    worktree: "KatoSync-cockpit",
    status: "waiting",
    reason: "codex_usage_limit_handoff_to_next_intelligent_lane",
    createdAt: ago(10),
    updatedAt: ago(9),
    timeoutSeconds: 14400,
    providerStates: [{ provider: "codex", state: "quota_limited", retryAt: ahead(90) }],
    evidence: [],
    branchMatches: true,
    worktreeBusy: false,
    ...patch
  };
}

function lease(patch: Partial<RemoteOrchestratorSnapshot> = {}): RemoteOrchestratorSnapshot {
  return {
    sessionId: "rdc-1",
    state: "attached",
    transport: "rdc",
    attachedAt: ago(30),
    heartbeatAt: ago(1),
    leaseSeconds: 600,
    leaseExpiresAt: ahead(9),
    device: "studio",
    model: "remote-assistant",
    ...patch
  };
}

function snapshot(orchestration: Partial<OrchestrationSnapshot> = {}, patch: Partial<LocalControlMonitorSnapshot> = {}): LocalControlMonitorSnapshot {
  return {
    available: true,
    state: { daemonPid: 1, status: "idle", currentJobId: null, lastCompletedJobId: null, heartbeatAt: new Date(nowMs - 1000).toISOString(), controlRoot: "~" },
    feed: [],
    activeLanes: [],
    queuedJobs: [],
    recentJobs: [],
    stats: { total: 0, completed: 0, failed: 0, timeout: 0, avgDurationMs: 0 },
    orchestration: { fallbackJobs: [], ...orchestration },
    ...patch
  };
}

function input(patch: Partial<AgentJobModelInput> = {}): AgentJobModelInput {
  return {
    actionPlans: [],
    codexRun: { status: "idle" },
    codexEvents: [],
    currentQueueTaskId: null,
    queueRunning: false,
    localControl: snapshot(),
    providerStatuses: limited,
    providerTransitions: [],
    providerPriority: ["codex", "claude", "local", "local_control"],
    device: "studio",
    now: NOW,
    ...patch
  };
}

function plan(tasks: ActionPlan["tasks"], status: ActionPlan["status"] = "approved"): ActionPlan {
  return {
    planId: "plan-1",
    source: "mistral",
    agentName: "Agent",
    createdAt: ago(30),
    status,
    executionMode: "sequential",
    dailyLimit: 5,
    riskLevel: "low",
    requiresUserReview: true,
    tasks
  };
}

test("truthful idle: no running source means no current job, but lanes stay separate", () => {
  const state = normalizeAgentSyncState(input());
  assert.equal(state.currentJob, null);
  assert.deepEqual(state.lanes.map((lane) => lane.id), ["codex", "claude", "local", "remote_orchestrator", "local_control"]);
  assert.deepEqual(state.lanes.map((lane) => lane.intelligent), [true, true, true, true, false]);
  const codex = state.lanes.find((lane) => lane.id === "codex");
  // Verbunden/limitiert ist Konnektivitaet, kein Job-Besitz.
  assert.equal(codex?.connectivity, "limited");
  assert.equal(codex?.activity, "waiting");
  assert.equal(codex?.retryAt, new Date(Date.parse(limited[0].checkedAt) + 2 * 3_600_000).toISOString());
  assert.equal(state.lanes.find((lane) => lane.id === "local")?.connectivity, "not_configured");
  assert.equal(state.lanes.find((lane) => lane.id === "local_control")?.connectivity, "connected");
});

test("router fallback job keeps the failover reason, retry time and handoff chain", () => {
  const state = normalizeAgentSyncState(input({ localControl: snapshot({ fallbackJobs: [fallback()] }) }));
  const job = state.jobs.find((entry) => entry.source === "provider_router");
  assert.ok(job);
  assert.equal(job.status, "waiting");
  assert.equal(job.owner, null);
  assert.equal(job.retryAt, ahead(90));
  assert.deepEqual(job.handoffs.map((handoff) => [handoff.from, handoff.to, handoff.reason]), [["codex", "local_control", "quota_limited"]]);
  // Kein Modell und kein Orchestrator frei: ehrlich auf den gemeldeten Reset warten.
  assert.equal(job.resume?.reason, "provider_reset_pending");
  assert.equal(job.nextStep, "await_provider_reset");
  assert.equal(state.nextJob?.id, job.id);
  assert.equal(agentWorkWaiting(state), true);

  const completed = normalizeAgentSyncState(input({
    localControl: snapshot({
      fallbackJobs: [fallback({
        status: "completed",
        completedAt: ago(1),
        providerStates: [{ provider: "codex", state: "quota_limited", exitCode: 1 }, { provider: "claude", state: "completed" }]
      })]
    })
  })).jobs[0];
  assert.equal(completed.status, "completed");
  assert.equal(completed.owner, "claude");
  assert.deepEqual(completed.handoffs.map((handoff) => [handoff.from, handoff.to]), [["codex", "claude"]]);
});

test("remote orchestrator + RDC is an intelligent fallback lane distinct from Local Control", () => {
  const attached = normalizeAgentSyncState(input({ localControl: snapshot({ fallbackJobs: [fallback()], remoteOrchestrator: lease() }) }));
  assert.equal(attached.remote.orchestrator, "attached");
  assert.equal(attached.remote.transport, "online");
  assert.equal(attached.remote.eligible, true);
  const remoteLane = attached.lanes.find((lane) => lane.id === "remote_orchestrator");
  assert.equal(remoteLane?.kind, "orchestrator");
  assert.equal(remoteLane?.eligible, true);
  const waiting = attached.jobs.find((job) => job.source === "provider_router");
  assert.equal(waiting?.resume?.safe, true);
  assert.equal(waiting?.nextStep, "await_intelligent_lane");

  const working = normalizeAgentSyncState(input({
    localControl: snapshot({ fallbackJobs: [fallback()], remoteOrchestrator: lease({ state: "working", jobId: "katosync-27", activity: "running tests" }) })
  }));
  assert.equal(working.currentJob?.owner, "remote_orchestrator");
  assert.equal(working.currentJob?.status, "running");
  assert.equal(working.currentJob?.model, "remote-assistant");
  assert.equal(working.currentJob?.device, "studio");
  // Laufzeit ab Claim/Anbindung, nicht ab dem letzten Heartbeat.
  assert.equal(working.currentJob?.startedAt, ago(30));
  assert.equal(working.startSafety.reason, "orchestrator_lease");
  assert.ok(working.events.some((event) => event.kind === "heartbeat" && event.message === "running tests"));

  const stale = normalizeAgentSyncState(input({
    localControl: snapshot({ remoteOrchestrator: lease({ heartbeatAt: new Date(nowMs - REMOTE_HEARTBEAT_FRESH_MS - 1000).toISOString() }) })
  }));
  assert.equal(stale.remote.orchestrator, "stale");
  assert.equal(stale.remote.leaseActive, true, "an unexpired lease still blocks other writers");
  assert.equal(stale.remote.eligible, false);

  const expired = normalizeAgentSyncState(input({
    localControl: snapshot({
      fallbackJobs: [fallback({ status: "orchestrator_active" })],
      remoteOrchestrator: lease({ heartbeatAt: ago(20), leaseExpiresAt: ago(10), jobId: "katosync-27" })
    })
  }));
  assert.equal(expired.remote.leaseActive, false);
  const blocked = expired.jobs.find((job) => job.source === "provider_router");
  assert.equal(blocked?.status, "blocked");
  assert.equal(blocked?.nextStep, "release_stale_lease");

  const none = normalizeAgentSyncState(input());
  assert.equal(none.remote.orchestrator, "unavailable");
  assert.equal(none.remote.transport, "unknown");
});

test("scheduler resume in flight owns the job and blocks a second start", () => {
  const state = normalizeAgentSyncState(input({
    providerStatuses: [provider("codex", { state: "quota_limited", available: false }), provider("claude")],
    localControl: snapshot({
      fallbackJobs: [fallback()],
      providerHealth: {
        checkedAt: ago(9),
        providers: [],
        waitingFallbackJobs: 1,
        controlIdle: true,
        resumeInFlight: { name: "katosync-27", startedAt: ago(1) }
      }
    })
  }));
  assert.equal(state.currentJob?.source, "provider_router");
  assert.equal(state.currentJob?.phase, "scheduler_resume");
  assert.equal(state.scheduler.providerHealth.state, "resuming");
  assert.equal(state.startSafety.safe, false);
  assert.equal(state.startSafety.reason, "handoff_in_flight");
});

test("waiting work resumes only when branch, worktree and writer safety are proven", () => {
  const available = [provider("codex", { state: "quota_limited", available: false }), provider("claude")];
  const resume = (item: Partial<FallbackJobSnapshot>, extra: Partial<AgentJobModelInput> = {}) =>
    normalizeAgentSyncState(input({ providerStatuses: available, localControl: snapshot({ fallbackJobs: [fallback(item)] }), ...extra }))
      .jobs.find((job) => job.source === "provider_router")?.resume?.reason;
  assert.equal(resume({}), "safe");
  assert.equal(resume({ branchMatches: null }), "branch_unproven");
  assert.equal(resume({ branchMatches: false }), "branch_unproven");
  assert.equal(resume({ worktreeBusy: true }), "worktree_busy");
  assert.equal(
    resume({}, { codexRun: { status: "running", startedAt: ago(1), context: { jobId: "x", projectId: "p", task: "t", source: "briefing" } }, preferredRunner: "codex_cli" }),
    "writer_active"
  );
});

test("health scheduler is armed only with a fresh 10-minute check", () => {
  const armed = normalizeAgentSyncState(input({ localControl: snapshot({ providerHealth: { checkedAt: ago(9), providers: [], waitingFallbackJobs: 0, controlIdle: true } }) }));
  assert.equal(armed.scheduler.providerHealth.state, "armed");
  assert.equal(armed.scheduler.providerHealth.nextCheckAt, ahead(1));
  const stale = normalizeAgentSyncState(input({
    localControl: snapshot({ providerHealth: { checkedAt: new Date(nowMs - SCHEDULER_STALE_MS - 1000).toISOString(), providers: [], waitingFallbackJobs: 0, controlIdle: true } })
  }));
  assert.equal(stale.scheduler.providerHealth.state, "stale");
  assert.equal(normalizeAgentSyncState(input()).scheduler.providerHealth.state, "unknown");

  const continuation = (status: string, enabled = true) =>
    normalizeAgentSyncState(input({ localControl: snapshot({ continuation: { planId: "p", enabled, status, cursor: 1, waveCount: 3, activeWaveName: "w2" } }) }))
      .scheduler.continuation.state;
  assert.equal(continuation("running"), "armed");
  assert.equal(continuation("running", false), "idle");
  assert.equal(continuation("failed"), "stopped");
  assert.equal(continuation("daemon_unavailable"), "waiting_daemon");
});

test("Local Control jobs are deterministic substrate work, labelled by continuation wave when known", () => {
  const state = normalizeAgentSyncState(input({
    localControl: snapshot(
      { continuation: { planId: "p", enabled: true, status: "running", cursor: 1, waveCount: 3, activeJobId: "job-7", activeWaveName: "genx-136-maplibre" } },
      {
        activeLanes: [{ laneId: "genx", projectId: "genxline", jobId: "job-7", cwd: "~", command: "python3", mode: "workspace_write", resourceLocks: ["agent-coding"], startedAt: ago(3) }],
        feed: [`${ago(1)} START lane=genx job=job-7 mode=workspace_write cwd=/Users/someone/x cmd=python3`]
      }
    )
  }));
  assert.equal(state.currentJob?.owner, "local_control");
  assert.equal(state.currentJob?.source, "continuation");
  assert.equal(state.currentJob?.task, "genx-136-maplibre");
  assert.equal(state.lanes.find((lane) => lane.id === "local_control")?.intelligent, false);
  assert.equal(state.startSafety.reason, "worktree_lease_active");
  assert.ok(state.events.every((event) => !(event.message ?? "").includes("/Users/")));
});

test("one job id never has two running owners", () => {
  const tasks: ActionPlan["tasks"] = [{
    taskId: "task-1", priority: 1, projectId: "katosync", title: "Cockpit", taskType: "code_task",
    targetRunner: "codex_cli", riskLevel: "low", requiresApproval: true, status: "running"
  }];
  const state = normalizeAgentSyncState(input({
    actionPlans: [plan(tasks, "running")],
    currentQueueTaskId: "task-1",
    localControl: snapshot({ remoteOrchestrator: lease({ state: "working", jobId: "task-1" }) })
  }));
  const rows = state.jobs.filter((job) => job.externalId === "task-1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "blocked");
  assert.equal(rows[0].reason, "duplicate_owner");
});

test("Overview, Jobs & Queue and Live Monitor project the same job truth", () => {
  const tasks: ActionPlan["tasks"] = [
    { taskId: "task-1", priority: 1, projectId: "katosync", title: "Cockpit", taskType: "code_task", targetRunner: "codex_cli", riskLevel: "low", requiresApproval: true, status: "running" },
    { taskId: "task-2", priority: 2, projectId: "katosync", title: "Widget", taskType: "code_task", targetRunner: "codex_cli", riskLevel: "low", requiresApproval: true, status: "pending" }
  ];
  const state = normalizeAgentSyncState(input({
    actionPlans: [plan(tasks, "running")],
    currentQueueTaskId: "task-1",
    codexRun: { status: "running", startedAt: ago(4), lastActivityAt: ago(1) },
    codexEvents: [{ taskId: "task-1", seq: 1, label: "build", text: "npm run build", at: ago(1) }],
    preferredRunner: "claude_cli",
    providerStatuses: [provider("codex"), provider("claude")],
    claudeModel: "opus"
  }));
  const overview = overviewProjection(state);
  const queue = queueProjection(state);
  const monitor = monitorProjection(state);
  assert.equal(overview.job?.id, "task-1");
  assert.equal(queue.rows[0].id, overview.job?.id);
  assert.equal(monitor.job?.id, overview.job?.id);
  // Besitzer ist der tatsaechlich ausfuehrende Runner, nicht der geplante.
  assert.equal(overview.job?.owner, "claude");
  assert.equal(overview.owner?.id, "claude");
  assert.equal(monitor.lane?.id, "claude");
  assert.equal(overview.job?.model, "opus");
  assert.equal(queue.rows[0].status, monitor.job?.status);
  assert.equal(overview.next?.id, "task-2");
  assert.ok(monitor.events.some((event) => event.message === "build: npm run build"));
  // Der Monitor zeigt keine Events fremder Jobs.
  assert.ok(monitor.events.every((event) => !event.jobId || event.jobId === "task-1"));
  assert.equal(state.counts.running, 1);
  assert.equal(state.counts.queued, 1);
  assert.equal(overview.startSafety.reason, "runner_busy");
});
