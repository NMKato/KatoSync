// Created by NMKato Solutions
// Reine Views fuer den kanonischen Agent-Sync-Zustand (lib/agentJobModel.ts). Overview, Jobs &
// Queue und Live Monitor rendern dieselbe AgentSyncState – hier gibt es keine Provider-, RDC- oder
// Scheduler-Entscheidungen, nur Darstellung und Uebersetzung der Codes. Bewegung nur ueber
// bestehende Klassen, die bei prefers-reduced-motion abgeschaltet werden.
import type { ReactNode } from "react";
import { ArrowRight, Clock3, GitBranch, Layers, RadioTower, ShieldAlert, ShieldCheck } from "lucide-react";
import { useT, type TFunc, type TKey } from "../i18n";
import { monitorProjection, overviewProjection } from "../lib/agentJobModel";
import { providerIcons } from "./ProviderManager";
import type { AgentHandoff, AgentJob, AgentJobEvent, AgentLane, AgentLaneId, AgentSyncState } from "../types";

const PROVIDER_FLOW = ["installed", "authenticated", "available", "quota_limited", "auth_unavailable", "capacity_unavailable", "job_failed", "offline", "unknown"];
const PHASES = ["execution", "approval", "queued", "review", "deferred", "failed", "complete", "blocked", "orchestrator", "scheduler_resume", "parked", "waiting_provider", "local_command"];
const STATUSES = ["queued", "running", "waiting", "blocked", "completed", "failed"];

export const laneIcons: Record<AgentLaneId, typeof RadioTower> = { ...providerIcons, remote_orchestrator: RadioTower };

export function clock(value: string | null | undefined, withSeconds = false): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], withSeconds
    ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" });
}

