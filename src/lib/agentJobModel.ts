// Created by NMKato Solutions
// Kanonischer, providerunabhaengiger Agent-Sync-Zustand. Repository-Adapter liefern strukturierte
// Quellen (Action-Plans, Runner, Local Control, Provider-Router-Queue, Scheduler, Remote
// Orchestrator); das ViewModel komponiert sie hier einmalig fuer Overview, Jobs & Queue und Live
// Monitor. Keine Mock-Daten, keine erfundenen Fortschrittswerte: nur belegter Zustand.
import type {
  ActionPlan,
  ActionRunner,
  AgentHandoff,
  AgentJob,
  AgentJobEvent,
  AgentJobStatus,
  AgentLane,
  AgentLaneConnectivity,
  AgentLaneId,
  AgentNextStep,
  AgentResumeBlock,
  AgentSchedulerRuntime,
  AgentStartSafety,
  AgentSyncState,
  AutoLaneClaim,
  AutoLanePlan,
  CodexEvent,
  CodexRunState,
  FallbackJobSnapshot,
  FocusPolicy,
  LocalControlMonitorSnapshot,
  ProviderId,
  ProviderStatus,
  ProviderTransition,
  RemoteOrchestratorRuntime
} from "../types";
// Explizite .ts-Endungen: die Node-Tests laden diese Datei ohne Bundler.
import { jobStage, localControlHealth } from "./agentSyncCockpit.ts";
import { AGENT_LANE_ORDER, PROVIDER_RECHECK_INTERVAL_MS, providerRetryAt } from "./providerPolicy.ts";
import { AUTO_LANE_MAX_CONCURRENT, AUTO_LANE_PER_RUNNER, emptyAutoLanePlan, planAutoLanes } from "./autoLanePlanner.ts";
import { evaluateFocus, hasFocusProfile } from "./projectFocus.ts";

// Auto-Lane-Eingaben aus dem ViewModel (persistierter Modus, Board-Auswahl, Claims, Repo-Zuordnung).
export interface AgentAutoLaneInput {
  enabled: boolean;
  selectedOrder: string[];
  repos: Record<string, string>;
  missingRepos?: string[];
  claims: AutoLaneClaim[];
  // Vom Auto-Dispatcher gerade ausgefuehrte Tasks (zusaetzlich zu Runner/Board-Queue).
  inFlightTaskIds: string[];
  dailyCount: number;
  dailyLimit: number;
  maxConcurrent?: number;
  lastDispatchAt?: Record<string, string>;
}

export interface AgentJobModelInput {
  actionPlans: ActionPlan[];
  codexRun: CodexRunState;
  codexEvents: CodexEvent[];
  currentQueueTaskId: string | null;
  queueRunning: boolean;
  localControl: LocalControlMonitorSnapshot | null;
  providerStatuses: ProviderStatus[];
  providerTransitions: ProviderTransition[];
  providerPriority: ProviderId[];
  preferredRunner?: string | null;
  codexModel?: string | null;
  claudeModel?: string | null;
  localModel?: string | null;
  device?: string | null;
  autoLane?: AgentAutoLaneInput | null;
  // Fokus-Portfolio (Project Registry). Gesetzt: Auto-Dispatch nur fuer aktive Projekte; Empfehlungen
  // ("naechster Job") nur fuer Fokus-Projekte, sobald die Registry Projekte kennt.
  focus?: FocusPolicy | null;
  now?: string;
}

// Orchestrator gilt als angebunden, solange sein Heartbeat hoechstens fuenf Minuten alt ist.
export const REMOTE_HEARTBEAT_FRESH_MS = 5 * 60 * 1000;
// Provider-Health-Scheduler laeuft im 10-Minuten-Takt; zwei verpasste Takte = veraltet.
export const SCHEDULER_STALE_MS = 2 * PROVIDER_RECHECK_INTERVAL_MS + 60_000;
const DEFAULT_RESUME_TIMEOUT_S = 7200;
const MAX_EVENTS = 200;
const MAX_HANDOFFS = 12;

const FAILOVER_STATES = new Set(["quota_limited", "auth_unavailable", "capacity_unavailable", "offline", "binary_missing"]);
const OPEN_FALLBACK = new Set(["waiting", "provider_ready"]);

function ms(value: string | null | undefined): number {
  return value ? Date.parse(value) : Number.NaN;
}

function last<T>(values: T[]): T | undefined {
  return values[values.length - 1];
}

function latest(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const value of values) {
    if (value && !Number.isNaN(ms(value)) && (best === null || ms(value) > ms(best))) best = value;
  }
  return best;
}

export function runnerLane(runner: ActionRunner | string | null | undefined): AgentLaneId | null {
  if (runner === "codex_cli" || runner === "codex_desktop" || runner === "openai_api") return "codex";
  if (runner === "claude_cli" || runner === "anthropic_api") return "claude";
  if (runner === "local_llm") return "local";
  return null;
}

function laneFromProvider(provider: string | null | undefined): AgentLaneId | null {
  if (provider === "rdc") return "remote_orchestrator";
  return AGENT_LANE_ORDER.find((lane) => lane === provider) ?? null;
}

function laneModel(input: AgentJobModelInput, lane: AgentLaneId | null, remote: RemoteOrchestratorRuntime): string | null {
  if (lane === "remote_orchestrator") return remote.model ?? null;
  const reported = input.providerStatuses.find((entry) => entry.provider === lane)?.model;
  if (reported) return reported;
  if (lane === "codex") return input.codexModel?.trim() || null;
  if (lane === "claude") return input.claudeModel?.trim() || null;
  if (lane === "local") return input.localModel?.trim() || null;
  return null;
}

