// Created by NMKato Solutions
//! Vertrauensgrenze der von KatoSync verwalteten Local-Brain-Runtime (llama.cpp).
//!
//! llama-server kann seinen HTTP-Endpunkt gegenueber KatoSync nicht authentisieren:
//! `--api-key` schuetzt nur den Server vor fremden Clients, beweist KatoSync aber nicht, dass
//! der antwortende Listener der eigene ist. Ein Listener auf 127.0.0.1:17842 gilt deshalb nur
//! dann als verwalteter Local Brain, wenn er nachweislich exakt der Prozess ist, den KatoSync
//! aus der hash-verifizierten Runtime gestartet hat (PID + Prozess-Startidentitaet +
//! kanonischer Executable-Pfad + Runtime-Hash + gehaltener Loopback-Port). Alles andere ist
//! fail closed: kein Nachweis, keine Uebernahme.

use crate::model_distribution as dist;
use anyhow::{anyhow, bail, Context, Result};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant, SystemTime},
};
use walkdir::WalkDir;

pub const LOOPBACK_HOST: &str = "127.0.0.1";
const RUNTIME_LEDGER_SCHEMA: u32 = 1;
const OWNER_RECORD_SCHEMA: u32 = 1;
const METADATA_LIMIT: u64 = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------
// Runtime-Integritaet: versioniertes Ledger aller Dateien der verifizierten Runtime.
// ---------------------------------------------------------------------------------------------

/// Was das gepinnte Manifest fuer die aktuelle Plattform erwartet.
#[derive(Debug, Clone, Copy)]
pub struct RuntimeBinding<'a> {
    pub runtime_id: &'a str,
    pub version: &'a str,
    pub target: &'a str,
    pub archive_sha256: &'a str,
    pub executable_name: &'a str,
}

/// Hash-Ledger der entpackten Runtime. Wird nur aus einem SHA-256-verifizierten Archiv
/// erzeugt und vor jedem Start vollstaendig gegen den Datenbestand geprueft.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeLedger {
    schema: u32,
    runtime_id: String,
    version: String,
    target: String,
    archive_sha256: String,
    executable: String,
    files: BTreeMap<String, LedgerFile>,
    symlinks: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LedgerFile {
    sha256: String,
    size_bytes: u64,
}

impl RuntimeLedger {
    pub fn executable_relative(&self) -> Result<PathBuf> {
        key_to_relative(&self.executable)
    }

    pub fn executable_sha256(&self) -> Option<&str> {
        self.files
            .get(&self.executable)
            .map(|file| file.sha256.as_str())
    }

    /// Bindet das Ledger an das gepinnte Manifest (Runtime, Version, Ziel, Archiv-Hash).
    pub fn check_binding(&self, binding: &RuntimeBinding<'_>) -> Result<()> {
        let matches = self.schema == RUNTIME_LEDGER_SCHEMA
            && self.runtime_id == binding.runtime_id
            && self.version == binding.version
            && self.target == binding.target
            && self
                .archive_sha256
                .eq_ignore_ascii_case(binding.archive_sha256);
        if !matches {
            bail!("Runtime-Ledger passt nicht zum gepinnten Manifest");
        }
        key_to_relative(&self.executable)?;
        if self.executable.rsplit('/').next() != Some(binding.executable_name)
            || !self.files.contains_key(&self.executable)
        {
            bail!("Runtime-Ledger nennt kein gueltiges Runtime-Executable");
        }
        for (key, file) in &self.files {
            key_to_relative(key)?;
            dist::validate_sha256(&file.sha256)?;
        }
        for key in self.symlinks.keys() {
            key_to_relative(key)?;
        }
        Ok(())
    }
}

fn validate_version_segment(version: &str) -> Result<()> {
    let valid = !version.is_empty()
        && version.len() <= 64
        && version != "."
        && version != ".."
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if valid {
        Ok(())
    } else {
        Err(anyhow!("Ungueltige Runtime-Version"))
    }
}

/// Ledger liegt ausserhalb des Runtime-Baums, damit es nie Teil der geprueften Dateien ist.
pub fn ledger_path(local_root: &Path, version: &str) -> Result<PathBuf> {
    validate_version_segment(version)?;
    Ok(local_root
        .join("runtime-ledger")
        .join(format!("{version}.json")))
}

fn relative_key(base: &Path, path: &Path) -> Result<String> {
    let relative = path
        .strip_prefix(base)
        .map_err(|_| anyhow!("Runtime-Eintrag liegt ausserhalb des Runtime-Verzeichnisses"))?;
    let mut parts = Vec::new();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            bail!("Unsicherer Runtime-Pfad");
        };
        let part = part
            .to_str()
            .ok_or_else(|| anyhow!("Runtime-Pfad ist kein UTF-8"))?;
        parts.push(part.to_string());
    }
    if parts.is_empty() {
        bail!("Leerer Runtime-Pfad");
    }
    Ok(parts.join("/"))
}

fn key_to_relative(key: &str) -> Result<PathBuf> {
    if key.is_empty() || key.len() > 1024 {
        bail!("Unsicherer Runtime-Pfad im Ledger");
    }
    let mut out = PathBuf::new();
    for part in key.split('/') {
        let unsafe_part =
            part.is_empty() || part == "." || part == ".." || part.contains(['\\', ':', '\0']);
        if unsafe_part {
            bail!("Unsicherer Runtime-Pfad im Ledger");
        }
        out.push(part);
    }
    Ok(out)
}

/// Erzeugt das Ledger aus einem frisch entpackten, archiv-verifizierten Staging-Baum.
pub fn build_runtime_ledger(dir: &Path, binding: &RuntimeBinding<'_>) -> Result<RuntimeLedger> {
    let mut files = BTreeMap::new();
    let mut symlinks = BTreeMap::new();
    let mut executables = Vec::new();
    for entry in WalkDir::new(dir)
        .follow_links(false)
        .min_depth(1)
        .sort_by_file_name()
    {
        let entry = entry.context("Runtime-Staging ist nicht lesbar")?;
        let key = relative_key(dir, entry.path())?;
        let file_type = entry.file_type();
        if file_type.is_dir() {
            continue;
        }
        if file_type.is_symlink() {
            let target = fs::read_link(entry.path())?;
            let target = target
                .to_str()
                .ok_or_else(|| anyhow!("Runtime-Symlink {key} ist kein UTF-8"))?;
            symlinks.insert(key, target.to_string());
        } else if file_type.is_file() {
            if entry.file_name() == binding.executable_name {
                executables.push(key.clone());
            }
            let size_bytes = fs::symlink_metadata(entry.path())?.len();
            let sha256 = dist::sha256_file(entry.path())?;
            files.insert(key, LedgerFile { sha256, size_bytes });
        } else {
            bail!("Runtime-Archiv enthaelt einen unzulaessigen Dateityp: {key}");
        }
    }
    let [executable] = executables.as_slice() else {
        bail!(
            "Runtime muss genau ein {} enthalten (gefunden: {})",
            binding.executable_name,
            executables.len()
        );
    };
    let ledger = RuntimeLedger {
        schema: RUNTIME_LEDGER_SCHEMA,
        runtime_id: binding.runtime_id.to_string(),
        version: binding.version.to_string(),
        target: binding.target.to_string(),
        archive_sha256: binding.archive_sha256.to_ascii_lowercase(),
        executable: executable.clone(),
        files,
        symlinks,
    };
    ledger.check_binding(binding)?;
    Ok(ledger)
}

