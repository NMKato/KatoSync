// Created by NMKato Solutions
//! Indexed, project-bound Blueprint *proposals* and journal milestones.
//! This is a derived search projection, NEVER canonical verified project memory.
use super::{store::MemoryStore, validate_project_id};
use rusqlite::{params, Connection};
use serde::Serialize;

pub(super) const SCHEMA_V4: &str = r#"
CREATE TABLE IF NOT EXISTS blueprint_sections (
  section_id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL,
  event_sequence INTEGER NOT NULL,
  event_kind TEXT NOT NULL CHECK(event_kind IN ('blueprint','milestone')),
  section_key TEXT NOT NULL,
  heading TEXT NOT NULL,
  body TEXT NOT NULL,
  baseline_sha TEXT,
  evidence_json TEXT NOT NULL,
  truth_status TEXT NOT NULL DEFAULT 'imported_unverified' CHECK(truth_status='imported_unverified'),
  FOREIGN KEY(project_id,event_sequence)
    REFERENCES continuity_events(project_id,sequence) ON DELETE CASCADE,
  UNIQUE(project_id,event_sequence,section_key)
) STRICT;
CREATE INDEX IF NOT EXISTS blueprint_sections_project ON blueprint_sections(project_id,event_sequence,section_key);
CREATE VIRTUAL TABLE IF NOT EXISTS blueprint_sections_fts USING fts5(
  heading,body, content='blueprint_sections',content_rowid='section_id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS bp_section_ai AFTER INSERT ON blueprint_sections BEGIN
  INSERT INTO blueprint_sections_fts(rowid,heading,body) VALUES(new.section_id,new.heading,new.body);
END;
CREATE TRIGGER IF NOT EXISTS bp_section_ad AFTER DELETE ON blueprint_sections BEGIN
  INSERT INTO blueprint_sections_fts(blueprint_sections_fts,rowid,heading,body)
  VALUES('delete',old.section_id,old.heading,old.body);
END;
CREATE TRIGGER IF NOT EXISTS bp_section_au AFTER UPDATE ON blueprint_sections BEGIN
  INSERT INTO blueprint_sections_fts(blueprint_sections_fts,rowid,heading,body)
  VALUES('delete',old.section_id,old.heading,old.body);
  INSERT INTO blueprint_sections_fts(rowid,heading,body) VALUES(new.section_id,new.heading,new.body);
END;
"#;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BlueprintSectionMatch {
    pub project_id: String,
    pub event_sequence: i64,
    pub event_kind: String,
    pub section_key: String,
    pub heading: String,
    pub excerpt: String,
    pub baseline_sha: Option<String>,
    pub git_baseline_matches: Option<bool>,
    pub evidence_json: String,
    pub truth_status: String,
    pub relevance: f64,
}

fn err(_: rusqlite::Error) -> String {
    "Blueprint-Index nicht erreichbar.".into()
}
fn str_field(data: &serde_json::Value, name: &str, limit: usize) -> String {
    data.get(name)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .chars()
        .take(limit)
        .collect::<String>()
}
fn fragments(data: &serde_json::Value, name: &str, cap: usize) -> String {
    data.get(name)
        .and_then(|x| x.as_array())
        .map(|items| {
            items
                .iter()
                .take(cap)
                .filter_map(|x| x.as_str())
                .map(|s| s.chars().take(300).collect::<String>())
                .collect::<Vec<_>>()
                .join(" · ")
        })
        .unwrap_or_default()
}

fn insert_section(
    conn: &Connection,
    project: &str,
    seq: i64,
    kind: &str,
    key: &str,
    heading: &str,
    body: &str,
    baseline: Option<&str>,
    evidence: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO blueprint_sections
         (project_id,event_sequence,event_kind,section_key,heading,body,baseline_sha,evidence_json)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![project, seq, kind, key, heading, body, baseline, evidence],
    )
    .map_err(err)?;
    Ok(())
}

