//! Sichere Provider-Adapter fuer Agent Sync.
//!
//! Provider-eigene Zugangsdaten (Codex/ChatGPT, Claude Code) werden weder gelesen noch
//! gespeichert. Die Adapter starten ausschliesslich dokumentierte CLI-Kommandos aus festen
//! Argumentvektoren (keine Shell, keine interpolierten Werte) und geben nur normalisierte,
//! redigierte Statusdaten an das Frontend zurueck. Einziges KatoSync-eigenes Secret ist ein
//! optionaler API-Key fuer OpenAI-kompatible Endpunkte; er liegt ausschliesslich im
//! OS-Schluesselbund und ist an den Origin des Endpunkts gebunden.
//!
//! (Created by NMKato Solutions)

use crate::endpoint_guard::{self, EndpointRejection, TargetKind, ValidatedEndpoint};
use chrono::{DateTime, Utc};
use regex::Regex;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    env,
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader},
    process::{ChildStdin, Command},
    sync::{Mutex as AsyncMutex, Notify},
    time::timeout,
};
use zeroize::Zeroize;

const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
const SMOKE_TIMEOUT: Duration = Duration::from_secs(60);
const LOCAL_TIMEOUT: Duration = Duration::from_secs(8);
const RESERVED_LOCAL_BRAIN_DETAIL: &str =
    "Port 17842 ist fuer die KatoSync-verwaltete Local-Brain-Runtime reserviert; \
     ohne Besitznachweis wird dieser Endpunkt nicht angesprochen";
const LOCAL_CAPABILITY_TIMEOUT: Duration = Duration::from_secs(60);
const API_TIMEOUT: Duration = Duration::from_secs(20);
const API_CAPABILITY_TIMEOUT: Duration = Duration::from_secs(90);
const API_WORKER_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_API_WORKER_PROMPT_BYTES: usize = 32 * 1024;
const MAX_API_WORKER_CONTEXT_BYTES: usize = 128 * 1024;
const DISCOVERY_TIMEOUT: Duration = Duration::from_millis(1500);
const MAX_LOCAL_RESPONSE_BYTES: usize = 1_048_576;
// Remote-Modellkataloge (z. B. OpenRouter) sind deutlich groesser als lokale Listen.
const MAX_API_CATALOG_BYTES: usize = 8 * 1_048_576;
const MAX_API_CATALOG_MODELS: usize = 2_000;
const MAX_CAPTURED_BYTES: usize = 262_144;
const LOCAL_CONTROL_HEARTBEAT_MAX_AGE_SECS: i64 = 90;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const LOCAL_KEY_ACCOUNT: &str = "local-provider-api-key";
// Legacy-Key aus Preview-Builds vor Multi-API. Neue Keys werden pro Connection-ID getrennt gespeichert.
const API_KEY_ACCOUNT: &str = "api-provider-api-key";
const API_KEY_ACCOUNT_PREFIX: &str = "api-provider-api-key:";
const SMOKE_PROMPT: &str = "Reply with exactly READY and no other text.";
/// Warm-up: dieselbe READY-Pruefung, aber ausdruecklich ohne Tools/Dateien/Repo-Zugriff, damit ein
/// Abo-Provider sein rollierendes Nutzungsfenster startet, bevor echte Arbeit ansteht.
pub(crate) const WARMUP_PROMPT: &str = "KatoSync provider warm-up health check. Do not use any tools. Do not read, list, create or modify any files and do not run any commands. Reply with exactly READY and no other text.";

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderId {
    Codex,
    Claude,
    Api,
    Local,
    LocalControl,
}

impl ProviderId {
    fn label(self) -> &'static str {
        match self {
            Self::Codex => "OpenAI Codex",
            Self::Claude => "Anthropic Claude Code",
            Self::Api => "API Provider",
            Self::Local => "Local Model",
            Self::LocalControl => "Local Control / RDC",
        }
    }
}

/// Normalisierte Provider-Zustaende gemaess Agent-Sync-Adaptervertrag (#11).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderState {
    Installed,
    Authenticated,
    Available,
    QuotaLimited,
    AuthUnavailable,
    CapacityUnavailable,
    JobFailed,
    Offline,
    Unknown,
}

/// Anmeldeart der Provider-CLI. Nur `Subscription` (ChatGPT-Login bzw. claude.ai-Abo) kommt fuer
/// einen Warm-up in Frage; API-Key-Anmeldungen verursachen echte Kosten und bleiben ausgenommen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderAuthKind {
    Subscription,
    ApiKey,
    Unknown,
}

