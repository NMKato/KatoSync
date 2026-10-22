// Created by NMKato Solutions
//! Local, append-only Continuity journal backed by the EXISTING Memory Fabric SQLite database.
//! Imported model/handoff content stays unverified DATA, never canonical memory or agent instruction.
//! No remote API, scheduler, writer permission or Tauri command is exposed in this slice.
use super::{
    ingest::{redact_for_memory, sha256_hex},
    store::MemoryStore,
    validate_project_id,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::Serialize;

pub(crate) const JOURNAL_SCHEMA_VERSION: &str = "katosync.continuity-journal/v1";

#[derive(Debug, Clone)]
pub(crate) struct JournalDraft {
    pub project_id: String,
    pub event_id: String,
    pub device_id: String,
    pub kind: String,
    pub summary: String,
    pub payload_json: String,
    pub base_git_head: Option<String>,
    pub created_at: String,
    pub expected_prev_hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JournalEvent {
    pub schema_version: String,
    pub project_id: String,
    pub sequence: i64,
    pub event_id: String,
    pub device_id: String,
    pub kind: String,
    pub summary: String,
    pub payload_json: String,
    pub base_git_head: Option<String>,
    pub created_at: String,
    pub previous_hash: Option<String>,
    pub event_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JournalAppendResult {
    pub event: JournalEvent,
    pub replayed: bool,
}

fn is_token(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':' | b'.'))
}

fn hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

// Sanitize string VALUES, not serialized JSON syntax, so redaction cannot corrupt JSON.
// Never interpret imported objects as tool arguments or policy.
fn sanitize_payload(value: &mut serde_json::Value, depth: usize) -> Result<(), String> {
    if depth > 16 {
        return Err("Continuity-Ereignis ist zu stark verschachtelt.".to_string());
    }
    match value {
        serde_json::Value::String(s) => *s = redact_for_memory(s),
        serde_json::Value::Array(items) => {
            if items.len() > 80 {
                return Err("Continuity-Ereignis ist zu umfangreich.".to_string());
            }
            for item in items {
                sanitize_payload(item, depth + 1)?;
            }
        }
        serde_json::Value::Object(items) => {
            if items.len() > 80 {
                return Err("Continuity-Ereignis ist zu umfangreich.".to_string());
            }
            for (key, item) in items {
                let name = key.to_ascii_lowercase();
                if [
                    "password",
                    "secret",
                    "token",
                    "api_key",
                    "apikey",
                    "authorization",
                    "private_key",
                ]
                .iter()
                .any(|marker| name.contains(marker))
                {
                    *item = serde_json::Value::String("[redacted]".to_string());
                } else {
                    sanitize_payload(item, depth + 1)?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn safe_error(_: rusqlite::Error) -> String {
    "Continuity-Journal-Datenbankfehler.".to_string()
}

impl JournalDraft {
    fn validate(mut self) -> Result<Self, String> {
        self.project_id = validate_project_id(&self.project_id)?.to_owned();
        if !is_token(&self.event_id, 96) || !is_token(&self.device_id, 96) {
            return Err("Ungültige Event- oder Geräte-ID.".to_string());
        }
        if !matches!(
            self.kind.as_str(),
            "checkpoint" | "decision_proposal" | "work_note" | "handoff" | "test_result"
        ) {
            return Err("Unbekannter Continuity-Ereignistyp.".to_string());
        }
        if self.summary.len() > 512 || self.payload_json.len() > 8192 {
            return Err("Continuity-Ereignis zu groß.".to_string());
        }
        self.summary = redact_for_memory(&self.summary).trim().to_string();
        if self.summary.is_empty() || self.summary.chars().any(char::is_control) {
            return Err("Ungültige Ereigniszusammenfassung.".to_string());
        }
        let mut value: serde_json::Value = serde_json::from_str(&self.payload_json)
            .map_err(|_| "Ereignisinhalt muss JSON sein.".to_string())?;
        if !value.is_object() {
            return Err("Ereignisinhalt muss ein JSON-Objekt sein.".to_string());
        }
        // Defense in depth: imported data is untrusted even when redacted.
        sanitize_payload(&mut value, 0)?;
        self.payload_json = value.to_string();
        if self.payload_json.len() > 8192 {
            return Err("Continuity-Ereignis zu groß.".to_string());
        }
        if let Some(base) = &self.base_git_head {
            if !(base.len() == 40 || base.len() == 64)
                || !base.bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err("Ungültiger Git-Basispunkt.".to_string());
            }
            self.base_git_head = Some(base.to_ascii_lowercase());
        }
        if let Some(previous) = &self.expected_prev_hash {
            if !hash(previous) {
                return Err("Ungültiger Ereignisvorgänger.".to_string());
            }
            self.expected_prev_hash = Some(previous.to_ascii_lowercase());
        }
        if self.created_at.len() > 40
            || !self.created_at.ends_with('Z')
            || chrono::DateTime::parse_from_rfc3339(&self.created_at).is_err()
        {
            return Err("Ungültiger Ereigniszeitpunkt.".to_string());
        }
        Ok(self)
    }
}

impl MemoryStore {
    /// Most recent event in one project, for optimistic and explicit UI preflight.
    pub(crate) fn continuity_tail(&self, project_id: &str) -> Result<Option<JournalEvent>, String> {
        let project_id = validate_project_id(project_id)?;
        self.conn
            .query_row(
                "SELECT sequence, event_id, device_id, kind, summary, payload_json, base_git_head,
                    created_at, previous_hash, event_hash
             FROM continuity_events WHERE project_id = ?1 ORDER BY sequence DESC LIMIT 1",
                params![project_id],
                |row| read_event_row(row, project_id),
            )
            .optional()
            .map_err(safe_error)
    }

    /// Single-writer, project-bound compare-and-append. No new project or permission is created.
    pub(crate) fn append_continuity(
        &mut self,
        draft: JournalDraft,
    ) -> Result<JournalAppendResult, String> {
        let draft = draft.validate()?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(safe_error)?;
        let registered = tx
            .query_row(
                "SELECT 1 FROM projects WHERE project_id = ?1",
                params![draft.project_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(safe_error)?
            .is_some();
        if !registered {
            return Err("Projekt ist in der Memory Fabric nicht registriert.".to_string());
        }
        let existing = tx
            .query_row(
                "SELECT sequence, event_id, device_id, kind, summary, payload_json, base_git_head,
                    created_at, previous_hash, event_hash
             FROM continuity_events WHERE project_id = ?1 AND event_id = ?2",
                params![draft.project_id, draft.event_id],
                |row| Ok(read_event_row(row, &draft.project_id)),
            )
            .optional()
            .map_err(safe_error)?;
        if let Some(existing) = existing {
            let event = existing.map_err(safe_error)?;
            if event.device_id != draft.device_id
                || event.kind != draft.kind
                || event.summary != draft.summary
                || event.payload_json != draft.payload_json
                || event.base_git_head != draft.base_git_head
                || event.created_at != draft.created_at
                || event.previous_hash != draft.expected_prev_hash
            {
                return Err("Ereignis-ID ist bereits anders belegt; keine Änderung.".to_string());
            }
            tx.commit().map_err(safe_error)?;
            return Ok(JournalAppendResult {
                event,
                replayed: true,
            });
        }
        let tail: Option<(i64, String)> = tx
            .query_row(
                "SELECT sequence, event_hash FROM continuity_events
             WHERE project_id = ?1 ORDER BY sequence DESC LIMIT 1",
                params![draft.project_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(safe_error)?;
        let current_hash = tail.as_ref().map(|(_, hash)| hash.clone());
        if current_hash != draft.expected_prev_hash {
            return Err(
                "Continuity-Konflikt: Vorgänger stimmt nicht; erst abgleichen.".to_string(),
            );
        }
        let sequence = tail.map(|(seq, _)| seq + 1).unwrap_or(1);
        let content = serde_json::to_string(&(
            JOURNAL_SCHEMA_VERSION,
            &draft.project_id,
            sequence,
            &draft.event_id,
            &draft.device_id,
            &draft.kind,
            &draft.summary,
            &draft.payload_json,
            &draft.base_git_head,
            &draft.created_at,
            &draft.expected_prev_hash,
        ))
        .map_err(|_| "Continuity-Journal kann Ereignis nicht kodieren.".to_string())?;
        let event_hash = sha256_hex(&content);
        tx.execute(
            "INSERT INTO continuity_events
            (project_id, sequence, event_id, device_id, kind, summary, payload_json,
             base_git_head, created_at, previous_hash, event_hash)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                draft.project_id,
                sequence,
                draft.event_id,
                draft.device_id,
                draft.kind,
                draft.summary,
                draft.payload_json,
                draft.base_git_head,
                draft.created_at,
                draft.expected_prev_hash,
                event_hash
            ],
        )
        .map_err(safe_error)?;
        tx.commit().map_err(safe_error)?;
        Ok(JournalAppendResult {
            event: JournalEvent {
                schema_version: JOURNAL_SCHEMA_VERSION.to_string(),
                project_id: draft.project_id,
                sequence,
                event_id: draft.event_id,
                device_id: draft.device_id,
                kind: draft.kind,
                summary: draft.summary,
                payload_json: draft.payload_json,
                base_git_head: draft.base_git_head,
                created_at: draft.created_at,
                previous_hash: draft.expected_prev_hash,
                event_hash,
            },
            replayed: false,
        })
    }

    /// Last N events for local Timeline UI. Always scoped; never returns another project.
    pub(crate) fn recent_continuity_events(
        &self,
        project_id: &str,
        limit: usize,
    ) -> Result<Vec<JournalEvent>, String> {
        let project_id = validate_project_id(project_id)?;
        if !(1..=30).contains(&limit) {
            return Err("Ungültige Timeline-Lesemenge.".to_string());
        }
        let mut stmt = self
            .conn
            .prepare(
                "SELECT sequence, event_id, device_id, kind, summary, payload_json, base_git_head,
                    created_at, previous_hash, event_hash
             FROM continuity_events WHERE project_id = ?1
             ORDER BY sequence DESC LIMIT ?2",
            )
            .map_err(safe_error)?;
        let rows = stmt
            .query_map(params![project_id, limit as i64], |row| {
                read_event_row(row, project_id)
            })
            .map_err(safe_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(safe_error)
    }

    /// A bounded read with mandatory project scope. No cross-project query API.
    pub(crate) fn continuity_events(
        &self,
        project_id: &str,
        after_sequence: i64,
        limit: usize,
    ) -> Result<Vec<JournalEvent>, String> {
        let project_id = validate_project_id(project_id)?;
        if after_sequence < 0 || limit == 0 || limit > 100 {
            return Err("Ungültiger Continuity-Lesebereich.".to_string());
        }
        let mut stmt = self
            .conn
            .prepare(
                "SELECT sequence, event_id, device_id, kind, summary, payload_json, base_git_head,
                    created_at, previous_hash, event_hash
             FROM continuity_events WHERE project_id = ?1 AND sequence > ?2
             ORDER BY sequence ASC LIMIT ?3",
            )
            .map_err(safe_error)?;
        let rows = stmt
            .query_map(params![project_id, after_sequence, limit as i64], |row| {
                read_event_row(row, project_id)
            })
            .map_err(safe_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(safe_error)
    }
}

fn read_event_row(row: &rusqlite::Row<'_>, project_id: &str) -> rusqlite::Result<JournalEvent> {
    Ok(JournalEvent {
        schema_version: JOURNAL_SCHEMA_VERSION.to_string(),
        project_id: project_id.to_string(),
        sequence: row.get(0)?,
        event_id: row.get(1)?,
        device_id: row.get(2)?,
        kind: row.get(3)?,
        summary: row.get(4)?,
        payload_json: row.get(5)?,
        base_git_head: row.get(6)?,
        created_at: row.get(7)?,
        previous_hash: row.get(8)?,
        event_hash: row.get(9)?,
    })
}
