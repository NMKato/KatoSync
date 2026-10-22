// Created by NMKato Solutions
//! Explicit user-initiated, LOCAL-ONLY Blueprint -> unverified journal handoff.
//! A UI click is consent to SAVE A PROPOSAL, never agent permission or canonical approval.
use super::{
    blocking,
    ingest::{root_fingerprint, sha256_hex},
    open_store, validate_project_id, JournalAppendResult, JournalDraft, MemoryStore, STORE_DIR,
    STORE_FILE, WRITE_LOCK,
};
use crate::project_registry;
use serde::{Deserialize, Serialize};
use std::path::Path;

const MAX_IMPORT_BYTES: usize = 8192;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContinuityPreflight {
    pub project_id: String,
    pub git_head: String,
    pub previous_hash: Option<String>,
    pub next_sequence: i64,
    pub proposal_only: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlueprintDocument {
    schema_version: String,
    project_id: String,
    blueprint_id: String,
    revision: u64,
    title: String,
    intent: String,
    source: BlueprintSource,
    base_git_head: Option<String>,
    decisions: Vec<BlueprintDecision>,
    next_steps: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlueprintSource {
    kind: String,
    label: String,
    captured_at: String,
    reference: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlueprintDecision {
    id: String,
    title: String,
    choice: String,
    rationale: String,
    alternatives: Vec<String>,
    consequences: Vec<String>,
    evidence: Vec<BlueprintEvidence>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlueprintEvidence {
    kind: String,
    #[serde(rename = "ref")]
    reference: String,
}

fn id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 80
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b':' | b'_' | b'-'))
}

fn text(s: &str, max: usize) -> bool {
    !s.trim().is_empty()
        && s.len() <= max
        && !s
            .chars()
            .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
}

fn parse_blueprint(raw: &str, project_id: &str) -> Result<BlueprintDocument, String> {
    if raw.len() > MAX_IMPORT_BYTES {
        return Err("Blueprint überschreitet das Journal-Limit von 8 KB.".into());
    }
    let doc: BlueprintDocument = serde_json::from_str(raw)
        .map_err(|_| "Blueprint-Struktur entspricht nicht der geprüften Version.".to_string())?;
    if doc.schema_version != "katosync.continuity-blueprint/v1"
        || doc.project_id != project_id
        || !id(&doc.blueprint_id)
        || doc.revision == 0
        || !text(&doc.title, 180)
        || !text(&doc.intent, 2000)
        || doc.decisions.len() > 16
        || doc.next_steps.len() > 12
        || !doc.next_steps.iter().all(|step| text(step, 500))
    {
        return Err("Blueprint-Projekt, Version oder Inhalt ungültig.".into());
    }
    if !["chat_handoff", "local_file", "provider_export"].contains(&doc.source.kind.as_str())
        || !text(&doc.source.label, 120)
        || !doc.source.captured_at.ends_with('Z')
        || chrono::DateTime::parse_from_rfc3339(&doc.source.captured_at).is_err()
        || doc.source.reference.as_ref().is_some_and(|s| !text(s, 240))
    {
        return Err("Blueprint-Quelle ungültig.".into());
    }
    for decision in &doc.decisions {
        if !id(&decision.id)
            || !text(&decision.title, 180)
            || !text(&decision.choice, 1200)
            || !text(&decision.rationale, 2000)
            || decision.alternatives.len() > 8
            || decision.consequences.len() > 8
            || decision.evidence.len() > 8
            || !decision.alternatives.iter().all(|s| text(s, 500))
            || !decision.consequences.iter().all(|s| text(s, 500))
            || !decision.evidence.iter().all(|ev| {
                ["git_commit", "pull_request", "issue", "test", "blueprint"]
                    .contains(&ev.kind.as_str())
                    && text(&ev.reference, 240)
            })
        {
            return Err("Blueprint-Entscheidungen ungültig.".into());
        }
    }
    if doc
        .decisions
        .iter()
        .map(|d| d.id.as_str())
        .collect::<std::collections::BTreeSet<_>>()
        .len()
        != doc.decisions.len()
    {
        return Err("Doppelte Entscheidungs-ID.".into());
    }
    Ok(doc)
}

/// Derive the registered root from persisted Project Registry, never from an IPC-provided path.
/// Then check the actual Git checkout AND the existing Memory Fabric root fingerprint.
fn registered_head(store: &MemoryStore, project_id: &str) -> Result<String, String> {
    validate_project_id(project_id)?;
    let registry = project_registry::project_registry_load()?
        .ok_or_else(|| "Keine lokale Projekt-Registry gefunden.".to_string())?;
    let project = registry
        .get("projects")
        .and_then(|v| v.as_array())
        .and_then(|list| {
            list.iter()
                .find(|item| item.get("id").and_then(|v| v.as_str()) == Some(project_id))
        })
        .ok_or_else(|| "Projekt ist nicht in der lokalen Registry registriert.".to_string())?;
    let root = project
        .get("rootPath")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Projekt besitzt keinen gültigen Git-Ordner.".to_string())?;
    let repo = project_registry::probe_repo(Path::new(root), false)
        .ok_or_else(|| "Registriertes Git-Projekt ist nicht erreichbar.".to_string())?;
    if project_registry::real_path(Path::new(root)) != repo.path {
        return Err("Projektordner stimmt nicht mit dem Git-Repository überein.".into());
    }
    if !store.root_matches(project_id, &root_fingerprint(&repo.path))? {
        return Err(
            "Memory-Fabric-Projektidentität stimmt nicht mit dem Git-Ordner überein.".into(),
        );
    }
    let head = repo
        .head_sha
        .ok_or_else(|| "Git-HEAD fehlt; Speichern nicht erlaubt.".to_string())?;
    if head.len() != 40 && head.len() != 64 {
        return Err("Git-HEAD ist ungültig.".into());
    }
    Ok(head.to_ascii_lowercase())
}

#[tauri::command]
pub(crate) async fn continuity_preflight(
    project_id: String,
) -> Result<ContinuityPreflight, String> {
    blocking(move || {
        // Preflight must NOT create/migrate SQLite merely to show a preview.
        let path = crate::app_support_dir()
            .map_err(crate::error_to_string)?
            .join(STORE_DIR)
            .join(STORE_FILE);
        let store = MemoryStore::open_read_only(&path)?
            .ok_or_else(|| "Memory Fabric ist noch nicht indexiert.".to_string())?;
        let head = registered_head(&store, &project_id)?;
        let schema: i64 = store
            .conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| "Memory-Fabric-Schema konnte nicht gelesen werden.".to_string())?;
        // v1 can still be previewed safely; only explicit Save migrates to v2.
        let tail = if schema == 1 {
            None
        } else {
            store.continuity_tail(&project_id)?
        };
        Ok(ContinuityPreflight {
            project_id,
            git_head: head,
            previous_hash: tail.as_ref().map(|e| e.event_hash.clone()),
            next_sequence: tail.map(|e| e.sequence + 1).unwrap_or(1),
            proposal_only: true,
        })
    })
    .await
}

