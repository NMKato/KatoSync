// Created by NMKato Solutions
//! Agent-Boundary: Policy ausserhalb des Modells fuer Local Control, Agent Runner und Provider-Router.
//!
//! - Repository-Dokumente, Dateinamen, Task-Metadaten, RAG-Chunks und Remote-Jobtext sind Daten. Keine
//!   Funktion in diesem Modul liest sie, um Faehigkeiten, Netz- oder Dateisystem-Scope zu vergeben.
//! - Schreibbare Arbeit nur in registrierten kanonischen Projektwurzeln (Project Registry + explizite
//!   Runner-Zuordnung `projectRepos`) oder in deren verknuepften Git-Worktrees; alles andere fail-closed.
//! - Writer-Ownership ueber Kernel-Locks (flock) plus Identitaetsdatei. Eine (wiederverwendbare) PID ist
//!   nie Beweis fuer Besitz; ein mehrdeutiger Zustand blockiert.
//! - Owned Kindprozesse laufen in einer eigenen Prozessgruppe, die bei Timeout/Abbruch komplett endet.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions, TryLockError},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

pub(crate) const WRITERS_DIR: &str = "writers";
const DAEMON_LOCK_FILE: &str = "daemon.lock";
const LEGACY_DAEMON_PID_FILE: &str = "daemon.pid";
const LOCK_SCHEMA_VERSION: u32 = 1;
const MAX_IDENTITY_BYTES: u64 = 4 * 1024;
const LOCK_RETRIES: u32 = 10;
const LOCK_RETRY_DELAY: Duration = Duration::from_millis(25);

// ===== Registrierter Schreib-Scope =====

