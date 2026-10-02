use chrono::Local;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const DAEMON_POLL_MS: u64 = 750;
const BUSY_HEARTBEAT_SECS: u64 = 10;
const IDLE_FEED_HEARTBEAT_SECS: u64 = 60;
const DEFAULT_TIMEOUT_SECS: u64 = 900;
const MAX_TIMEOUT_SECS: u64 = 7200;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalControlJob {
    id: String,
    cwd: String,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default = "default_mode")]
    mode: String,
    #[serde(default = "default_timeout")]
    timeout_seconds: u64,
    #[serde(default)]
    require_clean_git: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalControlResult {
    id: String,
    status: String,
    exit_code: Option<i32>,
    started_at: String,
    finished_at: String,
    duration_ms: u128,
    cwd: String,
    command: String,
    mode: String,
    log_path: String,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalControlState {
    daemon_pid: u32,
    status: String,
    current_job_id: Option<String>,
    last_completed_job_id: Option<String>,
    heartbeat_at: String,
    control_root: String,
}

fn default_mode() -> String {
    "read_only".to_string()
}

fn default_timeout() -> u64 {
    DEFAULT_TIMEOUT_SECS
}

fn now() -> String {
    Local::now().to_rfc3339()
}

fn control_root() -> Result<PathBuf, String> {
    super::app_support_dir()
        .map(|p| p.join("control"))
        .map_err(|e| format!("Local Control: App-Support-Pfad nicht verfuegbar: {e:#}"))
}

fn ensure_dirs(root: &Path) -> Result<(), String> {
    for name in ["inbox", "running", "outbox", "archive", "logs"] {
        fs::create_dir_all(root.join(name))
            .map_err(|e| format!("Local Control: {name} konnte nicht erstellt werden: {e}"))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Local Control: Rechte konnten nicht gehaertet werden: {e}"))?;
        for name in ["inbox", "running", "outbox", "archive", "logs"] {
            fs::set_permissions(root.join(name), fs::Permissions::from_mode(0o700)).map_err(
                |e| {
                    format!("Local Control: Rechte fuer {name} konnten nicht gehaertet werden: {e}")
                },
            )?;
        }
    }
    Ok(())
}

fn atomic_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|e| format!("Local Control: JSON konnte nicht serialisiert werden: {e}"))?;
    fs::write(&tmp, bytes).map_err(|e| format!("Local Control: temp write fehlgeschlagen: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("Local Control: atomarer write fehlgeschlagen: {e}"))
}

fn append_feed(root: &Path, message: &str) -> Result<(), String> {
    let path = root.join("feed.log");
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Local Control: feed.log nicht schreibbar: {e}"))?;
    writeln!(f, "{} {}", now(), message)
        .map_err(|e| format!("Local Control: feed.log write fehlgeschlagen: {e}"))
}

fn write_state(
    root: &Path,
    status: &str,
    current_job_id: Option<&str>,
    last_completed_job_id: Option<&str>,
) -> Result<(), String> {
    atomic_json(
        &root.join("state.json"),
        &LocalControlState {
            daemon_pid: std::process::id(),
            status: status.to_string(),
            current_job_id: current_job_id.map(str::to_string),
            last_completed_job_id: last_completed_job_id.map(str::to_string),
            heartbeat_at: now(),
            control_root: root.to_string_lossy().to_string(),
        },
    )
}

fn validate_job_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 96
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err("Local Control: ungueltige Job-ID.".to_string());
    }
    Ok(())
}

fn allowed_cwd(cwd: &Path) -> Result<(), String> {
    let canonical = cwd
        .canonicalize()
        .map_err(|e| format!("Local Control: cwd existiert nicht: {e}"))?;
    if !canonical.is_dir() {
        return Err("Local Control: cwd ist kein Verzeichnis.".to_string());
    }
    let home = dirs::home_dir().ok_or_else(|| "Local Control: Home fehlt.".to_string())?;
    let dev = PathBuf::from("/Volumes/DevSSD/Projects");
    if canonical.starts_with(&home) || (dev.exists() && canonical.starts_with(&dev)) {
        Ok(())
    } else {
        Err(format!(
            "Local Control: cwd liegt ausserhalb der lokalen Projektwurzeln: {}",
            canonical.display()
        ))
    }
}

fn command_basename(command: &str) -> &str {
    Path::new(command)
        .file_name()
        .and_then(|x| x.to_str())
        .unwrap_or(command)
}

