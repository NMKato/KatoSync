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
  dedupeUploads: boolean;
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
  // Modell-Wahl pro Runner (leer = Runner-Default) + Effort (nur Claude).
  codexModel: string;
  claudeModel: string;
  claudeEffort: string;
  // Opt-in: autonomer Connector-Lauf (Netz + Runner-Connectoren). Standard aus.
  runnerConnectorMode: boolean;
  // KatoContext: lokaler Referenzordner (Lebenslauf/Zeugnisse/Kontext) fuer den Datei-Modus.
  referenceRoot: string;
  // Codex-Bridge: gemerkter lokaler Repo-Ordner pro Projekt (projectId -> Pfad).
  projectRepos: Record<string, string>;
  // Agent Sync: sichere Standardreihenfolge; Local Control ist immer letzter Fallback.
  providerPriority: ProviderId[];
  // KatoSync-seitige Trennung. Provider-eigene CLI-Credentials bleiben unveraendert.
  disabledProviders: ProviderId[];
  // Ausschliesslich nicht-geheime Endpoint-Metadaten.
  localProvider: LocalProviderConfig;
  // Remote API Lane: mehrere nicht-geheime Connection-Slots. Secrets bleiben pro Slot im OS-Schluesselbund.
  apiProviders: ApiProviderConfig[];
  // Projektbezogene Routing-Vorwahl: projectId -> API connectionId. Fehlender Eintrag = Auto-Routing.
  apiProjectPreferences: Record<string, string>;
  // Legacy-Feld wird nur noch beim Einlesen alter Configs akzeptiert und beim Normalisieren migriert.
  apiProvider?: ApiProviderConfig;
}

export type ProviderId = "codex" | "claude" | "api" | "local" | "local_control";

export type ProviderState =
  | "installed"
  | "authenticated"
  | "available"
  | "quota_limited"
  | "auth_unavailable"
  | "capacity_unavailable"
  | "job_failed"
  | "offline"
  | "unknown";

export type LocalProviderKind = "ollama" | "lm_studio" | "open_ai_compatible";
export type ApiProviderPreset =
  | "openai"
  | "anthropic"
  | "openrouter_global"
  | "openrouter_eu"
  | "deepseek"
  | "mistral"
  | "xai"
  | "zai"
  | "custom_openai";
export type ApiEffort = "auto" | "low" | "medium" | "high" | "xhigh" | "max";
export type ApiConnectionMode = "auto" | "specialist" | "fallback";
export type ApiCapability =
  | "coding"
  | "reasoning"
  | "security"
  | "vision"
  | "image"
  | "video"
  | "long_context"
  | "tools";

export interface LocalProviderConfig {
  kind: LocalProviderKind;
  baseUrl: string;
  model: string;
}

export interface ApiProviderConfig {
  // Stabile, nicht geheime Slot-ID. Sie bindet den Key im OS-Schluesselbund und darf nach dem Anlegen nicht wechseln.
  id: string;
  label: string;
  preset: ApiProviderPreset;
  baseUrl: string;
  model: string;
  effort: ApiEffort;
  mode: ApiConnectionMode;
  capabilities: ApiCapability[];
  enabled: boolean;
}

export interface ApiProviderCatalog {
  connectionId: string;
  providerLabel: string;
  baseUrl: string;
  models: string[];
}

export interface ApiModelPricing {
  currency: "USD";
  inputPerMillion: number | null;
  cachedInputPerMillion: number | null;
  outputPerMillion: number | null;
  source: "provider" | "verified_catalog";
  effectiveAt: string;
  note?: string | null;
}

export interface ApiModelProfile {
  id: string;
  displayName: string;
  capabilities: ApiCapability[];
  supportedEfforts: ApiEffort[];
  contextWindow: number | null;
  pricing: ApiModelPricing | null;
  speed: "fast" | "balanced" | "deep" | "unknown";
}

export interface ApiUsageRecord {
  id: string;
  connectionId: string;
  projectId: string | null;
  provider: ApiProviderPreset;
  model: string;
  effort: ApiEffort;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reportedCostUsd: number | null;
  estimatedCostUsd: number | null;
  pricingEffectiveAt: string | null;
  createdAt: string;
}