#[derive(Debug, Clone, PartialEq, Eq)]
struct RegisteredRoot {
    /// Projekt-IDs/Aliase in Kleinschreibung (Project Registry id/identityKey/aliases, projectRepos-Key).
    keys: Vec<String>,
    /// Kanonischer, existierender Ordner.
    root: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ScopeKind {
    /// Ziel liegt in einer registrierten kanonischen Projektwurzel.
    RegisteredRoot,
    /// Ziel ist ein verknuepfter Git-Worktree (gleiches Common-Dir) eines registrierten Projekts.
    LinkedWorktree,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ScopedTarget {
    /// Kanonischer Zielordner (z. B. cwd).
    pub path: PathBuf,
    /// Kanonische Wurzel des beschreibbaren Bereichs (registrierte Wurzel bzw. Worktree-Toplevel).
    pub scope_root: PathBuf,
    pub kind: ScopeKind,
}

impl ScopedTarget {
    /// Pfad, an dem Writer-Leases haengen: das Git-Toplevel des Ziels (sonst die Scope-Wurzel), damit
    /// Unterordner desselben Worktrees nie parallel geschrieben werden.
    pub(crate) fn writer_key_path(&self) -> PathBuf {
        git_path(&self.path, &["rev-parse", "--show-toplevel"])
            .filter(|top| self.path.starts_with(top))
            .unwrap_or_else(|| self.scope_root.clone())
    }

    /// Prueft einen vom Job uebergebenen Pfad (relativ zum cwd oder absolut) gegen den Scope. Nicht
    /// existierende Ziele werden ueber den naechsten existierenden Elternordner aufgeloest.
    pub(crate) fn contains_path_arg(&self, raw: &str) -> bool {
        let candidate = Path::new(raw);
        if candidate
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
        {
            return false;
        }
        let joined = if candidate.is_absolute() {
            candidate.to_path_buf()
        } else {
            self.path.join(candidate)
        };
        match resolve_existing_prefix(&joined) {
            Some(resolved) => resolved.starts_with(&self.scope_root),
            None => false,
        }
    }
}

/// Loest einen ggf. noch nicht existierenden Pfad ueber seinen naechsten existierenden Vorfahren auf
/// (Symlinks im existierenden Teil werden dabei aufgeloest, damit kein Link aus dem Scope herausfuehrt).
fn resolve_existing_prefix(path: &Path) -> Option<PathBuf> {
    let mut existing = path.to_path_buf();
    let mut rest = Vec::new();
    loop {
        if let Ok(canonical) = existing.canonicalize() {
            let mut resolved = canonical;
            for part in rest.iter().rev() {
                resolved.push(part);
            }
            return Some(resolved);
        }
        let name = existing.file_name()?.to_os_string();
        rest.push(name);
        existing = existing.parent()?.to_path_buf();
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct WriteScope {
    roots: Vec<RegisteredRoot>,
}

impl WriteScope {
    /// Baut den Scope aus (Schluessel, Pfad)-Paaren. Nicht existierende Pfade fallen still heraus;
    /// gleiche Wurzeln werden zusammengefuehrt.
    pub(crate) fn from_entries<I>(entries: I) -> Self
    where
        I: IntoIterator<Item = (Vec<String>, PathBuf)>,
    {
        let mut roots: Vec<RegisteredRoot> = Vec::new();
        for (keys, path) in entries {
            let Ok(root) = path.canonicalize() else {
                continue;
            };
            if !root.is_dir() || root.parent().is_none() {
                continue;
            }
            let keys = keys
                .into_iter()
                .map(|key| key.trim().to_lowercase())
                .filter(|key| !key.is_empty());
            if let Some(existing) = roots.iter_mut().find(|entry| entry.root == root) {
                for key in keys {
                    if !existing.keys.contains(&key) {
                        existing.keys.push(key);
                    }
                }
            } else {
                roots.push(RegisteredRoot {
                    keys: keys.collect(),
                    root,
                });
            }
        }
        Self { roots }
    }

    /// Laedt den Scope aus vertrauenswuerdigem lokalem Zustand: explizite Runner-Zuordnungen
    /// (`projectRepos` in config.json) und Projektwurzeln der Project Registry. Beides schreibt nur die
    /// lokale UI auf Nutzeraktion; Job-/Repo-/RAG-Text kann den Scope nicht erweitern.
    pub(crate) fn load() -> Self {
        let mut entries = Vec::new();
        if let Some(config) = crate::read_config_snapshot() {
            for (key, path) in config.project_repos() {
                entries.push((vec![key.clone()], PathBuf::from(path)));
            }
        }
        if let Some(registry) = crate::app_support_dir()
            .ok()
            .and_then(|dir| read_bounded_json(&dir.join("project-registry.json")))
        {
            entries.extend(registry_entries(&registry));
        }
        Self::from_entries(entries)
    }

    /// Prueft ein Schreibziel. `project_id` (falls gesetzt) muss zu genau dieser Wurzel gehoeren.
    pub(crate) fn resolve(
        &self,
        target: &Path,
        project_id: Option<&str>,
    ) -> Result<ScopedTarget, String> {
        let canonical = target
            .canonicalize()
            .map_err(|_| "Ziel existiert nicht oder ist nicht lesbar.".to_string())?;
        if !canonical.is_dir() {
            return Err("Ziel ist kein Ordner.".to_string());
        }
        let wanted = project_id
            .map(|id| id.trim().to_lowercase())
            .filter(|id| !id.is_empty());
        let candidates: Vec<&RegisteredRoot> = self
            .roots
            .iter()
            .filter(|root| wanted.as_ref().is_none_or(|id| root.keys.contains(id)))
            .collect();
        if candidates.is_empty() {
            return Err(if wanted.is_some() {
                "Projekt-ID ist keiner registrierten Projektwurzel zugeordnet.".to_string()
            } else {
                "Keine registrierte Projektwurzel vorhanden; Schreibzugriff gesperrt.".to_string()
            });
        }
        if let Some(root) = candidates
            .iter()
            .filter(|root| canonical.starts_with(&root.root))
            .max_by_key(|root| root.root.components().count())
        {
            return Ok(ScopedTarget {
                path: canonical,
                scope_root: root.root.clone(),
                kind: ScopeKind::RegisteredRoot,
            });
        }

        // Verknuepfter Worktree: gleiches Git-Common-Dir wie eine registrierte Wurzel.
        let Some(common) = git_path(&canonical, &["rev-parse", "--git-common-dir"]) else {
            return Err("Ziel liegt ausserhalb registrierter Projektwurzeln.".to_string());
        };
        let Some(toplevel) = git_path(&canonical, &["rev-parse", "--show-toplevel"]) else {
            return Err("Worktree-Wurzel nicht ermittelbar; Schreibzugriff gesperrt.".to_string());
        };
        let direct = candidates
            .iter()
            .any(|root| root.root.join(".git").canonicalize().ok().as_ref() == Some(&common));
        let matched = direct
            || candidates.iter().any(|root| {
                git_path(&root.root, &["rev-parse", "--git-common-dir"]).as_ref() == Some(&common)
            });
        if matched && canonical.starts_with(&toplevel) {
            return Ok(ScopedTarget {
                path: canonical,
                scope_root: toplevel,
                kind: ScopeKind::LinkedWorktree,
            });
        }
        Err("Ziel liegt ausserhalb registrierter Projektwurzeln und ihrer Worktrees.".to_string())
    }
}

fn read_bounded_json(path: &Path) -> Option<serde_json::Value> {
    let meta = fs::metadata(path).ok()?;
    if meta.len() > 4 * 1024 * 1024 {
        return None;
    }
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// Registry -> (Schluessel, Wurzel). Nur Pfade und IDs; Inhalte/Capsules werden nie gelesen.
pub(crate) fn registry_entries(registry: &serde_json::Value) -> Vec<(Vec<String>, PathBuf)> {
    registry
        .get("projects")
        .and_then(serde_json::Value::as_array)
        .map(|projects| {
            projects
                .iter()
                .filter_map(|project| {
                    let root = project.get("rootPath")?.as_str()?.trim();
                    if root.is_empty() || !Path::new(root).is_absolute() {
                        return None;
                    }
                    let mut keys = Vec::new();
                    for field in ["id", "identityKey"] {
                        if let Some(value) = project.get(field).and_then(serde_json::Value::as_str)
                        {
                            keys.push(value.to_string());
                        }
                    }
                    if let Some(aliases) =
                        project.get("aliases").and_then(serde_json::Value::as_array)
                    {
                        keys.extend(
                            aliases
                                .iter()
                                .filter_map(serde_json::Value::as_str)
                                .map(str::to_string),
                        );
                    }
                    Some((keys, PathBuf::from(root)))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Absoluter, kanonischer Pfad aus einem lesenden Git-Befehl (strukturiert, ohne fsmonitor/Locks).
fn git_path(dir: &Path, args: &[&str]) -> Option<PathBuf> {
    let raw = crate::project_registry::run_git(dir, args)?;
    let text = String::from_utf8_lossy(&raw).trim().to_string();
    if text.is_empty() {
        return None;
    }
    let path = Path::new(&text);
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        dir.join(path)
    };
    joined.canonicalize().ok()
}

// ===== Writer-Ownership (Kernel-Lock + Identitaet) =====

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LeaseIdentity {
    pub schema_version: u32,
    pub owner: String,
    pub pid: u32,
    pub nonce: String,
    pub acquired_at: String,
    /// Nur der Basename des Worktrees, nie ein absoluter Pfad.
    pub worktree: String,
}

/// Exklusive Writer-Lease fuer genau einen Worktree. Der Kernel-Lock ist die Wahrheit: er endet mit dem
/// Prozess, deshalb kann eine wiederverwendete PID nie einen Besitz vortaeuschen oder verlaengern.
#[derive(Debug)]
pub(crate) struct WriterLease {
    file: File,
    nonce: String,
}

impl WriterLease {
    #[allow(dead_code)]
    pub(crate) fn nonce(&self) -> &str {
        &self.nonce
    }
}

impl Drop for WriterLease {
    fn drop(&mut self) {
        // Datei bleibt bestehen (sonst Lock-auf-geloeschtem-Inode-Rennen); nur Identitaet leeren.
        let _ = self.file.set_len(0);
        let _ = self.file.unlock();
    }
}

pub(crate) fn writer_lock_path(control_root: &Path, worktree: &Path) -> PathBuf {
    let digest = Sha256::digest(worktree.to_string_lossy().as_bytes());
    let hex = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    control_root
        .join(WRITERS_DIR)
        .join(format!("{}.lock", &hex[..32]))
}

fn harden_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Lock-Ordner nicht anlegbar ({e})."))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Lock-Ordner nicht haertbar ({e})."))?;
    }
    Ok(())
}

fn open_lock_file(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|e| format!("Lock-Datei nicht oeffenbar ({e})."))
}

/// Nicht blockierender Kernel-Lock mit kurzer, begrenzter Wiederholung: Ein gerade freigegebener Lock
/// kann fuer Millisekunden noch von einem parallel geforkten Kindprozess (fork->exec-Fenster) referenziert
/// sein. Danach gilt: belegt bleibt belegt (fail-closed), es wird nie unbegrenzt gewartet.
fn try_lock_bounded(file: &File) -> Result<(), TryLockError> {
    let mut attempts = 0;
    loop {
        match file.try_lock() {
            Err(TryLockError::WouldBlock) if attempts < LOCK_RETRIES => {
                attempts += 1;
                std::thread::sleep(LOCK_RETRY_DELAY);
            }
            other => return other,
        }
    }
}

fn read_identity(file: &mut File) -> Option<LeaseIdentity> {
    let mut raw = String::new();
    file.seek(SeekFrom::Start(0)).ok()?;
    file.take(MAX_IDENTITY_BYTES)
        .read_to_string(&mut raw)
        .ok()?;
    serde_json::from_str(raw.trim()).ok()
}

fn read_identity_at(path: &Path) -> Option<LeaseIdentity> {
    let mut file = File::open(path).ok()?;
    read_identity(&mut file)
}

fn write_identity(file: &mut File, identity: &LeaseIdentity) -> Result<(), String> {
    let bytes = serde_json::to_vec(identity)
        .map_err(|_| "Lease-Identitaet nicht serialisierbar.".to_string())?;
    file.set_len(0)
        .and_then(|_| file.seek(SeekFrom::Start(0)).map(|_| ()))
        .and_then(|_| file.write_all(&bytes))
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("Lease-Identitaet nicht schreibbar ({e})."))
}

fn new_identity(owner: &str, worktree: &Path) -> LeaseIdentity {
    LeaseIdentity {
        schema_version: LOCK_SCHEMA_VERSION,
        owner: bounded_owner(owner),
        pid: std::process::id(),
        nonce: uuid::Uuid::new_v4().to_string(),
        acquired_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        worktree: worktree
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("worktree")
            .to_string(),
    }
}

fn bounded_owner(owner: &str) -> String {
    owner
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'))
        .take(96)
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LeaseError {
    /// Ein anderer Writer haelt den Kernel-Lock.
    Busy(String),
    /// Lock nicht pruefbar/schreibbar -> Zustand mehrdeutig, fail-closed.
    Unavailable(String),
}

impl std::fmt::Display for LeaseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy(message) | Self::Unavailable(message) => f.write_str(message),
        }
    }
}

/// Nimmt die exklusive Writer-Lease fuer `worktree` (kanonischer Pfad). Belegt oder nicht pruefbar
/// -> Fehler (fail-closed). Eine liegengebliebene Identitaet ohne Lock gilt als verwaist und wird
/// ersetzt, weil nur der Kernel-Lock Besitz beweist.
pub(crate) fn acquire_writer(
    control_root: &Path,
    worktree: &Path,
    owner: &str,
) -> Result<WriterLease, LeaseError> {
    harden_dir(&control_root.join(WRITERS_DIR)).map_err(LeaseError::Unavailable)?;
    let path = writer_lock_path(control_root, worktree);
    let mut file = open_lock_file(&path).map_err(LeaseError::Unavailable)?;
    match try_lock_bounded(&file) {
        Ok(()) => {}
        Err(TryLockError::WouldBlock) => {
            let holder = read_identity_at(&path)
                .map(|id| format!("{} (pid {})", id.owner, id.pid))
                .unwrap_or_else(|| "unbekannt".to_string());
            return Err(LeaseError::Busy(format!(
                "Worktree hat bereits einen aktiven Writer: {holder}."
            )));
        }
        Err(TryLockError::Error(error)) => {
            return Err(LeaseError::Unavailable(format!(
                "Writer-Lock nicht pruefbar ({error}); Schreibzugriff gesperrt."
            )));
        }
    }
    let identity = new_identity(owner, worktree);
    write_identity(&mut file, &identity).map_err(LeaseError::Unavailable)?;
    Ok(WriterLease {
        file,
        nonce: identity.nonce,
    })
}

// ===== Local-Control-Daemon-Lease =====

#[derive(Debug)]
pub(crate) struct DaemonLease {
    file: File,
    root: PathBuf,
    nonce: String,
}

impl DaemonLease {
    /// Besitz besteht nur, solange Identitaet (Nonce) und Kompatibilitaets-PID-Datei unveraendert sind.
    /// Wer daemon.pid entfernt (Uninstall) oder die Lease ueberschreibt, stoppt den Daemon.
    pub(crate) fn still_owned(&mut self) -> bool {
        let identity_ok = read_identity(&mut self.file).is_some_and(|id| id.nonce == self.nonce);
        let pid_ok = fs::read_to_string(self.root.join(LEGACY_DAEMON_PID_FILE))
            .ok()
            .and_then(|raw| raw.trim().parse::<u32>().ok())
            == Some(std::process::id());
        identity_ok && pid_ok
    }
}

impl Drop for DaemonLease {
    fn drop(&mut self) {
        let _ = self.file.set_len(0);
        let _ = self.file.unlock();
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProcessProbe {
    Dead,
    /// Lebt und ist nachweislich ein Local-Control-Daemon.
    Daemon,
    /// Lebt, ist aber etwas anderes (PID wurde wiederverwendet).
    Other,
    /// Lebt, Identitaet nicht feststellbar.
    Unknown,
}

pub(crate) fn probe_process(pid: u32) -> ProcessProbe {
    if pid == 0 || pid > i32::MAX as u32 {
        return ProcessProbe::Unknown;
    }
    if !process_alive(pid) {
        return ProcessProbe::Dead;
    }
    let output = Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();
    match output {
        Ok(out) if out.status.success() => {
            let command = String::from_utf8_lossy(&out.stdout);
            if command.trim().is_empty() {
                ProcessProbe::Unknown
            } else if command.contains("--local-control-daemon") {
                ProcessProbe::Daemon
            } else {
                ProcessProbe::Other
            }
        }
        // ps meldet "nicht gefunden", obwohl kill(0) lebte: Rennen -> nicht entscheidbar.
        _ => ProcessProbe::Unknown,
    }
}

#[cfg(unix)]
fn process_alive(pid: u32) -> bool {
    // SAFETY: kill mit Signal 0 prueft nur Existenz/Berechtigung und sendet nichts.
    let rc = unsafe { libc::kill(pid as libc::pid_t, 0) };
    rc == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn process_alive(_pid: u32) -> bool {
    true
}

/// Exklusiver Daemon-Besitz: Kernel-Lock auf daemon.lock. Eine Alt-PID-Datei aus Vorversionen wird nur
/// entfernt, wenn ihr Prozess nachweislich tot oder nachweislich kein Daemon ist; sonst fail-closed.
pub(crate) fn acquire_daemon_lease(root: &Path) -> Result<DaemonLease, String> {
    acquire_daemon_lease_with(root, probe_process)
}

pub(crate) fn acquire_daemon_lease_with(
    root: &Path,
    probe: impl Fn(u32) -> ProcessProbe,
) -> Result<DaemonLease, String> {
    let lock_path = root.join(DAEMON_LOCK_FILE);
    let mut file = open_lock_file(&lock_path)?;
    match try_lock_bounded(&file) {
        Ok(()) => {}
        Err(TryLockError::WouldBlock) => {
            let holder = read_identity_at(&lock_path)
                .map(|id| format!("PID {}", id.pid))
                .unwrap_or_else(|| "unbekannt".to_string());
            return Err(format!(
                "Local Control: Daemon laeuft bereits ({holder}, Lock gehalten)."
            ));
        }
        Err(TryLockError::Error(error)) => {
            return Err(format!(
                "Local Control: Daemon-Lock nicht pruefbar ({error}); Start verweigert."
            ));
        }
    }

    let pid_path = root.join(LEGACY_DAEMON_PID_FILE);
    if let Ok(raw) = fs::read_to_string(&pid_path) {
        match raw.trim().parse::<u32>() {
            Ok(pid) if pid == std::process::id() => {}
            Ok(pid) => match probe(pid) {
                ProcessProbe::Dead | ProcessProbe::Other => {
                    let _ = fs::remove_file(&pid_path);
                }
                ProcessProbe::Daemon => {
                    return Err(format!(
                        "Local Control: ein Daemon ohne Lock (Vorversion?) laeuft mit PID {pid}; Start verweigert."
                    ));
                }
                ProcessProbe::Unknown => {
                    return Err(format!(
                        "Local Control: Besitz von daemon.pid (PID {pid}) ist mehrdeutig; Start verweigert."
                    ));
                }
            },
            Err(_) => {
                return Err(
                    "Local Control: daemon.pid ist unlesbar; Besitz mehrdeutig, Start verweigert."
                        .to_string(),
                );
            }
        }
    }

    let identity = new_identity("local-control-daemon", root);
    write_identity(&mut file, &identity)?;
    fs::write(&pid_path, format!("{}\n", std::process::id()))
        .map_err(|e| format!("Local Control: daemon.pid nicht schreibbar: {e}"))?;
    Ok(DaemonLease {
        file,
        root: root.to_path_buf(),
        nonce: identity.nonce,
    })
}

// ===== Prozessgruppen =====

#[cfg(unix)]
fn signal_group(pgid: u32, signal: libc::c_int) -> bool {
    if pgid <= 1 || pgid > i32::MAX as u32 {
        return false;
    }
    // SAFETY: Signale nur an die eigene, von uns gestartete Prozessgruppe (negativer pgid).
    let rc = unsafe { libc::kill(-(pgid as libc::pid_t), signal) };
    rc == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

/// Beendet eine eigene Prozessgruppe: SIGTERM, Gnadenfrist, dann SIGKILL. `reap_leader` laesst den
/// Aufrufer seinen direkten Kindprozess (den Gruppenleiter) einsammeln; ein nicht eingesammelter Zombie
/// zaehlt sonst weiter als Gruppenmitglied. Wir reapen nie selbst (sonst koennte ein spaeteres
/// `child.kill()` eine wiederverwendete PID treffen). `true` = Gruppe danach leer.
#[cfg(unix)]
pub(crate) fn terminate_process_group(
    pgid: u32,
    grace: Duration,
    mut reap_leader: impl FnMut(),
) -> bool {
    if pgid <= 1 || pgid > i32::MAX as u32 {
        return false;
    }
    let mut wait_empty = |budget: Duration| {
        let deadline = std::time::Instant::now() + budget;
        loop {
            reap_leader();
            if !signal_group(pgid, 0) {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    };
    signal_group(pgid, libc::SIGTERM);
    if wait_empty(grace) {
        return true;
    }
    signal_group(pgid, libc::SIGKILL);
    wait_empty(Duration::from_millis(500))
}

#[cfg(not(unix))]
pub(crate) fn terminate_process_group(
    _pgid: u32,
    _grace: Duration,
    _reap_leader: impl FnMut(),
) -> bool {
    false
}

/// Haelt eine owned Prozessgruppe; beim Drop (auch bei Abbruch/Panic/verworfenem Future) wird die
/// Gruppe sofort beendet. Nach regulaerem Ende bleiben so keine verwaisten Enkelprozesse zurueck.
#[derive(Debug)]
pub(crate) struct ProcessGroupGuard {
    pgid: Option<u32>,
}

impl ProcessGroupGuard {
    pub(crate) fn new(pgid: Option<u32>) -> Self {
        Self { pgid }
    }

    /// Sendet nur SIGTERM an die Gruppe (fuer asynchrone Aufrufer, die danach selbst warten).
    pub(crate) fn interrupt(&self) {
        #[cfg(unix)]
        if let Some(pgid) = self.pgid {
            signal_group(pgid, libc::SIGTERM);
        }
    }

    pub(crate) fn terminate(&mut self, grace: Duration, reap_leader: impl FnMut()) -> bool {
        match self.pgid.take() {
            Some(pgid) => terminate_process_group(pgid, grace, reap_leader),
            None => true,
        }
    }
}

impl Drop for ProcessGroupGuard {
    fn drop(&mut self) {
        self.terminate(Duration::from_millis(0), || {});
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "katosync-boundary-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args([
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=f@example.invalid",
            ])
            .args(["-c", "commit.gpgsign=false"])
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?}");
    }

    fn repo(dir: &Path) {
        git(dir, &["init", "-q", "-b", "main"]);
        fs::write(dir.join("README.md"), "# fixture\n").unwrap();
        git(dir, &["add", "README.md"]);
        git(dir, &["commit", "-q", "-m", "init"]);
    }

    #[test]
    fn unregistered_paths_and_symlink_escapes_are_rejected() {
        let base = temp_dir("scope");
        let registered = base.join("registered");
        let foreign = base.join("foreign");
        fs::create_dir_all(registered.join("src")).unwrap();
        fs::create_dir_all(&foreign).unwrap();
        let scope = WriteScope::from_entries([(vec!["Alpha".to_string()], registered.clone())]);

        let inside = scope.resolve(&registered.join("src"), None).unwrap();
        assert_eq!(inside.kind, ScopeKind::RegisteredRoot);
        assert_eq!(inside.scope_root, registered);
        assert!(scope.resolve(&registered, Some("alpha")).is_ok());

        assert!(scope.resolve(&foreign, None).is_err());
        assert!(scope.resolve(&base, None).is_err());
        assert!(scope.resolve(&base.join("missing"), None).is_err());
        // Projektbindung: eine fremde ID darf nicht auf die registrierte Wurzel schreiben.
        assert!(scope.resolve(&registered, Some("beta")).is_err());
        assert!(WriteScope::default().resolve(&registered, None).is_err());

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&foreign, registered.join("escape")).unwrap();
            assert!(scope.resolve(&registered.join("escape"), None).is_err());
            assert!(!inside.contains_path_arg("../foreign"));
            assert!(!inside.contains_path_arg(foreign.to_str().unwrap()));
            assert!(!inside.contains_path_arg("../../escape/x"));
            assert!(!inside.contains_path_arg("/etc/passwd"));
            let root_scope = scope.resolve(&registered, None).unwrap();
            assert!(!root_scope.contains_path_arg("escape/new-file"));
            assert!(root_scope.contains_path_arg("src/new-file.ts"));
        }
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn linked_worktrees_of_registered_projects_are_writable_foreign_repos_are_not() {
        let base = temp_dir("worktree");
        let main = base.join("main");
        fs::create_dir_all(&main).unwrap();
        repo(&main);
        let linked = base.join("main-feature");
        git(
            &main,
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "feature",
                linked.to_str().unwrap(),
            ],
        );
        let other = base.join("other");
        fs::create_dir_all(&other).unwrap();
        repo(&other);

        let scope = WriteScope::from_entries([(vec!["alpha".to_string()], main.clone())]);
        let resolved = scope.resolve(&linked, Some("alpha")).unwrap();
        assert_eq!(resolved.kind, ScopeKind::LinkedWorktree);
        assert_eq!(resolved.scope_root, linked.canonicalize().unwrap());
        assert_eq!(resolved.writer_key_path(), linked.canonicalize().unwrap());
        assert!(scope.resolve(&other, None).is_err());
        assert!(scope.resolve(&linked, Some("beta")).is_err());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn registry_entries_use_ids_aliases_and_absolute_roots_only() {
        let registry = serde_json::json!({
            "schemaVersion": 1,
            "projects": [
                {"id": "p1", "identityKey": "github.com/acme/app", "aliases": ["app"], "rootPath": "/tmp/x"},
                {"id": "p2", "rootPath": "relative/path"},
                {"id": "p3"}
            ]
        });
        let entries = registry_entries(&registry);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].0, vec!["p1", "github.com/acme/app", "app"]);
    }