// ===== Remote Orchestrator + RDC (Lease/Heartbeat-Vertrag) =====
export function remoteOrchestratorRuntime(snapshot: LocalControlMonitorSnapshot | null, nowMs: number): RemoteOrchestratorRuntime {
  const lease = snapshot?.orchestration?.remoteOrchestrator;
  if (!lease) {
    return { transport: "unknown", orchestrator: "unavailable", ownership: "none", leaseActive: false, eligible: false };
  }
  const heartbeat = ms(lease.heartbeatAt);
  const expires = ms(lease.leaseExpiresAt);
  const leaseActive = lease.state !== "detached" && !Number.isNaN(expires) && nowMs < expires;
  const heartbeatAge = nowMs - heartbeat;
  const fresh = leaseActive && heartbeatAge >= -120_000 && heartbeatAge <= REMOTE_HEARTBEAT_FRESH_MS;
  const claimedItem = lease.jobId
    ? snapshot?.orchestration?.fallbackJobs.find((item) => item.id === lease.jobId || item.name === lease.jobId)
    : null;
  const itemExpires = ms(claimedItem?.leaseExpiresAt);
  const verifiedClaim = Boolean(
    lease.state === "working" &&
    lease.jobId &&
    claimedItem?.status === "orchestrator_active" &&
    claimedItem.leaseOwner === lease.sessionId &&
    !Number.isNaN(itemExpires) &&
    nowMs < itemExpires &&
    leaseActive
  );
  const orchestrator: RemoteOrchestratorRuntime["orchestrator"] =
    lease.state === "detached"
      ? "detached"
      : lease.state === "working"
        ? verifiedClaim && fresh ? "working" : "stale"
        : fresh ? "attached" : "stale";
  const ownership: RemoteOrchestratorRuntime["ownership"] = lease.state === "detached"
    ? "none"
    : verifiedClaim && fresh
      ? "katosync_lane"
      : verifiedClaim || !leaseActive
        ? "stale"
        : lease.jobId || lease.state === "working"
          ? "unverified"
          : "external_supervisor";
  const transportAt = lease.transportHeartbeatAt ?? (lease.transport === "rdc" ? lease.heartbeatAt : null);
  const transportAge = nowMs - ms(transportAt);
  const transport: RemoteOrchestratorRuntime["transport"] = lease.state === "detached" || !transportAt
    ? "unknown"
    : transportAge >= -120_000 && transportAge <= lease.leaseSeconds * 1000
      ? "online"
      : "stale";
  return {
    transport,
    transportAt,
    orchestrator,
    ownership,
    attachedAt: lease.attachedAt ?? null,
    heartbeatAt: lease.heartbeatAt,
    leaseExpiresAt: lease.leaseExpiresAt,
    leaseActive,
    // Nur ein durch Queue-Owner und beide Leases bestaetigter Claim besitzt KatoSync-Arbeit.
    jobId: verifiedClaim ? lease.jobId ?? null : null,
    device: lease.device ?? null,
    model: lease.model ?? null,
    activity: lease.activity ?? null,
    // Uebernimmt neue Arbeit nur, wenn angebunden und nicht bereits an einem anderen Job.
    eligible: orchestrator === "attached"
  };
}

// ===== Scheduler / Watchdog (nur mit echter Evidenz "armed") =====
function resumeInFlight(snapshot: LocalControlMonitorSnapshot | null, nowMs: number): { name: string; startedAt: string } | null {
  const resume = snapshot?.orchestration?.providerHealth?.resumeInFlight;
  if (!resume) return null;
  const item = snapshot?.orchestration?.fallbackJobs.find((job) => job.name === resume.name);
  const bound = ((item?.timeoutSeconds ?? DEFAULT_RESUME_TIMEOUT_S) + 60) * 1000;
  // Laenger als Timeout + Puffer ohne RESUME_DONE: der Prozess ist nicht mehr glaubhaft aktiv.
  return nowMs - ms(resume.startedAt) <= bound ? resume : null;
}

export function schedulerRuntime(snapshot: LocalControlMonitorSnapshot | null, nowMs: number): AgentSchedulerRuntime {
  const health = snapshot?.orchestration?.providerHealth;
  const resume = resumeInFlight(snapshot, nowMs);
  const checked = ms(health?.checkedAt);
  const continuation = snapshot?.orchestration?.continuation;
  const continuationState: AgentSchedulerRuntime["continuation"]["state"] = !continuation
    ? "unknown"
    : continuation.status === "failed"
      ? "failed"
      : continuation.status === "daemon_unavailable"
        ? "waiting_daemon"
        : continuation.enabled && continuation.status === "running" && continuation.cursor < continuation.waveCount
          ? "armed"
          : "idle";
  const remote = remoteOrchestratorRuntime(snapshot, nowMs);
  const rawRemote = snapshot?.orchestration?.remoteOrchestrator;
  const supervisorState: AgentSchedulerRuntime["supervisor"]["state"] = !rawRemote
    ? "unknown"
    : rawRemote.state === "detached"
      ? "inactive"
      : rawRemote.jobId || rawRemote.state === "working"
        ? "inactive"
        : remote.ownership === "external_supervisor" && remote.orchestrator === "attached"
          ? "active"
          : "stale";
  return {
    providerHealth: {
      state: !health
        ? "unknown"
        : resume
          ? "resuming"
          : !Number.isNaN(checked) && nowMs - checked <= SCHEDULER_STALE_MS
            ? "armed"
            : "stale",
      checkedAt: health?.checkedAt ?? null,
      nextCheckAt: Number.isNaN(checked) ? null : new Date(checked + PROVIDER_RECHECK_INTERVAL_MS).toISOString(),
      resumeJob: resume?.name ?? null,
      waitingJobs: health?.waitingFallbackJobs ?? 0
    },
    supervisor: {
      state: supervisorState,
      heartbeatAt: rawRemote?.heartbeatAt ?? null,
      activity: rawRemote?.activity ?? null
    },
    continuation: {
      state: continuationState,
      workerState: continuation?.workerState ?? "unknown",
      planId: continuation?.planId ?? null,
      activeWave: continuation?.activeWaveName ?? null,
      cursor: continuation?.cursor ?? null,
      waveCount: continuation?.waveCount ?? null,
      updatedAt: continuation?.updatedAt ?? null
    }
  };
}