export interface ApiUsageSummary {
  connectionId: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  requests: number;
  actualCostUsd: number | null;
  estimatedCostUsd: number;
  todayCostUsd: number;
  monthCostUsd: number;
  todayCostIsEstimate: boolean;
  monthCostIsEstimate: boolean;
  updatedAt: string | null;
}

export interface ApiWorkerResult {
  connectionId: string;
  providerLabel: string;
  model: string;
  effort: ApiEffort;
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
  reportedCostUsd: number | null;
  completedAt: string;
}

export interface ProviderSettings {
  disabledProviders: ProviderId[];
  localProvider: LocalProviderConfig;
  apiProviders: ApiProviderConfig[];
}

export type ProviderReason =
  | "not_checked"
  | "not_installed"
  | "not_configured"
  | "invalid_endpoint"
  | "sign_in_required"
  | "ready_test_pending"
  | "ready"
  | "disabled_in_kato_sync"
  | "quota_limited"
  | "capacity_limited"
  | "offline"
  | "timed_out"
  | "ready_test_failed"
  | "login_started"
  | "login_in_progress"
  | "login_cancelled"
  | "login_timed_out"
  | "login_failed"
  | "no_models"
  | "model_missing"
  | "endpoint_auth_required"
  | "endpoint_error"
  | "endpoint_invalid_response"
  | "capability_failed"
  | "insecure_remote_key"
  | "secret_store_unavailable"
  | "local_control_running"
  | "local_control_queue_only";

// Normalisierter, redigierter Provider-Status aus dem Rust-Adapter. Enthaelt nie Tokens/E-Mails.
export interface ProviderStatus {
  provider: ProviderId;
  label: string;
  state: ProviderState;
  reason: ProviderReason;
  installed: boolean;
  authenticated: boolean;
  available: boolean;
  enabled: boolean;
  failoverAllowed: boolean;
  version?: string | null;
  model?: string | null;
  endpointScope?: "local" | "lan" | "remote" | null;
  capabilities: string[];
  checkedAt: string;
  lastSuccessAt?: string | null;
  retryHint?: string | null;
  // Nur Frontend: letzter billiger Auth-/Status-Check. `checkedAt` bleibt die READY-Klassifikation.
  healthCheckedAt?: string | null;
  secretStored: boolean;
  detail?: string | null;
}

// UI-Zustand einer Providerkarte (menschlich lesbar, siehe providerPolicy.providerDisplayState).
export type ProviderDisplayState =
  | "notInstalled"
  | "notConfigured"
  | "connect"
  | "connecting"
  | "testRequired"
  | "connected"
  | "reauth"
  | "quota"
  | "unavailable"
  | "offline"
  | "disabled";

export type ProviderAction = "connect" | "test" | "disconnect" | "key" | "catalog";

export interface DiscoveredLocalProvider {
  kind: LocalProviderKind;
  baseUrl: string;
  models: string[];
}

export interface ProviderLoginUrlEvent {
  provider: ProviderId;
  url: string;
}

export interface ProviderTransition {
  provider: ProviderId;
  from: ProviderState;
  to: ProviderState;
  at: string;
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
  // Arbeitsplatz-Herkunft: die Library, aus der dieses Briefing erzeugt wurde (aus raw_payload,
  // vom Mistral-Skill gesetzt). Ungleich der lokalen library_id -> anderer Rechner (nur Ansicht).
  originLibraryId?: string | null;
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
  // Fortsetzbare Session (Human-in-the-Loop): ID aus dem Lauf (Codex thread_id / Claude session_id),
  // welcher Runner + Repo — damit „Fortsetzen" eine interaktive Terminal-Session öffnen kann.
  sessionId?: string | null;
  runner?: string;
  repoPath?: string;
}

export interface CodexRunState {
  status: "idle" | "running" | "completed" | "failed";
  startedAt?: string;
  lastActivityAt?: string;
  context?: {
    jobId: string;
    projectId: string;
    task: string;
    source: "action_plan" | "briefing";
    planId?: string | null;
    createdAt?: string | null;
    // Tatsaechlich gewaehlter Runner (Auto-Lane-Routing kann vom bevorzugten abweichen).
    runner?: string | null;
  };
  result?: CodexRunResult;
  error?: string;
}

// Live-Feed: ein gestreamtes Codex-Event (JSONL-Zeile, zusammengefasst).
export interface CodexEvent {
  taskId: string;
  seq: number;
  label: string;
  text: string;
  // Empfangszeit im ViewModel, falls der Runner selbst keinen Zeitstempel liefert.
  at?: string;
}