export function duration(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

export function laneLabel(t: TFunc, lane: AgentLaneId | null | undefined): string {
  return lane ? t(`agent.lane.${lane}` as TKey) : "—";
}

export function reasonLabel(t: TFunc, code: string | null | undefined): string {
  if (!code) return "—";
  if (PROVIDER_FLOW.includes(code)) return t(`providers.flow.${code}` as TKey);
  return code.replace(/_/g, " ");
}

function phaseLabel(t: TFunc, code: string): string {
  if (PHASES.includes(code)) return t(`agent.phase.${code}` as TKey);
  if (STATUSES.includes(code)) return t(`agent.status.${code}` as TKey);
  return reasonLabel(t, code);
}

function ownerLabel(t: TFunc, job: AgentJob): string {
  if (job.owner) return laneLabel(t, job.owner);
  return job.source === "provider_router" && job.status === "running" ? t("agent.job.ownerUnknown") : t("agent.job.ownerNone");
}

function handoffTarget(t: TFunc, handoff: AgentHandoff): string {
  return handoff.to === "local_control" ? `${laneLabel(t, handoff.to)} (${t("agent.event.parked")})` : laneLabel(t, handoff.to);
}

export function eventText(t: TFunc, event: AgentJobEvent): string {
  if (event.kind === "handoff") {
    return t("agent.event.handoff", {
      from: laneLabel(t, event.from),
      to: event.to ? handoffTarget(t, { from: event.from ?? null, to: event.to, reason: event.code ?? "" }) : "—",
      reason: reasonLabel(t, event.code)
    });
  }
  if (event.kind === "state" && event.code) {
    const lane = event.lane ? `${laneLabel(t, event.lane)}: ` : "";
    const [from, to] = event.code.split(">");
    return to ? `${lane}${reasonLabel(t, from)} → ${reasonLabel(t, to)}` : `${lane}${phaseLabel(t, from)}`;
  }
  return event.message ?? "—";
}

function connectivityTone(lane: AgentLane): "ok" | "warn" | "danger" | "neutral" {
  if (lane.connectivity === "connected") return "ok";
  if (lane.connectivity === "limited") return "warn";
  if (lane.connectivity === "disconnected") return "danger";
  return "neutral";
}

function OwnerIcon({ lane }: { lane: AgentLaneId }) {
  const Icon = laneIcons[lane];
  return <Icon size={14} aria-hidden="true" />;
}

function StatusChip({ status }: { status: AgentJob["status"] }) {
  const { t } = useT();
  return (
    <span className={`agent-job-stage ${status}`}>
      {status === "running" ? <span className="agent-chip-dot live" aria-hidden="true" /> : null}
      {t(`agent.status.${status}` as TKey)}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function heartbeatTone(lane: AgentLane): "live" | "ok" | "warn" | "off" {
  if (lane.activity === "active") return "live";
  if (lane.connectivity === "connected") return "ok";
  if (lane.connectivity === "limited") return "warn";
  return "off";
}

function laneStatusText(t: TFunc, lane: AgentLane): string {
  if (lane.activity === "active") return t("agent.laneAct.active");
  if (lane.connectivity === "limited") return t("agent.conn.limited");
  if (lane.connectivity === "not_configured") return t("agent.conn.not_configured");
  if (lane.connectivity === "disconnected" || lane.activity === "offline") return t("agent.conn.disconnected");
  if (lane.connectivity === "connected") return t("agent.laneAct.idle");
  return t("agent.conn.unknown");
}

function controlTowerNext(state: AgentSyncState, t: TFunc): string {
  const current = state.currentJob;
  if (current?.nextStep) return t(`agent.next.${current.nextStep}` as TKey);
  if (state.nextJob) return t("agent.control.queueNext", { task: state.nextJob.task });
  if (state.scheduler.providerHealth.nextCheckAt) {
    return t("agent.control.schedulerNext", { time: clock(state.scheduler.providerHealth.nextCheckAt) });
  }
  return t("agent.control.noNext");
}

function controlTowerTruth(state: AgentSyncState, t: TFunc): { title: string; detail: string; tone: string } {
  const job = state.currentJob;
  if (job?.status === "running") {
    return {
      title: t("agent.control.working", { owner: ownerLabel(t, job), task: job.task }),
      detail: [job.projectId, phaseLabel(t, job.phase), job.lastActivityAt ? t("agent.control.lastSeen", { time: clock(job.lastActivityAt, true) }) : null]
        .filter(Boolean)
        .join(" · "),
      tone: "working"
    };
  }
  if (job) {
    return {
      title: t("agent.control.waiting", { task: job.task }),
      detail: [ownerLabel(t, job), reasonLabel(t, job.reason ?? job.blocker), job.retryAt ? t("agent.lane.retry", { time: clock(job.retryAt) }) : null]
        .filter(Boolean)
        .join(" · "),
      tone: job.status === "failed" || job.status === "blocked" ? "danger" : "waiting"
    };
  }
  const ready = state.lanes.filter((lane) => lane.intelligent && lane.connectivity === "connected").length;
  return {
    title: t("agent.control.idle"),
    detail: state.queueCount
      ? t("agent.control.queueWaiting", { count: state.queueCount })
      : t("agent.control.idleReady", { count: ready }),
    tone: "idle"
  };
}

function HeartbeatMini({ label, lane, now }: { label: string; lane: AgentLane; now: string }) {
  const { t } = useT();
  const tone = heartbeatTone(lane);
  const age = lane.checkedAt ? Math.max(0, Date.parse(now) - Date.parse(lane.checkedAt)) : Number.NaN;
  const seen = lane.checkedAt
    ? t("agent.control.lastSeen", { time: clock(lane.checkedAt, true) })
    : t("agent.control.noHeartbeat");
  return (
    <div className={`control-heartbeat ${tone}`}>
      <div className="control-heartbeat-copy">
        <strong>{label}</strong>
        <small>{laneStatusText(t, lane)} · {seen}</small>
      </div>
      <div
        className="control-heartbeat-wave"
        aria-label={Number.isNaN(age) ? seen : `${seen} · ${Math.round(age / 1000)}s`}
        title={Number.isNaN(age) ? seen : `${seen} · ${Math.round(age / 1000)}s`}
      >
        <i /><i /><i /><i /><i /><i /><i />
      </div>
    </div>
  );
}

export function ControlTower({ state }: { state: AgentSyncState }) {
  const { t } = useT();
  const truth = controlTowerTruth(state, t);
  const activeJobs = state.jobs.filter((job) => job.status === "running");
  const currentOwner = state.currentJob?.owner ?? null;
  const jobHandoffs = state.currentJob?.handoffs ?? [];
  const latestHandoff = jobHandoffs[jobHandoffs.length - 1] ?? state.handoffs[state.handoffs.length - 1] ?? null;
  return (
    <div className="control-tower">
      <div className={`glass control-truth ${truth.tone}`}>
        <div>
          <span className="section-label">{t("agent.control.eyebrow")}</span>
          <h2>{truth.title}</h2>
          <p>{truth.detail}</p>
          {activeJobs.length > 1 ? (
            <div className="control-active-jobs" aria-label={t("agent.control.activeJobs", { count: activeJobs.length })}>
              <strong>{t("agent.control.activeJobs", { count: activeJobs.length })}</strong>
              <span>
                {activeJobs.slice(0, 3).map((job) => `${ownerLabel(t, job)} · ${job.projectId}`).join("  ·  ")}
                {activeJobs.length > 3 ? ` · +${activeJobs.length - 3}` : ""}
              </span>
            </div>
          ) : null}
        </div>
        <div className="control-next">
          <span>{t("agent.control.nextAuto")}</span>
          <strong>{controlTowerNext(state, t)}</strong>
          <small>{state.startSafety.safe ? t("agent.safety.safe") : t(`agent.safety.${state.startSafety.reason}` as TKey)}</small>
        </div>
      </div>

      <div className="control-tower-grid">
        <div className="glass control-lane-card">
          <div className="agent-card-title">
            <GitBranch size={17} />
            <h3>{t("agent.control.lanes")}</h3>
          </div>
          {latestHandoff ? (
            <div className="control-handoff-now">
              <span className="control-handoff-pulse" aria-hidden="true" />
              <strong>{t("agent.control.handoff", {
                from: laneLabel(t, latestHandoff.from),
                to: laneLabel(t, latestHandoff.to)
              })}</strong>
              <small>{reasonLabel(t, latestHandoff.reason)}</small>
            </div>
          ) : null}
          <ol className="control-lane-map">
            {state.lanes.map((lane, index) => {
              const Icon = laneIcons[lane.id];
              const owner = lane.id === currentOwner;
              const tone = heartbeatTone(lane);
              return (
                <li className={`control-lane-node ${tone}${owner ? " owner" : ""}`} key={lane.id}>
                  {index > 0 ? <span className="control-lane-connector" aria-hidden="true"><i /></span> : null}
                  <div className="control-lane-orb">
                    <Icon size={20} />
                    <span className="control-lane-pulse" aria-hidden="true" />
                  </div>
                  <strong>{laneLabel(t, lane.id)}</strong>
                  <small>{laneStatusText(t, lane)}</small>
                  {owner && state.currentJob ? <em title={state.currentJob.task}>{state.currentJob.task}</em> : lane.model ? <em title={lane.model}>{lane.model}</em> : null}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="glass control-heartbeat-card">
          <div className="agent-card-title">
            <RadioTower size={17} />
            <h3>{t("agent.control.heartbeat")}</h3>
          </div>
          <div className="control-heartbeat-grid">
            {state.lanes.map((lane) => (
              <HeartbeatMini key={lane.id} label={laneLabel(t, lane.id)} lane={lane} now={state.generatedAt} />
            ))}
          </div>
          <div className="control-runtime-strip">
            <span className={`runtime-pill ${state.scheduler.providerHealth.state}`}>
              {t("agent.substrate.health")}: <strong>{t(`agent.sched.${state.scheduler.providerHealth.state}` as TKey)}</strong>
            </span>
            <span className={`runtime-pill ${state.scheduler.continuation.state}`}>
              {t("agent.substrate.continuation")}: <strong>{t(`agent.cont.${state.scheduler.continuation.state}` as TKey)}</strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HandoffChain({ handoffs }: { handoffs: AgentHandoff[] }) {
  const { t } = useT();
  if (!handoffs.length) return <p className="agent-empty">{t("agent.job.noHandoffs")}</p>;
  return (
    <ol className="agent-handoff-chain" aria-label={t("agent.job.handoffs")}>
      {handoffs.map((handoff, index) => (
        <li key={`${handoff.from}-${handoff.to}-${index}`}>
          <span>{laneLabel(t, handoff.from)}</span>
          <small>{reasonLabel(t, handoff.reason)}</small>
          <ArrowRight size={13} aria-hidden="true" />
          <strong>{handoffTarget(t, handoff)}</strong>
          {handoff.at ? <time dateTime={handoff.at}>{clock(handoff.at)}</time> : null}
          {handoff.retryAt ? <em>{t("agent.lane.retry", { time: clock(handoff.retryAt) })}</em> : null}
        </li>
      ))}
    </ol>
  );
}

function StartSafety({ state }: { state: AgentSyncState }) {
  const { t } = useT();
  const { safe, reason } = state.startSafety;
  return (
    <p className={`agent-safety ${safe ? "ok" : "warn"}`}>
      {safe ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
      <span>
        <strong>{t("agent.safety.title")}</strong> {t(`agent.safety.${reason}` as TKey)}
      </span>
    </p>
  );
}

// ===== Aktueller Job: Overview (voll) und Live Monitor (kompakt) =====
export function CurrentJobCard({ state, compact = false }: { state: AgentSyncState; compact?: boolean }) {
  const { t } = useT();
  const view = overviewProjection(state);
  const job = view.job;
  const nowMs = Date.parse(state.generatedAt);
  return (
    <div className={`glass agent-card agent-current${job ? ` ${job.status}` : " idle"}`}>
      <div className="agent-card-title">
        <Layers size={17} />
        <h3>{t("agent.job.title")}</h3>
        {job ? <StatusChip status={job.status} /> : null}
      </div>
      {job ? (
        <>
          <div className="agent-current-head">
            <strong title={job.task}>{job.task}</strong>
            <small>
              {job.projectId} · {t(`agent.source.${job.source}` as TKey)}
            </small>
          </div>
          <dl className="agent-current-facts">
            <Fact label={t("agent.job.owner")}>{ownerLabel(t, job)}</Fact>
            <Fact label={t("agent.job.model")}>{job.model ?? "—"}</Fact>
            <Fact label={t("agent.job.device")}>{job.device ?? "—"}</Fact>
            <Fact label={t("agent.job.phase")}>{phaseLabel(t, job.phase)}</Fact>
            <Fact label={t("agent.job.elapsed")}>{duration(job.startedAt ? nowMs - Date.parse(job.startedAt) : null)}</Fact>
            <Fact label={t("agent.job.lastActivity")}>{clock(job.lastActivityAt, true)}</Fact>
            {job.branch ? <Fact label={t("agent.job.branch")}>{job.branch}</Fact> : null}
            {job.retryAt ? <Fact label={t("agent.job.retryAt")}>{clock(job.retryAt)}</Fact> : null}
          </dl>
          {job.blocker ? (
            <p className="agent-current-blocker">
              <strong>{t("agent.job.blocker")}:</strong> {reasonLabel(t, job.blocker)}
            </p>
          ) : null}
          <p className="agent-current-next">
            <strong>{t("agent.job.next")}:</strong> {job.nextStep ? t(`agent.next.${job.nextStep}` as TKey) : "—"}
          </p>
          {!compact ? (
            <div>
              <span className="agent-mini-title">{t("agent.job.handoffs")}</span>
              <HandoffChain handoffs={job.handoffs} />
            </div>
          ) : null}
        </>
      ) : (
        <div className="agent-current-head">
          <strong>{t("agent.job.idle.title")}</strong>
          <small>{t("agent.job.idle.text")}</small>
        </div>
      )}
      <div className="agent-current-foot">
        <span>
          {t("agent.job.queue")}: <strong>{t("agent.job.queueValue", { count: view.queueCount })}</strong>
        </span>
        <span title={view.next?.task}>
          {t("agent.job.nextQueued")}:{" "}
          <strong>
            {view.next ? `${view.next.task} · ${t(`agent.status.${view.next.status}` as TKey)}` : t("agent.job.nextNone")}
          </strong>
        </span>
      </div>
      <StartSafety state={state} />
    </div>
  );
}

// ===== Fuenf kanonische Lanes: Konnektivitaet getrennt vom Job-Besitz =====
export function LaneRoute({ state }: { state: AgentSyncState }) {
  const { t } = useT();
  const owner = state.currentJob?.owner ?? null;
  const ownerRank = state.lanes.find((lane) => lane.id === owner)?.rank ?? -1;
  return (
    <div className="glass agent-card agent-route-card">
      <div className="agent-card-title">
        <GitBranch size={17} />
        <h3>{t("agent.route.title")}</h3>
      </div>
      <ol className={`agent-route${state.currentJob ? " working" : ""}`} aria-label={t("providers.routeAria")}>
        {state.lanes.map((lane) => {
          const Icon = laneIcons[lane.id];
          const isOwner = lane.id === owner;
          const lit = ownerRank >= 0 && lane.rank <= ownerRank;
          return (
            <li className={`agent-route-step${lit ? " lit" : ""}${lane.rank === 0 ? " first" : ""}`} key={lane.id}>
              {lane.rank > 0 ? <span className={`agent-route-link${lit ? " lit" : " fallback"}`} aria-hidden="true" /> : null}
              <div className={`agent-route-node ${connectivityTone(lane)}${isOwner ? " owner" : ""}${ownerRank > lane.rank ? " passed" : ""}`}>
                <span className="agent-route-rank">{lane.rank + 1}</span>
                <span className="agent-route-icon"><Icon size={18} /></span>
                <strong>{laneLabel(t, lane.id)}</strong>
                <small>
                  {t(`agent.conn.${lane.connectivity}` as TKey)} · {t(`agent.laneAct.${lane.activity}` as TKey)}
                </small>
                <span className="agent-route-kind">{t(`agent.lane.kind.${lane.kind}` as TKey)}</span>
                {lane.id === "local" && lane.connectivity === "not_configured" ? (
                  <span className="agent-route-kind">{t("agent.lane.localBrainSeam")}</span>
                ) : null}
                {lane.model ? <span className="agent-route-kind" title={lane.model}>{lane.model}</span> : null}
                {lane.retryAt ? <span className="agent-route-kind">{t("agent.lane.retry", { time: clock(lane.retryAt) })}</span> : null}
                {isOwner ? (
                  <em>{t("agent.lane.ownsJob")}</em>
                ) : lane.eligible ? (
                  <em className="soft">{lane.intelligent ? t("agent.lane.eligible") : t("agent.lane.parked")}</em>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="agent-route-note">{t("agent.route.policy")}</p>
      <div>
        <span className="agent-mini-title">{t("agent.route.handoffs")}</span>
        <HandoffChain handoffs={state.handoffs.slice(0, 4)} />
      </div>
    </div>
  );
}

// ===== Substrat & Scheduler: Daemon, RDC-Transport, Orchestrator, Health, Watchdog getrennt =====
type RowState = "active" | "idle" | "failed" | "offline" | "unknown";

export function SubstratePanel({ state }: { state: AgentSyncState }) {
  const { t } = useT();
  const { remote, scheduler } = state;
  const health = scheduler.providerHealth;
  const continuation = scheduler.continuation;
  const rows: Array<{ id: string; title: string; value: string; detail: string; tone: RowState }> = [
    {
      id: "localControl",
      title: t("agent.substrate.localControl"),
      value: t(`agent.lc.${state.localControl}` as TKey),
      detail: t(`agent.lc.${state.localControl}.detail` as TKey),
      tone: state.localControl === "busy" ? "active" : state.localControl === "idle" ? "idle" : state.localControl === "unknown" ? "unknown" : "offline"
    },
    {
      id: "rdc",
      title: t("agent.substrate.rdc"),
      value: t(`agent.rdc.${remote.transport}` as TKey),
      detail: remote.transportAt ? t("agent.substrate.seen", { time: clock(remote.transportAt, true) }) : t("agent.substrate.noEvidence"),
      tone: remote.transport === "online" ? "idle" : remote.transport === "stale" ? "offline" : "unknown"
    },
    {
      id: "orchestrator",
      title: t("agent.substrate.orchestrator"),
      value: t(`agent.orch.${remote.orchestrator}` as TKey),
      detail: remote.leaseExpiresAt
        ? [
            remote.activity,
            remote.device,
            remote.leaseActive ? t("agent.substrate.lease", { time: clock(remote.leaseExpiresAt) }) : t("agent.substrate.seen", { time: clock(remote.heartbeatAt, true) })
          ].filter(Boolean).join(" · ")
        : t("agent.substrate.noEvidence"),
      tone: remote.orchestrator === "working" ? "active" : remote.orchestrator === "attached" ? "idle" : remote.orchestrator === "stale" ? "offline" : "unknown"
    },
    {
      id: "health",
      title: t("agent.substrate.health"),
      value: t(`agent.sched.${health.state}` as TKey),
      detail: health.resumeJob
        ? t("agent.substrate.resuming", { job: health.resumeJob })
        : health.nextCheckAt
          ? t("agent.substrate.nextCheck", { time: clock(health.nextCheckAt) })
          : t("agent.substrate.noEvidence"),
      tone: health.state === "resuming" ? "active" : health.state === "armed" ? "idle" : health.state === "stale" ? "offline" : "unknown"
    },
    {
      id: "continuation",
      title: t("agent.substrate.continuation"),
      value: t(`agent.cont.${continuation.state}` as TKey),
      detail: continuation.planId
        ? [
            continuation.activeWave,
            continuation.waveCount ? t("agent.substrate.wave", { cursor: Math.min((continuation.cursor ?? 0) + 1, continuation.waveCount), total: continuation.waveCount }) : null,
            continuation.updatedAt ? clock(continuation.updatedAt) : null
          ].filter(Boolean).join(" · ")
        : t("agent.substrate.noEvidence"),
      tone: continuation.state === "armed" ? "active" : continuation.state === "stopped" ? "failed" : continuation.state === "waiting_daemon" ? "offline" : continuation.state === "idle" ? "idle" : "unknown"
    }
  ];
  return (
    <div className="glass agent-card agent-card-lanes">
      <div className="agent-card-title">
        <ShieldCheck size={17} />
        <h3>{t("agent.substrate.title")}</h3>
      </div>
      <div className="agent-lanes">
        {rows.map((row) => (
          <article className={`agent-lane ${row.tone}`} key={row.id}>
            <div className="agent-lane-body">
              <div className="agent-lane-head">
                <strong>{row.title}</strong>
                <span className={`agent-lane-state ${row.tone}`}>{row.value}</span>
              </div>
              <small title={row.detail}>{row.detail}</small>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

// ===== Status-Zaehler aus derselben Jobliste =====
export function StatusCounts({ state }: { state: AgentSyncState }) {
  const { t } = useT();
  const flow: Array<keyof AgentSyncState["counts"]> = ["queued", "running", "waiting", "completed"];
  return (
    <div className="agent-flow">
      <ol className="agent-flow-stages">
        {flow.map((status, index) => (
          <li className={`agent-flow-stage ${status}${state.counts[status] ? " has" : ""}`} key={status}>
            {index > 0 ? (
              <span className={`agent-flow-link${status === "running" && state.counts.running ? " flowing" : ""}`} aria-hidden="true" />
            ) : null}
            <strong>{state.counts[status]}</strong>
            <span>{t(`agent.status.${status}` as TKey)}</span>
          </li>
        ))}
      </ol>
      <div className="agent-flow-side">
        <span className={state.counts.blocked ? "warn" : ""}>
          {t("agent.status.blocked")}: <strong>{state.counts.blocked}</strong>
        </span>
        <span className={state.counts.failed ? "danger" : ""}>
          {t("agent.status.failed")}: <strong>{state.counts.failed}</strong>
        </span>
      </div>
    </div>
  );
}

// ===== Jobliste (Jobs & Queue) =====
export function AgentJobList({ jobs, limit }: { jobs: AgentJob[]; limit?: number }) {
  const { t } = useT();
  const rows = limit ? jobs.slice(0, limit) : jobs;
  if (!rows.length) return <p className="agent-empty">{t("agent.queue.empty")}</p>;
  return (
    <ol className="agent-canonical-jobs">
      {rows.map((job) => (
        <li className={`agent-job selected ${job.status}`} key={job.id}>
          <span className="agent-job-order" title={ownerLabel(t, job)}>{job.owner ? <OwnerIcon lane={job.owner} /> : "·"}</span>
          <div>
            <strong title={job.task}>{job.task}</strong>
            <small>
              {job.projectId} · {t(`agent.source.${job.source}` as TKey)} · {ownerLabel(t, job)}
              {job.model ? ` · ${job.model}` : ""}
              {job.branch ? ` · ${job.branch}` : ""}
            </small>
            <small>
              {[
                job.createdAt ? t("agent.queue.created", { time: clock(job.createdAt) }) : null,
                job.startedAt ? t("agent.queue.started", { time: clock(job.startedAt) }) : null,
                job.lastActivityAt ? t("agent.queue.activity", { time: clock(job.lastActivityAt) }) : null,
                job.retryAt ? t("agent.lane.retry", { time: clock(job.retryAt) }) : null
              ].filter(Boolean).join(" · ")}
            </small>
            {job.handoffs.length ? (
              <small>
                {job.handoffs
                  .map((handoff) => `${laneLabel(t, handoff.from)} → ${handoffTarget(t, handoff)} (${reasonLabel(t, handoff.reason)})`)
                  .join(" · ")}
              </small>
            ) : null}
            {job.nextStep || job.resume ? (
              <small className="agent-job-next">
                {job.resume ? `${t("agent.job.resume")}: ${t(`agent.resume.${job.resume.reason}` as TKey)} · ` : ""}
                {job.nextStep ? t(`agent.next.${job.nextStep}` as TKey) : ""}
              </small>
            ) : null}
          </div>
          <StatusChip status={job.status} />
        </li>
      ))}
    </ol>
  );
}

// ===== Live Monitor =====
export function AgentLiveMonitor({ state }: { state: AgentSyncState }) {
  const { t } = useT();
  const view = monitorProjection(state);
  const steps = view.job ? view.events.filter((event) => event.jobId && event.kind !== "evidence").slice(0, 8).reverse() : [];
  return (
    <section className="agent-dashboard agent-live" aria-label={t("agent.monitor.title")}>
      <ControlTower state={state} />

      {steps.length ? (
        <div className="glass agent-card control-now-playing">
          <div className="agent-card-title">
            <Clock3 size={17} />
            <h3>{t("agent.monitor.steps")}</h3>
          </div>
          <ol className="agent-phase-rail" aria-label={t("agent.monitor.steps")}>
            {steps.map((event, index) => (
              <li className={index === steps.length - 1 && view.job?.status === "running" ? "current" : ""} key={event.id} title={eventText(t, event)}>
                <span aria-hidden="true" />
                {eventText(t, event).slice(0, 64)}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <details className="glass control-diagnostics">
        <summary>{t("agent.control.diagnostics")}</summary>
        <div className="control-diagnostics-grid">
          <SubstratePanel state={state} />
          <div className="agent-card">
            <div className="agent-card-title">
              <GitBranch size={17} />
              <h3>{t("agent.job.handoffs")}</h3>
            </div>
            <HandoffChain handoffs={view.handoffs} />
          </div>
        </div>
        <div className="agent-card">
          <div className="agent-card-title">
            <RadioTower size={17} />
            <h3>{t("agent.monitor.events")}</h3>
          </div>
          {view.events.length ? (
            <ul className="agent-history-list agent-event-stream">
              {view.events.slice(0, 40).map((event) => (
                <li className={event.kind} key={event.id}>
                  <Clock3 size={13} />
                  <span>{eventText(t, event)}</span>
                  <time dateTime={event.at}>{clock(event.at, true)}</time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="agent-empty">{t("agent.monitor.noEvents")}</p>
          )}
        </div>
      </details>
    </section>
  );
}