// ===== Action-Plan-Tasks und Runner =====
function runnerEvents(input: AgentJobModelInput, jobId: string, lane: AgentLaneId | null, now: string): AgentJobEvent[] {
  return input.codexEvents
    .filter((event) => event.taskId === jobId)
    .map((event) => ({
      id: `runner-${jobId}-${event.seq}`,
      jobId,
      at: event.at ?? input.codexRun.lastActivityAt ?? now,
      kind: "activity" as const,
      message: `${event.label}: ${event.text}`,
      lane
    }));
}

function actionJobs(input: AgentJobModelInput, remote: RemoteOrchestratorRuntime, now: string): AgentJob[] {
  const runningLane = runnerLane(input.codexRun.result?.runner ?? input.codexRun.context?.runner ?? input.preferredRunner);
  // Vom Auto-Dispatcher beanspruchte Tasks laufen ab dem Claim (noch bevor der Server-Status nachzieht).
  const autoInFlight = new Set(input.autoLane?.inFlightTaskIds ?? []);
  const autoClaims = new Map((input.autoLane?.claims ?? []).map((claim) => [claim.taskId, claim]));
  return input.actionPlans.flatMap((plan) =>
    plan.tasks.flatMap((task): AgentJob[] => {
      const planned = runnerLane(task.targetRunner);
      const stage = !planned ? null : autoInFlight.has(task.taskId) ? "running" : jobStage(task, plan, input.currentQueueTaskId);
      if (!planned || !stage) return [];
      const running = stage === "running";
      const remoteOwns = remote.leaseActive && remote.jobId === task.taskId;
      const autoClaim = autoClaims.get(task.taskId);
      const claimedLane = runnerLane(autoClaim?.runner);
      const primaryRunOwns = input.codexRun.status === "running" &&
        (input.codexRun.context?.jobId === task.taskId || input.currentQueueTaskId === task.taskId);
      const owner: AgentLaneId | null = remoteOwns
        ? "remote_orchestrator"
        : running
          ? claimedLane ?? (primaryRunOwns ? runningLane : null) ?? planned
          : ["executed", "completed", "failed"].includes(stage)
            ? planned
            : null;
      const events = runnerEvents(input, task.taskId, owner, now);
      const base = {
        id: task.taskId,
        externalId: task.taskId,
        source: "action_plan" as const,
        projectId: task.projectId,
        task: task.title,
        owner,
        model: laneModel(input, owner ?? planned, remote),
        device: owner === "remote_orchestrator" ? remote.device ?? null : input.device ?? null,
        branch: task.branch ?? null,
        createdAt: plan.createdAt,
        handoffs: [] as AgentHandoff[],
        events
      };
      // Zwei Besitzer fuer dieselbe Job-ID sind nie "beide laufend": sichtbar blockieren.
      if (remoteOwns && running) {
        return [{
          ...base,
          status: "blocked",
          phase: "blocked",
          reason: "duplicate_owner",
          blocker: "duplicate_owner",
          nextStep: "await_writer",
          lastActivityAt: latest(last(events)?.at, remote.heartbeatAt)
        }];
      }
      if (remoteOwns) {
        const fresh = remote.orchestrator === "working";
        return [{
          ...base,
          status: fresh ? "running" : "waiting",
          phase: "orchestrator",
          reason: fresh ? "orchestrator_working" : "orchestrator_heartbeat_stale",
          nextStep: fresh ? "await_event" : "await_writer",
          startedAt: remote.attachedAt ?? null,
          lastActivityAt: remote.heartbeatAt ?? null
        }];
      }
      const lastEvent = last(events)?.at;
      const map: Record<NonNullable<ReturnType<typeof jobStage>>, Pick<AgentJob, "status" | "phase" | "reason" | "nextStep">> = {
        running: { status: "running", phase: "execution", reason: "runner_active", nextStep: "await_event" },
        completed: { status: "completed", phase: "complete", reason: null, nextStep: null },
        executed: { status: "waiting", phase: "review", reason: "merge_pending", nextStep: "review_merge" },
        failed: { status: "failed", phase: "failed", reason: "job_failed", nextStep: "inspect_evidence" },
        deferred: { status: "waiting", phase: "deferred", reason: "deferred", nextStep: "resume_deferred" },
        awaitingApproval: { status: "waiting", phase: "approval", reason: "approval_required", nextStep: "approve_plan" },
        queued: { status: "queued", phase: "queued", reason: "approved_for_execution", nextStep: "start_when_safe" }
      };
      const state = map[stage];
      return [{
        ...base,
        ...state,
        startedAt: running ? autoClaim?.claimedAt ?? (primaryRunOwns ? input.codexRun.startedAt ?? null : null) : null,
        lastActivityAt: lastEvent ?? (running ? autoClaim?.claimedAt ?? input.codexRun.lastActivityAt ?? input.codexRun.startedAt ?? null : plan.createdAt),
        completedAt: state.status === "completed" ? input.codexRun.lastActivityAt ?? null : null,
        blocker: state.status === "failed" ? task.summary ?? null : null
      }];
    })
  );
}

function transientRunnerJob(input: AgentJobModelInput, knownIds: Set<string>, remote: RemoteOrchestratorRuntime, now: string): AgentJob[] {
  const context = input.codexRun.context;
  if (!context || knownIds.has(context.jobId) || input.codexRun.status === "idle") return [];
  const owner = runnerLane(input.codexRun.result?.runner ?? context.runner ?? input.preferredRunner);
  const status: AgentJobStatus = input.codexRun.status === "completed"
    ? "completed"
    : input.codexRun.status === "failed"
      ? "failed"
      : "running";
  const events = runnerEvents(input, context.jobId, owner, now);
  return [{
    id: context.jobId,
    externalId: context.jobId,
    source: "runner",
    projectId: context.projectId,
    task: context.task,
    owner,
    model: laneModel(input, owner, remote),
    device: input.device ?? null,
    status,
    phase: status === "running" ? "execution" : status === "completed" ? "complete" : "failed",
    createdAt: context.createdAt ?? input.codexRun.startedAt ?? null,
    startedAt: input.codexRun.startedAt ?? null,
    lastActivityAt: last(events)?.at ?? input.codexRun.lastActivityAt ?? input.codexRun.startedAt ?? null,
    completedAt: status === "running" ? null : input.codexRun.lastActivityAt ?? null,
    blocker: status === "failed" ? input.codexRun.error ?? input.codexRun.result?.error ?? null : null,
    reason: status === "failed" ? "job_failed" : status === "running" ? "runner_active" : null,
    nextStep: status === "running" ? "await_event" : status === "failed" ? "inspect_evidence" : null,
    handoffs: [],
    events
  }];
}