/// Called inside the SAME SQLite transaction as the immutable journal append.
/// Can also reconstruct a missing projection deterministically during schema migration.
pub(super) fn index_journal_event(
    conn: &Connection,
    project: &str,
    seq: i64,
    event_id: &str,
    event_kind: &str,
    payload: &str,
    baseline: Option<&str>,
) -> Result<(), String> {
    if !matches!(event_kind, "decision_proposal" | "checkpoint") {
        return Ok(());
    }
    let value: serde_json::Value = match serde_json::from_str(payload) {
        Ok(value) => value,
        Err(_) => return Ok(()),
    };
    if value.get("projectId").and_then(|v| v.as_str()) != Some(project) {
        return Ok(());
    }
    if event_kind == "decision_proposal" {
        if !event_id.starts_with("blueprint:")
            || value.get("schemaVersion").and_then(|v| v.as_str())
                != Some("katosync.continuity-blueprint/v1")
        {
            return Ok(());
        }
        let title = str_field(&value, "title", 180);
        let intent = str_field(&value, "intent", 1000);
        let steps = fragments(&value, "nextSteps", 12);
        let heading = format!("Blueprint: {title}");
        let overview = format!("Intent: {intent}\nNext steps: {steps}");
        insert_section(
            conn,
            project,
            seq,
            "blueprint",
            "overview",
            &heading,
            &overview,
            baseline,
            "[]",
        )?;
        if let Some(decisions) = value.get("decisions").and_then(|v| v.as_array()) {
            for (n, decision) in decisions.iter().take(16).enumerate() {
                let id = str_field(decision, "id", 80);
                let key = format!(
                    "decision:{}",
                    if id.is_empty() {
                        n.to_string()
                    } else {
                        id.clone()
                    }
                );
                let title = str_field(decision, "title", 180);
                let heading = format!("{id} {title}");
                let body = format!(
                    "Choice: {}\nWhy: {}\nAlternatives: {}\nConsequences: {}",
                    str_field(decision, "choice", 1200),
                    str_field(decision, "rationale", 2000),
                    fragments(decision, "alternatives", 8),
                    fragments(decision, "consequences", 8)
                );
                let ev = decision
                    .get("evidence")
                    .cloned()
                    .unwrap_or(serde_json::json!([]));
                let evidence = ev.to_string();
                insert_section(
                    conn,
                    project,
                    seq,
                    "blueprint",
                    &key,
                    &heading,
                    &body,
                    baseline,
                    &evidence,
                )?;
            }
        }
    } else {
        // Milestones are only indexable when they have structured project identity.
        // Their status/evidence are claims; never auto-approved completion.
        let feature = str_field(&value, "featureKey", 80);
        let title = str_field(&value, "title", 180);
        let why = str_field(&value, "rationale", 2000);
        let summary = str_field(&value, "summary", 1200);
        if feature.is_empty() || title.is_empty() {
            return Ok(());
        }
        let evidence = value
            .get("evidence")
            .cloned()
            .unwrap_or(serde_json::json!([]))
            .to_string();
        let heading = format!("Milestone: {feature} {title}");
        let body = format!(
            "Summary: {summary}\nReason: {why}\nClaimed status: {}",
            str_field(&value, "status", 60)
        );
        insert_section(
            conn,
            project,
            seq,
            "milestone",
            &format!("milestone:{feature}"),
            &heading,
            &body,
            baseline,
            &evidence,
        )?;
    }
    Ok(())
}

/// Backfills after migration, within one writer transaction, from immutable journal entries.
/// No model inference, provider access or second database.
pub(super) fn backfill(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT project_id,sequence,event_id,kind,payload_json,base_git_head
         FROM continuity_events WHERE kind IN ('decision_proposal','checkpoint')
         ORDER BY project_id,sequence",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(err)?;
    for item in rows {
        let (project, seq, event_id, kind, payload, baseline) = item.map_err(err)?;
        index_journal_event(
            conn,
            &project,
            seq,
            &event_id,
            &kind,
            &payload,
            baseline.as_deref(),
        )?;
    }
    Ok(())
}

/// Literal word-only FTS query, no raw MATCH syntax injection or arbitrary tables.
fn fts_phrase(query: &str) -> Option<String> {
    let words: Vec<String> = query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| s.chars().count() >= 2)
        .take(8)
        .map(|s| s.chars().take(50).collect::<String>())
        .collect();
    if words.is_empty() {
        return None;
    }
    Some(
        words
            .iter()
            .map(|word| format!("\"{}\"", word))
            .collect::<Vec<_>>()
            .join(" OR "),
    )
}

impl MemoryStore {
    pub(crate) fn search_blueprint_sections(
        &self,
        project_id: &str,
        query: &str,
        current_head: &str,
    ) -> Result<Vec<BlueprintSectionMatch>, String> {
        let project = validate_project_id(project_id)?;
        if query.chars().count() > 200 {
            return Err("Blueprint-Suchbegriff zu lang.".into());
        }
        let phrase = match fts_phrase(query) {
            Some(p) => p,
            None => return Ok(Vec::new()),
        };
        let mut stmt = self
            .conn
            .prepare(
                "SELECT b.project_id,b.event_sequence,b.event_kind,b.section_key,
                    b.heading,b.body,b.baseline_sha,b.evidence_json,b.truth_status,
                    bm25(blueprint_sections_fts) AS rank
             FROM blueprint_sections_fts JOIN blueprint_sections b
               ON b.section_id=blueprint_sections_fts.rowid
             WHERE blueprint_sections_fts MATCH ?1 AND b.project_id=?2
             ORDER BY rank ASC,b.event_sequence DESC LIMIT 12",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map(params![phrase, project], |row| {
                let body: String = row.get(5)?;
                let baseline: Option<String> = row.get(6)?;
                let git_baseline_matches = baseline
                    .as_ref()
                    .map(|sha| sha.eq_ignore_ascii_case(current_head));
                Ok(BlueprintSectionMatch {
                    project_id: row.get(0)?,
                    event_sequence: row.get(1)?,
                    event_kind: row.get(2)?,
                    section_key: row.get(3)?,
                    heading: row.get(4)?,
                    excerpt: body.chars().take(1000).collect(),
                    baseline_sha: baseline,
                    git_baseline_matches,
                    evidence_json: row.get(7)?,
                    truth_status: row.get(8)?,
                    relevance: row.get(9)?,
                })
            })
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)
    }
}
