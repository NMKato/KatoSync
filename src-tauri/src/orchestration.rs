// Created by NMKato Solutions
//! Read-only Adapter fuer die externen Orchestrierungsvertraege im Local-Control-Root:
//! Provider-Health-Scheduler, Continuation-Watchdog, Fallback-Queue des Provider-Routers und
//! Lease/Heartbeat des Remote Orchestrators (+ RDC-Transport). Jeder Lesezugriff ist begrenzt;
//! absolute Pfade verlassen dieses Modul nie (nur Worktree-Basename und redigierte Texte).

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const MAX_FILE_BYTES: u64 = 64 * 1024;
const MAX_LOG_TAIL_BYTES: u64 = 64 * 1024;
const MAX_QUEUE_FILES: usize = 200;
const MAX_FALLBACK_ITEMS: usize = 40;
const MAX_BRANCH_PROBES: usize = 8;
const BRANCH_CACHE_TTL: Duration = Duration::from_secs(20);
const MAX_TEXT: usize = 160;
const MAX_EVIDENCE: usize = 12;
const MIN_LEASE_SECS: i64 = 30;
const MAX_LEASE_SECS: i64 = 1800;
const DEFAULT_LEASE_SECS: i64 = 300;
// Heartbeats weiter in der Zukunft sind Uhr-/Schreibfehler und begruenden keine Lease.
const MAX_FUTURE_SKEW_SECS: i64 = 120;

/// Lease-Datei des Remote Orchestrators (Schema siehe docs/ARCHITECTURE.md).
pub const REMOTE_ORCHESTRATOR_FILE: &str = "remote-orchestrator.json";
const REMOTE_ORCHESTRATOR_SCHEMA: u64 = 1;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationSnapshot {
    pub provider_health: Option<ProviderHealthSnapshot>,
    pub continuation: Option<ContinuationSnapshot>,
    pub remote_orchestrator: Option<RemoteOrchestratorSnapshot>,
    pub fallback_jobs: Vec<FallbackJobSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealthEntry {
    provider: String,
    installed: bool,
    authenticated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeInFlight {
    name: String,
    started_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealthSnapshot {
    checked_at: Option<String>,
    providers: Vec<ProviderHealthEntry>,
    waiting_fallback_jobs: u64,
    control_idle: bool,
    note: Option<String>,
    last_event_at: Option<String>,
    resume_in_flight: Option<ResumeInFlight>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinuationSnapshot {
    plan_id: String,
    enabled: bool,
    status: String,
    cursor: u64,
    wave_count: u64,
    active_job_id: Option<String>,
    active_wave_name: Option<String>,
    last_result_status: Option<String>,
    last_result_wave: Option<String>,
    updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteOrchestratorSnapshot {
    session_id: String,
    state: String,
    transport: Option<String>,
    attached_at: Option<String>,
    heartbeat_at: String,
    lease_seconds: i64,
    lease_expires_at: String,
    transport_heartbeat_at: Option<String>,
    job_id: Option<String>,
    device: Option<String>,
    model: Option<String>,
    activity: Option<String>,
    next_step: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FallbackProviderState {
    provider: String,
    state: String,
    exit_code: Option<i64>,
    retry_at: Option<String>,
    retry_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceEntry {
    key: String,
    value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FallbackJobSnapshot {
    id: String,
    name: String,
    branch: Option<String>,
    worktree: Option<String>,
    status: String,
    reason: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    completed_at: Option<String>,
    failed_at: Option<String>,
    timeout_seconds: Option<u64>,
    active_provider: Option<String>,
    lease_owner: Option<String>,
    lease_expires_at: Option<String>,
    provider_states: Vec<FallbackProviderState>,
    evidence: Vec<EvidenceEntry>,
    /// `Some(true)` nur, wenn der Worktree nachweislich auf dem erwarteten Branch steht.
    branch_matches: Option<bool>,
    /// Ein aktiver Local-Control-Writer arbeitet im selben Worktree.
    worktree_busy: bool,
}

/// Liest alle Orchestrierungsquellen. `active_cwds` sind kanonische Worktree-Pfade aktiver
/// Local-Control-Lanes; sie bleiben im Backend und werden nur fuer `worktree_busy` verglichen.
pub fn snapshot(root: &Path, active_cwds: &[String]) -> OrchestrationSnapshot {
    let home = dirs::home_dir();
    OrchestrationSnapshot {
        provider_health: provider_health(root, home.as_deref()),
        continuation: continuation(root, home.as_deref()),
        remote_orchestrator: remote_orchestrator(root, home.as_deref()),
        fallback_jobs: fallback_jobs(root, home.as_deref(), active_cwds),
    }
}

// ---------------------------------------------------------------------------------------------
// Begrenztes Lesen + Redaction
// ---------------------------------------------------------------------------------------------

fn read_bounded(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&read_bounded(path)?).ok()
}

fn read_tail(path: &Path, max: u64) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(max);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.take(max).read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes).to_string();
    // Erste (moeglicherweise angeschnittene) Zeile verwerfen, wenn nicht ab Dateianfang gelesen.
    Some(if start > 0 {
        text.split_once('\n')
            .map(|(_, rest)| rest.to_string())
            .unwrap_or_default()
    } else {
        text
    })
}

fn home_pattern() -> Option<&'static regex::Regex> {
    static RE: OnceLock<Option<regex::Regex>> = OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(r"(?i)/(?:Users|home)/[^/\s]+|[A-Z]:\\Users\\[^\\\s]+").ok()
    })
    .as_ref()
}

fn redact_text(value: &str, home: Option<&Path>) -> String {
    let mut text = value.replace(['\r', '\n', '\t'], " ");
    if let Some(home) = home
        .and_then(|path| path.to_str())
        .filter(|path| path.len() > 1)
    {
        text = text.replace(home, "~");
    }
    if let Some(re) = home_pattern() {
        text = re.replace_all(&text, "~").to_string();
    }
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_TEXT)
        .collect()
}

fn text(value: &Value, key: &str, home: Option<&Path>) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(|raw| redact_text(raw, home))
        .filter(|raw| !raw.is_empty())
}

