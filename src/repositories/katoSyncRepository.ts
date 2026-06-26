import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { defaultConfig } from "../lib/defaults";
import type {
  ActionPlan,
  ActionRiskLevel,
  ActionPlanStatus,
  AppConfig,
  ApiCheckResponse,
  KeyStatus,
  LaunchAgentStatus,
  ScanSummary,
  SyncReport
} from "../types";

const mockConfigKey = "katosync.config";
const mockActionPlansKey = "katosync.actionPlans";
const mockMcpConnectorTokenKey = "katosync.mcpConnectorToken";
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

export async function updateActionPlanStatus(
  config: AppConfig | null,
  planId: string,
  status: ActionPlanStatus
): Promise<ActionPlan[]> {
  if (config) {
    const remotePlans = await tryUpdateRemoteActionPlanStatus(config, planId, status);
    if (remotePlans) return remotePlans;
  }
  const plans = await loadActionPlans(config ?? undefined);
  const nextPlans = plans.map((plan) => (plan.planId === planId ? { ...plan, status } : plan));
  localStorage.setItem(mockActionPlansKey, JSON.stringify(nextPlans));
  return nextPlans;
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

function mockActionPlans(): ActionPlan[] {
  return [
    {
      planId: "plan_2026_06_25_001",
      source: "mistral_scheduler",
      agentName: "Laura Mission Control",
      createdAt: "2026-06-25 07:15",
      status: "pending_user_review",
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
          summary: "Lokale Action-Plan-Struktur vorbereiten, noch ohne automatische Ausführung."
        },
        {
          taskId: "task_002",
          priority: 2,
          projectId: "katosync",
          title: "Statusflow nach Task-Abschluss ergänzen",
          taskType: "project_management_task",
          targetRunner: "manual_review",
          riskLevel: "low",
          requiresApproval: true,
          summary: "Ergebnisdateien und KATOSYNC_STATUSFLOW.md für spätere Runner vorbereiten."
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
          summary: "Prüft Token-Scopes, Tenant-Trennung und keine Service-Keys im Desktop."
        }
      ]
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

async function fetchRemoteActionPlans(config: AppConfig): Promise<RemoteActionPlansResponse> {
  const token = localStorage.getItem(mockMcpConnectorTokenKey);
  if (!token) throw new Error("Kein MCP Connector Token gespeichert.");
  const response = await fetch(`${config.mcp.baseUrl.replace(/\/$/, "")}/api/action-plans?status=pending_review&includeTasks=true`, {
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
        priority: index + 1,
        projectId: task.assignee || "katosync",
        title: task.title,
        taskType: "project_management_task",
        targetRunner: "manual_review",
        riskLevel: fromRemoteRisk(plan.risk_level),
        requiresApproval: true,
        summary: task.description
      }))
    };
  });
}

function fromRemoteStatus(status: string): ActionPlanStatus {
  if (status === "pending_review") return "pending_user_review";
  if (status === "approved" || status === "rejected" || status === "completed") return status;
  if (status === "running" || status === "queued") return "approved";
  if (status === "failed") return "blocked";
  return "pending_user_review";
}

function toRemoteStatus(status: ActionPlanStatus): string | null {
  if (status === "pending_user_review") return "pending_review";
  if (status === "approved" || status === "rejected" || status === "completed") return status;
  if (status === "blocked") return "failed";
  return null;
}

function fromRemoteRisk(risk: string): ActionRiskLevel {
  if (risk === "low" || risk === "medium" || risk === "high") return risk;
  return "critical";
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
    }
  };
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
