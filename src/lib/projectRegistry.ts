// Created by NMKato Solutions
// Kanonische Project Registry: reine Zustandsfunktionen (kein Dateisystem, kein Git, kein Storage).
// Persistenz und Scans liegen im Repository-Adapter; das ViewModel orchestriert. Die Registry ist
// lokaler Zustand – sie laedt keinen Quellcode hoch und aendert nie Dateien der Projekte.
import type {
  DiscoveredProject,
  FocusEntry,
  FocusPolicy,
  MismatchResolution,
  ProjectProbe,
  ProjectRegistry,
  ProjectScanSummary,
  RegistryMigration,
  RegistryProject
} from "../types";
import { isExcludedRelativePath, normalizeRemote, redactSecrets, sanitizeRemoteUrl } from "./projectExclusions.ts";
import { buildContextCapsule } from "./projectCapsule.ts";
import {
  AUTO_MODES,
  FOCUS_PRIORITIES,
  FOCUS_STATUSES,
  DEFAULT_FOCUS_PROFILE,
  defaultFocus,
  emptyFocusPolicy,
  profileFocus,
  projectKey
} from "./projectFocus.ts";
import { applyResolution, headlineState, verifyProject } from "./projectVerification.ts";

const NO_PROJECT = "__no_project__";

export function emptyRegistry(now: string): ProjectRegistry {
  return {
    schemaVersion: 1,
    projects: [],
    migration: {
      sourceRoots: { status: "none", roots: [], checkedAt: null },
      projectRepos: { status: "none", checkedAt: null }
    },
    updatedAt: now
  };
}

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

function parseFocus(value: unknown, now: string): FocusEntry {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  // Unbekannte/kaputte Werte fallen auf die sichere Seite: geparkt + manuell.
  const status = FOCUS_STATUSES.find((entry) => entry === raw.status) ?? "parked";
  const priority = FOCUS_PRIORITIES.find((entry) => entry === raw.priority) ?? "P2";
  const autoMode = AUTO_MODES.find((entry) => entry === raw.autoMode) ?? "off";
  const origin = raw.origin === "default_profile" || raw.origin === "migration" ? raw.origin : "user";
  return { status, priority, autoMode, scope: str(raw.scope), origin, updatedAt: str(raw.updatedAt) ?? now };
}

/** Defensiv: ungueltige Eintraege werden verworfen, unbekannte Felder nicht uebernommen. null = nicht lesbar. */
export function parseRegistry(raw: unknown, now: string): ProjectRegistry | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== 1 || !Array.isArray(value.projects)) return null;
  const projects: RegistryProject[] = [];
  const ids = new Set<string>();
  for (const entry of value.projects) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const id = str(item.id);
    const name = str(item.name);
    const identityKey = str(item.identityKey);
    const rootPath = str(item.rootPath);
    if (!id || !name || !identityKey || !rootPath || ids.has(id)) continue;
    ids.add(id);
    projects.push({
      id,
      name,
      identityKey,
      aliases: Array.isArray(item.aliases) ? item.aliases.filter((alias): alias is string => typeof alias === "string") : [],
      rootPath,
      commonDir: str(item.commonDir),
      remote: sanitizeRemoteUrl(str(item.remote)),
      addedAt: str(item.addedAt) ?? now,
      source: item.source === "migration" ? "migration" : "discovery",
      focus: parseFocus(item.focus, now),
      scan: item.scan && typeof item.scan === "object" ? (item.scan as ProjectScanSummary) : null,
      verification: item.verification && typeof item.verification === "object" ? (item.verification as RegistryProject["verification"]) : null,
      capsule: item.capsule && typeof item.capsule === "object" ? (item.capsule as RegistryProject["capsule"]) : null,
      resolutions: item.resolutions && typeof item.resolutions === "object" ? (item.resolutions as Record<string, MismatchResolution>) : {}
    });
  }
  const base = emptyRegistry(now);
  const migration = (value.migration && typeof value.migration === "object" ? value.migration : {}) as Partial<RegistryMigration>;
  return {
    schemaVersion: 1,
    projects,
    migration: {
      sourceRoots: {
        ...base.migration.sourceRoots,
        ...(migration.sourceRoots ?? {}),
        roots: Array.isArray(migration.sourceRoots?.roots) ? migration.sourceRoots.roots.filter((root): root is string => typeof root === "string") : []
      },
      projectRepos: { ...base.migration.projectRepos, ...(migration.projectRepos ?? {}) }
    },
    updatedAt: str(value.updatedAt) ?? now
  };
}

export type RegistrySource = RegistryProject["source"];

