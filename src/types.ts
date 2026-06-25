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
  sourceRoots: string[];
  outputDir: string;
  schedule: ScheduleConfig;
  scanRules: ScanRules;
  safety: SafetyConfig;
}

export interface DeviceConfig {
  deviceId: string;
  deviceName: string;
}

export interface KeyStatus {
  exists: boolean;
  masked?: string | null;
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
  | "rejected"
  | "blocked"
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

export interface ActionTask {
  taskId: string;
  priority: number;
  projectId: string;
  title: string;
  taskType: ActionTaskType;
  targetRunner: ActionRunner;
  riskLevel: ActionRiskLevel;
  requiresApproval: boolean;
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