    #[test]
    fn writer_lease_is_exclusive_and_stale_identity_never_proves_ownership() {
        let control = temp_dir("writer");
        let worktree = temp_dir("writer-wt");

        let first = acquire_writer(&control, &worktree, "runner:task-1").unwrap();
        let busy = acquire_writer(&control, &worktree, "local-control:job-2").unwrap_err();
        assert!(
            matches!(&busy, LeaseError::Busy(message) if message.contains("runner:task-1")),
            "{busy}"
        );
        drop(first);

        // Verwaiste Identitaet mit LEBENDER PID (dieser Prozess) aber ohne Kernel-Lock: kein Besitz.
        let path = writer_lock_path(&control, &worktree);
        let stale = LeaseIdentity {
            schema_version: 1,
            owner: "crashed-writer".to_string(),
            pid: std::process::id(),
            nonce: "old".to_string(),
            acquired_at: "2026-10-01T00:00:00Z".to_string(),
            worktree: "x".to_string(),
        };
        fs::write(&path, serde_json::to_vec(&stale).unwrap()).unwrap();
        let second = acquire_writer(&control, &worktree, "runner:task-3").unwrap();
        assert_ne!(second.nonce(), "old");
        // Umgekehrt: Lock gehalten, Identitaet geloescht/kaputt -> trotzdem belegt (fail-closed).
        fs::write(&path, b"garbage").unwrap();
        assert!(matches!(
            acquire_writer(&control, &worktree, "runner:task-4"),
            Err(LeaseError::Busy(_))
        ));
        drop(second);
        assert!(acquire_writer(&control, &worktree, "runner:task-5").is_ok());

        fs::remove_dir_all(control).unwrap();
        fs::remove_dir_all(worktree).unwrap();
    }