/// Entzieht Gruppe/anderen jeden Zugriff auf den Runtime-Baum (Verzeichnisse 0700).
#[cfg(unix)]
pub fn harden_runtime_permissions(dir: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    for entry in WalkDir::new(dir).follow_links(false) {
        let entry = entry?;
        let meta = fs::symlink_metadata(entry.path())?;
        let mode = if meta.file_type().is_dir() {
            0o700
        } else if meta.file_type().is_file() {
            if meta.permissions().mode() & 0o111 != 0 {
                0o700
            } else {
                0o600
            }
        } else {
            continue;
        };
        fs::set_permissions(entry.path(), fs::Permissions::from_mode(mode))?;
    }
    Ok(())
}

#[cfg(not(unix))]
pub fn harden_runtime_permissions(_dir: &Path) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn current_uid() -> u32 {
    // SAFETY: geteuid hat keine Vorbedingungen und kann nicht fehlschlagen.
    unsafe { libc::geteuid() }
}

#[cfg(unix)]
fn check_owned_not_shared(meta: &fs::Metadata, what: &str) -> Result<()> {
    use std::os::unix::fs::MetadataExt;
    if meta.uid() != current_uid() {
        bail!("{what} gehoert nicht dem aktuellen Benutzer");
    }
    if !meta.file_type().is_symlink() && meta.mode() & 0o022 != 0 {
        bail!("{what} ist fuer Gruppe oder andere beschreibbar");
    }
    Ok(())
}

#[cfg(not(unix))]
fn check_owned_not_shared(_meta: &fs::Metadata, _what: &str) -> Result<()> {
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Fingerprint {
    len: u64,
    modified: Option<SystemTime>,
    #[cfg(unix)]
    dev: u64,
    #[cfg(unix)]
    ino: u64,
}

fn fingerprint(meta: &fs::Metadata) -> Fingerprint {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    Fingerprint {
        len: meta.len(),
        modified: meta.modified().ok(),
        #[cfg(unix)]
        dev: meta.dev(),
        #[cfg(unix)]
        ino: meta.ino(),
    }
}

/// Nachweis einer bestandenen Vollpruefung des Runtime-Baums.
#[derive(Debug, Clone)]
pub struct VerifiedRuntime {
    pub executable: PathBuf,
    pub executable_sha256: String,
    fingerprint: Fingerprint,
}

/// Kanonischer Pfad des verwalteten Executables, strukturell geprueft (ohne Hashing):
/// echtes Verzeichnis im KatoSync-Runtime-Root, keine Symlinks, eigener Benutzer, nicht
/// gruppen-/weltbeschreibbar.
pub fn managed_executable_path(
    runtime_root: &Path,
    version_dir: &Path,
    ledger: &RuntimeLedger,
) -> Result<PathBuf> {
    let root_meta = fs::symlink_metadata(runtime_root).context("Runtime-Verzeichnis fehlt")?;
    if !root_meta.file_type().is_dir() {
        bail!("Runtime-Verzeichnis ist kein echtes Verzeichnis (Symlink abgelehnt)");
    }
    check_owned_not_shared(&root_meta, "Runtime-Verzeichnis")?;
    let root = fs::canonicalize(runtime_root)?;
    let dir_meta = fs::symlink_metadata(version_dir).context("Runtime-Version fehlt")?;
    if !dir_meta.file_type().is_dir() {
        bail!("Runtime-Version ist kein echtes Verzeichnis (Symlink abgelehnt)");
    }
    check_owned_not_shared(&dir_meta, "Runtime-Version")?;
    let dir = fs::canonicalize(version_dir)?;
    if dir.parent() != Some(root.as_path()) {
        bail!("Runtime-Version liegt ausserhalb des KatoSync-Runtime-Verzeichnisses");
    }
    let executable = dir.join(key_to_relative(&ledger.executable)?);
    let meta = fs::symlink_metadata(&executable).context("Runtime-Executable fehlt")?;
    if !meta.file_type().is_file() {
        bail!("Runtime-Executable ist keine regulaere Datei (Symlink abgelehnt)");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o100 == 0 {
            bail!("Runtime-Executable ist nicht ausfuehrbar");
        }
    }
    check_owned_not_shared(&meta, "Runtime-Executable")?;
    let canonical = fs::canonicalize(&executable)?;
    if canonical != executable {
        bail!("Runtime-Executable wird ueber einen Symlink aufgeloest");
    }
    Ok(canonical)
}

/// Vollpruefung vor jedem Start: jede Datei (inkl. dylibs) gegen das Ledger, keine fremden
/// oder fehlenden Eintraege, Symlinks nur innerhalb der Runtime auf verifizierte Dateien.
pub fn verify_runtime_tree(
    runtime_root: &Path,
    version_dir: &Path,
    ledger: &RuntimeLedger,
) -> Result<VerifiedRuntime> {
    let executable = managed_executable_path(runtime_root, version_dir, ledger)?;
    let dir = fs::canonicalize(version_dir)?;
    let mut seen = BTreeSet::new();
    for entry in WalkDir::new(&dir).follow_links(false).min_depth(1) {
        let entry = entry.context("Runtime-Verzeichnis ist nicht lesbar")?;
        let key = relative_key(&dir, entry.path())?;
        let meta = fs::symlink_metadata(entry.path())?;
        check_owned_not_shared(&meta, &format!("Runtime-Eintrag {key}"))?;
        let file_type = meta.file_type();
        if file_type.is_dir() {
            continue;
        }
        if file_type.is_symlink() {
            let expected = ledger
                .symlinks
                .get(&key)
                .ok_or_else(|| anyhow!("Unbekannter Symlink in der Runtime: {key}"))?;
            let actual = fs::read_link(entry.path())?;
            if actual.to_str() != Some(expected.as_str()) {
                bail!("Runtime-Symlink {key} wurde veraendert");
            }
            let resolved = fs::canonicalize(entry.path())
                .with_context(|| format!("Runtime-Symlink {key} zeigt ins Leere"))?;
            let resolved_key = relative_key(&dir, &resolved)
                .map_err(|_| anyhow!("Runtime-Symlink {key} zeigt aus der Runtime heraus"))?;
            if !ledger.files.contains_key(&resolved_key) {
                bail!("Runtime-Symlink {key} zeigt auf keine verifizierte Datei");
            }
        } else if file_type.is_file() {
            let expected = ledger
                .files
                .get(&key)
                .ok_or_else(|| anyhow!("Unbekannte Datei in der Runtime: {key}"))?;
            if meta.len() != expected.size_bytes
                || !dist::sha256_file(entry.path())?.eq_ignore_ascii_case(&expected.sha256)
            {
                bail!("Runtime-Datei {key} weicht vom verifizierten Stand ab (SHA256-Mismatch)");
            }
        } else {
            bail!("Unzulaessiger Dateityp in der Runtime: {key}");
        }
        seen.insert(key);
    }
    if let Some(missing) = ledger
        .files
        .keys()
        .chain(ledger.symlinks.keys())
        .find(|key| !seen.contains(*key))
    {
        bail!("Runtime-Datei fehlt: {missing}");
    }
    let meta = fs::symlink_metadata(&executable)?;
    Ok(VerifiedRuntime {
        executable_sha256: ledger
            .executable_sha256()
            .ok_or_else(|| anyhow!("Runtime-Ledger ohne Executable-Hash"))?
            .to_ascii_lowercase(),
        fingerprint: fingerprint(&meta),
        executable,
    })
}

/// Letzte Pruefung unmittelbar vor `spawn`: dieselbe Datei (dev/ino/Groesse/mtime) und
/// erneuter SHA-256 des Executables. Verkleinert das Verify->Exec-Fenster auf Mikrosekunden.
pub fn recheck_before_spawn(verified: &VerifiedRuntime) -> Result<()> {
    let meta = fs::symlink_metadata(&verified.executable)
        .context("Runtime-Executable ist vor dem Start verschwunden")?;
    if !meta.file_type().is_file() || fingerprint(&meta) != verified.fingerprint {
        bail!("Runtime-Executable wurde nach der Pruefung ersetzt");
    }
    if !dist::sha256_file(&verified.executable)?.eq_ignore_ascii_case(&verified.executable_sha256) {
        bail!("Runtime-Executable wurde nach der Pruefung veraendert (SHA256-Mismatch)");
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Private Metadaten (Ledger, Besitznachweis): atomar, nur fuer den eigenen Benutzer lesbar.
// ---------------------------------------------------------------------------------------------

fn create_private_dir(dir: &Path) -> Result<()> {
    fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub fn save_private_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("Metadatenpfad ohne Verzeichnis"))?;
    create_private_dir(parent)?;
    let temp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4().simple()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| -> Result<()> {
        let mut file = options.open(&temp)?;
        file.write_all(&serde_json::to_vec_pretty(value)?)?;
        file.sync_all()?;
        fs::rename(&temp, path)?;
        Ok(())
    })();
    if result.is_err() {
        fs::remove_file(&temp).ok();
    }
    result
}

pub fn load_private_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err.into()),
    };
    if !meta.file_type().is_file() || meta.len() > METADATA_LIMIT {
        bail!("Local-Brain-Metadaten sind ungueltig");
    }
    check_owned_not_shared(&meta, "Local-Brain-Metadaten")?;
    let mut bytes = Vec::new();
    File::open(path)?
        .take(METADATA_LIMIT)
        .read_to_end(&mut bytes)?;
    Ok(Some(
        serde_json::from_slice(&bytes).context("Local-Brain-Metadaten sind beschaedigt")?,
    ))
}

