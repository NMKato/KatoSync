// Created by NMKato Solutions
// Agent-Sync-Workspace: eigenes Cockpit, Jobs & Queue sowie Verlauf & Nachweise. Reine View –
// Zustand kommt ausschliesslich aus dem ViewModel; Ableitungen liegen testbar in lib/agentSyncCockpit.ts.
// Bewegung erklaert Arbeit (Fluss zur aktiven Lane, laufende Jobs) und entfaellt bei reduced motion.
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  GitBranch,
  History,
  ListChecks,
  PlayCircle,
  ShieldCheck,
  StopCircle,
  TerminalSquare,
  Workflow,
  XCircle
} from "lucide-react";
import { useT, type TFunc, type TKey } from "../i18n";
import { providerDisplayState } from "../lib/providerPolicy";
import {
  agentReadiness,
  jobStage,
  localControlHealth,
  localJobBars,
  type AgentReadiness,
  type AttentionItem,
  type JobStage
} from "../lib/agentSyncCockpit";
import { safeHttpUrl } from "../lib/url";
import { NO_PROJECT_ID } from "../repositories/katoSyncRepository";
import { fallbackLabels } from "./ProviderManager";
import {
  AgentJobList,
  CurrentJobCard,
  LaneRoute,
  StatusCounts,
  SubstratePanel,
  clock,
  duration,
  laneLabel
} from "./AgentJobViews";
import type { ProviderId } from "../types";
import type { StepId, useKatoSyncViewModel } from "../viewmodels/useKatoSyncViewModel";

type ViewModel = ReturnType<typeof useKatoSyncViewModel>;
type Navigate = (step: StepId) => void;

const modelProviders: ProviderId[] = ["codex", "claude", "local"];

function providerLabel(vm: ViewModel, provider: ProviderId): string {
  return vm.providerStatuses.find((entry) => entry.provider === provider)?.label ?? fallbackLabels[provider];
}

function runnerDisplayName(runner: string | null | undefined): string {
  return runner === "claude_cli" ? "Claude Code" : "Codex";
}

// ===== Zustands-Hooks (App-Ebene, ueberleben Seitenwechsel) =====

export function buildAgentReadiness(vm: ViewModel, nowMs = Date.now()): AgentReadiness {
  const readiness = agentReadiness({
    providers: modelProviders.map((provider) => {
      const status = vm.providerStatuses.find((entry) => entry.provider === provider);
      return {
        provider,
        display: providerDisplayState(
          status,
          provider,
          vm.providerBusy[provider] === "connect" && provider !== "local"
        ),
        // Cloud-Provider zählen als verbunden, solange ihre echte CLI-Authentifizierung gültig ist.
        // Lokale Modelle haben keinen OAuth-Login; dort entspricht eine verfügbare Konfiguration
        // der Verbindung. Deaktivierte Provider werden bewusst nicht als verbunden gezählt.
        connected: Boolean(
          status?.enabled && (provider === "local" ? status.available : status.authenticated)
        )
      };
    }),
    localControl: localControlHealth(vm.localControlMonitor, nowMs),
    runnerActive: vm.codexRun.status === "running" || vm.queueRunning,
    runnerFailed: vm.codexRun.status === "failed"
  });
  // Laufende Jobs zaehlt ausschliesslich das kanonische Modell (alle Quellen, ohne Doppelzaehlung).
  return { ...readiness, activeJobs: vm.agentSync.counts.running };
}

function attentionText(item: AttentionItem, vm: ViewModel, t: TFunc): string {
  switch (item.kind) {
    case "provider":
      return t("agent.attention.provider", {
        provider: providerLabel(vm, item.provider),
        state: t(`providers.state.${item.display}` as TKey)
      });
    case "noProvider":
      return t("agent.attention.noProvider");
    case "localControl":
      return t(item.health === "stale" ? "agent.attention.localControlStale" : "agent.attention.localControlOffline");
    case "runnerFailed":
      return t("agent.attention.runnerFailed");
  }
}

function attentionTarget(item: AttentionItem): StepId {
  if (item.kind === "localControl") return "agentMonitor";
  if (item.kind === "runnerFailed") return "agentHistory";
  return "agentProviders";
}