fn validate_command(job: &LocalControlJob) -> Result<(), String> {
    let mode = job.mode.as_str();
    if !matches!(mode, "read_only" | "workspace_write") {
        return Err("Local Control: mode muss read_only oder workspace_write sein.".to_string());
    }

    let base = command_basename(&job.command);
    let denied = [
        "sudo",
        "su",
        "rm",
        "dd",
        "diskutil",
        "mkfs",
        "shutdown",
        "reboot",
        "halt",
        "killall",
        "launchctl",
        "bash",
        "sh",
        "zsh",
        "fish",
    ];
    if denied.contains(&base) {
        return Err(format!(
            "Local Control: Kommando {base} ist im Bridge-Daemon gesperrt."
        ));
    }

    let common = [
        "git",
        "gh",
        "npm",
        "npx",
        "pnpm",
        "yarn",
        "cargo",
        "rustc",
        "python3",
        "node",
        "gcloud",
        "wrangler",
        "supabase",
        "xcodebuild",
        "swift",
        "blender",
        "ls",
        "cat",
        "find",
        "grep",
        "rg",
        "sed",
        "head",
        "tail",
        "stat",
        "pwd",
        "which",
        "shasum",
        "jq",
        "wc",
        "mkdir",
        "cp",
        "mv",
        "touch",
        "curl",
    ];
    if !common.contains(&base) {
        return Err(format!(
            "Local Control: Kommando {base} ist noch nicht in der lokalen Allowlist."
        ));
    }

    if mode == "read_only" {
        match base {
            "mkdir" | "cp" | "mv" | "touch" | "npm" | "npx" | "pnpm" | "yarn" | "cargo"
            | "python3" | "node" | "gcloud" | "wrangler" | "supabase" | "xcodebuild" | "swift"
            | "blender" => {
                return Err(format!(
                    "Local Control: {base} benoetigt mode=workspace_write."
                ));
            }
            "git" => {
                let sub = job.args.first().map(String::as_str).unwrap_or("");
                let allowed = [
                    "status",
                    "diff",
                    "log",
                    "show",
                    "rev-parse",
                    "ls-files",
                    "ls-tree",
                    "merge-base",
                    "cherry",
                    "remote",
                    "tag",
                ];
                if !allowed.contains(&sub) {
                    return Err(format!(
                        "Local Control: git {sub} ist im read_only-Modus nicht erlaubt."
                    ));
                }
            }
            "gh" => {
                let sub = job.args.first().map(String::as_str).unwrap_or("");
                if !matches!(sub, "pr" | "run" | "repo" | "issue") {
                    return Err(format!(
                        "Local Control: gh {sub} ist im read_only-Modus nicht erlaubt."
                    ));
                }
                if job.args.iter().any(|a| {
                    matches!(
                        a.as_str(),
                        "merge" | "close" | "create" | "edit" | "delete" | "rerun" | "cancel"
                    )
                }) {
                    return Err(
                        "Local Control: mutierende gh-Aktion braucht workspace_write.".to_string(),
                    );
                }
            }
            "curl" => {
                if job.args.iter().any(|a| {
                    matches!(
                        a.as_str(),
                        "-X" | "--request" | "-d" | "--data" | "--data-raw" | "--form"
                    )
                }) {
                    return Err(
                        "Local Control: schreibender curl-Aufruf braucht workspace_write."
                            .to_string(),
                    );
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn git_clean_if_required(job: &LocalControlJob) -> Result<(), String> {
    if !job.require_clean_git {
        return Ok(());
    }
    let out = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&job.cwd)
        .output()
        .map_err(|e| format!("Local Control: git status fehlgeschlagen: {e}"))?;
    if !out.status.success() {
        return Err(
            "Local Control: requireCleanGit gesetzt, cwd ist aber kein lesbares Git-Repo."
                .to_string(),
        );
    }
    if !out.stdout.is_empty() {
        return Err(
            "Local Control: requireCleanGit verletzt; Worktree ist nicht sauber.".to_string(),
        );
    }
    Ok(())
}

fn child_path() -> String {
    let existing = std::env::var("PATH").unwrap_or_default();
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let preferred = format!(
        "{home}/.cargo/bin:{home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    );
    if existing.is_empty() {
        preferred
    } else {
        format!("{preferred}:{existing}")
    }
}

fn execute_job(root: &Path, job: &LocalControlJob) -> LocalControlResult {
    let started = Instant::now();
    let started_at = now();
    let log_path = root.join("logs").join(format!("{}.log", job.id));
    let mut result = LocalControlResult {
        id: job.id.clone(),
        status: "failed".to_string(),
        exit_code: None,
        started_at,
        finished_at: String::new(),
        duration_ms: 0,
        cwd: job.cwd.clone(),
        command: command_basename(&job.command).to_string(),
        mode: job.mode.clone(),
        log_path: log_path.to_string_lossy().to_string(),
        error: None,
    };

    let validation = validate_job_id(&job.id)
        .and_then(|_| allowed_cwd(Path::new(&job.cwd)))
        .and_then(|_| validate_command(job))
        .and_then(|_| git_clean_if_required(job));

    if let Err(e) = validation {
        result.error = Some(e);
        result.finished_at = now();
        result.duration_ms = started.elapsed().as_millis();
        return result;
    }

    let timeout_secs = job.timeout_seconds.clamp(1, MAX_TIMEOUT_SECS);
    let out = match OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&log_path)
    {
        Ok(f) => f,
        Err(e) => {
            result.error = Some(format!("Local Control: Job-Log nicht erstellbar: {e}"));
            result.finished_at = now();
            result.duration_ms = started.elapsed().as_millis();
            return result;
        }
    };
    let err = match out.try_clone() {
        Ok(f) => f,
        Err(e) => {
            result.error = Some(format!("Local Control: Job-Log clone fehlgeschlagen: {e}"));
            result.finished_at = now();
            result.duration_ms = started.elapsed().as_millis();
            return result;
        }
    };

    let mut child = match Command::new(&job.command)
        .args(&job.args)
        .current_dir(&job.cwd)
        .env("PATH", child_path())
        .stdin(Stdio::null())
        .stdout(Stdio::from(out))
        .stderr(Stdio::from(err))
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            result.error = Some(format!("Local Control: Prozessstart fehlgeschlagen: {e}"));
            result.finished_at = now();
            result.duration_ms = started.elapsed().as_millis();
            return result;
        }
    };

    let mut last_heartbeat = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                result.exit_code = status.code();
                result.status = if status.success() {
                    "completed".to_string()
                } else {
                    "failed".to_string()
                };
                if !status.success() {
                    result.error = Some(format!(
                        "Local Control: Prozess exit={}.",
                        status
                            .code()
                            .map(|x| x.to_string())
                            .unwrap_or_else(|| "signal".to_string())
                    ));
                }
                break;
            }
            Ok(None) => {}
            Err(e) => {
                let _ = child.kill();
                result.error = Some(format!("Local Control: Prozessstatus fehlgeschlagen: {e}"));
                break;
            }
        }

        if started.elapsed() >= Duration::from_secs(timeout_secs) {
            let _ = child.kill();
            let _ = child.wait();
            result.status = "timeout".to_string();
            result.error = Some(format!(
                "Local Control: Timeout nach {timeout_secs}s; Prozess beendet."
            ));
            break;
        }

        if last_heartbeat.elapsed() >= Duration::from_secs(BUSY_HEARTBEAT_SECS) {
            let _ = write_state(root, "busy", Some(&job.id), None);
            let _ = append_feed(
                root,
                &format!(
                    "BUSY job={} cmd={} elapsed={}s",
                    job.id,
                    command_basename(&job.command),
                    started.elapsed().as_secs()
                ),
            );
            last_heartbeat = Instant::now();
        }
        thread::sleep(Duration::from_millis(250));
    }

    result.finished_at = now();
    result.duration_ms = started.elapsed().as_millis();
    result
}

