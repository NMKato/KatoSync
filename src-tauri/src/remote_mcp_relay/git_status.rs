// Created by NMKato Solutions
//! Exact, independently pinned Git-status dispatch. Local project selection is
//! temporary owner-session consent; registration alone never admits a request.
use crate::mesh_rc69_readonly_qa::NativeGitStatus;
use crate::mesh_rc72_signed_server_qa::PinnedServerContext;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::Signature;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, fs, path::PathBuf, process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command, time::Instant};
use uuid::Uuid;

pub(super) const TOOL: &str = "katosync_git_status";
pub(super) const MAX_PROJECTS: usize = 8;
const MAX_FRAME_BYTES: usize = 24_576;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const FRAME_TTL_MS: u64 = 15_000;
const EXECUTION_BUDGET_MS: u64 = 8_000;
const MAX_GIT_BYTES: usize = 65_536;
const DENIED: &str = "REMOTE_MCP_GIT_REQUEST_REJECTED";

#[derive(Clone)]
pub(super) struct ApprovedProject {
    pub id: String,
    root: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectOption {
    id: String,
    name: String,
}

pub(super) fn valid_project_id(id: &str) -> bool {
    (1..=140).contains(&id.len())
        && !matches!(id, "." | "..")
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}

fn records(registry: &Value) -> Result<&Vec<Value>, &'static str> {
    if registry["schemaVersion"].as_u64() != Some(1) {
        return Err("REMOTE_MCP_GIT_REGISTRY_INVALID");
    }
    registry["projects"]
        .as_array()
        .ok_or("REMOTE_MCP_GIT_REGISTRY_INVALID")
}

pub(super) fn project_options(registry: &Value) -> Result<Vec<ProjectOption>, &'static str> {
    let records = records(registry)?;
    let mut seen = HashSet::new();
    let mut options = Vec::new();
    for record in records {
        let Some(id) = record["id"].as_str() else {
            continue;
        };
        if !valid_project_id(id) || !seen.insert(id) {
            return Err("REMOTE_MCP_GIT_REGISTRY_INVALID");
        }
        if record.pointer("/focus/status").and_then(Value::as_str) == Some("active") {
            let name = record["name"].as_str().unwrap_or(id);
            options.push(ProjectOption {
                id: id.into(),
                name: name.chars().filter(|c| !c.is_control()).take(100).collect(),
            });
        }
    }
    options.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(options)
}

pub(super) fn approve_projects(
    registry: &Value,
    selected: &[String],
) -> Result<Vec<ApprovedProject>, &'static str> {
    if selected.len() > MAX_PROJECTS
        || selected.iter().any(|id| !valid_project_id(id))
        || selected.iter().collect::<HashSet<_>>().len() != selected.len()
    {
        return Err("REMOTE_MCP_GIT_PROJECT_NOT_SELECTED");
    }
    let records = records(registry)?;
    let mut approved = Vec::new();
    for id in selected {
        let matches: Vec<_> = records
            .iter()
            .filter(|row| row["id"].as_str() == Some(id.as_str()))
            .collect();
        if matches.len() != 1
            || matches[0].pointer("/focus/status").and_then(Value::as_str) != Some("active")
        {
            return Err("REMOTE_MCP_GIT_PROJECT_NOT_SELECTED");
        }
        let root = matches[0]["rootPath"]
            .as_str()
            .ok_or("REMOTE_MCP_GIT_REGISTRY_INVALID")?;
        if root.len() > 2048 || !std::path::Path::new(root).is_absolute() {
            return Err("REMOTE_MCP_GIT_REGISTRY_INVALID");
        }
        let root = fs::canonicalize(root).map_err(|_| "REMOTE_MCP_GIT_PROJECT_UNAVAILABLE")?;
        if !root.is_dir() {
            return Err("REMOTE_MCP_GIT_PROJECT_UNAVAILABLE");
        }
        approved.push(ApprovedProject {
            id: id.clone(),
            root,
        });
    }
    Ok(approved)
}

