import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { defaultConfig } from "../lib/defaults";
import type {
  ActionPlan,
  ActionRiskLevel,
  ActionPlanStatus,
  ActionRunner,
  ActionTask,
  ActionTaskStatus,
  AppConfig,
  CodexEvent,
  ApiCheckResponse,
  Briefing,
  BriefingPriority,
  BriefingStatus,
  CodexRunRequest,
  CodexRunResult,
  GeneratedConnectorToken,
  KeyStatus,
  LaunchAgentStatus,
  ScanSummary,
  SupabaseSessionStatus,
  SyncReport
} from "../types";

const mockConfigKey = "katosync.config";
// v2: Projekt-Board fuegt Tasks ein Pflichtfeld 'status' hinzu -> Key-Bump verwirft Alt-Caches ohne status.
const mockActionPlansKey = "katosync.actionPlans.v2";
const mockBriefingsKey = "katosync.briefings";
const mockMcpConnectorTokenKey = "katosync.mcpConnectorToken";
// Projekt-Board: Tasks ohne project_external_id landen in einer neutralen "Ohne Projekt"-Gruppe.
export const NO_PROJECT_ID = "__no_project__";
const isTauri = () => Boolean(window.__TAURI_INTERNALS__);

export async function loadConfig(): Promise<AppConfig> {
  if (isTauri()) {
    return invoke<AppConfig>("load_config");
  }
  const stored = localStorage.getItem(mockConfigKey);
  return normalizeConfig(stored ? JSON.parse(stored) : defaultConfig);
}

export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  if (isTauri()) {
    return invoke<AppConfig>("save_config", { config });
  }
  const normalized = normalizeConfig(config);
  localStorage.setItem(mockConfigKey, JSON.stringify(normalized));
  return normalized;
}

export async function chooseFolders(): Promise<string[]> {
  if (isTauri()) {
    const selected = await open({ directory: true, multiple: true });
    if (!selected) return [];
    return Array.isArray(selected) ? selected : [selected];
  }
  const value = window.prompt(
    "Browser-Demo: Gib einen Beispielpfad ein. In der echten Desktop-App öffnet sich hier der macOS-Finder.",
    "/Users/dein-name/Projects/KatoOS"
  );
  if (!value?.trim()) return [];
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function saveApiKey(apiKey: string): Promise<KeyStatus> {
  if (isTauri()) {
    return invoke<KeyStatus>("save_api_key", { apiKey });
  }
  sessionStorage.setItem("katosync.mockKey", apiKey);
  return { exists: true, masked: maskKey(apiKey) };
}

export async function getApiKeyStatus(): Promise<KeyStatus> {
  if (isTauri()) {
    return invoke<KeyStatus>("api_key_status");
  }
  const key = sessionStorage.getItem("katosync.mockKey");
  return { exists: Boolean(key), masked: key ? maskKey(key) : null };
}

export async function deleteApiKey(): Promise<KeyStatus> {
  if (isTauri()) {
    return invoke<KeyStatus>("delete_api_key");
  }
  sessionStorage.removeItem("katosync.mockKey");
  return { exists: false, masked: null };
}

export async function saveMcpConnectorToken(token: string): Promise<KeyStatus> {
  if (isTauri()) {
    return invoke<KeyStatus>("save_mcp_connector_token", { token });
  }
  localStorage.setItem(mockMcpConnectorTokenKey, token.trim());
  return { exists: true, masked: maskKey(token.trim()) };
}

export async function getMcpConnectorTokenStatus(): Promise<KeyStatus> {
  if (isTauri()) {
    return invoke<KeyStatus>("mcp_connector_token_status");
  }
  const token = localStorage.getItem(mockMcpConnectorTokenKey);
  return { exists: Boolean(token), masked: token ? maskKey(token) : null };
}

export async function deleteMcpConnectorToken(): Promise<KeyStatus> {
  if (isTauri()) {
    return invoke<KeyStatus>("delete_mcp_connector_token");
  }
  localStorage.removeItem(mockMcpConnectorTokenKey);
  return { exists: false, masked: null };
}

export async function getSupabaseSession(): Promise<SupabaseSessionStatus> {
  if (isTauri()) {
    return invoke<SupabaseSessionStatus>("supabase_session_status");
  }
  return { loggedIn: false, email: null };
}

export async function loginSupabase(email: string, password: string): Promise<SupabaseSessionStatus> {
  if (isTauri()) {
    return invoke<SupabaseSessionStatus>("login_supabase", { email, password });
  }
  throw new Error("Login ist nur in der Desktop-App verfügbar.");
}

export async function signupSupabase(email: string, password: string): Promise<SupabaseSessionStatus> {
  if (isTauri()) {
    return invoke<SupabaseSessionStatus>("signup_supabase", { email, password });
  }
  throw new Error("Registrierung ist nur in der Desktop-App verfügbar.");
}

export async function logoutSupabase(): Promise<SupabaseSessionStatus> {
  if (isTauri()) {
    return invoke<SupabaseSessionStatus>("logout_supabase");
  }
  return { loggedIn: false, email: null };
}

export async function generateConnectorToken(config: AppConfig): Promise<GeneratedConnectorToken> {
  if (!isTauri()) {
    throw new Error("Token-Generierung ist nur in der Desktop-App verfügbar.");
  }
  const result = await invoke<{ connectorToken?: string }>("mint_connector_token", {
    baseUrl: config.mcp.baseUrl
  });
  const token = result?.connectorToken;
  if (!token) {
    throw new Error("Der Server hat kein Connector-Token zurückgegeben.");
  }
  const status = await saveMcpConnectorToken(token);
  return { token, status };
}

export async function dirExists(path: string): Promise<boolean> {
  if (!path) return false;
  if (isTauri()) {
    try {
      return await invoke<boolean>("dir_exists", { path });
    } catch {
      return false;
    }
  }
  return true; // Browser-Demo: keine echte FS-Pruefung
}

// Live-Feed: abonniert gestreamte Codex-Events. Gibt eine Unsubscribe-Funktion zurueck.
export async function listenCodexEvents(cb: (event: CodexEvent) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const unlisten = await listen<CodexEvent>("codex-event", (evt) => cb(evt.payload));
    return unlisten;
  } catch {
    return () => {};
  }
}

