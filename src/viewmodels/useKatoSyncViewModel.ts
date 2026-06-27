import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildCodexPromptFromBriefing,
  buildCodexPromptFromTask,
  chooseFolders,
  chooseRepoFolder,
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
  updateBriefingStatus
} from "../repositories/katoSyncRepository";
import type { Notice } from "../components/Primitives";
import type {
  ActionPlan,
  ActionTask,
  AppConfig,
  Briefing,
  CodexRunState,
  RateLimitMetric,
  KeyStatus,
  LaunchAgentStatus,
  ScanSummary,
  SupabaseSessionStatus,
  SyncReport
} from "../types";

export type StepId =
  | "welcome"
  | "api"
  | "library"
  | "folders"
  | "rules"
  | "schedule"
  | "dashboard"
  | "actionQueue"
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

  const handleRunCodexForTask = useCallback(
    async (plan: ActionPlan, task: ActionTask) => {
      if (!config) return;
      const repoPath = await chooseRepoFolder(config.sourceRoots[0]);
      if (!repoPath) return;
      setBusy("codex-run");
      setCodexRun({ status: "running" });
      try {
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
        show(
          result.status === "completed" ? "ok" : "warn",
          result.status === "completed"
            ? `Codex fertig: ${result.changedFiles.length} Datei(en) auf Branch ${result.branch}.`
            : `Codex-Lauf fehlgeschlagen: ${result.error ?? "unbekannt"}`
        );
        setActionPlans(await loadActionPlans(config));
      } catch (error) {
        setCodexRun({ status: "failed", error: getMessage(error) });
        show("error", getMessage(error));
      } finally {
        setBusy(null);
      }
    },
    [config, show]
  );

  const handleRunCodexForBriefing = useCallback(
    async (briefing: Briefing) => {
      if (!config) return;
      const repoPath = await chooseRepoFolder(config.sourceRoots[0]);
      if (!repoPath) return;
      setBusy("codex-run");
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
    [config, show]
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
    briefings,
    busy,
    completion,
    config,
    connectionOk,
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
    rateLimits,
    report,
    scan,
    sessionStatus,
    handleChooseFolders,
    handleCopyToken,
    handleDeleteKey,
    handleDeleteMcpConnectorToken,
    handleGenerateConnectorToken,
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
