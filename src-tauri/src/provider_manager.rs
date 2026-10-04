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

use chrono::{DateTime, Utc};
use regex::Regex;
use reqwest::{redirect::Policy, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    env,
    ffi::OsString,
    net::IpAddr,
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

const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
const SMOKE_TIMEOUT: Duration = Duration::from_secs(60);
const LOCAL_TIMEOUT: Duration = Duration::from_secs(8);
const LOCAL_CAPABILITY_TIMEOUT: Duration = Duration::from_secs(60);
const DISCOVERY_TIMEOUT: Duration = Duration::from_millis(1500);
const MAX_LOCAL_RESPONSE_BYTES: usize = 1_048_576;
const MAX_CAPTURED_BYTES: usize = 262_144;
const LOCAL_CONTROL_HEARTBEAT_MAX_AGE_SECS: i64 = 90;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const LOCAL_KEY_ACCOUNT: &str = "local-provider-api-key";
const SMOKE_PROMPT: &str = "Reply with exactly READY and no other text.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderId {
    Codex,
    Claude,
    Local,
    LocalControl,
}

impl ProviderId {
    fn label(self) -> &'static str {
        match self {
            Self::Codex => "OpenAI Codex",
            Self::Claude => "Anthropic Claude Code",
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettings {
    #[serde(default)]
    pub disabled_providers: Vec<ProviderId>,
    #[serde(default)]
    pub local_provider: LocalProviderConfig,
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
            r"(?i)\b(?:sk|sess|oauth|token|rk|pk|ghp|gho|xox[a-z])[-_][A-Za-z0-9._-]{8,}",
            "<redacted>",
        ),
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

/// Validiert und normalisiert eine lokale/entfernte OpenAI-kompatible Basis-URL.
pub fn validate_local_endpoint(value: &str) -> Result<Url, ProviderReason> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ProviderReason::NotConfigured);
    }
    if trimmed.len() > 2048 || trimmed.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(ProviderReason::InvalidEndpoint);
    }
    let url = Url::parse(trimmed).map_err(|_| ProviderReason::InvalidEndpoint)?;
    let valid = matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some_and(|host| !host.is_empty())
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none();
    if valid {
        Ok(url)
    } else {
        Err(ProviderReason::InvalidEndpoint)
    }
}

/// local = dieser Rechner, lan = privates Netz, remote = alles andere.
pub fn endpoint_scope(url: &Url) -> &'static str {
    let Some(host) = url.host_str() else {
        return "remote";
    };
    let host = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    if let Ok(ip) = host.parse::<IpAddr>() {
        return ip_scope(ip);
    }
    if host == "localhost" || host.ends_with(".localhost") {
        "local"
    } else if host.ends_with(".local") || host.ends_with(".lan") || host.ends_with(".home.arpa") {
        "lan"
    } else {
        "remote"
    }
}

