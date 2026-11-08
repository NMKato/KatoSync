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
  // Begrenzter Warm-up fuer Abo-CLIs (Codex/ChatGPT, Claude/claude.ai). Standard an; API-Key-Logins,
  // Local Brain und Local Control werden nie aufgewaermt.
  providerWarmupEnabled: boolean;
}

export type ProviderId = "codex" | "claude" | "local" | "local_control";

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

export interface LocalProviderConfig {
  kind: LocalProviderKind;
  baseUrl: string;
  model: string;
}

export interface ProviderSettings {
  disabledProviders: ProviderId[];
  localProvider: LocalProviderConfig;
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
  // Nur Codex/Claude: Anmeldeart der CLI (nie der Key selbst).
  authKind?: ProviderAuthKind | null;
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

export type ProviderAuthKind = "subscription" | "api_key" | "unknown";

// ===== Provider-Warm-up (Rust provider_warmup.rs) =====
export type WarmUpResult = "warmed" | "not_installed" | "not_authenticated" | "not_subscription" | "failed";

export interface ProviderWarmupEntry {
  lastSuccessAt?: string | null;
  lastAttemptAt?: string | null;
  lastResult?: WarmUpResult | null;
}

// Persistierte Zeitstempel (nur Zeiten + Ergebnis-Codes), ueberlebt App-Neustarts.
export interface ProviderWarmupState {
  schemaVersion: number;
  codex: ProviderWarmupEntry;
  claude: ProviderWarmupEntry;
}

export type WarmupOutcome =
  | "warmed"
  | "failed"
  | "skipped_unsupported"
  | "skipped_feature_disabled"
  | "skipped_provider_disabled"
  | "skipped_cooldown"
  | "skipped_backoff"
  | "skipped_runner_busy"
  | "skipped_work_active"
  | "skipped_in_flight"
  | "skipped_not_installed"
  | "skipped_not_authenticated"
  | "skipped_not_subscription"
  | "skipped_state_unavailable";

export interface WarmupReport {
  provider: ProviderId;
  outcome: WarmupOutcome;
  state: ProviderWarmupState;
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

export type ProviderAction = "connect" | "test" | "disconnect" | "key";

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
  // LaunchAgent-/Worker-Wahrheit; unabhaengig vom Zustand des zuletzt ausgefuehrten Plans.
  workerState?: "running" | "loaded" | "stopped" | "unknown";
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
export type AgentLaneId = "codex" | "claude" | "local" | "remote_orchestrator" | "local_control";
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
  // Gesetzt = ausserhalb des aktiven Fokus (geparkt/archiviert/unbekannt): sichtbar, nie empfohlen.
  focus?: FocusBlockReason | null;
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
  // Ein attached Heartbeat beaufsichtigt nur. KatoSync-Arbeit ist erst mit passendem Queue-Claim
  // (Session-Owner + beide Leases) eine eigene Lane.
  ownership: "external_supervisor" | "katosync_lane" | "unverified" | "stale" | "none";
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
  supervisor: {
    state: "active" | "stale" | "inactive" | "unknown";
    heartbeatAt?: string | null;
    activity?: string | null;
  };
  continuation: {
    state: "armed" | "waiting_daemon" | "failed" | "idle" | "unknown";
    workerState: "running" | "loaded" | "stopped" | "unknown";
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
  // Tasks, die der Fokus-Filter VOR dem Ranking ausgeschlossen hat (sichtbar, nie dispatchbar).
  excluded: AutoLaneExclusion[];
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

// ===== Project Registry + Focus Portfolio (lokal, read-only gegenueber den Projekten) =====
export type FocusStatus = "active" | "parked" | "archived";
export type FocusPriority = "P0" | "P1" | "P2";
// inherit = folgt dem globalen Auto-Schalter, on = ausdruecklich automatisch (wenn global an), off = nur manuell.
export type ProjectAutoMode = "inherit" | "on" | "off";

export interface FocusEntry {
  status: FocusStatus;
  priority: FocusPriority;
  autoMode: ProjectAutoMode;
  // Freitext-Eingrenzung ("nur E2E-Pfad"), rein informativ; die harte Grenze ist status/autoMode.
  scope?: string | null;
  origin: "default_profile" | "user" | "migration";
  updatedAt: string;
}

// Serialisierbare Sicht fuer Planer/Job-Modell: kanonische ID -> Fokus, Alias (normalisiert) -> kanonische ID.
export interface FocusPolicy {
  entries: Record<string, FocusEntry>;
  aliases: Record<string, string>;
}

export type FocusBlockReason = "unmapped" | "not_in_focus" | "parked" | "archived" | "project_manual";

export interface AutoLaneExclusion {
  projectId: string;
  reason: FocusBlockReason;
  taskIds: string[];
}

export type ProjectDocKind = "agents" | "readme" | "status" | "handoff" | "memory" | "rack" | "context" | "architecture";
export type DocExclusion = "secret_pattern" | "secret_name" | "too_large" | "unreadable";

export interface WorktreeFact {
  path: string;
  branch: string | null;
  headSha: string | null;
  detached: boolean;
  locked: boolean;
  dirtyCount: number | null;
}

// Rohfakten aus dem Rust-Adapter (nur lesend ermittelt, Remote ohne Zugangsdaten).
export interface RepoFacts {
  path: string;
  commonDir: string | null;
  mainWorktreePath: string | null;
  isLinkedWorktree: boolean;
  remote: string | null;
  branch: string | null;
  detached: boolean;
  headSha: string | null;
  headDate: string | null;
  dirtyCount: number;
  untrackedCount: number;
  ahead: number | null;
  behind: number | null;
  recentShas: string[];
  worktrees: WorktreeFact[];
  iconDataUrl: string | null;
}

export interface DocFact {
  path: string; // relativ zum Projektordner
  kind: ProjectDocKind;
  bytes: number;
  modifiedAt: string | null;
  // null, wenn ausgeschlossen. Wird nie persistiert.
  content: string | null;
  excluded: DocExclusion | null;
}

export interface ManifestFact {
  kind: string;
  path: string;
  name: string | null;
  version: string | null;
  hints: string[];
}

export interface ProjectProbe {
  repo: RepoFacts;
  docs: DocFact[];
  manifests: ManifestFact[];
  scannedAt: string;
}

export interface DiscoveryResult {
  root: string;
  repos: RepoFacts[];
  scannedDirs: number;
  truncated: boolean;
  skippedExcluded: number;
}

export interface DiscoveredProject {
  id: string;
  name: string;
  identityKey: string;
  remote: string | null;
  rootPath: string;
  commonDir: string | null;
  branch: string | null;
  headSha: string | null;
  dirtyCount: number;
  worktrees: WorktreeFact[];
  checkoutCount: number;
  alreadyRegistered: boolean;
  iconDataUrl: string | null;
  // Bekannte Fokus-Projekt-ID aus dem Standardprofil, falls erkannt.
  profileId: string | null;
}

export type VerificationState =
  | "verified"
  | "status_stale"
  | "dirty_worktree"
  | "review_pending"
  | "human_gate"
  | "docs_mismatch"
  | "no_status_doc"
  | "unscanned";

export type MismatchChoice = "use_code_truth" | "keep_docs_baseline" | "inspect";

export interface VerificationFinding {
  id: string;
  state: VerificationState;
  severity: "info" | "warn" | "danger";
  detail: string;
  docValue?: string | null;
  codeValue?: string | null;
  choices: MismatchChoice[];
  resolved?: "use_code_truth" | "keep_docs_baseline" | null;
}

export interface ProjectVerification {
  state: VerificationState;
  findings: VerificationFinding[];
  checkedAt: string;
  headSha: string | null;
}

export interface MismatchResolution {
  choice: "use_code_truth" | "keep_docs_baseline";
  at: string;
  headSha: string | null;
}

export interface ContextCapsule {
  schema: "katosync.project-capsule/v1";
  projectId: string;
  name: string;
  generatedAt: string;
  purpose: string;
  architecture: string[];
  guardrails: string[];
  currentWave: { text: string | null; basis: "documented" | "code_truth" | "none" };
  branches: Array<{ name: string; branch: string | null; dirty: boolean }>;
  lastVerification: { state: VerificationState; checkedAt: string; headSha: string | null };
  nextSafeWork: string[];
  sources: string[];
}

export interface ProjectScanSummary {
  scannedAt: string;
  branch: string | null;
  headSha: string | null;
  headDate: string | null;
  dirtyCount: number;
  worktrees: WorktreeFact[];
  docs: Array<{ path: string; kind: ProjectDocKind; modifiedAt: string | null; excluded: DocExclusion | null }>;
  manifests: ManifestFact[];
}

export interface RegistryProject {
  id: string; // stabil, wird nie aus dem Pfad neu berechnet
  name: string;
  identityKey: string;
  aliases: string[];
  rootPath: string;
  commonDir: string | null;
  remote: string | null;
  addedAt: string;
  source: "discovery" | "migration";
  focus: FocusEntry;
  scan: ProjectScanSummary | null;
  verification: ProjectVerification | null;
  capsule: ContextCapsule | null;
  resolutions: Record<string, MismatchResolution>;
}

export interface RegistryMigration {
  // Alte Einzel-Quellordner (config.sourceRoots) bleiben unveraendert bestehen, bis sie abgedeckt sind.
  sourceRoots: { status: "none" | "pending" | "done"; roots: string[]; checkedAt: string | null };
  projectRepos: { status: "none" | "pending" | "done"; checkedAt: string | null };
}

export interface ProjectRegistry {
  schemaVersion: 1;
  projects: RegistryProject[];
  migration: RegistryMigration;
  updatedAt: string;
}

// ===== Memory Fabric Overview (Rust: memory_fabric/overview.rs) – nur Zaehler, nie Inhalte/Pfade =====
export interface ProjectMemoryOverview {
  projectId: string;
  name: string;
  gitHead: string | null;
  gitBranch: string | null;
  indexedAt: string;
  sources: number;
  chunks: number;
  observed: number;
  verified: number;
  canonical: number;
}

export interface NodeIdentityOverview {
  nodeId: string;
  displayName: string;
  kind: "rex_main" | "named_node";
}

export interface MemoryFabricOverview {
  schemaVersion: "katosync.memory-overview/v1";
  fabricSchemaVersion: string;
  // false = noch kein Store bzw. unbekannte Schema-Version.
  available: boolean;
  projects: ProjectMemoryOverview[];
  identities: NodeIdentityOverview[];
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}
