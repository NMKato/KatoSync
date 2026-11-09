// Created by NMKato Solutions
// Begrenzter Ingestion-Adapter der Memory Fabric. Liest ausschliesslich die allowlist-basierten
// Projektdokumente der Project Registry (Root + docs/) plus Roadmap-/ADR-Dokumente in festen Ordnern.
// Secret-Dateinamen/-Inhalte, ausgeschlossene Ordner, Symlinks und zu grosse Dateien bleiben draussen –
// es gelten exakt die Regeln aus project_registry.rs. Text wird vor dem Speichern geschwaerzt.
use super::{IngestBatch, LiveState, ProjectIdentity, SkippedSource};
use crate::{
    context_pack::{bounded_text, ContextSourceInput},
    project_registry::{self, DocFact},
};
use regex::Regex;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

const MAX_SOURCES: usize = 48;
const MAX_EXTRA_SOURCES: usize = 16;
const MAX_CHUNKS_PER_SOURCE: usize = 64;
pub(super) const MAX_CHUNK_CHARS: usize = 1_200;
const MAX_HEADING_CHARS: usize = 200;
const MAX_SUMMARY_CHARS: usize = 200;
const ADR_FOLDERS: &[&str] = &["docs/adr", "docs/adrs", "docs/decisions", "adr"];

/// Quellarten, die in die Fabric duerfen: Registry-Dokumentarten + Context-Pack-Kategorien + ADR.
pub(super) const ALLOWED_KINDS: &[&str] = &[
    "agents",
    "readme",
    "status",
    "handoff",
    "memory",
    "rack",
    "context",
    "architecture",
    "roadmap",
    "adr",
];

/// Eine Kandidatenquelle vor der Aufnahme. `content` ist Rohtext (nur fuer Hash + Schwaerzung).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MemorySource {
    pub relative_path: String,
    pub kind: String,
    pub content: String,
    pub modified_at: Option<String>,
    pub size_bytes: u64,
    pub content_truncated: bool,
    /// Bereits vom Scanner gesetzter Ausschlussgrund (secret_name, secret_pattern, too_large, unreadable).
    pub excluded: Option<String>,
    /// Datei ist in Git getrackt und unveraendert gegenueber HEAD.
    pub git_clean: bool,
}

impl MemorySource {
    /// Adapter fuer die Context-Pack-Pipeline: dieselben Quellen, dieselbe Secret-Markierung.
    /// Ohne Git-Nachweis ist eine solche Quelle hoechstens `observed`.
    #[allow(dead_code)]
    pub(crate) fn from_context_source(input: &ContextSourceInput) -> Self {
        Self {
            relative_path: input.relative_path.clone(),
            kind: input.category.clone(),
            content: input.content.clone(),
            modified_at: Some(input.modified_at.clone()),
            size_bytes: input.size_bytes,
            content_truncated: false,
            excluded: input.secret_detected.then(|| "secret_pattern".to_string()),
            git_clean: false,
        }
    }

    fn from_doc(doc: DocFact, git_clean: bool) -> Self {
        let content = doc.content.unwrap_or_default();
        Self {
            content_truncated: doc.excluded.is_none() && doc.bytes > content.len() as u64,
            relative_path: doc.path,
            kind: doc.kind,
            modified_at: doc.modified_at,
            size_bytes: doc.bytes,
            excluded: doc.excluded,
            git_clean,
            content,
        }
    }
}

/// Ergebnis eines Projekt-Scans fuer die Fabric (ohne absolute Pfade in serialisierbaren Feldern).
#[derive(Debug, Clone)]
pub(crate) struct CollectedProject {
    pub root_fingerprint: String,
    pub repo_identity: Option<String>,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub sources: Vec<MemorySource>,
}

impl CollectedProject {
    pub(crate) fn into_batch(self, project_id: &str, name: &str, indexed_at: &str) -> IngestBatch {
        IngestBatch {
            identity: ProjectIdentity {
                project_id: project_id.to_string(),
                name: bounded_text(&redact_for_memory(name), 120),
                repo_identity: self.repo_identity,
                root_fingerprint: self.root_fingerprint,
            },
            git_head: self.head,
            git_branch: self.branch,
            indexed_at: indexed_at.to_string(),
            sources: self.sources,
        }
    }
}

