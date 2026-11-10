//! Stage4L: lokale, projekt- und branchgebundene Agenten-Leseauftraege.
//! Keine Fernfreigabe: externe Provider bleiben bis zu verifizierten
//! Owner-Receipts, Writer-Leases und signierten Handoffs ausgeschlossen.
use super::LocalControlJob;
use serde::Deserialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AgentJobScope {
    pub project_id: String,
    pub source: String,
    pub provider_id: String,
    pub agent_id: String,
    pub expected_head: String,
}

fn valid_token(value: &str) -> bool {
    let mut chars = value.bytes();
    (1..=36).contains(&value.len())
        && chars.next().is_some_and(|x| x.is_ascii_lowercase())
        && chars.all(|x| x.is_ascii_lowercase() || x.is_ascii_digit() || x == b'-')
}

fn valid_job_id(value: &str) -> bool {
    let mut chars = value.bytes();
    (6..=48).contains(&value.len())
        && chars
            .next()
            .is_some_and(|x| x.is_ascii_lowercase() || x.is_ascii_digit())
        && chars.all(|x| x.is_ascii_lowercase() || x.is_ascii_digit() || x == b'-')
}

fn valid_sha(value: &str) -> bool {
    (value.len() == 40 || value.len() == 64)
        && value
            .bytes()
            .all(|x| x.is_ascii_digit() || (b'a'..=b'f').contains(&x))
}

pub(super) fn expected_branch(scope: &AgentJobScope, job_id: &str) -> Result<String, String> {
    if !valid_token(&scope.project_id)
        || !valid_token(&scope.provider_id)
        || !valid_token(&scope.agent_id)
        || !valid_job_id(job_id)
        || !matches!(
            scope.source.as_str(),
            "local" | "codex" | "claude" | "openai_api" | "anthropic_api" | "remote_orchestrator"
        )
        || !valid_sha(&scope.expected_head)
    {
        return Err("STAGE4L_INVALID_AGENT_IDENTITY".into());
    }
    Ok(format!(
        "agents/{}/{}/{}/{}/{}",
        scope.project_id, scope.source, scope.provider_id, scope.agent_id, job_id
    ))
}

/// Untrusted Inbox-JSON may never claim that it already has owner authority.
/// This new mode accepts exactly two bounded, local, no-network Git probes.
pub(super) fn validate_command(job: &LocalControlJob) -> Result<(), String> {
    if job.command != "git" || job.timeout_seconds > 20 {
        return Err("STAGE4L_COMMAND_NOT_ALLOWED".into());
    }
    let args = job.args.iter().map(String::as_str).collect::<Vec<_>>();
    if !matches!(
        args.as_slice(),
        ["status", "--short"] | ["rev-parse", "HEAD"]
    ) {
        return Err("STAGE4L_COMMAND_NOT_ALLOWED".into());
    }
    Ok(())
}

fn git_read(repo: &Path, args: &[&str]) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    let executable = "/usr/bin/git";
    #[cfg(not(target_os = "macos"))]
    let executable = "git";
    let output = Command::new(executable)
        .args(["--no-optional-locks", "-c", "core.fsmonitor=false", "-C"])
        .arg(repo)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .output()
        .map_err(|_| "STAGE4L_GIT_UNAVAILABLE".to_string())?;
    if !output.status.success() {
        return Err("STAGE4L_GIT_PROOF_FAILED".into());
    }
    String::from_utf8(output.stdout)
        .map(|x| x.trim().to_string())
        .map_err(|_| "STAGE4L_GIT_ENCODING_INVALID".to_string())
}

fn git_common_dir(repo: &Path) -> Result<PathBuf, String> {
    let path = git_read(repo, &["rev-parse", "--git-common-dir"])?;
    let path = PathBuf::from(path);
    let joined = if path.is_absolute() {
        path
    } else {
        repo.join(path)
    };
    fs::canonicalize(joined).map_err(|_| "STAGE4L_GIT_COMMON_DIR_UNAVAILABLE".into())
}

