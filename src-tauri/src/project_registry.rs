// Created by NMKato Solutions
// Project Registry – Dateisystem-/Git-Adapter. Strikt READ-ONLY gegenueber den Projekten:
// - Git laeuft nur mit lesenden Unterbefehlen, getrennten Argumenten (keine Shell) und ohne Locks/Fsmonitor.
// - Es werden nur feste, allowlist-basierte Dokumente gelesen (AGENTS/README/Status/Handoff/Memory/RACK/…).
// - .env*, Schluessel/Zertifikate, node_modules, Build-Ausgaben, Caches und versteckte Ordner werden nie
//   betreten; Dateien mit Secret-Mustern werden nicht ausgeliefert.
// - Remote-URLs verlassen diesen Adapter ohne Zugangsdaten.
// Die fachliche Auswertung (Gruppierung, Verifikation, Capsule, Fokus) liegt rein in src/lib/project*.ts.
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::OnceLock,
    thread,
    time::{Duration, Instant, SystemTime},
};

const MAX_DEPTH: usize = 3;
const MAX_VISITED_DIRS: usize = 1500;
const MAX_REPOS: usize = 80;
const MAX_WORKTREES: usize = 24;
const MAX_WORKTREE_STATUS: usize = 12;
const MAX_RECENT_SHAS: usize = 200;
const MAX_GIT_OUTPUT: u64 = 4 * 1024 * 1024;
const GIT_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_DOC_BYTES: u64 = 256 * 1024;
const MAX_DOC_READ: u64 = 64 * 1024;
const MAX_DOCS: usize = 24;
const MAX_REGISTRY_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ICON_BYTES: u64 = 512 * 1024;

// Spiegel von src/lib/projectExclusions.ts (EXCLUDED_DIR_NAMES). Versteckte Ordner sind generell tabu.
const EXCLUDED_DIR_NAMES: &[&str] = &[
    "node_modules",
    "deriveddata",
    "build",
    "dist",
    "out",
    "target",
    "pods",
    "carthage",
    "coverage",
    "venv",
    "__pycache__",
    "__macosx",
    "library",
    "applications",
    "secrets",
    "private",
    "keys",
    "credentials",
];

// ===== Ausschluss-Regeln =====
pub(crate) fn is_excluded_dir_name(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    lower.is_empty() || lower.starts_with('.') || EXCLUDED_DIR_NAMES.contains(&lower.as_str())
}

fn secret_file_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)(^\.env(\.|$)|secret|apikey|api_key|private_key|credential|\.pem$|\.key$|\.p12$|\.pfx$|\.p8$|\.cer$|\.crt$|\.jks$|\.keystore$|\.mobileprovision$|^id_(rsa|dsa|ecdsa|ed25519)|^\.npmrc$|^\.netrc$|^\.pypirc$|\.tfvars$)",
        )
        .expect("Secret-Dateiname-RegEx ist statisch gueltig")
    })
}

pub(crate) fn is_secret_file_name(name: &str) -> bool {
    secret_file_regex().is_match(name.trim())
}

pub(crate) fn has_secret_content(text: &str) -> bool {
    // Gleiche Muster wie der bestehende Scan (Quelle der Wahrheit in lib.rs).
    super::secret_regex().is_match(text)
}

/// https://user:token@host/x -> https://host/x (auch fuer andere Schemata). scp-Form bleibt unveraendert.
pub(crate) fn sanitize_remote_url(url: &str) -> Option<String> {
    let value = url.trim();
    if value.is_empty() {
        return None;
    }
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"(?i)^([a-z][a-z0-9+.\-]*://)[^/@\s]*@").expect("statisch gueltig")
    });
    Some(re.replace(value, "$1").into_owned())
}

