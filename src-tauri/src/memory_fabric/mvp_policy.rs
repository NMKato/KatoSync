// Created by NMKato Solutions
//! Read-only, HEAD-bound feature test-coverage policy from a tracked Git object.
//! The policy is CODE PROVENANCE, not authenticated owner approval.
use super::mvp_ci_matrix::FeatureCiCoverage;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    process::Stdio,
};
use tokio::{
    process::Command,
    time::{timeout, Duration},
};

pub(super) const POLICY_PATH: &str = ".katosync/mvp-acceptance-policy-v1.json";
const MAX_BYTES: usize = 24 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Policy {
    schema_version: String,
    project_id: String,
    features: Vec<PolicyFeature>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PolicyFeature {
    feature_id: String,
    acceptance_criteria: String,
    ci_checks: Vec<PolicyCiCheck>,
    test_source: String,
}
#[derive(Debug, Deserialize, Ord, PartialOrd, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PolicyCiCheck {
    workflow: String,
    job: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PolicyMatch {
    pub feature_id: String,
    pub status: &'static str,
    pub tracked_test_source: Option<String>,
    pub ready_for_coverage_review: bool,
    pub owner_approved: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PolicyAudit {
    pub status: &'static str,
    pub head_sha: String,
    pub source: &'static str,
    pub checks: Vec<PolicyMatch>,
    pub feature_acceptance_verified: bool,
}
fn sha(s: &str) -> bool {
    matches!(s.len(), 40 | 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}
fn ident(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 80
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b':'))
}
fn text(s: &str, max: usize) -> bool {
    !s.trim().is_empty() && s.chars().count() <= max && !s.chars().any(|c| c.is_control())
}
fn tracked_path(s: &str) -> bool {
    s.len() <= 200
        && s.starts_with(|c: char| c.is_ascii_alphanumeric())
        && (s.starts_with("tests/") || s.starts_with("src/") || s.starts_with("src-tauri/src/"))
        && s.split('/').all(|seg| {
            seg != "."
                && seg != ".."
                && !seg.is_empty()
                && seg
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
        })
        && (s.ends_with(".test.ts")
            || s.ends_with(".test.js")
            || s.ends_with(".spec.ts")
            || s.ends_with(".rs"))
}
fn validate(raw: &str, project: &str) -> Result<Policy, String> {
    if raw.len() > MAX_BYTES {
        return Err("Policy zu umfangreich.".into());
    }
    let policy: Policy = serde_json::from_str(raw)
        .map_err(|_| "Ungültiges Acceptance-Policy-Format.".to_string())?;
    if policy.schema_version != "katosync.mvp-acceptance-policy/v1"
        || policy.project_id != project
        || policy.features.len() > 24
    {
        return Err("Acceptance-Policy gehört nicht zu diesem Projekt.".into());
    }
    let mut ids = BTreeSet::new();
    for f in &policy.features {
        if !ident(&f.feature_id)
            || !ids.insert(&f.feature_id)
            || !text(&f.acceptance_criteria, 400)
            || !tracked_path(&f.test_source)
            || f.ci_checks.is_empty()
            || f.ci_checks.len() > 4
        {
            return Err("Ungültige oder doppelte Feature-Angaben.".into());
        }
        let mut checks = BTreeSet::new();
        for check in &f.ci_checks {
            if !text(&check.workflow, 120)
                || !text(&check.job, 120)
                || !checks.insert((&check.workflow, &check.job))
            {
                return Err("Ungültige oder doppelte CI-Gates.".into());
            }
        }
    }
    Ok(policy)
}
async fn git_read(root: &Path, args: &[&str], max_bytes: usize) -> Result<Option<String>, String> {
    let mut process = Command::new("git");
    process
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .kill_on_drop(true);
    let output = timeout(Duration::from_secs(5), process.output())
        .await
        .map_err(|_| "Git-Provenienz-Abfrage überschritt das Zeitlimit.".to_string())?
        .map_err(|_| "Git ist nicht verfügbar.".to_string())?;
    if !output.status.success() {
        return Ok(None);
    }
    if output.stdout.len() > max_bytes {
        return Err("Git-Provenienz-Daten zu umfangreich.".into());
    }
    String::from_utf8(output.stdout)
        .map(Some)
        .map_err(|_| "Git-Provenienz ist nicht UTF-8.".into())
}
async fn is_regular_at_head(root: &Path, head: &str, rel: &str) -> Result<bool, String> {
    let Some(entries) = git_read(root, &["ls-tree", head, "--", rel], 512).await? else {
        return Ok(false);
    };
    Ok(entries.lines().any(|line| {
        let Some((meta, path)) = line.split_once('\t') else {
            return false;
        };
        let mut chunks = meta.split(' ');
        let mode = chunks.next().unwrap_or("");
        let typ = chunks.next().unwrap_or("");
        matches!(mode, "100644" | "100755") && typ == "blob" && path == rel
    }))
}
fn no_policy(head: &str, status: &'static str, features: &[FeatureCiCoverage]) -> PolicyAudit {
    PolicyAudit {
        status,
        head_sha: head.to_string(),
        source: "git_object_at_head",
        checks: features
            .iter()
            .take(24)
            .map(|f| PolicyMatch {
                feature_id: f.feature_id.clone(),
                status,
                tracked_test_source: None,
                ready_for_coverage_review: false,
                owner_approved: false,
            })
            .collect(),
        feature_acceptance_verified: false,
    }
}
/// Checks a *committed* JSON policy from the exact Git HEAD object, never a
/// possibly modified working-tree file or an untrusted Blueprint-provided path.
/// Empty/malformed policy fails closed, and never grants owner approval.
pub(crate) async fn audit_policy(
    root: &Path,
    project: &str,
    head: &str,
    coverage: &[FeatureCiCoverage],
) -> Result<PolicyAudit, String> {
    if !sha(head) || !ident(project) {
        return Err("Projekt oder HEAD ungültig.".into());
    }
    if !is_regular_at_head(root, head, POLICY_PATH).await? {
        return Ok(no_policy(head, "missing_tracked_policy", coverage));
    }
    let object = format!("{head}:{POLICY_PATH}");
    let Some(raw) = git_read(root, &["show", &object], MAX_BYTES).await? else {
        return Ok(no_policy(head, "unreadable_tracked_policy", coverage));
    };
    let policy = match validate(&raw, project) {
        Ok(p) => p,
        Err(_) => return Ok(no_policy(head, "invalid_or_cross_project_policy", coverage)),
    };
    let by_id: BTreeMap<_, _> = policy
        .features
        .iter()
        .map(|f| (f.feature_id.as_str(), f))
        .collect();
    let mut checks = Vec::new();
    for feature in coverage.iter().take(24) {
        let Some(entry) = by_id.get(feature.feature_id.as_str()) else {
            checks.push(PolicyMatch {
                feature_id: feature.feature_id.clone(),
                status: "feature_not_in_policy",
                tracked_test_source: None,
                ready_for_coverage_review: false,
                owner_approved: false,
            });
            continue;
        };
        let proposal: BTreeSet<_> = feature
            .checks
            .iter()
            .map(|check| (check.workflow.as_str(), check.job.as_str()))
            .collect();
        let audited: BTreeSet<_> = entry
            .ci_checks
            .iter()
            .map(|check| (check.workflow.as_str(), check.job.as_str()))
            .collect();
        let source_present = is_regular_at_head(root, head, &entry.test_source).await?;
        let state = if entry.acceptance_criteria != feature.acceptance_criteria {
            "criteria_mismatch"
        } else if proposal.is_empty() || proposal != audited {
            "ci_mapping_mismatch"
        } else if !source_present {
            "test_source_missing"
        } else if !feature.ci_requirements_satisfied {
            "ci_not_green"
        } else {
            "ready_for_human_coverage_review"
        };
        checks.push(PolicyMatch {
            feature_id: feature.feature_id.clone(),
            status: state,
            tracked_test_source: Some(entry.test_source.clone()),
            ready_for_coverage_review: state == "ready_for_human_coverage_review",
            owner_approved: false,
        });
    }
    Ok(PolicyAudit {
        status: "tracked_policy_read",
        head_sha: head.to_string(),
        source: "git_object_at_head",
        checks,
        feature_acceptance_verified: false,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> String {
        serde_json::json!({"schemaVersion":"katosync.mvp-acceptance-policy/v1",
        "projectId":"alpha","features":[{
            "featureId":"PHONE","acceptanceCriteria":"Phone end-to-end smoke",
            "ciChecks":[{"workflow":"Fast Gate","job":"Windows Node Regression"}],
            "testSource":"tests/phone.test.ts"
        }]})
        .to_string()
    }
    #[test]
    fn strict_policy_rejects_foreign_project_duplicate_and_fake_approval() {
        assert!(validate(&sample(), "alpha").is_ok());
        assert!(validate(&sample(), "other").is_err());
        let mut raw: serde_json::Value = serde_json::from_str(&sample()).unwrap();
        raw["features"][0]["ownerApproved"] = serde_json::json!(true);
        assert!(validate(&raw.to_string(), "alpha").is_err());
        raw["features"][0]
            .as_object_mut()
            .unwrap()
            .remove("ownerApproved");
        let duplicate = raw["features"][0].clone();
        raw["features"].as_array_mut().unwrap().push(duplicate);
        assert!(validate(&raw.to_string(), "alpha").is_err());
    }

    #[tokio::test]
    async fn committed_policy_matches_exact_head_and_ignores_uncommitted_edits() {
        use super::super::mvp_ci_matrix::{CiGateCheck, FeatureCiCoverage};
        use std::process::Command as StdCommand;
        let root = std::env::temp_dir().join(format!(
            "katosync-mvp-policy-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(root.join(".katosync")).unwrap();
        std::fs::create_dir_all(root.join("tests")).unwrap();
        let run = |args: &[&str]| {
            let output = StdCommand::new("git")
                .arg("-C")
                .arg(&root)
                .args(args)
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "git {:?}: {}",
                args,
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8(output.stdout).unwrap()
        };
        run(&["init", "-q"]);
        std::fs::write(root.join(POLICY_PATH), sample()).unwrap();
        std::fs::write(root.join("tests/phone.test.ts"), "test('phone', ()=> {})").unwrap();
        run(&[
            "add",
            "--",
            ".katosync/mvp-acceptance-policy-v1.json",
            "tests/phone.test.ts",
        ]);
        run(&[
            "-c",
            "user.name=KatoSync Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-q",
            "-m",
            "Commit test policy",
        ]);
        let head = run(&["rev-parse", "HEAD"]).trim().to_string();
        let gates = vec![FeatureCiCoverage {
            feature_id: "PHONE".into(),
            lane: "mvp".into(),
            acceptance_criteria: "Phone end-to-end smoke".into(),
            checks: vec![CiGateCheck {
                workflow: "Fast Gate".into(),
                job: "Windows Node Regression".into(),
                provider_status: "provider_pass",
                run_id: Some(7),
            }],
            ci_requirements_satisfied: true,
            feature_accepted: false,
            coverage_status: "ci_jobs_passed_unapproved",
        }];
        let original = audit_policy(&root, "alpha", &head, &gates).await.unwrap();
        assert_eq!(original.status, "tracked_policy_read");
        assert_eq!(original.checks[0].status, "ready_for_human_coverage_review");
        assert!(original.checks[0].ready_for_coverage_review);
        assert!(!original.checks[0].owner_approved);
        assert!(!original.feature_acceptance_verified);
        // Attack: working-tree policy is modified but not committed.
        let changed = sample().replace("Phone end-to-end smoke", "Fake claim");
        std::fs::write(root.join(POLICY_PATH), changed).unwrap();
        let unchanged = audit_policy(&root, "alpha", &head, &gates).await.unwrap();
        assert!(
            unchanged.checks[0].ready_for_coverage_review,
            "read the immutable HEAD object, never a modified file"
        );
        // Different project must NOT inherit the exact same policy.
        let foreign = audit_policy(&root, "beta", &head, &gates).await.unwrap();
        assert_eq!(foreign.status, "invalid_or_cross_project_policy");
        assert!(!foreign.checks[0].ready_for_coverage_review);
        // File presence is necessary: new head with missing source fails closed.
        run(&["rm", "--", "tests/phone.test.ts"]);
        run(&[
            "-c",
            "user.name=KatoSync Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-q",
            "-m",
            "Remove test source",
        ]);
        let missing_head = run(&["rev-parse", "HEAD"]).trim().to_string();
        let missing = audit_policy(&root, "alpha", &missing_head, &gates)
            .await
            .unwrap();
        assert_eq!(missing.checks[0].status, "test_source_missing");
        // Old SHA must still resolve its original source without using new worktree state.
        let original_again = audit_policy(&root, "alpha", &head, &gates).await.unwrap();
        assert!(original_again.checks[0].ready_for_coverage_review);
        let mut not_green = gates.clone();
        not_green[0].ci_requirements_satisfied = false;
        let pending = audit_policy(&root, "alpha", &head, &not_green)
            .await
            .unwrap();
        assert_eq!(pending.checks[0].status, "ci_not_green");
        let mut wrong_criteria = gates.clone();
        wrong_criteria[0].acceptance_criteria = "Unrelated feature".into();
        let conflict = audit_policy(&root, "alpha", &head, &wrong_criteria)
            .await
            .unwrap();
        assert_eq!(conflict.checks[0].status, "criteria_mismatch");
        let mut wrong_job = gates.clone();
        wrong_job[0].checks[0].job = "Wrong job".into();
        let conflict = audit_policy(&root, "alpha", &head, &wrong_job)
            .await
            .unwrap();
        assert_eq!(conflict.checks[0].status, "ci_mapping_mismatch");
        // The test deliberately dirtied this temporary repo file; remove
        // only the throwaway fixture, never the real working repository.
        run(&["rm", "-f", "--", POLICY_PATH]);
        run(&[
            "-c",
            "user.name=KatoSync Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-q",
            "-m",
            "Remove policy",
        ]);
        let without_policy = run(&["rev-parse", "HEAD"]).trim().to_string();
        let absent = audit_policy(&root, "alpha", &without_policy, &gates)
            .await
            .unwrap();
        assert_eq!(absent.status, "missing_tracked_policy");
        assert!(!absent.checks[0].ready_for_coverage_review);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn test_source_paths_reject_traversal_and_absolute_paths() {
        for bad in [
            "../tests/x.test.ts",
            "/Users/test.test.ts",
            "tests/../../private/a.test.ts",
            "https://evil/a.test.ts",
            "tests/x;rm.test.ts",
            "src/./other.test.ts",
            "tests/file.txt",
        ] {
            assert!(!tracked_path(bad), "{bad}");
        }
        assert!(tracked_path("tests/feature.spec.ts"));
        assert!(tracked_path("src-tauri/src/memory_fabric/tests.rs"));
    }
}