/// Menschlich lesbarer Grund; das Frontend uebersetzt ihn (i18n), Rust liefert keine UI-Texte.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderReason {
    NotChecked,
    NotInstalled,
    NotConfigured,
    InvalidEndpoint,
    SignInRequired,
    ReadyTestPending,
    Ready,
    DisabledInKatoSync,
    QuotaLimited,
    CapacityLimited,
    Offline,
    TimedOut,
    ReadyTestFailed,
    LoginStarted,
    LoginInProgress,
    LoginCancelled,
    LoginTimedOut,
    LoginFailed,
    NoModels,
    ModelMissing,
    EndpointAuthRequired,
    EndpointError,
    EndpointInvalidResponse,
    CapabilityFailed,
    InsecureRemoteKey,
    SecretStoreUnavailable,
    LocalControlRunning,
    LocalControlQueueOnly,
    ApiKeyProviderMismatch,
    /// Ziel liegt in einem gesperrten Netzbereich (privat, Link-Local, Metadaten, Multicast ...).
    EndpointBlocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum LocalProviderKind {
    #[default]
    Ollama,
    LmStudio,
    OpenAiCompatible,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProviderConfig {
    #[serde(default)]
    pub kind: LocalProviderKind,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ApiProviderPreset {
    Openai,
    Anthropic,
    OpenrouterGlobal,
    #[default]
    OpenrouterEu,
    Deepseek,
    Mistral,
    Xai,
    Zai,
    CustomOpenai,
}

impl ApiProviderPreset {
    fn label(self) -> &'static str {
        match self {
            Self::Openai => "OpenAI API",
            Self::Anthropic => "Anthropic API",
            Self::OpenrouterGlobal => "OpenRouter Global",
            Self::OpenrouterEu => "OpenRouter EU",
            Self::Deepseek => "DeepSeek API",
            Self::Mistral => "Mistral API",
            Self::Xai => "xAI API",
            Self::Zai => "Z.AI / GLM API",
            Self::CustomOpenai => "Custom OpenAI-compatible",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ApiEffort {
    #[default]
    Auto,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ApiConnectionMode {
    #[default]
    Auto,
    Specialist,
    Fallback,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiProviderConfig {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub preset: ApiProviderPreset,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub effort: ApiEffort,
    #[serde(default)]
    pub mode: ApiConnectionMode,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    // Optionales Monatsbudget in USD; Durchsetzung ueber das Usage-Ledger der App.
    #[serde(default)]
    pub monthly_budget_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiProviderCatalog {
    pub connection_id: String,
    pub provider_label: String,
    pub base_url: String,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiWorkerResult {
    pub connection_id: String,
    pub provider_label: String,
    pub model: String,
    pub effort: ApiEffort,
    pub content: String,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub reported_cost_usd: Option<f64>,
    pub completed_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettings {
    #[serde(default)]
    pub disabled_providers: Vec<ProviderId>,
    #[serde(default)]
    pub local_provider: LocalProviderConfig,
    #[serde(default)]
    pub api_providers: Vec<ApiProviderConfig>,
}

impl ProviderSettings {
    fn enabled(&self, provider: ProviderId) -> bool {
        provider == ProviderId::LocalControl || !self.disabled_providers.contains(&provider)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider: ProviderId,
    pub label: String,
    pub state: ProviderState,
    pub reason: ProviderReason,
    pub installed: bool,
    pub authenticated: bool,
    /// Nur Codex/Claude: Abo-Login oder API-Key (nie der Key selbst).
    pub auth_kind: Option<ProviderAuthKind>,
    pub available: bool,
    pub enabled: bool,
    pub failover_allowed: bool,
    pub version: Option<String>,
    pub model: Option<String>,
    pub endpoint_scope: Option<String>,
    pub capabilities: Vec<String>,
    pub checked_at: String,
    pub last_success_at: Option<String>,
    /// Nur vom Provider direkt gemeldeter Reset-Hinweis (z. B. "try again at 10:34 PM").
    pub retry_hint: Option<String>,
    /// KatoSync-eigenes Secret (nur Local-Endpoint-API-Key) im OS-Schluesselbund vorhanden.
    pub secret_stored: bool,
    /// Redigiertes technisches Detail fuer Diagnosen; nie Tokens, E-Mails oder Home-Pfade.
    pub detail: Option<String>,
}

impl ProviderStatus {
    fn base(provider: ProviderId, enabled: bool) -> Self {
        Self {
            provider,
            label: provider.label().to_string(),
            state: ProviderState::Unknown,
            reason: ProviderReason::NotChecked,
            installed: false,
            authenticated: false,
            auth_kind: None,
            available: false,
            enabled,
            failover_allowed: true,
            version: None,
            model: None,
            endpoint_scope: None,
            capabilities: Vec::new(),
            checked_at: Utc::now().to_rfc3339(),
            last_success_at: None,
            retry_hint: None,
            secret_stored: false,
            detail: None,
        }
    }

    fn fail(&mut self, state: ProviderState, reason: ProviderReason, detail: Option<&str>) {
        self.state = state;
        self.reason = reason;
        self.available = false;
        self.failover_allowed = allows_failover(state);
        self.detail = detail.map(redact).filter(|value| !value.trim().is_empty());
        if matches!(
            state,
            ProviderState::QuotaLimited | ProviderState::CapacityUnavailable
        ) {
            self.retry_hint = detail.and_then(extract_retry_hint);
        }
    }

    fn ready(&mut self, reason: ProviderReason) {
        self.state = ProviderState::Available;
        self.reason = reason;
        self.authenticated = true;
        self.available = true;
        self.failover_allowed = false;
        self.last_success_at = Some(Utc::now().to_rfc3339());
        self.detail = None;
    }
}

/// Lokal entdeckter Endpunkt (nur Loopback, nur bekannte Standardports).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredLocalProvider {
    pub kind: LocalProviderKind,
    pub base_url: String,
    pub models: Vec<String>,
}

// ---------------------------------------------------------------------------------------------
// Kommandovertrag: feste, statische Argumentvektoren pro Provider/Zweck.
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CommandPurpose {
    Version,
    AuthStatus,
    Login,
    Smoke,
    WarmUp,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CommandSpec {
    args: &'static [&'static str],
    timeout: Duration,
    /// READY-Tests laufen in einem neutralen Temp-Verzeichnis, damit keine Projektdateien,
    /// Projekt-Instruktionen oder Repo-Hooks geladen werden.
    neutral_cwd: bool,
}

fn command_spec(provider: ProviderId, purpose: CommandPurpose) -> Option<CommandSpec> {
    let (args, timeout, neutral_cwd): (&'static [&'static str], Duration, bool) =
        match (provider, purpose) {
            (ProviderId::Codex | ProviderId::Claude, CommandPurpose::Version) => {
                (&["--version"], AUTH_TIMEOUT, false)
            }
            (ProviderId::Codex, CommandPurpose::AuthStatus) => {
                (&["login", "status"], AUTH_TIMEOUT, false)
            }
            (ProviderId::Codex, CommandPurpose::Login) => (&["login"], LOGIN_TIMEOUT, false),
            (ProviderId::Codex, CommandPurpose::Smoke) => (
                &[
                    "exec",
                    "--ephemeral",
                    "--skip-git-repo-check",
                    "--sandbox",
                    "read-only",
                    "--color",
                    "never",
                    "--json",
                    SMOKE_PROMPT,
                ],
                SMOKE_TIMEOUT,
                true,
            ),
            (ProviderId::Codex, CommandPurpose::WarmUp) => (
                &[
                    "exec",
                    "--ephemeral",
                    "--skip-git-repo-check",
                    "--sandbox",
                    "read-only",
                    "--color",
                    "never",
                    "--json",
                    WARMUP_PROMPT,
                ],
                SMOKE_TIMEOUT,
                true,
            ),
            (ProviderId::Claude, CommandPurpose::AuthStatus) => {
                (&["auth", "status", "--json"], AUTH_TIMEOUT, false)
            }
            (ProviderId::Claude, CommandPurpose::Login) => {
                (&["auth", "login"], LOGIN_TIMEOUT, false)
            }
            (ProviderId::Claude, CommandPurpose::Smoke) => (
                &[
                    "-p",
                    "--output-format",
                    "json",
                    "--permission-mode",
                    "plan",
                    "--tools",
                    "",
                    "--strict-mcp-config",
                    "--no-session-persistence",
                    SMOKE_PROMPT,
                ],
                SMOKE_TIMEOUT,
                true,
            ),
            (ProviderId::Claude, CommandPurpose::WarmUp) => (
                &[
                    "-p",
                    "--output-format",
                    "json",
                    "--permission-mode",
                    "plan",
                    "--tools",
                    "",
                    "--strict-mcp-config",
                    "--no-session-persistence",
                    WARMUP_PROMPT,
                ],
                SMOKE_TIMEOUT,
                true,
            ),
            _ => return None,
        };
    Some(CommandSpec {
        args,
        timeout,
        neutral_cwd,
    })
}

// ---------------------------------------------------------------------------------------------
// Executable-Aufloesung und -Validierung.
// ---------------------------------------------------------------------------------------------

fn accepted_binary_names(provider: ProviderId) -> &'static [&'static str] {
    // Windows: native .exe oder npm-.cmd-Shim. Rust escaped Batch-Argumente seit 1.77.2
    // sicher; zusaetzlich sind alle Argumente statische Konstanten.
    #[cfg(windows)]
    {
        match provider {
            ProviderId::Codex => &["codex.exe", "codex.cmd"],
            ProviderId::Claude => &["claude.exe", "claude.cmd"],
            _ => &[],
        }
    }
    #[cfg(not(windows))]
    {
        match provider {
            ProviderId::Codex => &["codex"],
            ProviderId::Claude => &["claude"],
            _ => &[],
        }
    }
}

fn executable_candidates(provider: ProviderId, path_var: Option<OsString>) -> Vec<PathBuf> {
    let mut dirs_to_check: Vec<PathBuf> = Vec::new();
    // GUI-Prozesse erben den Shell-PATH nicht -> bekannte Installationsorte zuerst.
    if let Some(home) = dirs::home_dir() {
        dirs_to_check.push(home.join(".local").join("bin"));
        dirs_to_check.push(home.join(".npm-global").join("bin"));
    }
    #[cfg(target_os = "macos")]
    {
        if provider == ProviderId::Codex {
            dirs_to_check.push(PathBuf::from("/Applications/Codex.app/Contents/Resources"));
        }
        dirs_to_check.push(PathBuf::from("/opt/homebrew/bin"));
        dirs_to_check.push(PathBuf::from("/usr/local/bin"));
    }
    #[cfg(windows)]
    {
        if let Some(appdata) = env::var_os("APPDATA") {
            dirs_to_check.push(PathBuf::from(appdata).join("npm"));
        }
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            dirs_to_check.push(local.join("Programs").join("OpenAI").join("Codex"));
            dirs_to_check.push(local.join("Programs").join("claude"));
        }
    }
    if let Some(path) = path_var {
        // Relative PATH-Eintraege (".", "bin") sind ein klassischer Hijack-Vektor -> ignorieren.
        dirs_to_check.extend(env::split_paths(&path).filter(|dir| dir.is_absolute()));
    }
    let mut paths = Vec::new();
    for dir in dirs_to_check {
        for name in accepted_binary_names(provider) {
            let candidate = dir.join(name);
            if !paths.contains(&candidate) {
                paths.push(candidate);
            }
        }
    }
    paths
}

fn validate_executable(provider: ProviderId, candidate: &Path) -> Option<PathBuf> {
    if !candidate.is_absolute() || !candidate.is_file() {
        return None;
    }
    let name = candidate.file_name()?.to_str()?;
    if !accepted_binary_names(provider)
        .iter()
        .any(|allowed| name.eq_ignore_ascii_case(allowed))
    {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if candidate.metadata().ok()?.permissions().mode() & 0o111 == 0 {
            return None;
        }
    }
    // Den validierten Pfad (nicht das Symlink-Ziel) starten: npm-/Homebrew-Shims bleiben intakt.
    Some(candidate.to_path_buf())
}

fn resolve_executable(provider: ProviderId) -> Option<PathBuf> {
    executable_candidates(provider, env::var_os("PATH"))
        .iter()
        .find_map(|path| validate_executable(provider, path))
}

/// PATH fuer Kindprozesse: Verzeichnis des validierten Binaries (inkl. Symlink-Ziel) vorne,
/// damit Node-Shims (`#!/usr/bin/env node`) ihre Runtime finden, auch aus der GUI gestartet.
fn child_path(executable: &Path) -> Option<OsString> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(parent) = executable.parent() {
        dirs.push(parent.to_path_buf());
    }
    if let Some(parent) = executable
        .canonicalize()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
    {
        if !dirs.contains(&parent) {
            dirs.push(parent);
        }
    }
    if let Some(existing) = env::var_os("PATH") {
        dirs.extend(env::split_paths(&existing).filter(|dir| dir.is_absolute()));
    }
    env::join_paths(dirs).ok()
}

fn base_command(executable: &Path, spec: &CommandSpec) -> Command {
    let mut command = Command::new(executable);
    command
        .args(spec.args)
        .env("NO_COLOR", "1")
        .kill_on_drop(true);
    if let Some(path) = child_path(executable) {
        command.env("PATH", path);
    }
    if spec.neutral_cwd {
        command.current_dir(env::temp_dir());
    }
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: keine aufblitzenden Konsolenfenster aus der GUI.
        command.creation_flags(0x0800_0000);
    }
    command
}

#[derive(Debug)]
struct CommandOutcome {
    success: bool,
    stdout: String,
    stderr: String,
}

impl CommandOutcome {
    fn combined(&self) -> String {
        format!("{}\n{}", self.stdout, self.stderr)
    }
}

#[derive(Debug, PartialEq, Eq)]
enum RunError {
    Spawn,
    TimedOut,
    Io,
}

fn bounded_lossy(bytes: &[u8]) -> String {
    let end = bytes.len().min(MAX_CAPTURED_BYTES);
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}

async fn run_captured(executable: &Path, spec: &CommandSpec) -> Result<CommandOutcome, RunError> {
    let mut command = base_command(executable, spec);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = command.spawn().map_err(|_| RunError::Spawn)?;
    // Bei Timeout wird das Future verworfen -> kill_on_drop beendet den Prozess.
    let output = timeout(spec.timeout, child.wait_with_output())
        .await
        .map_err(|_| RunError::TimedOut)?
        .map_err(|_| RunError::Io)?;
    Ok(CommandOutcome {
        success: output.status.success(),
        stdout: bounded_lossy(&output.stdout),
        stderr: bounded_lossy(&output.stderr),
    })
}

// ---------------------------------------------------------------------------------------------
// Parser fuer echte CLI-Ausgaben.
// ---------------------------------------------------------------------------------------------

fn parse_version(output: &str) -> Option<String> {
    let value = output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    Some(redact(value).chars().take(80).collect())
}

/// Wertet `codex login status` / `claude auth status --json` aus.
fn parse_auth_status(provider: ProviderId, outcome: &CommandOutcome) -> bool {
    match provider {
        ProviderId::Codex => {
            let text = outcome.combined().to_ascii_lowercase();
            outcome.success && text.contains("logged in") && !text.contains("not logged in")
        }
        ProviderId::Claude => match serde_json::from_str::<Value>(outcome.stdout.trim()) {
            Ok(value) => value.get("loggedIn").and_then(Value::as_bool) == Some(true),
            Err(_) => false,
        },
        _ => false,
    }
}

/// Leitet die Anmeldeart aus denselben Status-Ausgaben ab, ohne Account-Daten zu uebernehmen.
/// Im Zweifel `Unknown` – nur ein eindeutiger Abo-Login gilt als warm-up-faehig.
fn parse_auth_kind(provider: ProviderId, outcome: &CommandOutcome) -> ProviderAuthKind {
    match provider {
        ProviderId::Codex => {
            let text = outcome.combined().to_ascii_lowercase();
            if text.contains("api key") || text.contains("api-key") {
                ProviderAuthKind::ApiKey
            } else if text.contains("using chatgpt") {
                ProviderAuthKind::Subscription
            } else {
                ProviderAuthKind::Unknown
            }
        }
        ProviderId::Claude => {
            let Ok(value) = serde_json::from_str::<Value>(outcome.stdout.trim()) else {
                return ProviderAuthKind::Unknown;
            };
            let method = value
                .get("authMethod")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let api_provider = value
                .get("apiProvider")
                .and_then(Value::as_str)
                .unwrap_or("firstParty");
            if method.contains("api_key") || method.contains("apiKey") {
                ProviderAuthKind::ApiKey
            } else if method == "claude.ai" && api_provider == "firstParty" {
                ProviderAuthKind::Subscription
            } else {
                ProviderAuthKind::Unknown
            }
        }
        _ => ProviderAuthKind::Unknown,
    }
}

fn is_ready_text(value: &str) -> bool {
    value
        .trim()
        .trim_matches(|c: char| c == '.' || c == '"' || c == '`' || c == '*' || c == '\'')
        .eq_ignore_ascii_case("READY")
}

#[derive(Debug, PartialEq, Eq)]
enum SmokeOutcome {
    Ready { model: Option<String> },
    Failed { evidence: String },
}

/// Codex `exec --json`: READY nur, wenn eine Agent-Nachricht exakt READY lautet.
fn parse_codex_smoke(outcome: &CommandOutcome) -> SmokeOutcome {
    let mut errors = Vec::new();
    let mut ready = false;
    for line in outcome.stdout.lines() {
        let Ok(event) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        match event.get("type").and_then(Value::as_str) {
            Some("item.completed") => {
                let item = event.get("item");
                let is_message = item
                    .and_then(|item| item.get("type"))
                    .and_then(Value::as_str)
                    == Some("agent_message");
                let text = item
                    .and_then(|item| item.get("text"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if is_message && is_ready_text(text) {
                    ready = true;
                }
            }
            Some("error") => {
                if let Some(message) = event.get("message").and_then(Value::as_str) {
                    errors.push(message.to_string());
                }
            }
            Some("turn.failed") => {
                if let Some(message) = event
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                {
                    errors.push(message.to_string());
                }
            }
            _ => {}
        }
    }
    if ready && outcome.success {
        return SmokeOutcome::Ready { model: None };
    }
    errors.dedup();
    if errors.is_empty() {
        errors.push(outcome.stderr.clone());
    }
    SmokeOutcome::Failed {
        evidence: errors.join(" "),
    }
}

/// Claude `-p --output-format json`: READY nur bei `is_error=false` und Ergebnis exakt READY.
fn parse_claude_smoke(outcome: &CommandOutcome) -> SmokeOutcome {
    let parsed = outcome
        .stdout
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
        .or_else(|| serde_json::from_str::<Value>(outcome.stdout.trim()).ok());
    let Some(value) = parsed else {
        return SmokeOutcome::Failed {
            evidence: outcome.combined(),
        };
    };
    let is_error = value
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let result = value
        .get("result")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if outcome.success && !is_error && is_ready_text(result) {
        let model = value
            .get("modelUsage")
            .and_then(Value::as_object)
            .and_then(|usage| usage.keys().next().cloned())
            .filter(|name| is_safe_model_name(name));
        return SmokeOutcome::Ready { model };
    }
    let status = value
        .get("api_error_status")
        .filter(|status| !status.is_null())
        .map(|status| status.to_string())
        .unwrap_or_default();
    SmokeOutcome::Failed {
        evidence: format!("{result} {status} {}", outcome.stderr),
    }
}

fn is_safe_model_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 120
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':' | '/' | '@'))
}

fn regex(pattern: &str) -> Option<Regex> {
    Regex::new(pattern).ok()
}

/// Entfernt typische Secret-, E-Mail-, Home- und URL-Credential-Muster aus Diagnosen.
pub fn redact(value: &str) -> String {
    let mut result = value.replace(['\r', '\n', '\t'], " ");
    let patterns = [
        (
            r"(?i)\b(?:sk|sess|oauth|token|rk|pk|ghp|gho|xai|xox[a-z])[-_][A-Za-z0-9._-]{8,}",
            "<redacted>",
        ),
        // Z.AI-Keyform `<hex>.<token>`.
        (r"\b[0-9a-f]{32}\.[A-Za-z0-9]{16}\b", "<redacted>"),
        (r"(?i)\bBearer\s+[A-Za-z0-9._~+/-]+=*", "Bearer <redacted>"),
        (
            r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+",
            "<redacted-jwt>",
        ),
        (
            r#"(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|password)(["']?\s*[=:]\s*["']?)[^\s,;"'&]+"#,
            "$1$2<redacted>",
        ),
        (r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "<email>"),
        (r"(?i)(https?://)[^/@\s:]+:[^/@\s]+@", "$1<redacted>@"),
        // OAuth-URLs (state, code_challenge) gehoeren nie in Diagnosen.
        (r"(?i)(https?://[^\s?#]+)\?[^\s]*", "$1?<redacted>"),
        (r"(?i)/(?:Users|home)/[^/\s]+", "/<home>"),
        (r"(?i)[A-Z]:\\Users\\[^\\\s]+", "<home>"),
    ];
    for (pattern, replacement) in patterns {
        if let Some(re) = regex(pattern) {
            result = re.replace_all(&result, replacement).into_owned();
        }
    }
    if let Some(home) = dirs::home_dir().and_then(|path| path.to_str().map(str::to_string)) {
        if home.len() > 1 {
            result = result.replace(&home, "<home>");
        }
    }
    let trimmed = result.split_whitespace().collect::<Vec<_>>().join(" ");
    trimmed.chars().take(400).collect()
}

/// Nur vom Provider direkt gemeldete Reset-Zeitpunkte uebernehmen, kurz und redigiert.
fn extract_retry_hint(value: &str) -> Option<String> {
    let re = regex(
        r"(?i)\b(try again (?:at|in)|resets?(?: at| in| on)?|will reset(?: at| in| on)?)\s+([^.\n;]{1,40})",
    )?;
    let captures = re.captures(value)?;
    let hint = format!("{} {}", &captures[1], captures[2].trim());
    Some(redact(hint.trim()).chars().take(60).collect())
}

fn contains_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

fn has_status_code(text: &str, code: &str) -> bool {
    regex(&format!(r"\b{code}\b")).is_some_and(|re| re.is_match(text))
}

/// Klassifiziert nur providerbezogene Ausfaelle als Failover-faehig. Alles Unbekannte ist ein
/// gewoehnlicher Job-/Testfehler (`JobFailed`) und loest NIE einen Providerwechsel aus.
pub fn classify_failure(value: &str) -> ProviderState {
    let text = value.to_ascii_lowercase();
    if contains_any(
        &text,
        &[
            "usage limit",
            "rate limit",
            "rate_limit",
            "quota",
            "too many requests",
            "credit balance is too low",
            "limit reached",
            "out of credits",
        ],
    ) || has_status_code(&text, "429")
    {
        ProviderState::QuotaLimited
    } else if contains_any(
        &text,
        &[
            "not logged in",
            "login required",
            "please run /login",
            "please log in",
            "unauthorized",
            "authentication_error",
            "authentication failed",
            "invalid api key",
            "oauth token has expired",
            "token expired",
            "token has expired",
            "session expired",
            "refresh token",
        ],
    ) || has_status_code(&text, "401")
    {
        ProviderState::AuthUnavailable
    } else if contains_any(
        &text,
        &[
            "overloaded",
            "capacity",
            "temporarily unavailable",
            "service unavailable",
            "server is busy",
        ],
    ) || has_status_code(&text, "529")
        || has_status_code(&text, "503")
    {
        ProviderState::CapacityUnavailable
    } else if contains_any(
        &text,
        &[
            "network error",
            "connection refused",
            "connection reset",
            "could not resolve",
            "dns error",
            "error sending request",
            "stream disconnected",
            "unreachable",
            "offline",
        ],
    ) {
        ProviderState::Offline
    } else {
        ProviderState::JobFailed
    }
}

/// Failover nur fuer Auth-/Quota-/Kapazitaets-/Verfuegbarkeitsklassen.
pub fn allows_failover(state: ProviderState) -> bool {
    matches!(
        state,
        ProviderState::AuthUnavailable
            | ProviderState::QuotaLimited
            | ProviderState::CapacityUnavailable
            | ProviderState::Offline
            | ProviderState::Unknown
    )
}

fn reason_for_state(state: ProviderState) -> ProviderReason {
    match state {
        ProviderState::QuotaLimited => ProviderReason::QuotaLimited,
        ProviderState::AuthUnavailable => ProviderReason::SignInRequired,
        ProviderState::CapacityUnavailable => ProviderReason::CapacityLimited,
        ProviderState::Offline => ProviderReason::Offline,
        _ => ProviderReason::ReadyTestFailed,
    }
}

// ---------------------------------------------------------------------------------------------
// Cloud-CLI-Adapter (Codex, Claude Code).
// ---------------------------------------------------------------------------------------------

struct CloudProbe {
    status: ProviderStatus,
    executable: Option<PathBuf>,
}

async fn cloud_probe(provider: ProviderId, enabled: bool) -> CloudProbe {
    let mut status = ProviderStatus::base(provider, enabled);
    status.capabilities = vec![
        "text_code_agent".to_string(),
        "workspace_write".to_string(),
        "cloud".to_string(),
    ];
    let Some(executable) = resolve_executable(provider) else {
        status.fail(ProviderState::Unknown, ProviderReason::NotInstalled, None);
        return CloudProbe {
            status,
            executable: None,
        };
    };
    status.installed = true;
    status.state = ProviderState::Installed;
    if let Some(spec) = command_spec(provider, CommandPurpose::Version) {
        if let Ok(outcome) = run_captured(&executable, &spec).await {
            status.version = parse_version(&outcome.stdout);
        }
    }
    let Some(spec) = command_spec(provider, CommandPurpose::AuthStatus) else {
        return CloudProbe {
            status,
            executable: Some(executable),
        };
    };
    match run_captured(&executable, &spec).await {
        Ok(outcome) if parse_auth_status(provider, &outcome) => {
            status.authenticated = true;
            status.auth_kind = Some(parse_auth_kind(provider, &outcome));
            status.state = ProviderState::Authenticated;
            status.reason = if enabled {
                ProviderReason::ReadyTestPending
            } else {
                ProviderReason::DisabledInKatoSync
            };
        }
        Ok(_) => status.fail(
            ProviderState::AuthUnavailable,
            ProviderReason::SignInRequired,
            None,
        ),
        Err(RunError::TimedOut) => {
            status.fail(ProviderState::Offline, ProviderReason::TimedOut, None)
        }
        Err(_) => status.fail(ProviderState::Unknown, ProviderReason::NotInstalled, None),
    }
    CloudProbe {
        status,
        executable: Some(executable),
    }
}

async fn run_smoke(provider: ProviderId, executable: &Path, status: &mut ProviderStatus) {
    let Some(spec) = command_spec(provider, CommandPurpose::Smoke) else {
        return;
    };
    let outcome = match run_captured(executable, &spec).await {
        Ok(outcome) => outcome,
        Err(RunError::TimedOut) => {
            status.fail(ProviderState::Offline, ProviderReason::TimedOut, None);
            return;
        }
        Err(_) => {
            status.fail(
                ProviderState::Unknown,
                ProviderReason::ReadyTestFailed,
                None,
            );
            return;
        }
    };
    let parsed = match provider {
        ProviderId::Codex => parse_codex_smoke(&outcome),
        _ => parse_claude_smoke(&outcome),
    };
    match parsed {
        SmokeOutcome::Ready { model } => {
            status.ready(ProviderReason::Ready);
            if model.is_some() {
                status.model = model;
            }
        }
        SmokeOutcome::Failed { evidence } => {
            let state = classify_failure(&evidence);
            // Ein fehlgeschlagener READY-Test ohne Provider-Signal ist kein Failover-Grund,
            // die Karte zeigt ihn aber als "nicht verbunden".
            status.fail(state, reason_for_state(state), Some(&evidence));
        }
    }
}

async fn cloud_status(provider: ProviderId, enabled: bool, smoke: bool) -> ProviderStatus {
    let CloudProbe {
        mut status,
        executable,
    } = cloud_probe(provider, enabled).await;
    if let Some(executable) = executable {
        if enabled && smoke && status.authenticated {
            run_smoke(provider, &executable, &mut status).await;
        }
    }
    status
}

// ---------------------------------------------------------------------------------------------
// Offizieller Login: begrenzt, abbrechbar, ohne Credential-Zugriff durch KatoSync.
// ---------------------------------------------------------------------------------------------

#[derive(Clone)]
struct ActiveLogin {
    cancel: Arc<Notify>,
    stdin: Arc<AsyncMutex<Option<ChildStdin>>>,
}

fn active_logins() -> &'static Mutex<HashMap<ProviderId, ActiveLogin>> {
    static LOGINS: OnceLock<Mutex<HashMap<ProviderId, ActiveLogin>>> = OnceLock::new();
    LOGINS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct LoginGuard(ProviderId);

impl Drop for LoginGuard {
    fn drop(&mut self) {
        if let Ok(mut logins) = active_logins().lock() {
            logins.remove(&self.0);
        }
    }
}

/// Bricht einen laufenden Login ab (beendet nur den von KatoSync gestarteten CLI-Prozess).
pub fn cancel_login(provider: ProviderId) -> bool {
    active_logins()
        .lock()
        .ok()
        .and_then(|logins| logins.get(&provider).cloned())
        .map(|login| login.cancel.notify_one())
        .is_some()
}

/// OAuth-Einmalcodes bleiben flüchtig: keine Logs, keine Persistenz, keine Shell.
/// Erlaubt sichtbare ASCII-Zeichen und Leerzeichen im Inneren, aber keine Steuerzeichen/Zeilenumbrüche.
pub fn validate_login_code(value: &str) -> bool {
    let code = value.trim();
    !code.is_empty() && code.len() <= 4096 && code.chars().all(|c| c == ' ' || c.is_ascii_graphic())
}

/// Übergibt einen vom offiziellen Provider-Portal angezeigten Einmalcode an genau den
/// laufenden Login-Prozess. Das ist insbesondere für Claude Code nötig, wenn dessen
/// Browser-Flow einen manuellen Code zum Zurückkopieren verlangt.
pub async fn submit_login_code(provider: ProviderId, code: &str) -> bool {
    if !validate_login_code(code) {
        return false;
    }
    let login = active_logins()
        .lock()
        .ok()
        .and_then(|logins| logins.get(&provider).cloned());
    let Some(login) = login else {
        return false;
    };
    let mut stdin = login.stdin.lock().await;
    let Some(writer) = stdin.as_mut() else {
        return false;
    };
    let code = code.trim();
    writer.write_all(code.as_bytes()).await.is_ok()
        && writer.write_all(b"\n").await.is_ok()
        && writer.flush().await.is_ok()
}

fn official_login_hosts(provider: ProviderId) -> &'static [&'static str] {
    match provider {
        ProviderId::Codex => &["auth.openai.com", "chatgpt.com"],
        ProviderId::Claude => &[
            "claude.ai",
            "claude.com",
            "console.anthropic.com",
            "platform.claude.com",
        ],
        _ => &[],
    }
}

/// Extrahiert nur HTTPS-URLs exakt auf offiziellen Provider-Hosts (kein Lookalike, kein HTTP).
pub(crate) fn official_login_url(provider: ProviderId, line: &str) -> Option<String> {
    let re = regex(r#"https://[^\s"'<>`]+"#)?;
    let found = re.find_iter(line).find_map(|found| {
        let candidate = found.as_str().trim_end_matches(['.', ',', ')', ']']);
        let url = Url::parse(candidate).ok()?;
        let host = url.host_str()?.to_ascii_lowercase();
        let allowed = url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && official_login_hosts(provider).contains(&host.as_str());
        allowed.then(|| url.to_string())
    });
    found
}

async fn watch_login_output<R: AsyncRead + Unpin>(
    provider: ProviderId,
    reader: R,
    url_sent: Arc<AtomicBool>,
    on_url: Arc<dyn Fn(String) + Send + Sync>,
    tail: Arc<Mutex<Vec<String>>>,
) {
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if !url_sent.load(Ordering::SeqCst) {
            if let Some(url) = official_login_url(provider, &line) {
                url_sent.store(true, Ordering::SeqCst);
                on_url(url);
            }
        }
        if let Ok(mut tail) = tail.lock() {
            tail.push(line.chars().take(300).collect());
            if tail.len() > 12 {
                tail.remove(0);
            }
        }
    }
}

enum LoginResult {
    Completed,
    Failed(String),
    Cancelled,
    TimedOut,
    AlreadyRunning,
    SpawnFailed,
}

async fn run_login(
    provider: ProviderId,
    executable: &Path,
    on_url: Arc<dyn Fn(String) + Send + Sync>,
) -> LoginResult {
    let Some(spec) = command_spec(provider, CommandPurpose::Login) else {
        return LoginResult::SpawnFailed;
    };
    let notify = Arc::new(Notify::new());
    let login_stdin = Arc::new(AsyncMutex::new(None));
    {
        let Ok(mut logins) = active_logins().lock() else {
            return LoginResult::SpawnFailed;
        };
        if logins.contains_key(&provider) {
            return LoginResult::AlreadyRunning;
        }
        logins.insert(
            provider,
            ActiveLogin {
                cancel: notify.clone(),
                stdin: login_stdin.clone(),
            },
        );
    }
    let _guard = LoginGuard(provider);

    let mut command = base_command(executable, &spec);
    // stdin bleibt offen, aber KatoSync schreibt nie hinein: Die CLI wartet wie in einem
    // Terminal, in dem niemand tippt, auf den Browser-Callback.
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let Ok(mut child) = command.spawn() else {
        return LoginResult::SpawnFailed;
    };
    *login_stdin.lock().await = child.stdin.take();
    let url_sent = Arc::new(AtomicBool::new(false));
    let tail = Arc::new(Mutex::new(Vec::new()));
    let mut readers = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        readers.push(tokio::spawn(watch_login_output(
            provider,
            stdout,
            url_sent.clone(),
            on_url.clone(),
            tail.clone(),
        )));
    }
    if let Some(stderr) = child.stderr.take() {
        readers.push(tokio::spawn(watch_login_output(
            provider,
            stderr,
            url_sent.clone(),
            on_url.clone(),
            tail.clone(),
        )));
    }

    let result = tokio::select! {
        status = child.wait() => match status {
            Ok(status) if status.success() => LoginResult::Completed,
            _ => LoginResult::Failed(
                tail.lock().map(|lines| lines.join(" ")).unwrap_or_default(),
            ),
        },
        _ = tokio::time::sleep(spec.timeout) => LoginResult::TimedOut,
        _ = notify.notified() => LoginResult::Cancelled,
    };
    if matches!(result, LoginResult::TimedOut | LoginResult::Cancelled) {
        let _ = child.kill().await;
    }
    for reader in readers {
        reader.abort();
    }
    result
}

/// Startet den offiziellen Browser-Login (falls noetig) und bestaetigt danach Auth + READY.
pub async fn connect<F>(provider: ProviderId, force_login: bool, on_url: F) -> ProviderStatus
where
    F: Fn(String) + Send + Sync + 'static,
{
    let CloudProbe {
        mut status,
        executable,
    } = cloud_probe(provider, true).await;
    let Some(executable) = executable else {
        return status;
    };
    if force_login || !status.authenticated {
        match run_login(provider, &executable, Arc::new(on_url)).await {
            LoginResult::Completed => {}
            LoginResult::Failed(evidence) => {
                status.fail(
                    ProviderState::AuthUnavailable,
                    ProviderReason::LoginFailed,
                    Some(&evidence),
                );
                return status;
            }
            LoginResult::Cancelled => {
                status.fail(
                    ProviderState::AuthUnavailable,
                    ProviderReason::LoginCancelled,
                    None,
                );
                return status;
            }
            LoginResult::TimedOut => {
                status.fail(
                    ProviderState::AuthUnavailable,
                    ProviderReason::LoginTimedOut,
                    None,
                );
                return status;
            }
            LoginResult::AlreadyRunning => {
                status.reason = ProviderReason::LoginInProgress;
                return status;
            }
            LoginResult::SpawnFailed => {
                status.fail(
                    ProviderState::AuthUnavailable,
                    ProviderReason::LoginFailed,
                    None,
                );
                return status;
            }
        }
    }
    // Wahrheit statt Annahme: Auth erneut real pruefen und erst danach den READY-Test fahren.
    cloud_status(provider, true, true).await
}

// ---------------------------------------------------------------------------------------------
// Lokale Modelle (Ollama, LM Studio, OpenAI-kompatibel).
// ---------------------------------------------------------------------------------------------

fn endpoint_reason(rejection: EndpointRejection) -> ProviderReason {
    match rejection {
        EndpointRejection::Missing => ProviderReason::NotConfigured,
        EndpointRejection::Invalid => ProviderReason::InvalidEndpoint,
        EndpointRejection::HttpsRequired => ProviderReason::InsecureRemoteKey,
        EndpointRejection::BlockedNetwork => ProviderReason::EndpointBlocked,
    }
}

/// Validiert eine Local-Lane-Basis-URL: exaktes Loopback (HTTP/HTTPS) oder oeffentliches HTTPS.
/// LAN-/private Ziele sind in diesem Release gesperrt (siehe `endpoint_guard`).
pub fn validate_local_endpoint(value: &str) -> Result<ValidatedEndpoint, ProviderReason> {
    endpoint_guard::validate_endpoint(value, true).map_err(endpoint_reason)
}

/// local = dieser Rechner (exaktes Loopback), remote = oeffentliches HTTPS-Ziel.
pub fn endpoint_scope(endpoint: &ValidatedEndpoint) -> &'static str {
    match endpoint.target {
        TargetKind::Loopback => "local",
        TargetKind::Public => "remote",
    }
}

