// Created by NMKato Solutions
//! Strict project-local read-only feature provenance. A claim is not proof of feature completion.
use super::{store::MemoryStore, validate_project_id, Freshness, LiveState, TruthLevel};
use rusqlite::params;
use serde::Serialize;
use std::{
    collections::BTreeSet,
    path::Path,
    process::{Command, Stdio},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeatureVersion {
    pub event_sequence: i64,
    pub event_kind: String,
    pub section_key: String,
    pub heading: String,
    pub excerpt: String,
    pub baseline_sha: Option<String>,
    pub baseline_matches: Option<bool>,
    pub evidence_json: String,
    pub trust: &'static str,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeatureEvidenceCheck {
    pub kind: String,
    pub reference: String,
    pub check: &'static str,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeatureSourceCandidate {
    pub source_ref: String,
    pub content_hash: String,
    pub truth_level: TruthLevel,
    pub freshness: Freshness,
    pub match_basis: &'static str,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeatureTrace {
    pub project_id: String,
    pub feature_id: String,
    pub live_git_head: String,
    pub versions: Vec<FeatureVersion>,
    pub claimed_evidence: Vec<FeatureEvidenceCheck>,
    pub matching_verified_sources: Vec<FeatureSourceCandidate>,
    pub completion: &'static str,
    pub evidence_policy: &'static str,
}
fn valid_key(key: &str) -> bool {
    key.len() >= 3
        && key.len() <= 100
        && (key.starts_with("decision:") || key.starts_with("milestone:"))
        && key.split_once(':').is_some_and(|(_, id)| {
            !id.is_empty()
                && id.len() <= 80
                && id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.' | b':'))
        })
}
fn feature_id(key: &str) -> Result<&str, String> {
    if !valid_key(key) {
        return Err("Ungültiger Feature-Schlüssel.".into());
    }
    Ok(key.split_once(':').unwrap().1)
}
fn db_error(_: rusqlite::Error) -> String {
    "Feature-Akte nicht verfügbar.".into()
}
impl MemoryStore {
    /// Exact joins between Blueprint decision ID and structured milestone featureKey.
    /// No fuzzy cross-project or unrelated-name merge.
    pub(crate) fn feature_versions(
        &self,
        project: &str,
        key: &str,
        head: &str,
    ) -> Result<Vec<FeatureVersion>, String> {
        let project = validate_project_id(project)?;
        let id = feature_id(key)?;
        let mut stmt=self.conn.prepare(
    "SELECT event_sequence,event_kind,section_key,heading,body,baseline_sha,evidence_json
     FROM blueprint_sections WHERE project_id=?1
       AND section_key IN (?2,?3)
     ORDER BY event_sequence DESC,section_key ASC LIMIT 20"
  ).map_err(db_error)?;
        let rows = stmt
            .query_map(
                params![project, format!("decision:{id}"), format!("milestone:{id}")],
                |row| {
                    let body: String = row.get(4)?;
                    let baseline: Option<String> = row.get(5)?;
                    Ok(FeatureVersion {
                        event_sequence: row.get(0)?,
                        event_kind: row.get(1)?,
                        section_key: row.get(2)?,
                        heading: row.get(3)?,
                        excerpt: body.chars().take(1200).collect(),
                        baseline_matches: baseline
                            .as_deref()
                            .map(|sha| sha.eq_ignore_ascii_case(head)),
                        baseline_sha: baseline,
                        evidence_json: row.get(6)?,
                        trust: "imported_unverified",
                    })
                },
            )
            .map_err(db_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
    }
}
fn full_sha(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|c| c.is_ascii_hexdigit())
}
fn git_pass(root: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}
fn check_ref(root: &Path, kind: &str, reference: &str, head: &str) -> &'static str {
    if kind != "git_commit" || !full_sha(reference) {
        return "unverified_reference";
    }
    let object = format!("{reference}^{{commit}}");
    if !git_pass(root, &["cat-file", "-e", &object]) {
        return "commit_not_present_locally";
    }
    if !git_pass(root, &["merge-base", "--is-ancestor", reference, head]) {
        return "commit_not_ancestor_of_head";
    }
    "commit_on_current_branch"
}
pub(crate) fn build_feature_trace(
    store: &MemoryStore,
    project: &str,
    key: &str,
    root: &Path,
    live: &LiveState,
    head: &str,
) -> Result<FeatureTrace, String> {
    let project = validate_project_id(project)?;
    let id = feature_id(key)?.to_string();
    let versions = store.feature_versions(project, key, head)?;
    if versions.is_empty() {
        return Err("Feature ist in diesem Projekt nicht indexiert.".into());
    }
    let mut claims = Vec::new();
    let mut dedup = BTreeSet::new();
    for version in &versions {
        let value: serde_json::Value =
            serde_json::from_str(&version.evidence_json).unwrap_or(serde_json::Value::Null);
        if let Some(items) = value.as_array() {
            for item in items.iter().take(8) {
                if claims.len() >= 20 {
                    break;
                }
                let (kind, reference) = if let Some(s) = item.as_str() {
                    ("other".to_string(), s.to_string())
                } else if let Some(obj) = item.as_object() {
                    (
                        obj.get("kind")
                            .and_then(|v| v.as_str())
                            .unwrap_or("other")
                            .to_string(),
                        obj.get("ref")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                    )
                } else {
                    continue;
                };
                if reference.is_empty() || reference.len() > 240 || kind.len() > 40 {
                    continue;
                }
                if !dedup.insert((kind.clone(), reference.clone())) {
                    continue;
                }
                let check = check_ref(root, &kind, &reference, head);
                claims.push(FeatureEvidenceCheck {
                    kind,
                    reference,
                    check,
                });
            }
        }
    }
    let mut candidates = Vec::new();
    let lookup = id
        .split(|c: char| !c.is_alphanumeric())
        .filter(|term| term.len() >= 3)
        .take(4)
        .collect::<Vec<_>>()
        .join(" ");
    if !lookup.is_empty() {
        let hits = store.query(
            &super::retrieve::MemoryQuery::new(project, &lookup, Some(12)),
            Some(live),
            &super::retrieve::LexicalOnly,
        )?;
        for hit in hits.hits {
            if !matches!(
                hit.truth_level,
                TruthLevel::Verified | TruthLevel::Canonical
            ) || !matches!(hit.freshness, Freshness::Fresh | Freshness::HeadMoved)
            {
                continue;
            }
            candidates.push(FeatureSourceCandidate {
                source_ref: hit.source_ref,
                content_hash: hit.content_hash,
                truth_level: hit.truth_level,
                freshness: hit.freshness,
                match_basis: "lexical_candidate_not_implementation_proof",
            });
            if candidates.len() >= 6 {
                break;
            }
        }
    }
    Ok(FeatureTrace {
        project_id: project.to_string(),
        feature_id: id,
        live_git_head: head.to_string(),
        versions,
        claimed_evidence: claims,
        matching_verified_sources: candidates,
        completion: "unknown_requires_feature_specific_tests_and_owner_review",
        evidence_policy: "git_commit_presence_only;source_candidates_are_not_feature_completion",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commit_check_proves_only_local_history_not_feature_completion() {
        let root = std::env::temp_dir().join(format!(
            "katosync-evidence-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let run = |args: &[&str]| {
            Command::new("git")
                .arg("-C")
                .arg(&root)
                .args(args)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .output()
                .unwrap()
        };
        assert!(run(&["init", "-q"]).status.success());
        assert!(run(&[
            "-c",
            "user.name=KatoSync Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "Test-only evidence"
        ])
        .status
        .success());
        let head = String::from_utf8(run(&["rev-parse", "HEAD"]).stdout)
            .unwrap()
            .trim()
            .to_string();
        assert!(full_sha(&head));
        assert_eq!(
            check_ref(&root, "git_commit", &head, &head),
            "commit_on_current_branch"
        );
        assert_eq!(
            check_ref(&root, "git_commit", &"a".repeat(40), &head),
            "commit_not_present_locally"
        );
        assert_eq!(
            check_ref(&root, "test", &head, &head),
            "unverified_reference"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }
    #[test]
    fn scoped_feature_keys_reject_bad_forms() {
        assert_eq!(feature_id("decision:ADR-10").unwrap(), "ADR-10");
        assert_eq!(feature_id("milestone:ADR-10").unwrap(), "ADR-10");
        for key in [
            "decision:",
            "milestone:../x",
            "other:ADR-10",
            "decision:ADR 10",
            "decision:ADR' OR 1=1",
        ] {
            assert!(feature_id(key).is_err());
        }
        assert!(full_sha(&"a".repeat(40)));
        assert!(!full_sha("bad"));
    }
}
