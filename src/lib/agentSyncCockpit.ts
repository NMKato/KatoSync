// Created by NMKato Solutions
// Daten-Adapter fuer das Agent-Sync-Cockpit. Leitet ausschliesslich aus echtem Zustand ab
// (Provider-Status, Local-Control-Snapshot, Runner-Lauf, Action-Tasks). Keine Mock-Daten und
// keine erfundenen Prozentwerte fuer offene Agentenarbeit: nur Zaehler, Zustaende, Zeitpunkte.
// Bewusst ohne Laufzeit-Imports, damit die Node-Tests die Datei direkt laden koennen.
import type {
  ActionPlan,
  ActionTask,
  LocalControlJobSummary,
  LocalControlMonitorSnapshot,
  ProviderDisplayState,
  ProviderId
} from "../types";

// ===== Local Control =====
export type LocalControlHealth = "unknown" | "offline" | "stale" | "idle" | "busy";

// Der Daemon schreibt state.json in jeder Schleife (Sub-Sekunden-Takt). Bleibt der Heartbeat
// laenger aus, laeuft er sehr wahrscheinlich nicht mehr -> "veraltet" statt "bereit".
export const LOCAL_CONTROL_STALE_MS = 30_000;

export function localControlHealth(
  snapshot: LocalControlMonitorSnapshot | null,
  nowMs = Date.now(),
  staleMs = LOCAL_CONTROL_STALE_MS
): LocalControlHealth {
  if (!snapshot) return "unknown";
  if (!snapshot.available || !snapshot.state) return "offline";
  const heartbeat = Date.parse(snapshot.state.heartbeatAt);
  if (Number.isNaN(heartbeat) || nowMs - heartbeat > staleMs) return "stale";
  return snapshot.state.status === "busy" || snapshot.state.currentJobId ? "busy" : "idle";
}

// ===== Bereitschaft (was ist wirklich bereit?) =====
export interface ProviderHealthInput {
  provider: ProviderId;
  display: ProviderDisplayState;
  connected: boolean;
}

export type AttentionItem =
  | { kind: "provider"; provider: ProviderId; display: ProviderDisplayState; tone: "warn" | "danger" }
  | { kind: "noProvider"; tone: "warn" }
  | { kind: "localControl"; health: LocalControlHealth; tone: "warn" }
  | { kind: "runnerFailed"; tone: "danger" };

export interface AgentReadiness {
  connected: ProviderId[];
  total: number;
  localControl: LocalControlHealth;
  activeJobs: number;
  attention: AttentionItem[];
}

const ATTENTION_DISPLAY: Partial<Record<ProviderDisplayState, "warn" | "danger">> = {
  reauth: "danger",
  offline: "danger",
  unavailable: "danger",
  quota: "warn",
  testRequired: "warn"
};

export function agentReadiness(input: {
  providers: ProviderHealthInput[];
  localControl: LocalControlHealth;
  runnerActive: boolean;
  runnerFailed: boolean;
}): AgentReadiness {
  // Local Control ist der deterministische Fallback-Pfad, kein Modell-Provider -> separat gezaehlt.
  const providers = input.providers.filter((entry) => entry.provider !== "local_control");
  // "Verbunden" beschreibt die echte Verbindung/Auth zum Provider, nicht die momentane
  // Ausführbarkeit. Ein authentifizierter Provider bleibt deshalb bei Quota-/Kapazitätslimit
  // verbunden, auch wenn KatoSync die aktive Lane vorübergehend an den nächsten Provider gibt.
  const connected = providers.filter((entry) => entry.connected).map((entry) => entry.provider);
  const attention: AttentionItem[] = [];
  for (const entry of providers) {
    const tone = ATTENTION_DISPLAY[entry.display];
    if (tone) attention.push({ kind: "provider", provider: entry.provider, display: entry.display, tone });
  }
  if (providers.length && !connected.length) attention.push({ kind: "noProvider", tone: "warn" });
  if (input.localControl === "offline" || input.localControl === "stale") {
    attention.push({ kind: "localControl", health: input.localControl, tone: "warn" });
  }
  if (input.runnerFailed) attention.push({ kind: "runnerFailed", tone: "danger" });
  return {
    connected,
    total: providers.length,
    localControl: input.localControl,
    activeJobs: (input.runnerActive ? 1 : 0) + (input.localControl === "busy" ? 1 : 0),
    attention
  };
}

