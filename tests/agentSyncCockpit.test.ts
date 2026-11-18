// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_CONTROL_STALE_MS,
  agentReadiness,
  jobStage,
  jobStageCounts,
  localControlHealth,
  localControlLaneState,
  localJobBars,
  runnerJobs,
  runnerLaneState,
  trackOwner
} from "../src/lib/agentSyncCockpit.ts";
import type { ActionPlan, ActionTask, LocalControlJobSummary, LocalControlMonitorSnapshot } from "../src/types.ts";

const NOW = Date.parse("2026-10-03T10:00:00.000Z");

function snapshot(patch: Partial<LocalControlMonitorSnapshot> = {}, state: Record<string, unknown> = {}): LocalControlMonitorSnapshot {
  return {
    available: true,
    state: {
      daemonPid: 1,
      status: "idle",
      currentJobId: null,
      lastCompletedJobId: null,
      heartbeatAt: new Date(NOW - 1000).toISOString(),
      controlRoot: "/tmp/control",
      ...state
    },
    feed: [],
    activeLanes: [],
    queuedJobs: [],
    recentJobs: [],
    stats: { total: 0, completed: 0, failed: 0, timeout: 0, avgDurationMs: 0 },
    ...patch
  };
}

function task(id: string, patch: Partial<ActionTask> = {}): ActionTask {
  return {
    taskId: id,
    priority: 1,
    projectId: "katosync",
    title: `Task ${id}`,
    taskType: "code_task",
    targetRunner: "codex_cli",
    riskLevel: "low",
    requiresApproval: true,
    status: "pending",
    ...patch
  };
}

function plan(status: ActionPlan["status"], tasks: ActionTask[]): ActionPlan {
  return {
    planId: `plan-${status}`,
    source: "mistral",
    agentName: "Agent",
    createdAt: "2026-10-03T09:00:00.000Z",
    status,
    executionMode: "sequential",
    dailyLimit: 5,
    riskLevel: "low",
    requiresUserReview: true,
    tasks
  };
}

test("Local Control health is derived from the real snapshot and heartbeat age", () => {
  assert.equal(localControlHealth(null, NOW), "unknown");
  assert.equal(localControlHealth(snapshot({ available: false, state: null }), NOW), "offline");
  assert.equal(localControlHealth(snapshot(), NOW), "idle");
  assert.equal(localControlHealth(snapshot({}, { status: "busy", currentJobId: "job-1" }), NOW), "busy");
  const stale = snapshot({}, { heartbeatAt: new Date(NOW - LOCAL_CONTROL_STALE_MS - 1).toISOString() });
  assert.equal(localControlHealth(stale, NOW), "stale");
  assert.equal(localControlHealth(snapshot({}, { heartbeatAt: "not-a-date" }), NOW), "stale");
});

test("readiness reports what is actually ready, never a generic setup-complete state", () => {
  const firstRun = agentReadiness({
    providers: [
      { provider: "codex", display: "connect", connected: false },
      { provider: "claude", display: "notInstalled", connected: false },
      { provider: "local", display: "notConfigured", connected: false }
    ],
    localControl: "offline",
    runnerActive: false,
    runnerFailed: false
  });
  assert.deepEqual(firstRun.connected, []);
  assert.equal(firstRun.total, 3);
  assert.equal(firstRun.activeJobs, 0);
  assert.deepEqual(
    firstRun.attention.map((item) => item.kind),
    ["noProvider", "localControl"]
  );

  const working = agentReadiness({
    providers: [
      { provider: "codex", display: "quota", connected: true },
      { provider: "claude", display: "connected", connected: true },
      { provider: "local", display: "reauth", connected: false },
      { provider: "local_control", display: "connected", connected: true }
    ],
    localControl: "busy",
    runnerActive: true,
    runnerFailed: true
  });
  assert.deepEqual(working.connected, ["codex", "claude"], "Quota does not disconnect a valid provider auth");
  assert.equal(working.total, 3, "Local Control is the fallback path, not a model provider");
  assert.equal(working.activeJobs, 2);
  assert.deepEqual(
    working.attention.map((item) => [item.kind, item.tone]),
    [
      ["provider", "warn"],
      ["provider", "danger"],
      ["runnerFailed", "danger"]
    ]
  );
});