// Live-Status des Sync-Laufs (Upload-Fortschritt + sichtbarer Rate-Limit-Backoff).
export interface SyncEvent {
  phase: "uploading" | "rate_limit" | "rate_limit_abort" | "rate_limit_abort_day";
  file?: string;
  index?: number;
  total?: number;
  attempt?: number;
  waitSecs?: number;
  remaining?: number;
}

export interface LocalControlState {
  daemonPid: number;
  status: string;
  currentJobId?: string | null;
  lastCompletedJobId?: string | null;
  heartbeatAt: string;
  controlRoot: string;
}

export interface LocalControlJobSummary {
  id: string;
  status: string;
  exitCode?: number | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  cwd: string;
  command: string;
  mode: string;
  logPath: string;
  error?: string | null;
}

export interface LocalControlLaneSnapshot {
  laneId: string;
  projectId?: string | null;
  jobId: string;
  cwd: string;
  command: string;
  mode: string;
  resourceLocks: string[];
  startedAt: string;
}

export interface LocalControlQueuedJobSnapshot {
  laneId: string;
  projectId?: string | null;
  jobId: string;
  command: string;
  mode: string;
  resourceLocks: string[];
  requireCleanGit: boolean;
}

export interface LocalControlMonitorStats {
  total: number;
  completed: number;
  failed: number;
  timeout: number;
  avgDurationMs: number;
}

export interface LocalControlMonitorSnapshot {
  available: boolean;
  state?: LocalControlState | null;
  feed: string[];
  activeLanes: LocalControlLaneSnapshot[];
  queuedJobs: LocalControlQueuedJobSnapshot[];
  recentJobs: LocalControlJobSummary[];
  stats: LocalControlMonitorStats;
  // Externe Orchestrierungsvertraege im Control-Root (fehlt in aelteren Builds/Browser-Demo).
  orchestration?: OrchestrationSnapshot | null;
}

// ===== Orchestrierungs-Adapter (Rust: orchestration.rs) – roh, begrenzt, ohne absolute Pfade =====
export interface ProviderHealthSnapshot {
  checkedAt?: string | null;
  providers: Array<{ provider: string; installed: boolean; authenticated: boolean }>;
  waitingFallbackJobs: number;
  controlIdle: boolean;
  note?: string | null;
  lastEventAt?: string | null;
  // RESUME ohne RESUME_DONE im Scheduler-Log: eine Wiederaufnahme laeuft gerade.
  resumeInFlight?: { name: string; startedAt: string } | null;
}

export interface ContinuationSnapshot {
  planId: string;
  enabled: boolean;
  status: string;
  cursor: number;
  waveCount: number;
  activeJobId?: string | null;
  activeWaveName?: string | null;
  lastResultStatus?: string | null;
  lastResultWave?: string | null;
  updatedAt?: string | null;
}

export interface RemoteOrchestratorSnapshot {
  sessionId: string;
  state: "attached" | "working" | "detached";
  transport?: "rdc" | null;
  attachedAt?: string | null;
  heartbeatAt: string;
  leaseSeconds: number;
  leaseExpiresAt: string;
  transportHeartbeatAt?: string | null;
  jobId?: string | null;
  device?: string | null;
  model?: string | null;
  activity?: string | null;
  nextStep?: string | null;
}

export interface FallbackJobSnapshot {
  id: string;
  name: string;
  branch?: string | null;
  worktree?: string | null;
  status: string;
  reason?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  timeoutSeconds?: number | null;
  activeProvider?: string | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  providerStates: Array<{
    provider: string;
    state: string;
    exitCode?: number | null;
    retryAt?: string | null;
    retryHint?: string | null;
  }>;
  evidence: Array<{ key: string; value: string }>;
  branchMatches?: boolean | null;
  worktreeBusy: boolean;
}

export interface OrchestrationSnapshot {
  providerHealth?: ProviderHealthSnapshot | null;
  continuation?: ContinuationSnapshot | null;
  remoteOrchestrator?: RemoteOrchestratorSnapshot | null;
  fallbackJobs: FallbackJobSnapshot[];
}