fn ip_scope(ip: IpAddr) -> &'static str {
    if ip.is_loopback() {
        return "local";
    }
    let private = match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => {
            let first = v6.segments()[0];
            (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
        }
    };
    if private {
        "lan"
    } else {
        "remote"
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

/// Alle drei Presets sprechen unter /v1 das OpenAI-Chat-Protokoll (Ollama inklusive).
fn chat_url(base: &Url) -> Option<Url> {
    join_api_path(base, "/chat/completions", None)
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

fn http_client(limit: Duration) -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(limit)
        .redirect(Policy::none())
        .build()
        .ok()
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredLocalKey {
    origin: String,
    key: String,
}

fn origin_of(url: &Url) -> String {
    url.origin().ascii_serialization()
}

/// Erlaubt nur druckbare ASCII-Keys ohne Whitespace; verhindert Header-Injection.
pub fn validate_api_key(value: &str) -> bool {
    let key = value.trim();
    !key.is_empty() && key.len() <= 512 && key.chars().all(|c| c.is_ascii_graphic())
}

/// API-Keys nie im Klartext ueber unverschluesseltes HTTP ins Internet senden.
fn key_transport_allowed(url: &Url) -> bool {
    url.scheme() == "https" || endpoint_scope(url) != "remote"
}

#[cfg(target_os = "macos")]
fn key_entry() -> Option<keyring::Entry> {
    keyring::Entry::new(crate::KEYCHAIN_SERVICE, LOCAL_KEY_ACCOUNT).ok()
}

#[cfg(target_os = "macos")]
fn load_local_key() -> Result<Option<StoredLocalKey>, ProviderReason> {
    let entry = key_entry().ok_or(ProviderReason::SecretStoreUnavailable)?;
    match entry.get_password() {
        Ok(raw) => Ok(serde_json::from_str(&raw).ok()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(ProviderReason::SecretStoreUnavailable),
    }
}

// Windows/Linux: In diesem Build ist kein OS-gestuetzter Store fuer diesen Key aktiviert
// (keyring ohne windows-native-Feature waere nur ein Mock). Bewusst sicherer Stopp statt
// Klartext-Persistenz; siehe docs/ARCHITECTURE.md (Windows-Validierungsgate).
#[cfg(not(target_os = "macos"))]
fn load_local_key() -> Result<Option<StoredLocalKey>, ProviderReason> {
    Ok(None)
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
    store_local_key(&StoredLocalKey {
        origin: origin_of(&url),
        key: api_key.trim().to_string(),
    })
}

#[cfg(target_os = "macos")]
fn store_local_key(value: &StoredLocalKey) -> Result<(), ProviderReason> {
    let raw = serde_json::to_string(value).map_err(|_| ProviderReason::SecretStoreUnavailable)?;
    key_entry()
        .ok_or(ProviderReason::SecretStoreUnavailable)?
        .set_password(&raw)
        .map_err(|_| ProviderReason::SecretStoreUnavailable)
}

#[cfg(not(target_os = "macos"))]
fn store_local_key(_value: &StoredLocalKey) -> Result<(), ProviderReason> {
    Err(ProviderReason::SecretStoreUnavailable)
}

/// Loescht ausschliesslich KatoSync-eigene Secrets. CLI-Credentials bleiben unangetastet.
pub fn disconnect(provider: ProviderId) -> Result<(), ProviderReason> {
    if provider != ProviderId::Local {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        let entry = key_entry().ok_or(ProviderReason::SecretStoreUnavailable)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(ProviderReason::SecretStoreUnavailable),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
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

    let stored_key = tokio::task::spawn_blocking(load_local_key)
        .await
        .unwrap_or(Err(ProviderReason::SecretStoreUnavailable));
    let api_key = match stored_key {
        Ok(Some(stored)) if stored.origin == origin_of(&base) => {
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

    let (Some(endpoint), Some(client)) =
        (models_url(&base, config.kind), http_client(LOCAL_TIMEOUT))
    else {
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
    let (Some(chat), Some(client)) = (chat_url(&base), http_client(LOCAL_CAPABILITY_TIMEOUT))
    else {
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
    Timeout,
    Unreachable,
    Status(u16),
    TooLarge,
    Invalid,
}

async fn fetch_json(request: reqwest::RequestBuilder) -> Result<Value, HttpFailure> {
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
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
        .is_some_and(|length| length as usize > MAX_LOCAL_RESPONSE_BYTES)
    {
        return Err(HttpFailure::TooLarge);
    }
    let bytes = response.bytes().await.map_err(|_| HttpFailure::Invalid)?;
    if bytes.len() > MAX_LOCAL_RESPONSE_BYTES {
        return Err(HttpFailure::TooLarge);
    }
    serde_json::from_slice(&bytes).map_err(|_| HttpFailure::Invalid)
}

fn apply_http_failure(status: &mut ProviderStatus, failure: HttpFailure) {
    let (state, reason) = match failure {
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
pub async fn discover_local() -> Vec<DiscoveredLocalProvider> {
    let Some(client) = http_client(DISCOVERY_TIMEOUT) else {
        return Vec::new();
    };
    let (ollama, lm_studio) = tokio::join!(
        probe_local(&client, LocalProviderKind::Ollama, "http://127.0.0.1:11434"),
        probe_local(
            &client,
            LocalProviderKind::LmStudio,
            "http://127.0.0.1:1234"
        )
    );
    [ollama, lm_studio].into_iter().flatten().collect()
}

async fn probe_local(
    client: &reqwest::Client,
    kind: LocalProviderKind,
    base: &str,
) -> Option<DiscoveredLocalProvider> {
    let url = validate_local_endpoint(base).ok()?;
    let body = fetch_json(client.get(models_url(&url, kind)?)).await.ok()?;
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
    let (codex, claude, local) = tokio::join!(
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
        local_status(
            &settings.local_provider,
            settings.enabled(ProviderId::Local),
            run_smoke
        )
    );
    vec![codex, claude, local, local_control_status()]
}

/// Prueft genau einen Provider inklusive READY-/Faehigkeitstest, ohne Login auszuloesen.
pub async fn test_provider(provider: ProviderId, settings: &ProviderSettings) -> ProviderStatus {
    let enabled = settings.enabled(provider);
    match provider {
        ProviderId::Codex | ProviderId::Claude => cloud_status(provider, enabled, true).await,
        ProviderId::Local => local_status(&settings.local_provider, enabled, true).await,
        ProviderId::LocalControl => local_control_status(),
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
        }
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
    fn endpoint_scope_distinguishes_local_lan_and_remote() {
        let scope = |value: &str| endpoint_scope(&validate_local_endpoint(value).unwrap());
        assert_eq!(scope("http://127.0.0.1:11434"), "local");
        assert_eq!(scope("http://localhost:1234"), "local");
        assert_eq!(scope("http://[::1]:1234"), "local");
        assert_eq!(scope("http://192.168.1.20:11434"), "lan");
        assert_eq!(scope("http://10.0.0.5:8000"), "lan");
        assert_eq!(scope("http://172.20.0.5:8000"), "lan");
        assert_eq!(scope("http://172.40.0.5:8000"), "remote");
        assert_eq!(scope("http://studio.local:1234"), "lan");
        assert_eq!(scope("http://[fd00::1]:1234"), "lan");
        assert_eq!(scope("https://models.example.test/v1"), "remote");
    }

    #[test]
    fn local_urls_preserve_v1_without_duplication() {
        let lm = validate_local_endpoint("http://127.0.0.1:1234/v1").unwrap();
        assert_eq!(
            models_url(&lm, LocalProviderKind::LmStudio)
                .unwrap()
                .as_str(),
            "http://127.0.0.1:1234/v1/models"
        );
        assert_eq!(
            chat_url(&lm).unwrap().as_str(),
            "http://127.0.0.1:1234/v1/chat/completions"
        );
        let ollama = validate_local_endpoint("http://127.0.0.1:11434").unwrap();
        assert_eq!(
            models_url(&ollama, LocalProviderKind::Ollama)
                .unwrap()
                .as_str(),
            "http://127.0.0.1:11434/api/tags"
        );
        assert_eq!(
            chat_url(&ollama).unwrap().as_str(),
            "http://127.0.0.1:11434/v1/chat/completions"
        );
        let generic = validate_local_endpoint("http://10.0.0.5:8000").unwrap();
        assert_eq!(
            models_url(&generic, LocalProviderKind::OpenAiCompatible)
                .unwrap()
                .as_str(),
            "http://10.0.0.5:8000/v1/models"
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
        let remote_http = validate_local_endpoint("http://models.example.test").unwrap();
        let remote_https = validate_local_endpoint("https://models.example.test").unwrap();
        let lan_http = validate_local_endpoint("http://192.168.1.5:8000").unwrap();
        assert!(!key_transport_allowed(&remote_http));
        assert!(key_transport_allowed(&remote_https));
        assert!(key_transport_allowed(&lan_http));
        assert_eq!(
            save_local_key("http://models.example.test", "sk-abcdef"),
            Err(ProviderReason::InsecureRemoteKey)
        );
        assert_eq!(
            origin_of(&validate_local_endpoint("http://127.0.0.1:1234/v1").unwrap()),
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
}
