// Created by NMKato Solutions
// Auto-Lane Planner: macht aus bereits AUSGEWAEHLTEN + FREIGEGEBENEN Action-Tasks autonome, sichtbare
// Arbeit. Rein und deterministisch (keine Laufzeit-Imports, kein Zugriff auf Storage/Prozesse): das
// ViewModel liefert die Eingaben, der Dispatcher startet ausschliesslich `dispatch` ueber den
// bestehenden Runner (runCodexTask). Der Planer genehmigt nie etwas und mergt nie.
import type {
  ActionPlan,
  ActionTask,
  AgentLane,
  AgentNextStep,
  AgentStartSafety,
  AutoLane,
  AutoLaneClaim,
  AutoLaneDispatch,
  AutoLaneExclusion,
  FocusPolicy,
  AutoLanePlan,
  AutoLaneReason,
  AutoLaneRunner,
  AutoLaneState,
  ProviderId
} from "../types";
import { evaluateFocus } from "./projectFocus.ts";

// Takt des Dispatchers bei offener App: begrenzt, kein Busy-Loop.
export const AUTO_LANE_TICK_MS = 15_000;
// Action-Plans (neue Freigaben/Merges) werden im Auto-Modus hoechstens so oft neu geladen.
export const AUTO_LANE_PLAN_REFRESH_MS = 5 * 60 * 1000;
// Der Runner-Zustand (codexRun, Live-Feed) ist heute ein Singleton und startSafety meldet bei jedem
// laufenden Runner `runner_busy`. Der Planer kann mehrere Slots (ein Writer pro Repo) – freigeschaltet
// wird das erst, wenn der Runner mehrere Laeufe getrennt fuehren kann.
export const AUTO_LANE_MAX_CONCURRENT = 1;

export interface AutoLanePlannerInput {
  enabled: boolean;
  actionPlans: ActionPlan[];
  // Ausgewaehlte Task-IDs in Ausfuehrungsreihenfolge (Projekt-Board).
  selectedOrder: string[];
  // projectId -> Repo-/Worktree-Schluessel (nur zum Vergleich, wird nie angezeigt).
  repos: Record<string, string>;
  missingRepos?: string[];
  claims: AutoLaneClaim[];
  // Tasks, die DIESE App-Sitzung gerade wirklich ausfuehrt (Auto, Board-Queue oder Einzel-Lauf).
  inFlightTaskIds: string[];
  // Job-ID einer aktiven Remote-Orchestrator-Lease.
  remoteJobId?: string | null;
  startSafety: AgentStartSafety;
  lanes: AgentLane[];
  preferredRunner?: AutoLaneRunner | string | null;
  providerPriority?: ProviderId[];
  dailyCount: number;
  dailyLimit: number;
  maxConcurrent?: number;
  // Fairness: zuletzt gestartete Projekte kommen spaeter wieder dran (Round-Robin).
  lastDispatchAt?: Record<string, string>;
  // Fokus-Portfolio der Project Registry. Gesetzt = HARTE Grenze VOR Kandidaten-Gruppierung und Ranking:
  // nur aktive, bekannte Projekte mit Auto-Modus != off. Undefined = keine Fokus-Pruefung (Altverhalten).
  focus?: FocusPolicy | null;
}

const TERMINAL_SKIP = new Set<ActionTask["status"]>(["completed", "rejected", "deferred"]);
// Diese Task-Stati sind endgueltig genug, dass ein uebrig gebliebener Claim freigegeben werden darf.
const CLAIM_RESOLVED = new Set<ActionTask["status"]>(["completed", "rejected", "deferred", "executed", "failed"]);

