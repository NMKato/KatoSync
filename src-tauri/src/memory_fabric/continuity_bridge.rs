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
use base64::Engine;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

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

/// Diagnostics reveal a safe status code, never a local path, prior index root or repository URL.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalChatReadiness {
    pub code: &'static str,
    pub can_repair: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatRepairReceipt {
    pub project_id: String,
    pub backup_created: bool,
    pub indexed_sources: usize,
}

fn registered_local_root(project_id: &str) -> Result<(PathBuf, String), String> {
    validate_project_id(project_id)?;
    let registry = project_registry::project_registry_load()?
        .ok_or_else(|| "Keine lokale Projekt-Registry.".to_string())?;
    let candidates: Vec<_> = registry
        .get("projects")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Projekt-Registry ungültig.".to_string())?
        .iter()
        .filter(|v| v.get("id").and_then(|s| s.as_str()) == Some(project_id))
        .collect();
    if candidates.len() != 1 {
        return Err("Projekt-Registry nicht eindeutig.".into());
    }
    let root = candidates[0]
        .get("rootPath")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Registrierter Projektordner fehlt.".to_string())?;
    let repo = project_registry::probe_repo(Path::new(root), false)
        .ok_or_else(|| "Git-Projekt nicht erreichbar.".to_string())?;
    let real = project_registry::real_path(Path::new(root));
    if real != repo.path {
        return Err("Registrierter Pfad ist nicht die Git-Wurzel.".into());
    }
    let name = candidates[0]
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Registriertes Projekt")
        .to_string();
    Ok((PathBuf::from(real), name))
}

/// Caller must not silently attach older material indexed from another repository.
/// Even when the root moved, the NORMALIZED remote repository identity must match.
fn project_repair_state(project_id: &str, root: &Path) -> Result<LocalChatReadiness, String> {
    let repo = project_registry::probe_repo(root, false)
        .ok_or_else(|| "Git-Projekt nicht erreichbar.".to_string())?;
    let current_remote = repo
        .remote
        .as_deref()
        .and_then(super::ingest::normalize_remote);
    let database = crate::app_support_dir()
        .map_err(crate::error_to_string)?
        .join(STORE_DIR)
        .join(STORE_FILE);
    let Some(store) = MemoryStore::open_read_only(&database)? else {
        return Ok(LocalChatReadiness {
            code: "missing_index",
            can_repair: true,
        });
    };
    let version: i64 = store
        .conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|_| "Schema nicht lesbar.".to_string())?;
    let indexed: Option<(String, Option<String>)> = store
        .conn
        .query_row(
            "SELECT root_fingerprint, repo_identity FROM projects WHERE project_id=?1",
            params![project_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|_| "Indexidentität nicht lesbar.".to_string())?;
    match indexed {
        Some((old_fingerprint, old_remote)) => {
            if old_fingerprint != super::ingest::root_fingerprint(&repo.path)
                && (old_remote.is_none() || old_remote != current_remote)
            {
                return Ok(LocalChatReadiness {
                    code: "foreign_repository",
                    can_repair: false,
                });
            }
            if old_fingerprint != super::ingest::root_fingerprint(&repo.path) || version < 3 {
                Ok(LocalChatReadiness {
                    code: "needs_refresh",
                    can_repair: true,
                })
            } else {
                Ok(LocalChatReadiness {
                    code: "ready",
                    can_repair: false,
                })
            }
        }
        None => Ok(LocalChatReadiness {
            code: "missing_index",
            can_repair: true,
        }),
    }
}

#[tauri::command]
pub(crate) async fn continuity_chat_diagnostics(project_id: String) -> LocalChatReadiness {
    blocking(move || {
        let (root, _name) = registered_local_root(&project_id)?;
        project_repair_state(&project_id, &root)
    })
    .await
    .unwrap_or(LocalChatReadiness {
        code: "unavailable",
        can_repair: false,
    })
}