// ===== Provider-Router-Fallback-Queue (Codex -> Quota -> Claude -> Remote Orchestrator ...) =====
export function fallbackHandoffs(item: FallbackJobSnapshot, owner: AgentLaneId | null): AgentHandoff[] {
  const states = item.providerStates;
  return states.flatMap((state, index): AgentHandoff[] => {
    if (!FAILOVER_STATES.has(state.state)) return [];
    const from = laneFromProvider(state.provider);
    const following = laneFromProvider(states[index + 1]?.provider);
    // Ohne naechsten Provider-Versuch: an den tatsaechlichen Besitzer, sonst sicher geparkt.
    const to = following ?? (owner && owner !== from ? owner : "local_control");
    return [{
      from,
      to,
      at: index === states.length - 1 ? item.updatedAt ?? item.createdAt ?? null : null,
      reason: state.state,
      retryAt: state.retryAt ?? null
    }];
  });
}

function fallbackRetryAt(item: FallbackJobSnapshot, nowMs: number): string | null {
  const future = item.providerStates
    .map((state) => state.retryAt)
    .filter((value): value is string => Boolean(value) && ms(value) > nowMs)
    .sort((a, b) => ms(a) - ms(b));
  return future[0] ?? null;
}

function fallbackJobs(
  input: AgentJobModelInput,
  remote: RemoteOrchestratorRuntime,
  nowMs: number,
  now: string
): AgentJob[] {
  const snapshot = input.localControl;
  const items = snapshot?.orchestration?.fallbackJobs ?? [];
  const resume = resumeInFlight(snapshot, nowMs);
  return items.map((item) => {
    const leased = remote.jobId === item.id || remote.jobId === item.name;
    const inFlight = resume?.name === item.name && OPEN_FALLBACK.has(item.status);
    const completedBy = laneFromProvider([...item.providerStates].reverse().find((state) => state.state === "completed")?.provider);
    let status: AgentJobStatus;
    let owner: AgentLaneId | null = null;
    let phase = "parked";
    let reason: string | null = item.reason ?? null;
    let nextStep: AgentNextStep | null = null;
    let startedAt: string | null = null;
    if (item.status === "completed") {
      status = "completed";
      owner = completedBy;
      phase = "complete";
    } else if (item.status === "implemented") {
      status = "implemented";
      owner = completedBy ?? laneFromProvider(item.activeProvider);
      phase = "implementation";
      nextStep = "inspect_evidence";
    } else if (item.status === "verifying") {
      status = "verifying";
      owner = completedBy ?? laneFromProvider(item.activeProvider);
      phase = "verification";
      nextStep = "inspect_evidence";
    } else if (item.status === "review_ready") {
      status = "review_ready";
      owner = completedBy ?? laneFromProvider(item.activeProvider);
      phase = "review";
      nextStep = "review_merge";
    } else if (item.status === "human_gate") {
      status = "human_gate";
      owner = completedBy ?? laneFromProvider(item.activeProvider);
      phase = "approval";
      nextStep = "resolve_gate";
    } else if (item.status === "retry_wait") {
      status = "retry_wait";
      owner = laneFromProvider(item.activeProvider);
      phase = "waiting_provider";
      nextStep = "await_intelligent_lane";
    } else if (item.status === "failed") {
      status = "failed";
      owner = laneFromProvider(last(item.providerStates)?.provider);
      phase = "failed";
      nextStep = "inspect_evidence";
    } else if (item.status === "running" && item.activeProvider) {
      owner = laneFromProvider(item.activeProvider);
      status = owner ? "running" : "blocked";
      phase = owner ? "execution" : "blocked";
      reason = owner ? "router_active" : "unknown_active_provider";
      nextStep = owner ? "await_event" : "inspect_evidence";
      startedAt = item.updatedAt ?? item.createdAt ?? null;
    } else if (leased && remote.leaseActive) {
      owner = "remote_orchestrator";
      phase = "orchestrator";
      status = remote.orchestrator === "working" ? "running" : "waiting";
      reason = remote.orchestrator === "working" ? "orchestrator_working" : "orchestrator_heartbeat_stale";
      nextStep = remote.orchestrator === "working" ? "await_event" : "await_writer";
      // Beginn = Claim-Zeitpunkt (claim setzt updatedAt), sonst Anbindung der Session.
      startedAt = item.status === "orchestrator_active" ? item.updatedAt ?? remote.attachedAt ?? null : remote.attachedAt ?? null;
    } else if (inFlight) {
      status = "running";
      owner = laneFromProvider(item.activeProvider);
      phase = "scheduler_resume";
      reason = "scheduler_resume";
      nextStep = "await_event";
      startedAt = resume?.startedAt ?? null;
    } else if (item.status === "orchestrator_active") {
      // Status beansprucht, aber Lease abgelaufen: nicht stillschweigend doppelt starten.
      status = "blocked";
      owner = "remote_orchestrator";
      phase = "orchestrator";
      reason = "orchestrator_lease_expired";
      nextStep = "release_stale_lease";
    } else if (OPEN_FALLBACK.has(item.status)) {
      status = "waiting";
      phase = "waiting_provider";
    } else {
      status = "blocked";
      phase = "blocked";
      reason = item.status;
      nextStep = "inspect_evidence";
    }
    const handoffs = fallbackHandoffs(item, owner);
    const at = item.updatedAt ?? item.createdAt ?? now;
    const events: AgentJobEvent[] = [
      ...(item.createdAt
        ? [{ id: `fallback-${item.id}-created`, jobId: item.id, at: item.createdAt, kind: "state" as const, code: "queued" }]
        : []),
      ...handoffs.map((handoff, index) => ({
        id: `fallback-${item.id}-handoff-${index}`,
        jobId: item.id,
        at: handoff.at ?? at,
        kind: "handoff" as const,
        code: handoff.reason,
        from: handoff.from,
        to: handoff.to
      })),
      ...(startedAt
        ? [{ id: `fallback-${item.id}-resume`, jobId: item.id, at: startedAt, kind: "state" as const, code: phase, lane: owner }]
        : []),
      ...(item.completedAt || item.failedAt
        ? [{
            id: `fallback-${item.id}-done`,
            jobId: item.id,
            at: (item.completedAt ?? item.failedAt) as string,
            kind: "state" as const,
            code: status,
            lane: owner
          }]
        : []),
      ...item.evidence.map((entry) => ({
        id: `fallback-${item.id}-evidence-${entry.key}`,
        jobId: item.id,
        at,
        kind: "evidence" as const,
        message: `${entry.key}: ${entry.value}`
      })),
      ...(leased && remote.activity && remote.heartbeatAt
        ? [{ id: `orchestrator-${item.id}-${remote.heartbeatAt}`, jobId: item.id, at: remote.heartbeatAt, kind: "heartbeat" as const, message: remote.activity, lane: "remote_orchestrator" as const }]
        : [])
    ];
    return {
      id: `router:${item.id}`,
      externalId: item.id,
      source: "provider_router",
      projectId: item.worktree ?? item.name.split("-")[0] ?? "agent-sync",
      task: item.name,
      owner,
      model: owner ? laneModel(input, owner, remote) : null,
      device: owner === "remote_orchestrator" ? remote.device ?? null : input.device ?? null,
      branch: item.branch ?? null,
      worktree: item.worktree ?? null,
      status,
      phase,
      createdAt: item.createdAt ?? null,
      startedAt,
      lastActivityAt: latest(item.updatedAt, item.completedAt, item.failedAt, startedAt, leased ? remote.heartbeatAt : null, item.createdAt),
      completedAt: item.completedAt ?? item.failedAt ?? null,
      blocker: status === "failed" || status === "blocked" ? item.reason ?? null : null,
      reason,
      nextStep,
      retryAt: fallbackRetryAt(item, nowMs),
      handoffs,
      resume: null,
      events
    } satisfies AgentJob;
  });
}