// ---------------------------------------------------------------------------------------------
// Startumgebung: explizite Allowlist statt geerbter App-Umgebung.
// ---------------------------------------------------------------------------------------------

#[cfg(unix)]
const SAFE_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";
#[cfg(unix)]
const ENV_ALLOWLIST: &[&str] = &["HOME", "TMPDIR"];
#[cfg(windows)]
const ENV_ALLOWLIST: &[&str] = &[
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "LOCALAPPDATA",
];

/// Lader-, Proxy-, Shell- und llama.cpp-Konfigurationsvariablen erreichen den Kindprozess nie,
/// auch wenn sie spaeter versehentlich in die Allowlist geraten sollten.
const BLOCKED_ENV_PREFIXES: &[&str] = &["DYLD_", "LD_", "LLAMA_", "GGML_", "MALLOC"];
const BLOCKED_ENV_NAMES: &[&str] = &[
    "BASH_ENV",
    "CDPATH",
    "CURL_CA_BUNDLE",
    "ENV",
    "IFS",
    "NODE_OPTIONS",
    "NO_PROXY",
    "PERL5OPT",
    "PROMPT_COMMAND",
    "PS4",
    "PYTHONPATH",
    "PYTHONSTARTUP",
    "RUBYOPT",
    "SHELLOPTS",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "ZDOTDIR",
];

pub fn is_blocked_env(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    upper.ends_with("_PROXY")
        || BLOCKED_ENV_NAMES.contains(&upper.as_str())
        || BLOCKED_ENV_PREFIXES
            .iter()
            .any(|prefix| upper.starts_with(prefix))
}

fn env_allowed(name: &str) -> bool {
    let listed = ENV_ALLOWLIST.iter().any(|allowed| {
        if cfg!(windows) {
            allowed.eq_ignore_ascii_case(name)
        } else {
            *allowed == name
        }
    });
    listed && !is_blocked_env(name)
}

#[cfg(unix)]
fn safe_path(_env: &BTreeMap<OsString, OsString>) -> OsString {
    SAFE_PATH.into()
}

#[cfg(windows)]
fn safe_path(env: &BTreeMap<OsString, OsString>) -> OsString {
    let root = env
        .iter()
        .find(|(key, _)| {
            key.to_str()
                .is_some_and(|k| k.eq_ignore_ascii_case("SYSTEMROOT"))
        })
        .map(|(_, value)| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "C:\\Windows".to_string());
    format!("{root}\\System32;{root}").into()
}

/// Minimale, explizite Umgebung fuer llama-server. PATH wird fest gesetzt, nie geerbt.
pub fn launch_environment<I, K, V>(inherited: I) -> BTreeMap<OsString, OsString>
where
    I: IntoIterator<Item = (K, V)>,
    K: Into<OsString>,
    V: Into<OsString>,
{
    let mut env = BTreeMap::new();
    for (key, value) in inherited {
        let (key, value): (OsString, OsString) = (key.into(), value.into());
        if value.is_empty() || !key.to_str().is_some_and(env_allowed) {
            continue;
        }
        env.insert(key, value);
    }
    let path = safe_path(&env);
    env.insert("PATH".into(), path);
    env
}

