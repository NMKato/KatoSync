// Created by NMKato Solutions
// Memory Fabric v1 (REX-Fundament): lokaler, strukturierter Projektwissensspeicher fuer Local-Brain-RAG.
// - SQLite + FTS5 ist die technische Wahrheit; Markdown/Obsidian ist nur eine erzeugte Projektion.
// - Gespeist ausschliesslich aus denselben allowlist-basierten Projektdokumenten wie Project Capsule
//   (project_registry::collect_docs) bzw. Context-Pack-Quellen – kein rekursiver Home-/Repo-Scan.
// - Gespeichert wird nur geschwaerzter, begrenzter Text ohne absolute Maschinenpfade oder Secrets.
// - Wahrheitsstufen observed < verified < canonical; canonical nur per expliziter, evidenzbasierter
//   Freigabe und an den Content-Hash gebunden. Modellausgaben werden nie automatisch zur Wahrheit.
// - Jeder Lese-/Schreibzugriff ist an eine Projekt-ID gebunden (keine projektuebergreifenden Treffer).
// Kein zweites Context-System: Context Pack bleibt der Handoff-Vertrag; die Fabric ist Retrieval darunter.
mod assemble;
mod identity;
mod ingest;
mod projection;
mod retrieve;
mod store;

#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

#[allow(unused_imports)]
pub(crate) use assemble::{
    assemble_rag_block, RagBlock, RagCitation, RagOptions, RAG_SCHEMA_VERSION,
};
#[allow(unused_imports)]
#[allow(unused_imports)]
pub(crate) use identity::{
    NameOrigin, NamedIdentityProposal, NodeIdentity, NodeIdentityKind, NodePersona,
    NODE_IDENTITY_SCHEMA_VERSION, REX_MAIN_NAME,
};
#[allow(unused_imports)]
pub(crate) use ingest::{
    collect_project_sources, probe_live_state, redact_for_memory, MemorySource,
};
#[allow(unused_imports)]
pub(crate) use projection::{
    export_projection, project_markdown, DirectoryTarget, ExportReport, ProjectionTarget,
    PROJECTION_MARKER,
};
#[allow(unused_imports)]
pub(crate) use retrieve::{LexicalOnly, MemoryQuery, MemoryQueryResult, SemanticReranker};
pub(crate) use store::MemoryStore;

pub(crate) const MEMORY_FABRIC_SCHEMA_VERSION: &str = "katosync.memory-fabric/v1";
const STORE_DIR: &str = "memory-fabric";
const STORE_FILE: &str = "memory-v1.sqlite3";

/// Serialisierte Schreibzugriffe innerhalb des Prozesses (One-Writer); SQLite sichert prozessuebergreifend ab.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum TruthLevel {
    /// Gelesen, aber nicht durch Git/CI/Mensch belegt (z. B. uncommitted oder ausserhalb von Git).
    Observed,
    /// Inhalt entspricht exakt dem committeten Stand von HEAD (Git-Evidenz).
    Verified,
    /// Explizit von einem Menschen freigegeben; gilt nur fuer genau diesen Content-Hash.
    Canonical,
}