    #[test]
    fn daemon_lease_fails_closed_on_ambiguous_or_live_legacy_owner() {
        let root = temp_dir("daemon");
        let pid_path = root.join(LEGACY_DAEMON_PID_FILE);

        // Lebende Alt-PID, die nachweislich ein Daemon ist -> verweigern.
        fs::write(&pid_path, "424242\n").unwrap();
        assert!(acquire_daemon_lease_with(&root, |_| ProcessProbe::Daemon)
            .unwrap_err()
            .contains("424242"));
        // Lebend, aber nicht identifizierbar -> mehrdeutig -> verweigern.
        assert!(acquire_daemon_lease_with(&root, |_| ProcessProbe::Unknown)
            .unwrap_err()
            .contains("mehrdeutig"));
        // Unlesbare PID-Datei -> mehrdeutig.
        fs::write(&pid_path, "not-a-pid").unwrap();
        assert!(acquire_daemon_lease_with(&root, |_| ProcessProbe::Dead).is_err());
        // Wiederverwendete PID (fremder Prozess) -> verwaist, Start erlaubt.
        fs::write(&pid_path, "424242\n").unwrap();
        let mut lease = acquire_daemon_lease_with(&root, |_| ProcessProbe::Other).unwrap();
        assert!(lease.still_owned());
        // Zweiter Daemon scheitert am Kernel-Lock, egal was in daemon.pid steht.
        assert!(acquire_daemon_lease_with(&root, |_| ProcessProbe::Dead)
            .unwrap_err()
            .contains("Lock gehalten"));
        // Entfernte daemon.pid (Uninstall) beendet den Besitz.
        fs::remove_file(&pid_path).unwrap();
        assert!(!lease.still_owned());
        drop(lease);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn real_probe_distinguishes_daemon_from_reused_pid() {
        let mut other = Command::new("/bin/sleep").arg("30").spawn().unwrap();
        assert_eq!(probe_process(other.id()), ProcessProbe::Other);
        let mut daemon_like = Command::new("/bin/sh")
            .args(["-c", "sleep 30", "--local-control-daemon"])
            .spawn()
            .unwrap();
        assert_eq!(probe_process(daemon_like.id()), ProcessProbe::Daemon);
        let _ = other.kill();
        let _ = daemon_like.kill();
        let _ = other.wait();
        let _ = daemon_like.wait();
        assert_eq!(probe_process(other.id()), ProcessProbe::Dead);
    }

    #[cfg(unix)]
    #[test]
    fn terminating_owned_process_group_kills_grandchildren() {
        use std::os::unix::process::CommandExt;
        let dir = temp_dir("pgroup");
        let pid_file = dir.join("grandchild.pid");
        let script = format!(
            "sleep 60 & echo $! > '{}'; wait",
            pid_file.to_string_lossy()
        );
        let mut child = Command::new("/bin/sh")
            .args(["-c", &script])
            .process_group(0)
            .spawn()
            .unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let grandchild = loop {
            if let Some(pid) = fs::read_to_string(&pid_file)
                .ok()
                .and_then(|raw| raw.trim().parse::<u32>().ok())
            {
                break pid;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "grandchild not started"
            );
            std::thread::sleep(Duration::from_millis(20));
        };
        assert!(process_alive(grandchild));
        let mut guard = ProcessGroupGuard::new(Some(child.id()));
        assert!(guard.terminate(Duration::from_secs(2), || {
            let _ = child.try_wait();
        }));
        let _ = child.wait();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while process_alive(grandchild) && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!process_alive(grandchild), "grandchild survived group kill");
        fs::remove_dir_all(dir).unwrap();
    }
}
