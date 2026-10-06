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
  FolderPlus,
  FolderSearch,
  GitBranch,
  History,
  ListChecks,
  PlayCircle,
  RefreshCcw,
  ShieldCheck,
  StopCircle,
  TerminalSquare,
  Workflow,
  XCircle
} from "lucide-react";
import { useT, type TFunc, type TKey } from "../i18n";
import { providerDisplayState } from "../lib/providerPolicy";
import { isInActiveFocus } from "../lib/projectFocus";
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
  AutoLanePanel,
  ControlTower,
  CurrentJobCard,
  StatusCounts,
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
  const state = vm.agentSync;
  const current = state.currentJob;
  const attention = readiness.attention.length;
  const currentTone = current?.status === "running" ? "live" : current ? "warn" : "ok";
  return (
    <div className="agent-readiness-strip control-strip" aria-label={t("agent.readiness.aria")}>
      <button className="agent-ready-chip control-strip-main" onClick={() => onNavigate("agentDashboard")} type="button">
        <span className={`agent-chip-dot ${currentTone}`} aria-hidden="true" />
        <span>{current?.owner ? laneLabel(t, current.owner) : t("agent.control.eyebrow")}</span>
        <strong title={current?.task}>{current ? current.task : t("agent.control.idle")}</strong>
      </button>
      <button className="agent-ready-chip" onClick={() => onNavigate("agentProviders")} type="button">
        <span className={`agent-chip-dot ${readiness.connected.length ? "ok" : "neutral"}`} aria-hidden="true" />
        <span>{t("agent.readiness.providers")}</span>
        <strong>{readiness.connected.length}/{readiness.total}</strong>
      </button>
      <button className="agent-ready-chip" onClick={() => onNavigate("agentMonitor")} type="button">
        <span className={`agent-chip-dot ${state.remote.transport === "online" ? "ok" : state.remote.transport === "stale" ? "warn" : "neutral"}`} aria-hidden="true" />
        <span>RDC</span>
        <strong>{t(`agent.rdc.${state.remote.transport}` as TKey)}</strong>
      </button>
      <button className="agent-ready-chip" onClick={() => onNavigate("agentDashboard")} type="button">
        <span className={`agent-chip-dot ${state.autoLanes.enabled ? (state.autoLanes.counts.running ? "live" : "ok") : "neutral"}`} aria-hidden="true" />
        <span>{t("agent.auto.mode")}</span>
        <strong>
          {state.autoLanes.enabled ? t("agent.auto.on") : t("agent.auto.off")}
          {state.autoLanes.lanes.length ? ` · ${state.autoLanes.lanes.length}` : ""}
        </strong>
      </button>
      <button className="agent-ready-chip" onClick={() => onNavigate("agentJobs")} type="button">
        <span className={`agent-chip-dot ${state.queueCount ? "warn" : "neutral"}`} aria-hidden="true" />
        <span>{t("agent.job.queue")}</span>
        <strong>{state.queueCount}</strong>
      </button>
      {attention ? (
        <button className="agent-ready-chip attention" onClick={() => onNavigate(attentionTarget(readiness.attention[0]))} type="button">
          <span className="agent-chip-dot warn" aria-hidden="true" />
          <span>{t("agent.readiness.attention")}</span>
          <strong>{attention}</strong>
        </button>
      ) : null}
    </div>
  );
}

