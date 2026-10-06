import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { evaluateFocus } from "../lib/projectFocus";
import { buildRepoMap, canonicalProjectId, repoPathFor } from "../lib/projectRegistry";
import type { ProjectRegistry } from "../types";
import { useProjectRegistryViewModel } from "./useProjectRegistryViewModel";
import {
  askConfirm,
  buildCodexPromptFromBriefing,
  buildCodexPromptFromTask,
  chooseFolders,
  chooseRepoFolder,
  checkCodexTask,
  cancelProviderLogin,
  connectProvider,
  dirExists,
  disconnectProvider,
  discoverLocalProviders,
  getLocalBrainStatus,
  installLocalBrain,
  startLocalBrain,
  stopLocalBrain,
  removeLocalBrain,
  listenLocalBrainProgress,
  listenProviderLoginUrls,
  openProviderLoginUrl,
  saveLocalProviderKey,
  submitProviderLoginCode,
  listenCodexEvents,
  listenSyncEvents,
  NO_PROJECT_ID,
  runCodexTask,
  resumeRunnerSession,
  deleteApiKey,
  deleteMcpConnectorToken,
  generateConnectorToken,
  getApiKeyStatus,
  getLaunchAgentStatus,
  getLocalControlSnapshot,
  getMcpConnectorTokenStatus,
  getProviderStatuses,
  getSupabaseSession,
  installLaunchAgent,
  loadActionPlans,
  loadBriefings,
  loadConfig,
  loginSupabase,
  recoverSupabase,
  signupSupabase,
  cloudProfileSyncAfterLogin,
  cloudProfilePush,
  cloudProfileUnlockAndPush,
  cloudProfileLogout,
  clearLocalTenantCaches,
  openOutputDir,
  quitApp,
  readLogs,
  removeLaunchAgent,
  runSync,
  saveApiKey,
  saveConfig,
  saveMcpConnectorToken,
  scanProject,
  testConnection,
  testLibrary,
  testProvider,
  getProviderWarmupState,
  warmUpProvider,
  updateActionPlanStatus,
  updateActionTaskStatus,
  updateBriefingStatus,
  archiveBriefing,
  deleteBriefing
} from "../repositories/katoSyncRepository";
import {
  mergeCheapProviderHealth,
  mergeProviderStatus,
  moveProvider,
  normalizeProviderPriority,
  providerRecheckPlan,
  providerTransitions,
  validateLocalEndpointInput
} from "../lib/providerPolicy";
import { agentWorkWaiting, normalizeAgentSyncState } from "../lib/agentJobModel";
import { providerWarmupPlan, warmupSuppressedByWork } from "../lib/providerWarmupPolicy";
import {
  AUTO_LANE_PLAN_REFRESH_MS,
  AUTO_LANE_TICK_MS,
  addAutoLaneClaim,
  hasAutoLaneClaimConflict,
  pruneAutoLaneClaims,
  pruneAutoLaneClaimsInScope,
  releaseAutoLaneClaim
} from "../lib/autoLanePlanner";
import { autoQRefreshReason } from "../lib/autoQRuntime";
import {
  readAutoLaneClaims,
  readAutoLaneMode,
  readBoardSelection,
  writeAutoLaneClaims,
  writeAutoLaneMode,
  writeBoardSelection,
  type AutoLaneMode
} from "../lib/autoLaneStore";
import { defaultConfig } from "../lib/defaults";
import {
  buildProjectWorkSync,
  isProjectWorkPlan,
  projectWorkTruthSignature,
  readProjectWorkPlans,
  updateProjectWorkTask,
  writeProjectWorkPlans,
  type ProjectWorkSyncReport
} from "../lib/projectWorkSync";
import type { LocalBrainProgress, LocalBrainStatus } from "../lib/localBrainCatalog";
import { modeForStep } from "../lib/workspaceMode";
import type { Notice } from "../components/Primitives";
import type {
  ActionPlan,
  AgentSyncState,
  ActionPlanStatus,
  ActionTask,
  ActionTaskStatus,
  AppConfig,
  AutoLaneClaim,
  AutoLaneRunner,
  Briefing,
  CodexEvent,
  CodexRunResult,
  CodexRunState,
  RateLimitMetric,
  KeyStatus,
  LaunchAgentStatus,
  LocalControlMonitorSnapshot,
  DiscoveredLocalProvider,
  LocalProviderConfig,
  ProviderAction,
  ProviderId,
  ProviderStatus,
  ProviderWarmupState,
  ProviderTransition,
  ScanSummary,
  SupabaseSessionStatus,
  SyncReport
} from "../types";

// Projekt-Board: ein abgeflachter Task mit Plan-Kontext fuer die Projekt-Gruppierung.
export interface BoardTask extends ActionTask {
  planId: string;
  planStatus: ActionPlanStatus;
  agentName: string;
  source: string;
  approved: boolean;
  selected: boolean;
  orderIndex: number;
}

export interface BoardGroup {
  projectId: string;
  tasks: BoardTask[];
}

export type StepId =
  | "welcome"
  | "api"
  | "library"
  | "folders"
  | "rules"
  | "schedule"
  | "dashboard"
  | "actionQueue"
  | "projectBoard"
  | "briefings"
  | "settings"
  | "logs"
  // Agent-Sync-Workspace (eigener Navigationsbaum, siehe lib/workspaceMode.ts)
  | "agentDashboard"
  | "agentJobs"
  | "agentProviders"
  | "agentMonitor"
  | "agentProjects"
  | "agentHistory"
  | "agentSettings";

// Rate-Limits deduplizieren: pro Kategorie NUR ein Eintrag (knappster Rest = aktuellster Stand).
// Sonst haengt der Sync pro hochgeladener Datei denselben Eintrag mit fallendem Rest an (9/10, 8/10 …).
function dedupRateLimits(list: RateLimitMetric[]): RateLimitMetric[] {
  const byLabel = new Map<string, RateLimitMetric>();
  for (const m of list) {
    const prev = byLabel.get(m.label);
    if (!prev || Number(m.remaining ?? Infinity) <= Number(prev.remaining ?? Infinity)) {
      byLabel.set(m.label, m);
    }
  }
  return [...byLabel.values()];
}