pub(super) fn verify_registered_root(
    registry: &Value,
    project: &ApprovedProject,
) -> Result<(), &'static str> {
    let selected = approve_projects(registry, std::slice::from_ref(&project.id))?;
    if selected[0].root != project.root {
        return Err("REMOTE_MCP_GIT_PROJECT_CHANGED");
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    alg: String,
    kid: String,
    typ: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Body {
    tool_name: String,
    project_id: String,
    oauth_client_id: String,
    authority_revision: String,
}

pub(super) struct DispatchAuthority<'a> {
    pub client_id: Uuid,
    pub revision: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Frame {
    version: u8,
    direction: String,
    kind: String,
    owner_id: String,
    tenant_id: String,
    grant_id: String,
    device_id: String,
    session_id: String,
    request_id: String,
    sequence: u64,
    issued_at_ms: u64,
    expires_at_ms: u64,
    body: Body,
}

#[derive(Debug)]
pub(super) struct VerifiedRequest {
    pub request_id: Uuid,
    pub sequence: u64,
    pub execution_deadline_ms: u64,
    pub project_id: String,
}

fn scope_id(actual: &str, expected: Uuid) -> bool {
    actual == expected.to_string()
}

/// Verifies original protected bytes before reading any proposed operation.
/// The caller consumes the returned request ID before starting a Git process.
pub(super) fn verify_request(
    raw: &str,
    pin: &PinnedServerContext<'_>,
    authority: &DispatchAuthority<'_>,
    last_sequence: u64,
    now: u64,
    session_expires: u64,
    approved: &[ApprovedProject],
    seen: &HashSet<Uuid>,
) -> Result<VerifiedRequest, &'static str> {
    if raw.is_empty()
        || raw.len() > MAX_FRAME_BYTES
        || now == 0
        || now > MAX_SAFE_INTEGER
        || seen.len() >= 32
        || approved.is_empty()
        || approved.len() > MAX_PROJECTS
        || authority.client_id.is_nil()
        || authority.revision.len() != 64
        || !authority
            .revision
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(DENIED);
    }
    let parts: Vec<_> = raw.split('.').collect();
    if parts.len() != 3
        || parts[0].is_empty()
        || parts[0].len() > 1024
        || parts[1].is_empty()
        || parts[2].len() != 86
    {
        return Err(DENIED);
    }
    let header: Header =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[0]).map_err(|_| DENIED)?)
            .map_err(|_| DENIED)?;
    if header.alg != "EdDSA"
        || header.kid != pin.kid
        || header.typ != "katosync-rc67-duplex-relay+jws"
    {
        return Err(DENIED);
    }
    let signature = Signature::from_slice(&URL_SAFE_NO_PAD.decode(parts[2]).map_err(|_| DENIED)?)
        .map_err(|_| DENIED)?;
    pin.verifying_key
        .verify_strict(format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature)
        .map_err(|_| DENIED)?;
    let frame: Frame =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).map_err(|_| DENIED)?)
            .map_err(|_| DENIED)?;
    let request_id = Uuid::parse_str(&frame.request_id).map_err(|_| DENIED)?;
    if frame.version != 1
        || frame.direction != "cloud_to_device"
        || frame.kind != "tool.request"
        || frame.sequence <= last_sequence
        || frame.sequence > MAX_SAFE_INTEGER
        || frame.issued_at_ms == 0
        || frame.issued_at_ms > MAX_SAFE_INTEGER - FRAME_TTL_MS
        || frame.expires_at_ms != frame.issued_at_ms + FRAME_TTL_MS
        || frame.expires_at_ms > session_expires
        || frame.issued_at_ms > now.saturating_add(5_000)
        || !scope_id(&frame.owner_id, pin.owner_id)
        || !scope_id(&frame.tenant_id, pin.tenant_id)
        || !scope_id(&frame.grant_id, pin.grant_id)
        || !scope_id(&frame.device_id, pin.device_id)
        || !scope_id(&frame.session_id, pin.session_id)
        || frame.request_id != request_id.to_string()
        || !(1..=8).contains(&request_id.get_version_num())
        || !matches!(request_id.get_variant(), uuid::Variant::RFC4122)
        || seen.contains(&request_id)
        || frame.body.tool_name != TOOL
        || !valid_project_id(&frame.body.project_id)
        || !scope_id(&frame.body.oauth_client_id, authority.client_id)
        || frame.body.authority_revision != authority.revision
        || approved
            .iter()
            .filter(|item| item.id == frame.body.project_id)
            .count()
            != 1
    {
        return Err(DENIED);
    }
    // The server starts this same budget when signing, after its queued fresh
    // authority check. Transport delay never creates a new eight-second lease.
    let execution_deadline_ms = frame.issued_at_ms + EXECUTION_BUDGET_MS;
    if now >= execution_deadline_ms {
        return Err("REMOTE_MCP_GIT_DEADLINE");
    }
    Ok(VerifiedRequest {
        request_id,
        sequence: frame.sequence,
        execution_deadline_ms,
        project_id: frame.body.project_id,
    })
}

