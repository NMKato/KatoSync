// Created by NMKato Solutions
// Issue #76, slice 3: owned detached Git worktrees, NEVER the user's active checkout.
// NO Tauri command, provider invocation or production authority implementation exists.
// In production this can only be enabled after independent backend verification of
// the task approval, account/device identity and fenced distributed writer lease.
#![cfg_attr(not(test), allow(dead_code))]

use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

/// A non-forgeable-at-the-UI boundary placeholder. There is intentionally NO
/// production constructor or deserializer. A future trusted backend verifier
/// must construct this after checking the live approval and fencing generation.
#[derive(Clone, Debug)]
struct VerifiedWorkPermit {
    project_id: String,
    expected_head: String,
    task_id: String,
    fence: u64,
}

#[derive(Debug)]
struct OwnedTaskWorktree {
    repo_root: PathBuf,
    path: PathBuf,
    head: String,
    task_id: String,
    fence: u64,
}

fn git(repo: &Path, args: &[&std::ffi::OsStr]) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .arg("-c")
        .arg("core.hooksPath=/dev/null")
        .arg("-c")
        .arg("core.fsmonitor=false")
        .arg("-c")
        .arg("submodule.recurse=false")
        .arg("-C")
        .arg(repo)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .stdin(Stdio::null())
        .output()
        .map_err(|_| "Git fuer isolierten Worktree nicht verfuegbar.".to_string())?;
    if !output.status.success() {
        return Err(
            "Git Worktree-Operation abgebrochen; manuelle Pruefung erforderlich.".to_string(),
        );
    }
    Ok(output.stdout)
}

fn git_str(repo: &Path, args: &[&str]) -> Result<String, String> {
    let a = args.iter().map(std::ffi::OsStr::new).collect::<Vec<_>>();
    let bytes = git(repo, &a)?;
    std::str::from_utf8(&bytes)
        .map(|s| s.trim().to_string())
        .map_err(|_| "Git-Antwort enthaelt ungueltige Zeichen.".to_string())
}

fn valid_task_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