export async function chooseRepoFolder(defaultPath?: string): Promise<string | null> {
  if (isTauri()) {
    const selected = await open({ directory: true, multiple: false, defaultPath });
    if (!selected) return null;
    return Array.isArray(selected) ? selected[0] ?? null : selected;
  }
  const value = window.prompt("Projektordner für den Codex-Lauf (absoluter Pfad):", defaultPath ?? "");
  return value?.trim() ? value.trim() : null;
}

export async function runCodexTask(req: CodexRunRequest): Promise<CodexRunResult> {
  if (isTauri()) {
    return invoke<CodexRunResult>("run_codex_task", { req });
  }
  await delay(900);
  return {
    status: "completed",
    branch: `katosync/demo/${new Date().toISOString().slice(0, 10)}/task-1-demo`,
    runDir: "(browser-demo)",
    changedFiles: ["src/demo.ts"],
    commit: "demo0000",
    resultSummary: "Browser-Demo: kein echter Codex-Lauf.",
    exitCode: 0,
    durationMs: 900,
    error: null
  };
}

const codexGuardrails = [
  "Arbeite ausschliesslich im aktuellen Repository. Aendere keine Dateien ausserhalb.",
  "Kein git merge, kein push, kein Branch-Wechsel, keine force-Operationen.",
  "Gib keine Secrets/Keys aus und committe keine.",
  "Wenn die Aufgabe unklar oder zu riskant ist, aendere nichts und erklaere kurz warum.",
  "Schreibe am Ende eine kurze Zusammenfassung deiner Aenderungen."
]
  .map((line) => `- ${line}`)
  .join("\n");

export function buildCodexPromptFromTask(plan: ActionPlan, task: ActionTask): string {
  return [
    `# Aufgabe: ${task.title}`,
    "",
    "## Ziel",
    task.summary || task.title,
    "",
    "## Kontext",
    `Quelle: ${plan.agentName} (${plan.source})`,
    `Projekt: ${task.projectId}`,
    `Aufgabentyp: ${task.taskType}`,
    `Risiko: ${task.riskLevel}`,
    "",
    "## Leitplanken (verbindlich)",
    codexGuardrails
  ].join("\n");
}

export function buildCodexPromptFromBriefing(briefing: Briefing): string {
  return [
    `# Briefing-Auftrag: ${briefing.title}`,
    "",
    "## Auszufuehren",
    briefing.suggestedAction || briefing.summary,
    "",
    "## Kontext (Briefing)",
    briefing.summary,
    "",
    briefing.body,
    "",
    "## Leitplanken (verbindlich)",
    codexGuardrails
  ].join("\n");
}

export async function testConnection(apiKey?: string): Promise<ApiCheckResponse> {
  if (isTauri()) {
    return invoke<ApiCheckResponse>("test_mistral_connection", { apiKey });
  }
  await delay(450);
  if (!apiKey && !sessionStorage.getItem("katosync.mockKey")) {
    throw new Error("Demo: Kein API-Key vorhanden.");
  }
  return {
    message: "Demo-Verbindung erfolgreich.",
    rateLimits: [
      { label: "Requests", limit: "Demo", remaining: "Demo" },
      { label: "Tokens/Monat", limit: "Live nach echtem API-Test", remaining: null }
    ]
  };
}

export async function testLibrary(libraryId: string, apiKey?: string): Promise<ApiCheckResponse> {
  if (isTauri()) {
    return invoke<ApiCheckResponse>("test_library", { libraryId, apiKey });
  }
  await delay(400);
  if (!libraryId.trim()) throw new Error("Library ID fehlt.");
  return {
    message: "Demo-Library gefunden.",
    rateLimits: [
      { label: "Requests", limit: "Demo", remaining: "Demo" },
      { label: "Tokens/Minute", limit: "Live nach echtem API-Test", remaining: null }
    ]
  };
}

export async function scanProject(config: AppConfig): Promise<ScanSummary> {
  if (isTauri()) {
    return invoke<ScanSummary>("scan_project", { config });
  }
  await delay(550);
  return mockScan(config);
}