/// Save an unverified candidate only after the user explicitly presses Save in the UI.
/// expected_head/previous_hash come from the freshly displayed preflight; both are
/// rechecked natively and the append uses an atomic compare-and-set.
#[tauri::command]
pub(crate) async fn continuity_save_blueprint(
    project_id: String,
    raw_json: String,
    expected_head: String,
    expected_prev_hash: Option<String>,
) -> Result<JournalAppendResult, String> {
    blocking(move || {
        let doc = parse_blueprint(&raw_json, &project_id)?;
        let _guard = WRITE_LOCK
            .lock()
            .map_err(|_| "Memory Fabric ist gesperrt.".to_string())?;
        let mut store = open_store()?;
        let head = registered_head(&store, &project_id)?;
        if head != expected_head.to_ascii_lowercase() {
            return Err("Git-HEAD hat sich seit der Vorschau geändert; erneut prüfen.".into());
        }
        if doc
            .base_git_head
            .as_ref()
            .is_some_and(|base| base.to_ascii_lowercase() != head)
        {
            return Err("Blueprint basiert auf anderem Git-Stand; nicht gespeichert.".into());
        }
        let digest = sha256_hex(&raw_json);
        let draft = JournalDraft {
            project_id,
            event_id: format!("blueprint:{digest}"),
            device_id: "local-ui-unverified".into(),
            kind: "decision_proposal".into(),
            summary: format!("Blueprint v{}: {}", doc.revision, doc.title),
            payload_json: raw_json,
            base_git_head: Some(head),
            // Stable source timestamp makes retransmission of the exact handoff idempotent.
            created_at: doc.source.captured_at,
            expected_prev_hash,
        };
        store.append_continuity(draft)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    const DOC: &str = r#"{"schemaVersion":"katosync.continuity-blueprint/v1","projectId":"alpha","blueprintId":"v1","revision":1,"title":"Why local","intent":"Work without cloud","source":{"kind":"chat_handoff","label":"Chat","capturedAt":"2026-10-22T10:00:00Z","reference":null},"baseGitHead":null,"decisions":[{"id":"ADR-1","title":"Local store","choice":"SQLite","rationale":"Offline first","alternatives":[],"consequences":[],"evidence":[]}],"nextSteps":[]}"#;
    #[test]
    fn native_blueprint_schema_rejects_cross_project_approval_smuggling_and_bad_decisions() {
        assert!(parse_blueprint(DOC, "alpha").is_ok());
        assert!(parse_blueprint(DOC, "beta").is_err());
        assert!(
            parse_blueprint(&DOC.replace("\"revision\":1", "\"revision\":0"), "alpha").is_err()
        );
        assert!(parse_blueprint(
            &DOC.replace(
                "\"nextSteps\":[]",
                "\"ownerApproved\":true,\"nextSteps\":[]"
            ),
            "alpha"
        )
        .is_err());
        assert!(parse_blueprint(
            &DOC.replace(
                "\"choice\":\"SQLite\"",
                "\"choice\":\"SQLite\",\"status\":\"canonical\""
            ),
            "alpha"
        )
        .is_err());
        assert!(parse_blueprint(
            &DOC.replace("\"baseGitHead\":null", "\"baseGitHead\":\"not-a-sha\""),
            "alpha"
        )
        .is_ok()); // independently checked by JournalDraft
        assert!(parse_blueprint(&"x".repeat(9000), "alpha").is_err());
    }
}