// ===== Kanonisches Agent-Sync-Modell (lib/agentJobModel.ts) =====
// Providerunabhaengiger Vertrag zwischen ViewModel und allen Agent-Sync-Views. Texte sind Codes,
// die Views uebersetzen; Rohtexte gibt es nur fuer echte Feed-/Evidence-Zeilen.

// Fuenf kanonische Lanes: vier intelligente Besitzer + das deterministische Substrat.
export type AgentLaneId = "codex" | "claude" | "api" | "local" | "remote_orchestrator" | "local_control";
export type AgentJobStatus =
  | "queued"
  | "running"
  | "implemented"
  | "verifying"
  | "review_ready"
  | "human_gate"
  | "retry_wait"
  | "waiting"
  | "blocked"
  | "completed"
  | "failed";
export type AgentJobSource = "action_plan" | "runner" | "provider_router" | "continuation" | "local_control";
export type AgentJobEventKind = "state" | "activity" | "handoff" | "evidence" | "heartbeat";
export type AgentNextStep =
  | "await_event"
  | "review_merge"
  | "inspect_evidence"
  | "resume_deferred"
  | "resolve_gate"
  | "approve_plan"
  | "start_when_safe"
  | "start_local_control"
  | "await_provider_reset"
  | "await_scheduler_resume"
  | "await_intelligent_lane"
  | "release_stale_lease"
  | "prove_branch"
  | "await_worktree"
  | "await_writer"
  | "enable_auto_mode"
  | "map_repo"
  | "await_daily_reset";

export interface AgentHandoff {
  from: AgentLaneId | null;
  to: AgentLaneId;
  at?: string | null;
  // Failover-Klasse (quota_limited, auth_unavailable, ...) oder Handoff-Grund.
  reason: string;
  retryAt?: string | null;
}

export interface AgentJobEvent {
  id: string;
  jobId?: string | null;
  at: string;
  kind: AgentJobEventKind;
  // Rohtext nur fuer Feed-/Evidence-Zeilen; state/handoff tragen Codes.
  message?: string | null;
  code?: string | null;
  lane?: AgentLaneId | null;
  from?: AgentLaneId | null;
  to?: AgentLaneId | null;
}

export type AgentResumeBlock =
  | "safe"
  | "branch_unproven"
  | "worktree_busy"
  | "writer_active"
  | "orchestrator_lease"
  | "no_lane"
  | "provider_reset_pending";

export interface AgentJob {
  id: string;
  source: AgentJobSource;
  externalId?: string | null;
  projectId: string;
  task: string;
  // Aktueller Besitzer (wer arbeitet/arbeitete wirklich daran) – unabhaengig von Konnektivitaet.
  owner: AgentLaneId | null;
  model?: string | null;
  laneId?: string | null;
  device?: string | null;
  branch?: string | null;
  worktree?: string | null;
  status: AgentJobStatus;
  phase: string;
  createdAt?: string | null;
  startedAt?: string | null;
  lastActivityAt?: string | null;
  completedAt?: string | null;
  // Rohdetail (redigiert) fuer Blocker/Fehler; `reason` ist ein Code.
  blocker?: string | null;
  reason?: string | null;
  nextStep?: AgentNextStep | null;
  retryAt?: string | null;
  handoffs: AgentHandoff[];
  resume?: { safe: boolean; reason: AgentResumeBlock } | null;
  events: AgentJobEvent[];
}

export type AgentLaneConnectivity = "connected" | "limited" | "disconnected" | "disabled" | "not_configured" | "unknown";
export type AgentLaneActivity = "active" | "waiting" | "idle" | "blocked" | "offline" | "unknown";

export interface AgentLane {
  id: AgentLaneId;
  kind: "model_provider" | "orchestrator" | "substrate";
  // Local Control ist deterministisch und wird nie als LLM-Lane ausgewiesen.
  intelligent: boolean;
  rank: number;
  connectivity: AgentLaneConnectivity;
  activity: AgentLaneActivity;
  currentJobId?: string | null;
  model?: string | null;
  device?: string | null;
  checkedAt?: string | null;
  retryAt?: string | null;
  reason?: string | null;
  // Darf die Lane jetzt einen Job uebernehmen (Failover-Ziel)?
  eligible: boolean;
}