// ===== Topbar: was ist wirklich bereit? =====
export function AgentReadinessStrip({ vm, onNavigate }: { vm: ViewModel; onNavigate: Navigate }) {
  const { t } = useT();
  const readiness = buildAgentReadiness(vm);
  const attention = readiness.attention.length;
  return (
    <div className="agent-readiness-strip" aria-label={t("agent.readiness.aria")}>
      <button className="agent-ready-chip" onClick={() => onNavigate("agentProviders")} type="button">
        <span className={`agent-chip-dot ${readiness.connected.length ? "ok" : "neutral"}`} aria-hidden="true" />
        <span>{t("agent.readiness.providers")}</span>
        <strong>{t("agent.readiness.providersValue", { count: readiness.connected.length, total: readiness.total })}</strong>
      </button>
      <button className="agent-ready-chip" onClick={() => onNavigate("agentMonitor")} type="button">
        <span className={`agent-chip-dot ${healthTone(readiness.localControl)}`} aria-hidden="true" />
        <span>{t("agent.readiness.localControl")}</span>
        <strong>{t(`agent.lc.${readiness.localControl}` as TKey)}</strong>
      </button>
      <button className="agent-ready-chip" onClick={() => onNavigate("agentJobs")} type="button">
        <span className={`agent-chip-dot ${readiness.activeJobs ? "live" : "neutral"}`} aria-hidden="true" />
        <span>{t("agent.readiness.activeJobs")}</span>
        <strong>{readiness.activeJobs}</strong>
      </button>
      <button
        className={`agent-ready-chip${attention ? " attention" : ""}`}
        onClick={() => onNavigate(attention ? attentionTarget(readiness.attention[0]) : "agentDashboard")}
        type="button"
      >
        <span className={`agent-chip-dot ${attention ? "warn" : "ok"}`} aria-hidden="true" />
        <span>{t("agent.readiness.attention")}</span>
        <strong>{attention}</strong>
      </button>
    </div>
  );
}

function healthTone(health: AgentReadiness["localControl"]): string {
  if (health === "busy") return "live";
  if (health === "idle") return "ok";
  if (health === "unknown") return "neutral";
  return "warn";
}