// ===== Local Control (deterministisches Substrat) =====
function localFeedEvents(snapshot: LocalControlMonitorSnapshot, now: string): AgentJobEvent[] {
  return snapshot.feed.map((line, index) => {
    const match = line.match(/^(\S+)\s+(.*)$/);
    const parsed = match ? Date.parse(match[1]) : Number.NaN;
    const message = (match?.[2] ?? line).replace(/\b(cwd|log|args)=\S+/g, "$1=<local>");
    return {
      id: `local-feed-${index}-${match?.[1] ?? "event"}`,
      jobId: message.match(/\bjob=([^\s]+)/)?.[1] ?? null,
      at: Number.isNaN(parsed) ? now : new Date(parsed).toISOString(),
      kind: /^(HEARTBEAT|BUSY|IDLE)\b/.test(message) ? "heartbeat" : "activity",
      message,
      lane: "local_control"
    };
  });
}

function localControlJobs(input: AgentJobModelInput, now: string): { jobs: AgentJob[]; events: AgentJobEvent[] } {
  const snapshot = input.localControl;
  if (!snapshot) return { jobs: [], events: [] };
  const events = localFeedEvents(snapshot, now);
  const eventFor = (jobId: string) => events.filter((event) => event.jobId === jobId);
  const continuation = snapshot.orchestration?.continuation;
  const wave = (jobId: string) => (continuation?.activeJobId === jobId ? continuation.activeWaveName ?? null : null);
  const common = (jobId: string, command: string) => ({
    id: `local:${jobId}`,
    externalId: jobId,
    source: wave(jobId) ? ("continuation" as const) : ("local_control" as const),
    task: wave(jobId) ?? `${command} · ${jobId}`,
    owner: "local_control" as const,
    model: null,
    device: input.device ?? null,
    handoffs: [] as AgentHandoff[],
    events: eventFor(jobId)
  });
  const active = (snapshot.activeLanes ?? []).map((lane): AgentJob => ({
    ...common(lane.jobId, lane.command),
    projectId: lane.projectId ?? "local-control",
    laneId: lane.laneId,
    status: "running",
    phase: "local_command",
    createdAt: lane.startedAt,
    startedAt: lane.startedAt,
    lastActivityAt: latest(last(eventFor(lane.jobId))?.at, lane.startedAt),
    completedAt: null,
    blocker: null,
    reason: lane.mode,
    nextStep: "await_event",
    retryAt: null
  }));
  const activeIds = new Set(active.map((job) => job.externalId));
  const queued = (snapshot.queuedJobs ?? [])
    .filter((job) => !activeIds.has(job.jobId))
    .map((job): AgentJob => ({
      ...common(job.jobId, job.command),
      projectId: job.projectId ?? "local-control",
      laneId: job.laneId,
      status: "queued",
      phase: "queued",
      createdAt: null,
      startedAt: null,
      lastActivityAt: null,
      completedAt: null,
      blocker: null,
      reason: job.requireCleanGit ? "clean_worktree_required" : job.mode,
      nextStep: snapshot.available ? "start_when_safe" : "start_local_control",
      retryAt: null
    }));
  const liveIds = new Set([...active, ...queued].map((job) => job.externalId));
  const finished = snapshot.recentJobs
    .filter((job) => !liveIds.has(job.id))
    .map((job): AgentJob => ({
      ...common(job.id, job.command),
      projectId: "local-control",
      laneId: null,
      status: job.status === "completed" ? "completed" : "failed",
      phase: job.status === "completed" ? "complete" : "failed",
      createdAt: job.startedAt,
      startedAt: job.startedAt,
      lastActivityAt: job.finishedAt,
      completedAt: job.finishedAt,
      blocker: job.error ?? null,
      reason: job.status,
      nextStep: job.status === "completed" ? null : "inspect_evidence",
      retryAt: null
    }));
  return { jobs: [...active, ...queued, ...finished], events };
}