export async function runSync(config: AppConfig, dryRun: boolean): Promise<SyncReport> {
  if (isTauri()) {
    return invoke<SyncReport>("run_sync", { config, dryRun });
  }
  await delay(850);
  const scan = mockScan(config);
  const currentFiles = currentFileNames(config);
  return {
    startedAt: new Date().toLocaleString("de-DE"),
    finishedAt: new Date().toLocaleString("de-DE"),
    outputDir: config.outputDir,
    snapshotDir: `${config.outputDir}/snapshots/2026-06-23`,
    dryRun,
    scan,
    currentFiles,
    uploaded: dryRun
      ? []
      : [
          {
            fileName: currentFiles[0],
            documentId: "demo-doc-019e",
            processingStatus: "queued",
            success: true
          }
        ],
    warnings: scan.secretWarnings > 0 ? ["Demo: 1 Datei mit Secret-Muster übersprungen."] : [],
    errors: []
  };
}

export async function installLaunchAgent(config: AppConfig): Promise<LaunchAgentStatus> {
  if (isTauri()) {
    return invoke<LaunchAgentStatus>("install_launch_agent", { config });
  }
  await delay(300);
  return {
    installed: true,
    loaded: true,
    plistPath: "~/Library/LaunchAgents/com.nmkato.katosync.sync.plist",
    message: "Demo-Uploadplan aktiv."
  };
}

export async function removeLaunchAgent(): Promise<LaunchAgentStatus> {
  if (isTauri()) {
    return invoke<LaunchAgentStatus>("remove_launch_agent");
  }
  return {
    installed: false,
    loaded: false,
    plistPath: "~/Library/LaunchAgents/com.nmkato.katosync.sync.plist",
    message: "Demo-Uploadplan entfernt."
  };
}

export async function getLaunchAgentStatus(): Promise<LaunchAgentStatus> {
  if (isTauri()) {
    return invoke<LaunchAgentStatus>("launch_agent_status");
  }
  return {
    installed: false,
    loaded: false,
    plistPath: "~/Library/LaunchAgents/com.nmkato.katosync.sync.plist",
    message: "Demo-Uploadplan nicht installiert."
  };
}

export async function readLogs(): Promise<string> {
  if (isTauri()) {
    return invoke<string>("read_logs");
  }
  return [
    "== sync.log ==",
    "[2026-06-23 22:00:00] Dry-Run gestartet.",
    "[2026-06-23 22:00:01] 8 relevante Dateien gefunden.",
    "[2026-06-23 22:00:02] CURRENT-Dateien erzeugt.",
    "[2026-06-23 22:00:02] Upload übersprungen: Dry-Run."
  ].join("\n");
}

export async function openOutputDir(): Promise<string> {
  if (isTauri()) {
    return invoke<string>("open_output_dir");
  }
  return defaultConfig.outputDir;
}

export async function loadActionPlans(config?: AppConfig): Promise<ActionPlan[]> {
  if (config) {
    const remotePlans = await tryLoadRemoteActionPlans(config);
    if (remotePlans) return remotePlans;
  }
  const stored = localStorage.getItem(mockActionPlansKey);
  if (stored) return JSON.parse(stored) as ActionPlan[];
  const plans = mockActionPlans();
  localStorage.setItem(mockActionPlansKey, JSON.stringify(plans));
  return plans;
}

export async function loadBriefings(config?: AppConfig): Promise<Briefing[]> {
  if (config) {
    const remoteBriefings = await tryLoadRemoteBriefings(config);
    if (remoteBriefings) return remoteBriefings;
  }
  const stored = localStorage.getItem(mockBriefingsKey);
  if (stored) return JSON.parse(stored) as Briefing[];
  const briefings = mockBriefings();
  localStorage.setItem(mockBriefingsKey, JSON.stringify(briefings));
  return briefings;
}

export async function updateBriefingStatus(
  config: AppConfig | null,
  briefingId: string,
  status: BriefingStatus
): Promise<Briefing[]> {
  if (config) {
    const remoteBriefings = await tryUpdateRemoteBriefingStatus(config, briefingId, status);
    if (remoteBriefings) {
      return remoteBriefings.map((briefing) =>
        briefing.briefingId === briefingId ? { ...briefing, status } : briefing
      );
    }
  }
  const briefings = await loadBriefings(config ?? undefined);
  const nextBriefings = briefings.map((briefing) =>
    briefing.briefingId === briefingId ? { ...briefing, status } : briefing
  );
  localStorage.setItem(mockBriefingsKey, JSON.stringify(nextBriefings));
  return nextBriefings;
}

export async function archiveBriefing(
  config: AppConfig | null,
  current: Briefing[],
  briefingId: string,
  archived: boolean
): Promise<Briefing[]> {
  if (config) {
    const remoteBriefings = await tryArchiveRemoteBriefing(config, briefingId, archived);
    if (remoteBriefings) return remoteBriefings;
  }
  // Lokaler Fallback (Demo ODER Server kennt das Feld noch nicht): auf dem AKTUELL
  // angezeigten Stand arbeiten, NICHT die Liste neu laden -> sonst gehen zuvor lokal
  // archivierte Briefings verloren.
  const nextBriefings = current.map((briefing) =>
    briefing.briefingId === briefingId
      ? { ...briefing, archivedAt: archived ? new Date().toISOString() : null }
      : briefing
  );
  localStorage.setItem(mockBriefingsKey, JSON.stringify(nextBriefings));
  return nextBriefings;
}