/// Validate the previously registered project again *at* task-worktree creation.
/// This is not an approval oracle: only a trusted, verified permit can call this.
/// Workspace parent is supplied by the trusted app support service, never a model.
fn prepare_owned(
    registry: &Value,
    permit: &VerifiedWorkPermit,
    managed_root: &Path,
) -> Result<OwnedTaskWorktree, String> {
    if permit.fence == 0 || !valid_task_id(&permit.task_id) {
        return Err("Keine gueltige Aufgabenkennung oder Fencing-Generation.".to_string());
    }
    let facts = crate::secure_project_work::inspect_registered(
        registry,
        &permit.project_id,
        &permit.expected_head,
    )?;
    if facts.writer_authorized {
        return Err("Readonly-Git-Pruefung lieferte unerwartete Autorisierung.".to_string());
    }
    let source = fs::canonicalize(&facts.canonical_root)
        .map_err(|_| "Projektordner hat sich geaendert.".to_string())?;

    // This parent must already be app-owned. Refuse to make directories based
    // on untrusted paths and never place worktrees inside the user's checkout.
    let root = fs::canonicalize(managed_root)
        .map_err(|_| "Verwalteter Task-Speicher nicht vorhanden.".to_string())?;
    if !root.is_dir() || root.starts_with(&source) || source.starts_with(&root) {
        return Err(
            "Task-Speicher darf nicht im Projekt oder dessen Elternordner liegen.".to_string(),
        );
    }
    let unique = format!("task-{}-{}", permit.task_id, uuid::Uuid::new_v4());
    let path = root.join(unique);
    if fs::symlink_metadata(&path).is_ok() {
        return Err("Task-Worktree-Pfad ist bereits belegt.".to_string());
    }

    // Check actual per-path attributes, rather than blocking harmless global
    // Git LFS configuration. Activated smudge/process filters may execute code.
    let tracked = git(
        &source,
        &[std::ffi::OsStr::new("ls-files"), std::ffi::OsStr::new("-z")],
    )?;
    if tracked.len() > 4 * 1024 * 1024 {
        return Err("Git-Dateiliste zu gross fuer sichere Filterpruefung.".to_string());
    }
    use std::io::Write as _;
    let mut child = Command::new("git")
        .arg("-C")
        .arg(&source)
        .args(["check-attr", "--cached", "-z", "--stdin", "filter"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Git-Attributpruefung nicht startbar.".to_string())?;
    child
        .stdin
        .take()
        .ok_or("Git-Attributeingabe fehlt.")?
        .write_all(&tracked)
        .map_err(|_| "Git-Attributeingabe fehlgeschlagen.".to_string())?;
    let attrs = child
        .wait_with_output()
        .map_err(|_| "Git-Attributpruefung unterbrochen.".to_string())?;
    if !attrs.status.success() || attrs.stdout.len() > 24 * 1024 * 1024 {
        return Err("Git-Attribute konnten nicht sicher geprueft werden.".to_string());
    }
    let fields = attrs
        .stdout
        .split(|byte| *byte == 0)
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>();
    if fields.len() % 3 != 0
        || fields
            .chunks_exact(3)
            .any(|f| f[1] != b"filter" || f[2] != b"unspecified")
    {
        return Err("Aktiver Git-Checkout-Filter gefunden; Worktree verweigert.".to_string());
    }

    // Pinned detached HEAD: no checkout of default branch in original directory,
    // no remote fetch, no implicit Git push, no commit and no provider execution.
    let argv = [
        std::ffi::OsStr::new("worktree"),
        std::ffi::OsStr::new("add"),
        std::ffi::OsStr::new("--detach"),
        std::ffi::OsStr::new("--"),
        path.as_os_str(),
        std::ffi::OsStr::new(&facts.verified_head),
    ];
    git(&source, &argv)?;
    let canonical_target =
        fs::canonicalize(&path).map_err(|_| "Neuer Worktree nicht vorhanden.".to_string())?;
    if canonical_target != path {
        return Err(
            "Task-Worktree wurde unerwartet umgeleitet; manuelle Pruefung noetig.".to_string(),
        );
    }
    let actual_head = git_str(&path, &["rev-parse", "HEAD"])?;
    let detached = git_str(&path, &["symbolic-ref", "-q", "HEAD"]);
    if actual_head != facts.verified_head || detached.is_ok() {
        return Err("Worktree-Pin stimmt nicht; manuelle Pruefung noetig.".to_string());
    }
    if git_str(&source, &["rev-parse", "HEAD"])? != facts.verified_head
        || !git_str(
            &source,
            &["status", "--porcelain=v1", "--untracked-files=all"],
        )?
        .is_empty()
    {
        return Err("Quellprojekt wurde waehrend der Worktree-Anlage veraendert.".to_string());
    }
    Ok(OwnedTaskWorktree {
        repo_root: source,
        path,
        head: facts.verified_head,
        task_id: permit.task_id.clone(),
        fence: permit.fence,
    })
}

impl OwnedTaskWorktree {
    /// Never use --force or rm -rf. A dirty/in-use task workspace is preserved
    /// for review and explicit recovery, not destroyed by timeout/drop/retry.
    fn remove_if_clean(self) -> Result<(), String> {
        let current = fs::canonicalize(&self.path)
            .map_err(|_| "Task-Worktree fehlt: manuelle Wiederherstellung.".to_string())?;
        if current != self.path || self.fence == 0 || !valid_task_id(&self.task_id) {
            return Err("Worktree-Zuordnung ungueltig.".to_string());
        }
        if git_str(&self.path, &["rev-parse", "HEAD"])? != self.head {
            return Err("Worktree-HEAD wurde geaendert; nicht automatisch entfernen.".to_string());
        }
        if !git_str(
            &self.path,
            &["status", "--porcelain=v1", "--untracked-files=all"],
        )?
        .is_empty()
        {
            return Err("Worktree enthaelt Aenderungen; bitte manuell pruefen.".to_string());
        }
        let argv = [
            std::ffi::OsStr::new("worktree"),
            std::ffi::OsStr::new("remove"),
            std::ffi::OsStr::new("--"),
            self.path.as_os_str(),
        ];
        git(&self.repo_root, &argv)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Fixture {
        home: PathBuf,
        repo: PathBuf,
        managed: PathBuf,
        head: String,
    }
    impl Fixture {
        fn new() -> Self {
            let home =
                std::env::temp_dir().join(format!("katosync-worktree-{}", uuid::Uuid::new_v4()));
            let repo = home.join("project");
            let managed = home.join("managed");
            fs::create_dir_all(&repo).unwrap();
            fs::create_dir_all(&managed).unwrap();
            cmd(&repo, &["init", "-q"]);
            fs::write(repo.join("README.md"), "original\n").unwrap();
            cmd(&repo, &["add", "README.md"]);
            cmd(&repo, &["commit", "-q", "-m", "initial"]);
            let head = git_str(&repo, &["rev-parse", "HEAD"]).unwrap();
            Self {
                home,
                repo,
                managed,
                head,
            }
        }
        fn registry(&self) -> Value {
            json!({"schemaVersion":1,"projects":[{"id":"project-a","rootPath":self.repo.to_string_lossy(),"scan":{"headSha":self.head}}]})
        }
        fn permit(&self) -> VerifiedWorkPermit {
            VerifiedWorkPermit {
                project_id: "project-a".to_string(),
                expected_head: self.head.clone(),
                task_id: "synthetic-task".to_string(),
                fence: 1,
            }
        }
        fn prepare(&self) -> Result<OwnedTaskWorktree, String> {
            prepare_owned(&self.registry(), &self.permit(), &self.managed)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            // Synthetic fixture only. This deletion never happens in production.
            let _ = fs::remove_dir_all(&self.home);
        }
    }
    fn cmd(repo: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args([
                "-c",
                "user.name=KatoSync Test",
                "-c",
                "user.email=test@example.invalid",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert!(status.success(), "fixture git command failed");
    }

    #[test]
    fn detached_workspace_does_not_switch_or_edit_original_checkout() {
        let f = Fixture::new();
        let initial_branch = git_str(&f.repo, &["branch", "--show-current"]).unwrap();
        let task = f.prepare().unwrap();
        assert_eq!(task.head, f.head);
        assert_eq!(
            git_str(&task.path, &["branch", "--show-current"]).unwrap(),
            ""
        );
        fs::write(task.path.join("README.md"), "isolated task edit\n").unwrap();
        assert_eq!(
            fs::read_to_string(f.repo.join("README.md")).unwrap(),
            "original\n"
        );
        assert_eq!(
            git_str(&f.repo, &["branch", "--show-current"]).unwrap(),
            initial_branch
        );
        assert_eq!(git_str(&f.repo, &["rev-parse", "HEAD"]).unwrap(), f.head);
        assert!(
            task.remove_if_clean().is_err(),
            "dirty worktree must be kept for review"
        );
    }

    #[test]
    fn clean_owned_task_can_be_removed_without_touching_source() {
        let f = Fixture::new();
        let task = f.prepare().unwrap();
        let path = task.path.clone();
        assert!(path.exists());
        task.remove_if_clean().unwrap();
        assert!(!path.exists());
        assert!(f.repo.join("README.md").is_file());
        assert_eq!(git_str(&f.repo, &["rev-parse", "HEAD"]).unwrap(), f.head);
        assert!(!git_str(&f.repo, &["worktree", "list", "--porcelain"])
            .unwrap()
            .contains("task-synthetic-task-"));
    }

    #[test]
    fn missing_or_forged_task_ticket_fails_before_git_mutation() {
        let f = Fixture::new();
        let mut permit = f.permit();
        permit.fence = 0;
        assert!(prepare_owned(&f.registry(), &permit, &f.managed).is_err());
        permit.fence = 1;
        permit.task_id = "../escape".to_string();
        assert!(prepare_owned(&f.registry(), &permit, &f.managed).is_err());
        permit.task_id = "normal".to_string();
        permit.expected_head = "a".repeat(40);
        assert!(prepare_owned(&f.registry(), &permit, &f.managed).is_err());
        assert_eq!(fs::read_dir(&f.managed).unwrap().count(), 0);
    }

    #[test]
    fn dirty_source_and_branch_movement_block_workspace_creation() {
        let f = Fixture::new();
        fs::write(f.repo.join("newfile.txt"), "untracked").unwrap();
        assert!(f.prepare().is_err());
        fs::remove_file(f.repo.join("newfile.txt")).unwrap();
        fs::write(f.repo.join("README.md"), "modified\n").unwrap();
        assert!(f.prepare().is_err());
        cmd(&f.repo, &["restore", "README.md"]);
        fs::write(f.repo.join("README.md"), "committed change\n").unwrap();
        cmd(&f.repo, &["add", "README.md"]);
        cmd(&f.repo, &["commit", "-q", "-m", "second"]);
        assert!(f.prepare().is_err());
        assert_eq!(fs::read_dir(&f.managed).unwrap().count(), 0);
    }

    #[test]
    fn task_root_must_be_outside_existing_checkout_and_resolved() {
        let f = Fixture::new();
        let nested = f.repo.join("task-output");
        fs::create_dir_all(&nested).unwrap();
        assert!(prepare_owned(&f.registry(), &f.permit(), &nested).is_err());
        let nowhere = f.home.join("nonexistent");
        assert!(prepare_owned(&f.registry(), &f.permit(), &nowhere).is_err());
    }

    #[test]
    fn two_tasks_get_distinct_detached_worktrees_and_no_checkout_collision() {
        let f = Fixture::new();
        let task_a = f.prepare().unwrap();
        let task_b = f.prepare().unwrap();
        assert_ne!(task_a.path, task_b.path);
        assert_eq!(
            git_str(&task_a.path, &["rev-parse", "HEAD"]).unwrap(),
            f.head
        );
        assert_eq!(
            git_str(&task_b.path, &["rev-parse", "HEAD"]).unwrap(),
            f.head
        );
        task_a.remove_if_clean().unwrap();
        task_b.remove_if_clean().unwrap();
    }

    #[test]
    fn configured_git_checkout_filter_is_denied_before_worktree_creation() {
        let f = Fixture::new();
        fs::write(
            f.repo.join(".git").join("info").join("attributes"),
            "*.md filter=untrusted\n",
        )
        .unwrap();
        let err = f.prepare().unwrap_err();
        assert!(err.contains("Git-Checkout-Filter"), "{err}");
        assert_eq!(fs::read_dir(&f.managed).unwrap().count(), 0);
    }

    #[test]
    fn removed_workspace_cannot_be_removed_twice_or_clean_up_foreign_data() {
        let f = Fixture::new();
        let task = f.prepare().unwrap();
        let task_path = task.path.clone();
        task.remove_if_clean().unwrap();
        let foreign = f.managed.join("notes-user");
        fs::create_dir(&foreign).unwrap();
        fs::write(foreign.join("keep.txt"), "keep").unwrap();
        assert!(!task_path.exists());
        assert!(foreign.join("keep.txt").exists());
    }
}