/** Fuegt ausgewaehlte Funde hinzu. Bereits registrierte Projekte bleiben unveraendert (kein stilles Ueberschreiben). */
export function addDiscoveredProjects(
  registry: ProjectRegistry,
  discovered: DiscoveredProject[],
  now: string,
  source: RegistrySource = "discovery"
): ProjectRegistry {
  const known = new Set(registry.projects.map((project) => project.identityKey));
  const usedIds = new Set(registry.projects.map((project) => project.id));
  const added: RegistryProject[] = [];
  for (const item of discovered) {
    if (known.has(item.identityKey) || usedIds.has(item.id)) continue;
    known.add(item.identityKey);
    usedIds.add(item.id);
    const profile = item.profileId ? DEFAULT_FOCUS_PROFILE.find((entry) => entry.id === item.profileId) : undefined;
    added.push({
      id: item.id,
      name: item.name,
      identityKey: item.identityKey,
      aliases: [],
      rootPath: item.rootPath,
      commonDir: item.commonDir,
      remote: sanitizeRemoteUrl(item.remote),
      addedAt: now,
      source,
      focus: profile ? profileFocus(profile, now) : defaultFocus(now, source === "migration" ? "migration" : "user"),
      scan: null,
      verification: null,
      capsule: null,
      resolutions: {}
    });
  }
  return added.length ? { ...registry, projects: [...registry.projects, ...added], updatedAt: now } : registry;
}

/** Nur Registry-Eintrag entfernen – Dateien des Projekts bleiben unangetastet. */
export function removeProject(registry: ProjectRegistry, projectId: string, now: string): ProjectRegistry {
  const projects = registry.projects.filter((project) => project.id !== projectId);
  return projects.length === registry.projects.length ? registry : { ...registry, projects, updatedAt: now };
}

export function updateFocus(registry: ProjectRegistry, projectId: string, patch: Partial<Pick<FocusEntry, "status" | "priority" | "autoMode">>, now: string): ProjectRegistry {
  return {
    ...registry,
    projects: registry.projects.map((project) =>
      project.id === projectId
        ? { ...project, focus: { ...project.focus, ...patch, origin: "user" as const, updatedAt: now } }
        : project
    ),
    updatedAt: now
  };
}

/** Verknuepft eine bekannte Fokus-Projekt-ID ausdruecklich mit einem Projekt (nie automatisch geraten). */
export function linkProfileId(registry: ProjectRegistry, projectId: string, profileId: string, now: string): ProjectRegistry {
  const profile = DEFAULT_FOCUS_PROFILE.find((entry) => entry.id === profileId);
  const target = registry.projects.find((project) => project.id === projectId);
  if (!profile || !target) return registry;
  const holder = registry.projects.find((project) => project.id !== projectId && resolvesTo(project, profileId));
  if (holder) return registry;
  return {
    ...registry,
    projects: registry.projects.map((project) =>
      project.id === projectId
        ? {
            ...project,
            aliases: project.aliases.includes(profileId) ? project.aliases : [...project.aliases, profileId],
            focus: profileFocus(profile, now)
          }
        : project
    ),
    updatedAt: now
  };
}

function remoteSlugs(project: RegistryProject): string[] {
  const normalized = normalizeRemote(project.remote);
  if (!normalized) return [];
  const parts = normalized.split("/");
  return [parts.slice(-2).join("/"), parts[parts.length - 1]];
}

function keysOf(project: RegistryProject): string[] {
  return [project.id, project.name, ...project.aliases, ...remoteSlugs(project)].map(projectKey).filter(Boolean);
}

function resolvesTo(project: RegistryProject, raw: string): boolean {
  return keysOf(project).includes(projectKey(raw));
}