fn process_job_file(root: &Path, inbox_path: &Path) -> Result<String, String> {
    let file_name = inbox_path
        .file_name()
        .and_then(|x| x.to_str())
        .ok_or_else(|| "Local Control: ungueltiger Inbox-Dateiname.".to_string())?;
    let running_path = root.join("running").join(file_name);
    fs::rename(inbox_path, &running_path)
        .map_err(|e| format!("Local Control: Job konnte nicht atomar uebernommen werden: {e}"))?;

    let raw = fs::read_to_string(&running_path)
        .map_err(|e| format!("Local Control: Job nicht lesbar: {e}"))?;
    let job: LocalControlJob = serde_json::from_str(&raw)
        .map_err(|e| format!("Local Control: Job-JSON ungueltig: {e}"))?;

    write_state(root, "busy", Some(&job.id), None)?;
    append_feed(
        root,
        &format!(
            "START job={} mode={} cwd={} cmd={} args={}",
            job.id,
            job.mode,
            job.cwd,
            command_basename(&job.command),
            job.args.len()
        ),
    )?;

    let result = execute_job(root, &job);
    atomic_json(
        &root.join("outbox").join(format!("{}.json", job.id)),
        &result,
    )?;

    let archive_path = root.join("archive").join(file_name);
    let _ = fs::rename(&running_path, archive_path);
    append_feed(
        root,
        &format!(
            "DONE job={} status={} exit={:?} durationMs={} log={}",
            result.id, result.status, result.exit_code, result.duration_ms, result.log_path
        ),
    )?;
    Ok(result.id)
}