/// Haertet einen strukturierten Command (kein Shell-Interpolieren): leere Basisumgebung plus
/// Allowlist, kein stdin, eigene Prozessgruppe fuer das Beenden des gesamten Prozessbaums.
pub fn harden_launch(command: &mut Command) {
    command.env_clear();
    command.envs(launch_environment(std::env::vars_os()));
    command.stdin(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
}

// ---------------------------------------------------------------------------------------------
// Prozessidentitaet: PID allein beweist nichts (PID-Wiederverwendung) -> Startzeit + Pfad.
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveProcess {
    pub pid: u32,
    pub start: String,
    pub uid: Option<u32>,
    pub pgid: Option<u32>,
    pub executable: Option<PathBuf>,
}

/// Nur auf diesen Plattformen kann KatoSync Prozessidentitaet und Listener kernelseitig
/// belegen. Anderswo gilt ausschliesslich der eigene Child-Handle dieser Sitzung.
pub const fn supports_ownership_proof() -> bool {
    cfg!(any(target_os = "macos", target_os = "linux"))
}

#[cfg(target_os = "macos")]
pub fn inspect_process(pid: u32) -> Option<LiveProcess> {
    use std::os::unix::ffi::OsStrExt;
    const SZOMB: u32 = 5;
    let raw_pid = libc::c_int::try_from(pid).ok().filter(|value| *value > 0)?;
    // SAFETY: proc_bsdinfo ist ein reines C-Datenstruct; Nullinitialisierung ist gueltig.
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    // SAFETY: Puffer und Groesse beschreiben exakt `info`.
    let written = unsafe {
        libc::proc_pidinfo(
            raw_pid,
            libc::PROC_PIDTBSDINFO,
            0,
            (&mut info as *mut libc::proc_bsdinfo).cast(),
            size,
        )
    };
    if written != size || info.pbi_pid != pid || info.pbi_status == SZOMB {
        return None;
    }
    let mut path = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    // SAFETY: Puffer und Laenge stammen aus demselben Vec.
    let len = unsafe { libc::proc_pidpath(raw_pid, path.as_mut_ptr().cast(), path.len() as u32) };
    let executable = usize::try_from(len)
        .ok()
        .filter(|len| *len > 0 && *len <= path.len())
        .map(|len| PathBuf::from(std::ffi::OsStr::from_bytes(&path[..len])));
    Some(LiveProcess {
        pid,
        start: format!(
            "darwin:{}.{:06}",
            info.pbi_start_tvsec, info.pbi_start_tvusec
        ),
        uid: Some(info.pbi_uid),
        pgid: Some(info.pbi_pgid),
        executable,
    })
}

#[cfg(target_os = "linux")]
pub fn inspect_process(pid: u32) -> Option<LiveProcess> {
    use std::os::unix::fs::MetadataExt;
    if pid == 0 {
        return None;
    }
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // comm kann Leerzeichen/Klammern enthalten: Felder beginnen nach der letzten ')'.
    let fields: Vec<&str> = stat
        .get(stat.rfind(')')? + 1..)?
        .split_whitespace()
        .collect();
    let state = *fields.first()?;
    if state == "Z" || state == "X" {
        return None;
    }
    let pgid = fields.get(2)?.parse::<u32>().ok()?;
    let start_ticks = fields.get(19)?;
    let boot_id = fs::read_to_string("/proc/sys/kernel/random/boot_id").ok()?;
    let uid = fs::metadata(format!("/proc/{pid}")).ok()?.uid();
    Some(LiveProcess {
        pid,
        start: format!("linux:{}:{start_ticks}", boot_id.trim()),
        uid: Some(uid),
        pgid: Some(pgid),
        executable: fs::read_link(format!("/proc/{pid}/exe")).ok(),
    })
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn inspect_process(_pid: u32) -> Option<LiveProcess> {
    None
}

// ---------------------------------------------------------------------------------------------
// Listener-Besitz: haelt genau diese PID einen TCP-LISTEN-Socket auf 127.0.0.1:<port>?
// Da llama-server (gepinnte Runtime) ohne SO_REUSEPORT bindet, kann kein anderer Prozess
// dieselbe Adresse binden, solange die verifizierte PID sie haelt.
// ---------------------------------------------------------------------------------------------

#[cfg(target_os = "macos")]
mod darwin_socket {
    //! Feste Offsets aus <sys/proc_info.h> (struct socket_fdinfo, 64 Bit). Die Tests binden
    //! einen echten Listener und pruefen das Layout gegen den laufenden Kernel.
    pub const PROC_PIDFDSOCKETINFO: libc::c_int = 3;
    pub const SOCKET_FDINFO_SIZE: usize = 792;
    pub const SOCKINFO_TCP: i32 = 2;
    pub const TSI_S_LISTEN: i32 = 1;
    pub const INI_IPV4: u8 = 0x1;
    const SOCKET_INFO: usize = 24;
    pub const SOI_KIND: usize = SOCKET_INFO + 232;
    const PROTO: usize = SOCKET_INFO + 240;
    pub const INSI_LPORT: usize = PROTO + 4;
    pub const INSI_VFLAG: usize = PROTO + 24;
    pub const INSI_LADDR4: usize = PROTO + 48 + 12;
    pub const TCPSI_STATE: usize = PROTO + 80;

    #[repr(C, align(8))]
    pub struct Buffer(pub [u8; SOCKET_FDINFO_SIZE]);

    pub fn read_i32(buffer: &Buffer, offset: usize) -> i32 {
        let mut raw = [0u8; 4];
        raw.copy_from_slice(&buffer.0[offset..offset + 4]);
        i32::from_ne_bytes(raw)
    }
}

#[cfg(target_os = "macos")]
pub fn process_listens_on_loopback(pid: u32, port: u16) -> bool {
    use darwin_socket as s;
    let Some(raw_pid) = libc::c_int::try_from(pid).ok().filter(|value| *value > 0) else {
        return false;
    };
    let entry_size = std::mem::size_of::<libc::proc_fdinfo>();
    // SAFETY: Groessenabfrage mit Nullpuffer ist von proc_pidinfo dokumentiert.
    let needed =
        unsafe { libc::proc_pidinfo(raw_pid, libc::PROC_PIDLISTFDS, 0, std::ptr::null_mut(), 0) };
    let Ok(needed) = usize::try_from(needed) else {
        return false;
    };
    if needed == 0 {
        return false;
    }
    let capacity = needed / entry_size + 16;
    let mut fds = vec![
        libc::proc_fdinfo {
            proc_fd: 0,
            proc_fdtype: 0,
        };
        capacity
    ];
    // SAFETY: Puffer und Byte-Groesse beschreiben exakt den Vec.
    let written = unsafe {
        libc::proc_pidinfo(
            raw_pid,
            libc::PROC_PIDLISTFDS,
            0,
            fds.as_mut_ptr().cast(),
            (capacity * entry_size) as libc::c_int,
        )
    };
    let Ok(written) = usize::try_from(written) else {
        return false;
    };
    let wanted_port = port.to_be();
    fds[..(written / entry_size).min(capacity)]
        .iter()
        .filter(|fd| fd.proc_fdtype == libc::PROX_FDTYPE_SOCKET as u32)
        .any(|fd| {
            let mut buffer = s::Buffer([0u8; s::SOCKET_FDINFO_SIZE]);
            // SAFETY: Puffer hat exakt SOCKET_FDINFO_SIZE Bytes und 8-Byte-Ausrichtung.
            let filled = unsafe {
                libc::proc_pidfdinfo(
                    raw_pid,
                    fd.proc_fd,
                    s::PROC_PIDFDSOCKETINFO,
                    buffer.0.as_mut_ptr().cast(),
                    s::SOCKET_FDINFO_SIZE as libc::c_int,
                )
            };
            usize::try_from(filled).is_ok_and(|filled| filled == s::SOCKET_FDINFO_SIZE)
                && s::read_i32(&buffer, s::SOI_KIND) == s::SOCKINFO_TCP
                && buffer.0[s::INSI_VFLAG] & s::INI_IPV4 != 0
                && (s::read_i32(&buffer, s::INSI_LPORT) as u32 & 0xffff) as u16 == wanted_port
                && buffer.0[s::INSI_LADDR4..s::INSI_LADDR4 + 4] == [127, 0, 0, 1]
                && s::read_i32(&buffer, s::TCPSI_STATE) == s::TSI_S_LISTEN
        })
}

#[cfg(target_os = "linux")]
pub fn process_listens_on_loopback(pid: u32, port: u16) -> bool {
    const TCP_LISTEN: &str = "0A";
    let loopback = if cfg!(target_endian = "little") {
        "0100007F"
    } else {
        "7F000001"
    };
    let wanted = format!("{loopback}:{port:04X}");
    let Ok(table) = fs::read_to_string("/proc/net/tcp") else {
        return false;
    };
    let inodes: BTreeSet<String> = table
        .lines()
        .skip(1)
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            (fields.get(1) == Some(&wanted.as_str()) && fields.get(3) == Some(&TCP_LISTEN))
                .then(|| fields.get(9).map(|inode| format!("socket:[{inode}]")))
                .flatten()
        })
        .collect();
    if inodes.is_empty() {
        return false;
    }
    let Ok(entries) = fs::read_dir(format!("/proc/{pid}/fd")) else {
        return false;
    };
    entries.filter_map(Result::ok).any(|entry| {
        fs::read_link(entry.path())
            .ok()
            .and_then(|link| link.to_str().map(str::to_string))
            .is_some_and(|link| inodes.contains(&link))
    })
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn process_listens_on_loopback(_pid: u32, _port: u16) -> bool {
    false
}

/// Antwortet irgendein Prozess auf 127.0.0.1:<port>? (Nur fuer fail-closed-Entscheidungen.)
pub fn loopback_port_in_use(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(500)).is_ok()
}