// ===== Datentypen (camelCase, 1:1 zu src/types.ts) =====
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeFact {
    path: String,
    branch: Option<String>,
    head_sha: Option<String>,
    detached: bool,
    locked: bool,
    dirty_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepoFacts {
    path: String,
    common_dir: Option<String>,
    main_worktree_path: Option<String>,
    is_linked_worktree: bool,
    remote: Option<String>,
    branch: Option<String>,
    detached: bool,
    head_sha: Option<String>,
    head_date: Option<String>,
    dirty_count: usize,
    untracked_count: usize,
    ahead: Option<usize>,
    behind: Option<usize>,
    recent_shas: Vec<String>,
    worktrees: Vec<WorktreeFact>,
    icon_data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocFact {
    path: String,
    kind: String,
    bytes: u64,
    modified_at: Option<String>,
    content: Option<String>,
    excluded: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFact {
    kind: String,
    path: String,
    name: Option<String>,
    version: Option<String>,
    hints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProbe {
    repo: RepoFacts,
    docs: Vec<DocFact>,
    manifests: Vec<ManifestFact>,
    scanned_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryResult {
    root: String,
    repos: Vec<RepoFacts>,
    scanned_dirs: usize,
    truncated: bool,
    skipped_excluded: usize,
}

// ===== Git (nur lesend) =====
fn git_bin() -> String {
    for candidate in [
        "/usr/bin/git",
        "/opt/homebrew/bin/git",
        "/usr/local/bin/git",
    ] {
        if Path::new(candidate).exists() {
            return candidate.to_string();
        }
    }
    "git".to_string()
}

/// Fuehrt einen lesenden Git-Befehl strukturiert aus (kein Shell-String). `core.fsmonitor=false` verhindert,
/// dass eine Repo-Konfiguration beim Scan fremden Code startet; Locks werden nicht genommen.
fn run_git(dir: &Path, args: &[&str]) -> Option<Vec<u8>> {
    let mut child = Command::new(git_bin())
        .arg("-c")
        .arg("core.fsmonitor=false")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let stdout = child.stdout.take()?;
    let reader = thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout.take(MAX_GIT_OUTPUT).read_to_end(&mut buffer);
        buffer
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = reader.join().ok()?;
                return status.success().then_some(output);
            }
            Ok(None) => {
                if started.elapsed() > GIT_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = reader.join();
                    return None;
                }
                thread::sleep(Duration::from_millis(15));
            }
            Err(_) => return None,
        }
    }
}

fn git_text(dir: &Path, args: &[&str]) -> Option<String> {
    let output = run_git(dir, args)?;
    let text = String::from_utf8_lossy(&output).trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// Zaehlt Eintraege der `status --porcelain=v1 -z`-Ausgabe: (gesamt, untracked). Umbenennungen tragen
/// einen zweiten Pfad-Token, der nicht mitgezaehlt wird. Dateinamen werden nie weitergegeben.
pub(crate) fn count_status(raw: &[u8]) -> (usize, usize) {
    let mut total = 0;
    let mut untracked = 0;
    let mut tokens = raw
        .split(|byte| *byte == 0)
        .filter(|token| !token.is_empty());
    while let Some(token) = tokens.next() {
        if token.len() < 3 {
            continue;
        }
        total += 1;
        if token.starts_with(b"??") {
            untracked += 1;
        }
        if matches!(token[0], b'R' | b'C') || matches!(token[1], b'R' | b'C') {
            let _ = tokens.next();
        }
    }
    (total, untracked)
}

fn status_counts(dir: &Path) -> Option<(usize, usize)> {
    let raw = run_git(
        dir,
        &["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
    )?;
    Some(count_status(&raw))
}

fn real_path(path: &Path) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

fn absolute_git_path(repo: &Path, args: &[&str]) -> Option<String> {
    let text = git_text(repo, args)?;
    let path = PathBuf::from(&text);
    let absolute = if path.is_absolute() {
        path
    } else {
        repo.join(path)
    };
    Some(real_path(&absolute))
}

/// Parst `git worktree list --porcelain` (Bloecke durch Leerzeile getrennt; erster Block = Haupt-Worktree).
pub(crate) fn parse_worktrees(text: &str) -> Vec<WorktreeFact> {
    let mut result = Vec::new();
    for block in text.split("\n\n") {
        let mut fact = WorktreeFact {
            path: String::new(),
            branch: None,
            head_sha: None,
            detached: false,
            locked: false,
            dirty_count: None,
        };
        for line in block.lines() {
            if let Some(value) = line.strip_prefix("worktree ") {
                fact.path = value.trim().to_string();
            } else if let Some(value) = line.strip_prefix("HEAD ") {
                fact.head_sha = Some(value.trim().to_string());
            } else if let Some(value) = line.strip_prefix("branch ") {
                fact.branch = Some(value.trim().trim_start_matches("refs/heads/").to_string());
            } else if line.trim() == "detached" {
                fact.detached = true;
            } else if line.starts_with("locked") {
                fact.locked = true;
            }
        }
        if !fact.path.is_empty() {
            result.push(fact);
        }
        if result.len() >= MAX_WORKTREES {
            break;
        }
    }
    result
}

/// Finds a small, presentation-only project logo without walking the repository.
/// Only a fixed allow-list of conventional logo/icon locations is considered.
fn project_icon_data_url(root: &Path) -> Option<String> {
    const CANDIDATES: &[&str] = &[
        "docs/images/logo.png",
        "public/logo.png",
        "public/icon.png",
        "public/app-icon.png",
        "public/katoos_icon_logo_trans.png",
        "apps/desktop/public/kai-logo.png",
        "src/assets/logo.png",
        "src/assets/icon.png",
        "assets/logo.png",
        "assets/icon.png",
        "src-tauri/icons/128x128.png",
        "src-tauri/icons/icon.png",
        "public/logo.webp",
        "public/icon.webp",
        "assets/logo.webp",
        "assets/icon.webp",
        "public/logo.svg",
        "public/icon.svg",
        "assets/logo.svg",
        "assets/icon.svg",
    ];

    for relative in CANDIDATES {
        let path = root.join(relative);
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_ICON_BYTES {
            continue;
        }
        let mime = match path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
        {
            Some(ext) if ext == "png" => "image/png",
            Some(ext) if ext == "webp" => "image/webp",
            Some(ext) if ext == "jpg" || ext == "jpeg" => "image/jpeg",
            Some(ext) if ext == "svg" => "image/svg+xml",
            _ => continue,
        };
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        return Some(format!(
            "data:{mime};base64,{}",
            BASE64_STANDARD.encode(bytes)
        ));
    }
    None
}

/// Liest die Git-Fakten eines Checkouts. `status_all` = auch Aenderungen der anderen Worktrees zaehlen.
fn probe_repo(path: &Path, status_all: bool) -> Option<RepoFacts> {
    let top = git_text(path, &["rev-parse", "--show-toplevel"])?;
    let top_path = PathBuf::from(real_path(Path::new(&top)));
    let top_string = top_path.to_string_lossy().into_owned();
    let common_dir = absolute_git_path(
        &top_path,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .or_else(|| absolute_git_path(&top_path, &["rev-parse", "--git-common-dir"]));
    let git_dir = absolute_git_path(
        &top_path,
        &["rev-parse", "--path-format=absolute", "--git-dir"],
    )
    .or_else(|| absolute_git_path(&top_path, &["rev-parse", "--git-dir"]));
    let is_linked = matches!((&common_dir, &git_dir), (Some(common), Some(dir)) if common != dir);

    let remote_url = git_text(&top_path, &["remote", "get-url", "origin"]).or_else(|| {
        let first = git_text(&top_path, &["remote"])?
            .lines()
            .next()?
            .to_string();
        git_text(&top_path, &["remote", "get-url", &first])
    });
    let remote = remote_url.as_deref().and_then(sanitize_remote_url);

    let branch = git_text(&top_path, &["symbolic-ref", "--short", "-q", "HEAD"]);
    let head_sha = git_text(&top_path, &["rev-parse", "HEAD"]);
    let detached = branch.is_none() && head_sha.is_some();
    let head_date = git_text(&top_path, &["log", "-1", "--format=%cI"]);
    let (dirty_count, untracked_count) = status_counts(&top_path).unwrap_or((0, 0));

    let (behind, ahead) = git_text(
        &top_path,
        &["rev-list", "--left-right", "--count", "@{u}...HEAD"],
    )
    .and_then(|text| {
        let mut parts = text.split_whitespace();
        Some((
            parts.next()?.parse::<usize>().ok()?,
            parts.next()?.parse::<usize>().ok()?,
        ))
    })
    .map_or((None, None), |(behind, ahead)| (Some(behind), Some(ahead)));

    let max = MAX_RECENT_SHAS.to_string();
    let recent_shas = git_text(&top_path, &["log", "-n", &max, "--format=%h"])
        .map(|text| {
            text.lines()
                .map(|line| line.trim().to_string())
                .filter(|line| !line.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let mut worktrees = git_text(&top_path, &["worktree", "list", "--porcelain"])
        .map(|text| parse_worktrees(&text))
        .unwrap_or_default();
    let main_worktree_path = worktrees
        .first()
        .map(|entry| real_path(Path::new(&entry.path)));
    let mut checked = 0;
    for entry in worktrees.iter_mut() {
        let entry_real = real_path(Path::new(&entry.path));
        if entry_real == top_string {
            entry.dirty_count = Some(dirty_count);
        } else if status_all && checked < MAX_WORKTREE_STATUS && Path::new(&entry.path).is_dir() {
            checked += 1;
            entry.dirty_count = status_counts(Path::new(&entry.path)).map(|counts| counts.0);
        }
    }
    Some(RepoFacts {
        path: top_string,
        common_dir,
        main_worktree_path,
        is_linked_worktree: is_linked,
        remote,
        branch,
        detached,
        head_sha,
        head_date,
        dirty_count,
        untracked_count,
        ahead,
        behind,
        recent_shas,
        worktrees,
        icon_data_url: project_icon_data_url(&top_path),
    })
}

// ===== Discovery =====
fn is_real_dir(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|meta| meta.is_dir())
        .unwrap_or(false)
}

fn has_git_entry(dir: &Path) -> bool {
    fs::symlink_metadata(dir.join(".git")).is_ok()
}

/// Sucht Git-Repositories unterhalb von `root` (oder `root` selbst). Beschraenkt in Tiefe und Anzahl,
/// betritt keine ausgeschlossenen/versteckten Ordner, folgt keinen Symlinks und steigt nicht in Repos ab.
pub(crate) fn discover(root: &Path) -> Result<DiscoveryResult, String> {
    if !root.is_dir() {
        return Err("Der gewählte Pfad ist kein Ordner.".to_string());
    }
    let root_real = PathBuf::from(real_path(root));
    let mut result = DiscoveryResult {
        root: root_real.to_string_lossy().into_owned(),
        repos: Vec::new(),
        scanned_dirs: 0,
        truncated: false,
        skipped_excluded: 0,
    };

    // Einzelnes Projekt (oder Unterordner eines Repos): ueber den Git-Toplevel aufloesen.
    if has_git_entry(&root_real) {
        if let Some(facts) = probe_repo(&root_real, false) {
            result.repos.push(facts);
        }
        return Ok(result);
    }

    let mut queue: Vec<(PathBuf, usize)> = vec![(root_real.clone(), 0)];
    let mut seen_repos = BTreeSet::new();
    while let Some((dir, depth)) = queue.pop() {
        let mut names: Vec<_> = match fs::read_dir(&dir) {
            Ok(entries) => entries.filter_map(|entry| entry.ok()).collect(),
            Err(_) => continue,
        };
        names.sort_by_key(|entry| entry.file_name());
        for entry in names {
            let path = entry.path();
            if !is_real_dir(&path) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_excluded_dir_name(&name) {
                result.skipped_excluded += 1;
                continue;
            }
            result.scanned_dirs += 1;
            if result.scanned_dirs > MAX_VISITED_DIRS || result.repos.len() >= MAX_REPOS {
                result.truncated = true;
                return Ok(result);
            }
            if has_git_entry(&path) {
                if let Some(facts) = probe_repo(&path, false) {
                    // Viele parallele Worktrees desselben Repositories zaehlen fuer die Workspace-Suche
                    // nur einmal. probe_repo liefert bereits die komplette Worktree-Liste.
                    let identity = facts
                        .remote
                        .clone()
                        .or_else(|| facts.common_dir.clone())
                        .unwrap_or_else(|| facts.path.clone());
                    if seen_repos.insert(identity) {
                        result.repos.push(facts);
                    }
                }
            } else if depth + 1 < MAX_DEPTH {
                queue.push((path, depth + 1));
            }
        }
    }
    result.repos.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}

// ===== Dokumente & Manifeste =====
fn doc_kind(file_name: &str) -> Option<&'static str> {
    let lower = file_name.to_lowercase();
    if lower.starts_with('.') {
        return None;
    }
    let (stem, extension) = lower.rsplit_once('.')?;
    if !matches!(extension, "md" | "markdown" | "txt") {
        return None;
    }
    static RACK: OnceLock<Regex> = OnceLock::new();
    let rack =
        RACK.get_or_init(|| Regex::new(r"(^|[_.\- ])rack([_.\- ]|$)").expect("statisch gueltig"));
    if stem == "agents" {
        Some("agents")
    } else if stem.starts_with("readme") {
        Some("readme")
    } else if [
        "projektstatus",
        "project_status",
        "projectstatus",
        "statusflow",
        "status_flow",
        "status-flow",
    ]
    .iter()
    .any(|key| stem.contains(key))
    {
        Some("status")
    } else if ["handoff", "hand_off", "hand-off", "uebergabe"]
        .iter()
        .any(|key| stem.contains(key))
    {
        Some("handoff")
    } else if stem.starts_with("memory") {
        Some("memory")
    } else if rack.is_match(stem) {
        Some("rack")
    } else if stem.starts_with("context") {
        Some("context")
    } else if stem.starts_with("architecture") || stem.starts_with("architektur") {
        Some("architecture")
    } else {
        None
    }
}

fn iso_time(time: SystemTime) -> Option<String> {
    let datetime: chrono::DateTime<chrono::Utc> = time.into();
    Some(datetime.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

fn read_doc(root: &Path, relative: &str, kind: &str) -> DocFact {
    let path = root.join(relative);
    let mut fact = DocFact {
        path: relative.to_string(),
        kind: kind.to_string(),
        bytes: 0,
        modified_at: None,
        content: None,
        excluded: None,
    };
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    if is_secret_file_name(&name) {
        fact.excluded = Some("secret_name".to_string());
        return fact;
    }
    let Ok(meta) = fs::symlink_metadata(&path) else {
        fact.excluded = Some("unreadable".to_string());
        return fact;
    };
    // Symlinks nie folgen (koennten aus dem Projekt herausfuehren).
    if !meta.is_file() {
        fact.excluded = Some("unreadable".to_string());
        return fact;
    }
    fact.bytes = meta.len();
    fact.modified_at = meta.modified().ok().and_then(iso_time);
    if meta.len() > MAX_DOC_BYTES {
        fact.excluded = Some("too_large".to_string());
        return fact;
    }
    let mut buffer = Vec::new();
    match fs::File::open(&path).and_then(|file| file.take(MAX_DOC_READ).read_to_end(&mut buffer)) {
        Ok(_) => {
            let text = String::from_utf8_lossy(&buffer).into_owned();
            if has_secret_content(&text) {
                fact.excluded = Some("secret_pattern".to_string());
            } else {
                fact.content = Some(text);
            }
        }
        Err(_) => fact.excluded = Some("unreadable".to_string()),
    }
    fact
}

fn collect_docs(root: &Path) -> Vec<DocFact> {
    let mut found: Vec<(String, &'static str)> = Vec::new();
    for folder in ["", "docs"] {
        let dir = if folder.is_empty() {
            root.to_path_buf()
        } else {
            root.join(folder)
        };
        if folder == "docs" && !is_real_dir(&dir) {
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.filter_map(|entry| entry.ok()) {
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(kind) = doc_kind(&name) {
                let relative = if folder.is_empty() {
                    name
                } else {
                    format!("{folder}/{name}")
                };
                found.push((relative, kind));
            }
        }
    }
    found.sort();
    found.truncate(MAX_DOCS);
    found
        .iter()
        .map(|(relative, kind)| read_doc(root, relative, kind))
        .collect()
}

const KNOWN_DEPENDENCIES: &[(&str, &str)] = &[
    ("react", "React"),
    ("vite", "Vite"),
    ("next", "Next.js"),
    ("vue", "Vue"),
    ("svelte", "Svelte"),
    ("express", "Express"),
    ("typescript", "TypeScript"),
    ("tailwindcss", "Tailwind"),
    ("electron", "Electron"),
    ("expo", "Expo"),
    ("react-native", "React Native"),
    ("@tauri-apps/api", "Tauri"),
    ("@supabase/supabase-js", "Supabase"),
    ("playwright", "Playwright"),
];

fn package_json_manifest(path: &Path, relative: &str) -> Option<ManifestFact> {
    let value: serde_json::Value = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    let mut hints = Vec::new();
    for section in ["dependencies", "devDependencies"] {
        if let Some(map) = value.get(section).and_then(|entry| entry.as_object()) {
            for (needle, label) in KNOWN_DEPENDENCIES {
                if map.contains_key(*needle) && !hints.iter().any(|hint| hint == label) {
                    hints.push((*label).to_string());
                }
            }
        }
    }
    // Nur Name/Version/Framework-Labels – nie scripts, Pfade oder andere Werte.
    Some(ManifestFact {
        kind: "package.json".to_string(),
        path: relative.to_string(),
        name: value
            .get("name")
            .and_then(|entry| entry.as_str())
            .map(str::to_string),
        version: value
            .get("version")
            .and_then(|entry| entry.as_str())
            .map(str::to_string),
        hints,
    })
}

fn cargo_manifest(path: &Path, relative: &str) -> Option<ManifestFact> {
    let text = fs::read_to_string(path).ok()?;
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r#"(?m)^\s*(name|version)\s*=\s*"([^"]+)""#).expect("statisch gueltig")
    });
    let package = text
        .split("[package]")
        .nth(1)?
        .split("\n[")
        .next()
        .unwrap_or_default()
        .to_string();
    let mut name = None;
    let mut version = None;
    for capture in re.captures_iter(&package) {
        match &capture[1] {
            "name" if name.is_none() => name = Some(capture[2].to_string()),
            "version" if version.is_none() => version = Some(capture[2].to_string()),
            _ => {}
        }
    }
    let mut hints = vec!["Rust".to_string()];
    if text.contains("tauri") {
        hints.push("Tauri".to_string());
    }
    Some(ManifestFact {
        kind: "Cargo.toml".to_string(),
        path: relative.to_string(),
        name,
        version,
        hints,
    })
}

fn collect_manifests(root: &Path) -> Vec<ManifestFact> {
    let mut manifests = Vec::new();
    if let Some(fact) = package_json_manifest(&root.join("package.json"), "package.json") {
        manifests.push(fact);
    }
    for relative in ["Cargo.toml", "src-tauri/Cargo.toml"] {
        let path = root.join(relative);
        if fs::symlink_metadata(&path)
            .map(|meta| meta.is_file())
            .unwrap_or(false)
        {
            if let Some(fact) = cargo_manifest(&path, relative) {
                manifests.push(fact);
            }
        }
    }
    for (file, kind, hint) in [
        ("Package.swift", "Package.swift", "Swift"),
        ("pyproject.toml", "pyproject.toml", "Python"),
        ("go.mod", "go.mod", "Go"),
        ("pom.xml", "pom.xml", "Java"),
        ("build.gradle", "build.gradle", "Gradle"),
        ("build.gradle.kts", "build.gradle.kts", "Gradle"),
        ("composer.json", "composer.json", "PHP"),
    ] {
        if fs::symlink_metadata(root.join(file))
            .map(|meta| meta.is_file())
            .unwrap_or(false)
        {
            manifests.push(ManifestFact {
                kind: kind.to_string(),
                path: file.to_string(),
                name: None,
                version: None,
                hints: vec![hint.to_string()],
            });
        }
    }
    if let Ok(entries) = fs::read_dir(root) {
        let mut names: Vec<String> = entries
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".xcodeproj") && !name.starts_with('.'))
            .collect();
        names.sort();
        for name in names.into_iter().take(2) {
            manifests.push(ManifestFact {
                kind: "xcodeproj".to_string(),
                path: name,
                name: None,
                version: None,
                hints: vec!["Xcode".to_string()],
            });
        }
    }
    manifests
}

pub(crate) fn scan(root: &Path) -> Result<ProjectProbe, String> {
    if !root.is_dir() {
        return Err("Projektordner nicht gefunden.".to_string());
    }
    let repo = probe_repo(root, true).ok_or_else(|| "Kein Git-Repository gefunden.".to_string())?;
    let repo_root = PathBuf::from(&repo.path);
    Ok(ProjectProbe {
        docs: collect_docs(&repo_root),
        manifests: collect_manifests(&repo_root),
        repo,
        scanned_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    })
}

// ===== Registry-Persistenz (lokal, atomar, ohne Secrets) =====
fn registry_path() -> Result<PathBuf, String> {
    Ok(super::app_support_dir()
        .map_err(super::error_to_string)?
        .join("project-registry.json"))
}

pub(crate) fn load_registry_from(path: &Path) -> Result<Option<serde_json::Value>, String> {
    let meta = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(_) => return Ok(None),
    };
    let parsed = if meta.len() <= MAX_REGISTRY_BYTES {
        fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
    } else {
        None
    };
    match parsed {
        Some(value) if value.is_object() => Ok(Some(value)),
        _ => {
            // Beschaedigte Datei nicht ueberschreiben: beiseitelegen und neu starten.
            let stamp = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let backup = path.with_file_name(format!("project-registry.corrupt-{stamp}.json"));
            let _ = fs::rename(path, backup);
            Ok(None)
        }
    }
}

pub(crate) fn save_registry_to(path: &Path, registry: &serde_json::Value) -> Result<(), String> {
    if !registry
        .get("schemaVersion")
        .map(|value| value == 1)
        .unwrap_or(false)
        || !registry
            .get("projects")
            .map(|value| value.is_array())
            .unwrap_or(false)
    {
        return Err("Ungültige Registry-Struktur.".to_string());
    }
    let text = serde_json::to_string_pretty(registry)
        .map_err(|_| "Registry konnte nicht serialisiert werden.".to_string())?;
    if text.len() as u64 > MAX_REGISTRY_BYTES {
        return Err("Registry ist zu groß.".to_string());
    }
    if has_secret_content(&text) {
        return Err("Registry enthält ein Secret-Muster und wurde nicht gespeichert.".to_string());
    }
    let temp = path.with_extension("json.tmp");
    // Grund ohne Pfad melden (io::Error-Display enthaelt keinen Pfad), damit das Banner diagnostizierbar bleibt.
    fs::write(&temp, text)
        .map_err(|error| format!("Registry konnte nicht geschrieben werden ({error})."))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&temp, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&temp, path).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("Registry konnte nicht gespeichert werden ({error}).")
    })
}

/// Liefert wenige typische lokale Workspace-Wurzeln fuer eine explizit gestartete Auto-Suche.
/// Kein rekursiver Home-Scan: nur bereits bekannte Projekteltern + konventionelle Entwicklerordner.
pub(crate) fn smart_workspace_roots(existing_project_roots: &[String]) -> Vec<String> {
    let mut roots = BTreeSet::new();

    for raw in existing_project_roots {
        let path = Path::new(raw);
        if path.is_dir() {
            if let Some(parent) = path.parent() {
                if parent.is_dir() {
                    roots.insert(real_path(parent));
                }
            }
        }
    }

    if let Some(home) = dirs::home_dir() {
        for relative in [
            "Projects",
            "Developer",
            "Development",
            "Documents/Projects",
            "Documents/Developer",
        ] {
            let candidate = home.join(relative);
            if candidate.is_dir() {
                roots.insert(real_path(&candidate));
            }
        }
    }

    roots.into_iter().take(12).collect()
}

// ===== Tauri-Commands =====
#[tauri::command]
pub(crate) fn project_registry_smart_roots(existing_project_roots: Vec<String>) -> Vec<String> {
    smart_workspace_roots(&existing_project_roots)
}

#[tauri::command]
pub(crate) async fn project_registry_discover(root: String) -> Result<DiscoveryResult, String> {
    tauri::async_runtime::spawn_blocking(move || discover(Path::new(&root)))
        .await
        .map_err(|_| "Suche wurde unterbrochen.".to_string())?
}

#[tauri::command]
pub(crate) async fn project_registry_scan(root: String) -> Result<ProjectProbe, String> {
    tauri::async_runtime::spawn_blocking(move || scan(Path::new(&root)))
        .await
        .map_err(|_| "Prüfung wurde unterbrochen.".to_string())?
}

#[tauri::command]
pub(crate) fn project_registry_load() -> Result<Option<serde_json::Value>, String> {
    load_registry_from(&registry_path()?)
}

#[tauri::command]
pub(crate) fn project_registry_save(registry: serde_json::Value) -> Result<(), String> {
    save_registry_to(&registry_path()?, &registry)
}

/// Oeffnet den Projektordner im Dateimanager. Nur existierende Ordner, die ein Git-Repository sind;
/// Pfad wird als getrenntes Argument uebergeben (keine Shell).
#[tauri::command]
pub(crate) fn project_registry_open(path: String) -> Result<(), String> {
    let dir = Path::new(&path);
    if !is_real_dir(dir) || !has_git_entry(dir) {
        return Err("Projektordner nicht gefunden.".to_string());
    }
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(dir).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer.exe").arg(dir).status();
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let status = Command::new("xdg-open").arg(dir).status();
    match status {
        Ok(_) => Ok(()),
        Err(_) => Err("Ordner konnte nicht geöffnet werden.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "katosync-registry-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        PathBuf::from(real_path(&dir))
    }

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args([
                "-c",
                "user.name=T",
                "-c",
                "user.email=t@example.invalid",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?} fehlgeschlagen");
    }

    fn init_repo(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        git(dir, &["init", "-q", "-b", "main"]);
        fs::write(
            dir.join("README.md"),
            "# Demo\n\nEin Demo-Projekt fuer Tests.\n",
        )
        .unwrap();
        git(dir, &["add", "README.md"]);
        git(dir, &["commit", "-q", "-m", "init"]);
    }

    #[test]
    fn smart_roots_include_parent_of_known_project() {
        let parent = temp_dir("smart-roots");
        let project = parent.join("demo");
        fs::create_dir_all(&project).unwrap();
        let roots = smart_workspace_roots(&[project.to_string_lossy().into_owned()]);
        assert!(roots.contains(&real_path(&parent)));
        let _ = fs::remove_dir_all(parent);
    }

    #[test]
    fn excludes_hidden_build_and_secret_names() {
        for name in [
            "node_modules",
            "DerivedData",
            "build",
            "dist",
            "target",
            "Pods",
            ".cache",
            ".git",
            ".ssh",
            "Library",
        ] {
            assert!(is_excluded_dir_name(name), "{name}");
        }
        assert!(!is_excluded_dir_name("KatoSync"));
        for name in [
            ".env",
            ".env.local",
            "id_rsa",
            "server.pem",
            "cert.p12",
            "apikey.txt",
            "my_secret.md",
            "release.keystore",
            ".npmrc",
        ] {
            assert!(is_secret_file_name(name), "{name}");
        }
        assert!(!is_secret_file_name("README.md"));
    }

    #[test]
    fn remote_credentials_are_stripped() {
        assert_eq!(
            sanitize_remote_url("https://user:ghp_x@github.com/a/b.git").as_deref(),
            Some("https://github.com/a/b.git")
        );
        assert_eq!(
            sanitize_remote_url("git@github.com:a/b.git").as_deref(),
            Some("git@github.com:a/b.git")
        );
        assert_eq!(sanitize_remote_url("  "), None);
    }

    #[test]
    fn doc_allowlist_classifies_expected_files_only() {
        assert_eq!(doc_kind("AGENTS.md"), Some("agents"));
        assert_eq!(doc_kind("README.md"), Some("readme"));
        assert_eq!(doc_kind("PROJECT_STATUS_FLOW.md"), Some("status"));
        assert_eq!(doc_kind("Projektstatusflow.md"), Some("status"));
        assert_eq!(doc_kind("PROJECT_HANDOFF.md"), Some("handoff"));
        assert_eq!(doc_kind("MEMORY.md"), Some("memory"));
        assert_eq!(doc_kind("RACK.md"), Some("rack"));
        assert_eq!(doc_kind("PROJECT_RACK.md"), Some("rack"));
        assert_eq!(doc_kind("ARCHITECTURE.md"), Some("architecture"));
        assert_eq!(doc_kind("track.md"), None);
        assert_eq!(doc_kind("notes.md"), None);
        assert_eq!(doc_kind(".hidden.md"), None);
        assert_eq!(doc_kind("package.json"), None);
    }

    #[test]
    fn status_and_worktree_parsers() {
        let raw = b" M a.txt\0?? b.txt\0R  new.txt\0old.txt\0";
        assert_eq!(count_status(raw), (3, 1));
        let list = "worktree /w/main\nHEAD abc\nbranch refs/heads/main\n\nworktree /w/wt\nHEAD def\ndetached\nlocked reason\n";
        let parsed = parse_worktrees(list);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].branch.as_deref(), Some("main"));
        assert!(parsed[1].detached && parsed[1].locked);
    }

    #[test]
    fn scan_is_read_only_skips_secrets_and_reports_git_truth() {
        let root = temp_dir("scan");
        init_repo(&root);
        fs::write(
            root.join("PROJECT_STATUS_FLOW.md"),
            "Stand: 2026-01-01\nBranch: main\n",
        )
        .unwrap();
        fs::write(
            root.join("PROJECT_HANDOFF.md"),
            "Token: OPENAI_API_KEY=sk-aaaaaaaaaaaaaaaaaaaa\n",
        )
        .unwrap();
        fs::write(root.join(".env"), "SECRET=1\n").unwrap();
        fs::write(root.join("secret_project_status.md"), "Stand\n").unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("node_modules/pkg/README.md"), "leak").unwrap();
        fs::write(root.join("package.json"), r#"{"name":"demo","version":"1.2.3","scripts":{"x":"echo TOKEN=abc"},"dependencies":{"react":"^18"}}"#).unwrap();
        let before = git_text(&root, &["status", "--porcelain"]).unwrap_or_default();

        let probe = scan(&root).unwrap();
        assert_eq!(probe.repo.branch.as_deref(), Some("main"));
        assert!(probe.repo.head_sha.is_some());
        assert!(probe.repo.dirty_count >= 3);
        let by_path = |path: &str| probe.docs.iter().find(|doc| doc.path == path);
        assert!(by_path("README.md").unwrap().content.is_some());
        assert!(by_path("PROJECT_STATUS_FLOW.md").unwrap().content.is_some());
        let handoff = by_path("PROJECT_HANDOFF.md").unwrap();
        assert!(handoff.content.is_none());
        assert_eq!(handoff.excluded.as_deref(), Some("secret_pattern"));
        let secret_named = by_path("secret_project_status.md").unwrap();
        assert!(secret_named.content.is_none());
        assert_eq!(secret_named.excluded.as_deref(), Some("secret_name"));
        assert!(probe
            .docs
            .iter()
            .all(|doc| !doc.path.contains(".env") && !doc.path.contains("node_modules")));
        let manifest = probe
            .manifests
            .iter()
            .find(|entry| entry.kind == "package.json")
            .unwrap();
        assert_eq!(manifest.version.as_deref(), Some("1.2.3"));
        assert_eq!(manifest.hints, vec!["React".to_string()]);
        assert!(!serde_json::to_string(&probe).unwrap().contains("TOKEN=abc"));
        // Read-only: der Scan hat nichts veraendert.
        assert_eq!(
            git_text(&root, &["status", "--porcelain"]).unwrap_or_default(),
            before
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn discovery_groups_worktrees_and_skips_excluded_folders() {
        let parent = temp_dir("discover");
        let main = parent.join("Alpha");
        init_repo(&main);
        git(
            &main,
            &[
                "remote",
                "add",
                "origin",
                "https://user:token123@example.com/acme/alpha.git",
            ],
        );
        git(
            &main,
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "feat/x",
                parent.join("Alpha-feat-x").to_str().unwrap(),
            ],
        );
        init_repo(&parent.join("Beta"));
        init_repo(&parent.join("node_modules/hidden"));
        init_repo(&parent.join(".cache/also-hidden"));
        fs::create_dir_all(parent.join("plain/inner")).unwrap();
        init_repo(&parent.join("plain/inner/Gamma"));

        let result = discover(&parent).unwrap();
        let names: Vec<String> = result
            .repos
            .iter()
            .map(|repo| {
                Path::new(&repo.path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, vec!["Alpha", "Beta", "Gamma"]);
        assert!(result.skipped_excluded >= 2);
        let alpha = result
            .repos
            .iter()
            .find(|repo| repo.path.ends_with("/Alpha"))
            .unwrap();
        assert_eq!(
            alpha.remote.as_deref(),
            Some("https://example.com/acme/alpha.git")
        );
        assert!(!serde_json::to_string(&result).unwrap().contains("token123"));
        // Linked worktrees are represented inside the canonical repository result instead of
        // consuming a second discovery slot.
        assert_eq!(alpha.worktrees.len(), 2);
        assert!(alpha
            .worktrees
            .iter()
            .any(|worktree| worktree.path.ends_with("/Alpha-feat-x")));

        // Einzelnes Projekt: genau dieses Repo.
        assert_eq!(discover(&main).unwrap().repos.len(), 1);
        assert!(discover(&parent.join("missing")).is_err());
        let _ = Command::new("git")
            .arg("-C")
            .arg(&main)
            .args(["worktree", "prune"])
            .status();
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn registry_persistence_is_atomic_validated_and_secret_free() {
        let dir = temp_dir("registry");
        let path = dir.join("project-registry.json");
        assert!(load_registry_from(&path).unwrap().is_none());
        let good = serde_json::json!({ "schemaVersion": 1, "projects": [] });
        save_registry_to(&path, &good).unwrap();
        assert_eq!(load_registry_from(&path).unwrap().unwrap(), good);
        assert!(save_registry_to(
            &path,
            &serde_json::json!({ "schemaVersion": 2, "projects": [] })
        )
        .is_err());
        assert!(save_registry_to(
            &path,
            &serde_json::json!({ "schemaVersion": 1, "projects": [{ "note": "DATABASE_URL=x" }] })
        )
        .is_err());
        // Das gueltige Original bleibt nach den abgelehnten Schreibversuchen erhalten.
        assert_eq!(load_registry_from(&path).unwrap().unwrap(), good);
        // Beschaedigte Datei wird beiseitegelegt, nicht ueberschrieben.
        fs::write(&path, "{ kaputt").unwrap();
        assert!(load_registry_from(&path).unwrap().is_none());
        let backups = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains("corrupt"))
            .count();
        assert_eq!(backups, 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn registry_save_failure_reports_reason_without_path_and_cleans_temp() {
        let dir = temp_dir("registry-fail");
        // Zielpfad ist ein Ordner: das atomare Umbenennen muss scheitern.
        let path = dir.join("project-registry.json");
        fs::create_dir_all(path.join("blocker")).unwrap();
        let good = serde_json::json!({ "schemaVersion": 1, "projects": [] });
        let error = save_registry_to(&path, &good).unwrap_err();
        assert!(
            error.starts_with("Registry konnte nicht gespeichert werden ("),
            "{error}"
        );
        assert!(error.contains("os error"), "{error}");
        assert!(
            !error.contains(&dir.to_string_lossy().into_owned()),
            "{error}"
        );
        assert!(!path.with_extension("json.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