test("lane states map runner and daemon state without inventing progress", () => {
  assert.equal(runnerLaneState("running"), "active");
  assert.equal(runnerLaneState("failed"), "failed");
  assert.equal(runnerLaneState("completed"), "idle");
  assert.equal(localControlLaneState("busy"), "active");
  assert.equal(localControlLaneState("stale"), "offline");
  assert.equal(localControlLaneState("unknown"), "unknown");
});

test("runner jobs only include locally executable tasks in their real stage", () => {
  const approved = plan("approved", [
    task("a"),
    task("b", { status: "running" }),
    task("c", { status: "executed" }),
    task("d", { status: "completed" }),
    task("e", { status: "deferred" }),
    task("f", { status: "failed" }),
    task("g", { status: "rejected" }),
    task("h", { targetRunner: "manual_review" })
  ]);
  const review = plan("pending_user_review", [task("i")]);
  const rejected = plan("rejected", [task("j")]);
  const jobs = runnerJobs([approved, review, rejected], "a");
  assert.deepEqual(
    jobs.map((job) => [job.task.taskId, job.stage]),
    [
      ["a", "running"],
      ["b", "running"],
      ["c", "executed"],
      ["d", "completed"],
      ["e", "deferred"],
      ["f", "failed"],
      ["i", "awaitingApproval"]
    ]
  );
  assert.deepEqual(jobStageCounts(jobs), {
    awaitingApproval: 1,
    queued: 0,
    running: 2,
    executed: 1,
    completed: 1,
    deferred: 1,
    failed: 1
  });
  assert.equal(jobStage(task("x"), approved, null), "queued");
  assert.equal(jobStage(task("x"), rejected, null), null);
});

test("lane handoffs are only recorded for observed owner changes after a baseline", () => {
  let track = { owner: null, handoffs: [] } as Parameters<typeof trackOwner>[0];
  track = trackOwner(track, null, "t0");
  assert.equal(track.owner, null);
  track = trackOwner(track, "codex", "t1");
  assert.deepEqual(track, { owner: "codex", handoffs: [] }, "first snapshot is a baseline, not a handoff");
  const same = trackOwner(track, "codex", "t2");
  assert.equal(same, track);
  track = trackOwner(track, "claude", "t3");
  track = trackOwner(track, "local_control", "t4");
  assert.deepEqual(track.handoffs, [
    { from: "codex", to: "claude", at: "t3" },
    { from: "claude", to: "local_control", at: "t4" }
  ]);
  let capped = track;
  for (let index = 0; index < 20; index += 1) {
    capped = trackOwner(capped, index % 2 ? "codex" : "claude", `x${index}`, 5);
  }
  assert.equal(capped.handoffs.length, 5);
});

test("activity bars are chronological with heights relative to the real durations", () => {
  const job = (id: string, finishedAt: string, durationMs: number, status = "completed"): LocalControlJobSummary => ({
    id,
    status,
    exitCode: 0,
    startedAt: finishedAt,
    finishedAt,
    durationMs,
    cwd: "/repo",
    command: "git",
    mode: "read_only",
    logPath: "/tmp/log"
  });
  const bars = localJobBars([
    job("new", "2026-10-03T10:00:03Z", 4000, "failed"),
    job("old", "2026-10-03T10:00:01Z", 1000),
    job("mid", "2026-10-03T10:00:02Z", 0)
  ]);
  assert.deepEqual(bars.map((bar) => bar.id), ["old", "mid", "new"]);
  assert.deepEqual(bars.map((bar) => bar.ratio), [0.25, 0.08, 1]);
  assert.equal(localJobBars([]).length, 0);
});