export async function deleteBriefing(
  config: AppConfig | null,
  current: Briefing[],
  briefingId: string
): Promise<Briefing[]> {
  if (config) {
    const remoteBriefings = await tryDeleteRemoteBriefing(config, briefingId);
    if (remoteBriefings) return remoteBriefings;
  }
  const nextBriefings = current.filter((briefing) => briefing.briefingId !== briefingId);
  localStorage.setItem(mockBriefingsKey, JSON.stringify(nextBriefings));
  return nextBriefings;
}

export async function updateActionPlanStatus(
  config: AppConfig | null,
  planId: string,
  status: ActionPlanStatus
): Promise<ActionPlan[]> {
  if (config) {
    const remotePlans = await tryUpdateRemoteActionPlanStatus(config, planId, status);
    if (remotePlans) {
      return remotePlans.map((plan) => (plan.planId === planId ? { ...plan, status } : plan));
    }
  }
  const plans = await loadActionPlans(config ?? undefined);
  const nextPlans = plans.map((plan) => (plan.planId === planId ? { ...plan, status } : plan));
  localStorage.setItem(mockActionPlansKey, JSON.stringify(nextPlans));
  return nextPlans;
}

export interface TaskStatusExtra {
  prUrl?: string | null;
  branch?: string | null;
}

// Abschluss-Rueckkanal: prueft via Tauri, ob ein ausgefuehrter Task gemerged/erledigt ist.
// Liefert "merged" | "closed" | "open" | "unknown".
export async function checkCodexTask(
  repoPath: string,
  branch: string,
  prUrl: string
): Promise<string> {
  if (isTauri()) {
    try {
      return await invoke<string>("check_codex_task", { repoPath, branch, prUrl });
    } catch {
      return "unknown";
    }
  }
  return "open"; // Browser-Demo
}

// Projekt-Board: setzt den Status eines einzelnen Tasks (serverseitig persistent).
export async function updateActionTaskStatus(
  config: AppConfig | null,
  taskId: string,
  status: ActionTaskStatus,
  extra?: TaskStatusExtra
): Promise<ActionPlan[]> {
  const patch = (task: ActionTask) =>
    task.taskId === taskId
      ? {
          ...task,
          status,
          prUrl: extra?.prUrl ?? task.prUrl ?? null,
          branch: extra?.branch ?? task.branch ?? null
        }
      : task;
  if (config) {
    const remotePlans = await tryUpdateRemoteActionTaskStatus(config, taskId, status, extra);
    if (remotePlans) {
      return remotePlans.map((plan) => ({ ...plan, tasks: plan.tasks.map(patch) }));
    }
  }
  const plans = await loadActionPlans(config ?? undefined);
  const nextPlans = plans.map((plan) => ({ ...plan, tasks: plan.tasks.map(patch) }));
  localStorage.setItem(mockActionPlansKey, JSON.stringify(nextPlans));
  return nextPlans;
}

async function tryUpdateRemoteActionTaskStatus(
  config: AppConfig,
  taskId: string,
  status: ActionTaskStatus,
  extra?: TaskStatusExtra
): Promise<ActionPlan[] | null> {
  const remoteStatus = toRemoteTaskStatus(status);
  const prUrl = extra?.prUrl ?? undefined;
  const branch = extra?.branch ?? undefined;
  try {
    const tokenStatus = await getMcpConnectorTokenStatus();
    if (!tokenStatus.exists) return null;
    if (isTauri()) {
      await invoke("update_remote_action_task_status", {
        baseUrl: config.mcp.baseUrl,
        taskId,
        status: remoteStatus,
        prUrl,
        branch
      });
    } else {
      await patchRemoteActionTaskStatus(config, taskId, remoteStatus, prUrl, branch);
    }
    return tryLoadRemoteActionPlans(config);
  } catch (error) {
    console.warn("MCP Action Task konnte nicht aktualisiert werden.", error);
    return null;
  }
}

async function patchRemoteActionTaskStatus(
  config: AppConfig,
  taskId: string,
  status: string,
  prUrl?: string,
  branch?: string
): Promise<void> {
  const token = localStorage.getItem(mockMcpConnectorTokenKey);
  if (!token) throw new Error("Kein MCP Connector Token gespeichert.");
  const body: Record<string, unknown> = { status };
  if (prUrl) body.prUrl = prUrl;
  if (branch) body.branch = branch;
  const response = await fetch(`${config.mcp.baseUrl.replace(/\/$/, "")}/api/action-tasks/${taskId}/status`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`MCP Action Task konnte nicht aktualisiert werden (${response.status}).`);
}

export async function quitApp(): Promise<void> {
  if (isTauri()) {
    return invoke<void>("quit_app");
  }
  console.info("Demo: Programm würde jetzt beendet.");
}