// ===== Lanes: Konnektivitaet getrennt von Job-Besitz =====
function providerConnectivity(status: ProviderStatus | undefined): AgentLaneConnectivity {
  if (!status) return "unknown";
  if (!status.installed) return "not_configured";
  if (!status.enabled) return "disabled";
  // Leerer API-Pool: Adapter ist vorhanden, aber kein Slot eingerichtet.
  if (status.reason === "not_configured") return "not_configured";
  if (status.available) return "connected";
  if (status.state === "quota_limited" || status.state === "capacity_unavailable") return "limited";
  if (status.state === "authenticated") return "connected";
  if (status.state === "auth_unavailable" || status.state === "offline" || status.state === "installed") return "disconnected";
  return "unknown";
}

function buildLanes(
  input: AgentJobModelInput,
  jobs: AgentJob[],
  remote: RemoteOrchestratorRuntime,
  localHealth: AgentSyncState["localControl"]
): AgentLane[] {
  const running = (lane: AgentLaneId) => jobs.find((job) => job.status === "running" && job.owner === lane);
  const external = input.localControl?.orchestration?.providerHealth?.providers ?? [];
  return AGENT_LANE_ORDER.map((id, rank): AgentLane => {
    const active = running(id);
    if (id === "remote_orchestrator") {
      const connectivity: AgentLaneConnectivity =
        remote.orchestrator === "attached" || remote.orchestrator === "working"
          ? "connected"
          : remote.orchestrator === "stale"
            ? "limited"
            : "disconnected";
      return {
        id,
        kind: "orchestrator",
        intelligent: true,
        rank,
        connectivity,
        activity: active || remote.orchestrator === "working"
          ? "active"
          : connectivity === "limited"
            ? "waiting"
            : connectivity === "disconnected"
              ? "offline"
              : "idle",
        currentJobId: active?.id ?? remote.jobId ?? null,
        model: remote.model ?? null,
        device: remote.device ?? null,
        checkedAt: remote.heartbeatAt ?? null,
        retryAt: null,
        reason: remote.orchestrator,
        eligible: remote.eligible
      };
    }
    if (id === "local_control") {
      const connectivity: AgentLaneConnectivity =
        localHealth === "idle" || localHealth === "busy"
          ? "connected"
          : localHealth === "stale"
            ? "limited"
            : localHealth === "offline"
              ? "disconnected"
              : "unknown";
      return {
        id,
        kind: "substrate",
        intelligent: false,
        rank,
        connectivity,
        activity: active || localHealth === "busy" ? "active" : connectivity === "disconnected" ? "offline" : connectivity === "unknown" ? "unknown" : "idle",
        currentJobId: active?.id ?? null,
        model: null,
        device: input.device ?? null,
        checkedAt: input.localControl?.state?.heartbeatAt ?? null,
        retryAt: null,
        reason: localHealth,
        // Die Queue nimmt Jobs immer an; ohne Daemon bleiben sie sicher geparkt.
        eligible: true
      };
    }
    const status = input.providerStatuses.find((entry) => entry.provider === id);
    const fallback = external.find((entry) => entry.provider === id);
    const connectivity = status
      ? providerConnectivity(status)
      : fallback
        ? fallback.authenticated ? "connected" : fallback.installed ? "disconnected" : "not_configured"
        : "unknown";
    return {
      id,
      kind: "model_provider",
      intelligent: true,
      rank,
      connectivity,
      activity: active
        ? "active"
        : connectivity === "limited"
          ? "waiting"
          : connectivity === "disconnected" || connectivity === "disabled" || connectivity === "not_configured"
            ? "offline"
            : connectivity === "unknown"
              ? "unknown"
              : "idle",
      currentJobId: active?.id ?? null,
      model: laneModel(input, id, remote),
      device: input.device ?? null,
      checkedAt: status ? latest(status.checkedAt, status.healthCheckedAt) : fallback ? input.localControl?.orchestration?.providerHealth?.checkedAt ?? null : null,
      retryAt: status ? providerRetryAt(status) : null,
      reason: status?.reason ?? null,
      eligible: Boolean(status?.enabled && status.available)
    };
  });
}

// ===== Wiederaufnahme- und Startsicherheit (ein Writer pro Worktree, keine Doppelausfuehrung) =====
function resumeSafety(
  job: AgentJob,
  item: FallbackJobSnapshot | undefined,
  jobs: AgentJob[],
  lanes: AgentLane[],
  remote: RemoteOrchestratorRuntime
): { safe: boolean; reason: AgentResumeBlock } {
  const otherWriter = jobs.some((other) => other.id !== job.id && other.status === "running" && other.owner !== null);
  const modelLane = lanes.some((lane) => lane.kind === "model_provider" && lane.eligible);
  if (remote.leaseActive && (remote.jobId === item?.id || remote.jobId === item?.name)) return { safe: false, reason: "orchestrator_lease" };
  if (otherWriter) return { safe: false, reason: "writer_active" };
  if (item?.worktreeBusy) return { safe: false, reason: "worktree_busy" };
  if (item?.branchMatches !== true) return { safe: false, reason: "branch_unproven" };
  if (!modelLane && !remote.eligible) return { safe: false, reason: job.retryAt ? "provider_reset_pending" : "no_lane" };
  return { safe: true, reason: "safe" };
}

const RESUME_NEXT: Record<AgentResumeBlock, AgentNextStep> = {
  safe: "await_scheduler_resume",
  branch_unproven: "prove_branch",
  worktree_busy: "await_worktree",
  writer_active: "await_writer",
  orchestrator_lease: "await_writer",
  no_lane: "await_provider_reset",
  provider_reset_pending: "await_provider_reset"
};