const NEXT: Record<AutoLaneReason, AgentNextStep | null> = {
  auto_off: "enable_auto_mode",
  ready: "start_when_safe",
  runner_slot: "await_writer",
  repo_busy: "await_worktree",
  start_unsafe: "await_writer",
  no_runner_lane: "await_provider_reset",
  daily_limit: "await_daily_reset",
  merge_pending: "review_merge",
  orchestrator_owned: "await_event",
  active: "await_event",
  head_failed: "inspect_evidence",
  interrupted_run: "inspect_evidence",
  manual_gate: "resolve_gate",
  approval_required: "approve_plan",
  repo_unmapped: "map_repo",
  repo_missing: "map_repo"
};

export function emptyAutoLanePlan(enabled = false, maxConcurrent = AUTO_LANE_MAX_CONCURRENT): AutoLanePlan {
  return {
    enabled,
    lanes: [],
    dispatch: [],
    counts: { planned: 0, queued: 0, running: 0, waiting: 0, blocked: 0 },
    maxConcurrent,
    excluded: [],
    merge: { mode: "manual", reason: "no_verified_merge_mechanism" }
  };
}

export function autoLaneId(projectId: string): string {
  return `auto:${projectId}`;
}

/** Nur lokal ausfuehrbare Runner-Tasks bilden Auto-Lanes (wie die manuelle Board-Queue). */
function runnable(task: ActionTask): boolean {
  return task.targetRunner === "codex_cli";
}

/**
 * Runner-Routing: bevorzugter Runner zuerst, dann der andere CLI-Runner in Nutzerprioritaet – aber
 * nur, wenn seine Lane jetzt wirklich uebernehmen darf (Provider verbunden + verfuegbar). Das ist der
 * bestehende Failover-Vertrag fuer Quota/Auth/Kapazitaet; ein Jobfehler wechselt nie den Runner.
 */
export function pickAutoLaneRunner(
  lanes: AgentLane[],
  preferred: AutoLaneRunner | string | null | undefined,
  priority: ProviderId[] = []
): AutoLaneRunner | null {
  const first: AutoLaneRunner = preferred === "claude_cli" ? "claude_cli" : "codex_cli";
  const second: AutoLaneRunner = first === "codex_cli" ? "claude_cli" : "codex_cli";
  const lane = (runner: AutoLaneRunner) => (runner === "codex_cli" ? "codex" : "claude");
  const secondAllowed = priority.length === 0 || priority.includes(lane(second));
  for (const runner of secondAllowed ? [first, second] : [first]) {
    if (lanes.find((entry) => entry.id === lane(runner))?.eligible) return runner;
  }
  return null;
}