function mockScan(config: AppConfig): ScanSummary {
  const base = config.sourceRoots[0] || "/Users/team/Projects/KatoOS";
  return {
    scannedFiles: 48,
    relevantFiles: 8,
    skippedFiles: 5,
    secretWarnings: 1,
    findings: [
      file(base, "KatoOS/Projektstatusflow.md", "status", 18422, false),
      file(base, "KatoOS/roadmap.md", "roadmap", 7220, false),
      file(base, "KatoOS/tasks.md", "task", 5120, false),
      file(base, "Claude/memory/MEMORY.md", "memory", 38112, false),
      file(base, "Client-Roadmaps/project_status.md", "status", 11944, false),
      file(base, "Client-Roadmaps/private_token_notes.md", "status", 1660, true, "Secret-Muster erkannt")
    ]
  };
}

function file(
  root: string,
  relativePath: string,
  category: string,
  sizeBytes: number,
  skipped: boolean,
  reason?: string
) {
  return {
    path: `${root}/${relativePath}`,
    relativePath,
    category,
    sizeBytes,
    modifiedAt: "2026-06-23 10:42",
    skipped,
    reason
  };
}

function maskKey(key: string) {
  return key.length > 8 ? `${key.slice(0, 7)}****${key.slice(-4)}` : "****";
}

function currentFileNames(config: AppConfig) {
  return [
    currentFileName(config, "CURRENT_MISTRAL_BRIEFING_SOURCE", "md"),
    currentFileName(config, "CURRENT_MISTRAL_BRIEFING_SOURCE", "txt"),
    currentFileName(config, "CURRENT_PROJECT_STATUS_ALL", "md"),
    currentFileName(config, "CURRENT_MEMORY_ALL", "md"),
    currentFileName(config, "CURRENT_SNAPSHOT_INDEX", "md"),
    currentFileName(config, "CURRENT_MANIFEST", "md")
  ];
}

function currentFileName(config: AppConfig, stem: string, extension: string) {
  return `${stem}__${deviceSlug(config)}.${extension}`;
}

// Demo-Fallback: NUR aktiv ohne Token/Server (kein Feature). Bildet die Projekt-Board-Felder
// konsistent ab (Multi-Projekt-Plan + Task-Status); ein bereits freigegebener Plan macht den
// Board-Executor im Browser-Demo sichtbar.
function mockActionPlans(): ActionPlan[] {
  return [
    {
      planId: "plan_2026_06_25_001",
      source: "mistral_scheduler",
      agentName: "Laura Mission Control",
      createdAt: "2026-06-25 07:15",
      status: "approved",
      executionMode: "sequential",
      dailyLimit: 3,
      riskLevel: "medium",
      requiresUserReview: true,
      tasks: [
        {
          taskId: "task_001",
          priority: 1,
          projectId: "katosync",
          title: "Codex Bridge Datenmodell prüfen",
          taskType: "code_task",
          targetRunner: "codex_cli",
          riskLevel: "medium",
          requiresApproval: true,
          status: "pending",
          summary: "Lokale Action-Plan-Struktur vorbereiten, noch ohne automatische Ausführung."
        },
        {
          taskId: "task_002",
          priority: 2,
          projectId: "katoos-web",
          title: "Statusflow nach Task-Abschluss ergänzen",
          taskType: "code_task",
          targetRunner: "codex_cli",
          riskLevel: "low",
          requiresApproval: true,
          status: "executed",
          branch: "katosync/katoos-web/2026-06-28/task-2-statusflow",
          summary: "Ausgeführt – wartet auf Verifikation (Browser-Demo, kein echter PR)."
        }
      ]
    },
    {
      planId: "plan_2026_06_25_002",
      source: "mcp_connector_test",
      agentName: "Thomas Risk Check",
      createdAt: "2026-06-25 07:05",
      status: "pending_user_review",
      executionMode: "manual",
      dailyLimit: 1,
      riskLevel: "high",
      requiresUserReview: true,
      tasks: [
        {
          taskId: "task_003",
          priority: 1,
          projectId: "katoos-mcp",
          title: "MCP Connector-Sicherheitsregeln reviewen",
          taskType: "research_task",
          targetRunner: "manual_review",
          riskLevel: "high",
          requiresApproval: true,
          status: "pending",
          summary: "Prüft Token-Scopes, Tenant-Trennung und keine Service-Keys im Desktop."
        }
      ]
    }
  ];
}

