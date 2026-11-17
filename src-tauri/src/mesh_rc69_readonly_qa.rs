// Created by NMKato Solutions
//! RC69 Beta-0 native read-only Git status. Internal adapter only: NOT an MCP tool.
//! A future DO-WSS dispatch MUST verify owner, client grant, device consent,
//! project ACL and the signed request BEFORE invoking this function.
//! Never accepts a client-supplied filesystem path, shell string or Git arguments.
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeGitStatus {
    pub project_id: String,
    pub head_sha: String,
    pub branch: String,
    pub dirty: bool,
    pub provenance: &'static str,
}

fn text_git(data: Vec<u8>, maximum: usize) -> Result<String, &'static str> {
    if data.is_empty() || data.len() > maximum {
        return Err("RC69_RO_GIT_INVALID");
    }
    String::from_utf8(data)
        .map(|s| s.trim().to_owned())
        .map_err(|_| "RC69_RO_GIT_INVALID")
}

fn validate_head(raw: &str) -> bool {
    (raw.len() == 40 || raw.len() == 64) && raw.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn validate_branch(raw: &str) -> bool {
    !raw.is_empty()
        && raw.len() <= 128
        && raw
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._/-".contains(&byte))
}

/// Pure authorization-independent scope + output validator around the existing
/// project's bounded read-only Git runner. 'granted_project_id' is *not* a grant;
/// only an independently verified upstream dispatcher can bind this argument.
pub(crate) fn inspect_registered_git_status<F>(
    registry: &Value,
    requested_project_id: &str,
    granted_project_id: &str,
    mut git: F,
) -> Result<NativeGitStatus, &'static str>
where
    F: FnMut(&Path, &[&str]) -> Option<Vec<u8>>,
{
    if requested_project_id.is_empty()
        || requested_project_id.len() > 140
        || requested_project_id != granted_project_id
    {
        return Err("RC69_RO_PROJECT_NOT_GRANTED");
    }
    if registry.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("RC69_RO_REGISTRY_INVALID");
    }
    let projects = registry
        .get("projects")
        .and_then(Value::as_array)
        .ok_or("RC69_RO_REGISTRY_INVALID")?;
    let selected: Vec<_> = projects
        .iter()
        .filter(|record| record.get("id").and_then(Value::as_str) == Some(requested_project_id))
        .collect();
    if selected.len() != 1 {
        return Err("RC69_RO_PROJECT_NOT_GRANTED");
    }
    let entry = selected[0];
    if entry.pointer("/focus/status").and_then(Value::as_str) != Some("active") {
        return Err("RC69_RO_PROJECT_NOT_GRANTED");
    }
    let root = entry
        .get("rootPath")
        .and_then(Value::as_str)
        .ok_or("RC69_RO_REGISTRY_INVALID")?;
    if root.len() > 2048 || !Path::new(root).is_absolute() {
        return Err("RC69_RO_REGISTRY_INVALID");
    }
    let canonical = fs::canonicalize(root).map_err(|_| "RC69_RO_PROJECT_UNAVAILABLE")?;
    if !canonical.is_dir() {
        return Err("RC69_RO_PROJECT_UNAVAILABLE");
    }
    // Never follow a registered subdirectory or a changed Git checkout into
    // an unrelated source tree. Native runner already disables fsmonitor and
    // optional Git locks and imposes its own I/O/time limits.
    let git_root = text_git(
        git(&canonical, &["rev-parse", "--show-toplevel"]).ok_or("RC69_RO_GIT_UNAVAILABLE")?,
        4096,
    )?;
    let actual = fs::canonicalize(git_root).map_err(|_| "RC69_RO_GIT_UNAVAILABLE")?;
    if actual != canonical {
        return Err("RC69_RO_GIT_ROOT_MISMATCH");
    }
    let head = text_git(
        git(&canonical, &["rev-parse", "--verify", "HEAD"]).ok_or("RC69_RO_GIT_UNAVAILABLE")?,
        128,
    )?;
    if !validate_head(&head) {
        return Err("RC69_RO_GIT_INVALID");
    }
    let branch = match git(&canonical, &["symbolic-ref", "--short", "HEAD"]) {
        Some(bytes) => text_git(bytes, 256)?,
        None => "detached".to_owned(),
    };
    if !validate_branch(&branch) {
        return Err("RC69_RO_GIT_INVALID");
    }
    let porcelain =
        git(&canonical, &["status", "--porcelain=v1", "-uno"]).ok_or("RC69_RO_GIT_UNAVAILABLE")?;
    Ok(NativeGitStatus {
        project_id: requested_project_id.to_owned(),
        head_sha: head,
        branch,
        dirty: !porcelain.is_empty(),
        provenance: "local_git_verified_root",
    })
}

