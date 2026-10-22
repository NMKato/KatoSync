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
pub(crate) struct ContinuityLocalAnswer {
    pub project_id: String,
    pub live_git_head: String,
    pub answer: String,
    pub citations: Vec<super::RagCitation>,
    pub local_brain_used: bool,
    pub verified_memory_only: bool,
    pub session_only: bool,
}

fn validated_local_question(question: &str) -> Result<String, String> {
    let text = question.trim();
    if text.is_empty()
        || text.chars().count() > 1200
        || text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err("Lokale Frage ist leer, zu lang oder ungültig.".to_string());
    }
    Ok(text.to_string())
}

/// One question per read-only grounded inference, not a persisted multi-turn chat yet.
/// Imported unverified journal events are deliberately excluded from model RAG.
#[tauri::command]
pub(crate) async fn continuity_local_answer(
    project_id: String,
    question: String,
) -> Result<ContinuityLocalAnswer, String> {
    let question = validated_local_question(&question)?;
    let (rag, head) = blocking({
        let project_id = project_id.clone();
        let question = question.clone();
        move || {
            let path = crate::app_support_dir()
                .map_err(crate::error_to_string)?
                .join(STORE_DIR)
                .join(STORE_FILE);
            let store = MemoryStore::open_read_only(&path)?
                .ok_or_else(|| "Memory Fabric ist nicht indexiert.".to_string())?;
            let head = registered_head(&store, &project_id)?;
            // Root comes from trusted registered project state, never IPC or model output.
            let registry = project_registry::project_registry_load()?
                .ok_or_else(|| "Keine lokale Projekt-Registry gefunden.".to_string())?;
            let root = registry
                .get("projects")
                .and_then(|v| v.as_array())
                .and_then(|items| {
                    items
                        .iter()
                        .find(|item| item.get("id").and_then(|v| v.as_str()) == Some(&project_id))
                })
                .and_then(|item| item.get("rootPath").and_then(|v| v.as_str()))
                .ok_or_else(|| "Registrierter Projektpfad fehlt.".to_string())?;
            let live = super::live_state_for(&store, &project_id, root)?;
            if live.head_sha.as_deref() != Some(head.as_str()) {
                return Err(
                    "Git-Stand hat sich während des Kontextabgleichs verändert.".to_string()
                );
            }
            let result = store.query(
                &super::retrieve::MemoryQuery::new(&project_id, &question, Some(8)),
                Some(&live),
                &super::retrieve::LexicalOnly,
            )?;
            let rag = super::assemble::assemble_rag_block(&result, &super::RagOptions::default());
            Ok((rag, head))
        }
    })
    .await?;
    if rag.citations.is_empty() {
        return Ok(ContinuityLocalAnswer {
            project_id,
            live_git_head: head,
            answer: "NOT_IN_MEMORY".to_string(),
            citations: Vec::new(),
            local_brain_used: false,
            verified_memory_only: true,
            session_only: true,
        });
    }
    // Existing Local Brain path explicitly restricts HTTP to 127.0.0.1 and pinned model alias.
    let answer = crate::local_brain::grounded_chat(&rag.text, &question)
        .await
        .map_err(|_| {
            "Lokales Gemma ist nicht bereit; kein Cloud-Fallback ausgeführt.".to_string()
        })?;
    Ok(ContinuityLocalAnswer {
        project_id,
        live_git_head: head,
        answer,
        citations: rag.citations,
        local_brain_used: true,
        verified_memory_only: true,
        session_only: true,
    })
}

/// Native history read: no migration/write, no caller-controlled root or endpoint.
#[tauri::command]
pub(crate) async fn continuity_chat_history(
    project_id: String,
) -> Result<Vec<super::ChatTurn>, String> {
    blocking(move || {
        let path = crate::app_support_dir()
            .map_err(crate::error_to_string)?
            .join(STORE_DIR)
            .join(STORE_FILE);
        let store = MemoryStore::open_read_only(&path)?
            .ok_or_else(|| "Memory Fabric ist nicht indexiert.".to_string())?;
        registered_head(&store, &project_id)?;
        let schema: i64 = store
            .conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| "Memory-Fabric-Schema ist nicht lesbar.".to_string())?;
        if schema < 3 {
            return Ok(Vec::new());
        }
        store.local_chat_history(&project_id, 20)
    })
    .await
}