export interface RemoteOrchestratorRuntime {
  transport: "online" | "stale" | "unknown";
  transportAt?: string | null;
  orchestrator: "attached" | "working" | "stale" | "detached" | "unavailable";
  attachedAt?: string | null;
  heartbeatAt?: string | null;
  leaseExpiresAt?: string | null;
  // Unabgelaufene Lease blockiert andere Writer, auch wenn der Heartbeat schon alt ist.
  leaseActive: boolean;
  jobId?: string | null;
  device?: string | null;
  model?: string | null;
  activity?: string | null;
  eligible: boolean;
}

export interface AgentSchedulerRuntime {
  providerHealth: {
    state: "armed" | "resuming" | "stale" | "unknown";
    checkedAt?: string | null;
    nextCheckAt?: string | null;
    resumeJob?: string | null;
    waitingJobs: number;
  };
  continuation: {
    state: "armed" | "waiting_daemon" | "stopped" | "idle" | "unknown";
    planId?: string | null;
    activeWave?: string | null;
    cursor?: number | null;
    waveCount?: number | null;
    updatedAt?: string | null;
  };
}

export type AgentStartBlock =
  | "safe"
  | "runner_busy"
  | "worktree_lease_active"
  | "handoff_in_flight"
  | "orchestrator_lease"
  | "no_execution_lane";

export interface AgentStartSafety {
  safe: boolean;
  reason: AgentStartBlock;
}

// ===== Auto-Lane Planner (lib/autoLanePlanner.ts) =====
// Eine Auto-Lane = die geordnete, freigegebene Arbeit EINES Projekts. Sie ist keine reine UI-Lane:
// der Dispatcher im ViewModel startet genau die hier geplanten Kopf-Tasks ueber den bestehenden Runner.
export type AutoLaneRunner = "codex_cli" | "claude_cli";
export type AutoLaneState = "planned" | "queued" | "running" | "waiting" | "blocked";
export type AutoLaneReason =
  | "auto_off"
  | "ready"
  | "runner_slot"
  | "repo_busy"
  | "start_unsafe"
  | "no_runner_lane"
  | "daily_limit"
  | "merge_pending"
  | "orchestrator_owned"
  | "active"
  | "head_failed"
  | "interrupted_run"
  | "manual_gate"
  | "approval_required"
  | "repo_unmapped"
  | "repo_missing";

export interface AutoLane {
  id: string;
  projectId: string;
  state: AutoLaneState;
  reason: AutoLaneReason;
  // Zusatzcode (z. B. AgentStartBlock bei start_unsafe), nie Rohtext/Pfad.
  detail?: string | null;
  headTaskId: string;
  headTitle: string;
  runner?: AutoLaneRunner | null;
  nextStep: AgentNextStep | null;
  // Offene Tasks dieser Lane in Ausfuehrungsreihenfolge, Kopf-Task zuerst.
  taskIds: string[];
  pendingCount: number;
  retryAt?: string | null;
}

export interface AutoLaneDispatch {
  laneId: string;
  projectId: string;
  taskId: string;
  planId: string;
  runner: AutoLaneRunner;
}

// Persistierter Dispatch-Claim: wird VOR jedem await geschrieben und erst nach dem finalen
// Task-Status freigegeben -> kein Doppelstart bei Rerender, Tick oder App-Neustart.
export interface AutoLaneClaim {
  taskId: string;
  projectId: string;
  repoKey: string;
  runner: AutoLaneRunner;
  claimedAt: string;
}

export interface AutoLanePlan {
  enabled: boolean;
  lanes: AutoLane[];
  dispatch: AutoLaneDispatch[];
  counts: Record<AutoLaneState, number>;
  maxConcurrent: number;
  // Policy-Naht fuer Auto-Merge (Folgeschritt): heute immer manuell, kein Merge durch KatoSync.
  merge: { mode: "manual"; reason: "no_verified_merge_mechanism" };
}

export interface AgentSyncState {
  // null = ehrlich idle: gerade laeuft nachweislich nichts.
  currentJob: AgentJob | null;
  nextJob: AgentJob | null;
  jobs: AgentJob[];
  lanes: AgentLane[];
  events: AgentJobEvent[];
  handoffs: AgentHandoff[];
  counts: Record<AgentJobStatus, number>;
  queueCount: number;
  startSafety: AgentStartSafety;
  localControl: "unknown" | "offline" | "stale" | "idle" | "busy";
  remote: RemoteOrchestratorRuntime;
  scheduler: AgentSchedulerRuntime;
  autoLanes: AutoLanePlan;
  generatedAt: string;
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