pub(crate) fn sha256_hex(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(crate) fn root_fingerprint(real_root: &str) -> String {
    sha256_hex(&format!("katosync-memory-root\0{real_root}"))
}

/// host/owner/repo in Kleinschreibung, ohne Protokoll, Zugangsdaten, Port und .git (wie normalizeRemote in TS).
pub(crate) fn normalize_remote(url: &str) -> Option<String> {
    let clean = project_registry::sanitize_remote_url(url)?;
    static SCP: OnceLock<Regex> = OnceLock::new();
    static SCHEME: OnceLock<Regex> = OnceLock::new();
    static PORT: OnceLock<Regex> = OnceLock::new();
    let scp = SCP.get_or_init(|| Regex::new(r"^[^@/\s]+@([^:/\s]+):(.+)$").expect("statisch"));
    let scheme = SCHEME
        .get_or_init(|| Regex::new(r"(?i)^[a-z][a-z0-9+.\-]*://([^/@\s]*@)?").expect("statisch"));
    let port = PORT.get_or_init(|| Regex::new(r":\d+/").expect("statisch"));
    let rest = match scp.captures(&clean) {
        Some(caps) => format!("{}/{}", &caps[1], &caps[2]),
        None => scheme.replace(&clean, "").into_owned(),
    };
    let rest = port.replace(&rest, "/").into_owned();
    let rest = rest.trim_end_matches('/');
    let rest = rest
        .strip_suffix(".git")
        .or_else(|| rest.strip_suffix(".GIT"))
        .unwrap_or(rest);
    (!rest.is_empty()).then(|| rest.to_lowercase())
}

/// Relativer Projektpfad ist tabu: absolut, Ausbruch (..), ausgeschlossener Ordner oder Secret-Dateiname.
/// Spiegel von isExcludedRelativePath (src/lib/projectExclusions.ts).
pub(crate) fn is_excluded_relative_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    let bytes = normalized.as_bytes();
    if normalized.is_empty()
        || normalized.starts_with('/')
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
    {
        return true;
    }
    let segments: Vec<&str> = normalized.split('/').filter(|s| !s.is_empty()).collect();
    let Some((file, folders)) = segments.split_last() else {
        return true;
    };
    segments.iter().any(|segment| *segment == "..")
        || folders
            .iter()
            .any(|folder| project_registry::is_excluded_dir_name(folder))
        || project_registry::is_secret_file_name(file)
}

