// Created by NMKato Solutions
// Security gate #76, slice 1: READ-ONLY verification of a registered Git project.
// This is NOT a writer lease, approval grant, sandbox or permission to run an agent.
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    path::Path,
    process::{Command, Stdio},
};

const MAX_REGISTRY_SIZE: u64 = 4 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SecureProjectPreflight {
    pub project_id: String,
    pub canonical_root: String,
    pub verified_head: String,
    pub status: &'static str,
    pub writer_authorized: bool,
}

/// Git commands here MUST remain read-only and never be forwarded from a caller.
/// No shell, no credential prompts, no hooks/fsmonitor or optional Git locks.
fn git_read(repo: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
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
        .stdin(Stdio::null())
        .output()
        .map_err(|_| "Sicherheitsprüfung: Git ist nicht verfügbar.".to_string())?;
    if !output.status.success() {
        return Err(
            "Sicherheitsprüfung: Git konnte den Projektzustand nicht eindeutig ermitteln."
                .to_string(),
        );
    }
    Ok(output.stdout)
}

fn git_line(repo: &Path, args: &[&str]) -> Result<String, String> {
    let bytes = git_read(repo, args)?;
    let value = std::str::from_utf8(&bytes)
        .map_err(|_| "Sicherheitsprüfung: Ungültige Git-Ausgabe.".to_string())?;
    if value.trim().is_empty() || value.lines().count() != 1 {
        return Err("Sicherheitsprüfung: Uneindeutige Git-Ausgabe.".to_string());
    }
    Ok(value.trim().to_string())
}

fn valid_sha(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|c| c.is_ascii_hexdigit())
}

