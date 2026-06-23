import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { defaultConfig } from "../lib/defaults";
import type {
  AppConfig,
  ApiCheckResponse,
  KeyStatus,
  LaunchAgentStatus,
  ScanSummary,
  SyncReport
} from "../types";

const mockConfigKey = "katosync.config";
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
    device: {
      deviceId: config.device?.deviceId || "demo-device",
      deviceName: config.device?.deviceName || "Dieser Rechner"
    }
  };
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
