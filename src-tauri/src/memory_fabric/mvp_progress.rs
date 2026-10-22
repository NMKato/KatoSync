// Created by NMKato Solutions
//! Scoped Blueprint MVP scope tracking. REPORTS are NOT test/owner-approved completion.
use super::{store::MemoryStore, validate_project_id};
use rusqlite::params;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MvpTaskProgress {
    pub feature_id: String,
    pub title: String,
    pub lane: String,
    pub weight: u8,
    pub acceptance_criteria: String,
    pub reported_status: &'static str,
    pub status_journal_sequence: Option<i64>,
    pub verified: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MvpProgress {
    pub project_id: String,
    pub plan_journal_sequence: Option<i64>,
    pub plan_status: &'static str,
    pub mvp_task_count: usize,
    pub side_task_count: usize,
    pub total_weight: u32,
    pub reported_done_weight: u32,
    pub reported_percent: Option<u8>,
    /// Null until independently checked feature-level test + reviewer approvals exist.
    pub verified_percent: Option<u8>,
    pub tasks: Vec<MvpTaskProgress>,
}
fn error(_: rusqlite::Error) -> String {
    "Lokale MVP-Übersicht konnte nicht gelesen werden.".into()
}

impl MemoryStore {
    /// Deliberately does not calculate "verified completion" from untrusted notes,
    /// present commit objects, or generic GitHub CI runs.
    pub(crate) fn project_mvp_progress(&self, project_id: &str) -> Result<MvpProgress, String> {
        let id = validate_project_id(project_id)?;
        let mut progress = MvpProgress {
            project_id: id.to_string(),
            plan_journal_sequence: None,
            plan_status: "missing_explicit_mvp_scope",
            mvp_task_count: 0,
            side_task_count: 0,
            total_weight: 0,
            reported_done_weight: 0,
            reported_percent: None,
            verified_percent: None,
            tasks: Vec::new(),
        };
        // Latest explicit MVP plan, not any arbitrary nextStep/ADR; v1 Blueprints
        // without mvpScope show NOT CONFIGURED instead of a fictional 0% completed.
        let mut plans = self
            .conn
            .prepare(
                "SELECT sequence,payload_json FROM continuity_events WHERE project_id=?1
             AND kind='decision_proposal' AND event_id LIKE 'blueprint:%'
             ORDER BY sequence DESC LIMIT 40",
            )
            .map_err(error)?;
        let events = plans
            .query_map(params![id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(error)?;
        let mut chosen: Option<(i64, Vec<serde_json::Value>)> = None;
        for row in events {
            let (seq, raw) = row.map_err(error)?;
            let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
                continue;
            };
            if json.get("schemaVersion").and_then(|v| v.as_str())
                != Some("katosync.continuity-blueprint/v1")
                || json.get("projectId").and_then(|v| v.as_str()) != Some(id)
            {
                continue;
            }
            let Some(scope) = json.get("mvpScope").and_then(|v| v.as_array()) else {
                continue;
            };
            if scope.is_empty() || scope.len() > 24 {
                continue;
            }
            chosen = Some((seq, scope.clone()));
            break;
        }
        let Some((seq, scope)) = chosen else {
            return Ok(progress);
        };
        let mut unique = BTreeSet::new();
        let mut tasks = Vec::new();
        for item in scope {
            let Some(feature) = item.get("featureId").and_then(|v| v.as_str()) else {
                return Ok(progress);
            };
            let Some(title) = item.get("title").and_then(|v| v.as_str()) else {
                return Ok(progress);
            };
            let Some(lane) = item.get("lane").and_then(|v| v.as_str()) else {
                return Ok(progress);
            };
            let Some(weight) = item.get("weight").and_then(|v| v.as_u64()) else {
                return Ok(progress);
            };
            let Some(criteria) = item.get("acceptanceCriteria").and_then(|v| v.as_str()) else {
                return Ok(progress);
            };
            if feature.len() > 80
                || feature.is_empty()
                || !feature
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b':'))
                || !unique.insert(feature.to_string())
                || title.len() > 150
                || title.is_empty()
                || !matches!(lane, "mvp" | "side")
                || !(1..=5).contains(&weight)
                || criteria.len() > 400
                || criteria.is_empty()
            {
                return Ok(progress);
            }
            tasks.push(MvpTaskProgress {
                feature_id: feature.to_string(),
                title: title.to_string(),
                lane: lane.to_string(),
                weight: weight as u8,
                acceptance_criteria: criteria.to_string(),
                reported_status: "not_reported",
                status_journal_sequence: None,
                verified: false,
            });
        }
        // Latest claim by stable feature ID wins, scoped strictly to the SAME project.
        // Only structured checkpoint records submitted after the selected scope revision.
        let mut stmt = self
            .conn
            .prepare(
                "SELECT sequence,payload_json FROM continuity_events WHERE project_id=?1
            AND kind='checkpoint' AND sequence>=?2 ORDER BY sequence DESC LIMIT 400",
            )
            .map_err(error)?;
        let claims = stmt
            .query_map(params![id, seq], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(error)?;
        let mut latest: BTreeMap<String, (i64, String)> = BTreeMap::new();
        for row in claims {
            let (sequence, raw) = row.map_err(error)?;
            let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
                continue;
            };
            if json.get("projectId").and_then(|v| v.as_str()) != Some(id) {
                continue;
            }
            let Some(feature) = json.get("featureKey").and_then(|v| v.as_str()) else {
                continue;
            };
            let Some(status) = json.get("status").and_then(|v| v.as_str()) else {
                continue;
            };
            if !matches!(
                status,
                "completed" | "done" | "in_progress" | "blocked" | "pending" | "not_started"
            ) {
                continue;
            }
            latest
                .entry(feature.to_string())
                .or_insert((sequence, status.to_string()));
        }
        progress.plan_journal_sequence = Some(seq);
        progress.plan_status = "imported_unverified";
        for task in &mut tasks {
            if let Some((claim_seq, status)) = latest.get(&task.feature_id) {
                task.reported_status = match status.as_str() {
                    "completed" | "done" => "claimed_done",
                    "in_progress" => "claimed_in_progress",
                    "blocked" => "claimed_blocked",
                    _ => "claimed_pending",
                };
                task.status_journal_sequence = Some(*claim_seq);
            }
            if task.lane == "mvp" {
                progress.mvp_task_count += 1;
                progress.total_weight += task.weight as u32;
                if task.reported_status == "claimed_done" {
                    progress.reported_done_weight += task.weight as u32;
                }
            } else {
                progress.side_task_count += 1;
            }
        }
        if progress.total_weight > 0 {
            progress.reported_percent =
                Some(((progress.reported_done_weight * 100) / progress.total_weight) as u8);
        }
        progress.tasks = tasks;
        Ok(progress)
    }
}