// ===== Dashboard =====
export function AgentSyncDashboard({ vm, onNavigate }: { vm: ViewModel; onNavigate: Navigate }) {
  const { t } = useT();
  const readiness = buildAgentReadiness(vm);
  const state = vm.agentSync;
  const hasLinkedProjects = vm.projects.registry.projects.length > 0;
  const approvalPlans = hasLinkedProjects
    ? vm.actionPlans.filter(
        (plan) =>
          (plan.status === "pending_user_review" || plan.status === "in_review") &&
          plan.tasks.some((task) => isInActiveFocus(vm.projects.focusPolicy, task.projectId))
      )
    : [];
  const reviewJobs = hasLinkedProjects
    ? state.jobs.filter(
        (job) =>
          (job.status === "implemented" || job.status === "review_ready" || job.status === "human_gate") &&
          isInActiveFocus(vm.projects.focusPolicy, job.projectId)
      )
    : [];

  return (
    <section className="agent-dashboard" id="section-agent-dashboard">
      <ControlTower state={state} />

      <section className="glass agent-project-linker" aria-label={t("agent.projects.quickTitle")}>
        <div className="agent-project-linker-copy">
          <span className="agent-project-linker-icon" aria-hidden="true">
            <FolderSearch size={19} />
          </span>
          <div>
            <strong>{t("agent.projects.quickTitle")}</strong>
            <p>{t("agent.projects.quickText")}</p>
          </div>
        </div>
        <div className="agent-project-linker-actions">
          <button
            className="primary"
            disabled={vm.projects.busy !== null}
            onClick={() => {
              void vm.projects.startDiscovery("project").then(() => onNavigate("agentProjects"));
            }}
            type="button"
          >
            <FolderPlus size={15} />
            {t("projects.add")}
          </button>
          <button
            className="secondary"
            disabled={vm.projects.busy !== null}
            onClick={() => {
              void vm.projects.startDiscovery("workspace").then(() => onNavigate("agentProjects"));
            }}
            type="button"
          >
            <FolderSearch size={15} />
            {t("agent.projects.quickWorkspace")}
          </button>
          <button className="ghost compact-button" onClick={() => onNavigate("agentProjects")} type="button">
            {t("agent.projects.quickOpen")}
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="agent-project-linker-status">
          <small>
            {vm.projects.registry.projects.length
              ? t("agent.projects.quickConnected", { count: vm.projects.registry.projects.length })
              : t("agent.projects.quickEmpty")}
          </small>
          {vm.projects.registry.projects.length ? (
            <div className="agent-project-linker-chips">
              {vm.projects.portfolio.map((project) => (
                <button
                  className={`agent-project-chip ${project.focus.autoMode === "off" ? "manual" : ""}`}
                  key={project.id}
                  onClick={() => onNavigate("agentProjects")}
                  title={project.name}
                  type="button"
                >
                  <span>{project.name}</span>
                  <b>{project.focus.priority}</b>
                  {project.focus.autoMode === "off" ? <em>{t("projects.auto.off")}</em> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <AutoQStarter vm={vm} onOpenProjects={() => onNavigate("agentProjects")} />

      <AutoLanePanel
        busy={Boolean(vm.busy) || vm.projectWorkSyncBusy}
        onRelease={(taskId) => void vm.handleReleaseAutoLane(taskId)}
        onToggle={vm.handleSetAutoMode}
        plan={state.autoLanes}
      />

      {(approvalPlans.length || reviewJobs.length) ? (
        <section className="agent-approval-zone" aria-label={t("agent.approval.title")}>
          <div className="agent-approval-head">
            <ShieldCheck size={17} />
            <div>
              <h3>{t("agent.approval.title")}</h3>
              <p>{t("agent.approval.text")}</p>
            </div>
          </div>
          <div className="agent-approval-grid">
            {approvalPlans.slice(0, 4).map((plan) => {
              const projectIds = [...new Set(plan.tasks.map((task) => task.projectId))].filter(Boolean);
              return (
                <article className="glass agent-approval-card" key={plan.planId}>
                  <span className="agent-approval-kind">{t("agent.approval.plan")}</span>
                  <strong>{projectIds.join(" · ") || plan.agentName}</strong>
                  <small>{plan.tasks.length} · {t(`label.risk.${plan.riskLevel}` as TKey)}</small>
                  <p>{t("board.statusNeedApproval")}</p>
                  <div className="agent-approval-actions">
                    <button className="secondary compact-button" disabled={Boolean(vm.busy)} onClick={() => void vm.handleStartActionPlan(plan.planId)} type="button">
                      <CheckCircle2 size={14} />
                      {t("board.approvePlan")}
                    </button>
                    <button className="ghost compact-button" disabled={Boolean(vm.busy)} onClick={() => void vm.handleRejectActionPlan(plan.planId)} type="button">
                      <XCircle size={14} />
                      {t("board.rejectPlan")}
                    </button>
                  </div>
                </article>
              );
            })}
            {reviewJobs.slice(0, 4).map((job) => (
              <article className="glass agent-approval-card" key={job.id}>
                <span className="agent-approval-kind">{t(`agent.status.${job.status}` as TKey)}</span>
                <strong>{job.task}</strong>
                <small>{job.projectId} · {job.owner ? laneLabel(t, job.owner) : t("agent.job.ownerNone")}</small>
                <p>{job.nextStep ? t(`agent.next.${job.nextStep}` as TKey) : t("agent.next.inspect_evidence")}</p>
                <div className="agent-approval-actions">
                  <button className="secondary compact-button" onClick={() => onNavigate("agentJobs")} type="button">
                    <ArrowRight size={14} />
                    {t("agent.attention.open")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

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

      <div className="agent-dashboard-row control-secondary">
        <div className="glass agent-card agent-card-flow">
          <CardTitle icon={<Workflow size={17} />} title={t("agent.flow.statusTitle")} />
          <StatusCounts state={state} />
          <button className="ghost compact-button agent-card-link" onClick={() => onNavigate("agentJobs")} type="button">
            {t("agent.flow.open")}
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="glass agent-card agent-card-activity">
          <CardTitle icon={<Activity size={17} />} title={t("agent.activity.title")} />
          <LocalJobActivity vm={vm} />
        </div>
      </div>

      <details className="glass control-diagnostics">
        <summary>{t("agent.control.diagnostics")}</summary>
        <div className="agent-card agent-card-evidence">
          <CardTitle icon={<ShieldCheck size={17} />} title={t("agent.evidence.title")} />
          <LastRunnerResult vm={vm} />
          <button className="ghost compact-button agent-card-link" onClick={() => onNavigate("agentHistory")} type="button">
            {t("agent.evidence.open")}
            <ArrowRight size={14} />
          </button>
        </div>
      </details>
    </section>
  );
}

function AutoQStarter({ vm, onOpenProjects }: { vm: ViewModel; onOpenProjects: () => void }) {
  const { t } = useT();
  const report = vm.projectWorkSyncReport;
  return (
    <section className="glass agent-autoq" aria-label={t("agent.autoq.title")}>
      <div className="agent-autoq-main">
        <span className="agent-autoq-icon" aria-hidden="true">
          <Workflow size={18} />
        </span>
        <div className="agent-autoq-copy">
          <strong>{t("agent.autoq.title")}</strong>
          <p>{t("agent.autoq.text")}</p>
        </div>
        <button
          className="primary agent-autoq-start"
          disabled={vm.projectWorkSyncBusy || Boolean(vm.busy)}
          onClick={() => void vm.handleStartAutoQ()}
          type="button"
        >
          {vm.projectWorkSyncBusy ? <RefreshCcw className="spin" size={15} /> : <PlayCircle size={15} />}
          {vm.projectWorkSyncBusy ? t("agent.autoq.syncing") : t("agent.autoq.start")}
        </button>
      </div>

      {report ? (
        <div className="agent-autoq-report">
          <div className="agent-autoq-counts">
            <span className="ok">{t("agent.autoq.ready", { count: report.readyCount })}</span>
            <span className="warn">{t("agent.autoq.gated", { count: report.gatedCount })}</span>
            <span>{t("agent.autoq.empty", { count: report.emptyCount })}</span>
          </div>
          <div className="agent-autoq-projects">
            {report.projects.map((project) => (
              <div
                className={`agent-autoq-project ${project.ready > 0 ? "ready" : project.gated ? "gated" : "empty"}`}
                key={project.projectId}
              >
                <span className="projects-prio">{project.priority}</span>
                <strong>{project.name}</strong>
                <small>
                  {project.ready > 0
                    ? t("agent.autoq.projectReady", { count: project.ready })
                    : project.detail ?? t("agent.autoq.projectEmpty")}
                </small>
              </div>
            ))}
          </div>
          {report.readyCount === 0 && report.gatedCount > 0 ? (
            <button className="ghost compact-button" onClick={onOpenProjects} type="button">
              {t("agent.autoq.resolve")}
              <ArrowRight size={13} />
            </button>
          ) : null}
        </div>
      ) : (
        <small className="agent-autoq-hint">{t("agent.autoq.hint")}</small>
      )}
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
  const currentJobs = state.jobs.filter((job) => job.status !== "completed" && job.status !== "failed");
  const historyJobs = state.jobs.filter((job) => job.status === "completed" || job.status === "failed");
  const groups = vm.boardGroups
    .map((group) => ({
      projectId: group.projectId,
      jobs: group.tasks
        .filter((task) => task.targetRunner === "codex_cli")
        .map((task) => {
          const plan = vm.agentActionPlans.find((entry) => entry.planId === task.planId);
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

      <AutoLanePanel
        busy={Boolean(vm.busy)}
        onRelease={(taskId) => void vm.handleReleaseAutoLane(taskId)}
        onToggle={vm.handleSetAutoMode}
        plan={state.autoLanes}
      />

      <div className="glass agent-card">
        <CardTitle icon={<ListChecks size={17} />} title={t("agent.queue.title")} />
        <p className="agent-route-note">{t("agent.queue.note")}</p>
        <AgentJobList jobs={currentJobs} limit={40} />
        {historyJobs.length ? (
          <details className="agent-job-history">
            <summary>{t("agent.history.title")} · {historyJobs.length}</summary>
            <AgentJobList jobs={historyJobs} limit={40} />
          </details>
        ) : null}
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
  const finished = vm.agentActionPlans
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