function startSafety(input: AgentJobModelInput, jobs: AgentJob[], lanes: AgentLane[], remote: RemoteOrchestratorRuntime): AgentStartSafety {
  if (input.codexRun.status === "running" || input.queueRunning || input.autoLane?.inFlightTaskIds.length) {
    return { safe: false, reason: "runner_busy" };
  }
  if (remote.leaseActive && (remote.jobId || remote.ownership === "unverified")) {
    return { safe: false, reason: "orchestrator_lease" };
  }
  if (jobs.some((job) => job.source === "provider_router" && job.status === "running")) {
    return { safe: false, reason: "handoff_in_flight" };
  }
  const writer = (input.localControl?.activeLanes ?? []).some(
    (lane) => lane.mode === "workspace_write" || lane.resourceLocks.includes("agent-coding")
  );
  if (writer) return { safe: false, reason: "worktree_lease_active" };
  if (!lanes.some((lane) => lane.intelligent && lane.eligible)) return { safe: false, reason: "no_execution_lane" };
  return { safe: true, reason: "safe" };
}

// ===== Komposition =====
const STATUS_RANK: Record<AgentJobStatus, number> = {
  running: 0,
  verifying: 1,
  implemented: 2,
  review_ready: 3,
  human_gate: 4,
  retry_wait: 5,
  blocked: 6,
  waiting: 7,
  queued: 8,
  failed: 9,
  completed: 10
};

export function compareJobs(a: AgentJob, b: AgentJob): number {
  const byState = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (byState) return byState;
  return (ms(b.lastActivityAt ?? b.createdAt) || 0) - (ms(a.lastActivityAt ?? a.createdAt) || 0);
}

function providerStateEvents(input: AgentJobModelInput, now: string): AgentJobEvent[] {
  return input.providerTransitions.map((transition, index) => ({
    id: `provider-${transition.at}-${transition.provider}-${index}`,
    at: transition.at || now,
    kind: "state",
    code: `${transition.from}>${transition.to}`,
    lane: laneFromProvider(transition.provider)
  }));
}

// Tasks, die diese App-Sitzung nachweislich ausfuehrt (Einzel-Lauf, Board-Queue, Auto-Dispatcher).
function sessionInFlight(input: AgentJobModelInput): string[] {
  const ids = new Set(input.autoLane?.inFlightTaskIds ?? []);
  if (input.currentQueueTaskId) ids.add(input.currentQueueTaskId);
  if (input.codexRun.status === "running" && input.codexRun.context?.jobId) ids.add(input.codexRun.context.jobId);
  return [...ids];
}

function autoLanePlan(input: AgentJobModelInput, lanes: AgentLane[], remote: RemoteOrchestratorRuntime, safety: AgentStartSafety): AutoLanePlan {
  const auto = input.autoLane;
  if (!auto) return emptyAutoLanePlan(false);
  return planAutoLanes({
    enabled: auto.enabled,
    actionPlans: input.actionPlans,
    selectedOrder: auto.selectedOrder,
    repos: auto.repos,
    missingRepos: auto.missingRepos,
    claims: auto.claims,
    inFlightTaskIds: sessionInFlight(input),
    remoteJobId: remote.leaseActive ? remote.jobId ?? null : null,
    startSafety: safety,
    lanes,
    preferredRunner: input.preferredRunner,
    providerPriority: input.providerPriority,
    dailyCount: auto.dailyCount,
    dailyLimit: auto.dailyLimit,
    maxConcurrent: auto.maxConcurrent ?? AUTO_LANE_MAX_CONCURRENT,
    perRunnerLimit: AUTO_LANE_PER_RUNNER,
    lastDispatchAt: auto.lastDispatchAt,
    focus: input.focus
  });
}

// Auto-Lane-Wahrheit in die kanonischen Action-Jobs spiegeln: Kopf-Tasks tragen Lane und echten
// Warte-/Sperrgrund, Folge-Tasks ihre Lane. Ein verwaister "running"-Task wird nicht als laufend gezeigt.
function applyAutoLanes(jobs: AgentJob[], plan: AutoLanePlan): AgentJob[] {
  if (!plan.lanes.length) return jobs;
  const heads = new Map(plan.lanes.map((lane) => [lane.headTaskId, lane]));
  const followUps = new Map(plan.lanes.flatMap((lane) => lane.taskIds.slice(1).map((taskId) => [taskId, lane] as const)));
  return jobs.map((job) => {
    if (job.source !== "action_plan") return job;
    const head = heads.get(job.id);
    if (!head) {
      const lane = followUps.get(job.id);
      return lane && job.status === "queued" ? { ...job, laneId: lane.id, reason: "lane_follow_up" } : job;
    }
    // Abgeschlossene/fehlgeschlagene Jobs behalten ihren Status; nur offene Jobs uebernehmen den Lane-Grund.
    const open = job.status === "queued" || job.status === "waiting" || (job.status === "running" && head.state !== "running");
    const status: AgentJobStatus | null = !open
      ? null
      : head.state === "blocked" ? "blocked" : head.state === "waiting" ? "waiting" : null;
    if (head.state === "running" || !status) {
      return { ...job, laneId: head.id, reason: job.status === "queued" ? `auto_${head.reason}` : job.reason };
    }
    return {
      ...job,
      laneId: head.id,
      status,
      phase: status === "blocked" ? "blocked" : job.phase,
      reason: `auto_${head.reason}`,
      nextStep: head.nextStep,
      retryAt: head.retryAt ?? job.retryAt ?? null
    };
  });
}

