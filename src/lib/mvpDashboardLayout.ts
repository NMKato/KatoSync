// Created by NMKato Solutions
// Deterministic, project-only MVP dashboard ranking. Pure; does not infer completion.
import { sortPortfolio } from "./projectFocus.ts";
import type { RegistryProject } from "../types";

export const MVP_DASHBOARD_TOP_COUNT = 3;

/**
 * Active projects first, P0/P1/P2, then stable name and ID. Parked/archived
 * remain discoverable in the overflow; no hidden boost based on unverified
 * progress claims or untrusted model status notes.
 */
export function partitionMvpDashboard<T extends Pick<RegistryProject, "id" | "name" | "focus">>(projects: readonly T[]) {
  const unique = new Map<string,T>();
  for (const project of projects) {
    if (!unique.has(project.id)) unique.set(project.id,project);
  }
  const ranked = sortPortfolio([...unique.values()]);
  return {
    top: ranked.slice(0,MVP_DASHBOARD_TOP_COUNT),
    rest: ranked.slice(MVP_DASHBOARD_TOP_COUNT)
  };
}
