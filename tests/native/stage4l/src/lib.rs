//! Native Stage4L source-level QA without bundling the Tauri desktop app.
//! The project-registry stub denies by default; no real owner grant is modeled.
#![allow(dead_code)]
pub(crate) mod project_registry {
    pub(crate) fn project_registry_load() -> Result<Option<serde_json::Value>, String> {
        let path = std::env::var("STAGE4L_QA_PROJECT_ROOT")
            .map_err(|_| "STAGE4L_QA_REGISTRY_DISABLED".to_string())?;
        Ok(Some(serde_json::json!({
            "projects": [{"id":"katosync", "rootPath":path}]
        })))
    }
}
#[derive(Clone)]
struct LocalControlJob {
    id: String,
    cwd: String,
    command: String,
    args: Vec<String>,
    mode: String,
    timeout_seconds: u64,
    require_clean_git: bool,
    lane_id: String,
    project_id: Option<String>,
    resource_locks: Vec<String>,
    dedupe_key: Option<String>,
    agent_scope: Option<agent_scope::AgentJobScope>,
}
#[path = "../../../../src-tauri/src/local_control/agent_scope.rs"]
mod agent_scope;

#[cfg(test)]
mod local_git_registry_fixture {
    use super::*;
    use std::{fs, path::Path, process::Command};

    fn git(root: &Path, args: &[&str]) -> String {
        let r = Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            r.status.success(),
            "git {:?}: {}",
            args,
            String::from_utf8_lossy(&r.stderr)
        );
        String::from_utf8(r.stdout).unwrap().trim().to_string()
    }

    #[test]
    fn project_registry_worktree_live_fixture() {
        let root = std::env::temp_dir().join(format!(
            "katosync-stage4l-registered-{}",
            uuid::Uuid::new_v4()
        ));
        let result = (|| -> Result<(), String> {
            let main = root.join("main");
            let checkout = root.join("agent");
            fs::create_dir_all(&main).map_err(|e| e.to_string())?;
            git(&main, &["init", "-q"]);
            git(&main, &["config", "user.name", "KatoSync Native QA"]);
            git(&main, &["config", "user.email", "qa@example.invalid"]);
            fs::write(main.join("test.txt"), b"BASE").map_err(|e| e.to_string())?;
            git(&main, &["add", "test.txt"]);
            git(&main, &["commit", "-qm", "base"]);
            let head = git(&main, &["rev-parse", "HEAD"]);
            let branch = "agents/katosync/local/gemma4/rex/job-20261110-0001";
            git(
                &main,
                &[
                    "worktree",
                    "add",
                    "-q",
                    "-b",
                    branch,
                    checkout.to_str().unwrap(),
                ],
            );
            std::env::set_var("STAGE4L_QA_PROJECT_ROOT", &main);
            let job = LocalControlJob {
                id: "job-20261110-0001".into(),
                cwd: checkout.to_string_lossy().into_owned(),
                command: "git".into(),
                args: vec!["status".into(), "--short".into()],
                mode: "agent_read_only".into(),
                timeout_seconds: 15,
                require_clean_git: false,
                lane_id: "local".into(),
                project_id: Some("katosync".into()),
                resource_locks: Vec::new(),
                dedupe_key: None,
                agent_scope: Some(agent_scope::AgentJobScope {
                    project_id: "katosync".into(),
                    source: "local".into(),
                    provider_id: "gemma4".into(),
                    agent_id: "rex".into(),
                    expected_head: head,
                }),
            };
            assert!(
                agent_scope::validate_agent_job(&job).is_ok(),
                "registry-owned worktree must be admitted"
            );
            let mut foreign = job.clone();
            foreign.project_id = Some("foreign".into());
            assert_eq!(
                agent_scope::validate_agent_job(&foreign).unwrap_err(),
                "STAGE4L_PROJECT_MISMATCH"
            );
            fs::write(checkout.join("changed.txt"), b"NEW").map_err(|e| e.to_string())?;
            git(&checkout, &["add", "changed.txt"]);
            git(&checkout, &["commit", "-qm", "moved HEAD"]);
            assert_eq!(
                agent_scope::validate_agent_job(&job).unwrap_err(),
                "STAGE4L_HEAD_CHANGED"
            );
            Ok(())
        })();
        std::env::remove_var("STAGE4L_QA_PROJECT_ROOT");
        let _ = fs::remove_dir_all(&root);
        assert!(result.is_ok(), "registered Git fixture: {result:?}");
    }
}
