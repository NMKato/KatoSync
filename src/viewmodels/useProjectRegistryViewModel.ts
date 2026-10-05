// Created by NMKato Solutions
// ViewModel der Project Registry + Focus Portfolio. Orchestriert reine Logik (src/lib/project*.ts) und den
// Repository-Adapter; kennt weder React-Views noch Dateisystem/Git. Alle Scans sind READ-ONLY.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppConfig, DiscoveredProject, FocusEntry, MismatchChoice, ProjectRegistry, RepoFacts } from "../types";
import { groupDiscoveredRepos } from "../lib/projectDiscovery";
import { sortPortfolio } from "../lib/projectFocus";
import {
  addDiscoveredProjects,
  applyProbe,
  buildFocusPolicy,
  emptyRegistry,
  legacyScanRoots,
  linkProfileId,
  missingProfileProjects,
  parseRegistry,
  projectDisplayName,
  reconcileLegacy,
  removeProject,
  resolveFinding,
  updateFocus,
  type RegistrySource
} from "../lib/projectRegistry";
import { askConfirm } from "../repositories/katoSyncRepository";
import {
  chooseProjectFolder,
  discoverProjectRepos,
  loadRegistryRaw,
  openProjectFolder,
  probeProject,
  saveRegistryRaw,
  suggestProjectWorkspaceRoots,
  type ProjectFolderKind
} from "../repositories/projectRegistryRepository";

type NoticeKind = "ok" | "info" | "warn" | "error";

export interface DiscoveryState {
  source: RegistrySource;
  roots: string[];
  candidates: DiscoveredProject[];
  selected: string[];
  truncated: boolean;
}

export type RegistryBusy = null | "discover" | "add" | "scan";

const messageOf = (error: unknown) => (error instanceof Error && error.message ? error.message : "Unbekannter Fehler.");
const nowIso = () => new Date().toISOString();

