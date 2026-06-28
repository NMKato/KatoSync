import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildCodexPromptFromBriefing,
  buildCodexPromptFromTask,
  chooseFolders,
  chooseRepoFolder,
  dirExists,
  listenCodexEvents,
  NO_PROJECT_ID,
  runCodexTask,
  deleteApiKey,
  deleteMcpConnectorToken,
  generateConnectorToken,
  getApiKeyStatus,
  getLaunchAgentStatus,
  getMcpConnectorTokenStatus,
  getSupabaseSession,
  installLaunchAgent,
  loadActionPlans,
  loadBriefings,
  loadConfig,
  loginSupabase,
  logoutSupabase,
  signupSupabase,
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
  updateActionPlanStatus,
  updateActionTaskStatus,
  updateBriefingStatus
} from "../repositories/katoSyncRepository";
import type { Notice } from "../components/Primitives";
import type {
  ActionPlan,
  ActionPlanStatus,
  ActionTask,
  ActionTaskStatus,
  AppConfig,
  Briefing,
  CodexEvent,
  CodexRunResult,
  CodexRunState,
  RateLimitMetric,
  KeyStatus,
  LaunchAgentStatus,
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
  | "logs";

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
  const [codexRun, setCodexRun] = useState<CodexRunState>({ status: "idle" });
  const [codexEvents, setCodexEvents] = useState<CodexEvent[]>([]);
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [launchStatus, setLaunchStatus] = useState<LaunchAgentStatus | null>(null);
  const [rateLimits, setRateLimits] = useState<RateLimitMetric[]>([]);
  const [connectionOk, setConnectionOk] = useState(false);
  const [libraryOk, setLibraryOk] = useState(false);
  const [logs, setLogs] = useState("");
  const [actionPlans, setActionPlans] = useState<ActionPlan[]>([]);
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Projekt-Board
  const [boardSelection, setBoardSelection] = useState<string[]>([]);
  const [boardOrder, setBoardOrder] = useState<string[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [currentQueueTaskId, setCurrentQueueTaskId] = useState<string | null>(null);
  const [dailyCount, setDailyCount] = useState<number>(() => readDailyCount());
  const stopRef = useRef(false);

  const show = useCallback((kind: Notice["kind"], text: string) => setNotice({ kind, text }), []);

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
    } catch (error) {
      show("error", getMessage(error));
    }
  }, [show]);

  useEffect(() => {
    void boot();
  }, [boot]);

  // Live-Feed: gestreamte Codex-Events sammeln (letzte 300).
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const un = await listenCodexEvents((event) => {
        setCodexEvents((prev) => {
          const next = [...prev, event];
          return next.length > 300 ? next.slice(next.length - 300) : next;
        });
      });
      if (active) unlisten = un;
      else un();
    })();
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const updateConfig = useCallback(<K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    setConfig((current) => (current ? { ...current, [key]: value } : current));
  }, []);

  const updateNested = useCallback(
    <K extends "schedule" | "scanRules" | "safety">(key: K, value: Partial<AppConfig[K]>) => {
      setConfig((current) =>
        current ? { ...current, [key]: { ...current[key], ...value } } : current
      );
    },
    []
  );

  const persist = useCallback(async () => {
    if (!config) return;
    setBusy("save");
    try {
      setConfig(await saveConfig(config));
      show("ok", "Konfiguration gespeichert.");
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [config, show]);

  const saveDraftKeyIfNeeded = useCallback(async () => {
    const draft = keyInput.trim();
    if (!draft) return;
    const nextStatus = await saveApiKey(draft);
    setKeyStatus(nextStatus);
    setKeyInput("");
  }, [keyInput]);

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
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [keyInput, show]);

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
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [config, mcpTokenInput, show]);

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
      setSessionStatus(status);
      setLoginPassword("");
      show("ok", `Angemeldet als ${status.email ?? loginEmail}.`);
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [loginEmail, loginPassword, show]);

  const handleRegister = useCallback(async () => {
    setBusy("register");
    try {
      const status = await signupSupabase(loginEmail, loginPassword);
      setSessionStatus(status);
      if (status.loggedIn) {
        setLoginPassword("");
        show("ok", `Registriert und angemeldet als ${status.email ?? loginEmail}.`);
      } else {
        show("info", "Registrierung erstellt. Bitte bestätige deine E-Mail und melde dich dann an.");
      }
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [loginEmail, loginPassword, show]);

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
    } catch (error) {
      show("error", getMessage(error));
    } finally {
      setBusy(null);
    }
  }, [config, show]);

  const handleCopyToken = useCallback(async () => {
    if (!generatedToken) return;
    try {
      await navigator.clipboard.writeText(generatedToken);
      show("ok", "Token in die Zwischenablage kopiert.");
    } catch {
      show("info", "Bitte den Token im Feld markieren und manuell kopieren.");
    }
  }, [generatedToken, show]);

  const handleLogout = useCallback(async () => {
    setSessionStatus(await logoutSupabase());
    setGeneratedToken(null);
    show("info", "Von KatoSync abgemeldet.");
  }, [show]);

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
      setBusy(dryRun ? "dry-run" : "sync");
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
        const latestLimits = result.uploaded.flatMap((upload) => upload.rateLimits || []);
        if (latestLimits.length) setRateLimits(latestLimits);
        show(result.errors.length ? "warn" : "ok", dryRun ? "Dry-Run abgeschlossen." : "Sync abgeschlossen.");
      } catch (error) {
        show("error", getMessage(error));
      } finally {
        setBusy(null);
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
      show("ok", "Action Queue aktualisiert.");
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
      setActionPlans(await updateActionPlanStatus(config, planId, "rejected"));
      show("info", "Action Plan abgelehnt. Es wird lokal nichts ausgeführt.");
    },
    [config, show]
  );

  const handleStartActionPlan = useCallback(
    async (planId: string) => {
      setActionPlans(await updateActionPlanStatus(config, planId, "approved"));
      show("ok", "Action Plan freigegeben. Tasks mit Codex-Runner kannst du jetzt an Codex übergeben.");
    },
    [config, show]
  );

  // Repo-pro-Projekt: gemerkten Ordner nutzen; nur fragen, wenn unbekannt/verschwunden -> dann merken.
  const resolveRepoForProject = useCallback(
    async (projectId: string): Promise<string | null> => {
      if (!config) return null;
      const stored = config.projectRepos?.[projectId];
      if (stored && (await dirExists(stored))) return stored;
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

  // Kern-Codex-Lauf OHNE Ordnerdialog (vom Einzel-Button UND vom Board-Executor genutzt).
  const runCodexForTaskWithRepo = useCallback(
    async (plan: ActionPlan, task: ActionTask, repoPath: string): Promise<CodexRunResult> => {
      if (!config) throw new Error("Keine Konfiguration geladen.");
      setCodexEvents([]);
      setCodexRun({ status: "running" });
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
        }
      });
      setCodexRun({ status: result.status === "completed" ? "completed" : "failed", result });
      return result;
    },
    [config]
  );

  const handleRunCodexForTask = useCallback(
    async (plan: ActionPlan, task: ActionTask) => {
      if (!config) return;
      const repoPath = await resolveRepoForProject(task.projectId);
      if (!repoPath) return;
      setBusy("codex-run");
      try {
        await updateActionTaskStatus(config, task.taskId, "running");
        const result = await runCodexForTaskWithRepo(plan, task, repoPath);
        const finalStatus = result.status === "completed" ? "completed" : "failed";
        setActionPlans(await updateActionTaskStatus(config, task.taskId, finalStatus));
        show(
          result.status === "completed" ? "ok" : "warn",
          result.status === "completed"
            ? `Codex fertig: ${result.changedFiles.length} Datei(en) auf Branch ${result.branch}.`
            : `Codex-Lauf fehlgeschlagen: ${result.error ?? "unbekannt"}`
        );
      } catch (error) {
        setCodexRun({ status: "failed", error: getMessage(error) });
        await updateActionTaskStatus(config, task.taskId, "failed").catch(() => undefined);
        setActionPlans(await loadActionPlans(config));
        show("error", getMessage(error));
      } finally {
        setBusy(null);
      }
    },
    [config, resolveRepoForProject, runCodexForTaskWithRepo, show]
  );

  const handleRunCodexForBriefing = useCallback(
    async (briefing: Briefing) => {
      if (!config) return;
      const repoPath = await resolveRepoForProject("katosync");
      if (!repoPath) return;
      setBusy("codex-run");
      setCodexEvents([]);
      setCodexRun({ status: "running" });
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
          }
        });
        setCodexRun({ status: result.status === "completed" ? "completed" : "failed", result });
        show(
          result.status === "completed" ? "ok" : "warn",
          result.status === "completed"
            ? `Codex fertig: ${result.changedFiles.length} Datei(en) auf Branch ${result.branch}.`
            : `Codex-Lauf fehlgeschlagen: ${result.error ?? "unbekannt"}`
        );
        setBriefings(await updateBriefingStatus(config, briefing.briefingId, "queued"));
      } catch (error) {
        setCodexRun({ status: "failed", error: getMessage(error) });
        show("error", getMessage(error));
      } finally {
        setBusy(null);
      }
    },
    [config, resolveRepoForProject, show]
  );

  // ===== Projekt-Board =====
  const boardGroups = useMemo<BoardGroup[]>(
    () => groupTasksByProject(actionPlans, boardSelection, boardOrder),
    [actionPlans, boardSelection, boardOrder]
  );

  const boardDailyLimit = useMemo(() => {
    const limits = actionPlans
      .filter((plan) => plan.status === "approved")
      .map((plan) => plan.dailyLimit)
      .filter((value) => Number.isFinite(value) && value > 0);
    return limits.length ? Math.max(...limits) : 3;
  }, [actionPlans]);

  // Selektion/Reihenfolge bereinigen, sobald ein Task das aktive Board verlaesst.
  useEffect(() => {
    const activeIds = new Set<string>();
    for (const plan of actionPlans) {
      for (const task of plan.tasks) {
        if (task.status !== "completed" && task.status !== "rejected") activeIds.add(task.taskId);
      }
    }
    setBoardSelection((prev) => prev.filter((id) => activeIds.has(id)));
    setBoardOrder((prev) => prev.filter((id) => activeIds.has(id)));
  }, [actionPlans]);

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

  const handleDeferTask = useCallback(
    async (taskId: string) => {
      setActionPlans(await updateActionTaskStatus(config, taskId, "deferred"));
      setBoardSelection((prev) => prev.filter((id) => id !== taskId));
      setBoardOrder((prev) => prev.filter((id) => id !== taskId));
      show("info", "Aufgabe aufgeschoben.");
    },
    [config, show]
  );

  const handleRejectTask = useCallback(
    async (taskId: string) => {
      setActionPlans(await updateActionTaskStatus(config, taskId, "rejected"));
      setBoardSelection((prev) => prev.filter((id) => id !== taskId));
      setBoardOrder((prev) => prev.filter((id) => id !== taskId));
      show("info", "Aufgabe abgelehnt.");
    },
    [config, show]
  );

  const handleResumeTask = useCallback(
    async (taskId: string) => {
      setActionPlans(await updateActionTaskStatus(config, taskId, "pending"));
      show("info", "Aufgabe wieder eingeplant.");
    },
    [config, show]
  );

  const handleStopBoardQueue = useCallback(() => {
    stopRef.current = true;
    show("info", "Queue stoppt nach der laufenden Aufgabe.");
  }, [show]);

  // Sequentieller Executor PRO PROJEKT-SPALTE: ein Repo-Ordner je Lauf, ein Task nach dem anderen.
  const handleStartBoardQueue = useCallback(
    async (projectId: string) => {
      if (!config || queueRunning) return;
      const group = boardGroups.find((entry) => entry.projectId === projectId);
      if (!group) return;
      const ordered = group.tasks
        .filter(
          (task) =>
            task.selected &&
            task.approved &&
            task.targetRunner === "codex_cli" &&
            task.riskLevel !== "critical" &&
            !["completed", "rejected", "deferred", "running"].includes(task.status)
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
            const finalStatus = result.status === "completed" ? "completed" : "failed";
            await updateActionTaskStatus(config, task.taskId, finalStatus);
            if (result.status === "completed") {
              done += 1;
              writeDailyCount(done);
              setDailyCount(done);
            } else {
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

  const handleAcceptBriefing = useCallback(
    async (briefingId: string) => {
      setBriefings(await updateBriefingStatus(config, briefingId, "accepted"));
      show("ok", "Briefing angenommen.");
    },
    [config, show]
  );

  const handleQueueBriefing = useCallback(
    async (briefingId: string) => {
      setBriefings(await updateBriefingStatus(config, briefingId, "queued"));
      show("warn", "Briefing vorbereitet. Codex-Bridge startet erst im nächsten 2.0-Schnitt.");
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

  const handleQuitApp = useCallback(async () => {
    await quitApp();
  }, []);

  const completion = useMemo(() => {
    if (!config) return 0;
    const checks = [
      keyStatus.exists,
      Boolean(config.libraryId),
      config.sourceRoots.length > 0,
      Boolean(config.outputDir),
      Boolean(scan || report),
      Boolean(launchStatus?.installed)
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [config, keyStatus.exists, launchStatus?.installed, report, scan]);

  return {
    activeStep,
    actionPlans,
    boardDailyLimit,
    boardGroups,
    boardSelection,
    briefings,
    busy,
    completion,
    config,
    connectionOk,
    currentQueueTaskId,
    dailyCount,
    queueRunning,
    keyInput,
    keyStatus,
    libraryOk,
    launchStatus,
    logs,
    loginEmail,
    loginPassword,
    mcpTokenInput,
    mcpTokenStatus,
    notice,
    generatedToken,
    codexRun,
    codexEvents,
    rateLimits,
    report,
    scan,
    sessionStatus,
    handleChooseFolders,
    handleCopyToken,
    handleDeferTask,
    handleDeleteKey,
    handleDeleteMcpConnectorToken,
    handleForgetProjectRepo,
    handleGenerateConnectorToken,
    handleRejectTask,
    handleReorderTask,
    handleResumeTask,
    handleSelectTask,
    handleStartBoardQueue,
    handleStopBoardQueue,
    handleLogin,
    handleLogout,
    handleRegister,
    handleLaunchInstall,
    handleLaunchRemove,
    handleLogs,
    handleQuitApp,
    handleRefreshActionPlans,
    handleRefreshBriefings,
    handleRejectActionPlan,
    handleRejectBriefing,
    handleReviewActionPlan,
    handleRun,
    handleAcceptBriefing,
    handleQueueBriefing,
    handleSaveKey,
    handleSaveMcpConnectorToken,
    handleScan,
    handleStartActionPlan,
    handleRunCodexForTask,
    handleRunCodexForBriefing,
    handleTestConnection,
    handleTestLibrary,
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
  order: string[]
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
      const key = task.projectId || NO_PROJECT_ID;
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
