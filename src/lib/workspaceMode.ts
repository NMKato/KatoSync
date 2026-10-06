// Created by NMKato Solutions
// Root-Modus: KatoSync startet ueber ein Gateway in genau einen Workspace (Mistral Mode oder
// Agent Sync). Beide haben eigene Navigationsbaeume; gemeinsame Dienste bleiben im ViewModel.
// Reine Funktionen ohne Seiteneffekte ausser dem explizit uebergebenen Storage.
import type { StepId } from "../viewmodels/useKatoSyncViewModel";

export type WorkspaceMode = "mistral" | "agentSync";

export const WORKSPACE_MODE_KEY = "katosync.workspace.mode";

export const MISTRAL_STEPS: StepId[] = ["dashboard", "projectBoard", "briefings", "settings", "logs"];

export const AGENT_SYNC_STEPS: StepId[] = [
  "agentDashboard",
  "agentJobs",
  "agentProviders",
  "agentMonitor",
  "agentProjects",
  "agentHistory",
  "agentSettings"
];

export function parseWorkspaceMode(value: string | null | undefined): WorkspaceMode | null {
  return value === "mistral" || value === "agentSync" ? value : null;
}

export function readRememberedMode(storage: Pick<Storage, "getItem">): WorkspaceMode | null {
  try {
    return parseWorkspaceMode(storage.getItem(WORKSPACE_MODE_KEY));
  } catch {
    return null;
  }
}

export function rememberMode(storage: Pick<Storage, "setItem">, mode: WorkspaceMode): void {
  try {
    storage.setItem(WORKSPACE_MODE_KEY, mode);
  } catch {
    // localStorage nicht verfuegbar -> Modus gilt nur fuer diese Sitzung.
  }
}

export function defaultStepForMode(mode: WorkspaceMode): StepId {
  return mode === "agentSync" ? "agentDashboard" : "dashboard";
}

/** Workspace, zu dem ein Schritt gehoert. Versteckte Setup-Schritte (api, folders …) sind Mistral. */
export function modeForStep(step: StepId): WorkspaceMode {
  return AGENT_SYNC_STEPS.includes(step) ? "agentSync" : "mistral";
}

/** Haelt die Navigation im aktiven Workspace: fremde Schritte fallen auf dessen Startseite zurueck. */
export function stepForMode(step: StepId, mode: WorkspaceMode): StepId {
  return modeForStep(step) === mode ? step : defaultStepForMode(mode);
}
