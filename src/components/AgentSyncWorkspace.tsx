// Created by NMKato Solutions
// Agent-Sync-Workspace: eigenes Cockpit, Jobs & Queue sowie Verlauf & Nachweise. Reine View –
// Zustand kommt ausschliesslich aus dem ViewModel; Ableitungen liegen testbar in lib/agentSyncCockpit.ts.
// Bewegung erklaert Arbeit (Fluss zur aktiven Lane, laufende Jobs) und entfaellt bei reduced motion.
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Calculator,
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
import { balancedOption, bestFitOption, cheapestKnownOption, estimateProject, fastestOption } from "../lib/apiCostPlanner";
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
import type { ActionTask, ProviderId } from "../types";
import type { StepId, useKatoSyncViewModel } from "../viewmodels/useKatoSyncViewModel";

type ViewModel = ReturnType<typeof useKatoSyncViewModel>;
type Navigate = (step: StepId) => void;

const modelProviders: ProviderId[] = ["codex", "claude", "api", "local"];

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
  const approvalPlans = vm.actionPlans.filter(
    (plan) => plan.status === "pending_user_review" || plan.status === "in_review"
  );
  const reviewJobs = state.jobs.filter(
    (job) => job.status === "implemented" || job.status === "review_ready" || job.status === "human_gate"
  );

  return (
    <section className="agent-dashboard" id="section-agent-dashboard">
      <ControlTower state={state} />

      <AutoLanePanel
        busy={Boolean(vm.busy)}
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

function formatEstimateUsd(value: number | null): string {
  if (value == null) return "—";
  if (value > 0 && value < 0.001) return "< $0.001";
  return `$${value.toFixed(value < 0.1 ? 3 : 2)}`;
}

function ProjectCostPlanner({ vm }: { vm: ViewModel }) {
  const { t } = useT();
  const configuredApis = vm.apiProviders.filter((connection) => connection.enabled && connection.model.trim());
  const taskGroups = new Map<string, ActionTask[]>();

  vm.actionPlans
    .flatMap((plan) => plan.tasks)
    .filter((task) => !["completed", "rejected", "failed", "deferred"].includes(task.status))
    .forEach((task) => {
      const current = taskGroups.get(task.projectId) ?? [];
      current.push(task);
      taskGroups.set(task.projectId, current);
    });

  if (!taskGroups.size) return null;

  return (
    <div className="glass agent-card api-cost-planner">
      <CardTitle icon={<Calculator size={17} />} title={t("agent.cost.title")} />
      <p className="agent-route-note">{t("agent.cost.note")}</p>
      {!configuredApis.length ? (
        <div className="api-cost-empty">
          <strong>{t("agent.cost.noApis")}</strong>
          <span>{t("agent.cost.noApisHint")}</span>
        </div>
      ) : (
        <div className="api-cost-projects">
          {[...taskGroups.entries()].map(([projectId, tasks]) => {
            const estimate = estimateProject(projectId, tasks, configuredApis);
            const best = bestFitOption(estimate);
            const cheapest = cheapestKnownOption(estimate);
            const fastest = fastestOption(estimate);
            const balanced = balancedOption(estimate);
            const preferredId = vm.apiProjectPreferences[projectId] ?? "";
            return (
              <section className="api-cost-project" key={projectId}>
                <header>
                  <div>
                    <span>{projectId === NO_PROJECT_ID ? t("agent.jobs.noProject") : projectId}</span>
                    <strong>{t("agent.cost.tasks", { count: tasks.length })}</strong>
                  </div>
                  <label>
                    {t("agent.cost.projectChoice")}
                    <select
                      onChange={(event) =>
                        void vm.handleSetProjectApiPreference(projectId, event.target.value || null)
                      }
                      value={preferredId}
                    >
                      <option value="">{t("agent.cost.auto")}</option>
                      {configuredApis.map((connection) => (
                        <option key={connection.id} value={connection.id}>
                          {connection.label || connection.model} · {connection.model}
                        </option>
                      ))}
                    </select>
                  </label>
                </header>

                <div className="api-cost-summary">
                  <span>
                    <small>{t("agent.cost.balanced")}</small>
                    <strong>{balanced ? `${balanced.model} · ${formatEstimateUsd(balanced.estimatedCostUsd)}` : "—"}</strong>
                  </span>
                  <span>
                    <small>{t("agent.cost.bestFit")}</small>
                    <strong>{best ? `${best.model} · ${best.fit}%` : "—"}</strong>
                  </span>
                  <span>
                    <small>{t("agent.cost.fastest")}</small>
                    <strong>{fastest ? fastest.model : "—"}</strong>
                  </span>
                  <span>
                    <small>{t("agent.cost.lowest")}</small>
                    <strong>{cheapest ? formatEstimateUsd(cheapest.estimatedCostUsd) : "—"}</strong>
                  </span>
                  <span>
                    <small>{t("agent.cost.variableOnly")}</small>
                    <strong>{t("agent.cost.subscriptionsSeparate")}</strong>
                  </span>
                </div>

                <div className="api-cost-options" role="table" aria-label={t("agent.cost.compare")}>
                  {estimate.options.map((option) => (
                    <div
                      className={`api-cost-option${preferredId === option.connectionId ? " selected" : ""}${option.supported ? "" : " weak"}`}
                      key={option.connectionId}
                      role="row"
                    >
                      <div>
                        <strong>{option.model}</strong>
                        <small>{option.providerLabel}</small>
                      </div>
                      <span>
                        <small>{t("agent.cost.fit")}</small>
                        <strong>{option.fit}%</strong>
                      </span>
                      <span>
                        <small>{t("agent.cost.effort")}</small>
                        <strong>{option.effort}</strong>
                      </span>
                      <span>
                        <small>{t("agent.cost.speed")}</small>
                        <strong>{t(`providers.api.speed.${option.speed}` as TKey)}</strong>
                      </span>
                      <span>
                        <small>{t("agent.cost.estimate")}</small>
                        <strong>{formatEstimateUsd(option.estimatedCostUsd)}</strong>
                      </span>
                    </div>
                  ))}
                </div>

                <details className="api-task-costs">
                  <summary>{t("agent.cost.taskBreakdown")}</summary>
                  <div className="api-task-cost-list">
                    {estimate.taskPlans.map((taskPlan) => (
                      <article className="api-task-cost" key={taskPlan.task.taskId}>
                        <div>
                          <strong>{taskPlan.task.title}</strong>
                          <small>
                            {taskPlan.task.required.join(" · ")} · ~{Math.round((taskPlan.task.inputTokens + taskPlan.task.outputTokens) / 1000)}k tokens
                          </small>
                        </div>
                        <span>
                          <small>{t("agent.cost.balanced")}</small>
                          <strong>
                            {taskPlan.balanced
                              ? `${taskPlan.balanced.model} · ${formatEstimateUsd(taskPlan.balanced.estimatedCostUsd)}`
                              : "—"}
                          </strong>
                        </span>
                        <span>
                          <small>{t("agent.cost.lowest")}</small>
                          <strong>
                            {taskPlan.cheapest
                              ? `${taskPlan.cheapest.model} · ${formatEstimateUsd(taskPlan.cheapest.estimatedCostUsd)}`
                              : "—"}
                          </strong>
                        </span>
                        <span>
                          <small>{t("agent.cost.bestFit")}</small>
                          <strong>{taskPlan.bestFit ? `${taskPlan.bestFit.model} · ${taskPlan.bestFit.fit}%` : "—"}</strong>
                        </span>
                      </article>
                    ))}
                  </div>
                </details>

                <p className="api-cost-disclaimer">{t("agent.cost.disclaimer")}</p>
              </section>
            );
          })}
        </div>
      )}
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

      <AutoLanePanel
        busy={Boolean(vm.busy)}
        onRelease={(taskId) => void vm.handleReleaseAutoLane(taskId)}
        onToggle={vm.handleSetAutoMode}
        plan={state.autoLanes}
      />

      <ProjectCostPlanner vm={vm} />

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