impl TruthLevel {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Observed => "observed",
            Self::Verified => "verified",
            Self::Canonical => "canonical",
        }
    }

    pub(crate) fn rank(self) -> i64 {
        match self {
            Self::Observed => 0,
            Self::Verified => 1,
            Self::Canonical => 2,
        }
    }

    pub(crate) fn from_rank(rank: i64) -> Self {
        match rank {
            2 => Self::Canonical,
            1 => Self::Verified,
            _ => Self::Observed,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Freshness {
    /// Content-Hash und Git-HEAD entsprechen dem Live-Stand.
    Fresh,
    /// Inhalt unveraendert, aber HEAD hat sich seit der Indexierung bewegt (Re-Index empfohlen).
    HeadMoved,
    /// Inhalt geaendert, Quelle fehlt oder ist inzwischen ausgeschlossen – nicht mehr belastbar.
    Stale,
    /// Kein Live-Stand verfuegbar; fail-closed wie "nicht verifiziert" behandeln.
    Unknown,
}

/// Projekt-/Repo-Identitaet. Kein absoluter Pfad: nur ein irreversibler Fingerprint des Repo-Roots.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectIdentity {
    pub project_id: String,
    pub name: String,
    /// Normalisierte Remote-Identitaet (host/owner/repo) ohne Zugangsdaten.
    pub repo_identity: Option<String>,
    pub root_fingerprint: String,
}

#[derive(Debug, Clone)]
pub(crate) struct IngestBatch {
    pub identity: ProjectIdentity,
    pub git_head: Option<String>,
    pub git_branch: Option<String>,
    pub indexed_at: String,
    pub sources: Vec<MemorySource>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkippedSource {
    pub relative_path: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IngestReport {
    pub schema_version: String,
    pub project_id: String,
    pub git_head: Option<String>,
    pub indexed_sources: usize,
    pub chunks: usize,
    pub removed_sources: usize,
    pub skipped: Vec<SkippedSource>,
    pub indexed_at: String,
}

/// Evidenzverweis im gleichen Vokabular wie HandoffEvidenceRef (src/lib/handoffPacket.ts).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EvidenceRef {
    pub kind: String,
    pub truth_level: TruthLevel,
    #[serde(rename = "ref")]
    pub reference: String,
    pub verified_at: Option<String>,
}

/// Explizite menschliche Freigabe einer Quelle (genau dieser Content-Hash) als canonical.
#[derive(Debug, Clone)]
pub(crate) struct Promotion {
    pub project_id: String,
    pub relative_path: String,
    pub expected_content_hash: String,
    pub evidence_ref: String,
    pub approved_by: String,
    pub approved_at: String,
}

/// Live-Stand eines Projekts fuer Stale-Erkennung (HEAD + Content-Hashes der indexierten Quellen).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct LiveState {
    pub head_sha: Option<String>,
    /// relative_path -> sha256 des aktuell gelesenen Inhalts; fehlender Eintrag = Quelle fehlt/ausgeschlossen.
    pub content_hashes: std::collections::BTreeMap<String, String>,
}

pub(crate) fn validate_project_id(project_id: &str) -> Result<&str, String> {
    let id = project_id.trim();
    let valid = !id.is_empty()
        && id.chars().count() <= 128
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'));
    if valid {
        Ok(id)
    } else {
        Err("Ungültige Projekt-ID für die Memory Fabric.".to_string())
    }
}

fn store_path() -> Result<PathBuf, String> {
    let dir = crate::app_support_dir()
        .map_err(crate::error_to_string)?
        .join(STORE_DIR);
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Memory-Fabric-Ordner nicht anlegbar ({error})."))?;
    Ok(dir.join(STORE_FILE))
}

fn open_store() -> Result<MemoryStore, String> {
    MemoryStore::open(&store_path()?)
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|_| "Memory-Fabric-Vorgang wurde unterbrochen.".to_string())?
}

/// Liest den Live-Stand nur fuer ein registriertes Projekt, dessen Root zum gespeicherten Fingerprint passt.
fn live_state_for(store: &MemoryStore, project_id: &str, root: &str) -> Result<LiveState, String> {
    let collected = collect_project_sources(Path::new(root))?;
    if !store.root_matches(project_id, &collected.root_fingerprint)? {
        return Err("Projektordner passt nicht zur indexierten Projekt-ID.".to_string());
    }
    let paths = store.source_paths(project_id)?;
    Ok(probe_live_state(&collected, &paths))
}

// ===== Tauri-Commands (noch nicht in der UI verdrahtet; siehe docs/MEMORY_FABRIC.md) =====

#[tauri::command]
pub(crate) async fn memory_fabric_identity_get(
    node_id: String,
) -> Result<Option<NodeIdentity>, String> {
    blocking(move || open_store()?.identity(&node_id)).await
}

#[tauri::command]
pub(crate) async fn memory_fabric_identity_set_rex(
    node_id: String,
    role_summary: Option<String>,
) -> Result<NodeIdentity, String> {
    blocking(move || {
        let _guard = WRITE_LOCK
            .lock()
            .map_err(|_| "Memory Fabric ist gesperrt.".to_string())?;
        open_store()?.register_rex_main(&node_id, role_summary, &now_iso())
    })
    .await
}

