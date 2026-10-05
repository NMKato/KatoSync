// Created by NMKato Solutions
// Project Work Sync / AutoQ: local-first bridge from verified Project Registry truth into Auto-Lanes.
// Never reads legacy MCP selection state and never auto-approves human gates.
import type {
  ActionPlan,
  ActionTask,
  ActionTaskStatus,
  ProjectRegistry,
  RegistryProject,
  VerificationState
} from "../types";

export const PROJECT_WORK_SOURCE = "project_registry_autoq";
export const PROJECT_WORK_STORE_KEY = "katosync.projectWork.plans.v1";

export type ProjectWorkGate =
  | "manual_project"
  | "human_gate"
  | "docs_mismatch"
  | "review_pending"
  | "worktree_dirty"
  | "worktree_unmapped"
  | "no_next_work";

export interface ProjectWorkProjectResult {
  projectId: string;
  name: string;
  priority: string;
  ready: number;
  gated: boolean;
  gate: ProjectWorkGate | null;
  detail: string | null;
}

export interface ProjectWorkSyncReport {
  generatedAt: string;
  readyCount: number;
  gatedCount: number;
  emptyCount: number;
  projects: ProjectWorkProjectResult[];
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function taskType(title: string): ActionTask["taskType"] {
  const value = title.toLowerCase();
  if (/dokument|status|handoff|readme|docs?\b/.test(value)) return "document_task";
  if (/recherch|research|prüf|analyse|analys/.test(value)) return "research_task";
  return "code_task";
}

function terminal(status: ActionTaskStatus): boolean {
  return status === "completed" || status === "rejected" || status === "deferred";
}

function previousTaskStatus(previous: ActionPlan[], taskId: string): ActionTask | null {
  for (const plan of previous) {
    const task = plan.tasks.find((entry) => entry.taskId === taskId);
    if (task) return task;
  }
  return null;
}

function verificationGate(project: RegistryProject): ProjectWorkGate | null {
  const findings = project.verification?.findings ?? [];
  if (findings.some((finding) => !finding.resolved && finding.state === "human_gate")) return "human_gate";
  if (findings.some((finding) => !finding.resolved && finding.state === "docs_mismatch")) return "docs_mismatch";
  if (findings.some((finding) => !finding.resolved && finding.state === "review_pending")) return "review_pending";
  return null;
}

function mappedWorktreeGate(project: RegistryProject, mappedPath: string | undefined): ProjectWorkGate | null {
  if (!mappedPath) return "worktree_unmapped";
  const worktree = project.scan?.worktrees.find((entry) => entry.path === mappedPath);
  if (worktree && (worktree.dirtyCount ?? 0) > 0) return "worktree_dirty";
  if (mappedPath === project.rootPath && (project.scan?.dirtyCount ?? 0) > 0) return "worktree_dirty";
  return null;
}

function gateDetail(gate: ProjectWorkGate, project: RegistryProject): string {
  switch (gate) {
    case "manual_project":
      return "Projekt steht auf manuell.";
    case "human_gate":
      return "Human Gate muss zuerst aufgelöst werden.";
    case "docs_mismatch":
      return "Dokumentation und Code widersprechen sich.";
    case "review_pending":
      return "Review/Freigabe ist noch offen.";
    case "worktree_dirty":
      return "Gewählter Arbeitsordner hat lokale Änderungen.";
    case "worktree_unmapped":
      return "Noch kein Arbeitsordner/Target festgelegt.";
    case "no_next_work":
      return project.capsule ? "Keine explizite Next-Safe-Work-Aufgabe dokumentiert." : "Projekt noch nicht vollständig geprüft.";
  }
}

export function buildProjectWorkSync(
  registry: ProjectRegistry,
  projectRepos: Record<string, string> | undefined,
  previousPlans: ActionPlan[],
  now = new Date().toISOString()
): { plans: ActionPlan[]; selectedTaskIds: string[]; report: ProjectWorkSyncReport } {
  const plans: ActionPlan[] = [];
  const selectedTaskIds: string[] = [];
  const results: ProjectWorkProjectResult[] = [];

  const projects = [...registry.projects].sort(
    (a, b) => a.focus.priority.localeCompare(b.focus.priority) || a.name.localeCompare(b.name)
  );

  for (const project of projects) {
    if (project.focus.status !== "active") continue;

    let gate: ProjectWorkGate | null = null;
    if (project.focus.autoMode === "off") gate = "manual_project";
    if (!gate) gate = verificationGate(project);
    if (!gate) gate = mappedWorktreeGate(project, projectRepos?.[project.id]);

    const next = (project.capsule?.nextSafeWork ?? []).map((item) => item.trim()).filter(Boolean);
    if (!gate && next.length === 0) gate = "no_next_work";

    if (gate) {
      results.push({
        projectId: project.id,
        name: project.name,
        priority: project.focus.priority,
        ready: 0,
        gated: gate !== "no_next_work" && gate !== "manual_project",
        gate,
        detail: gateDetail(gate, project)
      });
      continue;
    }

    const tasks: ActionTask[] = next.slice(0, 6).map((title, index) => {
      const taskId = `autoq:${project.id}:${hashText(title)}`;
      const previous = previousTaskStatus(previousPlans, taskId);
      return {
        taskId,
        priority: index + 1,
        projectId: project.id,
        title,
        taskType: taskType(title),
        targetRunner: "codex_cli",
        riskLevel: "medium",
        requiresApproval: false,
        status: previous?.status ?? "pending",
        prUrl: previous?.prUrl ?? null,
        branch: previous?.branch ?? null,
        summary: previous?.summary ?? `AutoQ · ${project.name} · aus verifiziertem Project Context Capsule`
      };
    });

    const open = tasks.filter((task) => !terminal(task.status));
    if (open.length) {
      plans.push({
        planId: `autoq:${project.id}`,
        source: PROJECT_WORK_SOURCE,
        agentName: "KatoSync AutoQ",
        createdAt: now,
        status: "approved",
        executionMode: "sequential",
        dailyLimit: 20,
        riskLevel: "medium",
        requiresUserReview: false,
        tasks
      });
      selectedTaskIds.push(...open.map((task) => task.taskId));
    }
    results.push({
      projectId: project.id,
      name: project.name,
      priority: project.focus.priority,
      ready: open.length,
      gated: false,
      gate: null,
      detail: open.length ? null : "Alle bekannten AutoQ-Aufgaben sind bereits abgeschlossen/zurückgestellt."
    });
  }

  return {
    plans,
    selectedTaskIds,
    report: {
      generatedAt: now,
      readyCount: selectedTaskIds.length,
      gatedCount: results.filter((entry) => entry.gated).length,
      emptyCount: results.filter((entry) => entry.gate === "no_next_work").length,
      projects: results
    }
  };
}

export function readProjectWorkPlans(): ActionPlan[] {
  try {
    const raw = localStorage.getItem(PROJECT_WORK_STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ActionPlan[];
    return Array.isArray(parsed) ? parsed.filter((plan) => plan.source === PROJECT_WORK_SOURCE) : [];
  } catch {
    return [];
  }
}

export function writeProjectWorkPlans(plans: ActionPlan[]): void {
  try {
    localStorage.setItem(PROJECT_WORK_STORE_KEY, JSON.stringify(plans.filter((plan) => plan.source === PROJECT_WORK_SOURCE)));
  } catch {
    // Browser-/Demo-Modus kann Storage verweigern.
  }
}

export function updateProjectWorkTask(
  plans: ActionPlan[],
  taskId: string,
  status: ActionTaskStatus,
  extra?: { prUrl?: string | null; branch?: string | null; summary?: string | null }
): ActionPlan[] {
  return plans.map((plan) => ({
    ...plan,
    tasks: plan.tasks.map((task) =>
      task.taskId === taskId
        ? {
            ...task,
            status,
            prUrl: extra?.prUrl ?? task.prUrl ?? null,
            branch: extra?.branch ?? task.branch ?? null,
            summary: extra?.summary ?? task.summary ?? null
          }
        : task
    )
  }));
}

export function isProjectWorkPlan(plan: ActionPlan | undefined | null): boolean {
  return plan?.source === PROJECT_WORK_SOURCE;
}