/// Explicit operator action: consistent SQLite snapshot BEFORE any migration or
/// re-index. Repository source root is derived from Registry, not frontend input.
#[tauri::command]
pub(crate) async fn continuity_chat_repair_project(
    project_id: String,
    accepted_backup: bool,
) -> Result<ChatRepairReceipt, String> {
    if !accepted_backup {
        return Err("Sicherung muss ausdrücklich bestätigt werden.".into());
    }
    blocking(move || {
        let (root, name) = registered_local_root(&project_id)?;
        let _lock = WRITE_LOCK
            .lock()
            .map_err(|_| "Memory Fabric gesperrt.".to_string())?;
        let state = project_repair_state(&project_id, &root)?;
        if !state.can_repair {
            return Err("Projektindex darf nicht automatisch neu zugeordnet werden.".into());
        }
        let collected = super::ingest::collect_project_sources(&root)?;
        if collected.root_fingerprint
            != super::ingest::root_fingerprint(&project_registry::real_path(&root))
        {
            return Err("Projektwurzel hat sich geändert.".into());
        }
        let path = crate::app_support_dir()
            .map_err(crate::error_to_string)?
            .join(STORE_DIR)
            .join(STORE_FILE);
        let mut backup_created = false;
        if path.is_file() {
            let backup_dir = path
                .parent()
                .ok_or_else(|| "Memory-Ordner fehlt.".to_string())?
                .join("backups");
            fs::create_dir_all(&backup_dir)
                .map_err(|_| "Sicherungsordner nicht verfügbar.".to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&backup_dir, fs::Permissions::from_mode(0o700))
                    .map_err(|_| "Sicherungsrechte nicht gesetzt.".to_string())?;
            }
            let backup = backup_dir.join(format!("pre-chat-refresh-{}.sqlite3", Uuid::new_v4()));
            let source = Connection::open_with_flags(
                &path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )
            .map_err(|_| "Quellindex nicht lesbar.".to_string())?;
            // VACUUM INTO includes committed WAL content; no unsafe file copy.
            source
                .execute(
                    "VACUUM main INTO ?1",
                    params![backup.to_string_lossy().as_ref()],
                )
                .map_err(|_| "Konsistente Datenbanksicherung fehlgeschlagen.".to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&backup, fs::Permissions::from_mode(0o600))
                    .map_err(|_| "Sicherungsrechte nicht gesetzt.".to_string())?;
            }
            let verify = Connection::open_with_flags(&backup, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|_| "Sicherung nicht lesbar.".to_string())?;
            let integrity: String = verify
                .query_row("PRAGMA quick_check", [], |r| r.get(0))
                .map_err(|_| "Sicherungsprüfung fehlgeschlagen.".to_string())?;
            if integrity != "ok" {
                return Err("Sicherung nicht intakt.".into());
            }
            backup_created = true;
        }
        let mut store = open_store()?; // performs atomic v1->v4 migration after valid backup
        let report = store.ingest(collected.into_batch(&project_id, &name, &super::now_iso()))?;
        registered_head(&store, &project_id)?;
        Ok(ChatRepairReceipt {
            project_id,
            backup_created,
            indexed_sources: report.indexed_sources,
        })
    })
    .await
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

/// Binary image is bounded, validated and NEVER persisted in project chat history.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalImageAttachment {
    mime_type: String,
    data_base64: String,
}
fn validated_image_data_url(input: LocalImageAttachment) -> Result<String, String> {
    if input.data_base64.is_empty() || input.data_base64.len() > 6_000_000 {
        return Err("Bild zu groß oder leer (maximal 4 MB).".into());
    }
    let (mime, signature): (&str, &[u8]) = match input.mime_type.as_str() {
        "image/png" => (
            "image/png",
            &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        ),
        "image/jpeg" => ("image/jpeg", &[0xff, 0xd8, 0xff]),
        _ => return Err("Nur PNG/JPEG erlaubt.".into()),
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&input.data_base64)
        .map_err(|_| "Ungültige Bilddaten.".to_string())?;
    if bytes.len() < 32 || bytes.len() > 4 * 1024 * 1024 || !bytes.starts_with(signature) {
        return Err("Bildsignatur ungültig oder zu groß.".into());
    }
    if mime == "image/png" {
        let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
        let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
        if width == 0 || height == 0 || width > 4096 || height > 4096 {
            return Err("Bildauflösung zu hoch.".into());
        }
    }
    Ok(format!("data:{mime};base64,{}", input.data_base64))
}