#[tauri::command]
pub(crate) async fn memory_fabric_identity_set_named(
    node_id: String,
    display_name: String,
    role_summary: String,
    traits: Vec<String>,
    capabilities: Vec<String>,
    experience_refs: Vec<String>,
) -> Result<NodeIdentity, String> {
    blocking(move || {
        let _guard = WRITE_LOCK
            .lock()
            .map_err(|_| "Memory Fabric ist gesperrt.".to_string())?;
        open_store()?.register_named_identity(NamedIdentityProposal {
            node_id,
            display_name,
            role_summary,
            traits,
            capabilities,
            experience_refs,
            now: now_iso(),
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn memory_fabric_index(
    project_id: String,
    name: String,
    root: String,
) -> Result<IngestReport, String> {
    blocking(move || {
        let project_id = validate_project_id(&project_id)?.to_string();
        let collected = collect_project_sources(Path::new(&root))?;
        let batch = collected.into_batch(&project_id, &name, &now_iso());
        let _guard = WRITE_LOCK
            .lock()
            .map_err(|_| "Memory Fabric ist gesperrt.".to_string())?;
        open_store()?.ingest(batch)
    })
    .await
}

#[tauri::command]
pub(crate) async fn memory_fabric_query(
    project_id: String,
    root: Option<String>,
    query: String,
    limit: Option<usize>,
) -> Result<MemoryQueryResult, String> {
    blocking(move || {
        let project_id = validate_project_id(&project_id)?.to_string();
        let store = open_store()?;
        let live = match root.as_deref() {
            Some(root) => Some(live_state_for(&store, &project_id, root)?),
            None => None,
        };
        store.query(
            &MemoryQuery::new(&project_id, &query, limit),
            live.as_ref(),
            &LexicalOnly,
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn memory_fabric_context(
    project_id: String,
    root: String,
    query: String,
    limit: Option<usize>,
    max_chars: Option<usize>,
) -> Result<RagBlock, String> {
    blocking(move || {
        let project_id = validate_project_id(&project_id)?.to_string();
        let store = open_store()?;
        let live = live_state_for(&store, &project_id, &root)?;
        let result = store.query(
            &MemoryQuery::new(&project_id, &query, limit),
            Some(&live),
            &LexicalOnly,
        )?;
        let mut options = RagOptions::default();
        if let Some(max_chars) = max_chars {
            options.max_chars = max_chars;
        }
        Ok(assemble_rag_block(&result, &options))
    })
    .await
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GroundedMemoryAnswer {
    pub schema_version: String,
    pub project_id: String,
    pub answer: String,
    pub citations: Vec<RagCitation>,
    pub local_brain_used: bool,
}

#[tauri::command]
pub(crate) async fn memory_fabric_answer(
    project_id: String,
    root: String,
    query: String,
    question: String,
    limit: Option<usize>,
    max_chars: Option<usize>,
) -> Result<GroundedMemoryAnswer, String> {
    let project_id_for_result = validate_project_id(&project_id)?.to_string();
    let rag = blocking(move || {
        let project_id = validate_project_id(&project_id)?.to_string();
        let store = open_store()?;
        let live = live_state_for(&store, &project_id, &root)?;
        let result = store.query(
            &MemoryQuery::new(&project_id, &query, limit),
            Some(&live),
            &LexicalOnly,
        )?;
        let mut options = RagOptions::default();
        if let Some(max_chars) = max_chars {
            options.max_chars = max_chars;
        }
        Ok(assemble_rag_block(&result, &options))
    })
    .await?;

    if rag.citations.is_empty() {
        return Ok(GroundedMemoryAnswer {
            schema_version: "katosync.memory-answer/v1".to_string(),
            project_id: project_id_for_result,
            answer: "NOT_IN_MEMORY".to_string(),
            citations: Vec::new(),
            local_brain_used: false,
        });
    }

    let answer = crate::local_brain::grounded_chat(&rag.text, &question)
        .await
        .map_err(crate::error_to_string)?;
    Ok(GroundedMemoryAnswer {
        schema_version: "katosync.memory-answer/v1".to_string(),
        project_id: project_id_for_result,
        answer,
        citations: rag.citations,
        local_brain_used: true,
    })
}

#[tauri::command]
pub(crate) async fn memory_fabric_promote(
    project_id: String,
    relative_path: String,
    expected_content_hash: String,
    evidence_ref: String,
    approved_by: String,
) -> Result<(), String> {
    blocking(move || {
        let promotion = Promotion {
            project_id: validate_project_id(&project_id)?.to_string(),
            relative_path,
            expected_content_hash,
            evidence_ref,
            approved_by,
            approved_at: now_iso(),
        };
        let _guard = WRITE_LOCK
            .lock()
            .map_err(|_| "Memory Fabric ist gesperrt.".to_string())?;
        open_store()?.promote(&promotion)
    })
    .await
}

#[tauri::command]
pub(crate) async fn memory_fabric_export(
    project_id: String,
    target_dir: String,
) -> Result<ExportReport, String> {
    blocking(move || {
        let project_id = validate_project_id(&project_id)?.to_string();
        let snapshot = open_store()?.snapshot(&project_id)?;
        let mut target = DirectoryTarget::new(Path::new(&target_dir), &project_id)?;
        export_projection(&snapshot, &mut target)
    })
    .await
}