export function useKatoSyncViewModel() {
  const [activeStep, setActiveStep] = useState<StepId>("dashboard");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [mcpTokenInput, setMcpTokenInput] = useState("");
  const [keyStatus, setKeyStatus] = useState<KeyStatus>({ exists: false });
  const [mcpTokenStatus, setMcpTokenStatus] = useState<KeyStatus>({ exists: false });
  const [sessionStatus, setSessionStatus] = useState<SupabaseSessionStatus>({ loggedIn: false });
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  // Cloud-Profil: sicherer Logout/Konto-Wechsel (confirm -> saving -> ggf. password -> ggf. error)
  // und die einmalige Passwort-Abfrage, wenn ein Speichern den RAM-Schluessel nicht hat.
  const [logoutFlow, setLogoutFlow] = useState<
    { stage: "confirm" | "saving" | "password" | "error"; error?: string } | null
  >(null);
  const [cloudPasswordPrompt, setCloudPasswordPrompt] = useState<
    { error: string | null; busy: boolean } | null
  >(null);
  const [codexRun, setCodexRun] = useState<CodexRunState>({ status: "idle" });
  const [codexEvents, setCodexEvents] = useState<CodexEvent[]>([]);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [launchStatus, setLaunchStatus] = useState<LaunchAgentStatus | null>(null);
  const [rateLimits, setRateLimits] = useState<RateLimitMetric[]>(() => {
    // Persistiert: die zuletzt gemessenen Limits ueberleben einen App-Neustart (sonst leer,
    // bis der Nutzer erneut testet/synct).
    try {
      return JSON.parse(localStorage.getItem("katosync.rateLimits.v1") || "[]") as RateLimitMetric[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("katosync.rateLimits.v1", JSON.stringify(rateLimits));
    } catch {
      // localStorage nicht verfuegbar -> ignorieren
    }
  }, [rateLimits]);
  const [connectionOk, setConnectionOk] = useState(false);
  const [libraryOk, setLibraryOk] = useState(false);
  const [logs, setLogs] = useState("");
  const [localControlMonitor, setLocalControlMonitor] = useState<LocalControlMonitorSnapshot | null>(null);
  const [localControlMonitorError, setLocalControlMonitorError] = useState<string | null>(null);
  const [actionPlans, setActionPlans] = useState<ActionPlan[]>([]);
  const [projectWorkPlans, setProjectWorkPlans] = useState<ActionPlan[]>(() => readProjectWorkPlans());
  const projectWorkPlansRef = useRef<ActionPlan[]>(projectWorkPlans);
  projectWorkPlansRef.current = projectWorkPlans;
  const [projectWorkSyncReport, setProjectWorkSyncReport] = useState<ProjectWorkSyncReport | null>(null);
  const [projectWorkSyncBusy, setProjectWorkSyncBusy] = useState(false);
  const projectWorkSyncingRef = useRef(false);
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [providerHistory, setProviderHistory] = useState<ProviderTransition[]>([]);
  const [providerBusy, setProviderBusy] = useState<Partial<Record<ProviderId, ProviderAction>>>({});
  const [providerLoginUrls, setProviderLoginUrls] = useState<Partial<Record<ProviderId, string>>>({});
  // Entwurf des lokalen Endpunkts: wird erst mit "Speichern & testen" persistiert.
  const [localProviderDraft, setLocalProviderDraft] = useState<LocalProviderConfig | null>(null);
  const [localKeyInput, setLocalKeyInput] = useState("");
  const [localKeyError, setLocalKeyError] = useState<string | null>(null);
  const [discoveredLocal, setDiscoveredLocal] = useState<DiscoveredLocalProvider[] | null>(null);
  const [localBrainStatus, setLocalBrainStatus] = useState<LocalBrainStatus | null>(null);
  const [localBrainProgress, setLocalBrainProgress] = useState<LocalBrainProgress | null>(null);
  const [localBrainBusy, setLocalBrainBusy] = useState<"install" | "start" | "stop" | "remove" | null>(null);
  const providerStatusesRef = useRef<ProviderStatus[]>([]);
  // Kanonischer Agent-Sync-Zustand fuer Timer/Handler, die vor dem useMemo definiert sind.
  const agentSyncRef = useRef<AgentSyncState | null>(null);
  const providerSmokeCheckedRef = useRef(false);
  // Projekt-Board
  // Auswahl + Reihenfolge ueberleben einen Neustart: Auto Mode arbeitet nur ausgewaehlte Tasks ab.
  const [boardSelection, setBoardSelection] = useState<string[]>(() => readBoardSelection());
  const [boardOrder, setBoardOrder] = useState<string[]>(() => readBoardSelection());
  const [queueRunning, setQueueRunning] = useState(false);
  const [currentQueueTaskId, setCurrentQueueTaskId] = useState<string | null>(null);
  const [dailyCount, setDailyCount] = useState<number>(() => readDailyCount());
  const stopRef = useRef(false);
  // Synchroner Lock gegen Doppel-Start des Queue-Runners: der queueRunning-State wird erst NACH dem
  // await (Repo-Auswahl) gesetzt, ein zweiter Klick in diesem Fenster wuerde sonst einen zweiten
  // parallelen Lauf starten (TOCTOU). Dieser Ref greift synchron, vor jedem await.
  const queueStartingRef = useRef(false);
  // Auto-Lane-Planer: persistierter Modus + Claims, sitzungslokaler Lauf-/Repo-Zustand.
  const [autoMode, setAutoMode] = useState<AutoLaneMode>(() => readAutoLaneMode());
  const [autoClaims, setAutoClaims] = useState<AutoLaneClaim[]>(() => readAutoLaneClaims());
  const [autoInFlight, setAutoInFlight] = useState<string[]>([]);
  const [autoMissingRepos, setAutoMissingRepos] = useState<string[]>([]);
  const [autoLastDispatch, setAutoLastDispatch] = useState<Record<string, string>>({});
  const [autoTickSeq, setAutoTickSeq] = useState(0);
  // Synchrone Locks: Auto-Dispatch und manuelle Einzel-Laeufe schliessen sich vor jedem await aus.
  const autoDispatchingRef = useRef(false);
  const manualRunRef = useRef(0);
  // Letzte in die Cloud gesicherte library_id -> Push beim Speichern nur, wenn sie sich aenderte.

  const show = useCallback((kind: Notice["kind"], text: string) => setNotice({ kind, text }), []);

  // Project Registry + Focus Portfolio (eigener ViewModel, hier nur komponiert).
  const projects = useProjectRegistryViewModel({ config, notify: show });
  const projectsRegistryRef = useRef<ProjectRegistry>(projects.registry);
  projectsRegistryRef.current = projects.registry;
  const focusPolicyRef = useRef(projects.focusPolicy);
  focusPolicyRef.current = projects.focusPolicy;

  const commitProjectWorkPlans = useCallback((update: (plans: ActionPlan[]) => ActionPlan[]) => {
    const next = update(projectWorkPlansRef.current);
    projectWorkPlansRef.current = next;
    writeProjectWorkPlans(next);
    setProjectWorkPlans(next);
    return next;
  }, []);

  const applyProviderSnapshot = useCallback((next: ProviderStatus[]) => {
    const transitions = providerTransitions(providerStatusesRef.current, next);
    providerStatusesRef.current = next;
    setProviderStatuses(next);
    if (transitions.length) {
      setProviderHistory((current) => [...current, ...transitions].slice(-20));
    }
  }, []);

  const boot = useCallback(async () => {
    try {
      const [loadedConfig, loadedKey, loadedMcpToken, loadedLaunch, loadedSession] = await Promise.all([
        loadConfig(),
        getApiKeyStatus(),
        getMcpConnectorTokenStatus(),
        getLaunchAgentStatus(),
        getSupabaseSession()
      ]);
      const [loadedPlans, loadedBriefings] = await Promise.all([
        loadActionPlans(loadedConfig),
        loadBriefings(loadedConfig)
      ]);
      setConfig(loadedConfig);
      setKeyStatus(loadedKey);
      setMcpTokenStatus(loadedMcpToken);
      setLaunchStatus(loadedLaunch);
      setSessionStatus(loadedSession);
      setActionPlans(loadedPlans);
      setBriefings(loadedBriefings);
      try {
        applyProviderSnapshot(await getProviderStatuses(loadedConfig, false));
      } catch {
        // Der restliche App-Start bleibt nutzbar; Agent Sync zeigt den Fehler beim manuellen Test.
      }
    } catch (error) {
      show("error", getMessage(error));
    }
  }, [applyProviderSnapshot, show]);

  useEffect(() => {
    void boot();
  }, [boot]);

  const refreshLocalControlMonitor = useCallback(async () => {
    try {
      const snapshot = await getLocalControlSnapshot();
      setLocalControlMonitor(snapshot);
      setLocalControlMonitorError(null);
    } catch (error) {
      setLocalControlMonitorError(getMessage(error));
    }
  }, []);

  // Nur im Agent-Sync-Workspace pollen (Readiness-Leiste braucht ueberall frische Heartbeats):
  // lokal, billig und ohne GitHub/LLM-Traffic.
  const pollLocalControl = modeForStep(activeStep) === "agentSync";
  useEffect(() => {
    if (!pollLocalControl) return undefined;
    let active = true;
    const refresh = async () => {
      if (!active) return;
      await refreshLocalControlMonitor();
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pollLocalControl, refreshLocalControlMonitor]);

  // Live-Feed: gestreamte Codex-Events sammeln (letzte 300).
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    let unlistenSync: (() => void) | undefined;
    void (async () => {
      const un = await listenCodexEvents((event) => {
        const received = { ...event, at: event.at ?? new Date().toISOString() };
        setCodexEvents((prev) => {
          const next = [...prev, received];
          return next.length > 300 ? next.slice(next.length - 300) : next;
        });
        setCodexRun((current) => current.status === "running"
          ? { ...current, lastActivityAt: received.at }
          : current);
      });
      const unSync = await listenSyncEvents((event) => {
        if (event.phase === "rate_limit") {
          setSyncStatus(
            `Rate-Limit erreicht – neuer Versuch in ${event.waitSecs ?? 0}s (${event.attempt ?? 0}/${event.total ?? 0})`
          );
        } else if (event.phase === "rate_limit_abort_day") {
          setSyncStatus(
            "Mistral-Tageslimit für Dokumente erreicht (heute aufgebraucht). Morgen erneut synchronisieren oder höheren Plan (Scale) wählen."
          );
        } else if (event.phase === "rate_limit_abort") {
          setSyncStatus("Rate-Limit erreicht – Sync abgebrochen. Bitte in ~1 Minute erneut.");
        } else {
          setSyncStatus(`Lädt hoch: ${event.file} (${event.index ?? 0}/${event.total ?? 0})`);
        }
      });
      if (active) {
        unlisten = un;
        unlistenSync = unSync;
      } else {
        un();
        unSync();
      }
    })();
    return () => {
      active = false;
      unlisten?.();
      unlistenSync?.();
    };
  }, []);

  // Ungespeicherte Aenderungen: wird bei Formular-Edits gesetzt, beim Speichern geleert.
  const [dirty, setDirty] = useState(false);
  const updateConfig = useCallback(<K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    setConfig((current) => (current ? { ...current, [key]: value } : current));
    setDirty(true);
  }, []);

  const updateNested = useCallback(
    <K extends "schedule" | "scanRules" | "safety">(key: K, value: Partial<AppConfig[K]>) => {
      setConfig((current) =>
        current ? { ...current, [key]: { ...current[key], ...value } } : current
      );
      setDirty(true);
    },
    []
  );

  // ── Cloud-Profil (Zero-Knowledge) ──────────────────────────────────────────────────
  const baseUrlOf = useCallback(
    () => config?.mcp.baseUrl ?? "https://mcp.katoos.de",
    [config]
  );

  // Nach einer Zugangsdaten-Aenderung den Stand sichern. Fehlt der RAM-Schluessel
  // (still-wieder-eingeloggte Sitzung), oeffnet sich die einmalige Passwort-Abfrage.
  const pushCloudProfile = useCallback(async () => {
    const result = await cloudProfilePush(baseUrlOf());
    if (result.needsPassword) {
      setCloudPasswordPrompt({ error: null, busy: false });
    }
  }, [baseUrlOf]);

  const submitCloudPassword = useCallback(
    async (password: string) => {
      setCloudPasswordPrompt({ error: null, busy: true });
      try {
        await cloudProfileUnlockAndPush(baseUrlOf(), password);
        setCloudPasswordPrompt(null);
        show("ok", "Cloud-Profil aktualisiert.");
      } catch (error) {
        setCloudPasswordPrompt({ error: getMessage(error), busy: false });
      }
    },
    [baseUrlOf, show]
  );

  const cancelCloudPassword = useCallback(() => {
    setCloudPasswordPrompt(null);
    show("info", "Lokal gespeichert. Dein Cloud-Profil wird beim nächsten Login aktualisiert.");
  }, [show]);

  // Tenant-Isolierung: nach erfolgreicher Cloud-Sicherung alles Konto-Bezogene lokal raeumen.
  const finalizeLogout = useCallback(() => {
    clearLocalTenantCaches();
    setSessionStatus({ loggedIn: false, email: null });
    setGeneratedToken(null);
    setActionPlans([]);
    setBriefings([]);
    setKeyStatus({ exists: false });
    setMcpTokenStatus({ exists: false });
    setKeyInput("");
    setMcpTokenInput("");
    setLoginEmail("");
    setConnectionOk(false);
    setLibraryOk(false);
    setReport(null);
    setScan(null);
    setRateLimits([]);
    // Tenant-spezifische Live-/Lauf-States leeren -> der naechste Login sieht NICHTS vom Vortenant
    // (Codex-Feed mit Aufgabentext/Dateipfaden, Status, Tageszaehler, Logs).
    setCodexRun({ status: "idle" });
    setCodexEvents([]);
    setSyncStatus(null);
    setQueueRunning(false);
    setCurrentQueueTaskId(null);
    setDailyCount(0);
    setBoardSelection([]);
    setBoardOrder([]);
    setAutoMode({ enabled: false, updatedAt: null });
    setAutoClaims([]);
    setAutoMissingRepos([]);
    setAutoLastDispatch({});
    setLogs("");
    stopRef.current = false;
    // Tageszaehler-Schluessel des heutigen Tages entfernen, damit das Quota nicht "geerbt" wird.
    try {
      localStorage.removeItem(dailyCountKey());
    } catch {
      // localStorage nicht verfuegbar -> ignorieren
    }
    // Rust hat die Config tenant-bereinigt -> frisch laden (Ordner/Library/Zeitplan jetzt leer).
    void loadConfig().then(setConfig).catch(() => undefined);
  }, []);

  // Sicherer Logout/Konto-Wechsel: ERST in die Cloud sichern, DANN raeumen. needs_password ->
  // Passwort-Stufe; Fehler -> Fehler-Stufe (NICHT ausgeloggt). force=true ueberspringt die Sicherung.
  const runCloudLogout = useCallback(
    async (password?: string, force = false) => {
      setLogoutFlow({ stage: "saving" });
      try {
        const result = await cloudProfileLogout(baseUrlOf(), password, force);
        if (result.status === "needs_password") {
          setLogoutFlow({ stage: "password" });
          return;
        }
        finalizeLogout();
        setLogoutFlow(null);
        show("info", "Abgemeldet. Dein Cloud-Profil ist gesichert.");
      } catch (error) {
        setLogoutFlow({ stage: "error", error: getMessage(error) });
      }
    },
    [baseUrlOf, finalizeLogout, show]
  );

  const requestLogout = useCallback(() => setLogoutFlow({ stage: "confirm" }), []);
  const cancelLogout = useCallback(() => setLogoutFlow(null), []);
  const confirmLogout = useCallback(() => {
    void runCloudLogout();
  }, [runCloudLogout]);
  const submitLogoutPassword = useCallback(
    (password: string) => {
      void runCloudLogout(password, false);
    },
    [runCloudLogout]
  );
  const forceLogout = useCallback(() => {
    void runCloudLogout(undefined, true);
  }, [runCloudLogout]);

  const persist = useCallback(async () => {
    if (!config) return;
    setBusy("save");
    try {
      const saved = await saveConfig(config);
      setConfig(saved);
      setDirty(false);
      show("ok", "Konfiguration gespeichert.");
      // Hinweis: die library_id wird bewusst NICHT ins Cloud-Profil gepusht (pro Rechner). Geheimnisse
      // (API-Key/Connector-Token) werden an ihren eigenen Aenderungsstellen gesichert.
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [config, show]);

  // ── Agent Sync: Provider-Manager ────────────────────────────────────────────────────
  // Provider-Aktionen haben einen eigenen Busy-Zustand pro Karte: ein offener Browser-Login
  // (bis 5 Min.) darf nicht die gesamte App blockieren.
  const setProviderAction = useCallback((provider: ProviderId, action: ProviderAction | null) => {
    setProviderBusy((current) => {
      const next = { ...current };
      if (action) next[provider] = action;
      else delete next[provider];
      return next;
    });
  }, []);

  const mergeProvider = useCallback(
    (status: ProviderStatus, priority: ProviderId[]) => {
      applyProviderSnapshot(mergeProviderStatus(providerStatusesRef.current, status, priority));
    },
    [applyProviderSnapshot]
  );

  // Speichert NUR Provider-Felder auf die Platten-Config. Andere ungespeicherte Formular-
  // Aenderungen bleiben unangetastet und weiterhin "dirty".
  const persistProviderFields = useCallback(
    async (patch: Partial<Pick<AppConfig, "providerPriority" | "disabledProviders" | "localProvider">>) => {
      const onDisk = await loadConfig();
      const saved = await saveConfig({ ...onDisk, ...patch });
      setConfig((current) =>
        current
          ? {
              ...current,
              providerPriority: saved.providerPriority,
              disabledProviders: saved.disabledProviders,
              localProvider: saved.localProvider
            }
          : saved
      );
      return saved;
    },
    []
  );

  const handleRefreshProviders = useCallback(
    async (runSmoke = true) => {
      if (!config) return;
      const cards: ProviderId[] = ["codex", "claude", "local"];
      cards.forEach((provider) => setProviderAction(provider, "test"));
      try {
        applyProviderSnapshot(await getProviderStatuses(config, runSmoke));
        if (runSmoke) providerSmokeCheckedRef.current = true;
      } catch (error) {
        show("error", getMessage(error));
      } finally {
        cards.forEach((provider) => setProviderAction(provider, null));
      }
    },
    [applyProviderSnapshot, config, setProviderAction, show]
  );

  const handleConnectProvider = useCallback(
    async (provider: ProviderId, forceLogin = false) => {
      if (!config || provider === "local_control" || providerBusy[provider]) return;
      const draft = localProviderDraft ?? config.localProvider;
      if (provider === "local" && validateLocalEndpointInput(draft.baseUrl)) return;
      setProviderAction(provider, "connect");
      setProviderLoginUrls((current) => ({ ...current, [provider]: undefined }));
      try {
        const saved = await persistProviderFields({
          disabledProviders: config.disabledProviders.filter((entry) => entry !== provider),
          ...(provider === "local" ? { localProvider: draft } : {})
        });
        if (provider === "local") setLocalProviderDraft(null);
        const status =
          provider === "local"
            ? await testProvider(saved, provider)
            : await connectProvider(provider, forceLogin);
        mergeProvider(status, saved.providerPriority);
      } catch (error) {
        show("error", getMessage(error));
      } finally {
        setProviderAction(provider, null);
        setProviderLoginUrls((current) => ({ ...current, [provider]: undefined }));
      }
    },
    [config, localProviderDraft, mergeProvider, persistProviderFields, providerBusy, setProviderAction, show]
  );

  const handleOpenProviderLoginUrl = useCallback(
    async (provider: ProviderId, url: string) => {
      try {
        await openProviderLoginUrl(provider, url);
        return true;
      } catch (error) {
        show("error", getMessage(error));
        return false;
      }
    },
    [show]
  );

  const handleCancelProviderLogin = useCallback(
    async (provider: ProviderId) => {
      try {
        await cancelProviderLogin(provider);
      } catch (error) {
        show("error", getMessage(error));
      }
    },
    [show]
  );

  const handleSubmitProviderLoginCode = useCallback(
    async (provider: ProviderId, code: string) => {
      const value = code.trim();
      if (!value) return false;
      try {
        await submitProviderLoginCode(provider, value);
        return true;
      } catch (error) {
        show("error", getMessage(error));
        return false;
      }
    },
    [show]
  );

  const testProviderSilently = useCallback(
    async (provider: ProviderId, source: AppConfig) => {
      setProviderAction(provider, "test");
      try {
        mergeProvider(await testProvider(source, provider), source.providerPriority);
      } finally {
        setProviderAction(provider, null);
      }
    },
    [mergeProvider, setProviderAction]
  );

  const handleTestProvider = useCallback(
    async (provider: ProviderId) => {
      if (!config || providerBusy[provider]) return;
      try {
        await testProviderSilently(provider, config);
      } catch (error) {
        show("error", getMessage(error));
      }
    },
    [config, providerBusy, show, testProviderSilently]
  );

  const handleDisconnectProvider = useCallback(
    async (provider: ProviderId) => {
      if (!config || provider === "local_control" || providerBusy[provider]) return;
      setProviderAction(provider, "disconnect");
      try {
        // Nur KatoSync-eigene Secrets/Metadaten; die CLI-Anmeldung bleibt beim Provider.
        await disconnectProvider(provider);
        const saved = await persistProviderFields({
          disabledProviders: Array.from(new Set([...config.disabledProviders, provider]))
        });
        const status = (await getProviderStatuses(saved, false)).find((entry) => entry.provider === provider);
        if (status) mergeProvider(status, saved.providerPriority);
      } catch (error) {
        show("error", getMessage(error));
      } finally {
        setProviderAction(provider, null);
      }
    },
    [config, mergeProvider, persistProviderFields, providerBusy, setProviderAction, show]
  );

  const handleMoveProvider = useCallback(
    async (provider: ProviderId, direction: "up" | "down") => {
      if (!config) return;
      const next = moveProvider(config.providerPriority, provider, direction);
      if (next.join() === normalizeProviderPriority(config.providerPriority).join()) return;
      setConfig((current) => (current ? { ...current, providerPriority: next } : current));
      try {
        await persistProviderFields({ providerPriority: next });
      } catch (error) {
        show("error", getMessage(error));
      }
    },
    [config, persistProviderFields, show]
  );

  const updateLocalProviderDraft = useCallback(
    (patch: Partial<LocalProviderConfig>) => {
      setLocalProviderDraft((current) => {
        const base = current ?? config?.localProvider ?? defaultConfig.localProvider;
        return { ...base, ...patch };
      });
    },
    [config]
  );

  const handleDiscoverLocalProviders = useCallback(async () => {
    setProviderAction("local", "test");
    try {
      const found = await discoverLocalProviders();
      setDiscoveredLocal(found);
      const first = found[0];
      if (first && !(localProviderDraft ?? config?.localProvider)?.baseUrl) {
        updateLocalProviderDraft({ kind: first.kind, baseUrl: first.baseUrl, model: first.models[0] ?? "" });
      }
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setProviderAction("local", null);
    }
  }, [config, localProviderDraft, setProviderAction, show, updateLocalProviderDraft]);

  const handleSaveLocalProviderKey = useCallback(async () => {
    if (!config || providerBusy.local) return;
    const draft = localProviderDraft ?? config.localProvider;
    setLocalKeyError(null);
    setProviderAction("local", "key");
    try {
      await saveLocalProviderKey(draft.baseUrl, localKeyInput);
      setLocalKeyInput("");
      const saved = await persistProviderFields({ localProvider: draft });
      setLocalProviderDraft(null);
      mergeProvider(await testProvider(saved, "local"), saved.providerPriority);
    } catch (error) {
      setLocalKeyInput("");
      setLocalKeyError(getMessage(error));
    } finally {
      setProviderAction("local", null);
    }
  }, [config, localKeyInput, localProviderDraft, mergeProvider, persistProviderFields, providerBusy.local, setProviderAction]);

  const handleRemoveLocalProviderKey = useCallback(async () => {
    if (!config || providerBusy.local) return;
    setProviderAction("local", "key");
    try {
      await disconnectProvider("local");
      mergeProvider(await testProvider(config, "local"), config.providerPriority);
    } catch (error) {
      setLocalKeyError(getMessage(error));
    } finally {
      setProviderAction("local", null);
    }
  }, [config, mergeProvider, providerBusy.local, setProviderAction]);

  const registerLocalBrainProvider = useCallback(
    async (brain: LocalBrainStatus) => {
      if (!config || !brain.running) return;
      const localProvider: LocalProviderConfig = {
        kind: "open_ai_compatible",
        baseUrl: brain.endpoint,
        model: brain.modelAlias
      };
      const saved = await persistProviderFields({ localProvider });
      setLocalProviderDraft(null);
      mergeProvider(await testProvider(saved, "local"), saved.providerPriority);
    },
    [config, mergeProvider, persistProviderFields]
  );

  const handleInstallLocalBrain = useCallback(async () => {
    if (localBrainBusy) return;
    setLocalBrainBusy("install");
    setLocalBrainProgress(null);
    try {
      const installed = await installLocalBrain();
      setLocalBrainStatus(installed);
      setLocalBrainBusy("start");
      const started = await startLocalBrain();
      setLocalBrainStatus(started);
      await registerLocalBrainProvider(started);
      show("ok", "Kato Local Brain ist installiert, gestartet und als lokale Lane registriert.");
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setLocalBrainBusy(null);
    }
  }, [localBrainBusy, registerLocalBrainProvider, show]);

  const handleStartLocalBrain = useCallback(async () => {
    if (localBrainBusy) return;
    setLocalBrainBusy("start");
    try {
      const started = await startLocalBrain();
      setLocalBrainStatus(started);
      await registerLocalBrainProvider(started);
      show("ok", "Kato Local Brain läuft lokal.");
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setLocalBrainBusy(null);
    }
  }, [localBrainBusy, registerLocalBrainProvider, show]);

  const handleStopLocalBrain = useCallback(async () => {
    if (localBrainBusy) return;
    setLocalBrainBusy("stop");
    try {
      setLocalBrainStatus(await stopLocalBrain());
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setLocalBrainBusy(null);
    }
  }, [localBrainBusy, show]);

  const handleRemoveLocalBrain = useCallback(async () => {
    if (localBrainBusy) return;
    const approved = await askConfirm(
      "Kato Local Brain inklusive Modell und verwalteter llama.cpp-Runtime von diesem Rechner entfernen?",
      { title: "Local Brain entfernen", okLabel: "Entfernen", cancelLabel: "Abbrechen" }
    );
    if (!approved) return;
    setLocalBrainBusy("remove");
    try {
      setLocalBrainStatus(await removeLocalBrain());
      setLocalBrainProgress(null);
      show("ok", "Kato Local Brain wurde von diesem Rechner entfernt.");
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setLocalBrainBusy(null);
    }
  }, [localBrainBusy, show]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getLocalBrainStatus()
      .then((brain) => {
        if (!disposed && brain) setLocalBrainStatus(brain);
      })
      .catch(() => {
        // Nicht unterstuetzte Browser-/Testumgebung: lokale Anbieter bleiben weiterhin manuell nutzbar.
      });
    void listenLocalBrainProgress((progress) => {
      if (!disposed) setLocalBrainProgress(progress);
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Einmal pro App-Sitzung beim Oeffnen des Agent-Sync-Workspace real pruefen (Auth + READY).
  useEffect(() => {
    if (modeForStep(activeStep) !== "agentSync" || providerSmokeCheckedRef.current || !config) return;
    providerSmokeCheckedRef.current = true;
    void handleRefreshProviders(true);
  }, [activeStep, config, handleRefreshProviders]);

  // Fallback-Link, falls der Browser beim offiziellen Login nicht automatisch aufgeht.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listenProviderLoginUrls((event) => {
      setProviderLoginUrls((current) => ({ ...current, [event.provider]: event.url }));
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Sparsamer Auto-Re-Check (providerPolicy.providerRecheckPlan): billige Auth-/Status-Checks
  // halten Provider-Karten hoechstens 10 Minuten alt; teure READY-Tests laufen nur fuer wartende
  // Arbeit am gemeldeten Reset-Zeitpunkt (ohne Hinweis hoechstens alle 30 Minuten).
  const configRef = useRef<AppConfig | null>(null);
  configRef.current = config;
  const providerBusyRef = useRef(providerBusy);
  providerBusyRef.current = providerBusy;
  const lastReadyProbeRef = useRef<Partial<Record<ProviderId, string>>>({});
  useEffect(() => {
    const timer = window.setInterval(() => {
      const source = configRef.current;
      if (!source) return;
      const nowMs = Date.now();
      const plan = providerRecheckPlan(providerStatusesRef.current, {
        nowMs,
        waitingWork: agentWorkWaiting(agentSyncRef.current),
        lastReadyProbeAt: lastReadyProbeRef.current
      });
      const idle = (provider: ProviderId) => !providerBusyRef.current[provider];
      for (const provider of plan.ready.filter(idle)) {
        lastReadyProbeRef.current = { ...lastReadyProbeRef.current, [provider]: new Date(nowMs).toISOString() };
        void testProviderSilently(provider, source).catch(() => undefined);
      }
      const cheap = plan.cheap.filter(idle);
      if (!cheap.length) return;
      void getProviderStatuses(source, false)
        .then((probe) => {
          const next = providerStatusesRef.current.map((current) => {
            if (!cheap.includes(current.provider)) return current;
            const health = probe.find((entry) => entry.provider === current.provider);
            return health ? mergeCheapProviderHealth(current, health) : current;
          });
          applyProviderSnapshot(next);
        })
        .catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [applyProviderSnapshot, testProviderSilently]);

  // Begrenzter Abo-Provider-Warm-up (providerWarmupPolicy): hoechstens ein winziger READY-Prompt je
  // Provider und ~5-h-Fenster, nur ohne laufende/wartende Arbeit. Das Ergebnis aendert weder
  // Provider-Karten noch Routing – ein Fehlschlag ist folgenlos und loest nie Failover aus.
  const warmupStateRef = useRef<ProviderWarmupState | null>(null);
  const warmupInFlightRef = useRef(false);
  const tryProviderWarmup = useCallback(async () => {
    const source = configRef.current;
    if (!source || warmupInFlightRef.current) return;
    if (!warmupStateRef.current) {
      try {
        warmupStateRef.current = await getProviderWarmupState();
      } catch {
        return;
      }
    }
    const plan = providerWarmupPlan(providerStatusesRef.current, {
      enabled: source.providerWarmupEnabled,
      workBusy: warmupSuppressedByWork(
        agentSyncRef.current,
        autoDispatchingRef.current || queueStartingRef.current || manualRunRef.current > 0
      ),
      inFlight: warmupInFlightRef.current,
      state: warmupStateRef.current,
      providerBusy: providerBusyRef.current
    });
    if (!plan.provider) return;
    warmupInFlightRef.current = true;
    try {
      const report = await warmUpProvider(plan.provider);
      if (report) warmupStateRef.current = report.state;
    } catch {
      // Warm-up ist best effort; der naechste Takt liest den persistierten Zustand neu.
      warmupStateRef.current = null;
    } finally {
      warmupInFlightRef.current = false;
    }
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => void tryProviderWarmup(), 60_000);
    return () => window.clearInterval(timer);
  }, [tryProviderWarmup]);
  // Sobald ein Abo-Provider angemeldet/verfuegbar wird, nicht erst auf den naechsten Takt warten.
  useEffect(() => {
    void tryProviderWarmup();
  }, [providerStatuses, tryProviderWarmup]);

  const saveDraftKeyIfNeeded = useCallback(async () => {
    const draft = keyInput.trim();
    if (!draft) return;
    const nextStatus = await saveApiKey(draft);
    setKeyStatus(nextStatus);
    setKeyInput("");
    void pushCloudProfile();
  }, [keyInput, pushCloudProfile]);

  const handleChooseFolders = useCallback(async () => {
    if (!config) return;
    const selected = await chooseFolders();
    if (!selected.length) return;
    updateConfig("sourceRoots", Array.from(new Set([...config.sourceRoots, ...selected])));
    show("info", `${selected.length} Ordner hinzugefügt.`);
  }, [config, show, updateConfig]);

  const handleSaveKey = useCallback(async () => {
    setBusy("key");
    try {
      setKeyStatus(await saveApiKey(keyInput));
      setKeyInput("");
      show("ok", "API-Key sicher gespeichert.");
      void pushCloudProfile();
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [keyInput, pushCloudProfile, show]);

  const handleDeleteKey = useCallback(async () => {
    setKeyStatus(await deleteApiKey());
    setConnectionOk(false);
    setLibraryOk(false);
    show("info", "API-Key gelöscht.");
  }, [show]);

  const handleSaveMcpConnectorToken = useCallback(async () => {
    setBusy("mcp-token");
    try {
      setMcpTokenStatus(await saveMcpConnectorToken(mcpTokenInput));
      setMcpTokenInput("");
      show("ok", "MCP Connector Token sicher gespeichert.");
      if (config) setActionPlans(await loadActionPlans(config));
      void pushCloudProfile();
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [config, mcpTokenInput, pushCloudProfile, show]);

  const handleDeleteMcpConnectorToken = useCallback(async () => {
    setMcpTokenStatus(await deleteMcpConnectorToken());
    setGeneratedToken(null);
    setActionPlans(await loadActionPlans());
    show("info", "MCP Connector Token gelöscht.");
  }, [show]);

  const handleLogin = useCallback(async () => {
    setBusy("login");
    try {
      const status = await loginSupabase(loginEmail, loginPassword);
      if (!status.loggedIn) {
        setSessionStatus(status);
        return;
      }
      {
        // Passwort liegt NUR hier vor -> Cloud-Profil holen/entschluesseln/anwenden (oder anlegen).
        try {
          const sync = await cloudProfileSyncAfterLogin(baseUrlOf(), loginPassword);
          if (sync.status === "restored") {
            show(
              "ok",
              "Angemeldet. Cloud-Profil wiederhergestellt — falls der MCP-Connector nicht verbindet, generiere den Token neu."
            );
          } else if (sync.status === "unreadable") {
            show(
              "warn",
              "Angemeldet. Dein Cloud-Profil ließ sich nicht entschlüsseln (z. B. nach Passwort-Reset) — bitte API-Key neu eingeben, er wird dann neu gesichert."
            );
          } else {
            show("ok", `Angemeldet als ${status.email ?? loginEmail}.`);
          }
        } catch (error) {
          show("warn", `Angemeldet, aber das Cloud-Profil konnte nicht geladen werden: ${getMessage(error)}`);
        }
        setLoginPassword("");
        await boot();
        // Robust: Session garantiert auf eingeloggt setzen, AUCH falls boot() (z.B. Platten-/Keychain-
        // Fehler) scheitert -> der authentifizierte Nutzer landet nie faelschlich wieder auf dem LoginGate.
        setSessionStatus(status);
      }
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [baseUrlOf, boot, loginEmail, loginPassword, show]);

  const handleRegister = useCallback(async () => {
    setBusy("register");
    try {
      const status = await signupSupabase(loginEmail, loginPassword);
      if (status.loggedIn) {
        // Direkt angemeldet (Projekt ohne E-Mail-Bestaetigung) -> Cloud-Profil anlegen/holen.
        try {
          await cloudProfileSyncAfterLogin(baseUrlOf(), loginPassword);
        } catch (error) {
          show("warn", `Registriert, aber die Cloud-Profil-Initialisierung schlug fehl: ${getMessage(error)}`);
        }
        setLoginPassword("");
        await boot();
        setSessionStatus(status); // robust gegen boot()-Fehler (siehe handleLogin)
        show("ok", `Registriert und angemeldet als ${status.email ?? loginEmail}.`);
      } else {
        setSessionStatus(status);
        show(
          "info",
          "Falls die Adresse neu ist, haben wir dir eine Bestätigungs-Mail geschickt. Hast du bereits ein Konto, melde dich einfach an."
        );
      }
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [baseUrlOf, boot, loginEmail, loginPassword, show]);

  const handleRecoverPassword = useCallback(async () => {
    if (!loginEmail.trim()) {
      show("warn", "Bitte zuerst deine E-Mail-Adresse eingeben.");
      return;
    }
    setBusy("recover");
    try {
      await recoverSupabase(loginEmail);
      show("ok", "Falls ein Konto mit dieser Adresse existiert, haben wir dir eine E-Mail zum Zurücksetzen geschickt.");
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [loginEmail, show]);

  const handleGenerateConnectorToken = useCallback(async () => {
    if (!config) return;
    setBusy("mint-token");
    try {
      const result = await generateConnectorToken(config);
      setMcpTokenStatus(result.status);
      setGeneratedToken(result.token);
      show("ok", "Connector-Token generiert. Jetzt kopieren und in Mistral eintragen.");
      setActionPlans(await loadActionPlans(config));
      setBriefings(await loadBriefings(config));
      void pushCloudProfile();
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [config, pushCloudProfile, show]);

  const handleCopyToken = useCallback(async () => {
    if (!generatedToken) return;
    try {
      await navigator.clipboard.writeText(generatedToken);
      show("ok", "Token in die Zwischenablage kopiert.");
    } catch {
      show("info", "Bitte den Token im Feld markieren und manuell kopieren.");
    }
  }, [generatedToken, show]);

  const handleTestConnection = useCallback(async () => {
    setBusy("connection");
    try {
      await saveDraftKeyIfNeeded();
      const result = await testConnection(keyInput || undefined);
      setRateLimits(result.rateLimits);
      setConnectionOk(true);
      show("ok", result.message);
    } catch (error) {
      setConnectionOk(false);
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [keyInput, saveDraftKeyIfNeeded, show]);

  const handleTestLibrary = useCallback(async () => {
    if (!config) return;
    setBusy("library");
    try {
      await saveDraftKeyIfNeeded();
      const result = await testLibrary(config.libraryId, keyInput || undefined);
      setRateLimits(result.rateLimits);
      setLibraryOk(true);
      show("ok", result.message);
    } catch (error) {
      setLibraryOk(false);
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [config, keyInput, saveDraftKeyIfNeeded, show]);

  const handleScan = useCallback(async () => {
    if (!config) return;
    setBusy("scan");
    show("info", "Scan läuft. KatoSync prüft die ausgewählten Ordner.");
    await waitForPaint();
    try {
      const result = await scanProject(config);
      setScan(result);
      show("ok", `${result.relevantFiles} relevante Dateien gefunden.`);
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [config, show]);

  const handleRun = useCallback(
    async (dryRun: boolean) => {
      if (!config) return;
      // Ohne verbundenen Quellordner gar nicht erst starten -> klarer Fehler statt ewigem Spinner.
      if (!config.sourceRoots.some((root) => root.trim().length > 0)) {
        show("error", "Kein Quellordner verbunden. Bitte zuerst in den Einstellungen einen Ordner hinzufügen.");
        return;
      }
      setBusy(dryRun ? "dry-run" : "sync");
      setSyncStatus(null);
      show(
        "info",
        dryRun
          ? "Dry-Run läuft. KatoSync erzeugt die CURRENT-Dateien."
          : "Upload läuft. KatoSync sendet die freigegebenen Dateien an Mistral."
      );
      await waitForPaint();
      try {
        await saveDraftKeyIfNeeded();
        const savedConfig = await saveConfig(config);
        setConfig(savedConfig);
        const result = await runSync(config, dryRun);
        setReport(result);
        setScan(result.scan);
        const latestLimits = dedupRateLimits(result.uploaded.flatMap((upload) => upload.rateLimits || []));
        if (latestLimits.length) setRateLimits(latestLimits);
        show(result.errors.length ? "warn" : "ok", dryRun ? "Dry-Run abgeschlossen." : "Sync abgeschlossen.");
      } catch (error) {
        show("error", getMessage(error));
      } finally {
        setBusy(null);
        setSyncStatus(null);
      }
    },
    [config, saveDraftKeyIfNeeded, show]
  );

  const handleLaunchInstall = useCallback(async () => {
    if (!config) return;
    setBusy("launch");
    try {
      const status = await installLaunchAgent(config);
      setLaunchStatus(status);
      show("ok", status.message);
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [config, show]);

  const handleLaunchRemove = useCallback(async () => {
    setBusy("launch");
    try {
      const status = await removeLaunchAgent();
      setLaunchStatus(status);
      show("info", status.message);
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [show]);

  const handleLogs = useCallback(async () => {
    setBusy("logs");
    try {
      setLogs(await readLogs());
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [show]);

  const handleRefreshActionPlans = useCallback(async () => {
    setBusy("action-plans");
    try {
      setActionPlans(await loadActionPlans(config ?? undefined));
      show("ok", "Aufgaben aktualisiert.");
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [config, show]);

  const handleRefreshBriefings = useCallback(async () => {
    setBusy("briefings");
    try {
      setBriefings(await loadBriefings(config ?? undefined));
      show("ok", "Briefings aktualisiert.");
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [config, show]);

  const handleReviewActionPlan = useCallback(
    async (planId: string) => {
      setActionPlans(await updateActionPlanStatus(config, planId, "in_review"));
      show("info", "Action Plan ist zur Prüfung markiert.");
    },
    [config, show]
  );

  const handleRejectActionPlan = useCallback(
    async (planId: string) => {
      setBusy("board");
      try {
        setActionPlans(await updateActionPlanStatus(config, planId, "rejected"));
        show("info", "Plan abgelehnt. Es wird lokal nichts ausgeführt.");
      } catch (error) {
        show("error", getMessage(error));
      } finally {
        setBusy(null);
      }
    },
    [config, show]
  );

  const handleStartActionPlan = useCallback(
    async (planId: string) => {
      setBusy("board");
      try {
        setActionPlans(await updateActionPlanStatus(config, planId, "approved"));
        show("ok", "Plan freigegeben. Ausführbare Aufgaben kannst du jetzt starten.");
      } catch (error) {
        show("error", getMessage(error));
      } finally {
        setBusy(null);
      }
    },
    [config, show]
  );

  // Repo-pro-Projekt: gemerkten Ordner nutzen; nur fragen, wenn unbekannt/verschwunden -> dann merken.
  const resolveRepoForProject = useCallback(
    async (projectId: string): Promise<string | null> => {
      if (!config) return null;
      const stored = repoPathFor(projectsRegistryRef.current, config.projectRepos, projectId) ?? undefined;
      if (stored && (await dirExists(stored))) return stored;
      // Sicherheit (Multi-Rechner): kein gemerkter Ordner auf DIESEM Rechner. Statt still den
      // Ordner-Dialog zu oeffnen (und ggf. im falschen Ordner loszulaufen) erst bewusst rueckfragen —
      // der Kontext/Verlauf eines auf einem anderen Rechner erstellten Briefings fehlt hier.
      const proceed = await askConfirm(
        `Für diesen Lauf ist auf »${config.device.deviceName}« noch kein Arbeits-Ordner hinterlegt.\n\n` +
          "Falls dieses Briefing bzw. diese Aufgabe auf einem anderen Rechner entstanden ist, fehlen hier die zugehörigen Dateien und der Verlauf — der Lauf hätte keinen Kontext.\n\n" +
          "Trotzdem auf diesem Rechner einen Ordner wählen?",
        {
          title: "Kein Arbeits-Ordner auf diesem Rechner",
          okLabel: "Ordner wählen",
          cancelLabel: "Abbrechen"
        }
      );
      if (!proceed) return null;
      const picked = await chooseRepoFolder(stored ?? config.sourceRoots[0]);
      if (!picked) return null;
      const nextConfig: AppConfig = {
        ...config,
        projectRepos: { ...(config.projectRepos ?? {}), [projectId]: picked }
      };
      try {
        setConfig(await saveConfig(nextConfig));
      } catch {
        setConfig(nextConfig);
      }
      return picked;
    },
    [config]
  );

  const handleChooseReferenceRoot = useCallback(async () => {
    if (!config) return;
    const picked = await chooseRepoFolder(config.referenceRoot || config.sourceRoots[0]);
    if (picked) updateConfig("referenceRoot", picked);
  }, [config, updateConfig]);

  const handleForgetProjectRepo = useCallback(
    async (projectId: string) => {
      if (!config) return;
      const next = { ...(config.projectRepos ?? {}) };
      delete next[projectId];
      const nextConfig: AppConfig = { ...config, projectRepos: next };
      try {
        setConfig(await saveConfig(nextConfig));
      } catch {
        setConfig(nextConfig);
      }
      show("info", "Projekt-Ordner entfernt. Beim nächsten Lauf fragt KatoSync erneut.");
    },
    [config, show]
  );

  // Registry-Projekt bzw. einen konkreten Worktree ausdruecklich als Arbeitsordner festlegen.
  // Die Registry waehlt nie still einen Ausfuehrungsordner; bei mehreren Targets entscheidet der Mensch sichtbar.
  const handleUseProjectFolder = useCallback(
    async (projectId: string, worktreePath?: string, targetLabel?: string, dirtyCount = 0) => {
      const source = configRef.current;
      const project = projectsRegistryRef.current.projects.find((entry) => entry.id === projectId);
      if (!source || !project) return;
      const path = worktreePath ?? project.rootPath;
      const target = targetLabel ? `\n\nTarget: ${targetLabel}` : "";
      const dirtyWarning =
        dirtyCount > 0
          ? `\n\nAchtung: Dieser Worktree hat aktuell ${dirtyCount} lokale Änderung${dirtyCount === 1 ? "" : "en"}. KatoSync wird sie nicht löschen, aber ein sauberer Worktree ist für automatische Aufgaben sicherer.`
          : "";
      const confirmed = await askConfirm(
        `„${project.name}“ als Arbeitsordner für Aufgaben verwenden?${target}\n\nOrdner: ${path}${dirtyWarning}\n\nBeim Start einer Aufgabe arbeitet der Runner in genau diesem Ordner. Verwende für Auto-Lanes möglichst einen sauberen, passend zum Zielsystem ausgewählten Worktree.`,
        { title: "Arbeitsordner festlegen", okLabel: "Festlegen", cancelLabel: "Abbrechen" }
      );
      if (!confirmed) return;
      const nextConfig: AppConfig = {
        ...source,
        projectRepos: { ...(source.projectRepos ?? {}), [project.id]: path }
      };
      try {
        setConfig(await saveConfig(nextConfig));
      } catch {
        setConfig(nextConfig);
      }
      show("ok", `Arbeitsordner für ${project.name}${targetLabel ? ` · ${targetLabel}` : ""} festgelegt.`);
    },
    [show]
  );

  // Kern-Codex-Lauf OHNE Ordnerdialog (vom Einzel-Button UND vom Board-Executor genutzt).
  const runCodexForTaskWithRepo = useCallback(
    async (
      plan: ActionPlan,
      task: ActionTask,
      repoPath: string,
      runner?: AutoLaneRunner,
      trackPrimaryRun = true
    ): Promise<CodexRunResult> => {
      if (!config) throw new Error("Keine Konfiguration geladen.");
      const selectedRunner = runner ?? config.codexPreferredRunner;
      const startedAt = new Date().toISOString();
      if (trackPrimaryRun) {
        setCodexEvents([]);
        setCodexRun({
          status: "running",
          startedAt,
          lastActivityAt: startedAt,
          context: {
            jobId: task.taskId,
            projectId: task.projectId,
            task: task.title,
            source: "action_plan",
            planId: plan.planId,
            createdAt: plan.createdAt,
            runner: selectedRunner
          }
        });
      }
      const result = await runCodexTask({
        baseUrl: config.mcp.baseUrl,
        repoPath,
        trigger: "action_task",
        actionPlanId: plan.planId,
        actionTaskId: task.taskId,
        projectId: task.projectId,
        priority: task.priority,
        title: task.title,
        riskLevel: task.riskLevel,
        prompt: buildCodexPromptFromTask(plan, task),
        inputPlan: {
          trigger: "action_task",
          source: plan.source,
          agentName: plan.agentName,
          planId: plan.planId,
          taskId: task.taskId,
          title: task.title,
          summary: task.summary,
          taskType: task.taskType,
          projectId: task.projectId,
          riskLevel: task.riskLevel
        },
        runner: selectedRunner
      });
      if (trackPrimaryRun) {
        setCodexRun((current) => ({
          ...current,
          status: result.status === "completed" ? "completed" : "failed",
          lastActivityAt: new Date().toISOString(),
          result
        }));
      }
      return result;
    },
    [config]
  );

  // Manuelle Einzel-Laeufe und der Auto-Dispatcher teilen sich den einen Runner-Writer.
  const guardManualRun = useCallback(
    async (run: () => Promise<void>) => {
      if (autoDispatchingRef.current) {
        show("warn", "Auto Mode führt gerade eine Aufgabe aus. Bitte warten, bis sie fertig ist.");
        return;
      }
      manualRunRef.current += 1;
      try {
        await run();
      } finally {
        manualRunRef.current -= 1;
      }
    },
    [show]
  );

  const runCodexForTaskManually = useCallback(
    async (plan: ActionPlan, task: ActionTask) => {
      if (!config) return;
      const repoPath = await resolveRepoForProject(task.projectId);
      if (!repoPath) return;
      setBusy("codex-run");
      try {
        await updateActionTaskStatus(config, task.taskId, "running");
        const result = await runCodexForTaskWithRepo(plan, task, repoPath);
        const ok = result.status === "completed";
        // Modus autoritativ aus dem Lauf (Fallback: aktuelle Config). Coding-Modus: 'executed'
        // (wartet auf PR-Merge). Datei-Modus: direkt 'completed' (kein Push/Merge).
        const isFileMode = result.fileMode ?? !config.codexCodingMode;
        const finalStatus = ok ? (isFileMode ? "completed" : "executed") : "failed";
        setActionPlans(
          await updateActionTaskStatus(config, task.taskId, finalStatus, {
            prUrl: result.prUrl ?? null,
            branch: result.branch ?? null
          })
        );
        show(
          ok ? "ok" : "warn",
          ok
            ? `Ausgeführt: ${result.changedFiles.length} Datei(en) auf Branch ${result.branch}.${result.prUrl ? " PR offen." : ""}`
            : `Codex-Lauf fehlgeschlagen: ${result.error ?? "unbekannt"}`
        );
      } catch (error) {
        setCodexRun((current) => ({ ...current, status: "failed", lastActivityAt: new Date().toISOString(), error: getMessage(error) }));
        await updateActionTaskStatus(config, task.taskId, "failed").catch(() => undefined);
        setActionPlans(await loadActionPlans(config));
        show("error", getMessage(error));
      } finally {
        setBusy(null);
      }
    },
    [config, resolveRepoForProject, runCodexForTaskWithRepo, show]
  );

  const handleRunCodexForTask = useCallback(
    (plan: ActionPlan, task: ActionTask) => guardManualRun(() => runCodexForTaskManually(plan, task)),
    [guardManualRun, runCodexForTaskManually]
  );

  const runCodexForBriefingManually = useCallback(
    async (briefing: Briefing) => {
      if (!config) return;
      const repoPath = await resolveRepoForProject("katosync");
      if (!repoPath) return;
      const startedAt = new Date().toISOString();
      setBusy("codex-run");
      setCodexEvents([]);
      setCodexRun({
        status: "running",
        startedAt,
        lastActivityAt: startedAt,
        context: {
          jobId: briefing.briefingId,
          projectId: "katosync",
          task: briefing.title,
          source: "briefing",
          createdAt: briefing.createdAt
        }
      });
      try {
        const result = await runCodexTask({
          baseUrl: config.mcp.baseUrl,
          repoPath,
          trigger: "briefing",
          briefingId: briefing.briefingId,
          projectId: "katosync",
          priority: 1,
          title: briefing.title,
          riskLevel: "medium",
          prompt: buildCodexPromptFromBriefing(briefing),
          inputPlan: {
            trigger: "briefing",
            source: briefing.source,
            agentName: briefing.agentName,
            briefingId: briefing.briefingId,
            title: briefing.title,
            summary: briefing.summary,
            suggestedAction: briefing.suggestedAction
          },
          runner: config.codexPreferredRunner
        });
        setCodexRun((current) => ({
          ...current,
          status: result.status === "completed" ? "completed" : "failed",
          lastActivityAt: new Date().toISOString(),
          result
        }));
        show(
          result.status === "completed" ? "ok" : "warn",
          result.status === "completed"
            ? `Codex fertig: ${result.changedFiles.length} Datei(en) auf Branch ${result.branch}.`
            : `Codex-Lauf fehlgeschlagen: ${result.error ?? "unbekannt"}`
        );
        setBriefings(await updateBriefingStatus(config, briefing.briefingId, "queued"));
      } catch (error) {
        setCodexRun((current) => ({ ...current, status: "failed", lastActivityAt: new Date().toISOString(), error: getMessage(error) }));
        show("error", getMessage(error));
      } finally {
        setBusy(null);
      }
    },
    [config, resolveRepoForProject, show]
  );

  const handleRunCodexForBriefing = useCallback(
    (briefing: Briefing) => guardManualRun(() => runCodexForBriefingManually(briefing)),
    [guardManualRun, runCodexForBriefingManually]
  );

  // ===== Projekt-Board / lokale Project-Work-Pläne =====
  const effectiveActionPlans = useMemo(
    () => [...actionPlans, ...projectWorkPlans],
    [actionPlans, projectWorkPlans]
  );

  // Das alte Mistral-Projektboard bleibt serverseitig. Lokale AutoQ-Pläne erscheinen nur
  // in Agent Sync/Auto-Lanes und werden nie versehentlich über MCP-Board-Mutationen geschrieben.
  const boardGroups = useMemo<BoardGroup[]>(
    () => groupTasksByProject(actionPlans, boardSelection, boardOrder, projects.registry),
    [actionPlans, boardSelection, boardOrder, projects.registry]
  );

  const boardDailyLimit = useMemo(() => {
    const limits = effectiveActionPlans
      .filter((plan) => plan.status === "approved")
      .map((plan) => plan.dailyLimit)
      .filter((value) => Number.isFinite(value) && value > 0);
    return limits.length ? Math.max(...limits) : 3;
  }, [effectiveActionPlans]);

  // Selektion/Reihenfolge bereinigen, sobald ein Task das aktive Board verlaesst ODER heute
  // keinem aktuellen Fokusprojekt mehr zugeordnet ist. Manuelle aktuelle Projekte bleiben fuer
  // bewusste Handarbeit sichtbar; parked/archived/unmapped Altarbeit (z. B. Telefon/Twilio) fliegt raus.
  useEffect(() => {
    // Vor dem ersten Laden sind keine Plans da: die persistierte Auswahl nicht leerraeumen.
    if (!effectiveActionPlans.length) return;
    const activeIds = new Set<string>();
    for (const plan of effectiveActionPlans) {
      for (const task of plan.tasks) {
        if (task.status === "completed" || task.status === "rejected") continue;
        const focus = evaluateFocus(projects.focusPolicy, task.projectId);
        if (focus.allowed || focus.reason === "project_manual") activeIds.add(task.taskId);
      }
    }
    setBoardSelection((prev) => prev.filter((id) => activeIds.has(id)));
    setBoardOrder((prev) => prev.filter((id) => activeIds.has(id)));
  }, [effectiveActionPlans, projects.focusPolicy]);

  useEffect(() => {
    writeBoardSelection(boardOrder);
  }, [boardOrder]);

  const handleSelectTask = useCallback((taskId: string) => {
    setBoardSelection((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
    setBoardOrder((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  }, []);

  const handleReorderTask = useCallback((taskId: string, dir: "up" | "down") => {
    setBoardOrder((prev) => {
      const index = prev.indexOf(taskId);
      if (index === -1) return prev;
      const target = dir === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  // Board-Mutationen setzen busy -> alle Board-Buttons (inkl. Start/Aktualisieren) sind waehrend der
  // Mutation deaktiviert: keine ueberlappenden Status-Updates (Last-Writer-Wins-Overwrite), keine
  // Doppelklicks, kein Start/Refresh mitten in einer Mutation. Fehler werden gemeldet statt still.
  const handleDeferTask = useCallback(
    async (taskId: string) => {
      setBusy("board");
      try {
        setActionPlans(await updateActionTaskStatus(config, taskId, "deferred"));
        setBoardSelection((prev) => prev.filter((id) => id !== taskId));
        setBoardOrder((prev) => prev.filter((id) => id !== taskId));
        show("info", "Aufgabe aufgeschoben.");
      } catch (error) {
        show("error", getMessage(error));
      } finally {
        setBusy(null);
      }
    },
    [config, show]
  );

  const handleRejectTask = useCallback(
    async (taskId: string) => {
      setBusy("board");
      try {
        setActionPlans(await updateActionTaskStatus(config, taskId, "rejected"));
        setBoardSelection((prev) => prev.filter((id) => id !== taskId));
        setBoardOrder((prev) => prev.filter((id) => id !== taskId));
        show("info", "Aufgabe entfernt.");
      } catch (error) {
        show("error", getMessage(error));
      } finally {
        setBusy(null);
      }
    },
    [config, show]
  );

  const handleResumeTask = useCallback(
    async (taskId: string) => {
      setBusy("board");
      try {
        setActionPlans(await updateActionTaskStatus(config, taskId, "pending"));
        show("info", "Aufgabe wieder eingeplant.");
      } catch (error) {
        show("error", getMessage(error));
      } finally {
        setBusy(null);
      }
    },
    [config, show]
  );

  // Fortsetzbare Runner-Session: öffnet den letzten Lauf interaktiv im Terminal (voller Verlauf +
  // die Connectoren des Nutzers). Rust schreibt die .command-Datei und startet Terminal.app.
  const handleResumeRunnerSession = useCallback(
    async (repoPath: string, runner: string, sessionId: string | null) => {
      try {
        await resumeRunnerSession(repoPath, runner, sessionId);
        show("info", "Session wird im Terminal fortgesetzt.");
      } catch (error) {
        show("error", getMessage(error));
      }
    },
    [show]
  );

  const handleStopBoardQueue = useCallback(() => {
    stopRef.current = true;
    show("info", "Queue stoppt nach der laufenden Aufgabe.");
  }, [show]);

  // Abschluss: manuell als erledigt markieren (z.B. Aufgaben ohne Repo/GitHub oder verifiziert).
  const handleMarkTaskDone = useCallback(
    async (taskId: string) => {
      setBusy("board");
      try {
        setActionPlans(await updateActionTaskStatus(config, taskId, "completed"));
        show("ok", "Aufgabe als erledigt markiert.");
      } catch (error) {
        show("error", getMessage(error));
      } finally {
        setBusy(null);
      }
    },
    [config, show]
  );

  // Abschluss: einen ausgefuehrten Task gegen GitHub/Git pruefen (gemerged -> erledigt, geschlossen -> verworfen).
  const handleCheckTaskCompletion = useCallback(
    async (task: ActionTask) => {
      if (!config) return;
      setBusy("check-completions");
      try {
        const repoPath = repoPathFor(projectsRegistryRef.current, config.projectRepos, task.projectId) ?? "";
        const state = await checkCodexTask(repoPath, task.branch ?? "", task.prUrl ?? "");
        if (state === "merged") {
          setActionPlans(await updateActionTaskStatus(config, task.taskId, "completed"));
          show("ok", "PR gemerged → Aufgabe erledigt.");
        } else if (state === "closed") {
          setActionPlans(await updateActionTaskStatus(config, task.taskId, "rejected"));
          show("info", "PR ohne Merge geschlossen → Aufgabe verworfen.");
        } else {
          show("info", "Noch kein Merge erkannt (PR offen).");
        }
      } finally {
        setBusy(null);
      }
    },
    [config, show]
  );

  // Abschluss: alle ausgefuehrten Tasks mit PR/Branch pruefen (Button + automatisch beim Board-Oeffnen).
  const handleCheckCompletions = useCallback(
    async (manual = false) => {
      if (!config) return;
      const executed = effectiveActionPlans
        .flatMap((plan) =>
          plan.tasks.map((task) => ({
            task,
            localProjectWork: isProjectWorkPlan(plan)
          }))
        )
        .filter(({ task }) => task.status === "executed" && (task.prUrl || task.branch));
      if (!executed.length) {
        if (manual) show("info", "Keine ausgeführten Aufgaben mit PR/Branch zu prüfen.");
        return;
      }
      if (manual) setBusy("check-completions");
      try {
        let changed = 0;
        let remoteChanged = false;
        for (const { task, localProjectWork } of executed) {
          const repoPath = repoPathFor(projectsRegistryRef.current, config.projectRepos, task.projectId) ?? "";
          const state = await checkCodexTask(repoPath, task.branch ?? "", task.prUrl ?? "");
          const finalStatus = state === "merged" ? "completed" : state === "closed" ? "rejected" : null;
          if (!finalStatus) continue;
          if (localProjectWork) {
            commitProjectWorkPlans((plans) => updateProjectWorkTask(plans, task.taskId, finalStatus));
          } else {
            await updateActionTaskStatus(config, task.taskId, finalStatus);
            remoteChanged = true;
          }
          changed += 1;
        }
        if (remoteChanged) setActionPlans(await loadActionPlans(config));
        if (changed) {
          show("ok", `${changed} Aufgabe(n) aktualisiert (gemerged/geschlossen).`);
        } else if (manual) {
          show("info", "Noch nichts gemerged/geschlossen.");
        }
      } finally {
        if (manual) setBusy(null);
      }
    },
    [commitProjectWorkPlans, config, effectiveActionPlans, show]
  );

  // On-demand: beim Betreten des Projekt-Boards einmal automatisch pruefen.
  const boardEnteredRef = useRef(false);
  useEffect(() => {
    if (activeStep === "projectBoard") {
      if (!boardEnteredRef.current) {
        boardEnteredRef.current = true;
        void handleCheckCompletions(false);
      }
    } else {
      boardEnteredRef.current = false;
    }
  }, [activeStep, handleCheckCompletions]);

  // Sequentieller Executor PRO PROJEKT-SPALTE: ein Repo-Ordner je Lauf, ein Task nach dem anderen.
  const handleStartBoardQueue = useCallback(
    async (projectId: string) => {
      if (!config || queueRunning || queueStartingRef.current) return;
      if (autoDispatchingRef.current) {
        show("warn", "Auto Mode führt gerade eine Aufgabe aus. Die Queue startet danach.");
        return;
      }
      // Ein Writer zur Zeit: laeuft bereits ein Handoff/Orchestrator/Writer, startet nichts Zweites.
      const safety = agentSyncRef.current?.startSafety;
      if (safety && !safety.safe) {
        show("warn", `Start gesperrt (${safety.reason}): ein anderer Agent-Job arbeitet bereits oder keine Lane ist frei.`);
        return;
      }
      queueStartingRef.current = true;
      try {
      const group = boardGroups.find((entry) => entry.projectId === projectId);
      if (!group) return;
      const ordered = group.tasks
        .filter(
          (task) =>
            task.selected &&
            task.approved &&
            task.targetRunner === "codex_cli" &&
            task.riskLevel !== "critical" &&
            !["executed", "completed", "rejected", "deferred", "running"].includes(task.status)
        )
        .sort((a, b) => a.orderIndex - b.orderIndex);

      if (!ordered.length) {
        show("warn", "Keine ausgewählten, ausführbaren Codex-Aufgaben in diesem Projekt.");
        return;
      }

      let done = readDailyCount();
      if (done >= boardDailyLimit) {
        show("warn", `Tageslimit (${boardDailyLimit}) bereits erreicht.`);
        return;
      }

      const repoPath = await resolveRepoForProject(projectId);
      if (!repoPath) return;

      stopRef.current = false;
      setQueueRunning(true);
      try {
        for (const task of ordered) {
          if (stopRef.current) break;
          if (done >= boardDailyLimit) {
            show("warn", `Tageslimit (${boardDailyLimit}) erreicht. Queue gestoppt.`);
            break;
          }
          if (task.status === "deferred") continue;

          const plan = actionPlans.find((entry) => entry.planId === task.planId);
          if (!plan) continue;

          setCurrentQueueTaskId(task.taskId);
          try {
            await updateActionTaskStatus(config, task.taskId, "queued");
            await updateActionTaskStatus(config, task.taskId, "running");
            const result = await runCodexForTaskWithRepo(plan, task, repoPath);
            if (result.status === "completed") {
              // Modus autoritativ aus dem Lauf (Fallback: aktuelle Config).
              // Coding-Modus: 'executed' (wartet auf Merge). Datei-Modus: direkt 'completed'.
              const isFileMode = result.fileMode ?? !config.codexCodingMode;
              await updateActionTaskStatus(config, task.taskId, isFileMode ? "completed" : "executed", {
                prUrl: result.prUrl ?? null,
                branch: result.branch ?? null
              });
              done += 1;
              writeDailyCount(done);
              setDailyCount(done);
            } else {
              await updateActionTaskStatus(config, task.taskId, "failed");
              // Fehlerpolitik: Queue laeuft weiter (Task bleibt failed).
              show("warn", `Aufgabe fehlgeschlagen: ${task.title}. Queue läuft weiter.`);
            }
          } catch (error) {
            await updateActionTaskStatus(config, task.taskId, "failed").catch(() => undefined);
            show("warn", `Aufgabe abgebrochen: ${task.title}. Queue läuft weiter.`);
          }
        }
      } finally {
        setQueueRunning(false);
        setCurrentQueueTaskId(null);
        setActionPlans(await loadActionPlans(config));
      }
      } finally {
        queueStartingRef.current = false;
      }
    },
    [
      actionPlans,
      boardDailyLimit,
      boardGroups,
      config,
      queueRunning,
      resolveRepoForProject,
      runCodexForTaskWithRepo,
      show
    ]
  );

  // ===== Auto-Lane-Dispatcher =====
  // Startet ausschliesslich den vom Planer (agentSync.autoLanes.dispatch) freigegebenen Kopf-Task ueber
  // den bestehenden Runner. Claim wird synchron VOR jedem await persistiert und erst nach dem finalen
  // Task-Status freigegeben; kann ein Status nicht gespeichert werden, bleibt die Lane sichtbar gesperrt.
  const actionPlansRef = useRef(effectiveActionPlans);
  actionPlansRef.current = effectiveActionPlans;
  const autoModeRef = useRef(autoMode);
  autoModeRef.current = autoMode;
  const autoTickRef = useRef<() => Promise<void>>(async () => undefined);
  const autoQRefreshRef = useRef<(announce: boolean, armAutoMode: boolean) => Promise<ProjectWorkSyncReport | null>>(
    async () => null
  );
  const lastAutoPlanRefreshRef = useRef(0);
  const lastAutoQRefreshRef = useRef(0);
  const lastAutoQTruthSignatureRef = useRef("");

  const commitAutoClaims = useCallback((update: (claims: AutoLaneClaim[]) => AutoLaneClaim[]) => {
    const next = update(readAutoLaneClaims());
    writeAutoLaneClaims(next);
    setAutoClaims(next);
    return next;
  }, []);

  const dispatchAutoLane = useCallback(async () => {
    const source = configRef.current;
    const state = agentSyncRef.current;
    const planned = state?.autoLanes.dispatch ?? [];
    if (!source || !state?.autoLanes.enabled || !autoModeRef.current.enabled || !planned.length) return;
    if (autoDispatchingRef.current || queueStartingRef.current || manualRunRef.current > 0 || !state.startSafety.safe) return;
    if (readDailyCount() >= boardDailyLimit) return;
    autoDispatchingRef.current = true;
    const claimedAt = new Date().toISOString();
    // Alle Batch-Claims werden synchron vor dem ersten await reserviert. Dadurch koennen weder ein
    // zweiter Tick noch zwei Kandidaten denselben Task/Worktree als Writer uebernehmen.
    const candidates: Array<{
      dispatch: (typeof planned)[number];
      plan: ActionPlan;
      task: ActionTask;
      repoPath: string;
      localProjectWork: boolean;
    }> = [];
    let reserved = readAutoLaneClaims();
    for (const dispatch of planned) {
      const repoPath = repoPathFor(projectsRegistryRef.current, source.projectRepos, dispatch.projectId);
      const plan = actionPlansRef.current.find((entry) => entry.planId === dispatch.planId);
      const task = plan?.tasks.find((entry) => entry.taskId === dispatch.taskId);
      if (!repoPath || !plan || !task || hasAutoLaneClaimConflict(reserved, dispatch.taskId, repoPath)) continue;
      // Defense in depth: Fokuswechsel zwischen Planung und Claim startet nie autonom.
      if (!evaluateFocus(focusPolicyRef.current, task.projectId).allowed) continue;
      reserved = addAutoLaneClaim(reserved, {
        taskId: task.taskId,
        projectId: task.projectId,
        repoKey: repoPath,
        runner: dispatch.runner,
        claimedAt
      });
      candidates.push({ dispatch, plan, task, repoPath, localProjectWork: isProjectWorkPlan(plan) });
    }
    const committedClaims = commitAutoClaims((claims) =>
      candidates.reduce(
        (ledger, candidate) => addAutoLaneClaim(ledger, {
          taskId: candidate.task.taskId,
          projectId: candidate.task.projectId,
          repoKey: candidate.repoPath,
          runner: candidate.dispatch.runner,
          claimedAt
        }),
        claims
      )
    );
    const accepted = candidates.filter((candidate) => committedClaims.some((claim) =>
      claim.taskId === candidate.task.taskId &&
      claim.repoKey === candidate.repoPath &&
      claim.runner === candidate.dispatch.runner
    ));
    if (!accepted.length) {
      autoDispatchingRef.current = false;
      return;
    }
    setCodexEvents([]);
    setAutoLastDispatch((current) => ({
      ...current,
      ...Object.fromEntries(accepted.map(({ task }) => [task.projectId, claimedAt]))
    }));
    setAutoInFlight(accepted.map(({ task }) => task.taskId));

    const runCandidate = async ({ dispatch, plan, task, repoPath, localProjectWork }: (typeof accepted)[number]) => {
      let releaseClaim = true;
      try {
        if (!(await dirExists(repoPath))) {
          setAutoMissingRepos((current) => (current.includes(task.projectId) ? current : [...current, task.projectId]));
          show("warn", `Auto Mode: Projektordner für ${task.projectId} fehlt auf diesem Rechner. Lane gesperrt.`);
          return;
        }
        try {
          if (localProjectWork) {
            commitProjectWorkPlans((plans) => updateProjectWorkTask(plans, task.taskId, "running"));
          } else {
            await updateActionTaskStatus(source, task.taskId, "running");
          }
        } catch {
          releaseClaim = false;
          show("warn", `Auto Mode: Status für „${task.title}“ nicht gespeichert. Lane bleibt gesperrt.`);
          return;
        }
        let finalStatus: ActionTaskStatus = "failed";
        let extra: { prUrl: string | null; branch: string | null } | undefined;
        try {
          // Auto-Jobs leben im kanonischen Claim-/In-Flight-Ledger. Der manuelle Singleton-Runstate
          // bleibt frei, damit zwei Provider nicht gegenseitig Besitzer/Events ueberschreiben.
          const result = await runCodexForTaskWithRepo(plan, task, repoPath, dispatch.runner, false);
          if (result.status === "completed") {
            const isFileMode = result.fileMode ?? !source.codexCodingMode;
            finalStatus = isFileMode ? "completed" : "executed";
            extra = { prUrl: result.prUrl ?? null, branch: result.branch ?? null };
            const done = readDailyCount() + 1;
            writeDailyCount(done);
            setDailyCount(done);
          } else {
            // Jobfehler: kein Providerwechsel; nur diese Projekt-Lane pausiert sichtbar.
            show("warn", `Auto Mode: „${task.title}“ fehlgeschlagen. Diese Projekt-Lane pausiert, andere laufen weiter.`);
          }
        } catch (error) {
          show("warn", `Auto Mode: „${task.title}“ abgebrochen (${getMessage(error)}). Diese Projekt-Lane pausiert, andere laufen weiter.`);
        }
        try {
          if (localProjectWork) {
            commitProjectWorkPlans((plans) =>
              updateProjectWorkTask(plans, task.taskId, finalStatus, {
                prUrl: extra?.prUrl ?? null,
                branch: extra?.branch ?? null
              })
            );
          } else {
            await updateActionTaskStatus(source, task.taskId, finalStatus, extra);
          }
        } catch {
          releaseClaim = false;
          show("warn", `Auto Mode: Endstatus für „${task.title}“ nicht gespeichert. Lane bleibt gesperrt.`);
        }
      } finally {
        if (releaseClaim) commitAutoClaims((claims) => releaseAutoLaneClaim(claims, task.taskId));
        setAutoInFlight((current) => current.filter((taskId) => taskId !== task.taskId));
      }
    };

    try {
      // allSettled: der Batch-Lock faellt erst, wenn wirklich jeder Provider-Lauf beendet ist.
      await Promise.allSettled(accepted.map((candidate) => runCandidate(candidate)));
    } finally {
      if (accepted.some((candidate) => !candidate.localProjectWork)) {
        try {
          setActionPlans(await loadActionPlans(source));
        } catch {
          // Server nicht erreichbar: der naechste Takt laedt erneut.
        }
      }
      autoDispatchingRef.current = false;
      // Nach Abschluss/Fehler des Batches sofort neu bewerten, ohne erneuten Klick.
      void autoTickRef.current();
    }
  }, [boardDailyLimit, commitAutoClaims, commitProjectWorkPlans, runCodexForTaskWithRepo, show]);

  const handleCheckCompletionsRef = useRef(handleCheckCompletions);
  handleCheckCompletionsRef.current = handleCheckCompletions;

  // Ein Takt: frische Local-Control-Evidenz (Writer/Leases), gelegentlich Plans + Merge-Status,
  // dann Dispatch-Bewertung im naechsten Render (agentSyncRef ist dann aktuell).
  autoTickRef.current = async () => {
    if (!autoModeRef.current.enabled) return;
    await refreshLocalControlMonitor();
    setDailyCount(readDailyCount());
    const source = configRef.current;
    if (source && !autoDispatchingRef.current && Date.now() - lastAutoPlanRefreshRef.current >= AUTO_LANE_PLAN_REFRESH_MS) {
      lastAutoPlanRefreshRef.current = Date.now();
      try {
        setActionPlans(await loadActionPlans(source));
      } catch {
        // Server nicht erreichbar: Planer arbeitet mit dem letzten Stand.
      }
      if (agentSyncRef.current?.autoLanes.lanes.some((lane) => lane.reason === "merge_pending")) {
        await handleCheckCompletionsRef.current(false).catch(() => undefined);
      }
    }
    const state = agentSyncRef.current;
    const ownershipBusy =
      autoDispatchingRef.current ||
      queueStartingRef.current ||
      manualRunRef.current > 0 ||
      state?.startSafety.reason === "runner_busy" ||
      state?.startSafety.reason === "worktree_lease_active" ||
      state?.startSafety.reason === "handoff_in_flight" ||
      state?.startSafety.reason === "orchestrator_lease";
    const refreshReason = autoQRefreshReason({
      // Vor geladener Registry/Config ist ein leerer Stand keine autoritative Projektwahrheit.
      enabled: autoModeRef.current.enabled && projects.loaded && Boolean(source),
      syncing: projectWorkSyncingRef.current,
      writerActive: ownershipBusy,
      laneCount: state?.autoLanes.lanes.length ?? 0,
      projectTruthChanged: source
        ? projectWorkTruthSignature(projectsRegistryRef.current, source.projectRepos) !== lastAutoQTruthSignatureRef.current
        : false,
      lastRefreshAt: lastAutoQRefreshRef.current,
      now: Date.now()
    });
    if (refreshReason) await autoQRefreshRef.current(false, false);
    setAutoTickSeq((value) => value + 1);
  };

  const handleSetAutoMode = useCallback(
    (enabled: boolean) => {
      const mode: AutoLaneMode = { enabled, updatedAt: new Date().toISOString() };
      writeAutoLaneMode(mode);
      autoModeRef.current = mode;
      setAutoMode(mode);
      show(
        "info",
        enabled
          ? "Auto Mode an: ausgewählte, freigegebene Aufgaben starten automatisch, sobald es sicher ist."
          : "Auto Mode pausiert: eine laufende Aufgabe endet normal, danach startet nichts Neues."
      );
    },
    [show]
  );

  const syncProjectWork = useCallback(async (announce: boolean, armAutoMode: boolean): Promise<ProjectWorkSyncReport | null> => {
    if (projectWorkSyncingRef.current) return null;
    projectWorkSyncingRef.current = true;
    setProjectWorkSyncBusy(true);
    try {
      const source = configRef.current;
      if (!source || !projects.loaded) return null;
      let registry = projectsRegistryRef.current;
      const previousProjectPlans = projectWorkPlansRef.current;

      // Vor jeder AutoQ-Planung wird der explizit gewählte Runner-Worktree READ-ONLY neu geprüft.
      // So liest AutoQ nicht den alten kanonischen Main/Audit-Stand, wenn der Nutzer einen frischeren
      // THEORG-/Beta-/Feature-Worktree als tatsächliches Arbeitsziel festgelegt hat.
      if (source?.projectRepos) {
        for (const project of registry.projects) {
          if (project.focus.status !== "active") continue;
          const mappedPath = source.projectRepos[project.id];
          if (!mappedPath) continue;
          const refreshed = await projects.rescanAtPath(project.id, mappedPath);
          if (refreshed) registry = refreshed;
        }
      }
      projectsRegistryRef.current = registry;

      const { plans, selectedTaskIds, report } = buildProjectWorkSync(
        registry,
        source?.projectRepos,
        previousProjectPlans,
        new Date().toISOString()
      );
      projectWorkPlansRef.current = plans;
      writeProjectWorkPlans(plans);
      setProjectWorkPlans(plans);
      setProjectWorkSyncReport(report);
      setBoardSelection(selectedTaskIds);
      setBoardOrder(selectedTaskIds);
      writeBoardSelection(selectedTaskIds);

      // Dieser Scan ist autoritativ: Claims erledigter oder aus der aktuellen Wahrheit entfernter
      // Tasks werden freigegeben. Nicht geladene Planstaende ausserhalb dieses Pfads bleiben konservativ.
      const currentClaims = readAutoLaneClaims();
      const projectTaskIds = [...previousProjectPlans, ...plans].flatMap((plan) => plan.tasks.map((task) => task.taskId));
      const prunedClaims = pruneAutoLaneClaimsInScope(currentClaims, plans, projectTaskIds);
      if (prunedClaims.length !== currentClaims.length) {
        writeAutoLaneClaims(prunedClaims);
        setAutoClaims(prunedClaims);
      }

      lastAutoQRefreshRef.current = Date.now();
      lastAutoQTruthSignatureRef.current = projectWorkTruthSignature(registry, source.projectRepos);

      if (armAutoMode) {
        const mode: AutoLaneMode = { enabled: true, updatedAt: new Date().toISOString() };
        writeAutoLaneMode(mode);
        autoModeRef.current = mode;
        setAutoMode(mode);
      }

      if (announce && report.readyCount > 0) {
        show(
          "ok",
          `AutoQ: ${report.readyCount} ausführbare Aufgabe${report.readyCount === 1 ? "" : "n"} synchronisiert. ${report.gatedCount ? `${report.gatedCount} Projekt-Gate${report.gatedCount === 1 ? "" : "s"} bleiben geschützt.` : ""}`
        );
      } else if (announce) {
        show(
          "warn",
          `AutoQ: keine sofort ausführbare Arbeit gefunden. ${report.gatedCount} Gate${report.gatedCount === 1 ? "" : "s"}, ${report.emptyCount} Projekt${report.emptyCount === 1 ? "" : "e"} ohne explizites Next Safe Work.`
        );
      }
      return report;
    } finally {
      projectWorkSyncingRef.current = false;
      setProjectWorkSyncBusy(false);
    }
  }, [projects.loaded, projects.rescanAtPath, show]);

  autoQRefreshRef.current = syncProjectWork;

  const handleStartAutoQ = useCallback(async () => {
    const report = await syncProjectWork(true, true);
    if (report) window.setTimeout(() => void autoTickRef.current(), 0);
  }, [syncProjectWork]);

  // Auto Mode ist ein dauerhafter Wunsch, kein Einmal-Klick. Nach App-Start oder einer geaenderten
  // Runner-Zuordnung synchronisiert AutoQ deshalb einmal selbststaendig die aktuelle Projektwahrheit.
  // Der Signatur-Guard verhindert Schleifen, wenn die READ-ONLY-Scans die Registry aktualisieren.
  const autoQSyncSignatureRef = useRef("");
  useEffect(() => {
    if (!autoMode.enabled || !projects.loaded || projectWorkSyncBusy || !config) return undefined;
    const entries = Object.entries(config.projectRepos ?? {}).sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) return undefined;
    const signature = JSON.stringify(entries);
    if (autoQSyncSignatureRef.current === signature) return undefined;
    autoQSyncSignatureRef.current = signature;
    const timer = window.setTimeout(() => void handleStartAutoQ(), 250);
    return () => window.clearTimeout(timer);
  }, [autoMode.enabled, config, handleStartAutoQ, projectWorkSyncBusy, projects.loaded]);

  // Unterbrochene Lane (Claim/„running“ ohne laufenden Besitzer) bewusst freigeben: der Task wird
  // zurückgestellt und startet erst wieder, wenn er im Board bewusst neu eingeplant wird.
  const handleReleaseAutoLane = useCallback(
    async (taskId: string) => {
      if (autoInFlight.includes(taskId) || agentSyncRef.current?.currentJob?.id === taskId) return;
      setBusy("board");
      try {
        const plan = actionPlansRef.current.find((entry) => entry.tasks.some((task) => task.taskId === taskId));
        if (isProjectWorkPlan(plan)) {
          commitProjectWorkPlans((plans) => updateProjectWorkTask(plans, taskId, "deferred"));
        } else {
          setActionPlans(await updateActionTaskStatus(config, taskId, "deferred"));
        }
        commitAutoClaims((claims) => releaseAutoLaneClaim(claims, taskId));
        show("info", "Unterbrochene Aufgabe zurückgestellt. Im Projekt-Board kannst du sie bewusst wieder einplanen.");
      } catch (error) {
        show("error", getMessage(error));
      } finally {
        setBusy(null);
      }
    },
    [autoInFlight, commitAutoClaims, commitProjectWorkPlans, config, show]
  );

  // Erledigte Claims (Endstatus erreicht) aus dem Ledger entfernen.
  useEffect(() => {
    if (autoDispatchingRef.current) return;
    const current = readAutoLaneClaims();
    const pruned = pruneAutoLaneClaims(current, effectiveActionPlans);
    if (pruned.length !== current.length) {
      writeAutoLaneClaims(pruned);
      setAutoClaims(pruned);
    }
  }, [effectiveActionPlans]);

  // Neue Repo-Zuordnung -> fehlende Ordner erneut pruefen.
  useEffect(() => {
    setAutoMissingRepos([]);
  }, [config?.projectRepos]);

  const handleAcceptBriefing = useCallback(
    async (briefingId: string) => {
      setBriefings(await updateBriefingStatus(config, briefingId, "accepted"));
      show("ok", "Briefing angenommen.");
    },
    [config, show]
  );

  const handleRejectBriefing = useCallback(
    async (briefingId: string) => {
      setBriefings(await updateBriefingStatus(config, briefingId, "rejected"));
      show("info", "Briefing abgelehnt.");
    },
    [config, show]
  );

  const handleArchiveBriefing = useCallback(
    async (briefingId: string) => {
      if (busy) return;
      setBusy("briefing-mut");
      try {
        setBriefings(await archiveBriefing(config, briefings, briefingId, true));
        show("info", "Briefing ins Archiv verschoben.");
      } catch {
        show("error", "Briefing konnte nicht archiviert werden.");
      } finally {
        setBusy(null);
      }
    },
    [busy, config, briefings, show]
  );

  const handleRestoreBriefing = useCallback(
    async (briefingId: string) => {
      if (busy) return;
      setBusy("briefing-mut");
      try {
        setBriefings(await archiveBriefing(config, briefings, briefingId, false));
        show("ok", "Briefing aus dem Archiv geholt.");
      } catch {
        show("error", "Briefing konnte nicht wiederhergestellt werden.");
      } finally {
        setBusy(null);
      }
    },
    [busy, config, briefings, show]
  );

  const handleDeleteBriefing = useCallback(
    async (briefingId: string) => {
      if (busy) return;
      setBusy("briefing-mut");
      try {
        setBriefings(await deleteBriefing(config, briefings, briefingId));
        show("info", "Briefing endgültig gelöscht.");
      } catch {
        show("error", "Briefing konnte nicht gelöscht werden.");
      } finally {
        setBusy(null);
      }
    },
    [busy, config, briefings, show]
  );

  const handleQuitApp = useCallback(async () => {
    await quitApp();
  }, []);

  // Die 5 PERSISTENTEN Setup-Gates = Quelle fuer das Setup-Strip-% und die ersten 5 Onboarding-Schritte.
  // (Die Tour haengt in App.tsx noch einen 6., weichen Skill-Schritt an; der zaehlt bewusst NICHT ins Setup-%.)
  // Bewusst NICHT die fluechtigen Live-Test-Flags (connectionOk/libraryOk) -> sonst faellt das Setup bei jedem Start zurueck.
  const setupGates = useMemo(() => {
    if (!config) return [false, false, false, false, false];
    return [
      keyStatus.exists, // 1 API-Key gespeichert (Keychain)
      Boolean(config.libraryId.trim()), // 2 Library-ID gesetzt
      mcpTokenStatus.exists, // 3 MCP-Connector-Token vorhanden
      config.sourceRoots.length > 0, // 4 Quellordner gewaehlt
      Boolean(config.schedule.enabled && launchStatus?.installed) // 5 Zeitplan aktiv + Agent installiert
    ];
  }, [config, keyStatus.exists, launchStatus?.installed, mcpTokenStatus.exists]);
  const completion = useMemo(
    () => Math.round((setupGates.filter(Boolean).length / setupGates.length) * 100),
    [setupGates]
  );

  const planProjectIds = useMemo(
    () => [...new Set(effectiveActionPlans.flatMap((plan) => plan.tasks.map((task) => task.projectId)).filter(Boolean))],
    [effectiveActionPlans]
  );

  // Defense in depth: Auto-Lanes sehen ausschliesslich aktuell Auto-erlaubte Fokus-Tasks.
  // Persistierte Alt-Auswahl darf nie ueber einen spaeteren Registry-/Fokuswechsel wieder anlaufen.
  const autoSelectedOrder = useMemo(() => {
    const projectByTask = new Map(
      effectiveActionPlans.flatMap((plan) => plan.tasks.map((task) => [task.taskId, task.projectId] as const))
    );
    return boardOrder.filter((taskId) => {
      const projectId = projectByTask.get(taskId);
      return Boolean(projectId && evaluateFocus(projects.focusPolicy, projectId).allowed);
    });
  }, [effectiveActionPlans, boardOrder, projects.focusPolicy]);

  const agentSync = useMemo(
    () => normalizeAgentSyncState({
      actionPlans: effectiveActionPlans,
      codexRun,
      codexEvents,
      currentQueueTaskId,
      queueRunning,
      localControl: localControlMonitor,
      providerStatuses,
      providerTransitions: providerHistory,
      providerPriority: config?.providerPriority ?? [],
      preferredRunner: config?.codexPreferredRunner,
      codexModel: config?.codexModel,
      claudeModel: config?.claudeModel,
      localModel: config?.localProvider.model,
      device: config?.device.deviceName,
      focus: projects.focusPolicy,
      autoLane: {
        enabled: autoMode.enabled,
        selectedOrder: autoSelectedOrder,
        repos: buildRepoMap(projects.registry, config?.projectRepos, planProjectIds),
        missingRepos: autoMissingRepos,
        claims: autoClaims,
        inFlightTaskIds: autoInFlight,
        dailyCount,
        dailyLimit: boardDailyLimit,
        lastDispatchAt: autoLastDispatch
      },
      now: new Date().toISOString()
    }),
    [
      effectiveActionPlans,
      autoClaims,
      autoInFlight,
      autoLastDispatch,
      autoMissingRepos,
      autoMode.enabled,
      boardDailyLimit,
      autoSelectedOrder,
      codexEvents,
      codexRun,
      config?.claudeModel,
      config?.codexModel,
      config?.codexPreferredRunner,
      config?.device.deviceName,
      config?.localProvider.model,
      config?.projectRepos,
      config?.providerPriority,
      currentQueueTaskId,
      planProjectIds,
      projects.focusPolicy,
      projects.registry,
      dailyCount,
      localControlMonitor,
      providerHistory,
      providerStatuses,
      queueRunning
    ]
  );

  agentSyncRef.current = agentSync;

  // Auto-Mode-Takt (nur bei offener App und eingeschaltetem Modus): begrenzt, kein Busy-Loop.
  useEffect(() => {
    if (!autoMode.enabled) return undefined;
    void autoTickRef.current();
    const timer = window.setInterval(() => void autoTickRef.current(), AUTO_LANE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [autoMode.enabled]);

  // Dispatch nur direkt nach einem Takt mit frischer Evidenz bewerten.
  useEffect(() => {
    // Bewusst nur am Takt haengend: dispatchAutoLane stammt aus genau diesem Render.
    if (autoTickSeq > 0) void dispatchAutoLane();
  }, [autoTickSeq]);

  return {
    activeStep,
    agentSync,
    actionPlans,
    agentActionPlans: effectiveActionPlans,
    projectWorkSyncReport,
    projectWorkSyncBusy,
    boardDailyLimit,
    boardGroups,
    boardSelection,
    briefings,
    busy,
    completion,
    setupGates,
    config,
    connectionOk,
    currentQueueTaskId,
    dailyCount,
    dirty,
    queueRunning,
    keyInput,
    keyStatus,
    libraryOk,
    launchStatus,
    localControlMonitor,
    localControlMonitorError,
    logs,
    loginEmail,
    loginPassword,
    mcpTokenInput,
    mcpTokenStatus,
    notice,
    providerBusy,
    providerHistory,
    providerLoginUrls,
    handleOpenProviderLoginUrl,
    providerStatuses,
    localProviderDraft: localProviderDraft ?? config?.localProvider ?? null,
    localKeyInput,
    localKeyError,
    discoveredLocal,
    localBrainStatus,
    localBrainProgress,
    localBrainBusy,
    setLocalKeyInput,
    updateLocalProviderDraft,
    generatedToken,
    codexRun,
    codexEvents,
    syncStatus,
    rateLimits,
    report,
    scan,
    sessionStatus,
    handleChooseFolders,
    handleCheckCompletions,
    handleCheckTaskCompletion,
    handleCopyToken,
    handleConnectProvider,
    handleDeferTask,
    handleDeleteKey,
    handleMarkTaskDone,
    handleDeleteMcpConnectorToken,
    handleDisconnectProvider,
    handleForgetProjectRepo,
    handleUseProjectFolder,
    projects,
    handleChooseReferenceRoot,
    handleGenerateConnectorToken,
    handleRejectTask,
    handleReorderTask,
    handleResumeTask,
    handleResumeRunnerSession,
    handleSelectTask,
    handleStartBoardQueue,
    handleStopBoardQueue,
    handleSetAutoMode,
    handleStartAutoQ,
    handleReleaseAutoLane,
    autoMode,
    handleLogin,
    handleMoveProvider,
    handleCancelProviderLogin,
    handleSubmitProviderLoginCode,
    handleDiscoverLocalProviders,
    handleSaveLocalProviderKey,
    handleRemoveLocalProviderKey,
    handleInstallLocalBrain,
    handleStartLocalBrain,
    handleStopLocalBrain,
    handleRemoveLocalBrain,
    handleRegister,
    logoutFlow,
    requestLogout,
    cancelLogout,
    confirmLogout,
    submitLogoutPassword,
    forceLogout,
    cloudPasswordPrompt,
    submitCloudPassword,
    cancelCloudPassword,
    handleRecoverPassword,
    handleLaunchInstall,
    handleLaunchRemove,
    handleLogs,
    refreshLocalControlMonitor,
    handleQuitApp,
    handleRefreshActionPlans,
    handleRefreshBriefings,
    handleRejectActionPlan,
    handleRejectBriefing,
    handleArchiveBriefing,
    handleRestoreBriefing,
    handleDeleteBriefing,
    handleReviewActionPlan,
    handleRun,
    handleAcceptBriefing,
    handleSaveKey,
    handleSaveMcpConnectorToken,
    handleScan,
    handleStartActionPlan,
    handleRunCodexForTask,
    handleRunCodexForBriefing,
    handleTestConnection,
    handleTestLibrary,
    handleTestProvider,
    handleRefreshProviders,
    openOutputDir,
    persist,
    setActiveStep,
    setKeyInput,
    setLoginEmail,
    setLoginPassword,
    setMcpTokenInput,
    setNotice,
    updateConfig,
    updateNested
  };
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

// Projekt-Board: Tagesgrenze client-seitig, Datum im Key -> automatischer Reset pro Tag.
function dailyCountKey() {
  return `katosync.board.completed.${new Date().toISOString().slice(0, 10)}`;
}

function readDailyCount() {
  const raw = localStorage.getItem(dailyCountKey());
  const value = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(value) ? value : 0;
}

function writeDailyCount(value: number) {
  localStorage.setItem(dailyCountKey(), String(value));
}

// Board-Plan-Status, deren Tasks im Board sichtbar sind (approved = ausfuehrbar, Rest read-only).
const BOARD_PLAN_STATUSES: ActionPlanStatus[] = [
  "approved",
  "pending_user_review",
  "in_review",
  "running"
];

function groupTasksByProject(
  plans: ActionPlan[],
  selection: string[],
  order: string[],
  registry: ProjectRegistry | null = null
): BoardGroup[] {
  const selectionSet = new Set(selection);
  const groups = new Map<string, BoardTask[]>();

  for (const plan of plans) {
    if (!BOARD_PLAN_STATUSES.includes(plan.status)) continue;
    for (const task of plan.tasks) {
      // Erledigte/abgelehnte Tasks verlassen das aktive Board.
      if (task.status === "completed" || task.status === "rejected") continue;
      const boardTask: BoardTask = {
        ...task,
        planId: plan.planId,
        planStatus: plan.status,
        agentName: plan.agentName,
        source: plan.source,
        approved: plan.status === "approved",
        selected: selectionSet.has(task.taskId),
        orderIndex: order.indexOf(task.taskId)
      };
      // Registry-Aufloesung: bekannte Alias-/Repo-IDs landen unter ihrer kanonischen ID, "Ohne Projekt" nur bei echt Unbekanntem.
      const key = task.projectId ? canonicalProjectId(registry, task.projectId) : NO_PROJECT_ID;
      const bucket = groups.get(key) ?? [];
      bucket.push(boardTask);
      groups.set(key, bucket);
    }
  }

  for (const bucket of groups.values()) {
    bucket.sort((a, b) => {
      const aDeferred = a.status === "deferred" ? 1 : 0;
      const bDeferred = b.status === "deferred" ? 1 : 0;
      if (aDeferred !== bDeferred) return aDeferred - bDeferred; // deferred ans Ende
      const aSelected = a.selected ? 0 : 1;
      const bSelected = b.selected ? 0 : 1;
      if (aSelected !== bSelected) return aSelected - bSelected; // selektiert zuerst
      if (a.selected && b.selected) return a.orderIndex - b.orderIndex;
      return a.priority - b.priority;
    });
  }

  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === NO_PROJECT_ID) return 1; // "Ohne Projekt" zuletzt
      if (b === NO_PROJECT_ID) return -1;
      return a.localeCompare(b);
    })
    .map(([projectId, tasks]) => ({ projectId, tasks }));
}
