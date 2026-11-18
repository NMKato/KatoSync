// NMKato Solutions — KatoSync 4.0 Trust Gate 4: exact native roadmap scope audit.
// A matching blueprint is only a documentary scope, not owner-reviewed truth.
// Never raise verifiedPercent or activate ETA from this helper.
use super::SignedAcceptanceReceipt;
use crate::memory_fabric::mvp_progress::{MvpProgress, MvpTaskProgress};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

fn scope_error() -> String {
    "ACCEPTANCE_SCOPE_UNVERIFIED".into()
}
fn ordinal(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}
fn valid_feature_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b':'))
}
fn valid_ci_text(s: &str) -> bool {
    !s.trim().is_empty() && s.chars().count() <= 120
}

/// The exact JSON array format of acceptanceScopeDigest40 in the TypeScript
/// layer. Sorting uses UTF-16 ordinal comparison, NOT machine locale collation.
/// No duplicate feature IDs or CI pairs are allowed.
pub(super) fn digest_for_progress(p: &MvpProgress) -> Result<String, String> {
    let seq = p.plan_journal_sequence.ok_or_else(scope_error)?;
    if seq <= 0
        || p.plan_status != "imported_unverified"
        || p.project_id.is_empty()
        || p.tasks.is_empty()
        || p.tasks.len() > 24
    {
        return Err(scope_error());
    }
    let mut tasks: Vec<&MvpTaskProgress> = p.tasks.iter().collect();
    tasks.sort_by(|a, b| ordinal(&a.feature_id, &b.feature_id));
    let mut unique = BTreeSet::new();
    let mut mvp_count = 0usize;
    let mut mvp_weight = 0u32;
    let mut side_count = 0usize;
    let mut task_values: Vec<Value> = Vec::with_capacity(tasks.len());
    for task in tasks {
        if !valid_feature_id(&task.feature_id)
            || !unique.insert(task.feature_id.as_str())
            || !(1..=5).contains(&task.weight)
            || task.acceptance_criteria.trim().is_empty()
            || task.acceptance_criteria.chars().count() > 400
            || task.ci_checks.len() > 4
        {
            return Err(scope_error());
        }
        if task.lane == "mvp" {
            mvp_count += 1;
            mvp_weight += task.weight as u32;
        } else if task.lane == "side" {
            side_count += 1;
        } else {
            return Err(scope_error());
        }
        let mut seen = BTreeSet::new();
        let mut ci: Vec<(String, Value)> = Vec::new();
        for check in &task.ci_checks {
            if !valid_ci_text(&check.workflow)
                || !valid_ci_text(&check.job)
                || !seen.insert((&check.workflow, &check.job))
            {
                return Err(scope_error());
            }
            let value = json!([check.workflow, check.job]);
            let sorting_key = value.to_string();
            ci.push((sorting_key, value));
        }
        ci.sort_by(|a, b| ordinal(&a.0, &b.0));
        let ci: Vec<Value> = ci.into_iter().map(|(_, v)| v).collect();
        task_values.push(json!([
            task.feature_id,
            task.lane,
            task.weight,
            task.acceptance_criteria,
            ci
        ]));
    }
    if mvp_count == 0
        || p.mvp_task_count != mvp_count
        || p.side_task_count != side_count
        || p.total_weight != mvp_weight
    {
        return Err(scope_error());
    }
    let payload = json!([
        "katosync-acceptance-scope/v1",
        p.project_id,
        seq,
        task_values
    ]);
    Ok(format!(
        "{:x}",
        Sha256::digest(payload.to_string().as_bytes())
    ))
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PendingScopeAudit {
    pub project_id: String,
    pub plan_journal_sequence: i64,
    pub feature_count: usize,
    pub required_ci_job_count: usize,
    /// This is explicitly not independent approval of a blueprint.
    pub status: &'static str,
}
/// No generic successful workflow can substitute a feature's exact required
/// tests. Additional CI entries cannot inflate completed feature coverage.
pub(super) fn audit_pending_feature_scope(
    progress: &MvpProgress,
    receipt: &SignedAcceptanceReceipt,
) -> Result<PendingScopeAudit, String> {
    if progress.project_id != receipt.project_id
        || progress.plan_journal_sequence != Some(receipt.plan_journal_sequence)
        || receipt.accepted_feature_ids.is_empty()
    {
        return Err("ACCEPTANCE_WRONG_PLAN".into());
    }
    let actual_digest = digest_for_progress(progress)?;
    if !actual_digest.eq_ignore_ascii_case(&receipt.scope_digest) {
        return Err("ACCEPTANCE_SCOPE_DIGEST_MISMATCH".into());
    }
    let tasks: BTreeMap<&str, &MvpTaskProgress> = progress
        .tasks
        .iter()
        .map(|t| (t.feature_id.as_str(), t))
        .collect();
    let mut accepted = BTreeSet::new();
    let mut required_ci = BTreeSet::new();
    for id in &receipt.accepted_feature_ids {
        if !accepted.insert(id.as_str()) {
            return Err("ACCEPTANCE_DUPLICATE_FEATURE".into());
        }
        let task = tasks.get(id.as_str()).ok_or("ACCEPTANCE_UNKNOWN_FEATURE")?;
        if task.lane != "mvp" || task.ci_checks.is_empty() {
            return Err("ACCEPTANCE_FEATURE_NOT_ELIGIBLE".into());
        }
        for check in &task.ci_checks {
            required_ci.insert((&check.workflow[..], &check.job[..]));
        }
    }
    let mut actual_ci = BTreeSet::new();
    for check in &receipt.ci {
        if !actual_ci.insert((&check.workflow[..], &check.job[..])) {
            return Err("ACCEPTANCE_DUPLICATE_CI".into());
        }
    }
    if required_ci != actual_ci {
        return Err("ACCEPTANCE_FEATURE_CI_COVERAGE_MISMATCH".into());
    }
    Ok(PendingScopeAudit {
        project_id: receipt.project_id.clone(),
        plan_journal_sequence: receipt.plan_journal_sequence,
        feature_count: accepted.len(),
        required_ci_job_count: actual_ci.len(),
        status: "blueprint_scope_correlated_not_owner_accepted",
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory_fabric::acceptance_ledger::{CiReceipt, OwnerApproval};
    use crate::memory_fabric::mvp_progress::RequiredCiCheck;

    fn task(
        id: &str,
        lane: &str,
        weight: u8,
        criteria: &str,
        checks: &[(&str, &str)],
    ) -> MvpTaskProgress {
        MvpTaskProgress {
            feature_id: id.into(),
            title: id.into(),
            lane: lane.into(),
            weight,
            acceptance_criteria: criteria.into(),
            ci_checks: checks
                .iter()
                .map(|(workflow, job)| RequiredCiCheck {
                    workflow: (*workflow).into(),
                    job: (*job).into(),
                })
                .collect(),
            reported_status: "claimed_done",
            status_journal_sequence: None,
            verified: false,
            test_claim: "claimed_pass_current_head",
            test_name: None,
            test_journal_sequence: None,
        }
    }
    fn scope() -> MvpProgress {
        MvpProgress {
            project_id: "project-a".into(),
            plan_journal_sequence: Some(17),
            plan_status: "imported_unverified",
            mvp_task_count: 2,
            side_task_count: 1,
            total_weight: 3,
            reported_done_weight: 3,
            reported_percent: Some(100),
            tests_claimed_pass: 3,
            tests_claimed_fail: 0,
            tests_outdated: 0,
            verified_percent: None,
            tasks: vec![
                task("feat_z", "side", 5, "side only", &[]),
                task(
                    "feat-a",
                    "mvp",
                    2,
                    "Demo success",
                    &[("CI", "test macOS"), ("CI", "test Linux")],
                ),
                task("feat.z", "mvp", 1, "passed QA", &[("ci-gate", "lint")]),
            ],
        }
    }
    fn signed_scope(
        p: &MvpProgress,
        ids: &[&str],
        checks: &[(&str, &str)],
    ) -> SignedAcceptanceReceipt {
        SignedAcceptanceReceipt {
            schema_version: "katosync.feature-acceptance/v1".into(),
            project_id: p.project_id.clone(),
            plan_journal_sequence: p.plan_journal_sequence.unwrap(),
            scope_digest: digest_for_progress(p).unwrap(),
            head_sha: "a".repeat(40),
            accepted_at: "2026-11-04T12:00:00.000Z".into(),
            accepted_feature_ids: ids.iter().map(|id| (*id).into()).collect(),
            ci: checks
                .iter()
                .enumerate()
                .map(|(i, (workflow, job))| CiReceipt {
                    workflow: (*workflow).into(),
                    job: (*job).into(),
                    run_id: i as u64 + 10,
                    head_sha: "a".repeat(40),
                })
                .collect(),
            owner: OwnerApproval {
                decision_id: "not-actually-signed".into(),
                signer_key_id: "test".into(),
                signature: "not-actually-signed".into(),
            },
            previous_hash: None,
            hash: "0".repeat(64),
        }
    }
    #[test]
    fn typescript_ordinal_scope_digest_matches_exact_fixed_sha256_vector() {
        let p = scope();
        assert_eq!(
            digest_for_progress(&p).unwrap(),
            "ff4e2eded09670c7d20ea1d61f020dd2c36b914c5de2916980c5176eefcf4f7d"
        );
        let mut reverse = p;
        reverse.tasks.reverse();
        reverse.tasks[1].ci_checks.reverse();
        assert_eq!(
            digest_for_progress(&reverse).unwrap(),
            "ff4e2eded09670c7d20ea1d61f020dd2c36b914c5de2916980c5176eefcf4f7d"
        );
    }
    #[test]
    fn exact_feature_ci_jobs_required_not_generic_green_workflow() {
        let p = scope();
        let r = signed_scope(
            &p,
            &["feat-a"],
            &[("CI", "test Linux"), ("CI", "test macOS")],
        );
        let audit = audit_pending_feature_scope(&p, &r).unwrap();
        assert_eq!(
            audit.status,
            "blueprint_scope_correlated_not_owner_accepted"
        );
        assert_eq!(audit.feature_count, 1);
        assert_eq!(audit.required_ci_job_count, 2);
        let missing = signed_scope(&p, &["feat-a"], &[("CI", "test Linux")]);
        assert_eq!(
            audit_pending_feature_scope(&p, &missing).unwrap_err(),
            "ACCEPTANCE_FEATURE_CI_COVERAGE_MISMATCH"
        );
        let extra = signed_scope(
            &p,
            &["feat-a"],
            &[
                ("CI", "test Linux"),
                ("CI", "test macOS"),
                ("CI", "unrelated green"),
            ],
        );
        assert!(audit_pending_feature_scope(&p, &extra).is_err());
    }
    #[test]
    fn side_features_and_unlisted_feature_ids_cannot_be_accepted() {
        let p = scope();
        let side = signed_scope(&p, &["feat_z"], &[]);
        assert_eq!(
            audit_pending_feature_scope(&p, &side).unwrap_err(),
            "ACCEPTANCE_FEATURE_NOT_ELIGIBLE"
        );
        let missing = signed_scope(&p, &["new-feature"], &[]);
        assert_eq!(
            audit_pending_feature_scope(&p, &missing).unwrap_err(),
            "ACCEPTANCE_UNKNOWN_FEATURE"
        );
    }
    #[test]
    fn changed_weight_plan_or_ci_policy_invalidates_same_journal_sequence() {
        let p = scope();
        let r = signed_scope(&p, &["feat.z"], &[("ci-gate", "lint")]);
        let mut changed = p;
        changed.tasks[1].weight = 3;
        changed.total_weight = 4;
        assert_eq!(
            audit_pending_feature_scope(&changed, &r).unwrap_err(),
            "ACCEPTANCE_SCOPE_DIGEST_MISMATCH"
        );
        changed.tasks[1].weight = 2;
        changed.total_weight = 3;
        changed.tasks[2].ci_checks[0].job = "different test".into();
        assert!(audit_pending_feature_scope(&changed, &r).is_err());
        changed.plan_journal_sequence = Some(18);
        assert_eq!(
            audit_pending_feature_scope(&changed, &r).unwrap_err(),
            "ACCEPTANCE_WRONG_PLAN"
        );
    }
    #[test]
    fn malformed_scope_denominator_never_earns_verified_or_reported_completion() {
        let mut p = scope();
        p.total_weight = 500;
        assert!(digest_for_progress(&p).is_err());
        p.total_weight = 3;
        p.plan_status = "missing_explicit_mvp_scope";
        assert!(digest_for_progress(&p).is_err());
        p.plan_status = "imported_unverified";
        p.tasks[1].ci_checks.push(RequiredCiCheck {
            workflow: "CI".into(),
            job: "test Linux".into(),
        });
        assert!(digest_for_progress(&p).is_err());
    }
}