/// A follow-up is grounded afresh. Previous turns help resolve references but NEVER
/// become canonical truth, model system policy, tool access or another project's data.
#[tauri::command]
pub(crate) async fn continuity_chat_send(
    project_id: String,
    question: String,
    expected_sequence: i64,
    image: Option<LocalImageAttachment>,
) -> Result<super::ChatTurn, String> {
    let question = validated_local_question(&question)?;
    let image_url = image.map(validated_image_data_url).transpose()?;
    if image_url.is_some() && !crate::local_brain::vision_service_ready().await {
        return Err("Lokale Gemma-Bildanalyse ist nicht bereit; kein Bild gesendet.".into());
    }
    if expected_sequence < 0 || expected_sequence >= 1000 {
        return Err("Ungültiger lokaler Chat-Zustand.".to_string());
    }
    let (rag, head, orientation) = blocking({
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
            let orientation = if schema < 3 {
                String::new()
            } else {
                super::continuity_context::format_model_orientation(
                    &store.project_context_anchors(&project_id)?,
                )
            };
            Ok((rag, head, orientation))
        }
    })
    .await?;
    let answer = if let Some(image_data) = image_url.as_deref() {
        crate::local_brain::grounded_chat_with_project_image(
            &rag.text,
            &question,
            &orientation,
            image_data,
        )
        .await
        .map_err(|_| {
            "Gemma konnte das Bild lokal nicht auswerten; keine Textantwort vorgetäuscht."
                .to_string()
        })?
    } else if rag.citations.is_empty() {
        "NOT_IN_MEMORY".to_string()
    } else {
        crate::local_brain::grounded_chat_with_project_orientation(
            &rag.text,
            &question,
            &orientation,
        )
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
            question: if image_url.is_some() {
                format!("{question} [Bild lokal analysiert; Datei nicht gespeichert]")
            } else {
                question
            },
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

/// On-demand, read-only GitHub kickoff discovery; never logs in or creates
/// any repo, Project v2 board or issue. Project ID resolves only through the
/// local registry; user-supplied remote URLs are never accepted here.
#[tauri::command]
pub(crate) async fn continuity_github_kickoff_discover(
    project_id: String,
    feature_ids: Vec<String>,
) -> Result<super::github_kickoff_discovery::GithubKickoffDiscovery, String> {
    super::validate_project_id(&project_id)?;
    let read_registered = |project_id: String| {
        blocking(move || {
            let registry = project_registry::project_registry_load()?
                .ok_or_else(|| "Projekt-Registry fehlt.".to_string())?;
            let root = registry
                .get("projects")
                .and_then(|v| v.as_array())
                .and_then(|items| {
                    items
                        .iter()
                        .find(|p| p.get("id").and_then(|id| id.as_str()) == Some(&project_id))
                })
                .and_then(|p| p.get("rootPath").and_then(|v| v.as_str()))
                .ok_or_else(|| "Projekt muss zuerst lokal registriert werden.".to_string())?;
            Ok(root.to_string())
        })
    };
    let root = read_registered(project_id.clone()).await?;
    let report = super::github_kickoff_discovery::discover_registered_repo(
        &project_id,
        Path::new(&root),
        feature_ids,
    )
    .await?;
    let final_root = read_registered(project_id.clone()).await?;
    if final_root != root {
        return Err("Registrierter Projektordner änderte sich während der Abfrage.".into());
    }
    Ok(report)
}

/// Explicit operator-requested, authenticated, READ-ONLY GitHub CI provenance.
/// GitHub-issued workflow/job success is NOT the same as accepted MVP feature work.
#[tauri::command]
pub(crate) async fn continuity_github_ci(
    project_id: String,
) -> Result<super::github_ci::GithubCiReport, String> {
    let (root, head) = blocking({
        let project_id = project_id.clone();
        move || {
            let path = crate::app_support_dir()
                .map_err(crate::error_to_string)?
                .join(STORE_DIR)
                .join(STORE_FILE);
            let store = MemoryStore::open_read_only(&path)?
                .ok_or_else(|| "Memory Fabric ist nicht indexiert.".to_string())?;
            let head = registered_head(&store, &project_id)?;
            let registry = project_registry::project_registry_load()?
                .ok_or_else(|| "Projekt-Registry fehlt.".to_string())?;
            let root = registry
                .get("projects")
                .and_then(|v| v.as_array())
                .and_then(|items| {
                    items
                        .iter()
                        .find(|v| v.get("id").and_then(|id| id.as_str()) == Some(&project_id))
                })
                .and_then(|item| item.get("rootPath").and_then(|v| v.as_str()))
                .ok_or_else(|| "Projektverzeichnis ist nicht registriert.".to_string())?;
            let live = super::live_state_for(&store, &project_id, root)?;
            if live.head_sha.as_deref() != Some(head.as_str()) {
                return Err("Git-HEAD weicht von der Memory-Fabric-Quelle ab.".into());
            }
            Ok((root.to_string(), head))
        }
    })
    .await?;
    let mut report =
        super::github_ci::github_ci_for_registered_root(&project_id, Path::new(&root), &head)
            .await?;
    // Detect project checkout change WHILE provider requests were underway.
    let (now, tasks) = blocking({
        let project_id = project_id.clone();
        move || {
            let path = crate::app_support_dir()
                .map_err(crate::error_to_string)?
                .join(STORE_DIR)
                .join(STORE_FILE);
            let store = MemoryStore::open_read_only(&path)?
                .ok_or_else(|| "Memory Fabric ist nicht indexiert.".to_string())?;
            let current = registered_head(&store, &project_id)?;
            let progress = store.project_mvp_progress(&project_id, &current)?;
            Ok((current, progress.tasks))
        }
    })
    .await?;
    if now != head {
        return Err("Projekt-Git-Stand änderte sich während der CI-Abfrage.".into());
    }
    report.feature_ci_coverage = super::mvp_ci_matrix::feature_ci_coverage(&report, &tasks);
    let policy = super::mvp_policy::audit_policy(
        Path::new(&root),
        &project_id,
        &head,
        &report.feature_ci_coverage,
    )
    .await?;
    // The policy object is fetched from an immutable Git object at the checked
    // HEAD. Still reject a live checkout that changed while inspecting it.
    let after_policy = blocking({
        let project_id = project_id.clone();
        move || {
            let path = crate::app_support_dir()
                .map_err(crate::error_to_string)?
                .join(STORE_DIR)
                .join(STORE_FILE);
            let store = MemoryStore::open_read_only(&path)?
                .ok_or_else(|| "Memory Fabric ist nicht indexiert.".to_string())?;
            registered_head(&store, &project_id)
        }
    })
    .await?;
    if after_policy != head {
        return Err("Projekt-Git-Stand änderte sich während der Policy-Prüfung.".into());
    }
    report.acceptance_policy_audit = Some(policy);
    Ok(report)
}

/// Read-only per-project MVP tracking. Unverified checkpoint claims never count as
/// verified acceptance; a null verified_percent must not be rendered as 0% built.
#[tauri::command]
pub(crate) async fn continuity_mvp_progress(
    project_id: String,
) -> Result<super::mvp_progress::MvpProgress, String> {
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
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|_| "Memory-Fabric-Schema konnte nicht gelesen werden.".to_string())?;
        if schema < 4 {
            return Err("MVP-Tracking benötigt Blueprint-Index v4.".to_string());
        }
        store.project_mvp_progress(&project_id, &head)
    })
    .await
}