fn join_api_path(base: &Url, openai_suffix: &str, native_ollama: Option<&str>) -> Option<Url> {
    let root = base.as_str().trim_end_matches('/');
    let value = match native_ollama {
        Some(path) => format!("{root}{path}"),
        None if base.path().trim_end_matches('/').ends_with("/v1") => {
            format!("{root}{openai_suffix}")
        }
        None => format!("{root}/v1{openai_suffix}"),
    };
    Url::parse(&value).ok()
}

fn models_url(base: &Url, kind: LocalProviderKind) -> Option<Url> {
    let native = (kind == LocalProviderKind::Ollama).then_some("/api/tags");
    join_api_path(base, "/models", native)
}

/// Lokale OpenAI-kompatible Endpunkte nutzen weiterhin die bekannte /v1-Normalisierung.
fn chat_url(base: &Url) -> Option<Url> {
    join_api_path(base, "/chat/completions", None)
}

/// Remote-API-Presets tragen ihren Versionspfad bereits in der Base-URL. Daher niemals still
/// noch ein weiteres /v1 einfügen (wichtig z. B. fuer Z.AI /api/paas/v4).
fn remote_api_url(base: &Url, suffix: &str) -> Option<Url> {
    Url::parse(&format!(
        "{}{}",
        base.as_str().trim_end_matches('/'),
        suffix
    ))
    .ok()
}

fn api_models_url(base: &Url) -> Option<Url> {
    remote_api_url(base, "/models")
}

fn api_generation_url(base: &Url, preset: ApiProviderPreset) -> Option<Url> {
    match preset {
        ApiProviderPreset::Openai => remote_api_url(base, "/responses"),
        ApiProviderPreset::Anthropic => remote_api_url(base, "/messages"),
        _ => remote_api_url(base, "/chat/completions"),
    }
}

