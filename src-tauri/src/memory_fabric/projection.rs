// Created by NMKato Solutions
// Markdown-/Obsidian-Projektion der Memory Fabric. Wird ausschliesslich aus dem SQLite-Snapshot erzeugt
// und nie zurueckgelesen: Projektionsdateien tragen einen Marker, den die Ingestion ablehnt.
// Von Menschen bearbeitete Projektionen werden nicht stillschweigend ueberschrieben, sondern beiseite
// gelegt (".user-edit-<n>.md") und bleiben ohne Einfluss auf die gespeicherte Wahrheit.
// Das Exportziel ist abstrakt (`ProjectionTarget`); der Aufrufer waehlt das Verzeichnis.
use super::{
    ingest::{redact_for_memory, sha256_hex},
    store::{ProjectSnapshot, SnapshotSource},
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

pub(crate) const PROJECTION_MARKER: &str = "katosyncMemory: projection";
const INDEX_FILE: &str = "_index.md";
const MAX_FILE_NAME_CHARS: usize = 120;
const MAX_PRESERVED_EDITS: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProjectionFile {
    pub name: String,
    pub content: String,
}

/// Abstraktes Exportziel (Verzeichnis, Vault-Adapter, Testspeicher …). Namen sind flache Dateinamen.
pub(crate) trait ProjectionTarget {
    fn read(&self, name: &str) -> Option<String>;
    fn exists(&self, name: &str) -> bool;
    fn write(&mut self, name: &str, content: &str) -> Result<(), String>;
    fn rename(&mut self, from: &str, to: &str) -> Result<(), String>;
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportReport {
    pub project_id: String,
    pub written: Vec<String>,
    pub unchanged: Vec<String>,
    /// Manuell bearbeitete Projektionen, die vor dem Neuschreiben beiseitegelegt wurden.
    pub preserved_edits: Vec<String>,
}

fn yaml(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace(['\r', '\n'], " ")
    )
}

fn one_line(value: &str) -> String {
    redact_for_memory(value).replace(['\r', '\n'], " ")
}

/// Flacher, sicherer Dateiname aus einem projektrelativen Pfad.
pub(super) fn file_slug(relative_path: &str) -> String {
    let stem = relative_path
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(relative_path);
    let slug: String = stem
        .replace(['/', '\\'], "__")
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .take(MAX_FILE_NAME_CHARS)
        .collect();
    let slug = slug.trim_matches('.').to_string();
    format!("{}.md", if slug.is_empty() { "source" } else { &slug })
}

fn with_front_matter(fields: &[(&str, String)], body: &str) -> String {
    let mut text = String::from("---\n");
    text.push_str(PROJECTION_MARKER);
    text.push('\n');
    for (key, value) in fields {
        text.push_str(&format!("{key}: {value}\n"));
    }
    text.push_str(&format!("projectionHash: {}\n", yaml(&sha256_hex(body))));
    text.push_str("---\n");
    text.push_str(body);
    text
}

const NOTICE: &str =
    "> Generated view of the KatoSync Memory Fabric (SQLite is the source of truth).\n\
> Edits in this file are never read back and never become project truth. Change the source\n\
> document in the repository and re-index, or promote it explicitly in KatoSync.\n\n";

fn source_file(snapshot: &ProjectSnapshot, source: &SnapshotSource) -> ProjectionFile {
    let mut body = format!("\n# {}\n\n{NOTICE}", one_line(&source.relative_path));
    body.push_str("## Evidence\n\n");
    for evidence in &source.evidence {
        body.push_str(&format!(
            "- {} · {} · `{}`\n",
            evidence.truth_level.as_str(),
            evidence.kind,
            one_line(&evidence.reference).replace('`', "'")
        ));
    }
    body.push_str("\n## Chunks\n");
    for chunk in &source.chunks {
        body.push_str(&format!(
            "\n### {} · {}\n\n{}\n",
            chunk.ordinal + 1,
            if chunk.heading.is_empty() {
                "(untitled)".to_string()
            } else {
                one_line(&chunk.heading)
            },
            redact_for_memory(&chunk.body)
        ));
    }
    body.push_str("\n(Created by NMKato Solutions)\n");
    let fields = [
        ("canonicalStore", yaml(&snapshot.schema_version)),
        ("projectId", yaml(&snapshot.project_id)),
        ("source", yaml(&one_line(&source.relative_path))),
        ("kind", yaml(&source.kind)),
        ("truthLevel", yaml(source.truth_level.as_str())),
        ("contentHash", yaml(&source.content_hash)),
        ("gitHead", yaml(source.git_head.as_deref().unwrap_or(""))),
        ("indexedAt", yaml(&source.indexed_at)),
    ];
    ProjectionFile {
        name: file_slug(&source.relative_path),
        content: with_front_matter(&fields, &body),
    }
}

/// Erzeugt die komplette, deterministische Projektion eines Projekt-Snapshots.
pub(crate) fn project_markdown(snapshot: &ProjectSnapshot) -> Vec<ProjectionFile> {
    let mut files: Vec<ProjectionFile> = Vec::with_capacity(snapshot.sources.len() + 1);
    for source in &snapshot.sources {
        let mut file = source_file(snapshot, source);
        // a.md und a.txt ergeben denselben Slug: deterministisch durchnummerieren.
        let stem = file.name.trim_end_matches(".md").to_string();
        let mut n = 2;
        while file.name == INDEX_FILE || files.iter().any(|known| known.name == file.name) {
            file.name = format!("{stem}-{n}.md");
            n += 1;
        }
        files.push(file);
    }

    let mut body = format!(
        "\n# Memory Fabric — {}\n\n{NOTICE}",
        one_line(&snapshot.name)
    );
    body.push_str(&format!(
        "- Branch: `{}`\n- HEAD: `{}`\n- Indexed: `{}`\n\n",
        one_line(snapshot.git_branch.as_deref().unwrap_or("(none)")),
        snapshot.git_head.as_deref().unwrap_or("(none)"),
        snapshot.indexed_at
    ));
    body.push_str("| Source | Kind | Truth | Chunks |\n|---|---|---|---:|\n");
    for (source, file) in snapshot.sources.iter().zip(&files) {
        body.push_str(&format!(
            "| [{}]({}) | {} | {} | {} |\n",
            one_line(&source.relative_path).replace('|', "\\|"),
            file.name,
            source.kind,
            source.truth_level.as_str(),
            source.chunks.len()
        ));
    }
    body.push_str("\n(Created by NMKato Solutions)\n");
    let fields = [
        ("canonicalStore", yaml(&snapshot.schema_version)),
        ("projectId", yaml(&snapshot.project_id)),
        ("gitHead", yaml(snapshot.git_head.as_deref().unwrap_or(""))),
        ("indexedAt", yaml(&snapshot.indexed_at)),
    ];
    files.push(ProjectionFile {
        name: INDEX_FILE.to_string(),
        content: with_front_matter(&fields, &body),
    });
    files
}

/// Unbearbeitete eigene Projektion: Marker vorhanden und Body-Hash passt zum gespeicherten projectionHash.
pub(super) fn is_pristine_projection(content: &str) -> bool {
    let Some(rest) = content.strip_prefix("---\n") else {
        return false;
    };
    let Some((front, body)) = rest.split_once("\n---\n") else {
        return false;
    };
    if !front.lines().any(|line| line == PROJECTION_MARKER) {
        return false;
    }
    front
        .lines()
        .find_map(|line| line.strip_prefix("projectionHash: "))
        .map(|hash| hash.trim_matches('"') == sha256_hex(body))
        .unwrap_or(false)
}

pub(crate) fn export_projection(
    snapshot: &ProjectSnapshot,
    target: &mut dyn ProjectionTarget,
) -> Result<ExportReport, String> {
    let mut report = ExportReport {
        project_id: snapshot.project_id.clone(),
        ..ExportReport::default()
    };
    for file in project_markdown(snapshot) {
        match target.read(&file.name) {
            Some(existing) if existing == file.content => {
                report.unchanged.push(file.name);
                continue;
            }
            Some(existing) if !is_pristine_projection(&existing) => {
                let stem = file.name.trim_end_matches(".md");
                let preserved = (1..=MAX_PRESERVED_EDITS)
                    .map(|n| format!("{stem}.user-edit-{n}.md"))
                    .find(|candidate| !target.exists(candidate))
                    .ok_or_else(|| {
                        "Zu viele beiseitegelegte Bearbeitungen; Export abgebrochen.".to_string()
                    })?;
                target.rename(&file.name, &preserved)?;
                report.preserved_edits.push(preserved);
            }
            _ => {}
        }
        target.write(&file.name, &file.content)?;
        report.written.push(file.name);
    }
    Ok(report)
}

/// Verzeichnis-Ziel: `<vom Nutzer gewaehltes Verzeichnis>/katosync-memory/<projectId>/`.
pub(crate) struct DirectoryTarget {
    dir: PathBuf,
}

impl DirectoryTarget {
    pub(crate) fn new(base: &Path, project_id: &str) -> Result<Self, String> {
        let base_ok = base.is_absolute()
            && base.parent().is_some()
            && fs::symlink_metadata(base)
                .map(|meta| meta.is_dir())
                .unwrap_or(false);
        if !base_ok {
            return Err("Exportziel muss ein vorhandener, absoluter Ordner sein.".to_string());
        }
        let project_dir = super::validate_project_id(project_id)?.replace(':', "_");
        let dir = base.join("katosync-memory").join(project_dir);
        fs::create_dir_all(&dir)
            .map_err(|error| format!("Exportordner nicht anlegbar ({error})."))?;
        Ok(Self { dir })
    }

    fn path(&self, name: &str) -> Result<PathBuf, String> {
        let valid = !name.is_empty()
            && !name.starts_with('.')
            && name
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'));
        if valid {
            Ok(self.dir.join(name))
        } else {
            Err("Ungültiger Projektionsdateiname.".to_string())
        }
    }
}

impl ProjectionTarget for DirectoryTarget {
    fn read(&self, name: &str) -> Option<String> {
        let path = self.path(name).ok()?;
        let meta = fs::symlink_metadata(&path).ok()?;
        if !meta.is_file() {
            return None;
        }
        fs::read_to_string(path).ok()
    }

    fn exists(&self, name: &str) -> bool {
        self.path(name)
            .map(|path| fs::symlink_metadata(path).is_ok())
            .unwrap_or(true)
    }

    fn write(&mut self, name: &str, content: &str) -> Result<(), String> {
        let path = self.path(name)?;
        if fs::symlink_metadata(&path).is_ok_and(|meta| !meta.is_file()) {
            return Err("Projektionsziel ist keine reguläre Datei.".to_string());
        }
        let temp = self.dir.join(format!(".{name}.tmp"));
        fs::write(&temp, content)
            .map_err(|error| format!("Projektion nicht schreibbar ({error})."))?;
        fs::rename(&temp, &path).map_err(|error| {
            let _ = fs::remove_file(&temp);
            format!("Projektion nicht speicherbar ({error}).")
        })
    }

    fn rename(&mut self, from: &str, to: &str) -> Result<(), String> {
        fs::rename(self.path(from)?, self.path(to)?)
            .map_err(|error| format!("Bearbeitete Projektion nicht sicherbar ({error})."))
    }
}