function mockBriefings(): Briefing[] {
  return [
    {
      briefingId: "briefing_2026_06_26_001",
      source: "mistral_scheduler",
      agentName: "Laura Mission Control",
      title: "Morgenfokus KatoSync 2.0",
      createdAt: "2026-06-26 07:15",
      status: "new",
      priority: "high",
      summary:
        "KatoSync 2.0 ist bereit für den nächsten Struktur-Schnitt: Briefings, Settings und lokale Runner-Freigabe sauber trennen.",
      body: [
        "KatoSync sollte Briefings als eigene Lesefläche behandeln, nicht als kleine Dashboard-Karte. Die Seite braucht eine Liste links und eine große Detailansicht rechts.",
        "Action Plans bleiben in der Action Queue und werden erst nach lokaler Freigabe vorbereitet. Es wird nichts automatisch ausgeführt.",
        "Settings bündeln API, Library, MCP Token, Gerätekennung, Scan-Regeln und später die Codex-CLI-Verbindung."
      ].join("\n\n"),
      suggestedAction: "Briefing-Seite aktivieren und Codex-Bridge als vorbereiteten Settings-Baustein sichtbar machen."
    },
    {
      briefingId: "briefing_2026_06_26_002",
      source: "mcp_connector_test",
      agentName: "Thomas Risk Check",
      title: "MCP Rückkanal Sicherheitsprüfung",
      createdAt: "2026-06-26 07:05",
      status: "new",
      priority: "medium",
      summary:
        "Connector Tokens bleiben pro Tenant getrennt. Service-Role-Keys dürfen nie in der Desktop-App landen.",
      body: [
        "Der Desktop speichert nur den Connector Token im lokalen Schlüsselbund. Der Server validiert den Token gegen einen Hash.",
        "Action Plans werden lokal angezeigt und müssen durch den User freigegeben werden. Dadurch bleibt die Ausführung menschlich kontrolliert.",
        "Für mehrere Geräte ist die Geräte-ID in den CURRENT-Dateien wichtig, damit Mistral Quellen sauber unterscheiden kann."
      ].join("\n\n"),
      suggestedAction: "Token-Flow dokumentieren und in der Settings-Seite eindeutig als Rückkanal markieren."
    }
  ];
}

interface RemoteActionPlansResponse {
  ok: boolean;
  plans: RemoteActionPlanRow[];
  tasksByPlanId?: Record<string, RemoteActionTaskRow[]>;
}

interface RemoteActionPlanRow {
  id: string;
  source: string;
  agent_name: string | null;
  created_at: string;
  status: string;
  risk_level: string;
  execution_mode: string;
  title: string;
  summary: string | null;
}

interface RemoteActionTaskRow {
  id: string;
  action_plan_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assignee: string | null;
  due_at: string | null;
  sort_order: number;
  // Projekt-Board (Migration 0006); bei Alt-Tasks ggf. null/undefined.
  project_external_id?: string | null;
  risk_level?: string | null;
  target_runner?: string | null;
  // Abschluss-Rueckkanal (Migration 0007)
  pr_url?: string | null;
  branch?: string | null;
}

interface RemoteBriefingsResponse {
  ok: boolean;
  briefings: RemoteBriefingRow[];
}

interface RemoteBriefingRow {
  id: string;
  source: string;
  agent_name: string | null;
  title: string;
  summary: string | null;
  body: string | null;
  status: string;
  priority: string;
  created_at: string;
  suggested_action: string | null;
  archived_at: string | null;
}

async function tryLoadRemoteActionPlans(config: AppConfig): Promise<ActionPlan[] | null> {
  try {
    const tokenStatus = await getMcpConnectorTokenStatus();
    if (!tokenStatus.exists) return null;
    const response = isTauri()
      ? await invoke<RemoteActionPlansResponse>("load_remote_action_plans", {
          baseUrl: config.mcp.baseUrl
        })
      : await fetchRemoteActionPlans(config);
    return mapRemoteActionPlans(response);
  } catch (error) {
    console.warn("MCP Action Queue nicht erreichbar, nutze lokale Demo-Pläne.", error);
    return null;
  }
}

async function tryUpdateRemoteActionPlanStatus(
  config: AppConfig,
  planId: string,
  status: ActionPlanStatus
): Promise<ActionPlan[] | null> {
  const remoteStatus = toRemoteStatus(status);
  if (!remoteStatus) return null;
  try {
    const tokenStatus = await getMcpConnectorTokenStatus();
    if (!tokenStatus.exists) return null;
    if (isTauri()) {
      await invoke("update_remote_action_plan_status", {
        baseUrl: config.mcp.baseUrl,
        planId,
        status: remoteStatus
      });
    } else {
      await patchRemoteActionPlanStatus(config, planId, remoteStatus);
    }
    return tryLoadRemoteActionPlans(config);
  } catch (error) {
    console.warn("MCP Action Plan konnte nicht aktualisiert werden.", error);
    return null;
  }
}

async function tryLoadRemoteBriefings(config: AppConfig): Promise<Briefing[] | null> {
  try {
    const tokenStatus = await getMcpConnectorTokenStatus();
    if (!tokenStatus.exists) return null;
    const response = isTauri()
      ? await invoke<RemoteBriefingsResponse>("load_remote_briefings", {
          baseUrl: config.mcp.baseUrl
        })
      : await fetchRemoteBriefings(config);
    return mapRemoteBriefings(response);
  } catch (error) {
    console.warn("MCP Briefings nicht erreichbar, nutze lokale Demo-Briefings.", error);
    return null;
  }
}

async function tryUpdateRemoteBriefingStatus(
  config: AppConfig,
  briefingId: string,
  status: BriefingStatus
): Promise<Briefing[] | null> {
  try {
    const tokenStatus = await getMcpConnectorTokenStatus();
    if (!tokenStatus.exists) return null;
    if (isTauri()) {
      await invoke("update_remote_briefing_status", {
        baseUrl: config.mcp.baseUrl,
        briefingId,
        status
      });
    } else {
      await patchRemoteBriefingStatus(config, briefingId, status);
    }
    return tryLoadRemoteBriefings(config);
  } catch (error) {
    console.warn("MCP Briefing konnte nicht aktualisiert werden.", error);
    return null;
  }
}