fn api_auth_request(
    request: reqwest::RequestBuilder,
    preset: ApiProviderPreset,
    api_key: &str,
) -> reqwest::RequestBuilder {
    match preset {
        ApiProviderPreset::Anthropic => request
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01"),
        _ => request.bearer_auth(api_key),
    }
}

fn extract_model_ids(value: &Value, kind: LocalProviderKind) -> Vec<String> {
    let (entries, key) = match kind {
        LocalProviderKind::Ollama => (value.get("models").and_then(Value::as_array), "name"),
        _ => (value.get("data").and_then(Value::as_array), "id"),
    };
    entries
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get(key).and_then(Value::as_str))
        .filter(|name| is_safe_model_name(name))
        .map(str::to_string)
        .take(100)
        .collect()
}

fn extract_api_model_ids(value: &Value) -> Vec<String> {
    let mut models = value
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get("id").and_then(Value::as_str))
        .filter(|name| is_safe_model_name(name))
        .map(str::to_string)
        .take(MAX_API_CATALOG_MODELS)
        .collect::<Vec<_>>();
    models.dedup();
    models
}

/// Jeder Endpoint-Request laeuft ueber einen Client mit gepruefter DNS-Aufloesung, ohne Redirects
/// und ohne Proxy (siehe `endpoint_guard::guarded_client`).
fn http_client(endpoint: &ValidatedEndpoint, limit: Duration) -> Option<reqwest::Client> {
    endpoint_guard::guarded_client(endpoint, limit)
}

/// Loopback-Ziele werden nie ueber einen Env-/System-Proxy geleitet: Prompts und Keys fuer
/// lokale Modelle verlassen den Rechner nicht.
#[derive(Debug, Serialize, Deserialize)]
struct StoredOriginKey {
    origin: String,
    key: String,
}

/// Erlaubt nur druckbare ASCII-Keys ohne Whitespace; verhindert Header-Injection.
pub fn validate_api_key(value: &str) -> bool {
    let key = value.trim();
    !key.is_empty() && key.len() <= 512 && key.chars().all(|c| c.is_ascii_graphic())
}

/// API-Keys nie im Klartext senden – einzige Ausnahme sind exakte Loopback-Ziele.
fn key_transport_allowed(endpoint: &ValidatedEndpoint) -> bool {
    endpoint.key_transport_allowed()
}

fn key_entry(account: &str) -> Result<keyring::Entry, ProviderReason> {
    keyring::Entry::new(crate::KEYCHAIN_SERVICE, account)
        .map_err(|_| ProviderReason::SecretStoreUnavailable)
}

fn load_origin_key(account: &str) -> Result<Option<StoredOriginKey>, ProviderReason> {
    let entry = key_entry(account)?;
    match entry.get_password() {
        Ok(raw) => Ok(serde_json::from_str(&raw).ok()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(ProviderReason::SecretStoreUnavailable),
    }
}

fn store_origin_key(account: &str, value: &StoredOriginKey) -> Result<(), ProviderReason> {
    let raw = serde_json::to_string(value).map_err(|_| ProviderReason::SecretStoreUnavailable)?;
    key_entry(account)?
        .set_password(&raw)
        .map_err(|_| ProviderReason::SecretStoreUnavailable)
}

fn delete_origin_key(account: &str) -> Result<(), ProviderReason> {
    match key_entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(ProviderReason::SecretStoreUnavailable),
    }
}

fn load_local_key() -> Result<Option<StoredOriginKey>, ProviderReason> {
    load_origin_key(LOCAL_KEY_ACCOUNT)
}

/// Speichert den API-Key im OS-Schluesselbund, gebunden an den Endpoint-Origin.
pub fn save_local_key(base_url: &str, api_key: &str) -> Result<(), ProviderReason> {
    let url = validate_local_endpoint(base_url)?;
    if !validate_api_key(api_key) {
        return Err(ProviderReason::EndpointAuthRequired);
    }
    if !key_transport_allowed(&url) {
        return Err(ProviderReason::InsecureRemoteKey);
    }
    store_origin_key(
        LOCAL_KEY_ACCOUNT,
        &StoredOriginKey {
            origin: url.origin(),
            key: api_key.trim().to_string(),
        },
    )
}

/// Loescht ausschliesslich KatoSync-eigene Secrets. CLI-Credentials bleiben unangetastet.
pub fn disconnect(provider: ProviderId) -> Result<(), ProviderReason> {
    match provider {
        ProviderId::Api => delete_origin_key(API_KEY_ACCOUNT),
        ProviderId::Local => delete_origin_key(LOCAL_KEY_ACCOUNT),
        _ => Ok(()),
    }
}

fn api_base_url(config: &ApiProviderConfig) -> Result<ValidatedEndpoint, ProviderReason> {
    let raw = match config.preset {
        ApiProviderPreset::Openai => "https://api.openai.com/v1",
        ApiProviderPreset::Anthropic => "https://api.anthropic.com/v1",
        ApiProviderPreset::OpenrouterGlobal => "https://openrouter.ai/api/v1",
        ApiProviderPreset::OpenrouterEu => "https://eu.openrouter.ai/api/v1",
        ApiProviderPreset::Deepseek => "https://api.deepseek.com/v1",
        ApiProviderPreset::Mistral => "https://api.mistral.ai/v1",
        ApiProviderPreset::Xai => "https://api.x.ai/v1",
        ApiProviderPreset::Zai => "https://api.z.ai/api/paas/v4",
        ApiProviderPreset::CustomOpenai => config.base_url.trim(),
    };
    // API-Lane: ausschliesslich oeffentliche HTTPS-Ziele, nie Loopback oder LAN.
    endpoint_guard::validate_endpoint(raw, false).map_err(endpoint_reason)
}

fn api_key_account(connection_id: &str) -> Result<String, ProviderReason> {
    let id = connection_id.trim();
    if id.is_empty()
        || id.len() > 64
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(ProviderReason::InvalidEndpoint);
    }
    Ok(format!("{API_KEY_ACCOUNT_PREFIX}{id}"))
}

fn load_api_key_for(config: &ApiProviderConfig) -> Result<Option<String>, ProviderReason> {
    let base = api_base_url(config)?;
    let account = api_key_account(&config.id)?;
    let stored = load_origin_key(&account)?;
    if let Some(value) = stored {
        return Ok((value.origin == base.origin()).then_some(value.key));
    }
    // Einmalige, sichere Kompatibilitaet fuer den ersten migrierten Preview-Slot.
    if config.id == "api-1" {
        return Ok(load_origin_key(API_KEY_ACCOUNT)?
            .filter(|value| value.origin == base.origin())
            .map(|value| value.key));
    }
    Ok(None)
}

/// Provider-Familie, die ein Key mit exklusivem Praefix zwingend verlangt. Spiegelt
/// `src/lib/apiKeyInference.ts`; alles ohne eindeutiges Praefix bleibt Nutzerentscheidung.
fn strong_key_family(api_key: &str) -> Option<&'static [ApiProviderPreset]> {
    const RULES: [(&str, &[ApiProviderPreset]); 5] = [
        ("sk-ant-", &[ApiProviderPreset::Anthropic]),
        (
            "sk-or-",
            &[
                ApiProviderPreset::OpenrouterEu,
                ApiProviderPreset::OpenrouterGlobal,
            ],
        ),
        ("sk-proj-", &[ApiProviderPreset::Openai]),
        ("sk-svcacct-", &[ApiProviderPreset::Openai]),
        ("xai-", &[ApiProviderPreset::Xai]),
    ];
    let key = api_key.trim();
    RULES
        .iter()
        .find(|(prefix, _)| key.starts_with(prefix))
        .map(|(_, family)| *family)
}

/// Ein eindeutig zuordenbarer Key wird nie an einen fremden Preset-Provider gesendet.
/// Custom-Endpunkte (eigene Gateways) bleiben bewusst Nutzerentscheidung.
fn key_conflicts_with_preset(api_key: &str, preset: ApiProviderPreset) -> bool {
    if preset == ApiProviderPreset::CustomOpenai {
        return false;
    }
    strong_key_family(api_key).is_some_and(|family| !family.contains(&preset))
}

pub fn save_api_provider_key(
    config: &ApiProviderConfig,
    api_key: &str,
) -> Result<(), ProviderReason> {
    let base = api_base_url(config)?;
    if !validate_api_key(api_key) {
        return Err(ProviderReason::EndpointAuthRequired);
    }
    if key_conflicts_with_preset(api_key, config.preset) {
        return Err(ProviderReason::ApiKeyProviderMismatch);
    }
    let account = api_key_account(&config.id)?;
    store_origin_key(
        &account,
        &StoredOriginKey {
            origin: base.origin(),
            key: api_key.trim().to_string(),
        },
    )
}

pub fn disconnect_api_provider_key(connection_id: &str) -> Result<(), ProviderReason> {
    let account = api_key_account(connection_id)?;
    delete_origin_key(&account)
}

fn effort_value(effort: ApiEffort) -> Option<&'static str> {
    match effort {
        ApiEffort::Auto => None,
        ApiEffort::Low => Some("low"),
        ApiEffort::Medium => Some("medium"),
        ApiEffort::High => Some("high"),
        ApiEffort::Xhigh => Some("xhigh"),
        ApiEffort::Max => Some("max"),
    }
}

fn api_generation_body(
    config: &ApiProviderConfig,
    model: &str,
    system: Option<&str>,
    prompt: &str,
    max_tokens: u64,
) -> Value {
    let mut body = match config.preset {
        ApiProviderPreset::Openai => {
            let mut value = serde_json::json!({
                "model": model,
                "input": prompt,
                "max_output_tokens": max_tokens
            });
            if let Some(system) = system.filter(|value| !value.is_empty()) {
                value["instructions"] = Value::String(system.to_string());
            }
            value
        }
        ApiProviderPreset::Anthropic => serde_json::json!({
            "model": model,
            "max_tokens": max_tokens,
            "system": system.unwrap_or(""),
            "messages": [{ "role": "user", "content": prompt }]
        }),
        _ => {
            let mut messages = Vec::new();
            if let Some(system) = system.filter(|value| !value.is_empty()) {
                messages.push(serde_json::json!({ "role": "system", "content": system }));
            }
            messages.push(serde_json::json!({ "role": "user", "content": prompt }));
            serde_json::json!({
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "stream": false
            })
        }
    };

    if let Some(effort) = effort_value(config.effort) {
        match config.preset {
            ApiProviderPreset::Openai => {
                body["reasoning"] = serde_json::json!({ "effort": effort });
            }
            ApiProviderPreset::OpenrouterGlobal | ApiProviderPreset::OpenrouterEu => {
                body["reasoning"] = serde_json::json!({ "effort": effort });
            }
            ApiProviderPreset::Xai => {
                body["reasoning_effort"] = Value::String(effort.to_string());
            }
            ApiProviderPreset::Anthropic
            | ApiProviderPreset::Deepseek
            | ApiProviderPreset::Mistral
            | ApiProviderPreset::Zai
            | ApiProviderPreset::CustomOpenai => {
                // Provider-/modellabhaengige Effort-Semantik wird nicht geraten.
            }
        }
    }
    body
}

fn api_smoke_body(config: &ApiProviderConfig, model: &str) -> Value {
    api_generation_body(config, model, None, SMOKE_PROMPT, 32)
}

pub async fn api_provider_models(
    config: &ApiProviderConfig,
) -> Result<ApiProviderCatalog, ProviderReason> {
    let base = api_base_url(config)?;
    let key = tokio::task::spawn_blocking({
        let config = config.clone();
        move || load_api_key_for(&config)
    })
    .await
    .map_err(|_| ProviderReason::SecretStoreUnavailable)??;
    let key = key.ok_or(ProviderReason::EndpointAuthRequired)?;
    let endpoint = api_models_url(&base.url).ok_or(ProviderReason::InvalidEndpoint)?;
    let client = http_client(&base, API_TIMEOUT).ok_or(ProviderReason::Offline)?;
    let request = api_auth_request(client.get(endpoint), config.preset, &key);
    let body = fetch_json_limited(request, MAX_API_CATALOG_BYTES)
        .await
        .map_err(|failure| match failure {
            HttpFailure::Blocked => ProviderReason::EndpointBlocked,
            HttpFailure::Status(401 | 403) => ProviderReason::EndpointAuthRequired,
            HttpFailure::Status(429) => ProviderReason::QuotaLimited,
            HttpFailure::Timeout => ProviderReason::TimedOut,
            HttpFailure::Unreachable => ProviderReason::Offline,
            HttpFailure::Status(code) if code >= 500 => ProviderReason::CapacityLimited,
            HttpFailure::Status(_) => ProviderReason::EndpointError,
            HttpFailure::TooLarge | HttpFailure::Invalid => ProviderReason::EndpointInvalidResponse,
        })?;
    let models = extract_api_model_ids(&body);
    if models.is_empty() {
        return Err(ProviderReason::NoModels);
    }
    Ok(ApiProviderCatalog {
        connection_id: config.id.clone(),
        provider_label: config.preset.label().to_string(),
        base_url: base.url.to_string(),
        models,
    })
}