/// User-requested read-only feature audit, anchored to exactly one registered project.
/// Local Git objects are checked as existence/ancestry, never as feature test proof.
#[tauri::command]
pub(crate) async fn continuity_feature_trace(
    project_id: String,
    section_key: String,
) -> Result<super::feature_trace::FeatureTrace, String> {
    blocking(move || {
        let path = crate::app_support_dir()
            .map_err(crate::error_to_string)?
            .join(STORE_DIR)
            .join(STORE_FILE);
        let store = MemoryStore::open_read_only(&path)?
            .ok_or_else(|| "Memory Fabric ist nicht indexiert.".to_string())?;
        let head = registered_head(&store, &project_id)?;
        let schema: i64 = store
            .conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| "Unbekannte Memory-Fabric-Version.".to_string())?;
        if schema < 4 {
            return Err("Blueprint-Featureindex fehlt.".to_string());
        }
        let registry = project_registry::project_registry_load()?
            .ok_or_else(|| "Projekt-Registry fehlt.".to_string())?;
        let root = registry
            .get("projects")
            .and_then(|v| v.as_array())
            .and_then(|items| {
                items
                    .iter()
                    .find(|x| x.get("id").and_then(|v| v.as_str()) == Some(&project_id))
            })
            .and_then(|item| item.get("rootPath").and_then(|v| v.as_str()))
            .ok_or_else(|| "Projektordner ist nicht registriert.".to_string())?;
        let live = super::live_state_for(&store, &project_id, root)?;
        if live.head_sha.as_deref() != Some(head.as_str()) {
            return Err("Git-HEAD änderte sich bei der Quellenprüfung.".to_string());
        }
        super::feature_trace::build_feature_trace(
            &store,
            &project_id,
            &section_key,
            Path::new(root),
            &live,
            &head,
        )
    })
    .await
}