/// Schwaerzt Secrets, Zugangsdaten in URLs und private Maschinenpfade. Idempotent.
pub(crate) fn redact_for_memory(text: &str) -> String {
    static URL_CREDENTIALS: OnceLock<Regex> = OnceLock::new();
    static HOME_PATH: OnceLock<Regex> = OnceLock::new();
    static WINDOWS_HOME: OnceLock<Regex> = OnceLock::new();
    static TEMP_PATH: OnceLock<Regex> = OnceLock::new();
    static VOLUME_PATH: OnceLock<Regex> = OnceLock::new();
    let url_credentials = URL_CREDENTIALS.get_or_init(|| {
        Regex::new(r"(?i)\b([a-z][a-z0-9+.\-]*://)[^/@\s]+@").expect("statisch gueltig")
    });
    let home_path = HOME_PATH.get_or_init(|| {
        Regex::new(r#"(?m)(^|[\s"'`(\[{<=:,]|file://)(?:/Users|/home)/[^/\s"'`<>()\[\]{}]+"#)
            .expect("statisch gueltig")
    });
    let windows_home = WINDOWS_HOME.get_or_init(|| {
        Regex::new(r#"(?i)\b[a-z]:[\\/]+Users[\\/]+[^\\/\s"'`<>]+"#).expect("statisch gueltig")
    });
    let temp_path = TEMP_PATH.get_or_init(|| {
        Regex::new(r#"(?:/private)?/var/folders/[^\s"'`<>()\[\]{}]+"#).expect("statisch gueltig")
    });
    let volume_path = VOLUME_PATH
        .get_or_init(|| Regex::new(r#"/Volumes/[^/\s"'`<>()\[\]{}]+"#).expect("statisch gueltig"));

    let text = crate::secret_regex().replace_all(text, "[redacted]");
    let text = url_credentials.replace_all(&text, "$1");
    let text = home_path.replace_all(&text, "${1}~");
    let text = windows_home.replace_all(&text, "~");
    let text = temp_path.replace_all(&text, "[tmp-path]");
    volume_path.replace_all(&text, "[volume]").into_owned()
}

/// Liest das Projekt: Git-Fakten (nur lesend) + Allowlist-Dokumente. Kein Home-Ordner, nur Git-Repos.
pub(crate) fn collect_project_sources(root: &Path) -> Result<CollectedProject, String> {
    if !project_registry::is_real_dir(root) {
        return Err("Projektordner nicht gefunden.".to_string());
    }
    let real_root = project_registry::real_path(root);
    if let Some(home) = dirs::home_dir() {
        if project_registry::real_path(&home) == real_root {
            return Err("Das Home-Verzeichnis wird nicht indexiert.".to_string());
        }
    }
    let repo = project_registry::probe_repo(root, false)
        .ok_or_else(|| "Kein Git-Repository gefunden.".to_string())?;
    let repo_root = PathBuf::from(&repo.path);

    let mut docs = project_registry::collect_docs(&repo_root);
    let known: BTreeSet<String> = docs.iter().map(|doc| doc.path.clone()).collect();
    docs.extend(
        extra_doc_paths(&repo_root)
            .into_iter()
            .filter(|(relative, _)| !known.contains(relative))
            .map(|(relative, kind)| project_registry::read_doc(&repo_root, &relative, kind)),
    );
    docs.truncate(MAX_SOURCES);

    let paths: Vec<String> = docs.iter().map(|doc| doc.path.clone()).collect();
    let clean = git_clean_paths(&repo_root, &paths, repo.head_sha.is_some());
    let sources = docs
        .into_iter()
        .map(|doc| {
            let is_clean = clean.contains(&doc.path);
            MemorySource::from_doc(doc, is_clean)
        })
        .collect();

    Ok(CollectedProject {
        root_fingerprint: root_fingerprint(&repo.path),
        repo_identity: repo.remote.as_deref().and_then(normalize_remote),
        head: repo.head_sha,
        branch: repo.branch,
        sources,
    })
}

/// Roadmap-Dokumente (Root/docs) und ADRs in festen Ordnern, eine Ebene tief, begrenzt.
fn extra_doc_paths(root: &Path) -> Vec<(String, &'static str)> {
    let mut found = Vec::new();
    let text_file = |name: &str| {
        let lower = name.to_lowercase();
        !lower.starts_with('.')
            && [".md", ".markdown", ".txt"]
                .iter()
                .any(|ext| lower.ends_with(ext))
    };
    let mut scan = |folder: &str, kind: &'static str, roadmap_only: bool| {
        let dir = if folder.is_empty() {
            root.to_path_buf()
        } else {
            root.join(folder)
        };
        if !folder.is_empty() && !project_registry::is_real_dir(&dir) {
            return;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            return;
        };
        for entry in entries.filter_map(Result::ok) {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !text_file(&name) || (roadmap_only && !name.to_lowercase().contains("roadmap")) {
                continue;
            }
            let relative = if folder.is_empty() {
                name
            } else {
                format!("{folder}/{name}")
            };
            if !is_excluded_relative_path(&relative) {
                found.push((relative, kind));
            }
        }
    };
    scan("", "roadmap", true);
    scan("docs", "roadmap", true);
    for folder in ADR_FOLDERS {
        scan(folder, "adr", false);
    }
    found.sort();
    found.dedup();
    found.truncate(MAX_EXTRA_SOURCES);
    found
}

/// Pfade, die in Git getrackt und gegenueber HEAD unveraendert sind. Literal-Pathspecs, keine Shell.
fn git_clean_paths(repo_root: &Path, paths: &[String], has_head: bool) -> BTreeSet<String> {
    if !has_head || paths.is_empty() {
        return BTreeSet::new();
    }
    let with_paths = |base: &[&str]| -> Vec<String> {
        base.iter()
            .map(|arg| arg.to_string())
            .chain(paths.iter().cloned())
            .collect()
    };
    let run = |args: Vec<String>| {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        project_registry::run_git(repo_root, &refs)
    };
    let Some(tracked) = run(with_paths(&["--literal-pathspecs", "ls-files", "-z", "--"])) else {
        return BTreeSet::new();
    };
    let Some(status) = run(with_paths(&[
        "--literal-pathspecs",
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--",
    ])) else {
        return BTreeSet::new();
    };
    let dirty = parse_porcelain_z(&status);
    nul_separated(&tracked)
        .into_iter()
        .filter(|path| !dirty.contains(path))
        .collect()
}

fn nul_separated(raw: &[u8]) -> Vec<String> {
    raw.split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .map(|part| String::from_utf8_lossy(part).into_owned())
        .collect()
}

pub(super) fn parse_porcelain_z(raw: &[u8]) -> BTreeSet<String> {
    let mut dirty = BTreeSet::new();
    let mut entries = nul_separated(raw).into_iter();
    while let Some(entry) = entries.next() {
        if entry.len() < 4 {
            continue;
        }
        let code = &entry[..2];
        dirty.insert(entry[3..].to_string());
        if code.starts_with('R') || code.starts_with('C') {
            // Rename/Copy: der folgende Eintrag ist der Ursprungspfad.
            if let Some(origin) = entries.next() {
                dirty.insert(origin);
            }
        }
    }
    dirty
}

/// Live-Stand fuer Stale-Erkennung aus einem frischen Scan (gleiche Leseregeln wie bei der Indexierung).
pub(crate) fn probe_live_state(
    collected: &CollectedProject,
    indexed_paths: &[String],
) -> LiveState {
    let wanted: BTreeSet<&str> = indexed_paths.iter().map(String::as_str).collect();
    LiveState {
        head_sha: collected.head.clone(),
        content_hashes: collected
            .sources
            .iter()
            .filter(|source| wanted.contains(source.relative_path.as_str()))
            .filter(|source| admit_reason(source).is_none())
            .map(|source| (source.relative_path.clone(), sha256_hex(&source.content)))
            .collect(),
    }
}

/// Warum eine Quelle nicht in die Fabric darf (None = zulaessig). Fail-closed fuer Secrets und Projektionen.
pub(super) fn admit_reason(source: &MemorySource) -> Option<String> {
    if let Some(reason) = &source.excluded {
        return Some(bounded_text(reason, 32));
    }
    if is_excluded_relative_path(&source.relative_path) {
        return Some("excluded_path".to_string());
    }
    if !ALLOWED_KINDS.contains(&source.kind.as_str()) {
        return Some("unsupported_kind".to_string());
    }
    if crate::secret_regex().is_match(&source.content) {
        return Some("secret_pattern".to_string());
    }
    if is_memory_projection(&source.content) {
        // Eigene Markdown-Projektionen duerfen nie als Quelle zurueckfliessen.
        return Some("memory_projection".to_string());
    }
    None
}

pub(super) fn skipped(source: &MemorySource, reason: String) -> SkippedSource {
    SkippedSource {
        relative_path: bounded_text(&redact_for_memory(&source.relative_path), 300),
        reason,
    }
}

fn is_memory_projection(content: &str) -> bool {
    content
        .chars()
        .take(2_048)
        .collect::<String>()
        .contains(super::PROJECTION_MARKER)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct DraftChunk {
    pub ordinal: usize,
    pub heading: String,
    pub body: String,
    pub summary: String,
}

/// Zerlegt (bereits geschwaerztes) Markdown entlang der Ueberschriften in begrenzte Chunks.
pub(super) fn chunk_markdown(content: &str) -> Vec<DraftChunk> {
    let mut chunks = Vec::new();
    let mut stack: Vec<(usize, String)> = Vec::new();
    let mut section: Vec<&str> = Vec::new();
    let mut in_fence = false;
    let mut lines = content.lines().peekable();

    // YAML-Front-Matter am Dateianfang ist Metadatum, kein Wissen.
    if lines.peek().map(|line| line.trim()) == Some("---") {
        lines.next();
        for line in lines.by_ref() {
            if line.trim() == "---" {
                break;
            }
        }
    }

    for line in lines {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
        }
        if !in_fence {
            if let Some((level, title)) = heading_of(trimmed) {
                flush_section(&mut chunks, &stack, &section);
                section.clear();
                while stack.last().is_some_and(|(existing, _)| *existing >= level) {
                    stack.pop();
                }
                stack.push((level, title));
                continue;
            }
        }
        if !is_metadata_line(trimmed) {
            section.push(line);
        }
    }
    flush_section(&mut chunks, &stack, &section);
    chunks.truncate(MAX_CHUNKS_PER_SOURCE);
    chunks
}

fn heading_of(line: &str) -> Option<(usize, String)> {
    let level = line.chars().take_while(|ch| *ch == '#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    let rest = &line[level..];
    if !rest.starts_with(' ') {
        return None;
    }
    let title = bounded_text(rest.trim().trim_end_matches('#').trim(), 120);
    (!title.is_empty()).then_some((level, title))
}

fn is_metadata_line(line: &str) -> bool {
    let lower = line
        .trim()
        .trim_matches(['(', ')', '_', '*'])
        .to_lowercase();
    lower.starts_with("created by nmkato solutions")
        || (lower.starts_with("<!--") && lower.ends_with("-->"))
}

fn flush_section(chunks: &mut Vec<DraftChunk>, stack: &[(usize, String)], lines: &[&str]) {
    if chunks.len() >= MAX_CHUNKS_PER_SOURCE {
        return;
    }
    let heading = bounded_text(
        &stack
            .iter()
            .map(|(_, title)| title.as_str())
            .collect::<Vec<_>>()
            .join(" › "),
        MAX_HEADING_CHARS,
    );
    let text = lines
        .iter()
        .map(|line| line.trim_end())
        .collect::<Vec<_>>()
        .join("\n");
    let mut current = String::new();
    for paragraph in text.split("\n\n").map(str::trim).filter(|p| !p.is_empty()) {
        for piece in split_long(paragraph) {
            let joined_len = current.chars().count() + piece.chars().count() + 2;
            if !current.is_empty() && joined_len > MAX_CHUNK_CHARS {
                push_chunk(chunks, &heading, std::mem::take(&mut current));
            }
            if !current.is_empty() {
                current.push_str("\n\n");
            }
            current.push_str(&piece);
        }
    }
    push_chunk(chunks, &heading, current);
}

fn split_long(paragraph: &str) -> Vec<String> {
    if paragraph.chars().count() <= MAX_CHUNK_CHARS {
        return vec![paragraph.to_string()];
    }
    let mut pieces = Vec::new();
    let mut current = String::new();
    for line in paragraph.lines() {
        let line_chars: Vec<char> = line.chars().collect();
        for part in line_chars.chunks(MAX_CHUNK_CHARS) {
            let part: String = part.iter().collect();
            if !current.is_empty()
                && current.chars().count() + part.chars().count() + 1 > MAX_CHUNK_CHARS
            {
                pieces.push(std::mem::take(&mut current));
            }
            if !current.is_empty() {
                current.push('\n');
            }
            current.push_str(&part);
        }
    }
    if !current.is_empty() {
        pieces.push(current);
    }
    pieces
}

fn push_chunk(chunks: &mut Vec<DraftChunk>, heading: &str, body: String) {
    let body = body.trim().to_string();
    if chunks.len() >= MAX_CHUNKS_PER_SOURCE
        || body.chars().filter(|ch| ch.is_alphanumeric()).count() < 2
    {
        return;
    }
    let first_line = body
        .lines()
        .map(|line| {
            line.trim()
                .trim_start_matches(['-', '*', '+', '>', '|', ' '])
                .trim()
        })
        .find(|line| !line.is_empty())
        .unwrap_or_default();
    chunks.push(DraftChunk {
        ordinal: chunks.len(),
        heading: heading.to_string(),
        summary: bounded_text(first_line, MAX_SUMMARY_CHARS),
        body,
    });
}
