// Created by NMKato Solutions
//! On-demand authenticated GitHub CI evidence, bound to a registered repository.
//! Workflow/job results are GitHub-issued facts, NOT per-feature acceptance.
use serde::Serialize;
use std::path::Path;
use tokio::{
    process::Command,
    time::{timeout, Duration},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubRun {
    pub run_id: u64,
    pub workflow: String,
    pub attempt: u64,
    pub status: String,
    pub conclusion: Option<String>,
    pub source: &'static str,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubJob {
    pub run_id: u64,
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubCiReport {
    pub project_id: String,
    pub repository: String,
    pub head_sha: String,
    pub source: &'static str,
    pub runs: Vec<GithubRun>,
    pub jobs: Vec<GithubJob>,
    pub feature_acceptance_verified: bool,
    pub ci_identity_verified: bool,
    pub feature_ci_coverage: Vec<super::mvp_ci_matrix::FeatureCiCoverage>,
}
fn valid_git_head(s: &str) -> bool {
    matches!(s.len(), 40 | 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}
fn valid_slug_part(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
}
/// Accept only two exact GitHub remote schemes. Never accept http, arbitrary
/// hosts, query fragments, credentials, file paths, or user-supplied API URLs.
pub(super) fn github_repo_from_remote(remote: &str) -> Option<String> {
    let raw = remote.trim();
    let suffix = raw
        .strip_prefix("https://github.com/")
        .or_else(|| raw.strip_prefix("git@github.com:"))?;
    let slug = suffix.strip_suffix(".git").unwrap_or(suffix);
    let (owner, repo) = slug.split_once('/')?;
    if !valid_slug_part(owner) || !valid_slug_part(repo) {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}
async fn run_cli(
    binary: &str,
    args: &[&str],
    duration: u64,
    max_bytes: usize,
) -> Result<String, String> {
    let mut child = Command::new(binary);
    child
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_HOST", "github.com")
        .env("GH_PAGER", "cat")
        .env("GIT_PAGER", "cat")
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    let output = timeout(Duration::from_secs(duration), child.output())
        .await
        .map_err(|_| "CI-Abfrage hat das Zeitlimit überschritten.".to_string())?
        .map_err(|_| "GitHub-CLI oder Git ist nicht verfügbar.".to_string())?;
    if !output.status.success() {
        return Err("Lokale GitHub-Anmeldung oder CI-Abfrage nicht verfügbar.".into());
    }
    if output.stdout.len() > max_bytes {
        return Err("CI-Antwort ist zu umfangreich.".into());
    }
    String::from_utf8(output.stdout).map_err(|_| "CI-Antwort ist kein gültiges UTF-8.".into())
}
fn parse_runs(raw: &str, repo: &str, head: &str) -> Result<Vec<GithubRun>, String> {
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|_| "GitHub-Antwort konnte nicht gelesen werden.".to_string())?;
    let list = value
        .get("workflow_runs")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "GitHub-Laufliste fehlt.".to_string())?;
    let mut runs = Vec::new();
    for item in list.iter().take(15) {
        let same_repo = item
            .pointer("/repository/full_name")
            .and_then(|v| v.as_str())
            == Some(repo);
        let same_head = item
            .get("head_sha")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s.eq_ignore_ascii_case(head));
        if !(same_repo && same_head) {
            continue;
        }
        let Some(run_id) = item.get("id").and_then(|v| v.as_u64()) else {
            continue;
        };
        let Some(workflow) = item.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(status) = item.get("status").and_then(|v| v.as_str()) else {
            continue;
        };
        if run_id == 0
            || workflow.chars().count() > 120
            || !matches!(
                status,
                "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending"
            )
        {
            continue;
        }
        let conclusion = item
            .get("conclusion")
            .and_then(|v| v.as_str())
            .filter(|s| {
                matches!(
                    *s,
                    "success"
                        | "failure"
                        | "cancelled"
                        | "skipped"
                        | "timed_out"
                        | "action_required"
                        | "neutral"
                )
            })
            .map(str::to_string);
        let attempt = item
            .get("run_attempt")
            .and_then(|v| v.as_u64())
            .unwrap_or(1);
        if attempt == 0 || attempt > 10000 {
            continue;
        }
        if !runs.iter().any(|r: &GithubRun| r.run_id == run_id) {
            runs.push(GithubRun {
                run_id,
                workflow: workflow.to_string(),
                attempt,
                status: status.to_string(),
                conclusion,
                source: "github_actions_api",
            });
        }
    }
    Ok(runs)
}
fn parse_jobs(raw: &str, run_id: u64) -> Result<Vec<GithubJob>, String> {
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|_| "GitHub-Jobantwort konnte nicht gelesen werden.".to_string())?;
    let list = value
        .get("jobs")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "GitHub-Jobliste fehlt.".to_string())?;
    let mut jobs = Vec::new();
    for job in list.iter().take(30) {
        let Some(name) = job.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(status) = job.get("status").and_then(|v| v.as_str()) else {
            continue;
        };
        if name.is_empty()
            || name.chars().count() > 120
            || !matches!(
                status,
                "queued" | "in_progress" | "completed" | "waiting" | "pending"
            )
        {
            continue;
        }
        let conclusion = job
            .get("conclusion")
            .and_then(|v| v.as_str())
            .filter(|s| {
                matches!(
                    *s,
                    "success"
                        | "failure"
                        | "cancelled"
                        | "skipped"
                        | "timed_out"
                        | "action_required"
                        | "neutral"
                )
            })
            .map(str::to_string);
        jobs.push(GithubJob {
            run_id,
            name: name.to_string(),
            status: status.to_string(),
            conclusion,
        });
    }
    Ok(jobs)
}
pub(crate) async fn github_ci_for_registered_root(
    project_id: &str,
    root: &Path,
    head: &str,
) -> Result<GithubCiReport, String> {
    if !valid_git_head(head) {
        return Err("Ungültige Projekt-Commit-SHA.".into());
    }
    let root = root
        .to_str()
        .ok_or_else(|| "Projektordner ist nicht lesbar.".to_string())?;
    let remote = run_cli("git", &["-C", root, "remote", "get-url", "origin"], 4, 512).await?;
    let repo = github_repo_from_remote(&remote)
        .ok_or_else(|| "Kein unterstütztes GitHub-Repository für dieses Projekt.".to_string())?;
    let path = format!("repos/{repo}/actions/runs?head_sha={head}&per_page=15");
    let response = run_cli("gh", &["api", "-X", "GET", &path], 14, 1024 * 1024).await?;
    let runs = parse_runs(&response, &repo, head)?;
    let mut jobs = Vec::new();
    // Top 3 workflow runs only. Separate bounded API reads, no provider writes.
    for run in runs.iter().take(3) {
        let endpoint = format!("repos/{repo}/actions/runs/{}/jobs?per_page=30", run.run_id);
        let json = run_cli("gh", &["api", "-X", "GET", &endpoint], 12, 1024 * 1024).await?;
        jobs.extend(parse_jobs(&json, run.run_id)?);
    }
    Ok(GithubCiReport {
        project_id: project_id.to_string(),
        repository: repo,
        head_sha: head.to_string(),
        source: "github_authenticated_readonly",
        runs,
        jobs,
        feature_acceptance_verified: false,
        ci_identity_verified: true,
        feature_ci_coverage: Vec::new(),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Live GitHub integration; requires authenticated gh, private repo permission and internet"]
    async fn manual_live_provider_attests_actual_current_commit() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap();
        let raw = run_cli(
            "git",
            &["-C", root.to_str().unwrap(), "rev-parse", "HEAD"],
            4,
            200,
        )
        .await
        .unwrap();
        let head = raw.trim();
        let proof = github_ci_for_registered_root("katosync-manual-smoke", root, head)
            .await
            .unwrap();
        assert_eq!(proof.repository, "NMKato/KatoSync");
        assert_eq!(proof.head_sha, head);
        assert!(proof.ci_identity_verified);
        assert!(!proof.feature_acceptance_verified);
        assert!(
            !proof.runs.is_empty(),
            "expected GitHub workflow for current pushed SHA"
        );
        assert!(!proof.jobs.is_empty(), "expected at least one GitHub job");
        assert!(proof
            .runs
            .iter()
            .all(|run| run.source == "github_actions_api"));
    }

    #[test]
    fn remote_scope_rejects_other_hosts_and_url_tricks() {
        assert_eq!(
            github_repo_from_remote("https://github.com/NMKato/KatoSync.git"),
            Some("NMKato/KatoSync".into())
        );
        assert_eq!(
            github_repo_from_remote("git@github.com:NMKato/KatoSync.git"),
            Some("NMKato/KatoSync".into())
        );
        for bad in [
            "https://evil.example/NMKato/KatoSync",
            "https://github.com.evil.example/owner/repo",
            "https://github.com/user:token@github.com/owner/repo",
            "http://github.com/owner/repo",
            "file:///private/thing",
            "https://github.com/owner/repo/other",
            "https://github.com/owner/repo?token=abc",
            "ssh://git@github.com/owner/repo",
        ] {
            assert!(github_repo_from_remote(bad).is_none(), "{bad}");
        }
    }
    #[test]
    fn provider_identity_must_match_repo_and_commit() {
        let expected = "a".repeat(40);
        let data = serde_json::json!({"workflow_runs":[
            {"id":1,"repository":{"full_name":"NMKato/KatoSync"},"head_sha":expected,
             "name":"KatoSync PR Fast Gate","status":"completed","conclusion":"success","run_attempt":2},
            {"id":2,"repository":{"full_name":"NMKato/Other"},"head_sha":expected,
             "name":"Forged other repo","status":"completed","conclusion":"success"},
            {"id":3,"repository":{"full_name":"NMKato/KatoSync"},"head_sha":"b".repeat(40),
             "name":"Stale result","status":"completed","conclusion":"success"},
            {"id":1,"repository":{"full_name":"NMKato/KatoSync"},"head_sha":"a".repeat(40),
             "name":"Duplicate run","status":"completed","conclusion":"failure"},
            {"id":4,"repository":{"full_name":"NMKato/KatoSync"},"head_sha":"a".repeat(40),
             "name":"Still running","status":"in_progress","conclusion":null}
        ]});
        let runs = parse_runs(&data.to_string(), "NMKato/KatoSync", &expected).unwrap();
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[0].run_id, 1);
        assert_eq!(runs[0].attempt, 2);
        assert_eq!(runs[0].conclusion.as_deref(), Some("success"));
        assert_eq!(runs[1].status, "in_progress");
        assert!(runs[1].conclusion.is_none());
    }
    #[test]
    fn jobs_are_bounded_and_not_automatically_feature_acceptance() {
        let jobs = parse_jobs(
            r#"{"jobs":[
          {"name":"Web Build","status":"completed","conclusion":"success"},
          {"name":"Windows Node Regression","status":"completed","conclusion":"failure"},
          {"name":"Future job","status":"in_progress","conclusion":null}
        ]}"#,
            99,
        )
        .unwrap();
        assert_eq!(jobs.len(), 3);
        assert_eq!(jobs[0].run_id, 99);
        assert_eq!(jobs[1].conclusion.as_deref(), Some("failure"));
        assert_eq!(jobs[2].status, "in_progress");
    }
}