export function useProjectRegistryViewModel(deps: { config: AppConfig | null; notify: (kind: NoticeKind, text: string) => void }) {
  const { config, notify } = deps;
  const [registry, setRegistry] = useState<ProjectRegistry>(() => emptyRegistry(nowIso()));
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<RegistryBusy>(null);
  const [scanning, setScanning] = useState<string[]>([]);
  const [scanErrors, setScanErrors] = useState<Record<string, string>>({});
  const [discovery, setDiscovery] = useState<DiscoveryState | null>(null);
  const registryRef = useRef(registry);
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  // Persistenz strikt in Reihenfolge; ein Fehler blockiert spaetere Speicherungen nicht.
  const commit = useCallback(
    (next: ProjectRegistry) => {
      if (next === registryRef.current) return;
      registryRef.current = next;
      setRegistry(next);
      saveChain.current = saveChain.current
        .then(() => saveRegistryRaw(next))
        .catch((error) => notify("error", `Projekt-Registry konnte nicht gespeichert werden: ${messageOf(error)}`));
    },
    [notify]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let parsed: ProjectRegistry | null = null;
      try {
        parsed = parseRegistry(await loadRegistryRaw(), nowIso());
      } catch {
        parsed = null;
      }
      if (cancelled) return;
      const initial = parsed ?? emptyRegistry(nowIso());
      registryRef.current = initial;
      setRegistry(initial);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Alte Konfiguration (sourceRoots/projectRepos) nur ABGLEICHEN – die Config bleibt unveraendert bestehen.
  const sourceRoots = config?.sourceRoots;
  const projectRepos = config?.projectRepos;
  useEffect(() => {
    if (!loaded || !sourceRoots) return;
    commit(reconcileLegacy(registryRef.current, { sourceRoots, projectRepos: projectRepos ?? {} }, nowIso()));
  }, [loaded, sourceRoots, projectRepos, registry.projects, commit]);

  const rescan = useCallback(
    async (projectId: string): Promise<boolean> => {
      const project = registryRef.current.projects.find((entry) => entry.id === projectId);
      if (!project) return false;
      setScanning((current) => (current.includes(projectId) ? current : [...current, projectId]));
      try {
        const probe = await probeProject(project.rootPath);
        commit(applyProbe(registryRef.current, projectId, probe, nowIso()));
        setScanErrors((current) => {
          if (!(projectId in current)) return current;
          const { [projectId]: _removed, ...rest } = current;
          return rest;
        });
        return true;
      } catch (error) {
        setScanErrors((current) => ({ ...current, [projectId]: messageOf(error) }));
        return false;
      } finally {
        setScanning((current) => current.filter((id) => id !== projectId));
      }
    },
    [commit]
  );

  const rescanAll = useCallback(async () => {
    const ids = registryRef.current.projects.filter((project) => project.focus.status !== "archived").map((project) => project.id);
    if (!ids.length) return;
    setBusy("scan");
    let failed = 0;
    for (const id of ids) if (!(await rescan(id))) failed += 1;
    setBusy(null);
    notify(failed ? "warn" : "ok", failed ? `${ids.length - failed} von ${ids.length} Projekten geprüft, ${failed} nicht erreichbar.` : `${ids.length} Projekte neu geprüft.`);
  }, [notify, rescan]);

  const runDiscovery = useCallback(
    async (roots: string[], source: RegistrySource, selectionMode: "all" | "focus" = "all") => {
      setBusy("discover");
      try {
        const byPath = new Map<string, RepoFacts>();
        let truncated = false;
        for (const root of roots) {
          const result = await discoverProjectRepos(root);
          truncated = truncated || result.truncated;
          for (const repo of result.repos) byPath.set(repo.path, repo);
        }
        const candidates = groupDiscoveredRepos([...byPath.values()], registryRef.current);
        if (!candidates.length) {
          setDiscovery(null);
          notify("warn", "In diesem Ordner wurde kein Git-Projekt gefunden.");
          return;
        }
        const selectable = candidates.filter((candidate) => !candidate.alreadyRegistered);
        const selected =
          selectionMode === "focus"
            ? selectable.filter((candidate) => candidate.profileId !== null).map((candidate) => candidate.id)
            : selectable.map((candidate) => candidate.id);
        setDiscovery({
          source,
          roots,
          candidates,
          selected,
          truncated
        });
        if (selectionMode === "focus") {
          notify(
            selected.length ? "ok" : "warn",
            selected.length
              ? selected.length + " passende Fokus-" + (selected.length === 1 ? "Projekt" : "Projekte") + " automatisch erkannt und vorausgewählt."
              : "Keine eindeutigen Fokus-Projekte automatisch erkannt. Die gefundenen Projekte bleiben zur manuellen Auswahl sichtbar."
          );
        }
      } catch (error) {
        notify("error", messageOf(error));
      } finally {
        setBusy(null);
      }
    },
    [notify]
  );

  const startDiscovery = useCallback(
    async (kind: ProjectFolderKind) => {
      const picked = await chooseProjectFolder(kind, config?.sourceRoots[0]);
      if (picked) await runDiscovery([picked], "discovery");
    },
    [config?.sourceRoots, runDiscovery]
  );

  const autoDiscoverFocus = useCallback(async () => {
    setBusy("discover");
    try {
      const knownRoots = registryRef.current.projects.map((project) => project.rootPath);
      const roots = await suggestProjectWorkspaceRoots(knownRoots);
      if (!roots.length) {
        notify("warn", "Keine typischen lokalen Entwickler-Workspaces gefunden. Bitte einmal einen Workspace manuell auswählen.");
        return;
      }
      await runDiscovery(roots, "discovery", "focus");
    } catch (error) {
      notify("error", messageOf(error));
    } finally {
      setBusy(null);
    }
  }, [notify, runDiscovery]);

  const scanLegacyRoots = useCallback(async () => {
    const roots = legacyScanRoots({ sourceRoots: config?.sourceRoots ?? [], projectRepos: config?.projectRepos ?? {} });
    if (!roots.length) {
      notify("info", "Keine alten Quellordner vorhanden.");
      return;
    }
    await runDiscovery(roots, "migration");
  }, [config?.projectRepos, config?.sourceRoots, notify, runDiscovery]);

  const toggleCandidate = useCallback((id: string) => {
    setDiscovery((current) =>
      current ? { ...current, selected: current.selected.includes(id) ? current.selected.filter((entry) => entry !== id) : [...current.selected, id] } : current
    );
  }, []);

  const selectAllCandidates = useCallback((all: boolean) => {
    setDiscovery((current) =>
      current ? { ...current, selected: all ? current.candidates.filter((candidate) => !candidate.alreadyRegistered).map((candidate) => candidate.id) : [] } : current
    );
  }, []);

  const cancelDiscovery = useCallback(() => setDiscovery(null), []);

  const addSelected = useCallback(async () => {
    const current = discovery;
    if (!current) return;
    const chosen = current.candidates.filter((candidate) => current.selected.includes(candidate.id) && !candidate.alreadyRegistered);
    if (!chosen.length) return;
    setBusy("add");
    commit(addDiscoveredProjects(registryRef.current, chosen, nowIso(), current.source));
    setDiscovery(null);
    let failed = 0;
    for (const candidate of chosen) if (!(await rescan(candidate.id))) failed += 1;
    setBusy(null);
    notify(
      failed ? "warn" : "ok",
      failed
        ? `${chosen.length} Projekte hinzugefügt, ${failed} konnten noch nicht geprüft werden.`
        : `${chosen.length} ${chosen.length === 1 ? "Projekt" : "Projekte"} hinzugefügt und geprüft.`
    );
  }, [commit, discovery, notify, rescan]);

  const setFocus = useCallback(
    (projectId: string, patch: Partial<Pick<FocusEntry, "status" | "priority" | "autoMode">>) => {
      commit(updateFocus(registryRef.current, projectId, patch, nowIso()));
    },
    [commit]
  );

  const decideFinding = useCallback(
    async (projectId: string, findingId: string, choice: MismatchChoice) => {
      // "Prüfen" ist reine Anzeige; nur die beiden echten Entscheidungen werden festgehalten.
      if (choice === "inspect") return;
      commit(resolveFinding(registryRef.current, projectId, findingId, choice, nowIso()));
      await rescan(projectId);
    },
    [commit, rescan]
  );

  const remove = useCallback(
    async (projectId: string) => {
      const project = registryRef.current.projects.find((entry) => entry.id === projectId);
      if (!project) return;
      const confirmed = await askConfirm(`„${project.name}“ aus der Projektliste entfernen?\n\nEs werden keine Dateien gelöscht oder verändert.`, {
        title: "Projekt entfernen",
        okLabel: "Entfernen",
        cancelLabel: "Abbrechen"
      });
      if (confirmed) commit(removeProject(registryRef.current, projectId, nowIso()));
    },
    [commit]
  );

  const linkProfile = useCallback(
    (profileId: string, projectId: string) => commit(linkProfileId(registryRef.current, projectId, profileId, nowIso())),
    [commit]
  );

  const openFolder = useCallback(
    async (projectId: string) => {
      const project = registryRef.current.projects.find((entry) => entry.id === projectId);
      if (!project) return;
      try {
        await openProjectFolder(project.rootPath);
      } catch (error) {
        notify("error", messageOf(error));
      }
    },
    [notify]
  );

  const focusPolicy = useMemo(() => buildFocusPolicy(registry), [registry]);
  const portfolio = useMemo(() => sortPortfolio(registry.projects), [registry.projects]);
  const missingProfile = useMemo(() => missingProfileProjects(registry), [registry]);
  const legacyRoots = useMemo(
    () => legacyScanRoots({ sourceRoots: sourceRoots ?? [], projectRepos: projectRepos ?? {} }),
    [projectRepos, sourceRoots]
  );
  const projectName = useCallback((rawId: string) => projectDisplayName(registry, rawId), [registry]);

  return {
    registry,
    loaded,
    busy,
    scanning,
    scanErrors,
    discovery,
    focusPolicy,
    portfolio,
    missingProfile,
    legacyRoots,
    legacyStatus: registry.migration,
    projectName,
    startDiscovery,
    autoDiscoverFocus,
    scanLegacyRoots,
    toggleCandidate,
    selectAllCandidates,
    cancelDiscovery,
    addSelected,
    rescan,
    rescanAll,
    setFocus,
    decideFinding,
    remove,
    linkProfile,
    openFolder
  };
}

export type ProjectRegistryViewModel = ReturnType<typeof useProjectRegistryViewModel>;
