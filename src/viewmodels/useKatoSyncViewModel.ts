import { useCallback, useEffect, useMemo, useState } from "react";
import {
  chooseFolders,
  deleteApiKey,
  deleteMcpConnectorToken,
  getApiKeyStatus,
  getLaunchAgentStatus,
  getMcpConnectorTokenStatus,
  installLaunchAgent,
  loadActionPlans,
  loadConfig,
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
  updateActionPlanStatus
} from "../repositories/katoSyncRepository";
import type { Notice } from "../components/Primitives";
import type {
  ActionPlan,
  AppConfig,
  RateLimitMetric,
  KeyStatus,
  LaunchAgentStatus,
  ScanSummary,
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
  | "logs";

export function useKatoSyncViewModel() {
  const [activeStep, setActiveStep] = useState<StepId>("dashboard");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [mcpTokenInput, setMcpTokenInput] = useState("");
  const [keyStatus, setKeyStatus] = useState<KeyStatus>({ exists: false });
  const [mcpTokenStatus, setMcpTokenStatus] = useState<KeyStatus>({ exists: false });
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [launchStatus, setLaunchStatus] = useState<LaunchAgentStatus | null>(null);
  const [rateLimits, setRateLimits] = useState<RateLimitMetric[]>([]);
  const [connectionOk, setConnectionOk] = useState(false);
  const [libraryOk, setLibraryOk] = useState(false);
  const [logs, setLogs] = useState("");
  const [actionPlans, setActionPlans] = useState<ActionPlan[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const show = useCallback((kind: Notice["kind"], text: string) => setNotice({ kind, text }), []);

  const boot = useCallback(async () => {
    try {
      const [loadedConfig, loadedKey, loadedMcpToken, loadedLaunch] = await Promise.all([
        loadConfig(),
        getApiKeyStatus(),
        getMcpConnectorTokenStatus(),
        getLaunchAgentStatus()
      ]);
      const loadedPlans = await loadActionPlans(loadedConfig);
      setConfig(loadedConfig);
      setKeyStatus(loadedKey);
      setMcpTokenStatus(loadedMcpToken);
      setLaunchStatus(loadedLaunch);
      setActionPlans(loadedPlans);
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
    setActionPlans(await loadActionPlans());
    show("info", "MCP Connector Token gelöscht.");
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
      show(
        "warn",
        "Action Plan freigegeben. Runner-Ausführung ist in diesem 2.0-Schnitt noch deaktiviert."
      );
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
    busy,
    completion,
    config,
    connectionOk,
    keyInput,
    keyStatus,
    libraryOk,
    launchStatus,
    logs,
    mcpTokenInput,
    mcpTokenStatus,
    notice,
    rateLimits,
    report,
    scan,
    handleChooseFolders,
    handleDeleteKey,
    handleDeleteMcpConnectorToken,
    handleLaunchInstall,
    handleLaunchRemove,
    handleLogs,
    handleQuitApp,
    handleRefreshActionPlans,
    handleRejectActionPlan,
    handleReviewActionPlan,
    handleRun,
    handleSaveKey,
    handleSaveMcpConnectorToken,
    handleScan,
    handleStartActionPlan,
    handleTestConnection,
    handleTestLibrary,
    openOutputDir,
    persist,
    setActiveStep,
    setKeyInput,
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