fn git_executable() -> Result<PathBuf, &'static str> {
    #[cfg(unix)]
    let candidates = vec![
        PathBuf::from("/usr/bin/git"),
        PathBuf::from("/opt/homebrew/bin/git"),
        PathBuf::from("/usr/local/bin/git"),
    ];
    #[cfg(windows)]
    let candidates: Vec<_> = ["ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|root| PathBuf::from(root).join("Git").join("cmd").join("git.exe"))
        .collect();
    candidates
        .into_iter()
        .find(|file| file.is_file())
        .ok_or("REMOTE_MCP_GIT_EXECUTABLE_UNAVAILABLE")
}

async fn run_git(
    project: &ApprovedProject,
    args: &[&str],
    deadline: Instant,
) -> Result<(i32, Vec<u8>), &'static str> {
    if Instant::now() >= deadline {
        return Err("REMOTE_MCP_GIT_DEADLINE");
    }
    // Fixed executable and argv; no shell, caller path, config override or hook.
    let mut command = Command::new(git_executable()?);
    // Remove inherited Git controls before adding the fixed environment. This
    // also blocks executable-path overrides and trace-file writes.
    for (key, _) in std::env::vars_os() {
        if key
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("GIT_")
        {
            command.env_remove(key);
        }
    }
    command
        .args(["--no-optional-locks", "-c", "core.fsmonitor=false", "-C"])
        .arg(&project.root)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env(
            "GIT_CONFIG_GLOBAL",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        )
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|_| "REMOTE_MCP_GIT_UNAVAILABLE")?;
    let stdout = child.stdout.take().ok_or("REMOTE_MCP_GIT_UNAVAILABLE")?;
    let read = async {
        let mut bytes = Vec::new();
        stdout
            .take((MAX_GIT_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .await?;
        Ok::<_, std::io::Error>(bytes)
    };
    let outcome =
        tokio::time::timeout_at(deadline, async { tokio::try_join!(child.wait(), read) }).await;
    match outcome {
        Ok(Ok((status, bytes))) if bytes.len() <= MAX_GIT_BYTES => {
            Ok((status.code().unwrap_or(-1), bytes))
        }
        Ok(Ok(_)) => Err("REMOTE_MCP_GIT_OUTPUT_LIMIT"),
        Ok(Err(_)) => {
            let _ = child.kill().await;
            Err("REMOTE_MCP_GIT_UNAVAILABLE")
        }
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err("REMOTE_MCP_GIT_DEADLINE")
        }
    }
}

fn text(bytes: Vec<u8>, max: usize) -> Result<String, &'static str> {
    if bytes.is_empty() || bytes.len() > max {
        return Err("REMOTE_MCP_GIT_OUTPUT_INVALID");
    }
    String::from_utf8(bytes)
        .map(|value| value.trim().to_owned())
        .map_err(|_| "REMOTE_MCP_GIT_OUTPUT_INVALID")
}

async fn git_text(
    project: &ApprovedProject,
    args: &[&str],
    deadline: Instant,
    max: usize,
) -> Result<String, &'static str> {
    let (code, bytes) = run_git(project, args, deadline).await?;
    if code != 0 {
        return Err("REMOTE_MCP_GIT_UNAVAILABLE");
    }
    text(bytes, max)
}