// Aufgaben ausserhalb des aktiven Fokus bleiben sichtbar (Backlog/Verlauf), werden aber nie als
// "naechster Job" empfohlen. Greift erst, wenn die Registry Projekte kennt.
function markOutOfFocus(jobs: AgentJob[], focus: FocusPolicy | null | undefined): AgentJob[] {
  if (!hasFocusProfile(focus)) return jobs;
  return jobs.map((job) => {
    if (job.source !== "action_plan") return job;
    const decision = evaluateFocus(focus, job.projectId);
    // Manuelle Projekte (Auto aus) sind im Fokus und duerfen empfohlen werden; nur Auto-Dispatch ist gesperrt.
    return decision.allowed || decision.reason === "project_manual" ? job : { ...job, focus: decision.reason };
  });
}

const NEXT_CANDIDATE_STEPS = new Set<AgentNextStep>(["start_when_safe", "start_local_control", "await_scheduler_resume", "await_provider_reset", "await_intelligent_lane"]);

export function normalizeAgentSyncState(input: AgentJobModelInput): AgentSyncState {
  const now = input.now ?? new Date().toISOString();
  const nowMs = ms(now);
  const remote = remoteOrchestratorRuntime(input.localControl, nowMs);
  const scheduler = schedulerRuntime(input.localControl, nowMs);
  const localHealth = localControlHealth(input.localControl, nowMs);
  const action = actionJobs(input, remote, now);
  const transient = transientRunnerJob(input, new Set(action.map((job) => job.id)), remote, now);
  const routed = fallbackJobs(input, remote, nowMs, now);
  const local = localControlJobs(input, now);
  const draft = [...action, ...transient, ...routed, ...local.jobs];
  const lanes = buildLanes(input, draft, remote, localHealth);

  // Wartende Router-Jobs: Wiederaufnahme nur mit nachgewiesener Branch-/Worktree-/Lease-Sicherheit.
  const items = new Map((input.localControl?.orchestration?.fallbackJobs ?? []).map((item) => [`router:${item.id}`, item]));
  const draftJobs = draft
    .map((job) => {
      if (job.source !== "provider_router" || job.status !== "waiting" || job.owner) return job;
      const resume = resumeSafety(job, items.get(job.id), draft, lanes, remote);
      const modelLane = lanes.some((lane) => lane.kind === "model_provider" && lane.eligible);
      const nextStep: AgentNextStep = resume.safe
        ? modelLane ? "await_scheduler_resume" : "await_intelligent_lane"
        : job.retryAt && resume.reason !== "branch_unproven"
          ? "await_provider_reset"
          : RESUME_NEXT[resume.reason];
      return { ...job, resume, nextStep };
    })
    .sort(compareJobs);
  const safety = startSafety(input, draftJobs, lanes, remote);
  const autoLanes = autoLanePlan(input, lanes, remote, safety);
  const jobs = markOutOfFocus(applyAutoLanes(draftJobs, autoLanes), input.focus).sort(compareJobs);

  const currentJob = jobs.find((job) => job.status === "running") ?? null;
  const pending = jobs
    .filter((job) => !job.focus)
    .filter(
      (job) =>
        job.status === "queued" ||
        job.status === "retry_wait" ||
        (job.status === "waiting" && job.nextStep && NEXT_CANDIDATE_STEPS.has(job.nextStep))
    )
    .sort((a, b) => (STATUS_RANK[b.status] - STATUS_RANK[a.status]) || ((ms(a.createdAt) || 0) - (ms(b.createdAt) || 0)));
  const nextJob = pending[0] ?? null;
  const counts = {
    queued: 0,
    running: 0,
    implemented: 0,
    verifying: 0,
    review_ready: 0,
    human_gate: 0,
    retry_wait: 0,
    waiting: 0,
    blocked: 0,
    completed: 0,
    failed: 0
  } as Record<AgentJobStatus, number>;
  for (const job of jobs) counts[job.status] += 1;

  const seen = new Set<string>();
  const events = [...providerStateEvents(input, now), ...local.events, ...jobs.flatMap((job) => job.events)]
    .filter((event) => (seen.has(event.id) ? false : (seen.add(event.id), true)))
    .sort((a, b) => ms(b.at) - ms(a.at))
    .slice(0, MAX_EVENTS);
  const handoffs = jobs
    .flatMap((job) => job.handoffs.filter((handoff) => handoff.at))
    .sort((a, b) => ms(b.at) - ms(a.at))
    .slice(0, MAX_HANDOFFS);

  return {
    currentJob,
    nextJob,
    jobs,
    lanes,
    events,
    handoffs,
    counts,
    queueCount:
      counts.queued +
      counts.retry_wait +
      pending.filter((job) => job.status === "waiting").length,
    startSafety: safety,
    localControl: localHealth,
    remote,
    scheduler,
    autoLanes,
    generatedAt: now
  };
}

/** Wartet belegbar Arbeit auf einen Provider? Steuert, ob teure READY-Tests ueberhaupt noetig sind. */
export function agentWorkWaiting(state: AgentSyncState | null): boolean {
  return Boolean(
    state?.jobs.some(
      (job) =>
        job.status === "queued" ||
        job.status === "retry_wait" ||
        (job.status === "waiting" && job.source === "provider_router")
    )
  );
}

// ===== Screen-Projektionen: alle Views lesen dieselbe Wahrheit =====
export function overviewProjection(state: AgentSyncState) {
  return {
    job: state.currentJob,
    owner: state.lanes.find((lane) => lane.id === state.currentJob?.owner) ?? null,
    next: state.nextJob,
    queueCount: state.queueCount,
    startSafety: state.startSafety,
    idle: state.currentJob === null
  };
}

export function queueProjection(state: AgentSyncState) {
  return { rows: state.jobs, counts: state.counts, startSafety: state.startSafety };
}

export function monitorProjection(state: AgentSyncState) {
  const job = state.currentJob;
  return {
    job,
    lane: state.lanes.find((lane) => lane.id === job?.owner) ?? null,
    // Laufender Job: nur seine eigenen Events + jobfreie Provider-Statuswechsel; idle: alles Juengste.
    events: job
      ? state.events.filter((event) => event.jobId === job.id || event.jobId === job.externalId || (event.kind === "state" && !event.jobId))
      : state.events,
    handoffs: job?.handoffs.length ? job.handoffs : state.handoffs
  };
}