/** Sicht fuer Planer/Job-Modell. Mehrdeutige Aliase (zwei Projekte) werden verworfen statt geraten. */
export function buildFocusPolicy(registry: ProjectRegistry): FocusPolicy {
  const policy = emptyFocusPolicy();
  const claims = new Map<string, Set<string>>();
  for (const project of registry.projects) {
    const id = projectKey(project.id);
    if (!id) continue;
    policy.entries[id] = project.focus;
    for (const key of keysOf(project)) claims.set(key, (claims.get(key) ?? new Set()).add(id));
  }
  for (const [key, ids] of [...claims.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // Eine kanonische ID gehoert immer ihrem eigenen Projekt; Aliase nur, wenn eindeutig.
    if (policy.entries[key]) continue;
    if (ids.size === 1) policy.aliases[key] = [...ids][0];
  }
  return policy;
}

export function findProject(registry: ProjectRegistry | null, raw: string | null | undefined): RegistryProject | null {
  if (!registry || !raw || raw === NO_PROJECT) return null;
  const key = projectKey(raw);
  const policy = buildFocusPolicy(registry);
  const id = policy.entries[key] ? key : policy.aliases[key];
  return registry.projects.find((project) => projectKey(project.id) === id) ?? null;
}

/** Anzeigename aus der Registry; null = wirklich unbekannt ("Ohne Projekt"/Rohwert bleibt dem Aufrufer). */
export function projectDisplayName(registry: ProjectRegistry | null, raw: string | null | undefined): string | null {
  return findProject(registry, raw)?.name ?? null;
}

/** Kanonische ID fuer eine Task-Projekt-ID, sonst die Rohform. */
export function canonicalProjectId(registry: ProjectRegistry | null, raw: string): string {
  return findProject(registry, raw)?.id ?? raw;
}

/**
 * Arbeitsordner fuer einen Lauf. Bewusst NUR die ausdrueckliche Zuordnung (projectRepos): der Runner wechselt im
 * Ordner auf den Default-Branch, die Registry darf also keinen Checkout still als Ausfuehrungsort waehlen.
 * Die Registry loest nur die ID auf (Task-ID/Alias -> kanonische ID), damit eine Zuordnung unter beiden Namen greift.
 */
export function repoPathFor(registry: ProjectRegistry | null, projectRepos: Record<string, string> | undefined, raw: string): string | null {
  if (!projectRepos) return null;
  const explicit = projectRepos[raw];
  if (explicit) return explicit;
  const project = findProject(registry, raw);
  if (!project) return null;
  const byKey = new Map(Object.entries(projectRepos).map(([id, path]) => [projectKey(id), path] as const));
  for (const key of keysOf(project)) {
    const hit = byKey.get(key);
    if (hit) return hit;
  }
  return null;
}

/** projectId -> expliziter Arbeitsordner fuer alle uebergebenen Task-Projekt-IDs (Eingabe des Auto-Lane-Planers). */
export function buildRepoMap(registry: ProjectRegistry | null, projectRepos: Record<string, string> | undefined, rawIds: Iterable<string>): Record<string, string> {
  const map: Record<string, string> = { ...(projectRepos ?? {}) };
  for (const raw of rawIds) {
    if (map[raw]) continue;
    const path = repoPathFor(registry, projectRepos, raw);
    if (path) map[raw] = path;
  }
  return map;
}

// ===== Scan-Ergebnis anwenden =====
function scanSummary(probe: ProjectProbe, now: string): ProjectScanSummary {
  const repo = probe.repo;
  return {
    scannedAt: now,
    branch: repo.branch,
    headSha: repo.headSha,
    headDate: repo.headDate,
    dirtyCount: repo.dirtyCount,
    worktrees: repo.worktrees,
    // Defense in Depth: nichts mit tabuem Pfad wird je gespeichert; Inhalte ohnehin nicht.
    docs: probe.docs
      .filter((doc) => !isExcludedRelativePath(doc.path))
      .map((doc) => ({ path: doc.path, kind: doc.kind, modifiedAt: doc.modifiedAt, excluded: doc.excluded })),
    manifests: probe.manifests
      .filter((manifest) => !isExcludedRelativePath(manifest.path))
      .map((manifest) => ({ ...manifest, hints: manifest.hints.map((hint) => redactSecrets(hint)).slice(0, 12) }))
  };
}

/** Wendet einen frischen READ-ONLY-Scan an: Scan-Fakten, Verifikation und Capsule (Dokumentinhalt wird verworfen). */
export function applyProbe(registry: ProjectRegistry, projectId: string, probe: ProjectProbe, now: string): ProjectRegistry {
  const safeProbe: ProjectProbe = {
    ...probe,
    repo: { ...probe.repo, remote: sanitizeRemoteUrl(probe.repo.remote) },
    docs: probe.docs.filter((doc) => !isExcludedRelativePath(doc.path))
  };
  return {
    ...registry,
    projects: registry.projects.map((project) => {
      if (project.id !== projectId) return project;
      const verification = verifyProject({ probe: safeProbe, resolutions: project.resolutions, now });
      return {
        ...project,
        remote: safeProbe.repo.remote ?? project.remote,
        scan: scanSummary(safeProbe, now),
        verification,
        capsule: buildContextCapsule({ projectId: project.id, name: project.name, probe: safeProbe, verification, resolutions: project.resolutions, now })
      };
    }),
    updatedAt: now
  };
}

/** Haelt die Entscheidung des Nutzers fest; die naechste Verifikation beruecksichtigt sie fuer diesen HEAD. */
export function resolveFinding(
  registry: ProjectRegistry,
  projectId: string,
  findingId: string,
  choice: "use_code_truth" | "keep_docs_baseline",
  now: string
): ProjectRegistry {
  return {
    ...registry,
    projects: registry.projects.map((project) => {
      if (project.id !== projectId || !project.verification) return project;
      const resolutions = applyResolution(project.resolutions, findingId, choice, project.verification.headSha, now);
      const findings = project.verification.findings.map((finding) => (finding.id === findingId ? { ...finding, resolved: choice } : finding));
      const state = headlineState(findings);
      return { ...project, resolutions, verification: { ...project.verification, findings, state } };
    }),
    updatedAt: now
  };
}

// ===== Migration alter Konfiguration (sourceRoots / projectRepos) =====
export interface LegacyConfig {
  sourceRoots: string[];
  projectRepos: Record<string, string>;
}

/** Alle alten Pfade, die ueber die Registry neu entdeckt werden koennen (eindeutig, ohne Leereintraege). */
export function legacyScanRoots(legacy: LegacyConfig): string[] {
  const all = [...legacy.sourceRoots, ...Object.values(legacy.projectRepos ?? {})].map((path) => path.trim()).filter(Boolean);
  return [...new Set(all)];
}

const trimSlash = (path: string) => path.replace(/[\\/]+$/, "");

function inside(child: string, parent: string): boolean {
  const c = trimSlash(child);
  const p = trimSlash(parent);
  return c === p || c.startsWith(`${p}/`);
}

function projectPaths(project: RegistryProject): string[] {
  return [project.rootPath, ...(project.scan?.worktrees.map((worktree) => worktree.path) ?? [])];
}

/**
 * Gleicht alte Konfiguration gegen die Registry ab. Rein berechnend: aendert Config nie. Ein Quellordner
 * gilt als abgedeckt, wenn er (oder ein Elternordner) ein Projekt der Registry enthaelt bzw. darin liegt.
 * Alte projectRepos-Schluessel werden als Alias des passenden Projekts uebernommen.
 */
export function reconcileLegacy(registry: ProjectRegistry, legacy: LegacyConfig, now: string): ProjectRegistry {
  const roots = legacy.sourceRoots.map((root) => root.trim()).filter(Boolean);
  const covered = (root: string) =>
    registry.projects.some((project) => projectPaths(project).some((path) => inside(path, root) || inside(root, path)));
  const sourceStatus: RegistryMigration["sourceRoots"]["status"] = !roots.length ? "none" : roots.every(covered) ? "done" : "pending";

  const repoEntries = Object.entries(legacy.projectRepos ?? {}).filter(([id, path]) => id.trim() && path.trim());
  let projects = registry.projects;
  let matched = 0;
  for (const [rawId, path] of repoEntries) {
    const owner = projects.find((project) => projectPaths(project).some((candidate) => inside(candidate, path) || inside(path, candidate)));
    if (!owner) continue;
    matched += 1;
    if (!resolvesTo(owner, rawId)) {
      const taken = projects.some((project) => project.id !== owner.id && resolvesTo(project, rawId));
      if (!taken) projects = projects.map((project) => (project.id === owner.id ? { ...project, aliases: [...project.aliases, rawId] } : project));
    }
  }
  const repoStatus: RegistryMigration["projectRepos"]["status"] = !repoEntries.length ? "none" : matched === repoEntries.length ? "done" : "pending";

  const next: RegistryMigration = {
    sourceRoots: { status: sourceStatus, roots, checkedAt: now },
    projectRepos: { status: repoStatus, checkedAt: now }
  };
  const unchanged =
    projects === registry.projects &&
    registry.migration.sourceRoots.status === sourceStatus &&
    registry.migration.projectRepos.status === repoStatus &&
    registry.migration.sourceRoots.roots.join("\n") === roots.join("\n");
  return unchanged ? registry : { ...registry, projects, migration: next, updatedAt: now };
}

/** Fokus-Projekte des Standardprofils, die in der Registry (noch) fehlen – nie angelegt, nur gemeldet. */
export function missingProfileProjects(registry: ProjectRegistry): Array<{ id: string; priority: FocusEntry["priority"]; scope: string }> {
  return DEFAULT_FOCUS_PROFILE.filter((entry) => !registry.projects.some((project) => resolvesTo(project, entry.id))).map(
    (entry) => ({ id: entry.id, priority: entry.priority, scope: entry.scope })
  );
}

/** "Aktueller Fokus" in Anzeigereihenfolge: nur aktive Projekte. */
export function activeFocusProjects(registry: ProjectRegistry): RegistryProject[] {
  return registry.projects.filter((project) => project.focus.status === "active");
}