fn content_text(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        let trimmed = text.trim();
        return (!trimmed.is_empty()).then(|| trimmed.to_string());
    }
    let parts = content.as_array()?;
    let text = parts
        .iter()
        .filter_map(|part| {
            part.get("text")
                .and_then(Value::as_str)
                .or_else(|| part.get("content").and_then(Value::as_str))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn api_message_content(value: &Value) -> Option<String> {
    // OpenAI-compatible Chat Completions.
    if let Some(content) = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("message"))
        .and_then(|item| item.get("content"))
        .and_then(content_text)
    {
        return Some(content);
    }

    // Anthropic Messages.
    if let Some(content) = value.get("content").and_then(content_text) {
        return Some(content);
    }

    // OpenAI Responses API.
    if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    let output = value.get("output").and_then(Value::as_array)?;
    let text = output
        .iter()
        .filter_map(|item| item.get("content").and_then(Value::as_array))
        .flatten()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn usage_tokens(value: &Value) -> (Option<u64>, Option<u64>) {
    let usage = value.get("usage");
    let input = usage
        .and_then(|item| {
            item.get("prompt_tokens")
                .or_else(|| item.get("input_tokens"))
        })
        .and_then(Value::as_u64);
    let output = usage
        .and_then(|item| {
            item.get("completion_tokens")
                .or_else(|| item.get("output_tokens"))
        })
        .and_then(Value::as_u64);
    (input, output)
}

fn reported_cost_usd(value: &Value) -> Option<f64> {
    let candidate = value
        .get("usage")
        .and_then(|usage| {
            usage
                .get("cost")
                .or_else(|| usage.get("cost_usd"))
                .or_else(|| usage.get("total_cost"))
        })
        .or_else(|| value.get("cost"))
        .or_else(|| value.get("cost_usd"));
    candidate
        .and_then(|raw| raw.as_f64().or_else(|| raw.as_str()?.parse::<f64>().ok()))
        .filter(|cost| cost.is_finite() && *cost >= 0.0)
}

/// Read-only reasoning worker. It receives a bounded, secret-scanned Context Pack and a concrete
/// task, but no filesystem/shell tools. The result is intended for REX/handoff or human review.
pub async fn run_api_worker(
    config: &ApiProviderConfig,
    prompt: &str,
    context_pack: &str,
) -> Result<ApiWorkerResult, ProviderReason> {
    let prompt = prompt.trim();
    if prompt.is_empty() || prompt.len() > MAX_API_WORKER_PROMPT_BYTES {
        return Err(ProviderReason::CapabilityFailed);
    }
    if context_pack.len() > MAX_API_WORKER_CONTEXT_BYTES {
        return Err(ProviderReason::CapabilityFailed);
    }
    let model = config.model.trim();
    if model.is_empty() || !is_safe_model_name(model) {
        return Err(ProviderReason::ModelMissing);
    }

    // Re-validate the selected model against the provider's live catalog before spending tokens.
    let catalog = api_provider_models(config).await?;
    if !catalog.models.iter().any(|candidate| candidate == model) {
        return Err(ProviderReason::ModelMissing);
    }

    let base = api_base_url(config)?;
    let mut api_key = tokio::task::spawn_blocking({
        let config = config.clone();
        move || load_api_key_for(&config)
    })
    .await
    .map_err(|_| ProviderReason::SecretStoreUnavailable)??
    .ok_or(ProviderReason::EndpointAuthRequired)?;

    let Some(endpoint) = api_generation_url(&base.url, config.preset) else {
        api_key.zeroize();
        return Err(ProviderReason::InvalidEndpoint);
    };
    let Some(client) = http_client(&base, API_WORKER_TIMEOUT) else {
        api_key.zeroize();
        return Err(ProviderReason::Offline);
    };

    let system = format!(
        "You are a KatoSync read-only reasoning worker. Use only the supplied verified project context. \
Do not claim to have edited files, run commands, deployed, merged, or accessed secrets. \
Respect stated architecture, guardrails, dependencies and human gates. \
Produce a concise implementation-ready result that can be handed to another lane.\n\nVERIFIED CONTEXT PACK:\n{}",
        context_pack
    );
    let body = api_generation_body(config, model, Some(&system), prompt, 4096);
    let request = api_auth_request(client.post(endpoint), config.preset, &api_key).json(&body);
    let result = fetch_json(request).await;
    api_key.zeroize();
    let response = result.map_err(|failure| match failure {
        HttpFailure::Blocked => ProviderReason::EndpointBlocked,
        HttpFailure::Status(401 | 403) => ProviderReason::EndpointAuthRequired,
        HttpFailure::Status(429) => ProviderReason::QuotaLimited,
        HttpFailure::Timeout => ProviderReason::TimedOut,
        HttpFailure::Unreachable => ProviderReason::Offline,
        HttpFailure::Status(code) if code >= 500 => ProviderReason::CapacityLimited,
        HttpFailure::Status(_) => ProviderReason::EndpointError,
        HttpFailure::TooLarge | HttpFailure::Invalid => ProviderReason::EndpointInvalidResponse,
    })?;
    let content = api_message_content(&response).ok_or(ProviderReason::CapabilityFailed)?;
    let (input_tokens, output_tokens) = usage_tokens(&response);
    let reported_cost_usd = reported_cost_usd(&response);
    Ok(ApiWorkerResult {
        connection_id: config.id.clone(),
        provider_label: config.preset.label().to_string(),
        model: model.to_string(),
        effort: config.effort,
        content,
        input_tokens,
        output_tokens,
        reported_cost_usd,
        completed_at: Utc::now().to_rfc3339(),
    })
}

async fn api_status(
    config: &ApiProviderConfig,
    enabled: bool,
    capability_test: bool,
) -> ProviderStatus {
    let mut status = ProviderStatus::base(ProviderId::Api, enabled);
    status.installed = true;
    status.capabilities = vec![
        "text_code_agent".to_string(),
        "remote_api".to_string(),
        "secure_keychain".to_string(),
        "rex_capability_handle".to_string(),
    ];
    status.model = Some(config.model.trim().to_string()).filter(|value| !value.is_empty());

    let base = match api_base_url(config) {
        Ok(value) => value,
        Err(reason) => {
            status.fail(ProviderState::Unknown, reason, None);
            return status;
        }
    };
    status.endpoint_scope = Some("remote".to_string());
    status.detail = Some(format!("preset={}", config.preset.label()));

    let stored = tokio::task::spawn_blocking({
        let config = config.clone();
        move || load_api_key_for(&config)
    })
    .await
    .unwrap_or(Err(ProviderReason::SecretStoreUnavailable));
    let api_key = match stored {
        Ok(Some(key)) => {
            status.secret_stored = true;
            key
        }
        Ok(None) => {
            status.fail(
                ProviderState::AuthUnavailable,
                ProviderReason::EndpointAuthRequired,
                None,
            );
            return status;
        }
        Err(reason) => {
            status.fail(ProviderState::AuthUnavailable, reason, None);
            return status;
        }
    };

    if !enabled {
        status.reason = ProviderReason::DisabledInKatoSync;
        return status;
    }

    let endpoint = match api_models_url(&base.url) {
        Some(value) => value,
        None => {
            status.fail(
                ProviderState::Unknown,
                ProviderReason::InvalidEndpoint,
                None,
            );
            return status;
        }
    };
    let Some(client) = http_client(&base, API_TIMEOUT) else {
        status.fail(ProviderState::Offline, ProviderReason::Offline, None);
        return status;
    };
    let request = api_auth_request(client.get(endpoint), config.preset, &api_key);
    let models = match fetch_json_limited(request, MAX_API_CATALOG_BYTES).await {
        Ok(body) => extract_api_model_ids(&body),
        Err(failure) => {
            apply_http_failure(&mut status, failure);
            return status;
        }
    };
    if models.is_empty() {
        status.fail(ProviderState::Unknown, ProviderReason::NoModels, None);
        return status;
    }
    let model = match status.model.clone() {
        Some(requested) if models.iter().any(|value| value == &requested) => requested,
        Some(_) => {
            status.fail(ProviderState::Unknown, ProviderReason::ModelMissing, None);
            return status;
        }
        None => models[0].clone(),
    };
    status.model = Some(model.clone());
    status.authenticated = true;
    status.state = ProviderState::Authenticated;
    status.reason = ProviderReason::ReadyTestPending;
    if !capability_test {
        return status;
    }

    let Some(endpoint) = api_generation_url(&base.url, config.preset) else {
        status.fail(
            ProviderState::Unknown,
            ProviderReason::InvalidEndpoint,
            None,
        );
        return status;
    };
    let Some(client) = http_client(&base, API_CAPABILITY_TIMEOUT) else {
        status.fail(ProviderState::Offline, ProviderReason::Offline, None);
        return status;
    };
    let request = api_auth_request(client.post(endpoint), config.preset, &api_key)
        .json(&api_smoke_body(config, &model));
    match fetch_json(request).await {
        Ok(body) => {
            if api_message_content(&body).is_some() {
                status.ready(ProviderReason::Ready);
                status.last_success_at = Some(Utc::now().to_rfc3339());
            } else {
                status.fail(
                    ProviderState::Unknown,
                    ProviderReason::CapabilityFailed,
                    None,
                );
            }
        }
        Err(failure) => apply_http_failure(&mut status, failure),
    }
    status
}

/// Spiegelt `MAX_API_MONTHLY_BUDGET_USD` im Frontend. Ungueltig/<=0 = kein Budget.
const MAX_API_MONTHLY_BUDGET_USD: f64 = 50_000.0;

pub fn normalize_api_budget(value: Option<f64>) -> Option<f64> {
    value
        .filter(|amount| amount.is_finite() && *amount > 0.0)
        .map(|amount| (amount.min(MAX_API_MONTHLY_BUDGET_USD) * 100.0).round() / 100.0)
}

fn api_connection_routable(connection: &ApiProviderConfig) -> bool {
    connection.enabled && !connection.model.trim().is_empty()
}

/// Waehlt genau einen API-Slot fuer einen Worker-Lauf. Fail-closed: eine explizite oder
/// projektbezogene Wahl wird nie still auf einen anderen bezahlten Provider umgeleitet.
/// Auto nimmt den ersten regulaeren Slot, "fallback"-Slots erst ohne Alternative.
pub fn select_api_connection<'a>(
    connections: &'a [ApiProviderConfig],
    project_preferences: &std::collections::HashMap<String, String>,
    connection_id: Option<&str>,
    project_id: Option<&str>,
) -> Result<&'a ApiProviderConfig, ProviderReason> {
    let pinned = connection_id.map(str::trim).filter(|id| !id.is_empty());
    let preferred = pinned.or_else(|| {
        project_id
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .and_then(|project| project_preferences.get(project))
            .map(String::as_str)
    });
    if let Some(id) = preferred {
        return connections
            .iter()
            .find(|item| item.id == id && api_connection_routable(item))
            .ok_or(ProviderReason::NotConfigured);
    }
    let mut routable = connections
        .iter()
        .filter(|item| api_connection_routable(item));
    let first = routable
        .clone()
        .next()
        .ok_or(ProviderReason::NotConfigured)?;
    Ok(routable
        .find(|item| item.mode != ApiConnectionMode::Fallback)
        .unwrap_or(first))
}

/// Prueft genau EINEN API-Slot (Key aus dem Schluesselbund, Modellliste, READY) beim eigenen
/// Provider. Kein Pool-Fan-out: andere Slots/Provider werden dabei nie kontaktiert.
pub async fn test_api_connection(config: &ApiProviderConfig) -> ProviderStatus {
    api_status(config, config.enabled, true).await
}

async fn api_pool_status(
    configs: &[ApiProviderConfig],
    enabled: bool,
    capability_test: bool,
) -> ProviderStatus {
    let active = configs
        .iter()
        .filter(|config| config.enabled)
        .collect::<Vec<_>>();
    if active.is_empty() {
        let mut status = ProviderStatus::base(ProviderId::Api, enabled);
        status.installed = true;
        status.capabilities = vec![
            "text_code_agent".to_string(),
            "remote_api".to_string(),
            "multi_connection".to_string(),
            "secure_keychain".to_string(),
        ];
        status.reason = if enabled {
            ProviderReason::NotConfigured
        } else {
            ProviderReason::DisabledInKatoSync
        };
        return status;
    }

    let mut results = Vec::with_capacity(active.len());
    for config in active {
        results.push(api_status(config, enabled, capability_test).await);
    }

    let chosen_index = results
        .iter()
        .position(|status| status.available)
        .or_else(|| results.iter().position(|status| status.authenticated))
        .or_else(|| results.iter().position(|status| status.secret_stored))
        .unwrap_or(0);
    let mut chosen = results.remove(chosen_index);
    let ready =
        usize::from(chosen.available) + results.iter().filter(|status| status.available).count();
    let authenticated = usize::from(chosen.authenticated)
        + results.iter().filter(|status| status.authenticated).count();
    let secret_count = usize::from(chosen.secret_stored)
        + results.iter().filter(|status| status.secret_stored).count();
    chosen.label = format!("API Pool · {} Connections", configs.len());
    chosen.capabilities.push("multi_connection".to_string());
    chosen.secret_stored = secret_count > 0;
    chosen.detail = Some(format!(
        "connections={} ready={} authenticated={} secrets={}",
        configs.len(),
        ready,
        authenticated,
        secret_count
    ));
    chosen
}

async fn local_status(
    config: &LocalProviderConfig,
    enabled: bool,
    capability_test: bool,
) -> ProviderStatus {
    let mut status = ProviderStatus::base(ProviderId::Local, enabled);
    status.capabilities = vec![
        "text_code_agent".to_string(),
        "no_cloud_account".to_string(),
    ];
    status.model = Some(config.model.trim().to_string()).filter(|model| !model.is_empty());
    let base = match validate_local_endpoint(&config.base_url) {
        Ok(url) => url,
        Err(reason) => {
            status.fail(ProviderState::Unknown, reason, None);
            return status;
        }
    };
    status.installed = true;
    status.state = ProviderState::Installed;
    status.endpoint_scope = Some(endpoint_scope(&base).to_string());
    // Der Local-Brain-Port gehoert der KatoSync-verwalteten Runtime. Ohne Besitznachweis
    // bekommt ein dort lauschender Prozess weder Prompts noch den gespeicherten Key. Auch
    // mit Nachweis bleibt dies die externe Local-Lane und gilt nicht als verwaltete Runtime.
    if crate::local_brain::is_reserved_endpoint(&base.url)
        && !crate::local_brain::managed_endpoint_verified(&base.url)
    {
        status.fail(
            ProviderState::Unknown,
            ProviderReason::InvalidEndpoint,
            Some(RESERVED_LOCAL_BRAIN_DETAIL),
        );
        return status;
    }

    let stored_key = tokio::task::spawn_blocking(load_local_key)
        .await
        .unwrap_or(Err(ProviderReason::SecretStoreUnavailable));
    let api_key = match stored_key {
        Ok(Some(stored)) if stored.origin == base.origin() => {
            status.secret_stored = true;
            Some(stored.key)
        }
        // Ein Key fuer einen anderen Origin wird nie an diesen Endpunkt gesendet.
        _ => None,
    };
    if api_key.is_some() && !key_transport_allowed(&base) {
        status.fail(
            ProviderState::AuthUnavailable,
            ProviderReason::InsecureRemoteKey,
            None,
        );
        return status;
    }
    if !enabled {
        status.reason = ProviderReason::DisabledInKatoSync;
        return status;
    }

    let (Some(endpoint), Some(client)) = (
        models_url(&base.url, config.kind),
        http_client(&base, LOCAL_TIMEOUT),
    ) else {
        status.fail(
            ProviderState::Unknown,
            ProviderReason::InvalidEndpoint,
            None,
        );
        return status;
    };
    let mut request = client.get(endpoint);
    if let Some(key) = api_key.as_deref() {
        request = request.bearer_auth(key);
    }
    let models = match fetch_json(request).await {
        Ok(body) => extract_model_ids(&body, config.kind),
        Err(failure) => {
            apply_http_failure(&mut status, failure);
            return status;
        }
    };
    if models.is_empty() {
        status.fail(ProviderState::Unknown, ProviderReason::NoModels, None);
        return status;
    }
    let model = match status.model.clone() {
        Some(requested) if models.iter().any(|model| model == &requested) => requested,
        Some(_) => {
            status.fail(ProviderState::Unknown, ProviderReason::ModelMissing, None);
            return status;
        }
        None => models[0].clone(),
    };
    status.model = Some(model.clone());
    status.authenticated = true;
    status.state = ProviderState::Authenticated;
    status.reason = ProviderReason::ReadyTestPending;
    if !capability_test {
        return status;
    }

    // Faehigkeitstest: ein begrenzter Chat-Aufruf; jede generierte Antwort belegt Faehigkeit.
    let (Some(chat), Some(client)) = (
        chat_url(&base.url),
        http_client(&base, LOCAL_CAPABILITY_TIMEOUT),
    ) else {
        status.fail(
            ProviderState::Unknown,
            ProviderReason::InvalidEndpoint,
            None,
        );
        return status;
    };
    let mut request = client.post(chat).json(&serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": SMOKE_PROMPT }],
        "max_tokens": 16,
        "temperature": 0,
        "stream": false
    }));
    if let Some(key) = api_key.as_deref() {
        request = request.bearer_auth(key);
    }
    match fetch_json(request).await {
        Ok(body) => {
            let generated = body
                .get("choices")
                .and_then(Value::as_array)
                .and_then(|choices| choices.first())
                .and_then(|choice| choice.get("message"))
                .is_some();
            if generated {
                status.ready(ProviderReason::Ready);
                status.capabilities.push(
                    if status.endpoint_scope.as_deref() == Some("remote") {
                        "remote_endpoint"
                    } else {
                        "local_or_lan"
                    }
                    .to_string(),
                );
            } else {
                status.fail(
                    ProviderState::Unknown,
                    ProviderReason::CapabilityFailed,
                    None,
                );
            }
        }
        Err(failure) => apply_http_failure(&mut status, failure),
    }
    status
}