/// Internal helper for a FUTURE verified owner/device/ACL WSS adapter.
/// This function itself does NOT authenticate the caller or register a tool.
pub(crate) fn read_registered_git_status_after_verified_grant(
    requested_project_id: &str,
    granted_project_id: &str,
) -> Result<NativeGitStatus, &'static str> {
    let registry = crate::project_registry::project_registry_load()
        .map_err(|_| "RC69_RO_REGISTRY_UNAVAILABLE")?
        .ok_or("RC69_RO_REGISTRY_UNAVAILABLE")?;
    inspect_registered_git_status(
        &registry,
        requested_project_id,
        granted_project_id,
        crate::project_registry::run_git,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    fn fixture() -> (std::path::PathBuf, Value) {
        let dir = std::env::temp_dir().join(format!("katosync-rc69-read-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let root = dir.to_string_lossy().to_string();
        (
            dir,
            json!({"schemaVersion":1,"projects":[
                {"id":"alpha","rootPath":root,"focus":{"status":"active"}},
                {"id":"beta","rootPath":"/not/on/device","focus":{"status":"active"}}
            ]}),
        )
    }

    fn sample_runner<'a>(root: &'a Path) -> impl FnMut(&Path, &[&str]) -> Option<Vec<u8>> + 'a {
        move |_, args| match args {
            ["rev-parse", "--show-toplevel"] => Some(root.to_string_lossy().as_bytes().to_vec()),
            ["rev-parse", "--verify", "HEAD"] => Some(vec![b'a'; 40]),
            ["symbolic-ref", "--short", "HEAD"] => Some(b"main".to_vec()),
            ["status", "--porcelain=v1", "-uno"] => Some(b" M hidden-source-file".to_vec()),
            _ => None,
        }
    }

    #[test]
    fn registered_git_read_is_bounded_and_hides_paths_and_diff() {
        let (dir, registry) = fixture();
        let result =
            inspect_registered_git_status(&registry, "alpha", "alpha", sample_runner(&dir))
                .unwrap();
        assert_eq!(result.head_sha, "a".repeat(40));
        assert_eq!(result.branch, "main");
        assert!(result.dirty);
        let output = serde_json::to_string(&result).unwrap();
        assert!(!output.contains(dir.to_string_lossy().as_ref()));
        assert!(!output.contains("hidden-source-file"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_foreign_project_inactive_or_duplicate_registry_entry() {
        let (dir, mut registry) = fixture();
        assert_eq!(
            inspect_registered_git_status(&registry, "alpha", "beta", sample_runner(&dir)),
            Err("RC69_RO_PROJECT_NOT_GRANTED")
        );
        registry["projects"][0]["focus"]["status"] = json!("paused");
        assert_eq!(
            inspect_registered_git_status(&registry, "alpha", "alpha", sample_runner(&dir)),
            Err("RC69_RO_PROJECT_NOT_GRANTED")
        );
        registry["projects"][0]["focus"]["status"] = json!("active");
        let copy = registry["projects"][0].clone();
        registry["projects"].as_array_mut().unwrap().push(copy);
        assert_eq!(
            inspect_registered_git_status(&registry, "alpha", "alpha", sample_runner(&dir)),
            Err("RC69_RO_PROJECT_NOT_GRANTED")
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_changed_git_root_and_garbage_head() {
        let (dir, registry) = fixture();
        let other = std::env::temp_dir();
        assert_eq!(
            inspect_registered_git_status(&registry, "alpha", "alpha", sample_runner(&other)),
            Err("RC69_RO_GIT_ROOT_MISMATCH")
        );
        let mut runner = sample_runner(&dir);
        // Rejects absent Git output rather than inventing a live Git HEAD.
        let blocked = inspect_registered_git_status(&registry, "alpha", "alpha", |root, args| {
            if args == ["rev-parse", "--verify", "HEAD"] {
                return Some(b"not-a-sha".to_vec());
            }
            runner(root, args)
        });
        assert_eq!(blocked, Err("RC69_RO_GIT_INVALID"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