/// A follow-up is grounded afresh. Previous turns help resolve references but NEVER
/// become canonical truth, model system policy, tool access or another project's data.
#[tauri::command]
pub(crate) async fn continuity_chat_send(
    project_id: String,
    question: String,
    expected_sequence: i64,
) -> Result<super::ChatTurn, String> {
    let question = validated_local_question(&question)?;
    if expected_sequence < 0 || expected_sequence >= 1000 {
        return Err("Ungültiger lokaler Chat-Zustand.".to_string());
    }
    let (rag, head, previous) = blocking({
        let project_id = project_id.clone();
        let question = question.clone();
        move || {
            let path = crate::app_support_dir()
                .map_err(crate::error_to_string)?
                .join(STORE_DIR)
                .join(STORE_FILE);
            let store = MemoryStore::open_read_only(&path)?
                .ok_or_else(|| "Memory Fabric ist nicht indexiert.".to_string())?;
            let head = registered_head(&store, &project_id)?;
            let registry = project_registry::project_registry_load()?
                .ok_or_else(|| "Keine lokale Projekt-Registry gefunden.".to_string())?;
            let root = registry
                .get("projects")
                .and_then(|v| v.as_array())
                .and_then(|items| {
                    items
                        .iter()
                        .find(|i| i.get("id").and_then(|v| v.as_str()) == Some(&project_id))
                })
                .and_then(|i| i.get("rootPath").and_then(|v| v.as_str()))
                .ok_or_else(|| "Registrierter Projektordner fehlt.".to_string())?;
            let live = super::live_state_for(&store, &project_id, root)?;
            if live.head_sha.as_deref() != Some(head.as_str()) {
                return Err("Git-HEAD veränderte sich vor der Abfrage.".to_string());
            }
            let schema: i64 = store
                .conn
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .map_err(|_| "Ungültige Memory-Fabric-Version.".to_string())?;
            let previous = if schema < 3 {
                Vec::new()
            } else {
                store.local_chat_history(&project_id, 3)?
            };
            let last = if schema < 3 {
                0
            } else {
                store
                    .local_chat_history(&project_id, 1)?
                    .last()
                    .map(|turn| turn.sequence)
                    .unwrap_or(0)
            };
            if last != expected_sequence {
                return Err("Chat-Historie hat sich verändert; bitte neu laden.".to_string());
            }
            // Earlier user questions only assist search disambiguation. Model-generated answers
            // are never used to retrieve candidate facts.
            let lookup = format!(
                "{} {}",
                previous.last().map(|t| t.question.as_str()).unwrap_or(""),
                question
            );
            let result = store.query(
                &super::retrieve::MemoryQuery::new(&project_id, &lookup, Some(8)),
                Some(&live),
                &super::retrieve::LexicalOnly,
            )?;
            let rag = super::assemble::assemble_rag_block(&result, &super::RagOptions::default());
            Ok((rag, head, previous))
        }
    })
    .await?;
    let answer = if rag.citations.is_empty() {
        "NOT_IN_MEMORY".to_string()
    } else {
        let history: Vec<(String, String)> = previous
            .iter()
            .map(|turn| (turn.question.clone(), turn.answer.clone()))
            .collect();
        crate::local_brain::grounded_chat_with_history(&rag.text, &question, &history)
            .await
            .map_err(|_| "Gemma lokal nicht bereit; kein Cloud-Fallback.".to_string())?
    };
    blocking(move || {
        let _guard = WRITE_LOCK
            .lock()
            .map_err(|_| "Memory Fabric ist gesperrt.".to_string())?;
        let mut store = open_store()?;
        let current = registered_head(&store, &project_id)?;
        if current != head {
            return Err("Git-HEAD hat sich geändert; Antwort nicht gespeichert.".to_string());
        }
        let citations_json = serde_json::to_string(&rag.citations)
            .map_err(|_| "Chat-Nachweise konnten nicht kodiert werden.".to_string())?;
        store.append_local_chat_turn(super::ChatTurnDraft {
            project_id,
            expected_sequence,
            question,
            answer,
            git_head: current,
            citations_json,
            created_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        })
    })
    .await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContinuityTimeline {
    pub project_id: String,
    pub live_git_head: String,
    pub events: Vec<super::JournalEvent>,
    pub latest_sequence: i64,
    pub unverified: bool,
    pub offline_local_only: bool,
}

/// Local read-only timeline. Does not index, create or migrate a database, and
/// never returns events until the project registry, Git root and Fabric match.
#[tauri::command]
pub(crate) async fn continuity_timeline(project_id: String) -> Result<ContinuityTimeline, String> {
    blocking(move || {
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
        // Older v1 Fabric has no continuity_events yet: do NOT trigger migration on read.
        let events = if schema == 1 {
            Vec::new()
        } else {
            store.recent_continuity_events(&project_id, 20)?
        };
        let latest_sequence = events.first().map(|event| event.sequence).unwrap_or(0);
        Ok(ContinuityTimeline {
            project_id,
            live_git_head: head,
            events,
            latest_sequence,
            unverified: true,
            offline_local_only: true,
        })
    })
    .await
}

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
    fn local_question_must_be_short_nonempty_and_never_executable() {
        assert!(validated_local_question("Why was SQLite selected?").is_ok());
        assert!(validated_local_question("   ").is_err());
        assert!(validated_local_question(&"x".repeat(1201)).is_err());
        assert!(validated_local_question("stop\u{0000}").is_err());
        assert!(validated_local_question("multiline\nquestion").is_ok());
    }
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
