// Created by NMKato Solutions
//! Bounded project-scoped local chat transcript. Conversation is unverified data,
//! never automatically indexed/canonical project truth or permission to run tools.
use super::{ingest::redact_for_memory, store::MemoryStore, validate_project_id};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatTurn {
    pub project_id: String,
    pub sequence: i64,
    pub question: String,
    pub answer: String,
    pub git_head: String,
    pub citations_json: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ChatTurnDraft {
    pub project_id: String,
    pub expected_sequence: i64,
    pub question: String,
    pub answer: String,
    pub git_head: String,
    pub citations_json: String,
    pub created_at: String,
}

fn db_error(_: rusqlite::Error) -> String {
    "Lokale Chatdatenbank nicht erreichbar.".to_string()
}

fn read_turn(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatTurn> {
    Ok(ChatTurn {
        project_id: row.get(0)?,
        sequence: row.get(1)?,
        question: row.get(2)?,
        answer: row.get(3)?,
        git_head: row.get(4)?,
        citations_json: row.get(5)?,
        created_at: row.get(6)?,
    })
}

impl MemoryStore {
    /// Latest history in chronological order; no cross-project reader.
    pub(crate) fn local_chat_history(
        &self,
        project_id: &str,
        limit: usize,
    ) -> Result<Vec<ChatTurn>, String> {
        let project_id = validate_project_id(project_id)?;
        if !(1..=20).contains(&limit) {
            return Err("Unzulässiges Chat-Historienlimit.".into());
        }
        let mut stmt = self.conn.prepare(
            "SELECT project_id, sequence, question, answer, git_head, citations_json, created_at
             FROM continuity_chat_turns WHERE project_id = ?1
             ORDER BY sequence DESC LIMIT ?2"
        ).map_err(db_error)?;
        let rows = stmt
            .query_map(params![project_id, limit as i64], read_turn)
            .map_err(db_error)?;
        let mut turns: Vec<ChatTurn> = rows.collect::<Result<_, _>>().map_err(db_error)?;
        turns.reverse();
        Ok(turns)
    }

    /// Durable atomic compare-and-append. Foreign project and competing writers fail closed.
    pub(crate) fn append_local_chat_turn(
        &mut self,
        mut draft: ChatTurnDraft,
    ) -> Result<ChatTurn, String> {
        draft.project_id = validate_project_id(&draft.project_id)?.to_string();
        if draft.expected_sequence < 0 || draft.expected_sequence >= 1000 {
            return Err("Lokale Chatsitzung benötigt Archivierung.".into());
        }
        if draft.question.trim().is_empty()
            || draft.question.chars().count() > 1200
            || draft.answer.trim().is_empty()
            || draft.answer.chars().count() > 4000
            || draft.citations_json.len() > 5000
            || !(draft.git_head.len() == 40 || draft.git_head.len() == 64)
            || !draft.git_head.bytes().all(|b| b.is_ascii_hexdigit())
            || chrono::DateTime::parse_from_rfc3339(&draft.created_at).is_err()
        {
            return Err("Chat-Eintrag ist ungültig oder zu groß.".into());
        }
        let citations: serde_json::Value = serde_json::from_str(&draft.citations_json)
            .map_err(|_| "Ungültige Chat-Nachweise.".to_string())?;
        if !citations.is_array() || citations.as_array().is_some_and(|list| list.len() > 8) {
            return Err("Zu viele Chat-Nachweise.".into());
        }
        draft.question = redact_for_memory(draft.question.trim());
        draft.answer = redact_for_memory(draft.answer.trim());
        // Never store a full unredacted context block in this chat history.
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_error)?;
        let registered = tx
            .query_row(
                "SELECT 1 FROM projects WHERE project_id=?1",
                params![draft.project_id],
                |r| r.get::<_, i64>(0),
            )
            .optional()
            .map_err(db_error)?
            .is_some();
        if !registered {
            return Err("Projekt ist nicht registriert.".into());
        }
        let tail: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(sequence), 0) FROM continuity_chat_turns WHERE project_id=?1",
                params![draft.project_id],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        if tail != draft.expected_sequence {
            return Err("Chat-Konflikt: Die Historie wurde zwischenzeitlich erweitert.".into());
        }
        let turn = ChatTurn {
            project_id: draft.project_id,
            sequence: tail + 1,
            question: draft.question,
            answer: draft.answer,
            git_head: draft.git_head.to_lowercase(),
            citations_json: draft.citations_json,
            created_at: draft.created_at,
        };
        tx.execute(
            "INSERT INTO continuity_chat_turns (project_id, sequence, question, answer, git_head, citations_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![turn.project_id, turn.sequence, turn.question, turn.answer, turn.git_head,
                    turn.citations_json, turn.created_at]
        ).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(turn)
    }
}