/// HTTP-Client fuer verwaltete Loopback-Anfragen: nie ueber Proxy, nie Redirects folgen.
pub fn loopback_client(timeout: Duration) -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
}

// ---------------------------------------------------------------------------------------------
// Besitznachweis der gestarteten Runtime.
// ---------------------------------------------------------------------------------------------

/// Erwartete Identitaet der aktuell installierten, verwalteten Runtime.
#[derive(Debug, Clone, Copy)]
pub struct LaunchIdentity<'a> {
    pub executable: &'a Path,
    pub executable_sha256: &'a str,
    pub runtime_version: &'a str,
    pub port: u16,
    pub model_alias: &'a str,
}

/// Persistierter Nachweis, welchen Prozess KatoSync gestartet hat. Nur gueltig, solange PID,
/// Prozess-Startidentitaet, Benutzer und kanonischer Executable-Pfad live uebereinstimmen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OwnershipRecord {
    schema: u32,
    pid: u32,
    process_start: String,
    uid: Option<u32>,
    executable: PathBuf,
    executable_sha256: String,
    runtime_version: String,
    host: String,
    port: u16,
    model_alias: String,
    launched_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnershipFailure {
    RecordMismatch,
    ProcessGone,
    PidReused,
    ForeignUser,
    ForeignExecutable,
    NotListening,
}

pub fn owner_record_path(local_root: &Path) -> PathBuf {
    local_root.join("run").join("runtime-owner.json")
}

impl OwnershipRecord {
    /// Liest die Identitaet des soeben gestarteten Kindprozesses. Schlaegt fehl (und der
    /// Aufrufer beendet das Kind), wenn der Prozess nicht die verifizierte Runtime ausfuehrt.
    pub fn capture(pid: u32, launch: &LaunchIdentity<'_>) -> Result<Self> {
        let live = inspect_process(pid)
            .ok_or_else(|| anyhow!("Gestartete Runtime ist nicht inspizierbar"))?;
        let executable = live
            .executable
            .as_deref()
            .and_then(|path| fs::canonicalize(path).ok())
            .ok_or_else(|| anyhow!("Executable der gestarteten Runtime ist unbekannt"))?;
        if executable != launch.executable {
            bail!("Gestarteter Prozess fuehrt nicht die verifizierte Runtime aus");
        }
        Ok(Self {
            schema: OWNER_RECORD_SCHEMA,
            pid,
            process_start: live.start,
            uid: live.uid,
            executable,
            executable_sha256: launch.executable_sha256.to_ascii_lowercase(),
            runtime_version: launch.runtime_version.to_string(),
            host: LOOPBACK_HOST.to_string(),
            port: launch.port,
            model_alias: launch.model_alias.to_string(),
            launched_at: chrono::Utc::now().to_rfc3339(),
        })
    }
}

/// Belegt, dass der Datensatz zur erwarteten Runtime gehoert und der Prozess live exakt
/// derselbe ist (keine PID-Wiederverwendung) und - falls verlangt - den Loopback-Port haelt.
pub fn verify_ownership(
    record: &OwnershipRecord,
    launch: &LaunchIdentity<'_>,
    require_listener: bool,
) -> std::result::Result<LiveProcess, OwnershipFailure> {
    let consistent = record.schema == OWNER_RECORD_SCHEMA
        && record.host == LOOPBACK_HOST
        && record.port == launch.port
        && record.runtime_version == launch.runtime_version
        && record.model_alias == launch.model_alias
        && record
            .executable_sha256
            .eq_ignore_ascii_case(launch.executable_sha256)
        && record.executable == launch.executable;
    if !consistent {
        return Err(OwnershipFailure::RecordMismatch);
    }
    verify_record_process(record, require_listener)
}

/// Selbstkonsistenz des Datensatzes gegen den Live-Prozess (ohne aktuelles Ledger, z. B. zum
/// Beenden einer Runtime aus einer frueheren Sitzung nach einem Runtime-Wechsel).
pub fn verify_record_process(
    record: &OwnershipRecord,
    require_listener: bool,
) -> std::result::Result<LiveProcess, OwnershipFailure> {
    if record.schema != OWNER_RECORD_SCHEMA || record.host != LOOPBACK_HOST {
        return Err(OwnershipFailure::RecordMismatch);
    }
    let live = inspect_process(record.pid).ok_or(OwnershipFailure::ProcessGone)?;
    if live.start != record.process_start {
        return Err(OwnershipFailure::PidReused);
    }
    #[cfg(unix)]
    if live.uid != Some(current_uid()) || record.uid != live.uid {
        return Err(OwnershipFailure::ForeignUser);
    }
    let executable = live
        .executable
        .as_deref()
        .and_then(|path| fs::canonicalize(path).ok());
    if executable.as_deref() != Some(record.executable.as_path()) {
        return Err(OwnershipFailure::ForeignExecutable);
    }
    if require_listener && !process_listens_on_loopback(record.pid, record.port) {
        return Err(OwnershipFailure::NotListening);
    }
    Ok(live)
}