// ===== Dashboard =====
export function AgentSyncDashboard({ vm, onNavigate }: { vm: ViewModel; onNavigate: Navigate }) {
  const { t } = useT();
  const readiness = buildAgentReadiness(vm);
  const state = vm.agentSync;
  // Erststart-Text sagt, was wirklich bereit ist – kein generisches "Setup abgeschlossen".
  const headline =
    !readiness.connected.length && !readiness.activeJobs
      ? "setup"
      : readiness.attention.length
        ? "attention"
        : readiness.activeJobs
          ? "working"
          : "ready";

  return (
    <section className="agent-dashboard" id="section-agent-dashboard">
      <div className={`agent-hero glass headline-${headline}`}>
        <div className="agent-hero-copy">
          <span className="section-label">{t("agent.hero.eyebrow")}</span>
          <h2>{t(`agent.hero.${headline}.title` as TKey)}</h2>
          <p>{t(`agent.hero.${headline}.text` as TKey)}</p>
        </div>
        <div className="agent-hero-tiles">
          <button className="agent-tile" onClick={() => onNavigate("agentProviders")} type="button">
            <span>{t("agent.readiness.providers")}</span>
            <strong>{t("agent.readiness.providersValue", { count: readiness.connected.length, total: readiness.total })}</strong>
            <small>
              {readiness.connected.length
                ? readiness.connected.map((provider) => providerLabel(vm, provider)).join(" · ")
                : t("agent.tile.noneConnected")}
            </small>
          </button>
          <button className="agent-tile" onClick={() => onNavigate("agentMonitor")} type="button">
            <span>{t("agent.readiness.localControl")}</span>
            <strong className={`tone-${healthTone(readiness.localControl)}`}>{t(`agent.lc.${readiness.localControl}` as TKey)}</strong>
            <small>
              {vm.localControlMonitor?.state
                ? t("agent.tile.heartbeat", { time: clock(vm.localControlMonitor.state.heartbeatAt, true) })
                : t("agent.tile.lcHint")}
            </small>
          </button>
          <button className="agent-tile" onClick={() => onNavigate("agentJobs")} type="button">
            <span>{t("agent.readiness.activeJobs")}</span>
            <strong className={readiness.activeJobs ? "tone-live" : ""}>{readiness.activeJobs}</strong>
            <small>{t("agent.tile.queued", { count: state.queueCount })}</small>
          </button>
          <div className={`agent-tile${readiness.attention.length ? " attention" : ""}`}>
            <span>{t("agent.readiness.attention")}</span>
            <strong className={readiness.attention.length ? "tone-warn" : "tone-ok"}>{readiness.attention.length}</strong>
            <small>{readiness.attention.length ? t("agent.tile.attentionSee") : t("agent.tile.attentionNone")}</small>
          </div>
        </div>
      </div>

      {readiness.attention.length ? (
        <ul className="agent-attention glass" aria-label={t("agent.readiness.attention")}>
          {readiness.attention.map((item, index) => (
            <li className={item.tone} key={`${item.kind}-${index}`}>
              <AlertTriangle size={15} />
              <span>{attentionText(item, vm, t)}</span>
              <button className="ghost compact-button" onClick={() => onNavigate(attentionTarget(item))} type="button">
                {t("agent.attention.open")}
                <ArrowRight size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <CurrentJobCard state={state} />

      <LaneRoute state={state} />

      <div className="agent-dashboard-row">
        <SubstratePanel state={state} />
        <div className="glass agent-card agent-card-flow">
          <CardTitle icon={<Workflow size={17} />} title={t("agent.flow.statusTitle")} />
          <StatusCounts state={state} />
          <button className="ghost compact-button agent-card-link" onClick={() => onNavigate("agentJobs")} type="button">
            {t("agent.flow.open")}
            <ArrowRight size={14} />
          </button>
        </div>
      </div>

      <div className="agent-dashboard-row">
        <div className="glass agent-card agent-card-activity">
          <CardTitle icon={<Activity size={17} />} title={t("agent.activity.title")} />
          <LocalJobActivity vm={vm} />
        </div>
        <div className="glass agent-card agent-card-evidence">
          <CardTitle icon={<ShieldCheck size={17} />} title={t("agent.evidence.title")} />
          <LastRunnerResult vm={vm} />
          <button className="ghost compact-button agent-card-link" onClick={() => onNavigate("agentHistory")} type="button">
            {t("agent.evidence.open")}
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}

function CardTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="agent-card-title">
      {icon}
      <h3>{title}</h3>
    </div>
  );
}

// ===== Local-Control-Aktivitaet: echte Dauer/Status der letzten Jobs =====
function LocalJobActivity({ vm }: { vm: ViewModel }) {
  const { t } = useT();
  const bars = localJobBars(vm.localControlMonitor?.recentJobs ?? []);
  const stats = vm.localControlMonitor?.stats;
  if (!bars.length) return <p className="agent-empty">{t("agent.activity.empty")}</p>;
  return (
    <div className="agent-activity">
      <div className="agent-activity-bars" role="img" aria-label={t("agent.activity.aria", { count: bars.length })}>
        {bars.map((bar) => (
          <span
            className={`agent-activity-bar ${bar.status}`}
            key={bar.id}
            style={{ height: `${Math.round(bar.ratio * 100)}%` }}
            title={`${bar.command} · ${bar.status} · ${duration(bar.durationMs)} · ${clock(bar.finishedAt, true)}`}
          />
        ))}
      </div>
      <div className="agent-activity-legend">
        <span className="ok">{t("agent.activity.completed", { count: stats?.completed ?? 0 })}</span>
        <span className="danger">{t("agent.activity.failed", { count: stats?.failed ?? 0 })}</span>
        <span className="warn">{t("agent.activity.timeout", { count: stats?.timeout ?? 0 })}</span>
        <span>{t("agent.activity.average", { value: duration(stats?.avgDurationMs) })}</span>
      </div>
    </div>
  );
}

function LastRunnerResult({ vm }: { vm: ViewModel }) {
  const { t } = useT();
  const result = vm.codexRun.result;
  if (!result) {
    return (
      <p className="agent-empty">
        {vm.codexRun.status === "running" ? t("agent.evidence.running") : t("agent.evidence.empty")}
      </p>
    );
  }
  const prUrl = safeHttpUrl(result.prUrl);
  const ok = result.status === "completed";
  return (
    <div className={`agent-evidence ${ok ? "ok" : "danger"}`}>
      <div className="agent-evidence-head">
        {ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
        <strong>{runnerDisplayName(result.runner)}</strong>
        <span>{result.status}</span>
      </div>
      <dl>
        <div><dt>{t("agent.evidence.branch")}</dt><dd>{result.branch || "—"}</dd></div>
        <div><dt>{t("agent.evidence.files")}</dt><dd>{result.changedFiles.length}</dd></div>
        <div><dt>{t("agent.evidence.duration")}</dt><dd>{duration(result.durationMs)}</dd></div>
        <div><dt>{t("agent.evidence.commit")}</dt><dd>{result.commit ? result.commit.slice(0, 10) : "—"}</dd></div>
      </dl>
      {prUrl ? (
        <a className="provider-login-link" href={prUrl} rel="noreferrer" target="_blank">
          <ExternalLink size={14} />
          {t("agent.evidence.pr")}
        </a>
      ) : null}
    </div>
  );
}

// ===== Jobs & Queue =====
export function AgentSyncJobs({ vm, onOpenMistralTasks }: { vm: ViewModel; onOpenMistralTasks: () => void }) {
  const { t } = useT();
  const state = vm.agentSync;
  const groups = vm.boardGroups
    .map((group) => ({
      projectId: group.projectId,
      jobs: group.tasks
        .filter((task) => task.targetRunner === "codex_cli")
        .map((task) => {
          const plan = vm.actionPlans.find((entry) => entry.planId === task.planId);
          return { task, stage: plan ? jobStage(task, plan, vm.currentQueueTaskId) : null };
        })
        .filter((job): job is { task: typeof job.task; stage: JobStage } => job.stage !== null)
    }))
    .filter((group) => group.jobs.length);
  const limitReached = vm.dailyCount >= vm.boardDailyLimit;

  return (
    <section className="agent-jobs" id="section-agent-jobs">
      <div className="agent-dashboard-row">
        <CurrentJobCard state={state} compact />
        <div className="glass agent-card agent-card-flow">
          <CardTitle icon={<Workflow size={17} />} title={t("agent.flow.statusTitle")} />
          <StatusCounts state={state} />
          <p className="agent-route-note">
            {t("agent.jobs.limit", { count: vm.dailyCount, limit: vm.boardDailyLimit })}
          </p>
        </div>
      </div>

      <div className="glass agent-card">
        <CardTitle icon={<ListChecks size={17} />} title={t("agent.queue.title")} />
        <p className="agent-route-note">{t("agent.queue.note")}</p>
        <AgentJobList jobs={state.jobs} limit={40} />
      </div>

      <div className="glass agent-card">
        <div className="agent-jobs-head">
          <CardTitle icon={<ListChecks size={17} />} title={t("agent.jobs.queueTitle")} />
          {vm.queueRunning ? (
            <button className="secondary" onClick={vm.handleStopBoardQueue} type="button">
              <StopCircle size={15} />
              {t("agent.jobs.stop")}
            </button>
          ) : null}
        </div>
        <p className="agent-route-note">{t("agent.jobs.source")}</p>
        {groups.length ? (
          <div className="agent-job-groups">
            {groups.map((group) => {
              const executable = group.jobs.filter(
                ({ task }) =>
                  task.selected &&
                  task.approved &&
                  task.riskLevel !== "critical" &&
                  !["executed", "completed", "rejected", "deferred", "running"].includes(task.status)
              ).length;
              return (
                <section className="agent-job-group" key={group.projectId}>
                  <header>
                    <strong>{group.projectId === NO_PROJECT_ID ? t("agent.jobs.noProject") : group.projectId}</strong>
                    <small>{t("agent.jobs.ready", { count: executable })}</small>
                    <button
                      className="secondary compact-button"
                      disabled={Boolean(vm.busy) || vm.queueRunning || executable === 0 || limitReached || !state.startSafety.safe}
                      onClick={() => void vm.handleStartBoardQueue(group.projectId)}
                      title={state.startSafety.safe ? t("board.startQueueTitle") : t(`agent.safety.${state.startSafety.reason}` as TKey)}
                      type="button"
                    >
                      <PlayCircle size={14} />
                      {t("agent.jobs.start")}
                    </button>
                  </header>
                  <ol>
                    {group.jobs.map(({ task, stage }) => (
                      <li className={`agent-job ${stage}${task.selected ? " selected" : ""}`} key={task.taskId}>
                        <span className="agent-job-order">{task.selected ? task.orderIndex + 1 : "·"}</span>
                        <div>
                          <strong>{task.title}</strong>
                          <small>
                            {task.agentName} · {t(`label.risk.${task.riskLevel}` as TKey)}
                            {task.selected ? "" : ` · ${t("agent.jobs.notScheduled")}`}
                          </small>
                        </div>
                        <span className={`agent-job-stage ${stage}`}>
                          {stage === "running" ? <span className="agent-chip-dot live" aria-hidden="true" /> : null}
                          {t(`agent.stage.${stage}` as TKey)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>
        ) : (
          <p className="agent-empty">{t("agent.jobs.empty")}</p>
        )}
        <button className="ghost compact-button agent-card-link" onClick={onOpenMistralTasks} type="button">
          {t("agent.jobs.manage")}
          <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}

// ===== Verlauf & Nachweise (nur echter Zustand) =====
export function AgentSyncHistory({ vm }: { vm: ViewModel }) {
  const { t } = useT();
  const finished = vm.actionPlans
    .flatMap((plan) => plan.tasks.map((task) => ({ task, stage: jobStage(task, plan, vm.currentQueueTaskId) })))
    .filter((job) => job.task.targetRunner === "codex_cli")
    .filter((job) => job.stage === "executed" || job.stage === "completed" || job.stage === "failed");
  const localJobs = vm.localControlMonitor?.recentJobs ?? [];
  const events = [
    ...vm.agentSync.handoffs.map((handoff) => ({
      at: handoff.at as string,
      key: `h-${handoff.at}-${handoff.from}-${handoff.to}`,
      text: t("agent.history.handoff", { from: laneLabel(t, handoff.from), to: laneLabel(t, handoff.to) })
    })),
    ...vm.providerHistory.map((event) => ({
      at: event.at,
      key: `p-${event.at}-${event.provider}-${event.to}`,
      text: `${providerLabel(vm, event.provider)}: ${t(`providers.flow.${event.from}` as TKey)} → ${t(`providers.flow.${event.to}` as TKey)}`
    }))
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return (
    <section className="agent-history" id="section-agent-history">
      <div className="agent-dashboard-row">
        <div className="glass agent-card">
          <CardTitle icon={<TerminalSquare size={17} />} title={t("agent.history.lastRun")} />
          <LastRunnerResult vm={vm} />
          {vm.codexRun.result?.resultSummary ? (
            <p className="agent-evidence-summary">{vm.codexRun.result.resultSummary}</p>
          ) : null}
        </div>
        <div className="glass agent-card">
          <CardTitle icon={<History size={17} />} title={t("agent.history.events")} />
          {events.length ? (
            <ul className="agent-history-list">
              {events.slice(0, 12).map((event) => (
                <li key={event.key}>
                  <Clock3 size={13} />
                  <span>{event.text}</span>
                  <time dateTime={event.at}>{clock(event.at, true)}</time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="agent-empty">{t("agent.history.noEvents")}</p>
          )}
          <p className="agent-route-note">{t("agent.history.sessionNote")}</p>
        </div>
      </div>

      <div className="glass agent-card">
        <CardTitle icon={<GitBranch size={17} />} title={t("agent.history.runnerJobs")} />
        {finished.length ? (
          <ul className="agent-history-list">
            {finished.map(({ task, stage }) => {
              const prUrl = safeHttpUrl(task.prUrl);
              return (
                <li key={task.taskId}>
                  {stage === "failed" ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
                  <span>
                    <strong>{task.title}</strong>
                    <small>
                      {t(`agent.stage.${stage}` as TKey)}
                      {task.branch ? ` · ${task.branch}` : ""}
                    </small>
                  </span>
                  {prUrl ? (
                    <a className="provider-login-link" href={prUrl} rel="noreferrer" target="_blank">
                      <ExternalLink size={13} />
                      PR
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="agent-empty">{t("agent.history.noRunnerJobs")}</p>
        )}
      </div>

      <div className="glass agent-card">
        <CardTitle icon={<ShieldCheck size={17} />} title={t("agent.history.localJobs")} />
        {localJobs.length ? (
          <ul className="agent-history-list">
            {localJobs.slice(0, 12).map((job) => (
              <li className={job.status} key={job.id}>
                {job.status === "completed" ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                <span>
                  <strong>{job.command}</strong>
                  <small>
                    {job.status} · {job.mode} · {duration(job.durationMs)} · exit {job.exitCode ?? "—"}
                  </small>
                </span>
                <time dateTime={job.finishedAt}>{clock(job.finishedAt, true)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="agent-empty">{t("agent.activity.empty")}</p>
        )}
      </div>
    </section>
  );
}