/// This verifies facts immediately before *planning* work. Any future executor
/// MUST repeat these checks after obtaining an independently validated, remotely
/// fenced writer lease and an operation-specific human approval. The result does
/// not carry a reusable authorization token.
pub(crate) fn inspect_registered(
    registry: &Value,
    project_id: &str,
    expected_head: &str,
) -> Result<SecureProjectPreflight, String> {
    if registry.get("schemaVersion") != Some(&Value::from(1)) {
        return Err("Sicherheitsprüfung: Unbekannte Project-Registry-Version.".to_string());
    }
    if !valid_sha(expected_head) {
        return Err(
            "Sicherheitsprüfung: Vollständige erwartete Git-HEAD-SHA erforderlich.".to_string(),
        );
    }
    let (root, recorded_head) = crate::project_work_resume::registered_root(registry, project_id)
        .map_err(str::to_string)?;
    let recorded_head = recorded_head.ok_or_else(|| {
        "Sicherheitsprüfung: Projekt muss vor Arbeitsbeginn neu gescannt werden.".to_string()
    })?;
    if !valid_sha(&recorded_head) || !recorded_head.eq_ignore_ascii_case(expected_head) {
        return Err(
            "Sicherheitsprüfung: Registrierter Git-Stand weicht vom Auftrag ab.".to_string(),
        );
    }
    let canonical = fs::canonicalize(Path::new(&root))
        .map_err(|_| "Sicherheitsprüfung: Projektordner nicht zugänglich.".to_string())?;
    if !canonical.is_dir() {
        return Err("Sicherheitsprüfung: Projektwurzel ist kein Ordner.".to_string());
    }
    // Registry root is the full Git top-level, not any subfolder.
    // real_path removes Windows verbatim prefixes for the Git CLI.
    let git_path = crate::project_registry::real_path(&canonical);
    let top = git_line(Path::new(&git_path), &["rev-parse", "--show-toplevel"])?;
    let git_root = fs::canonicalize(Path::new(&top))
        .map_err(|_| "Sicherheitsprüfung: Git-Wurzel ungültig.".to_string())?;
    if git_root != canonical {
        return Err(
            "Sicherheitsprüfung: Registry-Pfad ist nicht die Git-Projektwurzel.".to_string(),
        );
    }
    let actual_head = git_line(Path::new(&git_path), &["rev-parse", "--verify", "HEAD"])?;
    if !valid_sha(&actual_head) || !actual_head.eq_ignore_ascii_case(expected_head) {
        return Err(
            "Sicherheitsprüfung: Git-HEAD hat sich verändert. Vorgang abbrechen.".to_string(),
        );
    }
    let dirty = git_read(
        Path::new(&git_path),
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    if !dirty.is_empty() {
        return Err("Sicherheitsprüfung: Projekt enthält ungespeicherte Änderungen.".to_string());
    }
    Ok(SecureProjectPreflight {
        project_id: project_id.to_owned(),
        canonical_root: crate::project_registry::real_path(&canonical),
        verified_head: actual_head,
        status: "verified_read_only",
        writer_authorized: false,
    })
}

/// Read-only frontend/native gate: never starts Claude/Codex or creates a worktree.
#[tauri::command]
pub(crate) async fn secure_project_preflight(
    project_id: String,
    expected_head: String,
) -> Result<SecureProjectPreflight, String> {
    let app_dir = crate::app_support_dir().map_err(crate::error_to_string)?;
    let registry_path = app_dir.join("project-registry.json");
    let metadata = fs::metadata(&registry_path)
        .map_err(|_| "Sicherheitsprüfung: Project Registry fehlt.".to_string())?;
    if metadata.len() > MAX_REGISTRY_SIZE {
        return Err("Sicherheitsprüfung: Project Registry ist zu groß.".to_string());
    }
    let bytes = fs::read(&registry_path)
        .map_err(|_| "Sicherheitsprüfung: Project Registry nicht lesbar.".to_string())?;
    let registry: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "Sicherheitsprüfung: Project Registry ist beschädigt.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        inspect_registered(&registry, &project_id, &expected_head)
    })
    .await
    .map_err(|_| "Sicherheitsprüfung: Prüfung wurde unterbrochen.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{path::PathBuf, process::Command};

    struct RepoFixture {
        path: PathBuf,
        head: String,
    }
    impl RepoFixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "katosync-secure-preflight-{}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(&path).unwrap();
            Self::git(&path, &["init", "-q"]);
            fs::write(path.join("README.md"), "initial\n").unwrap();
            Self::git(&path, &["add", "README.md"]);
            Self::git(&path, &["commit", "-q", "-m", "initial"]);
            let head = git_line(&path, &["rev-parse", "HEAD"]).unwrap();
            Self { path, head }
        }
        fn git(path: &Path, args: &[&str]) {
            let status = Command::new("git")
                .arg("-C")
                .arg(path)
                .args([
                    "-c",
                    "user.name=KatoSync Test",
                    "-c",
                    "user.email=test@example.invalid",
                    "-c",
                    "commit.gpgsign=false",
                ])
                .args(args)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .unwrap();
            assert!(status.success(), "test Git invocation failed");
        }
        fn registry(&self) -> Value {
            json!({"schemaVersion":1,"projects":[{"id":"project-a","rootPath":self.path.to_string_lossy(),"scan":{"headSha":self.head}}]})
        }
        fn check(&self) -> Result<SecureProjectPreflight, String> {
            inspect_registered(&self.registry(), "project-a", &self.head)
        }
    }
    impl Drop for RepoFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn verified_clean_project_is_read_only_and_not_a_writer_lease() {
        let fixture = RepoFixture::new();
        let check = fixture.check().unwrap();
        assert_eq!(check.project_id, "project-a");
        assert_eq!(check.verified_head, fixture.head);
        assert_eq!(check.status, "verified_read_only");
        assert!(!check.writer_authorized);
    }
    #[test]
    fn unknown_duplicate_and_unversioned_projects_fail_closed() {
        let f = RepoFixture::new();
        assert!(inspect_registered(&f.registry(), "../project-a", &f.head).is_err());
        let mut dup = f.registry();
        let original = dup["projects"][0].clone();
        dup["projects"].as_array_mut().unwrap().push(original);
        assert!(inspect_registered(&dup, "project-a", &f.head).is_err());
        let mut unversioned = f.registry();
        unversioned["schemaVersion"] = json!(99);
        assert!(inspect_registered(&unversioned, "project-a", &f.head).is_err());
        assert!(inspect_registered(&f.registry(), "project-a", "short").is_err());
    }
    #[test]
    fn registry_head_mismatch_rejected_before_touching_git() {
        let f = RepoFixture::new();
        let bad = "a".repeat(40);
        assert!(inspect_registered(&f.registry(), "project-a", &bad).is_err());
        let mut reg = f.registry();
        reg["projects"][0]["scan"]["headSha"] = json!("z".repeat(40));
        assert!(inspect_registered(&reg, "project-a", &f.head).is_err());
    }
    #[test]
    fn dirty_untracked_and_moved_head_all_fail_closed() {
        let f = RepoFixture::new();
        fs::write(f.path.join("README.md"), "changed\n").unwrap();
        assert!(f.check().unwrap_err().contains("ungespeicherte"));
        RepoFixture::git(&f.path, &["restore", "README.md"]);
        fs::write(f.path.join("untracked.txt"), "new").unwrap();
        assert!(f.check().is_err());
        fs::remove_file(f.path.join("untracked.txt")).unwrap();
        fs::write(f.path.join("README.md"), "second\n").unwrap();
        RepoFixture::git(&f.path, &["add", "README.md"]);
        RepoFixture::git(&f.path, &["commit", "-q", "-m", "second"]);
        assert!(f.check().unwrap_err().contains("Git-HEAD"));
    }
    #[test]
    fn registry_subfolder_must_not_masquerade_as_repo_root() {
        let f = RepoFixture::new();
        fs::create_dir_all(f.path.join("nested")).unwrap();
        let mut reg = f.registry();
        reg["projects"][0]["rootPath"] = json!(f.path.join("nested").to_string_lossy().to_string());
        assert!(inspect_registered(&reg, "project-a", &f.head)
            .unwrap_err()
            .contains("Git-Projektwurzel"));
    }
    #[test]
    fn missing_git_repository_fails_without_initializing_it() {
        let f = RepoFixture::new();
        let nongit =
            std::env::temp_dir().join(format!("katosync-secure-no-git-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&nongit).unwrap();
        let mut reg = f.registry();
        reg["projects"][0]["rootPath"] = json!(nongit.to_string_lossy().to_string());
        assert!(inspect_registered(&reg, "project-a", &f.head).is_err());
        assert!(!nongit.join(".git").exists());
        let _ = fs::remove_dir_all(nongit);
    }
}