fn verify_branch(scope: &AgentJobScope, job_id: &str, cwd: &Path) -> Result<(), String> {
    let expected = expected_branch(scope, job_id)?;
    let canonical = fs::canonicalize(cwd).map_err(|_| "STAGE4L_CWD_UNAVAILABLE".to_string())?;
    let top = git_read(&canonical, &["rev-parse", "--show-toplevel"])?;
    if fs::canonicalize(top).ok().as_deref() != Some(canonical.as_path()) {
        return Err("STAGE4L_WORKTREE_ROOT_REQUIRED".into());
    }
    if git_read(&canonical, &["branch", "--show-current"])? != expected {
        return Err("STAGE4L_BRANCH_MISMATCH".into());
    }
    if git_read(&canonical, &["rev-parse", "HEAD"])? != scope.expected_head {
        return Err("STAGE4L_HEAD_CHANGED".into());
    }
    Ok(())
}

/// Runtime authority is NOT inferred from JSON booleans. Only a local read-only
/// proof is admitted; all remote/provider writes remain blocked.
pub(super) fn validate_agent_job(job: &LocalControlJob) -> Result<(), String> {
    if job.mode != "agent_read_only" {
        if job.agent_scope.is_some() {
            return Err("STAGE4L_SCOPE_MODE_MISMATCH".into());
        }
        return Ok(());
    }
    validate_command(job)?;
    let scope = job
        .agent_scope
        .as_ref()
        .ok_or_else(|| "STAGE4L_AGENT_SCOPE_REQUIRED".to_string())?;
    if scope.source != "local" {
        return Err("STAGE4L_REMOTE_PROVIDER_NOT_AUTHORIZED".into());
    }
    if job.project_id.as_deref() != Some(scope.project_id.as_str()) {
        return Err("STAGE4L_PROJECT_MISMATCH".into());
    }
    if !cfg!(target_os = "macos") {
        return Err("STAGE4L_PINNED_GIT_UNAVAILABLE".into());
    }
    // Require an exactly registered owner-local project. Worktrees may differ
    // from rootPath, but their canonical Git common directory must be identical.
    let registry = crate::project_registry::project_registry_load()
        .map_err(|_| "STAGE4L_REGISTRY_UNAVAILABLE".to_string())?
        .ok_or_else(|| "STAGE4L_REGISTRY_UNAVAILABLE".to_string())?;
    let entries = registry
        .get("projects")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "STAGE4L_REGISTRY_INVALID".to_string())?;
    let matches = entries
        .iter()
        .filter(|entry| entry.get("id").and_then(|v| v.as_str()) == Some(scope.project_id.as_str()))
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err("STAGE4L_REGISTERED_PROJECT_REQUIRED".into());
    }
    let registered_path = matches[0]
        .get("rootPath")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "STAGE4L_REGISTERED_ROOT_REQUIRED".to_string())?;
    let actual = fs::canonicalize(&job.cwd).map_err(|_| "STAGE4L_CWD_UNAVAILABLE".to_string())?;
    let registered = fs::canonicalize(registered_path)
        .map_err(|_| "STAGE4L_REGISTERED_ROOT_UNAVAILABLE".to_string())?;
    if git_common_dir(&actual)? != git_common_dir(&registered)? {
        return Err("STAGE4L_FOREIGN_REPOSITORY".into());
    }
    verify_branch(scope, &job.id, &actual)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scope() -> AgentJobScope {
        AgentJobScope {
            project_id: "katosync".into(),
            source: "local".into(),
            provider_id: "gemma4".into(),
            agent_id: "rex".into(),
            expected_head: "a".repeat(40),
        }
    }
    fn job() -> LocalControlJob {
        LocalControlJob {
            id: "job-20261110-0001".into(),
            cwd: "/tmp/qa".into(),
            command: "git".into(),
            args: vec!["status".into(), "--short".into()],
            mode: "agent_read_only".into(),
            timeout_seconds: 15,
            require_clean_git: false,
            lane_id: "local".into(),
            project_id: Some("katosync".into()),
            resource_locks: vec![],
            dedupe_key: None,
            agent_scope: Some(scope()),
        }
    }

    #[test]
    fn branch_matches_stage4k_contract() {
        assert_eq!(
            expected_branch(&scope(), "job-20261110-0001").unwrap(),
            "agents/katosync/local/gemma4/rex/job-20261110-0001"
        );
    }
    #[test]
    fn malformed_identity_and_sha_are_rejected() {
        let mut bad = scope();
        bad.provider_id = "../inject".into();
        assert!(expected_branch(&bad, "job-20261110-0001").is_err());
        bad = scope();
        bad.expected_head = "NOT_A_REAL_SHA".into();
        assert!(expected_branch(&bad, "job-20261110-0001").is_err());
        assert!(expected_branch(&scope(), "../escape").is_err());
    }
    #[test]
    fn arbitrary_commands_and_mutating_git_are_rejected() {
        let mut j = job();
        assert!(validate_command(&j).is_ok());
        j.args = vec!["checkout".into(), "main".into()];
        assert!(validate_command(&j).is_err());
        j.args = vec!["status".into(), "--output=/tmp/file".into()];
        assert!(validate_command(&j).is_err());
        j.command = "cat".into();
        assert!(validate_command(&j).is_err());
        j.command = "/tmp/git".into();
        assert!(validate_command(&j).is_err());
    }
    #[test]
    fn unverified_remote_provider_fails_before_git_execution() {
        let mut j = job();
        j.agent_scope.as_mut().unwrap().source = "codex".into();
        assert_eq!(
            validate_agent_job(&j).unwrap_err(),
            "STAGE4L_REMOTE_PROVIDER_NOT_AUTHORIZED"
        );
    }
    #[test]
    fn mismatched_owner_project_fails_before_registry_read() {
        let mut j = job();
        j.project_id = Some("foreign".into());
        assert_eq!(
            validate_agent_job(&j).unwrap_err(),
            "STAGE4L_PROJECT_MISMATCH"
        );
    }
    #[test]
    fn missing_scope_and_wrong_mode_fail_closed() {
        let mut j = job();
        j.agent_scope = None;
        assert_eq!(
            validate_agent_job(&j).unwrap_err(),
            "STAGE4L_AGENT_SCOPE_REQUIRED"
        );
        j = job();
        j.mode = "read_only".into();
        assert_eq!(
            validate_agent_job(&j).unwrap_err(),
            "STAGE4L_SCOPE_MODE_MISMATCH"
        );
    }
    #[test]
    fn branch_change_and_wrong_head_are_rejected_in_actual_git_fixture() {
        if !cfg!(target_os = "macos") {
            return;
        }
        let root = std::env::temp_dir().join(format!("katosync-stage4l-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let script = || -> Result<(), String> {
            let run = |args: &[&str]| -> Result<(), String> {
                let out = Command::new("/usr/bin/git")
                    .args(args)
                    .current_dir(&root)
                    .output()
                    .map_err(|e| e.to_string())?;
                if !out.status.success() {
                    return Err(String::from_utf8_lossy(&out.stderr).to_string());
                }
                Ok(())
            };
            run(&["init", "-q"])?;
            run(&["config", "user.name", "Stage4L QA"])?;
            run(&["config", "user.email", "qa@example.invalid"])?;
            fs::write(root.join("test.txt"), "qa").map_err(|e| e.to_string())?;
            run(&["add", "test.txt"])?;
            run(&["commit", "-qm", "stage4l fixture"])?;
            let mut s = scope();
            s.expected_head = git_read(&root, &["rev-parse", "HEAD"])?;
            assert!(verify_branch(&s, "job-20261110-0001", &root).is_err());
            run(&[
                "checkout",
                "-qb",
                &expected_branch(&s, "job-20261110-0001")?,
            ])?;
            assert!(verify_branch(&s, "job-20261110-0001", &root).is_ok());
            s.expected_head = "b".repeat(40);
            assert_eq!(
                verify_branch(&s, "job-20261110-0001", &root).unwrap_err(),
                "STAGE4L_HEAD_CHANGED"
            );
            Ok(())
        };
        let result = script();
        let _ = fs::remove_dir_all(&root);
        assert!(result.is_ok(), "Stage4L real-Git QA: {result:?}");
    }
}