/// Executes only the bounded read-only operation. The same deadline covers all
/// processes; dropping this future on stop/logout kills the current child.
pub(super) async fn read_status(
    project: &ApprovedProject,
    remaining_ms: u64,
) -> Result<NativeGitStatus, &'static str> {
    if remaining_ms < 500 {
        return Err("REMOTE_MCP_GIT_DEADLINE");
    }
    let deadline = Instant::now() + Duration::from_millis(remaining_ms.min(8_000));
    let root = git_text(project, &["rev-parse", "--show-toplevel"], deadline, 4096).await?;
    if fs::canonicalize(root).map_err(|_| "REMOTE_MCP_GIT_PROJECT_UNAVAILABLE")? != project.root {
        return Err("REMOTE_MCP_GIT_PROJECT_CHANGED");
    }
    let head = git_text(project, &["rev-parse", "--verify", "HEAD"], deadline, 128).await?;
    if !matches!(head.len(), 40 | 64) || !head.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("REMOTE_MCP_GIT_OUTPUT_INVALID");
    }
    let (code, bytes) = run_git(project, &["symbolic-ref", "--short", "HEAD"], deadline).await?;
    let branch = match code {
        0 => text(bytes, 256)?,
        1 => "detached".into(),
        _ => return Err("REMOTE_MCP_GIT_UNAVAILABLE"),
    };
    if branch.is_empty()
        || branch.len() > 128
        || !branch
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._/-".contains(&byte))
    {
        return Err("REMOTE_MCP_GIT_OUTPUT_INVALID");
    }
    // Do not recurse into separately rooted submodule worktrees or launch
    // child Git processes. Untracked files are outside this metadata scope.
    let (code, porcelain) = run_git(
        project,
        &[
            "status",
            "--porcelain=v1",
            "-uno",
            "--ignore-submodules=all",
        ],
        deadline,
    )
    .await?;
    if code != 0 {
        return Err("REMOTE_MCP_GIT_UNAVAILABLE");
    }
    if Instant::now() >= deadline {
        return Err("REMOTE_MCP_GIT_DEADLINE");
    }
    Ok(NativeGitStatus {
        project_id: project.id.clone(),
        head_sha: head,
        branch,
        dirty: !porcelain.is_empty(),
        provenance: "local_git_verified_root",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use serde_json::json;

    fn pin(key: &SigningKey) -> PinnedServerContext<'_> {
        PinnedServerContext {
            kid: "test-server-key",
            verifying_key: key.verifying_key(),
            owner_id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            grant_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
        }
    }
    fn payload(pin: &PinnedServerContext<'_>) -> Value {
        json!({"version":1,"direction":"cloud_to_device","kind":"tool.request","ownerId":pin.owner_id,"tenantId":pin.tenant_id,"grantId":pin.grant_id,"deviceId":pin.device_id,"sessionId":pin.session_id,"requestId":Uuid::new_v4(),"sequence":3,"issuedAtMs":1_800_000_000_000_u64,"expiresAtMs":1_800_000_015_000_u64,"body":{"toolName":TOOL,"projectId":"katosync","oauthClientId":pin.owner_id,"authorityRevision":"a".repeat(64)}})
    }
    fn signed(value: &Value, key: &SigningKey) -> String {
        let head = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json!({"alg":"EdDSA","kid":"test-server-key","typ":"katosync-rc67-duplex-relay+jws"})).unwrap());
        let body = URL_SAFE_NO_PAD.encode(serde_json::to_vec(value).unwrap());
        let input = format!("{head}.{body}");
        format!(
            "{input}.{}",
            URL_SAFE_NO_PAD.encode(key.sign(input.as_bytes()).to_bytes())
        )
    }
    fn approved() -> Vec<ApprovedProject> {
        vec![ApprovedProject {
            id: "katosync".into(),
            root: std::env::temp_dir(),
        }]
    }

    #[test]
    fn verifies_exact_scope_and_rejects_each_changed_binding() {
        let key = SigningKey::from_bytes(&[81; 32]);
        let pin = pin(&key);
        let value = payload(&pin);
        let approved = approved();
        let seen = HashSet::new();
        assert!(verify_request(
            &signed(&value, &key),
            &pin,
            &DispatchAuthority {
                client_id: pin.owner_id,
                revision: &"a".repeat(64)
            },
            2,
            1_800_000_001_000,
            1_800_000_030_000,
            &approved,
            &seen
        )
        .is_ok());
        for field in ["ownerId", "tenantId", "grantId", "deviceId", "sessionId"] {
            let mut changed = value.clone();
            changed[field] = json!(Uuid::new_v4());
            assert!(
                verify_request(
                    &signed(&changed, &key),
                    &pin,
                    &DispatchAuthority {
                        client_id: pin.owner_id,
                        revision: &"a".repeat(64)
                    },
                    2,
                    1_800_000_001_000,
                    1_800_000_030_000,
                    &approved,
                    &seen
                )
                .is_err(),
                "{field}"
            );
        }
        assert!(verify_request(
            &signed(&value, &SigningKey::from_bytes(&[82; 32])),
            &pin,
            &DispatchAuthority {
                client_id: pin.owner_id,
                revision: &"a".repeat(64)
            },
            2,
            1_800_000_001_000,
            1_800_000_030_000,
            &approved,
            &seen
        )
        .is_err());
    }

    #[test]
    fn request_deadline_binds_signed_issue_time_not_packet_receipt() {
        let key = SigningKey::from_bytes(&[84; 32]);
        let pin = pin(&key);
        let value = payload(&pin);
        let raw = signed(&value, &key);
        let revision = "a".repeat(64);
        let authority = DispatchAuthority {
            client_id: pin.owner_id,
            revision: &revision,
        };
        let approved = approved();
        let delayed = verify_request(
            &raw,
            &pin,
            &authority,
            2,
            1_800_000_007_000,
            1_800_000_030_000,
            &approved,
            &HashSet::new(),
        )
        .unwrap();
        assert_eq!(delayed.execution_deadline_ms, 1_800_000_008_000);
        // The signed frame still has seven seconds of cryptographic TTL,
        // but its separately bounded execution budget is already exhausted.
        assert_eq!(
            verify_request(
                &raw,
                &pin,
                &authority,
                2,
                1_800_000_008_000,
                1_800_000_030_000,
                &approved,
                &HashSet::new()
            )
            .unwrap_err(),
            "REMOTE_MCP_GIT_DEADLINE"
        );
        let mut foreign = value;
        foreign["ownerId"] = json!(Uuid::new_v4());
        assert_eq!(
            verify_request(
                &signed(&foreign, &key),
                &pin,
                &authority,
                2,
                1_800_000_008_000,
                1_800_000_030_000,
                &approved,
                &HashSet::new()
            )
            .unwrap_err(),
            DENIED
        );
        assert!(verify_request(
            &"a".repeat(MAX_FRAME_BYTES + 1),
            &pin,
            &authority,
            2,
            1_800_000_001_000,
            1_800_000_030_000,
            &approved,
            &HashSet::new()
        )
        .is_err());
    }

    #[test]
    fn rejects_replay_expiry_wrong_tool_project_and_extra_arguments() {
        let key = SigningKey::from_bytes(&[83; 32]);
        let pin = pin(&key);
        let value = payload(&pin);
        let approved = approved();
        let raw = signed(&value, &key);
        let mut seen = HashSet::new();
        seen.insert(Uuid::parse_str(value["requestId"].as_str().unwrap()).unwrap());
        assert!(verify_request(
            &raw,
            &pin,
            &DispatchAuthority {
                client_id: pin.owner_id,
                revision: &"a".repeat(64)
            },
            2,
            1_800_000_001_000,
            1_800_000_030_000,
            &approved,
            &seen
        )
        .is_err());
        for (last, now, expires) in [
            (3, 1_800_000_001_000, 1_800_000_030_000),
            (2, 1_800_000_015_000, 1_800_000_030_000),
            (2, 1_799_999_994_000, 1_800_000_030_000),
            (2, 1_800_000_001_000, 1_800_000_014_000),
        ] {
            assert!(verify_request(
                &raw,
                &pin,
                &DispatchAuthority {
                    client_id: pin.owner_id,
                    revision: &"a".repeat(64)
                },
                last,
                now,
                expires,
                &approved,
                &HashSet::new()
            )
            .is_err());
        }
        for (pointer, replacement) in [
            ("/body/toolName", json!("terminal.exec")),
            ("/body/projectId", json!("other")),
            ("/expiresAtMs", json!(1_800_000_015_001_u64)),
        ] {
            let mut changed = value.clone();
            *changed.pointer_mut(pointer).unwrap() = replacement;
            assert!(verify_request(
                &signed(&changed, &key),
                &pin,
                &DispatchAuthority {
                    client_id: pin.owner_id,
                    revision: &"a".repeat(64)
                },
                2,
                1_800_000_001_000,
                1_800_000_030_000,
                &approved,
                &HashSet::new()
            )
            .is_err());
        }
        let mut changed = value.clone();
        changed["body"]["args"] = json!(["--output=/tmp/unwanted"]);
        assert!(verify_request(
            &signed(&changed, &key),
            &pin,
            &DispatchAuthority {
                client_id: pin.owner_id,
                revision: &"a".repeat(64)
            },
            2,
            1_800_000_001_000,
            1_800_000_030_000,
            &approved,
            &HashSet::new()
        )
        .is_err());
        assert!(verify_request(
            &raw,
            &pin,
            &DispatchAuthority {
                client_id: pin.owner_id,
                revision: &"a".repeat(64)
            },
            2,
            1_800_000_001_000,
            1_800_000_030_000,
            &[],
            &HashSet::new()
        )
        .is_err());
    }

    #[test]
    fn registry_registration_never_implies_selection_and_changed_root_is_denied() {
        let dir = std::env::temp_dir().join(format!("mcp-git-scope-{}", Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let mut registry = json!({"schemaVersion":1,"projects":[{"id":"katosync","name":"KatoSync","rootPath":dir,"focus":{"status":"active"}}]});
        assert!(approve_projects(&registry, &[]).unwrap().is_empty());
        let selected = approve_projects(&registry, &["katosync".into()]).unwrap();
        assert!(verify_registered_root(&registry, &selected[0]).is_ok());
        registry["projects"][0]["rootPath"] = json!(std::env::temp_dir());
        assert!(verify_registered_root(&registry, &selected[0]).is_err());
        registry["projects"][0]["focus"]["status"] = json!("paused");
        assert!(approve_projects(&registry, &["katosync".into()]).is_err());
        fs::remove_dir(dir).unwrap();
    }

    #[tokio::test]
    async fn real_git_status_is_read_only_bounded_and_contains_no_paths_or_filenames() {
        let dir = std::env::temp_dir().join(format!("mcp-git-read-{}", Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        for args in [
            vec!["init", "-b", "main"],
            vec![
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "fixture",
            ],
        ] {
            assert!(std::process::Command::new(git_executable().unwrap())
                .arg("-C")
                .arg(&dir)
                .args(args)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .unwrap()
                .success());
        }
        let project = ApprovedProject {
            id: "katosync".into(),
            root: fs::canonicalize(&dir).unwrap(),
        };
        let filename = "private-fixture-file.txt";
        fs::write(dir.join(filename), "private fixture content").unwrap();
        let result = read_status(&project, 5_000).await.unwrap();
        assert_eq!(result.branch, "main");
        // Untracked files are deliberately excluded from this metadata scope.
        assert!(!result.dirty);
        assert_eq!(result.head_sha.len(), 40);
        assert!(!serde_json::to_string(&result)
            .unwrap()
            .contains(dir.to_string_lossy().as_ref()));
        assert!(std::process::Command::new(git_executable().unwrap())
            .arg("-C")
            .arg(&dir)
            .args(["add", "--", filename])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success());
        let original_index = fs::read(dir.join(".git/index")).unwrap();
        let dirty = read_status(&project, 5_000).await.unwrap();
        assert!(dirty.dirty);
        assert_eq!(fs::read(dir.join(".git/index")).unwrap(), original_index);
        let public = serde_json::to_string(&dirty).unwrap();
        assert!(!public.contains(filename));
        assert!(!public.contains("private fixture content"));
        assert!(!public.contains(dir.to_string_lossy().as_ref()));
        assert!(read_status(&project, 0).await.is_err());
        assert!(run_git(
            &project,
            &["status", "--porcelain=v1", "-uno"],
            Instant::now()
        )
        .await
        .is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
