export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface ScheduleConfig {
  enabled: boolean;
  hour: number;
  minute: number;
  weekdays: Weekday[];
}

export interface ScanRules {
  includeMemory: boolean;
  includeRoadmaps: boolean;
  includeTasks: boolean;
  includeCsv: boolean;
  includeDocuments: boolean;
  maxFileSizeMb: number;
  uploadIndividualStatusFiles: boolean;
  maxIndividualUploads: number;
}

export interface SafetyConfig {
  dryRunDefault: boolean;
  cleanupEnabled: boolean;
  secretScanEnabled: boolean;
}

export interface AppConfig {
  appVersion: string;
  device: DeviceConfig;
  libraryId: string;
  mcp: McpConfig;
  sourceRoots: string[];
  outputDir: string;
  schedule: ScheduleConfig;
  scanRules: ScanRules;
  safety: SafetyConfig;
  // Codex-Bridge v2: Branch nach erfolgreichem Lauf pushen / PR erstellen.
  codexAutoPush: boolean;
  codexCreatePr: boolean;
  codexCodingMode: boolean;
  // Multi-Runner: bevorzugter lokaler Runner.
  codexPreferredRunner: "codex_cli" | "claude_cli";
  // Codex-Bridge: gemerkter lokaler Repo-Ordner pro Projekt (projectId -> Pfad).
  projectRepos: Record<string, string>;
}

export interface McpConfig {
  baseUrl: string;
}

export interface DeviceConfig {
  deviceId: string;
  deviceName: string;
}

export interface KeyStatus {
  exists: boolean;
  masked?: string | null;
}

export interface SupabaseSessionStatus {
  loggedIn: boolean;
  email?: string | null;
}

export interface GeneratedConnectorToken {
  token: string;
  status: KeyStatus;
}

export interface RateLimitMetric {
  label: string;
  limit?: string | null;
  remaining?: string | null;
  reset?: string | null;
}

export interface ApiCheckResponse {
  message: string;
  rateLimits: RateLimitMetric[];
}

export interface FileFinding {
  path: string;
  relativePath: string;
  category: string;
  sizeBytes: number;
  modifiedAt: string;
  skipped: boolean;
  reason?: string | null;
}

export interface ScanSummary {
  scannedFiles: number;
  relevantFiles: number;
  skippedFiles: number;
  secretWarnings: number;
  findings: FileFinding[];
}

export interface UploadResult {
  fileName: string;
  documentId?: string | null;
  processingStatus?: string | null;
  rateLimits?: RateLimitMetric[];
  success: boolean;
  error?: string | null;
}

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  outputDir: string;
  snapshotDir: string;
  dryRun: boolean;
  scan: ScanSummary;
  currentFiles: string[];
  uploaded: UploadResult[];
  warnings: string[];
  errors: string[];
}

export type ActionPlanStatus =
  | "pending_user_review"
  | "in_review"
  | "approved"
  | "running"
  | "rejected"
  | "blocked"
  | "failed"
  | "completed";

export type ActionTaskType =
  | "code_task"
  | "desktop_task"
  | "research_task"
  | "document_task"
  | "email_task"
  | "form_task"
  | "visual_task"
  | "project_management_task"
  | "katoos_task";

export type ActionRunner =
  | "codex_cli"
  | "codex_desktop"
  | "kai_desktop"
  | "local_llm"
  | "mistral_api"
  | "openai_api"
  | "anthropic_api"
  | "manual_review";

export type ActionRiskLevel = "low" | "medium" | "high" | "critical";

// Projekt-Board: Task-Status spiegelt die Server-Spalte action_tasks.status.
// Server-Superset enthaelt zusaetzlich 'approved'; das Mapping faengt es als 'queued' ab.
// 'deferred' = aufgeschoben (vom sequentiellen Executor uebersprungen).
export type ActionTaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "executed"
  | "completed"
  | "rejected"
  | "failed"
  | "deferred";

export interface ActionTask {
  taskId: string;
  // Ausfuehrungs-Rang (1 = zuerst). Kanonisch NUMBER; eindirektional aus dem Server-sort_order abgeleitet.
  // NICHT verwechseln mit der textuellen Server-Spalte action_tasks.priority (Severity) - die nutzt das Board nicht.
  priority: number;
  projectId: string; // Server: project_external_id ("__no_project__" = ohne Projekt)
  title: string;
  taskType: ActionTaskType;
  targetRunner: ActionRunner; // Server: target_runner (nur codex_cli ist lokal ausfuehrbar)
  riskLevel: ActionRiskLevel; // Server: risk_level (jetzt PRO TASK, nicht mehr vom Plan)
  requiresApproval: boolean;
  status: ActionTaskStatus; // Server: action_tasks.status
  // Abschluss-Rueckkanal: PR/Branch des ausgefuehrten Laufs (fuer Anzeige + Merge-Check).
  prUrl?: string | null;
  branch?: string | null;
  summary?: string | null;
}

export interface ActionPlan {
  planId: string;
  source: string;
  agentName: string;
  createdAt: string;
  status: ActionPlanStatus;
  executionMode: "sequential" | "manual";
  dailyLimit: number;
  riskLevel: ActionRiskLevel;
  requiresUserReview: boolean;
  tasks: ActionTask[];
}

export type BriefingStatus = "new" | "accepted" | "queued" | "rejected" | "archived";

export type BriefingPriority = "low" | "medium" | "high" | "critical";

export interface Briefing {
  briefingId: string;
  source: string;
  agentName: string;
  title: string;
  createdAt: string;
  status: BriefingStatus;
  priority: BriefingPriority;
  summary: string;
  body: string;
  suggestedAction?: string | null;
  archivedAt?: string | null;
}

export interface CodexRunRequest {
  baseUrl: string;
  repoPath: string;
  trigger: "action_task" | "briefing";
  actionPlanId?: string | null;
  actionTaskId?: string | null;
  briefingId?: string | null;
  projectId: string;
  priority: number;
  title: string;
  riskLevel: string;
  prompt: string;
  inputPlan: unknown;
  dryRun?: boolean;
  timeoutSecs?: number;
  // Multi-Runner: welcher lokale Runner ausfuehrt ("codex_cli" | "claude_cli").
  runner?: string;
}

export interface CodexRunResult {
  status: string;
  branch: string;
  runDir: string;
  changedFiles: string[];
  commit?: string | null;
  resultSummary: string;
  exitCode?: number | null;
  durationMs: number;
  error?: string | null;
  // Codex-Bridge v2
  pushed?: boolean;
  branchUrl?: string | null;
  prUrl?: string | null;
  // Datei-Modus dieses Laufs (autoritativ aus dem Rust-Lauf, nicht aus der UI-Config abgeleitet).
  fileMode?: boolean;
}

export interface CodexRunState {
  status: "idle" | "running" | "completed" | "failed";
  result?: CodexRunResult;
  error?: string;
}

// Live-Feed: ein gestreamtes Codex-Event (JSONL-Zeile, zusammengefasst).
export interface CodexEvent {
  taskId: string;
  seq: number;
  label: string;
  text: string;
}

export interface LaunchAgentStatus {
  installed: boolean;
  loaded: boolean;
  plistPath: string;
  message: string;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}
