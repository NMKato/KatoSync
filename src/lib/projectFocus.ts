// Created by NMKato Solutions
// Focus Portfolio: rein und deterministisch. Entscheidet, ob Arbeit eines Projekts ueberhaupt
// autonom eingeplant werden darf – VOR jedem Ranking. Keine Laufzeit-Imports (nur Typen), damit
// Planer, Job-Modell und Node-Tests dieselbe Datei direkt laden koennen.
import type {
  FocusBlockReason,
  FocusEntry,
  FocusPolicy,
  FocusPriority,
  FocusStatus,
  ProjectAutoMode
} from "../types";

// Entspricht NO_PROJECT_ID im Repository (hier dupliziert, damit diese Datei importfrei bleibt).
const NO_PROJECT = "__no_project__";

export const FOCUS_STATUSES: FocusStatus[] = ["active", "parked", "archived"];
export const FOCUS_PRIORITIES: FocusPriority[] = ["P0", "P1", "P2"];
export const AUTO_MODES: ProjectAutoMode[] = ["inherit", "on", "off"];

/** Ein Schluessel fuer Task-Projekt-IDs, Repo-Namen, Remote-Slugs und Aliase: klein, a-z0-9 getrennt durch "-". */
export function projectKey(raw: string | null | undefined): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Menschlich freigegebenes Test-/Standardprofil. Es erkennt diese Projekte, WENN sie in der Registry
// vorhanden sind – es legt nie ein Projekt an. Aliase sind nur eindeutige Schreibweisen derselben ID.
export interface FocusProfileEntry {
  id: string;
  priority: FocusPriority;
  scope: string;
  aliases: string[];
}

export const DEFAULT_FOCUS_PROFILE: readonly FocusProfileEntry[] = [
  { id: "katosync", priority: "P0", scope: "KatoSync 3.0: Auto-Lanes, Control Tower, Approval Control Plane, Context Fabric", aliases: ["katosync"] },
  { id: "kai-desktop", priority: "P1", scope: "Kai Desktop/THEORG Ende-zu-Ende-Pfad", aliases: ["kai-desktop", "kai-desktop-agent"] },
  {
    id: "katoos-beta",
    priority: "P1",
    scope: "KatoOS Beta: Release-, Sicherheits- und Stabilitaets-Blocker",
    aliases: ["katoos-beta", "katoos-maa-kai"]
  },
  { id: "genxline", priority: "P1", scope: "GENXLine: aktuelle freigegebene Roadmap", aliases: ["genxline", "genx-line"] }
];

export function profileEntryFor(candidates: Array<string | null | undefined>): FocusProfileEntry | null {
  const keys = new Set(candidates.map(projectKey).filter(Boolean));
  return DEFAULT_FOCUS_PROFILE.find((entry) => entry.aliases.some((alias) => keys.has(projectKey(alias)))) ?? null;
}

export function profileFocus(profile: FocusProfileEntry, now: string): FocusEntry {
  return { status: "active", priority: profile.priority, autoMode: "inherit", scope: profile.scope, origin: "default_profile", updatedAt: now };
}

/**
 * Neu hinzugefuegtes Projekt ohne Profil: sichtbar im Fokus, aber ausschliesslich manuell (Auto aus).
 * Migrierte Altzuordnungen starten geparkt – sie wurden nie bewusst in den Fokus genommen.
 */
export function defaultFocus(now: string, origin: FocusEntry["origin"] = "user"): FocusEntry {
  return {
    status: origin === "migration" ? "parked" : "active",
    priority: "P2",
    autoMode: "off",
    scope: null,
    origin,
    updatedAt: now
  };
}

export function emptyFocusPolicy(): FocusPolicy {
  return { entries: {}, aliases: {} };
}

/** Kennt die Registry ueberhaupt Projekte? Erst dann filtern Empfehlungen/Anzeigen (Dispatch filtert immer). */
export function hasFocusProfile(policy: FocusPolicy | null | undefined): policy is FocusPolicy {
  return Boolean(policy && Object.keys(policy.entries).length > 0);
}

/** Raw-ID (Task-Projekt-ID, Alias, Repo-Slug) -> kanonische Projekt-ID, sonst null. */
export function resolveFocusProjectId(policy: FocusPolicy, raw: string | null | undefined): string | null {
  if (!raw || raw === NO_PROJECT) return null;
  const key = projectKey(raw);
  if (!key) return null;
  if (policy.entries[key]) return key;
  const viaAlias = policy.aliases[key];
  if (viaAlias && policy.entries[viaAlias]) return viaAlias;
  // Kanonische IDs koennen auch ungeschluesselt (nicht normalisiert) vorliegen.
  return Object.keys(policy.entries).find((id) => projectKey(id) === key) ?? null;
}

export interface FocusDecision {
  allowed: boolean;
  reason: FocusBlockReason | null;
  canonicalId: string | null;
}

/**
 * Harte Auto-Grenze. Erlaubt nur: bekanntes Projekt + Status "active" + Auto-Modus nicht "off".
 * Der globale Auto-Schalter bleibt davon getrennt (Planer: enabled).
 */
export function evaluateFocus(policy: FocusPolicy, rawProjectId: string | null | undefined): FocusDecision {
  const canonicalId = resolveFocusProjectId(policy, rawProjectId);
  if (!canonicalId) return { allowed: false, reason: "unmapped", canonicalId: null };
  const entry = policy.entries[canonicalId];
  if (entry.status === "archived") return { allowed: false, reason: "archived", canonicalId };
  if (entry.status === "parked") return { allowed: false, reason: "parked", canonicalId };
  if (entry.autoMode === "off") return { allowed: false, reason: "project_manual", canonicalId };
  return { allowed: true, reason: null, canonicalId };
}

/** Ist das Projekt im aktiven Fokus (unabhaengig vom Auto-Modus)? Steuert Empfehlungen/"naechster Job". */
export function isInActiveFocus(policy: FocusPolicy, rawProjectId: string | null | undefined): boolean {
  const id = resolveFocusProjectId(policy, rawProjectId);
  return Boolean(id && policy.entries[id].status === "active");
}

export const PRIORITY_RANK: Record<FocusPriority, number> = { P0: 0, P1: 1, P2: 2 };

/** Aktive Projekte zuerst, nach Prioritaet, dann Name – Reihenfolge des Portfolios. */
export function sortPortfolio<T extends { id: string; name: string; focus: FocusEntry }>(projects: T[]): T[] {
  const statusRank: Record<FocusStatus, number> = { active: 0, parked: 1, archived: 2 };
  return [...projects].sort(
    (a, b) =>
      statusRank[a.focus.status] - statusRank[b.focus.status] ||
      PRIORITY_RANK[a.focus.priority] - PRIORITY_RANK[b.focus.priority] ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
  );
}