function earliestRetry(lanes: AgentLane[]): string | null {
  const values = lanes
    .filter((lane) => lane.id === "codex" || lane.id === "claude")
    .map((lane) => lane.retryAt)
    .filter((value): value is string => Boolean(value) && !Number.isNaN(Date.parse(value as string)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return values[0] ?? null;
}

interface LaneDraft {
  projectId: string;
  head: ActionTask;
  planId: string;
  taskIds: string[];
  // Projektbedingte Zustaende stehen fest; null = Kopf-Task ist ausfuehrbar, globale Gates folgen.
  fixed: { state: AutoLaneState; reason: AutoLaneReason } | null;
}

interface Drafted {
  drafts: LaneDraft[];
  excluded: AutoLaneExclusion[];
}

function draftLanes(input: AutoLanePlannerInput): Drafted {
  const excludedBy = new Map<string, AutoLaneExclusion>();
  const order = new Map(input.selectedOrder.map((id, index) => [id, index]));
  const live = new Set(input.inFlightTaskIds);
  const claimed = new Set(input.claims.map((claim) => claim.taskId));
  const byProject = new Map<string, Array<{ task: ActionTask; plan: ActionPlan }>>();
  for (const plan of input.actionPlans) {
    for (const task of plan.tasks) {
      if (!order.has(task.taskId) || !runnable(task) || TERMINAL_SKIP.has(task.status)) continue;
      // Fokus-Gate vor Gruppierung/Ranking: ausgeschlossene Tasks bilden keine Lane und keine Empfehlung.
      if (input.focus) {
        const decision = evaluateFocus(input.focus, task.projectId);
        if (!decision.allowed && decision.reason) {
          const projectId = decision.canonicalId ?? task.projectId;
          const key = `${projectId}\u0000${decision.reason}`;
          const entry = excludedBy.get(key) ?? { projectId, reason: decision.reason, taskIds: [] };
          entry.taskIds.push(task.taskId);
          excludedBy.set(key, entry);
          continue;
        }
      }
      const bucket = byProject.get(task.projectId) ?? [];
      bucket.push({ task, plan });
      byProject.set(task.projectId, bucket);
    }
  }
  const drafts: LaneDraft[] = [];
  for (const [projectId, entries] of byProject) {
    entries.sort((a, b) => (order.get(a.task.taskId) ?? 0) - (order.get(b.task.taskId) ?? 0));
    // Deterministische Projektreihenfolge: der erste offene Task besitzt die Lane, alle spaeteren warten.
    const { task: head, plan } = entries[0];
    let fixed: LaneDraft["fixed"] = null;
    if (live.has(head.taskId)) fixed = { state: "running", reason: "active" };
    else if (input.remoteJobId && input.remoteJobId === head.taskId) fixed = { state: "running", reason: "orchestrator_owned" };
    else if (head.status === "executed") fixed = { state: "waiting", reason: "merge_pending" };
    else if (head.status === "failed") fixed = { state: "blocked", reason: "head_failed" };
    // Claim ohne laufenden Besitzer oder "running" ohne Lauf in dieser Sitzung: nie still neu starten.
    else if (head.status === "running" || claimed.has(head.taskId)) fixed = { state: "blocked", reason: "interrupted_run" };
    // Nie automatisch freigeben: ungeklaerte Freigabe oder kritisches Risiko sperrt die Projektreihenfolge.
    else if (plan.status !== "approved") fixed = { state: "blocked", reason: "approval_required" };
    else if (head.riskLevel === "critical") fixed = { state: "blocked", reason: "manual_gate" };
    else if (!input.repos[projectId]) fixed = { state: "blocked", reason: "repo_unmapped" };
    else if (input.missingRepos?.includes(projectId)) fixed = { state: "blocked", reason: "repo_missing" };
    drafts.push({ projectId, head, planId: plan.planId, taskIds: entries.map((entry) => entry.task.taskId), fixed });
  }
  const excluded = [...excludedBy.values()].sort((a, b) => a.projectId.localeCompare(b.projectId) || a.reason.localeCompare(b.reason));
  return { drafts, excluded };
}

export function planAutoLanes(input: AutoLanePlannerInput): AutoLanePlan {
  const maxConcurrent = Math.max(1, Math.floor(input.maxConcurrent ?? AUTO_LANE_MAX_CONCURRENT));
  const plan = emptyAutoLanePlan(input.enabled, maxConcurrent);
  const { drafts, excluded } = draftLanes(input);
  plan.excluded = excluded;
  const lanes = new Map<string, AutoLane>();
  const make = (draft: LaneDraft, state: AutoLaneState, reason: AutoLaneReason, extra: Partial<AutoLane> = {}): AutoLane => ({
    id: autoLaneId(draft.projectId),
    projectId: draft.projectId,
    state,
    reason,
    detail: null,
    headTaskId: draft.head.taskId,
    headTitle: draft.head.title,
    runner: null,
    nextStep: NEXT[reason],
    taskIds: draft.taskIds,
    pendingCount: draft.taskIds.length,
    retryAt: null,
    ...extra
  });

  for (const draft of drafts) {
    if (draft.fixed) lanes.set(draft.projectId, make(draft, draft.fixed.state, draft.fixed.reason));
  }

  // Belegte Repos: laufende Lanes + alle Claims (auch verwaiste) -> nie zwei Writer im selben Repo.
  const busyRepos = new Set<string>(input.claims.map((claim) => claim.repoKey));
  for (const lane of lanes.values()) {
    if (lane.state === "running" && input.repos[lane.projectId]) busyRepos.add(input.repos[lane.projectId]);
  }
  let slots = Math.max(0, maxConcurrent - new Set(input.inFlightTaskIds).size);

  const ready = drafts
    .filter((draft) => !draft.fixed)
    .sort((a, b) => {
      const at = (projectId: string) => Date.parse(input.lastDispatchAt?.[projectId] ?? "") || 0;
      return at(a.projectId) - at(b.projectId) || a.projectId.localeCompare(b.projectId);
    });
  const runner = pickAutoLaneRunner(input.lanes, input.preferredRunner, input.providerPriority);
  const dailyExhausted = input.dailyCount >= input.dailyLimit;
  for (const draft of ready) {
    if (!input.enabled) {
      lanes.set(draft.projectId, make(draft, "planned", "auto_off"));
      continue;
    }
    if (!runner) {
      lanes.set(draft.projectId, make(draft, "waiting", "no_runner_lane", { retryAt: earliestRetry(input.lanes) }));
      continue;
    }
    if (dailyExhausted) {
      lanes.set(draft.projectId, make(draft, "waiting", "daily_limit", { runner }));
      continue;
    }
    const repo = input.repos[draft.projectId];
    if (busyRepos.has(repo)) {
      lanes.set(draft.projectId, make(draft, "queued", "repo_busy", { runner }));
      continue;
    }
    if (!input.startSafety.safe) {
      // Ein laufender Runner ist ein belegter Slot (gleich geht es weiter); alles andere ist ein
      // externes Gate (Lease, Handoff, Local-Control-Writer, keine Lane).
      lanes.set(
        draft.projectId,
        input.startSafety.reason === "runner_busy"
          ? make(draft, "queued", "runner_slot", { runner })
          : make(draft, "waiting", "start_unsafe", { runner, detail: input.startSafety.reason })
      );
      continue;
    }
    if (slots <= 0) {
      lanes.set(draft.projectId, make(draft, "queued", "runner_slot", { runner }));
      continue;
    }
    slots -= 1;
    busyRepos.add(repo);
    const lane = make(draft, "queued", "ready", { runner });
    lanes.set(draft.projectId, lane);
    plan.dispatch.push({ laneId: lane.id, projectId: draft.projectId, taskId: draft.head.taskId, planId: draft.planId, runner });
  }

  const rank: Record<AutoLaneState, number> = { running: 0, queued: 1, waiting: 2, blocked: 3, planned: 4 };
  plan.lanes = [...lanes.values()].sort((a, b) => rank[a.state] - rank[b.state] || a.projectId.localeCompare(b.projectId));
  for (const lane of plan.lanes) plan.counts[lane.state] += 1;
  return plan;
}

// ===== Claim-Ledger (rein; Persistenz liegt im ViewModel) =====
export function addAutoLaneClaim(claims: AutoLaneClaim[], claim: AutoLaneClaim): AutoLaneClaim[] {
  return claims.some((entry) => entry.taskId === claim.taskId) ? claims : [...claims, claim];
}

export function releaseAutoLaneClaim(claims: AutoLaneClaim[], taskId: string): AutoLaneClaim[] {
  return claims.filter((entry) => entry.taskId !== taskId);
}

/** Claims, deren Task inzwischen einen eindeutigen Endstatus hat oder verschwunden ist, sind erledigt. */
export function pruneAutoLaneClaims(claims: AutoLaneClaim[], plans: ActionPlan[]): AutoLaneClaim[] {
  if (!plans.length) return claims;
  const status = new Map(plans.flatMap((plan) => plan.tasks.map((task) => [task.taskId, task.status] as const)));
  return claims.filter((claim) => {
    const current = status.get(claim.taskId);
    return current !== undefined && !CLAIM_RESOLVED.has(current);
  });
}