// ---------------------------------------------------------------------------------------------
// Lebenszyklus: immer die gesamte Prozessgruppe beenden.
// ---------------------------------------------------------------------------------------------

#[cfg(unix)]
fn signal_group(pgid: u32, signal: libc::c_int) {
    if let Ok(pgid) = libc::pid_t::try_from(pgid) {
        if pgid > 1 {
            // SAFETY: killpg hat keine Speicher-Vorbedingungen; ESRCH ist erwartet und harmlos.
            unsafe {
                libc::killpg(pgid, signal);
            }
        }
    }
}

/// Beendet den eigenen Kindprozess samt Prozessgruppe: SIGTERM, Wartefrist, dann SIGKILL.
/// Der Leader wird erst danach eingesammelt, damit seine PGID waehrend des SIGKILL nicht
/// wiederverwendet sein kann.
pub fn terminate_child(child: &mut Child, grace: Duration) {
    #[cfg(unix)]
    {
        let pgid = child.id();
        if child.try_wait().ok().flatten().is_none() {
            signal_group(pgid, libc::SIGTERM);
            let deadline = Instant::now() + grace;
            while Instant::now() < deadline {
                let exited = if supports_ownership_proof() {
                    inspect_process(pgid).is_none()
                } else {
                    child.try_wait().ok().flatten().is_some()
                };
                if exited {
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            signal_group(pgid, libc::SIGKILL);
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Beendet eine Runtime aus einer frueheren Sitzung - nur bei positivem Identitaetsnachweis
/// (Startidentitaet, Benutzer, Executable innerhalb des Runtime-Roots, eigene Prozessgruppe).
pub fn terminate_recorded(record: &OwnershipRecord, runtime_root: &Path, grace: Duration) -> bool {
    let Ok(root) = fs::canonicalize(runtime_root) else {
        return false;
    };
    if !record.executable.starts_with(&root) {
        return false;
    }
    let Ok(live) = verify_record_process(record, false) else {
        return false;
    };
    if live.pgid != Some(record.pid) {
        return false;
    }
    #[cfg(unix)]
    {
        let same_process =
            || inspect_process(record.pid).is_some_and(|now| now.start == record.process_start);
        signal_group(record.pid, libc::SIGTERM);
        let deadline = Instant::now() + grace;
        while same_process() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        if same_process() {
            signal_group(record.pid, libc::SIGKILL);
        }
        true
    }
    #[cfg(not(unix))]
    {
        let _ = grace;
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BINDING: RuntimeBinding<'static> = RuntimeBinding {
        runtime_id: "llama-cpp",
        version: "b1",
        target: "test-target",
        archive_sha256: "1ef6db9f1913725a9a7522f1719e987c88329f266e906270436b23d662985a20",
        executable_name: "llama-server",
    };

    struct Fixture {
        base: PathBuf,
        runtime_root: PathBuf,
        version_dir: PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.base).ok();
        }
    }

    impl Fixture {
        fn bin(&self) -> PathBuf {
            self.version_dir.join("llama-b1")
        }
    }

    /// Runtime-Baum wie im llama.cpp-Release: Executable, versionierte dylib, Symlink-Kette.
    fn runtime_fixture() -> (Fixture, RuntimeLedger) {
        let base = std::env::temp_dir().join(format!(
            "katosync-runtime-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let runtime_root = base.join("runtime");
        let version_dir = runtime_root.join("b1");
        let fixture = Fixture {
            base,
            runtime_root,
            version_dir,
        };
        let bin = fixture.bin();
        fs::create_dir_all(&bin).unwrap();
        fs::write(bin.join("llama-server"), b"#!/bin/sh\nexit 0\n").unwrap();
        fs::write(bin.join("libggml.0.25.3.dylib"), b"dylib-bytes").unwrap();
        fs::write(bin.join("LICENSE"), b"MIT").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::{symlink, PermissionsExt};
            fs::set_permissions(bin.join("llama-server"), fs::Permissions::from_mode(0o755))
                .unwrap();
            symlink("libggml.0.25.3.dylib", bin.join("libggml.0.dylib")).unwrap();
            symlink("libggml.0.dylib", bin.join("libggml.dylib")).unwrap();
        }
        harden_runtime_permissions(&fixture.runtime_root).unwrap();
        let ledger = build_runtime_ledger(&fixture.version_dir, &BINDING).unwrap();
        (fixture, ledger)
    }

    #[test]
    fn exact_runtime_tree_is_verified_with_canonical_executable() {
        let (fx, ledger) = runtime_fixture();
        ledger.check_binding(&BINDING).unwrap();
        let verified = verify_runtime_tree(&fx.runtime_root, &fx.version_dir, &ledger).unwrap();
        assert_eq!(
            verified.executable,
            fs::canonicalize(fx.bin().join("llama-server")).unwrap()
        );
        assert_eq!(verified.executable_sha256.len(), 64);
        recheck_before_spawn(&verified).unwrap();
        #[cfg(unix)]
        assert_eq!(ledger.symlinks.len(), 2);
    }

    #[test]
    fn runtime_hash_mismatch_blocks_start() {
        let (fx, ledger) = runtime_fixture();
        // Gleiche Groesse, anderer Inhalt: nur der SHA-256 erkennt den Austausch.
        let dylib = fx.bin().join("libggml.0.25.3.dylib");
        fs::write(&dylib, b"evil-bytes!").unwrap();
        let err = verify_runtime_tree(&fx.runtime_root, &fx.version_dir, &ledger).unwrap_err();
        assert!(err.to_string().contains("SHA256"), "{err}");

        let (fx, ledger) = runtime_fixture();
        let verified = verify_runtime_tree(&fx.runtime_root, &fx.version_dir, &ledger).unwrap();
        let exe = fx.bin().join("llama-server");
        fs::write(&exe, b"#!/bin/sh\nexit 1\n").unwrap();
        assert!(recheck_before_spawn(&verified).is_err());
        assert!(verify_runtime_tree(&fx.runtime_root, &fx.version_dir, &ledger).is_err());
    }

    #[test]
    fn ledger_must_match_pinned_manifest_binding() {
        let (_fx, ledger) = runtime_fixture();
        let other_archive = RuntimeBinding {
            archive_sha256: "118d82d0e88877449786480ebf58da40d24fe170f3f625a3631b07414a0bedde",
            ..BINDING
        };
        assert!(ledger.check_binding(&other_archive).is_err());
        let other_version = RuntimeBinding {
            version: "b2",
            ..BINDING
        };
        assert!(ledger.check_binding(&other_version).is_err());
        let mut escaped = ledger.clone();
        escaped.executable = "../outside/llama-server".to_string();
        assert!(escaped.check_binding(&BINDING).is_err());
    }

    #[test]
    fn injected_or_missing_runtime_files_are_rejected() {
        let (fx, ledger) = runtime_fixture();
        fs::write(fx.bin().join("libinjected.dylib"), b"x").unwrap();
        let err = verify_runtime_tree(&fx.runtime_root, &fx.version_dir, &ledger).unwrap_err();
        assert!(err.to_string().contains("Unbekannte Datei"), "{err}");

        let (fx, ledger) = runtime_fixture();
        fs::remove_file(fx.bin().join("LICENSE")).unwrap();
        let err = verify_runtime_tree(&fx.runtime_root, &fx.version_dir, &ledger).unwrap_err();
        assert!(err.to_string().contains("fehlt"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_or_outside_runtime_executable_is_blocked() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        // 1) Executable selbst durch Symlink auf eine Datei ausserhalb ersetzt.
        let (fx, ledger) = runtime_fixture();
        let outside = fx.base.join("evil-server");
        fs::write(&outside, b"#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&outside, fs::Permissions::from_mode(0o700)).unwrap();
        let exe = fx.bin().join("llama-server");
        fs::remove_file(&exe).unwrap();
        symlink(&outside, &exe).unwrap();
        let err = managed_executable_path(&fx.runtime_root, &fx.version_dir, &ledger).unwrap_err();
        assert!(err.to_string().contains("Symlink"), "{err}");
        assert!(verify_runtime_tree(&fx.runtime_root, &fx.version_dir, &ledger).is_err());

        // 2) Versionsverzeichnis ist ein Symlink auf einen Baum ausserhalb des Runtime-Roots.
        let (fx, ledger) = runtime_fixture();
        let elsewhere = fx.base.join("elsewhere");
        fs::rename(&fx.version_dir, &elsewhere).unwrap();
        symlink(&elsewhere, &fx.version_dir).unwrap();
        let err = managed_executable_path(&fx.runtime_root, &fx.version_dir, &ledger).unwrap_err();
        assert!(err.to_string().contains("Symlink"), "{err}");

        // 3) Bibliotheks-Symlink zeigt aus der Runtime heraus.
        let (fx, mut ledger) = runtime_fixture();
        let link = fx.bin().join("libggml.dylib");
        fs::remove_file(&link).unwrap();
        symlink(&outside_file(&fx), &link).unwrap();
        ledger.symlinks.insert(
            "llama-b1/libggml.dylib".to_string(),
            outside_file(&fx).to_string_lossy().into_owned(),
        );
        let err = verify_runtime_tree(&fx.runtime_root, &fx.version_dir, &ledger).unwrap_err();
        assert!(err.to_string().contains("aus der Runtime heraus"), "{err}");
    }

    #[cfg(unix)]
    fn outside_file(fx: &Fixture) -> PathBuf {
        let path = fx.base.join("outside.dylib");
        fs::write(&path, b"outside").unwrap();
        path
    }

    #[cfg(unix)]
    #[test]
    fn group_writable_runtime_is_rejected() {
        use std::os::unix::fs::PermissionsExt;
        let (fx, ledger) = runtime_fixture();
        fs::set_permissions(&fx.version_dir, fs::Permissions::from_mode(0o777)).unwrap();
        assert!(managed_executable_path(&fx.runtime_root, &fx.version_dir, &ledger).is_err());

        let (fx, ledger) = runtime_fixture();
        let dylib = fx.bin().join("libggml.0.25.3.dylib");
        fs::set_permissions(&dylib, fs::Permissions::from_mode(0o666)).unwrap();
        let err = verify_runtime_tree(&fx.runtime_root, &fx.version_dir, &ledger).unwrap_err();
        assert!(err.to_string().contains("beschreibbar"), "{err}");
    }

    #[test]
    fn dangerous_environment_never_reaches_runtime_launch() {
        let inherited = [
            ("HOME", "/home/kato"),
            ("TMPDIR", "/tmp/kato"),
            ("PATH", "/opt/evil/bin:/usr/bin"),
            ("DYLD_INSERT_LIBRARIES", "/tmp/evil.dylib"),
            ("DYLD_LIBRARY_PATH", "/tmp"),
            ("LD_PRELOAD", "/tmp/evil.so"),
            ("LD_LIBRARY_PATH", "/tmp"),
            ("HTTP_PROXY", "http://proxy.invalid:8080"),
            ("https_proxy", "http://proxy.invalid:8080"),
            ("ALL_PROXY", "socks5://proxy.invalid"),
            ("NO_PROXY", "*"),
            ("BASH_ENV", "/tmp/evil.sh"),
            ("ENV", "/tmp/evil.sh"),
            ("ZDOTDIR", "/tmp"),
            ("LLAMA_ARG_HOST", "0.0.0.0"),
            ("LLAMA_API_KEY", "secret"),
            ("GGML_METAL_PATH_RESOURCES", "/tmp"),
            ("NODE_OPTIONS", "--require /tmp/evil.js"),
            ("OPENAI_API_KEY", "sk-secret"),
            ("MallocStackLogging", "1"),
        ];
        let env = launch_environment(inherited);
        let keys: Vec<String> = env
            .keys()
            .map(|key| key.to_string_lossy().into_owned())
            .collect();
        #[cfg(unix)]
        {
            assert_eq!(keys, vec!["HOME", "PATH", "TMPDIR"]);
            assert_eq!(env[&OsString::from("PATH")], OsString::from(SAFE_PATH));
        }
        for (name, _) in inherited {
            if name != "HOME" && name != "TMPDIR" && name != "PATH" {
                assert!(
                    !keys.iter().any(|key| key == name),
                    "{name} darf nicht durch"
                );
            }
        }
        for name in [
            "DYLD_FOO",
            "LD_AUDIT",
            "FTP_PROXY",
            "LLAMA_ARG_PORT",
            "BASH_ENV",
        ] {
            assert!(is_blocked_env(name), "{name}");
        }

        // Der tatsaechlich konfigurierte Command traegt nur die Allowlist (env_clear + envs).
        let mut command = Command::new("/bin/echo");
        harden_launch(&mut command);
        let launched: Vec<String> = command
            .get_envs()
            .filter(|(_, value)| value.is_some())
            .map(|(key, _)| key.to_string_lossy().into_owned())
            .collect();
        assert!(launched.iter().all(|key| env_allowed(key) || key == "PATH"));
        assert!(launched.iter().all(|key| !is_blocked_env(key)));
    }

    #[test]
    fn private_metadata_roundtrip_and_corruption_fail_closed() {
        let (fx, ledger) = runtime_fixture();
        let path = ledger_path(&fx.base, "b1").unwrap();
        save_private_json(&path, &ledger).unwrap();
        let loaded: RuntimeLedger = load_private_json(&path).unwrap().unwrap();
        assert_eq!(loaded, ledger);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        fs::write(&path, b"{not json").unwrap();
        assert!(load_private_json::<RuntimeLedger>(&path).is_err());
        assert!(ledger_path(&fx.base, "../escape").is_err());
        assert!(
            load_private_json::<RuntimeLedger>(&fx.base.join("missing.json"))
                .unwrap()
                .is_none()
        );
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    mod ownership {
        use super::super::*;
        use std::net::TcpListener;

        fn current_exe() -> PathBuf {
            fs::canonicalize(std::env::current_exe().unwrap()).unwrap()
        }

        const SHA: &str = "1ef6db9f1913725a9a7522f1719e987c88329f266e906270436b23d662985a20";

        fn launch(exe: &Path, port: u16) -> LaunchIdentity<'_> {
            LaunchIdentity {
                executable: exe,
                executable_sha256: SHA,
                runtime_version: "b1",
                port,
                model_alias: "kato-local-brain",
            }
        }

        #[test]
        fn listener_detection_binds_exact_pid_and_loopback_address() {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            assert!(process_listens_on_loopback(std::process::id(), port));

            let free = TcpListener::bind("127.0.0.1:0").unwrap();
            let free_port = free.local_addr().unwrap().port();
            drop(free);
            assert!(!process_listens_on_loopback(std::process::id(), free_port));

            // Wildcard-Listener belegen keinen Loopback-Besitz.
            let wildcard = TcpListener::bind("0.0.0.0:0").unwrap();
            let wildcard_port = wildcard.local_addr().unwrap().port();
            assert!(!process_listens_on_loopback(
                std::process::id(),
                wildcard_port
            ));

            // Ein anderer Prozess haelt diesen Listener nicht.
            let mut other = Command::new("/bin/sleep").arg("30").spawn().unwrap();
            assert!(!process_listens_on_loopback(other.id(), port));
            terminate_child(&mut other, Duration::from_secs(2));
        }

        #[test]
        fn exact_managed_runtime_identity_is_accepted() {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let exe = current_exe();
            let identity = launch(&exe, port);
            let record = OwnershipRecord::capture(std::process::id(), &identity).unwrap();
            let live = verify_ownership(&record, &identity, true).unwrap();
            assert_eq!(live.pid, std::process::id());
        }

        #[test]
        fn unknown_preexisting_listener_is_rejected_as_managed() {
            // Ein fremder Listener haelt den Port; KatoSync hat dafuer keinen Nachweis.
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let exe = current_exe();

            // Datensatz fuer einen echten, aber nicht lauschenden Prozess: abgelehnt.
            let mut sleeper = Command::new("/bin/sleep").arg("30").spawn().unwrap();
            let sleeper_exe = fs::canonicalize(
                inspect_process(sleeper.id())
                    .and_then(|live| live.executable)
                    .unwrap(),
            )
            .unwrap();
            let sleeper_launch = launch(&sleeper_exe, port);
            let record = OwnershipRecord::capture(sleeper.id(), &sleeper_launch).unwrap();
            assert_eq!(
                verify_ownership(&record, &sleeper_launch, true),
                Err(OwnershipFailure::NotListening)
            );
            // Gleicher Datensatz, aber eine andere erwartete Runtime: abgelehnt.
            assert_eq!(
                verify_ownership(&record, &launch(&exe, port), true),
                Err(OwnershipFailure::RecordMismatch)
            );
            terminate_child(&mut sleeper, Duration::from_secs(2));

            // Gefaelschter Datensatz: lauschende PID, aber fremdes Executable.
            let mut forged =
                OwnershipRecord::capture(std::process::id(), &launch(&exe, port)).unwrap();
            forged.executable = sleeper_exe.clone();
            assert_eq!(
                verify_ownership(&forged, &launch(&sleeper_exe, port), true),
                Err(OwnershipFailure::ForeignExecutable)
            );

            // Kapern beim Start: Executable passt nicht zur verifizierten Runtime.
            assert!(
                OwnershipRecord::capture(std::process::id(), &launch(&sleeper_exe, port)).is_err()
            );
        }

        #[test]
        fn pid_reuse_or_stale_ownership_record_fails_closed() {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let exe = current_exe();
            let identity = launch(&exe, port);

            // Gleiche PID, andere Startidentitaet == wiederverwendete PID.
            let mut reused = OwnershipRecord::capture(std::process::id(), &identity).unwrap();
            reused.process_start = "darwin:1.000000".to_string();
            assert_eq!(
                verify_ownership(&reused, &identity, true),
                Err(OwnershipFailure::PidReused)
            );

            // Beendeter Prozess: Datensatz ist veraltet.
            let mut gone = Command::new("/bin/sleep").arg("30").spawn().unwrap();
            let gone_exe = fs::canonicalize(
                inspect_process(gone.id())
                    .and_then(|live| live.executable)
                    .unwrap(),
            )
            .unwrap();
            let gone_launch = launch(&gone_exe, port);
            let stale = OwnershipRecord::capture(gone.id(), &gone_launch).unwrap();
            terminate_child(&mut gone, Duration::from_secs(2));
            assert!(verify_ownership(&stale, &gone_launch, false).is_err());

            // Persistierter Datensatz mit unbekanntem Feld wird nicht akzeptiert.
            let dir = std::env::temp_dir()
                .join(format!("katosync-owner-{}", uuid::Uuid::new_v4().simple()));
            let path = owner_record_path(&dir);
            let mut value = serde_json::to_value(&reused).unwrap();
            value["trusted"] = true.into();
            save_private_json(&path, &value).unwrap();
            assert!(load_private_json::<OwnershipRecord>(&path).is_err());
            fs::remove_dir_all(dir).ok();
        }

        #[test]
        fn terminate_child_stops_whole_process_group() {
            let mut command = Command::new("/bin/sh");
            command
                .args(["-c", "/bin/sleep 30 & echo $!; wait"])
                .stdout(Stdio::piped());
            harden_launch(&mut command);
            let mut child = command.spawn().unwrap();
            let mut line = String::new();
            {
                use std::io::BufRead;
                let stdout = child.stdout.take().unwrap();
                std::io::BufReader::new(stdout)
                    .read_line(&mut line)
                    .unwrap();
            }
            let grandchild: u32 = line.trim().parse().unwrap();
            let leader = inspect_process(child.id()).unwrap();
            assert_eq!(leader.pgid, Some(child.id()), "eigene Prozessgruppe");
            assert!(inspect_process(grandchild).is_some());

            terminate_child(&mut child, Duration::from_secs(2));
            let deadline = Instant::now() + Duration::from_secs(3);
            while inspect_process(grandchild).is_some() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(50));
            }
            assert!(
                inspect_process(grandchild).is_none(),
                "Enkelprozess der Runtime muss mit beendet werden"
            );
        }
    }
}