fn claim_daemon(root: &Path) -> Result<PathBuf, String> {
    let pid_path = root.join("daemon.pid");
    if let Ok(raw) = fs::read_to_string(&pid_path) {
        if let Ok(pid) = raw.trim().parse::<u32>() {
            let alive = Command::new("kill")
                .args(["-0", &pid.to_string()])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if alive {
                return Err(format!(
                    "Local Control: Daemon laeuft bereits mit PID {pid}."
                ));
            }
        }
        let _ = fs::remove_file(&pid_path);
    }
    fs::write(&pid_path, format!("{}\n", std::process::id()))
        .map_err(|e| format!("Local Control: daemon.pid nicht schreibbar: {e}"))?;
    Ok(pid_path)
}

pub fn run_daemon() -> Result<(), String> {
    let root = control_root()?;
    ensure_dirs(&root)?;
    let pid_path = claim_daemon(&root)?;
    append_feed(&root, &format!("DAEMON_START pid={}", std::process::id()))?;

    let mut last_completed: Option<String> = None;
    let mut last_idle_feed = Instant::now()
        .checked_sub(Duration::from_secs(IDLE_FEED_HEARTBEAT_SECS))
        .unwrap_or_else(Instant::now);

    loop {
        write_state(&root, "idle", None, last_completed.as_deref())?;

        let mut jobs: Vec<PathBuf> = fs::read_dir(root.join("inbox"))
            .map_err(|e| format!("Local Control: Inbox nicht lesbar: {e}"))?
            .filter_map(|e| e.ok().map(|x| x.path()))
            .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("json"))
            .collect();
        jobs.sort();

        if let Some(job_path) = jobs.first() {
            match process_job_file(&root, job_path) {
                Ok(id) => last_completed = Some(id),
                Err(e) => {
                    let _ = append_feed(&root, &format!("ERROR {e}"));
                    if let Some(name) = job_path.file_name() {
                        let failed = root.join("outbox").join(name);
                        let _ = fs::write(
                            failed,
                            serde_json::to_vec_pretty(&serde_json::json!({
                                "status": "failed",
                                "error": e,
                                "finishedAt": now()
                            }))
                            .unwrap_or_default(),
                        );
                    }
                }
            }
            continue;
        }

        if last_idle_feed.elapsed() >= Duration::from_secs(IDLE_FEED_HEARTBEAT_SECS) {
            append_feed(&root, "HEARTBEAT status=idle")?;
            last_idle_feed = Instant::now();
        }
        thread::sleep(Duration::from_millis(DAEMON_POLL_MS));

        if !pid_path.exists() {
            return Err("Local Control: daemon.pid wurde entfernt; Daemon stoppt.".to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(command: &str, args: &[&str], mode: &str) -> LocalControlJob {
        LocalControlJob {
            id: "test-job-1".to_string(),
            cwd: dirs::home_dir().unwrap().to_string_lossy().to_string(),
            command: command.to_string(),
            args: args.iter().map(|x| x.to_string()).collect(),
            mode: mode.to_string(),
            timeout_seconds: 30,
            require_clean_git: false,
        }
    }

    #[test]
    fn read_only_git_status_is_allowed() {
        assert!(validate_command(&job("git", &["status", "--short"], "read_only")).is_ok());
    }

    #[test]
    fn read_only_git_checkout_is_blocked() {
        let err = validate_command(&job("git", &["checkout", "main"], "read_only"))
            .expect_err("checkout must be blocked");
        assert!(err.contains("read_only"));
    }

    #[test]
    fn shell_entry_is_blocked_even_for_workspace_write() {
        let err = validate_command(&job("zsh", &["-lc", "echo unsafe"], "workspace_write"))
            .expect_err("shell entry must be blocked");
        assert!(err.contains("gesperrt"));
    }

    #[test]
    fn workspace_write_allows_structured_git_mutation() {
        assert!(validate_command(&job("git", &["fetch", "origin"], "workspace_write")).is_ok());
    }

    #[test]
    fn invalid_job_id_is_rejected() {
        assert!(validate_job_id("../escape").is_err());
        assert!(validate_job_id("safe-job_123").is_ok());
    }
}
