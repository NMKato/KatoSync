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