async function fetchRemoteActionPlans(config: AppConfig): Promise<RemoteActionPlansResponse> {
  const token = localStorage.getItem(mockMcpConnectorTokenKey);
  if (!token) throw new Error("Kein MCP Connector Token gespeichert.");
  const response = await fetch(`${config.mcp.baseUrl.replace(/\/$/, "")}/api/action-plans?status=pending_review,approved&includeTasks=true`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`MCP Action Queue nicht erreichbar (${response.status}).`);
  return response.json() as Promise<RemoteActionPlansResponse>;
}

async function patchRemoteActionPlanStatus(
  config: AppConfig,
  planId: string,
  status: string
): Promise<void> {
  const token = localStorage.getItem(mockMcpConnectorTokenKey);
  if (!token) throw new Error("Kein MCP Connector Token gespeichert.");
  const response = await fetch(`${config.mcp.baseUrl.replace(/\/$/, "")}/api/action-plans/${planId}/status`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status })
  });
  if (!response.ok) throw new Error(`MCP Action Plan konnte nicht aktualisiert werden (${response.status}).`);
}

async function fetchRemoteBriefings(config: AppConfig): Promise<RemoteBriefingsResponse> {
  const token = localStorage.getItem(mockMcpConnectorTokenKey);
  if (!token) throw new Error("Kein MCP Connector Token gespeichert.");
  const response = await fetch(`${config.mcp.baseUrl.replace(/\/$/, "")}/api/briefings?includeArchived=true&limit=100`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`MCP Briefings nicht erreichbar (${response.status}).`);
  return response.json() as Promise<RemoteBriefingsResponse>;
}

async function patchRemoteBriefingStatus(
  config: AppConfig,
  briefingId: string,
  status: BriefingStatus
): Promise<void> {
  const token = localStorage.getItem(mockMcpConnectorTokenKey);
  if (!token) throw new Error("Kein MCP Connector Token gespeichert.");
  const response = await fetch(`${config.mcp.baseUrl.replace(/\/$/, "")}/api/briefings/${briefingId}/status`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status })
  });
  if (!response.ok) throw new Error(`MCP Briefing konnte nicht aktualisiert werden (${response.status}).`);
}

async function tryArchiveRemoteBriefing(
  config: AppConfig,
  briefingId: string,
  archived: boolean
): Promise<Briefing[] | null> {
  try {
    const tokenStatus = await getMcpConnectorTokenStatus();
    if (!tokenStatus.exists) return null; // Demo-Modus -> lokaler Mock.
    if (isTauri()) {
      await invoke("archive_remote_briefing", {
        baseUrl: config.mcp.baseUrl,
        briefingId,
        archived
      });
    } else {
      await patchRemoteBriefingArchive(config, briefingId, archived);
    }
    return tryLoadRemoteBriefings(config);
  } catch (error) {
    // Server (noch) nicht erreichbar/deployt -> lokal weiterarbeiten (wie bei Annehmen/Ablehnen).
    console.warn("MCP Briefing konnte nicht archiviert werden, nutze lokalen Stand.", error);
    return null;
  }
}

async function tryDeleteRemoteBriefing(
  config: AppConfig,
  briefingId: string
): Promise<Briefing[] | null> {
  try {
    const tokenStatus = await getMcpConnectorTokenStatus();
    if (!tokenStatus.exists) return null; // Demo-Modus -> lokaler Mock.
    if (isTauri()) {
      await invoke("delete_remote_briefing", {
        baseUrl: config.mcp.baseUrl,
        briefingId
      });
    } else {
      await deleteRemoteBriefing(config, briefingId);
    }
    return tryLoadRemoteBriefings(config);
  } catch (error) {
    console.warn("MCP Briefing konnte nicht geloescht werden, nutze lokalen Stand.", error);
    return null;
  }
}

async function patchRemoteBriefingArchive(
  config: AppConfig,
  briefingId: string,
  archived: boolean
): Promise<void> {
  const token = localStorage.getItem(mockMcpConnectorTokenKey);
  if (!token) throw new Error("Kein MCP Connector Token gespeichert.");
  const response = await fetch(`${config.mcp.baseUrl.replace(/\/$/, "")}/api/briefings/${briefingId}/archive`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ archived })
  });
  if (!response.ok) throw new Error(`MCP Briefing konnte nicht archiviert werden (${response.status}).`);
}

