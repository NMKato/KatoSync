// Created by NMKato Solutions
// Repository/Adapter der Project Registry: Tauri-Commands (Ordner-Dialog, Git-/Datei-Scan, Persistenz).
// Alle Scans sind READ-ONLY (siehe src-tauri/src/project_registry.rs). Im Browser-Demo gibt es keinen
// Dateisystemzugriff: Registry-Zustand liegt dort in localStorage, Scans melden das ehrlich.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { DiscoveryResult, ProjectProbe } from "../types";

const isTauri = () => Boolean(window.__TAURI_INTERNALS__);
const MOCK_KEY = "katosync.projectRegistry.v1";

export type ProjectFolderKind = "project" | "workspace";

export class DesktopOnlyError extends Error {
  constructor() {
    super("Projekte lassen sich nur in der Desktop-App suchen und prüfen.");
  }
}

/** Nativer Ordner-Dialog (Tauri dialog plugin). Browser-Demo: Pfadeingabe. */
export async function chooseProjectFolder(kind: ProjectFolderKind, defaultPath?: string): Promise<string | null> {
  if (isTauri()) {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath,
      title: kind === "project" ? "Projektordner auswählen" : "Workspace-Ordner auswählen"
    });
    if (!selected) return null;
    return Array.isArray(selected) ? selected[0] ?? null : selected;
  }
  const value = window.prompt("Browser-Demo: Ordnerpfad eingeben (in der Desktop-App öffnet sich der Finder).", defaultPath ?? "");
  return value?.trim() ? value.trim() : null;
}

export async function discoverProjectRepos(root: string): Promise<DiscoveryResult> {
  if (!isTauri()) throw new DesktopOnlyError();
  return invoke<DiscoveryResult>("project_registry_discover", { root });
}

export async function probeProject(root: string): Promise<ProjectProbe> {
  if (!isTauri()) throw new DesktopOnlyError();
  return invoke<ProjectProbe>("project_registry_scan", { root });
}

export async function loadRegistryRaw(): Promise<unknown | null> {
  if (isTauri()) return invoke<unknown | null>("project_registry_load");
  try {
    const stored = localStorage.getItem(MOCK_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export async function saveRegistryRaw(registry: unknown): Promise<void> {
  if (isTauri()) {
    await invoke("project_registry_save", { registry });
    return;
  }
  localStorage.setItem(MOCK_KEY, JSON.stringify(registry));
}

export async function openProjectFolder(path: string): Promise<void> {
  if (!isTauri()) throw new DesktopOnlyError();
  await invoke("project_registry_open", { path });
}
