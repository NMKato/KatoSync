// Created by NMKato Solutions
//! Fail-closed per-feature coverage of GitHub-issued workflow/job facts.
//! A reported matching job is CI COVERAGE ONLY, never full feature acceptance.
use super::{
    github_ci::{GithubCiReport, GithubRun},
    mvp_progress::MvpTaskProgress,
};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CiGateCheck {
    pub workflow: String,
    pub job: String,
    pub provider_status: &'static str,
    pub run_id: Option<u64>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeatureCiCoverage {
    pub feature_id: String,
    pub lane: String,
    pub acceptance_criteria: String,
    pub checks: Vec<CiGateCheck>,
    /// False unless every *declared* provider CI job is successful on the exact HEAD.
    /// This is NOT an approval of feature implementation or a substitute for tests.
    pub ci_requirements_satisfied: bool,
    pub feature_accepted: bool,
    pub coverage_status: &'static str,
}
fn latest<'a>(report: &'a GithubCiReport, workflow: &str) -> Option<&'a GithubRun> {
    report
        .runs
        .iter()
        .filter(|r| r.workflow == workflow)
        .max_by_key(|r| (r.run_id, r.attempt))
}
pub(crate) fn feature_ci_coverage(
    report: &GithubCiReport,
    tasks: &[MvpTaskProgress],
) -> Vec<FeatureCiCoverage> {
    tasks
        .iter()
        .take(24)
        .map(|task| {
            let mut checks = Vec::new();
            for need in task.ci_checks.iter().take(4) {
                let (provider_status, run_id) = match latest(report, &need.workflow) {
                    None => ("missing_workflow", None),
                    Some(run) => {
                        let matches: Vec<_> = report
                            .jobs
                            .iter()
                            .filter(|job| job.run_id == run.run_id && job.name == need.job)
                            .collect();
                        let state = if run.status != "completed" {
                            "workflow_incomplete"
                        } else if run.conclusion.as_deref() != Some("success") {
                            "workflow_unsuccessful"
                        } else if matches.len() > 1 {
                            "ambiguous_job"
                        } else if let Some(job) = matches.first() {
                            if job.status != "completed" {
                                "job_incomplete"
                            } else if job.conclusion.as_deref() == Some("success") {
                                "provider_pass"
                            } else {
                                "job_unsuccessful"
                            }
                        } else {
                            "missing_job"
                        };
                        (state, Some(run.run_id))
                    }
                };
                checks.push(CiGateCheck {
                    workflow: need.workflow.clone(),
                    job: need.job.clone(),
                    provider_status,
                    run_id,
                });
            }
            let satisfied = !checks.is_empty()
                && checks
                    .iter()
                    .all(|check| check.provider_status == "provider_pass");
            let coverage_status = if task.ci_checks.is_empty() {
                "not_configured"
            } else if satisfied {
                "ci_jobs_passed_unapproved"
            } else {
                "ci_incomplete_or_failed"
            };
            FeatureCiCoverage {
                feature_id: task.feature_id.clone(),
                lane: task.lane.clone(),
                acceptance_criteria: task.acceptance_criteria.clone(),
                checks,
                ci_requirements_satisfied: satisfied,
                feature_accepted: false,
                coverage_status,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::github_ci::{GithubCiReport, GithubJob, GithubRun};
    use super::super::mvp_progress::RequiredCiCheck;
    use super::*;
    fn task() -> MvpTaskProgress {
        MvpTaskProgress {
            feature_id: "PHONE-A".into(),
            title: "Phone booking".into(),
            lane: "mvp".into(),
            weight: 5,
            acceptance_criteria: "Phone booking smoke + manual review".into(),
            ci_checks: vec![
                RequiredCiCheck {
                    workflow: "Fast Gate".into(),
                    job: "Windows Node Regression".into(),
                },
                RequiredCiCheck {
                    workflow: "Fast Gate".into(),
                    job: "Web Build".into(),
                },
            ],
            reported_status: "claimed_done",
            status_journal_sequence: None,
            verified: false,
            test_claim: "not_reported",
            test_name: None,
            test_journal_sequence: None,
        }
    }
    fn report() -> GithubCiReport {
        GithubCiReport {
            project_id: "alpha".into(),
            repository: "NMKato/KatoSync".into(),
            head_sha: "a".repeat(40),
            source: "github_authenticated_readonly",
            runs: vec![GithubRun {
                run_id: 10,
                workflow: "Fast Gate".into(),
                attempt: 1,
                status: "completed".into(),
                conclusion: Some("success".into()),
                source: "github_actions_api",
            }],
            jobs: vec![
                GithubJob {
                    run_id: 10,
                    name: "Web Build".into(),
                    status: "completed".into(),
                    conclusion: Some("success".into()),
                },
                GithubJob {
                    run_id: 10,
                    name: "Windows Node Regression".into(),
                    status: "completed".into(),
                    conclusion: Some("success".into()),
                },
            ],
            feature_acceptance_verified: false,
            ci_identity_verified: true,
            feature_ci_coverage: vec![],
        }
    }
    #[test]
    fn all_exact_jobs_pass_but_feature_remains_not_approved() {
        let out = feature_ci_coverage(&report(), &[task()]);
        assert_eq!(out[0].coverage_status, "ci_jobs_passed_unapproved");
        assert!(out[0].ci_requirements_satisfied);
        assert!(!out[0].feature_accepted);
        assert_eq!(out[0].checks.len(), 2);
    }
    #[test]
    fn newer_failed_or_pending_run_overrides_previous_green() {
        let mut r = report();
        r.runs.push(GithubRun {
            run_id: 12,
            workflow: "Fast Gate".into(),
            attempt: 1,
            status: "completed".into(),
            conclusion: Some("failure".into()),
            source: "github_actions_api",
        });
        let failed = feature_ci_coverage(&r, &[task()]);
        assert!(!failed[0].ci_requirements_satisfied);
        assert_eq!(failed[0].checks[0].provider_status, "workflow_unsuccessful");
        r.runs[1].status = "in_progress".into();
        r.runs[1].conclusion = None;
        assert_eq!(
            feature_ci_coverage(&r, &[task()])[0].checks[0].provider_status,
            "workflow_incomplete"
        );
    }
    #[test]
    fn missing_or_ambiguous_job_cannot_count_pass() {
        let mut r = report();
        r.jobs.pop();
        assert_eq!(
            feature_ci_coverage(&r, &[task()])[0].checks[0].provider_status,
            "missing_job"
        );
        r.jobs.push(GithubJob {
            run_id: 10,
            name: "Web Build".into(),
            status: "completed".into(),
            conclusion: Some("success".into()),
        });
        assert_eq!(
            feature_ci_coverage(&r, &[task()])[0].checks[1].provider_status,
            "ambiguous_job"
        );
    }
    #[test]
    fn undeclared_and_side_task_gates_cannot_create_feature_approval() {
        let mut empty = task();
        empty.ci_checks.clear();
        let none = feature_ci_coverage(&report(), &[empty]);
        assert_eq!(none[0].coverage_status, "not_configured");
        assert!(!none[0].ci_requirements_satisfied);
        let mut side = task();
        side.lane = "side".into();
        let out = feature_ci_coverage(&report(), &[side]);
        assert_eq!(out[0].lane, "side");
        assert!(!out[0].feature_accepted);
    }
}