/// Local-only feature lookup over UNVERIFIED imported Blueprint/milestone sections.
/// The live HEAD comparison is not evidence of feature completion.
#[tauri::command]
pub(crate) async fn continuity_search_blueprint(
    project_id: String,
    query: String,
) -> Result<Vec<super::blueprint_index::BlueprintSectionMatch>, String> {
    blocking(move || {
        let path = crate::app_support_dir()
            .map_err(crate::error_to_string)?
            .join(STORE_DIR)
            .join(STORE_FILE);
        let store = MemoryStore::open_read_only(&path)?
            .ok_or_else(|| "Memory Fabric ist noch nicht indexiert.".to_string())?;
        let current_head = registered_head(&store, &project_id)?;
        let schema: i64 = store
            .conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| "Memory-Fabric-Schema konnte nicht gelesen werden.".to_string())?;
        if schema < 4 {
            return Err("Blueprint-Index ist noch nicht migriert; eine Suchanfrage verändert die Datenbank nicht.".to_string());
        }
        store.search_blueprint_sections(&project_id, &query, &current_head)
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
    #[serde(default)]
    mvp_scope: Vec<BlueprintMvpItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlueprintMvpItem {
    feature_id: String,
    title: String,
    lane: String,
    weight: u8,
    acceptance_criteria: String,
    #[serde(default)]
    ci_checks: Vec<BlueprintCiCheck>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlueprintCiCheck {
    workflow: String,
    job: String,
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
        || doc.mvp_scope.len() > 24
        || doc.mvp_scope.iter().any(|step| {
            !id(&step.feature_id)
                || !text(&step.title, 150)
                || !["mvp", "side"].contains(&step.lane.as_str())
                || !(1..=5).contains(&step.weight)
                || !text(&step.acceptance_criteria, 400)
                || step.ci_checks.len() > 4
                || step
                    .ci_checks
                    .iter()
                    .any(|c| !text(&c.workflow, 120) || !text(&c.job, 120))
                || step
                    .ci_checks
                    .iter()
                    .map(|c| (&c.workflow, &c.job))
                    .collect::<std::collections::BTreeSet<_>>()
                    .len()
                    != step.ci_checks.len()
        })
        || doc
            .mvp_scope
            .iter()
            .map(|s| s.feature_id.as_str())
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != doc.mvp_scope.len()
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
    fn mvp_scope_schema_is_explicit_weighted_and_has_no_approval_fields() {
        let base: serde_json::Value = serde_json::from_str(DOC).unwrap();
        let mut doc = base.clone();
        doc["mvpScope"] = serde_json::json!([
            {"featureId":"A","title":"Launch","lane":"mvp","weight":5,
             "acceptanceCriteria":"Independent tests + review"},
            {"featureId":"EXTRA","title":"Polish","lane":"side","weight":1,
             "acceptanceCriteria":"Owner visual approval"}
        ]);
        let serialized = doc.to_string();
        let checked = parse_blueprint(&serialized, "alpha").unwrap();
        assert_eq!(checked.mvp_scope.len(), 2);
        assert_eq!(checked.mvp_scope[0].weight, 5);
        assert_eq!(checked.mvp_scope[1].lane, "side");
        doc["mvpScope"][0]["weight"] = serde_json::json!(0);
        assert!(parse_blueprint(&doc.to_string(), "alpha").is_err());
        doc["mvpScope"][0]["weight"] = serde_json::json!(1);
        doc["mvpScope"][1]["featureId"] = serde_json::json!("A");
        assert!(parse_blueprint(&doc.to_string(), "alpha").is_err());
        doc["mvpScope"][1]["featureId"] = serde_json::json!("EXTRA");
        doc["mvpScope"][0]["ownerApproved"] = serde_json::json!(true);
        assert!(parse_blueprint(&doc.to_string(), "alpha").is_err());
    }

    #[test]
    fn native_mvp_ci_checks_require_exact_names_and_reject_fake_approvals() {
        let mut doc: serde_json::Value = serde_json::from_str(DOC).unwrap();
        doc["mvpScope"] = serde_json::json!([{
            "featureId":"PHONE","title":"Phone","lane":"mvp",
            "weight":3,"acceptanceCriteria":"Dedicated phone smoke",
            "ciChecks":[
                {"workflow":"Fast Gate","job":"Windows Node Regression"},
                {"workflow":"Fast Gate","job":"Web Build"}
            ]
        }]);
        let accepted = parse_blueprint(&doc.to_string(), "alpha").unwrap();
        assert_eq!(accepted.mvp_scope[0].ci_checks.len(), 2);
        doc["mvpScope"][0]["ciChecks"][1] = doc["mvpScope"][0]["ciChecks"][0].clone();
        assert!(parse_blueprint(&doc.to_string(), "alpha").is_err());
        doc["mvpScope"][0]["ciChecks"][1] = serde_json::json!({
            "workflow":"Fast Gate","job":"Web Build","ownerApproved":true
        });
        assert!(parse_blueprint(&doc.to_string(), "alpha").is_err());
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