async function deleteRemoteBriefing(config: AppConfig, briefingId: string): Promise<void> {
  const token = localStorage.getItem(mockMcpConnectorTokenKey);
  if (!token) throw new Error("Kein MCP Connector Token gespeichert.");
  const response = await fetch(`${config.mcp.baseUrl.replace(/\/$/, "")}/api/briefings/${briefingId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`MCP Briefing konnte nicht geloescht werden (${response.status}).`);
}

function mapRemoteBriefings(response: RemoteBriefingsResponse): Briefing[] {
  return (response.briefings ?? []).map((briefing) => ({
    briefingId: briefing.id,
    source: briefing.source,
    agentName: briefing.agent_name || "Mistral Work",
    title: briefing.title,
    createdAt: formatRemoteDate(briefing.created_at),
    status: fromRemoteBriefingStatus(briefing.status),
    priority: fromRemoteBriefingPriority(briefing.priority),
    summary: briefing.summary || "",
    body: briefing.body ?? "",
    suggestedAction: briefing.suggested_action,
    archivedAt: briefing.archived_at ?? null
  }));
}

function fromRemoteBriefingStatus(status: string): BriefingStatus {
  if (status === "accepted" || status === "queued" || status === "rejected" || status === "archived") return status;
  return "new";
}

function fromRemoteBriefingPriority(priority: string): BriefingPriority {
  if (priority === "low" || priority === "medium" || priority === "high" || priority === "critical") return priority;
  return "medium";
}

function mapRemoteActionPlans(response: RemoteActionPlansResponse): ActionPlan[] {
  return (response.plans ?? []).map((plan) => {
    const tasks = response.tasksByPlanId?.[plan.id] ?? [];
    return {
      planId: plan.id,
      source: plan.source,
      agentName: plan.agent_name || "Mistral Work",
      createdAt: formatRemoteDate(plan.created_at),
      status: fromRemoteStatus(plan.status),
      executionMode: plan.execution_mode === "auto_allowed" ? "sequential" : "manual",
      dailyLimit: Math.max(1, tasks.length || 1),
      riskLevel: fromRemoteRisk(plan.risk_level),
      requiresUserReview: plan.execution_mode !== "auto_allowed",
      tasks: tasks.map((task, index) => ({
        taskId: task.id,
        // Ausfuehrungs-Rang aus dem Server-sort_order (Fallback Array-Index).
        priority: typeof task.sort_order === "number" ? task.sort_order + 1 : index + 1,
        // "Ohne Projekt"-Sentinel statt assignee/katosync, damit NULL-Tasks nicht fehlbeschriftet werden.
        projectId: task.project_external_id || NO_PROJECT_ID,
        title: task.title,
        taskType: "project_management_task",
        targetRunner: fromRemoteRunner(task.target_runner),
        riskLevel: fromRemoteRisk(task.risk_level ?? plan.risk_level),
        requiresApproval: true,
        status: fromRemoteTaskStatus(task.status),
        prUrl: task.pr_url ?? null,
        branch: task.branch ?? null,
        summary: task.description
      }))
    };
  });
}

function fromRemoteStatus(status: string): ActionPlanStatus {
  if (status === "pending_review") return "pending_user_review";
  if (
    status === "approved" ||
    status === "rejected" ||
    status === "completed" ||
    status === "running" ||
    status === "failed"
  )
    return status;
  if (status === "queued") return "approved";
  return "pending_user_review";
}

function toRemoteStatus(status: ActionPlanStatus): string | null {
  if (status === "pending_user_review") return "pending_review";
  if (
    status === "approved" ||
    status === "rejected" ||
    status === "completed" ||
    status === "running" ||
    status === "failed"
  )
    return status;
  if (status === "blocked") return "failed";
  return null;
}

function fromRemoteRisk(risk: string | null | undefined): ActionRiskLevel {
  if (risk === "low" || risk === "medium" || risk === "high" || risk === "critical") return risk;
  if (risk === "blocked") return "critical"; // Plan-Level 'blocked' -> hoechste App-Stufe
  return "medium";
}

// Projekt-Board: Vertrag = volle App-ActionRunner-Union (Server-CHECK ist deckungsgleich).
function fromRemoteRunner(runner: string | null | undefined): ActionRunner {
  const allowed: ActionRunner[] = [
    "codex_cli",
    "codex_desktop",
    "kai_desktop",
    "local_llm",
    "mistral_api",
    "openai_api",
    "anthropic_api",
    "manual_review"
  ];
  return allowed.includes(runner as ActionRunner) ? (runner as ActionRunner) : "manual_review";
}

function fromRemoteTaskStatus(status: string | null | undefined): ActionTaskStatus {
  if (
    status === "pending" ||
    status === "queued" ||
    status === "running" ||
    status === "executed" ||
    status === "completed" ||
    status === "rejected" ||
    status === "failed" ||
    status === "deferred"
  )
    return status;
  if (status === "approved") return "queued"; // Server-Superset defensiv abfangen
  return "pending";
}

// App-Werte == Server-Werte (Identitaet); separat gehalten fuer Symmetrie zu toRemoteStatus.
function toRemoteTaskStatus(status: ActionTaskStatus): string {
  return status;
}

function formatRemoteDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("de-DE");
}

function deviceSlug(config: AppConfig) {
  const name = slugify(config.device.deviceName);
  const id = slugify(config.device.deviceId).slice(-8);
  if (name && id) return `${name}_${id}`;
  return name || id || "device";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "s")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    mcp: {
      baseUrl: config.mcp?.baseUrl || defaultConfig.mcp.baseUrl
    },
    device: {
      deviceId: config.device?.deviceId || "demo-device",
      deviceName: config.device?.deviceName || "Dieser Rechner"
    },
    codexAutoPush: config.codexAutoPush ?? defaultConfig.codexAutoPush,
    codexCreatePr: config.codexCreatePr ?? defaultConfig.codexCreatePr,
    codexCodingMode: config.codexCodingMode ?? defaultConfig.codexCodingMode,
    projectRepos: config.projectRepos ?? {}
  };
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