fn timestamp(value: &Value, key: &str) -> Option<String> {
    let raw = value.get(key)?.as_str()?;
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|at| at.with_timezone(&Utc).to_rfc3339())
}

fn safe_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
}

// ---------------------------------------------------------------------------------------------
// Provider-Health-Scheduler (provider-health.json + provider-health.log)
// ---------------------------------------------------------------------------------------------

fn provider_health(root: &Path, home: Option<&Path>) -> Option<ProviderHealthSnapshot> {
    let json = read_json(&root.join("provider-health.json"));
    let tail = read_tail(&root.join("provider-health.log"), MAX_LOG_TAIL_BYTES);
    if json.is_none() && tail.is_none() {
        return None;
    }
    let mut providers = json
        .as_ref()
        .and_then(|value| value.get("providers"))
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .filter(|(name, _)| safe_id(name))
                .map(|(name, entry)| ProviderHealthEntry {
                    provider: name.clone(),
                    installed: entry.get("installed").and_then(Value::as_bool) == Some(true),
                    authenticated: entry.get("authenticated").and_then(Value::as_bool)
                        == Some(true),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    providers.sort_by(|a, b| a.provider.cmp(&b.provider));
    let (last_event_at, resume_in_flight) = tail
        .as_deref()
        .map(parse_health_log)
        .unwrap_or((None, None));
    Some(ProviderHealthSnapshot {
        checked_at: json
            .as_ref()
            .and_then(|value| timestamp(value, "checkedAt")),
        providers,
        waiting_fallback_jobs: json
            .as_ref()
            .and_then(|value| value.get("waitingFallbackJobs"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
        control_idle: json
            .as_ref()
            .and_then(|value| value.get("controlIdle"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        note: json.as_ref().and_then(|value| text(value, "note", home)),
        last_event_at,
        resume_in_flight,
    })
}

/// `RESUME name=X` ohne spaeteres `RESUME_DONE name=X` ist eine laufende Wiederaufnahme.
fn parse_health_log(tail: &str) -> (Option<String>, Option<ResumeInFlight>) {
    let mut last_event_at = None;
    let mut open: Option<ResumeInFlight> = None;
    for line in tail.lines() {
        let mut parts = line.split_whitespace();
        let (Some(at), Some(kind)) = (parts.next(), parts.next()) else {
            continue;
        };
        let Ok(at) = DateTime::parse_from_rfc3339(at) else {
            continue;
        };
        let at = at.with_timezone(&Utc).to_rfc3339();
        last_event_at = Some(at.clone());
        let name = parts
            .find_map(|part| part.strip_prefix("name="))
            .filter(|name| safe_id(name))
            .map(str::to_string);
        match (kind, name) {
            ("RESUME", Some(name)) => {
                open = Some(ResumeInFlight {
                    name,
                    started_at: at,
                })
            }
            ("RESUME_DONE", Some(name))
                if open.as_ref().is_some_and(|entry| entry.name == name) =>
            {
                open = None;
            }
            _ => {}
        }
    }
    (last_event_at, open)
}

// ---------------------------------------------------------------------------------------------
// Continuation-Watchdog (continuation/plan.json + state.json)
// ---------------------------------------------------------------------------------------------

fn continuation(root: &Path, home: Option<&Path>) -> Option<ContinuationSnapshot> {
    let dir = root.join("continuation");
    let state = read_json(&dir.join("state.json"))?;
    let plan = read_json(&dir.join("plan.json"));
    let plan_id = text(&state, "planId", home)?;
    let same_plan = plan
        .as_ref()
        .and_then(|value| value.get("planId"))
        .and_then(Value::as_str)
        .is_some_and(|id| redact_text(id, home) == plan_id);
    let last = state.get("lastResult");
    Some(ContinuationSnapshot {
        enabled: same_plan
            && plan
                .as_ref()
                .and_then(|value| value.get("enabled"))
                .and_then(Value::as_bool)
                == Some(true),
        wave_count: if same_plan {
            plan.as_ref()
                .and_then(|value| value.get("waves"))
                .and_then(Value::as_array)
                .map(|waves| waves.len() as u64)
                .unwrap_or(0)
        } else {
            0
        },
        status: text(&state, "status", home).unwrap_or_else(|| "unknown".to_string()),
        cursor: state.get("cursor").and_then(Value::as_u64).unwrap_or(0),
        active_job_id: text(&state, "activeJobId", home),
        active_wave_name: text(&state, "activeWaveName", home),
        last_result_status: last.and_then(|value| text(value, "status", home)),
        last_result_wave: last.and_then(|value| text(value, "waveName", home)),
        updated_at: timestamp(&state, "updatedAt"),
        plan_id,
    })
}

// ---------------------------------------------------------------------------------------------
// Remote Orchestrator + RDC Lease (remote-orchestrator.json)
// ---------------------------------------------------------------------------------------------

fn remote_orchestrator(root: &Path, home: Option<&Path>) -> Option<RemoteOrchestratorSnapshot> {
    let value = read_json(&root.join(REMOTE_ORCHESTRATOR_FILE))?;
    parse_remote_orchestrator(&value, home, Utc::now())
}

fn parse_remote_orchestrator(
    value: &Value,
    home: Option<&Path>,
    now: DateTime<Utc>,
) -> Option<RemoteOrchestratorSnapshot> {
    if value.get("schemaVersion").and_then(Value::as_u64) != Some(REMOTE_ORCHESTRATOR_SCHEMA) {
        return None;
    }
    let session_id = value
        .get("sessionId")
        .and_then(Value::as_str)
        .filter(|id| safe_id(id))?
        .to_string();
    let state = value.get("state").and_then(Value::as_str)?;
    if !matches!(state, "attached" | "working" | "detached") {
        return None;
    }
    let heartbeat = DateTime::parse_from_rfc3339(value.get("heartbeatAt")?.as_str()?).ok()?;
    let lease_seconds = value
        .get("leaseSeconds")
        .and_then(Value::as_i64)
        .unwrap_or(DEFAULT_LEASE_SECS)
        .clamp(MIN_LEASE_SECS, MAX_LEASE_SECS);
    let heartbeat = heartbeat.with_timezone(&Utc);
    if heartbeat - now > ChronoDuration::seconds(MAX_FUTURE_SKEW_SECS) {
        return None;
    }
    let transport = value
        .get("transport")
        .and_then(Value::as_object)
        .map(|entry| Value::Object(entry.clone()));
    Some(RemoteOrchestratorSnapshot {
        session_id,
        state: state.to_string(),
        transport: transport
            .as_ref()
            .and_then(|entry| entry.get("kind"))
            .and_then(Value::as_str)
            .filter(|kind| *kind == "rdc")
            .map(str::to_string),
        transport_heartbeat_at: transport
            .as_ref()
            .and_then(|entry| timestamp(entry, "heartbeatAt")),
        attached_at: timestamp(value, "attachedAt"),
        heartbeat_at: heartbeat.to_rfc3339(),
        lease_seconds,
        lease_expires_at: (heartbeat + ChronoDuration::seconds(lease_seconds)).to_rfc3339(),
        job_id: value
            .get("jobId")
            .and_then(Value::as_str)
            .filter(|id| safe_id(id))
            .map(str::to_string),
        device: text(value, "device", home),
        model: text(value, "model", home),
        activity: text(value, "activity", home),
        next_step: text(value, "nextStep", home),
    })
}

// ---------------------------------------------------------------------------------------------
// Fallback-Queue des Provider-Routers (rdc-fallback/*.json)
// ---------------------------------------------------------------------------------------------

fn approved_repo(repo: &Path, home: Option<&Path>) -> Option<PathBuf> {
    if !repo.is_absolute() {
        return None;
    }
    let canonical = repo.canonicalize().ok()?;
    let dev = Path::new("/Volumes/DevSSD/Projects");
    let allowed =
        home.is_some_and(|home| canonical.starts_with(home)) || canonical.starts_with(dev);
    (allowed && canonical.is_dir()).then_some(canonical)
}

type BranchCache = Mutex<HashMap<PathBuf, (Instant, Option<String>)>>;

fn branch_cache() -> &'static BranchCache {
    static CACHE: OnceLock<BranchCache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Aktueller Branch eines Worktrees; 20 s gecacht, weil der Monitor alle 2 s pollt.
fn current_branch(repo: &Path) -> Option<String> {
    if let Ok(cache) = branch_cache().lock() {
        if let Some((at, branch)) = cache.get(repo) {
            if at.elapsed() < BRANCH_CACHE_TTL {
                return branch.clone();
            }
        }
    }
    let branch = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["branch", "--show-current"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|branch| !branch.is_empty());
    if let Ok(mut cache) = branch_cache().lock() {
        cache.insert(repo.to_path_buf(), (Instant::now(), branch.clone()));
    }
    branch
}

fn provider_states(value: &Value, home: Option<&Path>) -> Vec<FallbackProviderState> {
    value
        .get("providerStates")
        .and_then(Value::as_array)
        .map(|states| {
            states
                .iter()
                .take(8)
                .filter_map(|entry| {
                    let provider = entry.get("provider")?.as_str().filter(|id| safe_id(id))?;
                    let state = entry.get("state")?.as_str().filter(|id| safe_id(id))?;
                    Some(FallbackProviderState {
                        provider: provider.to_string(),
                        state: state.to_string(),
                        exit_code: entry.get("exitCode").and_then(Value::as_i64),
                        retry_at: timestamp(entry, "retryAt"),
                        retry_hint: text(entry, "retryHint", home),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn evidence(value: &Value, home: Option<&Path>) -> Vec<EvidenceEntry> {
    value
        .get("evidence")
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .filter(|(key, _)| safe_id(key))
                .filter_map(|(key, entry)| {
                    let value = match entry {
                        Value::String(raw) => redact_text(raw, home),
                        Value::Bool(flag) => flag.to_string(),
                        Value::Number(number) => number.to_string(),
                        _ => return None,
                    };
                    Some(EvidenceEntry {
                        key: key.clone(),
                        value,
                    })
                })
                .take(MAX_EVIDENCE)
                .collect()
        })
        .unwrap_or_default()
}

fn fallback_jobs(
    root: &Path,
    home: Option<&Path>,
    active_cwds: &[String],
) -> Vec<FallbackJobSnapshot> {
    let Ok(entries) = fs::read_dir(root.join("rdc-fallback")) else {
        return Vec::new();
    };
    let mut items = entries
        .filter_map(|entry| entry.ok().map(|value| value.path()))
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
        .take(MAX_QUEUE_FILES)
        .filter_map(|path| read_json(&path))
        .collect::<Vec<_>>();
    items.sort_by_key(|item| {
        std::cmp::Reverse(
            item.get("createdAt")
                .and_then(Value::as_str)
                .and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())
                .map(|at| at.timestamp())
                .unwrap_or(0),
        )
    });
    let mut probes = 0;
    items
        .into_iter()
        .take(MAX_FALLBACK_ITEMS)
        .filter_map(|item| {
            let id = item
                .get("id")?
                .as_str()
                .filter(|id| safe_id(id))?
                .to_string();
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| safe_id(name))
                .unwrap_or(&id)
                .to_string();
            let status = item
                .get("status")
                .and_then(Value::as_str)
                .filter(|status| safe_id(status))
                .unwrap_or("unknown")
                .to_string();
            let branch = text(&item, "branch", home);
            let repo = item
                .get("repo")
                .and_then(Value::as_str)
                .and_then(|raw| approved_repo(Path::new(raw), home));
            let open = matches!(
                status.as_str(),
                "waiting"
                    | "provider_ready"
                    | "retry_wait"
                    | "implemented"
                    | "verifying"
                    | "review_ready"
                    | "human_gate"
                    | "orchestrator_active"
                    | "running"
            );
            let branch_matches = match (&repo, &branch) {
                (Some(repo), Some(expected)) if open && probes < MAX_BRANCH_PROBES => {
                    probes += 1;
                    current_branch(repo).map(|current| &current == expected)
                }
                _ => None,
            };
            let worktree_busy = repo.as_ref().is_some_and(|repo| {
                active_cwds
                    .iter()
                    .any(|cwd| Path::new(cwd) == repo.as_path())
            });
            Some(FallbackJobSnapshot {
                worktree: repo
                    .as_ref()
                    .and_then(|repo| repo.file_name())
                    .and_then(|value| value.to_str())
                    .map(str::to_string),
                reason: text(&item, "reason", home),
                created_at: timestamp(&item, "createdAt"),
                updated_at: timestamp(&item, "updatedAt"),
                completed_at: timestamp(&item, "completedAt"),
                failed_at: timestamp(&item, "failedAt"),
                timeout_seconds: item.get("timeout").and_then(Value::as_u64),
                active_provider: item
                    .get("activeProvider")
                    .and_then(Value::as_str)
                    .filter(|id| safe_id(id))
                    .map(str::to_string),
                lease_owner: item
                    .get("leaseOwner")
                    .and_then(Value::as_str)
                    .filter(|id| safe_id(id))
                    .map(str::to_string),
                lease_expires_at: timestamp(&item, "leaseExpiresAt"),
                provider_states: provider_states(&item, home),
                evidence: evidence(&item, home),
                branch_matches,
                worktree_busy,
                id,
                name,
                status,
                branch,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "katosync-orchestration-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("continuation")).unwrap();
        fs::create_dir_all(root.join("rdc-fallback")).unwrap();
        root
    }

    #[test]
    fn health_log_tracks_only_unfinished_resume() {
        let log = "2026-10-04T09:42:00+02:00 RESUME name=a branch=x\n\
                   2026-10-04T09:50:00+02:00 RESUME_DONE name=a exit=0\n\
                   2026-10-04T10:00:00+02:00 HEALTH codex=True claude=True queue=1\n\
                   2026-10-04T10:05:00+02:00 RESUME name=b branch=y\n";
        let (last, open) = parse_health_log(log);
        assert_eq!(last.as_deref(), Some("2026-10-04T08:05:00+00:00"));
        let open = open.expect("b is still running");
        assert_eq!(open.name, "b");
        let (_, closed) = parse_health_log(&format!(
            "{log}2026-10-04T10:06:00+02:00 RESUME_DONE name=b exit=75\n"
        ));
        assert!(closed.is_none());
    }

    #[test]
    fn remote_orchestrator_lease_is_validated_and_bounded() {
        let now = DateTime::parse_from_rfc3339("2026-10-04T10:01:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let lease = parse_remote_orchestrator(
            &json!({
                "schemaVersion": 1,
                "sessionId": "rdc-session-1",
                "state": "working",
                "heartbeatAt": "2026-10-04T10:00:00Z",
                "leaseSeconds": 999999,
                "transport": { "kind": "rdc", "heartbeatAt": "2026-10-04T09:59:30Z" },
                "jobId": "job-1",
                "activity": "editing /Users/someone/Projects/x"
            }),
            None,
            now,
        )
        .expect("valid lease");
        assert_eq!(lease.lease_seconds, MAX_LEASE_SECS);
        assert_eq!(lease.lease_expires_at, "2026-10-04T10:30:00+00:00");
        assert_eq!(lease.transport.as_deref(), Some("rdc"));
        assert_eq!(lease.activity.as_deref(), Some("editing ~/Projects/x"));
        for invalid in [
            json!({ "schemaVersion": 2, "sessionId": "s", "state": "attached", "heartbeatAt": "2026-10-04T10:00:00Z" }),
            json!({ "schemaVersion": 1, "sessionId": "s", "state": "sleeping", "heartbeatAt": "2026-10-04T10:00:00Z" }),
            json!({ "schemaVersion": 1, "sessionId": "../x", "state": "attached", "heartbeatAt": "2026-10-04T10:00:00Z" }),
            json!({ "schemaVersion": 1, "sessionId": "s", "state": "attached", "heartbeatAt": "yesterday" }),
            json!({ "schemaVersion": 1, "sessionId": "s", "state": "attached", "heartbeatAt": "2026-10-04T10:05:00Z" }),
        ] {
            assert!(parse_remote_orchestrator(&invalid, None, now).is_none());
        }
    }

    #[test]
    fn snapshot_reads_contracts_without_leaking_paths() {
        let root = temp_root("snapshot");
        let home = dirs::home_dir().unwrap();
        fs::write(
            root.join("provider-health.json"),
            json!({
                "checkedAt": "2026-10-04T14:10:15+02:00",
                "providers": { "codex": { "installed": true, "authenticated": true } },
                "waitingFallbackJobs": 1,
                "controlIdle": true
            })
            .to_string(),
        )
        .unwrap();
        fs::write(
            root.join("continuation/plan.json"),
            json!({ "planId": "p1", "enabled": true, "waves": [{}, {}] }).to_string(),
        )
        .unwrap();
        fs::write(
            root.join("continuation/state.json"),
            json!({ "planId": "p1", "status": "running", "cursor": 1, "activeJobId": "j1", "activeWaveName": "w2" })
                .to_string(),
        )
        .unwrap();
        fs::write(
            root.join("rdc-fallback/1-job.json"),
            json!({
                "id": "1-job",
                "name": "job",
                "createdAt": "2026-10-04T14:12:00+02:00",
                "repo": home.join("definitely-missing-katosync-worktree").to_string_lossy(),
                "branch": "feat/x",
                "status": "waiting",
                "reason": "codex_usage_limit",
                "providerStates": [{ "provider": "codex", "state": "quota_limited", "retryAt": "2026-10-04T16:00:00Z" }],
                "evidence": { "worktree": format!("{}/Projects/x", home.display()), "npmTests": "20 passed" }
            })
            .to_string(),
        )
        .unwrap();

        let snapshot = snapshot(&root, &[]);
        let serialized = serde_json::to_string(&snapshot).unwrap();
        assert!(!serialized.contains(home.to_str().unwrap()));
        let health = snapshot.provider_health.unwrap();
        assert_eq!(health.waiting_fallback_jobs, 1);
        assert!(health.providers[0].authenticated);
        let continuation = snapshot.continuation.unwrap();
        assert!(continuation.enabled);
        assert_eq!(continuation.wave_count, 2);
        let job = &snapshot.fallback_jobs[0];
        assert_eq!(job.status, "waiting");
        assert_eq!(job.worktree, None, "missing worktree is never proven");
        assert_eq!(job.branch_matches, None);
        assert_eq!(
            job.provider_states[0].retry_at.as_deref(),
            Some("2026-10-04T16:00:00+00:00")
        );
        assert!(job
            .evidence
            .iter()
            .any(|entry| entry.value == "~/Projects/x"));
        assert!(snapshot.remote_orchestrator.is_none());
        let _ = fs::remove_dir_all(&root);
    }

    /// Manuell: `cargo test --lib live_orchestration_gate -- --ignored --nocapture` liest den echten
    /// Control-Root (nur lesend) und zeigt den redigierten Snapshot.
    #[test]
    #[ignore]
    fn live_orchestration_gate() {
        let root = crate::app_support_dir().unwrap().join("control");
        let snapshot = snapshot(&root, &[]);
        let serialized = serde_json::to_string_pretty(&snapshot).unwrap();
        let home = dirs::home_dir().unwrap();
        assert!(!serialized.contains(home.to_str().unwrap()));
        println!("{serialized}");
    }
}