enum HttpFailure {
    /// Resolver hat das Ziel gesperrt (privat, Metadaten, Rebinding ...).
    Blocked,
    Timeout,
    Unreachable,
    Status(u16),
    TooLarge,
    Invalid,
}

async fn fetch_json(request: reqwest::RequestBuilder) -> Result<Value, HttpFailure> {
    fetch_json_limited(request, MAX_LOCAL_RESPONSE_BYTES).await
}

async fn fetch_json_limited(
    request: reqwest::RequestBuilder,
    max_bytes: usize,
) -> Result<Value, HttpFailure> {
    let response = request.send().await.map_err(|error| {
        if endpoint_guard::is_blocked_target(&error) {
            HttpFailure::Blocked
        } else if error.is_timeout() {
            HttpFailure::Timeout
        } else {
            HttpFailure::Unreachable
        }
    })?;
    if !response.status().is_success() {
        return Err(HttpFailure::Status(response.status().as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|length| length as usize > max_bytes)
    {
        return Err(HttpFailure::TooLarge);
    }
    let bytes = response.bytes().await.map_err(|_| HttpFailure::Invalid)?;
    if bytes.len() > max_bytes {
        return Err(HttpFailure::TooLarge);
    }
    serde_json::from_slice(&bytes).map_err(|_| HttpFailure::Invalid)
}

fn apply_http_failure(status: &mut ProviderStatus, failure: HttpFailure) {
    let (state, reason) = match failure {
        HttpFailure::Blocked => (ProviderState::Unknown, ProviderReason::EndpointBlocked),
        HttpFailure::Timeout => (ProviderState::Offline, ProviderReason::TimedOut),
        HttpFailure::Unreachable => (ProviderState::Offline, ProviderReason::Offline),
        HttpFailure::Status(401 | 403) => (
            ProviderState::AuthUnavailable,
            ProviderReason::EndpointAuthRequired,
        ),
        HttpFailure::Status(429) => (ProviderState::QuotaLimited, ProviderReason::QuotaLimited),
        HttpFailure::Status(code) if code >= 500 => (
            ProviderState::CapacityUnavailable,
            ProviderReason::CapacityLimited,
        ),
        HttpFailure::Status(_) => (ProviderState::Unknown, ProviderReason::EndpointError),
        HttpFailure::TooLarge | HttpFailure::Invalid => (
            ProviderState::Unknown,
            ProviderReason::EndpointInvalidResponse,
        ),
    };
    status.fail(state, reason, None);
}

/// Sucht nur auf diesem Rechner (Loopback) nach Ollama und LM Studio auf Standardports.
/// Ohne Key und ohne Netzwerk-Fan-out: es werden nie Secrets mitgesendet.
pub async fn discover_local() -> Vec<DiscoveredLocalProvider> {
    let (ollama, lm_studio) = tokio::join!(
        probe_local(LocalProviderKind::Ollama, "http://127.0.0.1:11434"),
        probe_local(LocalProviderKind::LmStudio, "http://127.0.0.1:1234")
    );
    [ollama, lm_studio].into_iter().flatten().collect()
}

async fn probe_local(kind: LocalProviderKind, base: &str) -> Option<DiscoveredLocalProvider> {
    let endpoint = validate_local_endpoint(base).ok()?;
    if endpoint.target != TargetKind::Loopback {
        return None;
    }
    let client = http_client(&endpoint, DISCOVERY_TIMEOUT)?;
    let body = fetch_json(client.get(models_url(&endpoint.url, kind)?))
        .await
        .ok()?;
    Some(DiscoveredLocalProvider {
        kind,
        base_url: base.to_string(),
        models: extract_model_ids(&body, kind),
    })
}

// ---------------------------------------------------------------------------------------------
// Deterministischer Fallback (Local Control / RDC).
// ---------------------------------------------------------------------------------------------

fn local_control_status() -> ProviderStatus {
    let mut status = ProviderStatus::base(ProviderId::LocalControl, true);
    status.installed = true;
    status.capabilities = vec![
        "deterministic_local_control".to_string(),
        "queue_preserved".to_string(),
    ];
    let heartbeat = crate::local_control::daemon_heartbeat().and_then(|(state, at)| {
        let at = DateTime::parse_from_rfc3339(&at).ok()?;
        let age = Utc::now().signed_duration_since(at.with_timezone(&Utc));
        Some((state, at, age.num_seconds()))
    });
    // Die Queue nimmt Jobs immer an (sie gehen nicht verloren); "running" heisst zusaetzlich,
    // dass der Daemon frisch einen Heartbeat geschrieben hat.
    status.ready(ProviderReason::LocalControlQueueOnly);
    status.last_success_at = None;
    if let Some((state, at, age)) = heartbeat {
        if (0..=LOCAL_CONTROL_HEARTBEAT_MAX_AGE_SECS).contains(&age) {
            status.reason = ProviderReason::LocalControlRunning;
            status.last_success_at = Some(at.with_timezone(&Utc).to_rfc3339());
            status.detail = Some(redact(&format!("daemon={state}")));
        }
    }
    status
}

// ---------------------------------------------------------------------------------------------
// Oeffentliche Service-Funktionen fuer die Tauri-Commands.
// ---------------------------------------------------------------------------------------------

/// Liest reale Auth-Zustaende; READY-/Faehigkeitstests laufen nur bei `run_smoke`.
pub async fn statuses(settings: &ProviderSettings, run_smoke: bool) -> Vec<ProviderStatus> {
    let (codex, claude, api, local) = tokio::join!(
        cloud_status(
            ProviderId::Codex,
            settings.enabled(ProviderId::Codex),
            run_smoke
        ),
        cloud_status(
            ProviderId::Claude,
            settings.enabled(ProviderId::Claude),
            run_smoke
        ),
        api_pool_status(
            &settings.api_providers,
            settings.enabled(ProviderId::Api),
            run_smoke
        ),
        local_status(
            &settings.local_provider,
            settings.enabled(ProviderId::Local),
            run_smoke
        )
    );
    vec![codex, claude, api, local, local_control_status()]
}

/// Prueft genau einen Provider inklusive READY-/Faehigkeitstest, ohne Login auszuloesen.
pub async fn test_provider(provider: ProviderId, settings: &ProviderSettings) -> ProviderStatus {
    let enabled = settings.enabled(provider);
    match provider {
        ProviderId::Codex | ProviderId::Claude => cloud_status(provider, enabled, true).await,
        ProviderId::Api => api_pool_status(&settings.api_providers, enabled, true).await,
        ProviderId::Local => local_status(&settings.local_provider, enabled, true).await,
        ProviderId::LocalControl => local_control_status(),
    }
}

/// Ergebnis eines einzelnen Warm-up-Versuchs. Bewusst ohne Provider-Antwort oder Diagnose-Text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WarmUpResult {
    Warmed,
    NotInstalled,
    NotAuthenticated,
    NotSubscription,
    Failed,
}

/// Billige Vorpruefung (ohne Inferenz): nur Codex/Claude, installiert, angemeldet und eindeutig
/// per Abo. Liefert das validierte Executable fuer den anschliessenden Warm-up.
pub async fn warm_up_eligibility(provider: ProviderId) -> Result<PathBuf, WarmUpResult> {
    if !matches!(provider, ProviderId::Codex | ProviderId::Claude) {
        return Err(WarmUpResult::NotSubscription);
    }
    let CloudProbe { status, executable } = cloud_probe(provider, true).await;
    let Some(executable) = executable else {
        return Err(WarmUpResult::NotInstalled);
    };
    if !status.authenticated {
        return Err(WarmUpResult::NotAuthenticated);
    }
    if status.auth_kind != Some(ProviderAuthKind::Subscription) {
        return Err(WarmUpResult::NotSubscription);
    }
    Ok(executable)
}

/// Fuehrt genau einen Warm-up-Prompt aus – im neutralen Temp-Verzeichnis, ohne Tools. Der Ausgang
/// aendert keine Provider-Karte und loest nie Failover aus; die Antwort wird nicht weitergegeben.
pub async fn run_warm_up(provider: ProviderId, executable: &Path) -> WarmUpResult {
    let Some(spec) = command_spec(provider, CommandPurpose::WarmUp) else {
        return WarmUpResult::NotSubscription;
    };
    let Ok(outcome) = run_captured(executable, &spec).await else {
        return WarmUpResult::Failed;
    };
    let parsed = match provider {
        ProviderId::Codex => parse_codex_smoke(&outcome),
        _ => parse_claude_smoke(&outcome),
    };
    match parsed {
        SmokeOutcome::Ready { .. } => WarmUpResult::Warmed,
        SmokeOutcome::Failed { .. } => WarmUpResult::Failed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome(success: bool, stdout: &str, stderr: &str) -> CommandOutcome {
        CommandOutcome {
            success,
            stdout: stdout.to_string(),
            stderr: stderr.to_string(),
        }
    }

    #[test]
    fn provider_failures_are_classified_without_job_hopping() {
        // Reale Codex-Meldung (gekuerzt) bei erschoepftem Kontingent.
        let codex_quota = "You've hit your usage limit. Upgrade to Pro, visit \
            https://chatgpt.com/codex/settings/usage or try again at 10:34 PM.";
        assert_eq!(classify_failure(codex_quota), ProviderState::QuotaLimited);
        assert_eq!(
            classify_failure("OAuth token has expired. Please run /login"),
            ProviderState::AuthUnavailable
        );
        assert_eq!(
            classify_failure("API Error: 401 unauthorized"),
            ProviderState::AuthUnavailable
        );
        assert_eq!(
            classify_failure("API Error: 529 overloaded_error"),
            ProviderState::CapacityUnavailable
        );
        assert_eq!(
            classify_failure("error sending request: connection refused"),
            ProviderState::Offline
        );
        // Gewoehnliche Job-/Code-/Testfehler duerfen NIE einen Providerwechsel ausloesen.
        for job_failure in [
            "unit test failed: expected 4 got 5",
            "cargo build failed with exit code 101",
            "npm ERR! Test timeout of 5000ms exceeded",
            "AssertionError at item_4291",
            "panic: index out of range",
        ] {
            let state = classify_failure(job_failure);
            assert_eq!(state, ProviderState::JobFailed, "{job_failure}");
            assert!(!allows_failover(state), "{job_failure}");
        }
        assert!(allows_failover(ProviderState::QuotaLimited));
        assert!(allows_failover(ProviderState::AuthUnavailable));
        assert!(allows_failover(ProviderState::CapacityUnavailable));
        assert!(allows_failover(ProviderState::Offline));
        assert!(!allows_failover(ProviderState::Available));
    }

    #[test]
    fn retry_hint_only_uses_provider_reported_reset_text() {
        assert_eq!(
            extract_retry_hint("You've hit your usage limit. Try again at 10:34 PM."),
            Some("Try again at 10:34 PM".to_string())
        );
        assert_eq!(extract_retry_hint("unit test failed"), None);
    }

    #[test]
    fn diagnostics_redact_secrets_email_home_and_oauth_urls() {
        let source = "Bearer abc.def.ghi token=oauth-secretvalue sk-live1234567890abcdef \
            user@example.com /Users/alice/.codex/auth.json C:\\Users\\bob\\.claude \
            https://auth.openai.com/oauth/authorize?state=abc123&code_challenge=xyz \
            eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig api_key: plainvalue";
        let safe = redact(source);
        for leaked in [
            "abc.def.ghi",
            "secretvalue",
            "sk-live1234567890abcdef",
            "user@example.com",
            "alice",
            "bob",
            "abc123",
            "code_challenge",
            "eyJhbGciOiJIUzI1NiJ9",
            "plainvalue",
        ] {
            assert!(!safe.contains(leaked), "leaked {leaked}: {safe}");
        }
        assert!(safe.chars().count() <= 400);
    }

    #[test]
    fn commands_are_static_argument_vectors_without_shells() {
        let expected: [(ProviderId, CommandPurpose, &[&str]); 4] = [
            (ProviderId::Codex, CommandPurpose::Login, &["login"]),
            (
                ProviderId::Codex,
                CommandPurpose::AuthStatus,
                &["login", "status"],
            ),
            (
                ProviderId::Claude,
                CommandPurpose::Login,
                &["auth", "login"],
            ),
            (
                ProviderId::Claude,
                CommandPurpose::AuthStatus,
                &["auth", "status", "--json"],
            ),
        ];
        for (provider, purpose, args) in expected {
            assert_eq!(command_spec(provider, purpose).unwrap().args, args);
        }
        for provider in [ProviderId::Codex, ProviderId::Claude] {
            for purpose in [
                CommandPurpose::Version,
                CommandPurpose::AuthStatus,
                CommandPurpose::Login,
                CommandPurpose::Smoke,
                CommandPurpose::WarmUp,
            ] {
                let spec = command_spec(provider, purpose).unwrap();
                assert!(spec.timeout <= LOGIN_TIMEOUT);
                for arg in spec.args {
                    for meta in [";", "&&", "|", "$(", "`", ">", "<", "\n"] {
                        assert!(!arg.contains(meta), "{arg}");
                    }
                }
                // Kein Credential-Bypass ueber stdin oder API-Keys.
                assert!(!spec.args.contains(&"--with-api-key"));
                assert!(!spec.args.contains(&"--dangerously-skip-permissions"));
                assert!(!spec
                    .args
                    .contains(&"--dangerously-bypass-approvals-and-sandbox"));
            }
            assert!(
                command_spec(provider, CommandPurpose::Smoke)
                    .unwrap()
                    .neutral_cwd
            );
            let warm = command_spec(provider, CommandPurpose::WarmUp).unwrap();
            assert!(warm.neutral_cwd);
            assert!(warm.timeout <= SMOKE_TIMEOUT);
            assert_eq!(warm.args.last(), Some(&WARMUP_PROMPT));
        }
        // Claude-Warm-up laeuft ohne Tools, im Plan-Modus und ohne MCP; Codex nur read-only.
        let claude = command_spec(ProviderId::Claude, CommandPurpose::WarmUp).unwrap();
        assert!(claude.args.windows(2).any(|pair| pair == ["--tools", ""]));
        assert!(claude.args.contains(&"--strict-mcp-config"));
        assert!(claude.args.contains(&"--no-session-persistence"));
        let codex = command_spec(ProviderId::Codex, CommandPurpose::WarmUp).unwrap();
        assert!(codex
            .args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "read-only"]));
        assert!(codex.args.contains(&"--ephemeral"));
        assert!(WARMUP_PROMPT.contains("Do not use any tools"));
        assert!(WARMUP_PROMPT.contains("exactly READY"));
        assert!(command_spec(ProviderId::Local, CommandPurpose::WarmUp).is_none());
        assert!(command_spec(ProviderId::Local, CommandPurpose::Login).is_none());
        assert!(command_spec(ProviderId::LocalControl, CommandPurpose::Smoke).is_none());
    }

    #[test]
    fn executable_resolution_ignores_relative_path_entries_and_foreign_names() {
        let path = env::join_paths(["relative/bin", "."]).unwrap();
        let candidates = executable_candidates(ProviderId::Codex, Some(path));
        assert!(candidates.iter().all(|candidate| candidate.is_absolute()));

        let dir = env::temp_dir().join(format!("katosync-pm-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wrong = dir.join(if cfg!(windows) { "evil.exe" } else { "evil" });
        std::fs::write(&wrong, b"#!/bin/sh\n").unwrap();
        let right = dir.join(accepted_binary_names(ProviderId::Codex)[0]);
        std::fs::write(&right, b"#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&wrong, std::fs::Permissions::from_mode(0o755)).unwrap();
            // Ohne Ausfuehrungsrecht wird auch ein korrekt benanntes Binary abgelehnt.
            std::fs::set_permissions(&right, std::fs::Permissions::from_mode(0o644)).unwrap();
            assert!(validate_executable(ProviderId::Codex, &right).is_none());
            std::fs::set_permissions(&right, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert!(validate_executable(ProviderId::Codex, &wrong).is_none());
        assert!(validate_executable(ProviderId::Claude, &right).is_none());
        assert_eq!(
            validate_executable(ProviderId::Codex, &right),
            Some(right.clone())
        );
        assert!(validate_executable(ProviderId::Codex, Path::new("codex")).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn auth_status_parsing_uses_real_cli_contracts() {
        assert!(parse_auth_status(
            ProviderId::Codex,
            &outcome(true, "Logged in using ChatGPT", "")
        ));
        assert!(!parse_auth_status(
            ProviderId::Codex,
            &outcome(false, "Not logged in", "")
        ));
        assert!(!parse_auth_status(
            ProviderId::Codex,
            &outcome(true, "Not logged in", "")
        ));
        assert!(parse_auth_status(
            ProviderId::Claude,
            &outcome(true, r#"{"loggedIn": true, "authMethod": "claude.ai"}"#, "")
        ));
        assert!(!parse_auth_status(
            ProviderId::Claude,
            &outcome(true, r#"{"loggedIn": false}"#, "")
        ));
        assert!(!parse_auth_status(
            ProviderId::Claude,
            &outcome(true, "garbage", "")
        ));
    }

    #[test]
    fn auth_kind_only_marks_unambiguous_subscription_logins() {
        let kind = |provider, stdout| parse_auth_kind(provider, &outcome(true, stdout, ""));
        assert_eq!(
            kind(ProviderId::Codex, "Logged in using ChatGPT"),
            ProviderAuthKind::Subscription
        );
        assert_eq!(
            kind(ProviderId::Codex, "Logged in using an API key - sk-***"),
            ProviderAuthKind::ApiKey
        );
        assert_eq!(
            kind(ProviderId::Codex, "Logged in"),
            ProviderAuthKind::Unknown
        );
        assert_eq!(
            kind(
                ProviderId::Claude,
                r#"{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"pro"}"#
            ),
            ProviderAuthKind::Subscription
        );
        assert_eq!(
            kind(
                ProviderId::Claude,
                r#"{"loggedIn":true,"authMethod":"api_key"}"#
            ),
            ProviderAuthKind::ApiKey
        );
        assert_eq!(
            kind(
                ProviderId::Claude,
                r#"{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"bedrock"}"#
            ),
            ProviderAuthKind::Unknown
        );
        assert_eq!(
            kind(ProviderId::Claude, "garbage"),
            ProviderAuthKind::Unknown
        );
        assert_eq!(kind(ProviderId::Local, "{}"), ProviderAuthKind::Unknown);
    }

    #[tokio::test]
    async fn warm_up_never_runs_for_local_or_local_control() {
        for provider in [ProviderId::Local, ProviderId::LocalControl] {
            assert_eq!(
                warm_up_eligibility(provider).await.err(),
                Some(WarmUpResult::NotSubscription)
            );
            assert_eq!(
                run_warm_up(provider, Path::new("/nonexistent")).await,
                WarmUpResult::NotSubscription
            );
        }
    }

    #[test]
    fn ready_smoke_requires_structured_ready_answer() {
        let codex_ok = r#"{"type":"thread.started","thread_id":"t"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"READY"}}
{"type":"turn.completed","usage":{}}"#;
        assert_eq!(
            parse_codex_smoke(&outcome(true, codex_ok, "")),
            SmokeOutcome::Ready { model: None }
        );
        // Prompt-Echo oder READY in stderr darf nicht als Erfolg gelten.
        assert!(matches!(
            parse_codex_smoke(&outcome(true, "", "Reply with exactly READY")),
            SmokeOutcome::Failed { .. }
        ));
        let codex_quota = r#"{"type":"turn.started"}
{"type":"error","message":"You've hit your usage limit. Try again at 10:34 PM."}
{"type":"turn.failed","error":{"message":"You've hit your usage limit."}}"#;
        match parse_codex_smoke(&outcome(false, codex_quota, "")) {
            SmokeOutcome::Failed { evidence } => {
                assert_eq!(classify_failure(&evidence), ProviderState::QuotaLimited)
            }
            other => panic!("unexpected {other:?}"),
        }

        let claude_ok = r#"{"type":"result","subtype":"success","is_error":false,"result":"READY","modelUsage":{"claude-opus-5-5":{}}}"#;
        assert_eq!(
            parse_claude_smoke(&outcome(true, claude_ok, "")),
            SmokeOutcome::Ready {
                model: Some("claude-opus-5-5".to_string())
            }
        );
        let claude_err = r#"{"type":"result","is_error":true,"result":"OAuth token has expired. Please run /login","api_error_status":401}"#;
        match parse_claude_smoke(&outcome(false, claude_err, "")) {
            SmokeOutcome::Failed { evidence } => {
                assert_eq!(classify_failure(&evidence), ProviderState::AuthUnavailable)
            }
            other => panic!("unexpected {other:?}"),
        }
        let claude_wrong = r#"{"type":"result","is_error":false,"result":"Sure! READY to help."}"#;
        assert!(matches!(
            parse_claude_smoke(&outcome(true, claude_wrong, "")),
            SmokeOutcome::Failed { .. }
        ));
    }

    #[test]
    fn login_code_validation_is_bounded_and_single_line() {
        assert!(validate_login_code("abc-DEF_123.xyz"));
        assert!(validate_login_code("code with spaces"));
        assert!(!validate_login_code(""));
        assert!(!validate_login_code("   "));
        assert!(!validate_login_code("abc\ndef"));
        assert!(!validate_login_code("abc\rdef"));
        assert!(!validate_login_code(&"x".repeat(4097)));
    }

    #[test]
    fn login_url_extraction_accepts_only_official_https_hosts() {
        let codex = "If your browser did not open, navigate to this URL to authenticate: \
            https://auth.openai.com/oauth/authorize?client_id=x&state=y";
        assert!(official_login_url(ProviderId::Codex, codex)
            .unwrap()
            .starts_with("https://auth.openai.com/oauth/authorize"));
        for bad in [
            "https://auth.openai.com.evil.test/oauth",
            "http://auth.openai.com/oauth",
            "https://user:pw@auth.openai.com/oauth",
            "https://auth.openai.com:8443/oauth",
            "https://claude.ai/oauth/authorize",
        ] {
            assert!(
                official_login_url(ProviderId::Codex, bad).is_none(),
                "{bad}"
            );
        }
        assert!(official_login_url(
            ProviderId::Claude,
            "Browser didn't open? Use: https://claude.ai/oauth/authorize?code=true"
        )
        .is_some());
        assert!(official_login_url(ProviderId::Local, "https://claude.ai/x").is_none());
    }

    #[test]
    fn local_endpoint_validation_rejects_injection_and_credentials() {
        assert!(validate_local_endpoint("http://localhost:11434").is_ok());
        assert!(validate_local_endpoint("http://[::1]:1234/v1").is_ok());
        assert!(validate_local_endpoint("https://models.example.test/v1").is_ok());
        for bad in [
            "",
            "file:///tmp/model",
            "javascript:alert(1)",
            "http://user:secret@localhost:1234",
            "http://localhost:1234/?token=secret",
            "http://localhost:1234/#frag",
            "http://localhost:1234;rm -rf /",
            "http://localhost:1234/\nHost: evil",
            "localhost:11434",
        ] {
            assert!(validate_local_endpoint(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn reserved_local_brain_port_is_never_treated_as_managed_without_proof() {
        let url = |value: &str| {
            validate_local_endpoint(value).unwrap_or_else(|reason| panic!("{value}: {reason:?}"))
        };
        for reserved in [
            "http://127.0.0.1:17842",
            "http://127.0.0.1:17842/v1",
            "http://localhost:17842/v1",
            "http://[::1]:17842",
            "https://127.0.0.1:17842",
        ] {
            assert!(
                crate::local_brain::is_reserved_endpoint(&url(reserved).url),
                "{reserved}"
            );
            // Ohne registrierte, nachgewiesene Runtime nie als verwaltet akzeptiert.
            assert!(!crate::local_brain::managed_endpoint_verified(
                &url(reserved).url
            ));
        }

        // Die unspezifizierte Bind-Adresse bleibt semantisch fuer den Local-Brain-Port
        // reserviert, wird vom neuen Endpoint-Guard aber bereits vor Provider-Nutzung
        // fail-closed blockiert.
        let unspecified = reqwest::Url::parse("http://0.0.0.0:17842").unwrap();
        assert!(crate::local_brain::is_reserved_endpoint(&unspecified));
        assert!(!crate::local_brain::managed_endpoint_verified(&unspecified));
        assert!(matches!(
            validate_local_endpoint("http://0.0.0.0:17842"),
            Err(ProviderReason::EndpointBlocked)
        ));
        for external in [
            "http://127.0.0.1:11434",
            "http://localhost:1234/v1",
            "http://192.168.1.20:17842",
            "https://models.example.test:17842/v1",
        ] {
            let external_url = reqwest::Url::parse(external).unwrap();
            assert!(
                !crate::local_brain::is_reserved_endpoint(&external_url),
                "{external}"
            );
        }
    }

    #[tokio::test]
    async fn unverified_listener_on_reserved_port_gets_no_requests() {
        let config = LocalProviderConfig {
            kind: LocalProviderKind::OpenAiCompatible,
            base_url: "http://127.0.0.1:17842/v1".to_string(),
            model: String::new(),
        };
        let status = local_status(&config, true, true).await;
        assert_eq!(status.reason, ProviderReason::InvalidEndpoint);
        assert!(!status.available);
        assert!(!status.authenticated);
        assert!(!status.secret_stored, "Key wurde nicht einmal geladen");
    }

    #[test]
    fn endpoint_scope_is_exact_loopback_or_public_https_and_lan_is_blocked() {
        let scope = |value: &str| endpoint_scope(&validate_local_endpoint(value).unwrap());
        assert_eq!(scope("http://127.0.0.1:11434"), "local");
        assert_eq!(scope("http://localhost:1234"), "local");
        assert_eq!(scope("http://[::1]:1234"), "local");
        assert_eq!(scope("https://172.40.0.5:8000"), "remote");
        assert_eq!(scope("https://models.example.test/v1"), "remote");
        // LAN ist im Release nie konfigurierbar, weder per HTTP noch per HTTPS.
        for blocked in [
            "http://192.168.1.20:11434",
            "http://10.0.0.5:8000",
            "https://172.20.0.5:8000",
            "http://studio.local:1234",
            "https://[fd00::1]:1234",
            "http://169.254.169.254/latest/meta-data",
            "https://[fd00:ec2::254]/v1",
        ] {
            assert_eq!(
                validate_local_endpoint(blocked),
                Err(ProviderReason::EndpointBlocked),
                "{blocked}"
            );
        }
        assert_eq!(
            validate_local_endpoint("http://172.40.0.5:8000"),
            Err(ProviderReason::InsecureRemoteKey)
        );
    }

    #[test]
    fn local_urls_preserve_v1_without_duplication() {
        let lm = validate_local_endpoint("http://127.0.0.1:1234/v1").unwrap();
        assert_eq!(
            models_url(&lm.url, LocalProviderKind::LmStudio)
                .unwrap()
                .as_str(),
            "http://127.0.0.1:1234/v1/models"
        );
        assert_eq!(
            chat_url(&lm.url).unwrap().as_str(),
            "http://127.0.0.1:1234/v1/chat/completions"
        );
        let ollama = validate_local_endpoint("http://127.0.0.1:11434").unwrap();
        assert_eq!(
            models_url(&ollama.url, LocalProviderKind::Ollama)
                .unwrap()
                .as_str(),
            "http://127.0.0.1:11434/api/tags"
        );
        assert_eq!(
            chat_url(&ollama.url).unwrap().as_str(),
            "http://127.0.0.1:11434/v1/chat/completions"
        );
        let generic = validate_local_endpoint("https://models.example.test").unwrap();
        assert_eq!(
            models_url(&generic.url, LocalProviderKind::OpenAiCompatible)
                .unwrap()
                .as_str(),
            "https://models.example.test/v1/models"
        );
    }

    #[test]
    fn model_ids_are_filtered_to_safe_names() {
        let body = serde_json::json!({ "data": [
            { "id": "qwen2.5-coder:7b" },
            { "id": "bad name; rm -rf /" },
            { "id": "org/model@v1" }
        ]});
        assert_eq!(
            extract_model_ids(&body, LocalProviderKind::OpenAiCompatible),
            vec!["qwen2.5-coder:7b".to_string(), "org/model@v1".to_string()]
        );
    }

    #[test]
    fn api_keys_are_validated_and_bound_to_secure_transport() {
        assert!(validate_api_key("sk-local-1234"));
        assert!(!validate_api_key(""));
        assert!(!validate_api_key("abc\r\nX-Injected: 1"));
        assert!(!validate_api_key("with space"));
        assert!(!validate_api_key(&"a".repeat(513)));
        let remote_https = validate_local_endpoint("https://models.example.test").unwrap();
        let loopback_http = validate_local_endpoint("http://127.0.0.1:1234").unwrap();
        assert!(key_transport_allowed(&remote_https));
        assert!(key_transport_allowed(&loopback_http));
        // Klartext-HTTP ausserhalb von exaktem Loopback wird gar nicht erst validiert.
        assert_eq!(
            save_local_key("http://models.example.test", "sk-abcdef"),
            Err(ProviderReason::InsecureRemoteKey)
        );
        assert_eq!(
            save_local_key("http://192.168.1.5:8000", "sk-abcdef"),
            Err(ProviderReason::EndpointBlocked)
        );
        assert_eq!(
            validate_local_endpoint("http://127.0.0.1:1234/v1")
                .unwrap()
                .origin(),
            "http://127.0.0.1:1234"
        );
    }

    /// Manuelles Live-Gate gegen die echten, lokal installierten CLIs (liest nur Auth-Status und
    /// fuehrt den begrenzten READY-Test aus; startet nie Login/Logout). Nicht Teil von CI:
    /// `cargo test --lib live_provider_gate -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn live_provider_gate() {
        for status in statuses(&ProviderSettings::default(), true).await {
            println!(
                "{:?} state={:?} reason={:?} installed={} auth={} available={} version={:?} model={:?} retry={:?} detail={:?}",
                status.provider,
                status.state,
                status.reason,
                status.installed,
                status.authenticated,
                status.available,
                status.version,
                status.model,
                status.retry_hint,
                status.detail
            );
        }
    }

    #[test]
    fn cancel_without_active_login_is_a_noop() {
        assert!(!cancel_login(ProviderId::Codex));
    }

    #[test]
    fn local_control_is_always_a_non_hopping_terminal_fallback() {
        let status = local_control_status();
        assert!(status.available);
        assert!(!status.failover_allowed);
        assert!(matches!(
            status.reason,
            ProviderReason::LocalControlRunning | ProviderReason::LocalControlQueueOnly
        ));
    }
    fn api_slot(id: &str, preset: ApiProviderPreset, model: &str) -> ApiProviderConfig {
        ApiProviderConfig {
            id: id.to_string(),
            preset,
            model: model.to_string(),
            enabled: true,
            ..ApiProviderConfig::default()
        }
    }

    #[test]
    fn strong_key_prefixes_map_to_exactly_one_provider_family() {
        // Synthetische, nicht echte Testwerte.
        assert_eq!(
            strong_key_family("sk-ant-api03-EXAMPLEONLY0000"),
            Some(&[ApiProviderPreset::Anthropic][..])
        );
        assert_eq!(
            strong_key_family("sk-proj-EXAMPLEONLY0000"),
            Some(&[ApiProviderPreset::Openai][..])
        );
        assert_eq!(
            strong_key_family("xai-EXAMPLEONLY00000000"),
            Some(&[ApiProviderPreset::Xai][..])
        );
        assert!(strong_key_family("sk-or-v1-EXAMPLEONLY0000")
            .is_some_and(|family| family.contains(&ApiProviderPreset::OpenrouterEu)));
        // Generisches sk- (OpenAI-Legacy, DeepSeek, Gateways) ist nie eindeutig.
        assert_eq!(strong_key_family("sk-EXAMPLEONLY000000000000"), None);
        assert_eq!(strong_key_family("EXAMPLEONLY0000000000000000000000"), None);
    }

    #[test]
    fn keys_of_another_provider_are_never_stored_for_a_foreign_preset() {
        let anthropic_key = "sk-ant-api03-EXAMPLEONLY0000";
        assert!(key_conflicts_with_preset(
            anthropic_key,
            ApiProviderPreset::Openai
        ));
        assert!(!key_conflicts_with_preset(
            anthropic_key,
            ApiProviderPreset::Anthropic
        ));
        // Eigene Gateways bleiben bewusst Nutzerentscheidung.
        assert!(!key_conflicts_with_preset(
            anthropic_key,
            ApiProviderPreset::CustomOpenai
        ));
        // Mehrdeutige Keys werden nicht blockiert, nur nicht automatisch zugeordnet.
        assert!(!key_conflicts_with_preset(
            "sk-EXAMPLEONLY000000000000",
            ApiProviderPreset::Deepseek
        ));
        let slot = api_slot("api-1", ApiProviderPreset::Openai, "");
        assert_eq!(
            save_api_provider_key(&slot, anthropic_key),
            Err(ProviderReason::ApiKeyProviderMismatch)
        );
    }

    #[test]
    fn api_errors_never_echo_key_material() {
        let key = "sk-ant-api03-EXAMPLEONLY0000SECRET";
        let reason = save_api_provider_key(&api_slot("api-1", ApiProviderPreset::Openai, ""), key)
            .expect_err("mismatch must fail closed");
        let serialized = serde_json::to_string(&reason).unwrap();
        assert_eq!(serialized, "\"api_key_provider_mismatch\"");
        assert!(!serialized.contains("EXAMPLEONLY"));
        for sample in [
            format!("auth failed for {key}"),
            "xai-EXAMPLEONLY00000000 rejected".to_string(),
            "zai key 0123456789abcdef0123456789abcdef.EXAMPLEONLY00000 bad".to_string(),
        ] {
            assert!(
                !redact(&sample).contains("EXAMPLEONLY"),
                "{}",
                redact(&sample)
            );
        }
    }

    #[test]
    fn invalid_slot_ids_cannot_address_foreign_keychain_accounts() {
        assert_eq!(
            api_key_account("api-1").as_deref(),
            Ok("api-provider-api-key:api-1")
        );
        for bad in ["", "../local-provider-api-key", "api 1", &"a".repeat(65)] {
            assert_eq!(api_key_account(bad), Err(ProviderReason::InvalidEndpoint));
        }
    }

    #[test]
    fn remote_api_presets_require_https_and_custom_must_not_be_local() {
        let mut custom = api_slot("api-1", ApiProviderPreset::CustomOpenai, "m");
        custom.base_url = "http://api.example.com/v1".to_string();
        assert_eq!(
            api_base_url(&custom).err(),
            Some(ProviderReason::InsecureRemoteKey)
        );
        for blocked in [
            "https://127.0.0.1:8443/v1",
            "https://localhost/v1",
            "https://169.254.169.254/latest",
            "https://[fd00:ec2::254]/v1",
            "https://[::ffff:a9fe:a9fe]/v1",
            "https://10.1.2.3/v1",
            "https://192.168.0.10/v1",
            "https://[fe80::1]/v1",
            "https://metadata.google.internal/v1",
        ] {
            custom.base_url = blocked.to_string();
            assert_eq!(
                api_base_url(&custom).err(),
                Some(ProviderReason::EndpointBlocked),
                "{blocked}"
            );
        }
        custom.base_url = "https://gateway.example.com/v1".to_string();
        let base = api_base_url(&custom).unwrap();
        assert_eq!(base.origin(), "https://gateway.example.com");
        let zai = api_slot("api-2", ApiProviderPreset::Zai, "glm");
        assert_eq!(
            api_generation_url(&api_base_url(&zai).unwrap().url, zai.preset)
                .unwrap()
                .as_str(),
            "https://api.z.ai/api/paas/v4/chat/completions"
        );
    }

    #[test]
    fn effort_is_only_sent_where_the_provider_wiring_supports_it() {
        let mut openai = api_slot("api-1", ApiProviderPreset::Openai, "gpt-5.6-sol");
        openai.effort = ApiEffort::High;
        let body = api_generation_body(&openai, "gpt-5.6-sol", None, "hi", 16);
        assert_eq!(body["reasoning"]["effort"], "high");

        let mut anthropic = api_slot("api-2", ApiProviderPreset::Anthropic, "claude-opus-5-5");
        anthropic.effort = ApiEffort::High;
        let body = api_generation_body(&anthropic, "claude-opus-5-5", None, "hi", 16);
        assert!(body.get("reasoning").is_none());
        assert!(body.get("reasoning_effort").is_none());

        let mut auto = openai.clone();
        auto.effort = ApiEffort::Auto;
        let body = api_generation_body(&auto, "gpt-5.6-sol", None, "hi", 16);
        assert!(body.get("reasoning").is_none());
    }

    #[test]
    fn api_slot_selection_fails_closed_and_never_hops_providers() {
        let mut fallback = api_slot("api-1", ApiProviderPreset::Deepseek, "deepseek-v4-flash");
        fallback.mode = ApiConnectionMode::Fallback;
        let regular = api_slot("api-2", ApiProviderPreset::Mistral, "mistral-small-latest");
        let mut disabled = api_slot("api-3", ApiProviderPreset::Openai, "gpt-5.6-sol");
        disabled.enabled = false;
        let slots = vec![fallback, regular, disabled];
        let mut prefs = std::collections::HashMap::new();
        prefs.insert("proj-a".to_string(), "api-3".to_string());

        // Auto bevorzugt regulaere Slots vor "fallback".
        assert_eq!(
            select_api_connection(&slots, &prefs, None, None)
                .unwrap()
                .id,
            "api-2"
        );
        // Explizit gewaehlter, deaktivierter Slot -> Fehler statt stiller Providerwechsel.
        assert_eq!(
            select_api_connection(&slots, &prefs, Some("api-3"), None).err(),
            Some(ProviderReason::NotConfigured)
        );
        // Projektvorwahl auf deaktivierten Slot ebenfalls fail-closed.
        assert_eq!(
            select_api_connection(&slots, &prefs, None, Some("proj-a")).err(),
            Some(ProviderReason::NotConfigured)
        );
        assert_eq!(
            select_api_connection(&slots, &prefs, Some("api-1"), None)
                .unwrap()
                .id,
            "api-1"
        );
        assert_eq!(
            select_api_connection(&[], &prefs, None, None).err(),
            Some(ProviderReason::NotConfigured)
        );
    }

    #[test]
    fn api_budget_normalization_rejects_nonsense() {
        assert_eq!(normalize_api_budget(None), None);
        assert_eq!(normalize_api_budget(Some(0.0)), None);
        assert_eq!(normalize_api_budget(Some(-5.0)), None);
        assert_eq!(normalize_api_budget(Some(f64::NAN)), None);
        assert_eq!(normalize_api_budget(Some(25.555)), Some(25.56));
        assert_eq!(normalize_api_budget(Some(1e9)), Some(50_000.0));
    }

    #[test]
    fn api_model_catalog_is_bounded_and_filters_unsafe_ids() {
        let entries = (0..2_500)
            .map(|index| serde_json::json!({ "id": format!("vendor/model-{index}") }))
            .chain([serde_json::json!({ "id": "bad id; rm -rf" })])
            .collect::<Vec<_>>();
        let models = extract_api_model_ids(&serde_json::json!({ "data": entries }));
        assert_eq!(models.len(), MAX_API_CATALOG_MODELS);
        assert!(models.iter().all(|model| is_safe_model_name(model)));
    }

    async fn one_shot_server(response: String) -> (u16, tokio::task::JoinHandle<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 4096];
            let read = socket.read(&mut buf).await.unwrap_or(0);
            let _ = socket.write_all(response.as_bytes()).await;
            String::from_utf8_lossy(&buf[..read]).to_string()
        });
        (port, handle)
    }

    #[tokio::test]
    async fn api_key_never_appears_in_status_errors_or_logs() {
        let key = "sk-fixture-never-leak-0123456789";
        let body = format!("{{\"error\":\"invalid key {key}\"}}");
        let (port, server) = one_shot_server(format!(
            "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ))
        .await;
        let base = validate_local_endpoint(&format!("http://127.0.0.1:{port}/v1")).unwrap();
        let client = http_client(&base, Duration::from_secs(2)).unwrap();
        let request = client.get(chat_url(&base.url).unwrap()).bearer_auth(key);
        let failure = fetch_json(request).await.expect_err("401 must fail");
        let mut status = ProviderStatus::base(ProviderId::Local, true);
        apply_http_failure(&mut status, failure);
        assert_eq!(status.reason, ProviderReason::EndpointAuthRequired);
        let serialized = serde_json::to_string(&status).unwrap();
        assert!(!serialized.contains(key), "{serialized}");
        // Der Key ging nur an den exakt validierten Loopback-Origin.
        assert!(server.await.unwrap().contains(key));
        // Diagnose-/Log-Pfade redigieren Key-Formen und Bearer-Header.
        let log_line = redact(&format!("Authorization: Bearer {key} body={body}"));
        assert!(!log_line.contains(key), "{log_line}");
    }

    #[tokio::test]
    async fn blocked_or_redirected_requests_surface_reason_codes_without_key() {
        let key = "sk-fixture-redirect-0123456789";
        let (port, server) = one_shot_server(
            "HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .to_string(),
        )
        .await;
        let base = validate_local_endpoint(&format!("http://127.0.0.1:{port}")).unwrap();
        let client = http_client(&base, Duration::from_secs(2)).unwrap();
        let failure = fetch_json(client.get(chat_url(&base.url).unwrap()).bearer_auth(key))
            .await
            .expect_err("redirect is never followed");
        assert!(matches!(failure, HttpFailure::Status(302)));
        server.await.unwrap();

        // Ein als oeffentlich validiertes Ziel, das auf Loopback aufloest (Rebinding), wird
        // vor dem Verbindungsaufbau als EndpointBlocked gemeldet.
        let public = ValidatedEndpoint {
            url: Url::parse("https://public.example.test").unwrap(),
            target: TargetKind::Public,
        };
        let client = http_client(&public, Duration::from_secs(2)).unwrap();
        let failure = fetch_json(client.get("http://localhost:9/v1/models").bearer_auth(key))
            .await
            .expect_err("blocked resolution");
        let mut status = ProviderStatus::base(ProviderId::Local, true);
        apply_http_failure(&mut status, failure);
        assert_eq!(status.reason, ProviderReason::EndpointBlocked);
        assert!(!serde_json::to_string(&status).unwrap().contains(key));
        assert_eq!(
            serde_json::to_value(ProviderReason::EndpointBlocked).unwrap(),
            "endpoint_blocked"
        );
    }
}