// ===== Lanes =====
export type LaneState = "active" | "idle" | "failed" | "offline" | "unknown";

export function runnerLaneState(status: "idle" | "running" | "completed" | "failed"): LaneState {
  if (status === "running") return "active";
  if (status === "failed") return "failed";
  return "idle";
}

export function localControlLaneState(health: LocalControlHealth): LaneState {
  if (health === "busy") return "active";
  if (health === "idle") return "idle";
  if (health === "unknown") return "unknown";
  return "offline";
}

// ===== Jobs & Queue (lokal ausfuehrbare Runner-Aufgaben) =====
export type JobStage =
  | "awaitingApproval"
  | "queued"
  | "running"
  | "executed"
  | "completed"
  | "deferred"
  | "failed";

export const JOB_FLOW_STAGES: JobStage[] = ["awaitingApproval", "queued", "running", "executed", "completed"];

export interface RunnerJob {
  task: ActionTask;
  plan: ActionPlan;
  stage: JobStage;
}

// Nur codex_cli ist lokal ausfuehrbar (siehe Board-Queue); alle anderen Runner sind keine Agent-Sync-Jobs.
export function jobStage(task: ActionTask, plan: ActionPlan, currentTaskId: string | null): JobStage | null {
  if (task.taskId === currentTaskId || task.status === "running") return "running";
  switch (task.status) {
    case "executed":
      return "executed";
    case "completed":
      return "completed";
    case "deferred":
      return "deferred";
    case "failed":
      return "failed";
    case "rejected":
      return null;
    default:
      if (plan.status === "approved" || plan.status === "running") return "queued";
      if (plan.status === "pending_user_review" || plan.status === "in_review") return "awaitingApproval";
      return null;
  }
}

export function runnerJobs(plans: ActionPlan[], currentTaskId: string | null): RunnerJob[] {
  const jobs: RunnerJob[] = [];
  for (const plan of plans) {
    for (const task of plan.tasks) {
      if (task.targetRunner !== "codex_cli") continue;
      const stage = jobStage(task, plan, currentTaskId);
      if (stage) jobs.push({ task, plan, stage });
    }
  }
  return jobs;
}

export function jobStageCounts(jobs: RunnerJob[]): Record<JobStage, number> {
  const counts: Record<JobStage, number> = {
    awaitingApproval: 0,
    queued: 0,
    running: 0,
    executed: 0,
    completed: 0,
    deferred: 0,
    failed: 0
  };
  for (const job of jobs) counts[job.stage] += 1;
  return counts;
}

// ===== Lane-Uebergaben (in dieser Sitzung beobachtet) =====
export interface LaneHandoff {
  from: ProviderId;
  to: ProviderId;
  at: string;
}

export interface OwnerTrack {
  owner: ProviderId | null;
  handoffs: LaneHandoff[];
}

/**
 * Merkt sich Wechsel des Lane-Besitzers. `owner = null` heisst "noch kein Provider-Snapshot":
 * die erste echte Bestimmung ist eine Basislinie, keine Uebergabe.
 */
export function trackOwner(previous: OwnerTrack, owner: ProviderId | null, at: string, limit = 12): OwnerTrack {
  if (owner === null || owner === previous.owner) return previous;
  if (previous.owner === null) return { owner, handoffs: previous.handoffs };
  return {
    owner,
    handoffs: [...previous.handoffs, { from: previous.owner, to: owner, at }].slice(-limit)
  };
}

// ===== Local-Control-Aktivitaet =====
export interface JobBar {
  id: string;
  command: string;
  status: string;
  durationMs: number;
  finishedAt: string;
  // Relative Hoehe zur laengsten Dauer im Fenster (Darstellung, keine Fortschrittsangabe).
  ratio: number;
}

export function localJobBars(jobs: LocalControlJobSummary[], limit = 16): JobBar[] {
  const recent = [...jobs]
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
    .slice(0, limit)
    .reverse();
  const max = Math.max(1, ...recent.map((job) => job.durationMs));
  return recent.map((job) => ({
    id: job.id,
    command: job.command,
    status: job.status,
    durationMs: job.durationMs,
    finishedAt: job.finishedAt,
    ratio: Math.max(0.08, Math.min(1, job.durationMs / max))
  }));
}
