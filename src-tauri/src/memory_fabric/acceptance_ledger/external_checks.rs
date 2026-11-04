// NMKato Solutions — KatoSync 4.0 Trust Gate 3: read-only external evidence.
// No Tauri command, no DB mutation, no accepted percentage or ETA.
use super::{receipt_hash, validate_owner_signed, CiReceipt, SignedAcceptanceReceipt};
use crate::memory_fabric::github_ci::github_repo_from_remote;
use crate::memory_fabric::{validate_project_id, MemoryStore};
use ed25519_dalek::VerifyingKey;
use rusqlite::params;
use serde::Serialize;
use serde_json::Value;
use std::{path::Path, process::Stdio};
use tokio::{
    process::Command,
    time::{timeout, Duration},
};

const MAX_CI_CHECKS: usize = 12;
const MAX_API_BYTES: usize = 1024 * 1024;
const MAX_GIT_BYTES: usize = 512;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PendingExternalCheck {
    pub project_id: String,
    pub receipt_hash: String,
    pub ci_jobs_checked: usize,
    pub status: &'static str,
}
fn get<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
    v.get(key)
        .and_then(Value::as_str)
        .ok_or("ACCEPTANCE_CI_MISSING_FIELD".into())
}
fn positive(v: &Value, key: &str) -> Result<u64, String> {
    v.get(key)
        .and_then(Value::as_u64)
        .filter(|id| *id > 0)
        .ok_or("ACCEPTANCE_CI_MISSING_ID".into())
}
fn validate_workflow_job(
    run: &Value,
    jobs: &Value,
    repo: &str,
    expected: &CiReceipt,
) -> Result<(), String> {
    if run.pointer("/repository/full_name").and_then(Value::as_str) != Some(repo)
        || run
            .pointer("/head_repository/full_name")
            .and_then(Value::as_str)
            != Some(repo)
        || !get(run, "head_sha")?.eq_ignore_ascii_case(&expected.head_sha)
        || positive(run, "id")? != expected.run_id
        || get(run, "name")? != expected.workflow
        || get(run, "status")? != "completed"
        || get(run, "conclusion")? != "success"
    {
        return Err("ACCEPTANCE_CI_RUN_UNVERIFIED".into());
    }
    let attempt = positive(run, "run_attempt")?;
    if attempt > 10000 {
        return Err("ACCEPTANCE_CI_RUN_UNVERIFIED".into());
    }
    let list = jobs
        .get("jobs")
        .and_then(Value::as_array)
        .ok_or("ACCEPTANCE_CI_JOBS_INCOMPLETE")?;
    let total = jobs
        .get("total_count")
        .and_then(Value::as_u64)
        .ok_or("ACCEPTANCE_CI_JOBS_INCOMPLETE")?;
    if list.len() > 100 || total != list.len() as u64 {
        return Err("ACCEPTANCE_CI_JOBS_INCOMPLETE".into());
    }
    let mut matched = 0;
    for job in list {
        if job.get("name").and_then(Value::as_str) != Some(expected.job.as_str()) {
            continue;
        }
        matched += 1;
        if positive(job, "run_id")? != expected.run_id
            || positive(job, "run_attempt")? != attempt
            || get(job, "status")? != "completed"
            || get(job, "conclusion")? != "success"
            || job
                .get("head_sha")
                .and_then(Value::as_str)
                .is_some_and(|h| !h.eq_ignore_ascii_case(&expected.head_sha))
        {
            return Err("ACCEPTANCE_CI_JOB_UNVERIFIED".into());
        }
    }
    if matched != 1 {
        return Err("ACCEPTANCE_CI_JOB_AMBIGUOUS".into());
    }
    Ok(())
}
async fn run_cli(bin: &str, args: &[&str], secs: u64, max_bytes: usize) -> Result<String, String> {
    let output = timeout(
        Duration::from_secs(secs),
        Command::new(bin)
            .args(args)
            .env("GH_PROMPT_DISABLED", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GH_HOST", "github.com")
            .env("GH_PAGER", "cat")
            .env("GIT_PAGER", "cat")
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "ACCEPTANCE_COMMAND_TIMEOUT")?
    .map_err(|_| "ACCEPTANCE_COMMAND_UNAVAILABLE")?;
    if !output.status.success() || output.stdout.len() > max_bytes {
        return Err("ACCEPTANCE_COMMAND_FAILED".into());
    }
    String::from_utf8(output.stdout).map_err(|_| "ACCEPTANCE_INVALID_OUTPUT".into())
}
async fn check_git(
    root: &Path,
    repo: &str,
    head: &str,
    previous_head: Option<&str>,
) -> Result<(), String> {
    if !super::is_sha(head) || previous_head.is_some_and(|v| !super::is_sha(v)) {
        return Err("ACCEPTANCE_INVALID_SHA".into());
    }
    let root = root.canonicalize().map_err(|_| "ACCEPTANCE_ROOT_INVALID")?;
    let path = root.to_str().ok_or("ACCEPTANCE_ROOT_INVALID")?;
    let top = run_cli(
        "git",
        &["-C", path, "rev-parse", "--show-toplevel"],
        5,
        MAX_GIT_BYTES,
    )
    .await?;
    if Path::new(top.trim()).canonicalize().ok().as_ref() != Some(&root) {
        return Err("ACCEPTANCE_ROOT_INVALID".into());
    }
    let current = run_cli("git", &["-C", path, "rev-parse", "HEAD"], 5, MAX_GIT_BYTES).await?;
    if !current.trim().eq_ignore_ascii_case(head) {
        return Err("ACCEPTANCE_HEAD_MOVED".into());
    }
    let remote = run_cli(
        "git",
        &["-C", path, "remote", "get-url", "origin"],
        5,
        MAX_GIT_BYTES,
    )
    .await?;
    if github_repo_from_remote(&remote).as_deref() != Some(repo) {
        return Err("ACCEPTANCE_REPOSITORY_MISMATCH".into());
    }
    let dirty = run_cli(
        "git",
        &["-C", path, "status", "--porcelain", "--untracked-files=no"],
        5,
        MAX_GIT_BYTES,
    )
    .await?;
    if !dirty.trim().is_empty() {
        return Err("ACCEPTANCE_DIRTY_HEAD".into());
    }
    if let Some(previous) = previous_head {
        if previous.eq_ignore_ascii_case(head)
            || run_cli(
                "git",
                &["-C", path, "merge-base", "--is-ancestor", previous, head],
                8,
                MAX_GIT_BYTES,
            )
            .await
            .is_err()
        {
            return Err("ACCEPTANCE_ANCESTRY_UNVERIFIED".into());
        }
    }
    Ok(())
}
async fn check_ci(repo: &str, ci: &CiReceipt) -> Result<(), String> {
    let run_path = format!("repos/{repo}/actions/runs/{}", ci.run_id);
    let jobs_path = format!(
        "repos/{repo}/actions/runs/{}/jobs?per_page=100&filter=latest",
        ci.run_id
    );
    let run = run_cli("gh", &["api", "-X", "GET", &run_path], 14, MAX_API_BYTES).await?;
    let jobs = run_cli("gh", &["api", "-X", "GET", &jobs_path], 14, MAX_API_BYTES).await?;
    let run: Value = serde_json::from_str(&run).map_err(|_| "ACCEPTANCE_INVALID_CI_JSON")?;
    let jobs: Value = serde_json::from_str(&jobs).map_err(|_| "ACCEPTANCE_INVALID_CI_JSON")?;
    validate_workflow_job(&run, &jobs, repo, ci)
}
/// Internal proof only. The owner key, signer ID, registered root and repo identity
/// MUST come from trusted native account+project registry, never caller supplied IPC.
/// This does NOT turn a pending receipt into an accepted feature.
#[allow(dead_code)]
pub(super) async fn corroborate_pending_external(
    receipt: &SignedAcceptanceReceipt,
    pinned_owner: &VerifyingKey,
    signer_id: &str,
    registered_root: &Path,
    expected_repo: &str,
    previous_head: Option<&str>,
) -> Result<PendingExternalCheck, String> {
    if !super::bounded(signer_id, 160)
        || receipt.owner.signer_key_id != signer_id
        || receipt.ci.is_empty()
        || receipt.ci.len() > MAX_CI_CHECKS
    {
        return Err("ACCEPTANCE_IDENTITY_GATE_UNCONFIGURED".into());
    }
    validate_owner_signed(receipt, pinned_owner)?;
    if github_repo_from_remote(&format!("https://github.com/{expected_repo}.git")).as_deref()
        != Some(expected_repo)
    {
        return Err("ACCEPTANCE_REPOSITORY_INVALID".into());
    }
    check_git(
        registered_root,
        expected_repo,
        &receipt.head_sha,
        previous_head,
    )
    .await?;
    for ci in &receipt.ci {
        check_ci(expected_repo, ci).await?;
    }
    Ok(PendingExternalCheck {
        project_id: receipt.project_id.clone(),
        receipt_hash: receipt.hash.clone(),
        ci_jobs_checked: receipt.ci.len(),
        status: "corroborated_but_not_accepted",
    })
}

/// Loads ONLY staged, currently pending receipts from the native Memory Fabric.
/// Validates the full local hash chain and denormalized columns (not a trust
/// decision). A passed-in receipt or browser flag is never an evidence source.
fn read_latest_pending(
    store: &MemoryStore,
    project_id: &str,
    plan_sequence: i64,
    expected_scope_digest: &str,
) -> Result<(SignedAcceptanceReceipt, Option<String>), String> {
    let id = validate_project_id(project_id)?;
    if plan_sequence <= 0 || !super::is_digest(expected_scope_digest) {
        return Err("ACCEPTANCE_SCOPE_INVALID".into());
    }
    let mut statement = store
        .conn
        .prepare(
            "SELECT project_id,plan_journal_sequence,scope_digest,head_sha,
                accepted_at,owner_decision_id,receipt_hash,previous_hash,payload_json,review_state
         FROM acceptance_pending_receipts WHERE project_id=?1 AND plan_journal_sequence=?2
         ORDER BY receipt_id",
        )
        .map_err(|_| "ACCEPTANCE_DB_READ_FAILED")?;
    let rows = statement
        .query_map(params![id, plan_sequence], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, Option<String>>(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, String>(9)?,
            ))
        })
        .map_err(|_| "ACCEPTANCE_DB_READ_FAILED")?;
    let mut last: Option<SignedAcceptanceReceipt> = None;
    let mut before_last: Option<String> = None;
    let mut count = 0usize;
    for row in rows {
        let (
            db_project,
            db_plan,
            db_scope,
            db_head,
            db_at,
            db_owner,
            db_hash,
            db_previous,
            json,
            state,
        ) = row.map_err(|_| "ACCEPTANCE_DB_READ_FAILED")?;
        count += 1;
        if count > 512 || json.len() > 65536 || state != "pending_external_checks" {
            return Err("ACCEPTANCE_STORED_RECEIPT_INVALID".into());
        }
        let receipt: SignedAcceptanceReceipt =
            serde_json::from_str(&json).map_err(|_| "ACCEPTANCE_STORED_RECEIPT_INVALID")?;
        if db_project != id
            || db_plan != plan_sequence
            || !db_scope.eq_ignore_ascii_case(expected_scope_digest)
            || db_scope != receipt.scope_digest
            || db_head != receipt.head_sha
            || db_at != receipt.accepted_at
            || db_owner != receipt.owner.decision_id
            || db_hash != receipt.hash
            || db_previous != receipt.previous_hash
            || receipt.project_id != id
            || receipt.plan_journal_sequence != plan_sequence
            || receipt_hash(&receipt) != receipt.hash.to_ascii_lowercase()
            || receipt.previous_hash != last.as_ref().map(|r| r.hash.clone())
        {
            return Err("ACCEPTANCE_STORED_RECEIPT_INVALID".into());
        }
        if let Some(ref previous) = last {
            if previous.accepted_at >= receipt.accepted_at
                || previous.head_sha.eq_ignore_ascii_case(&receipt.head_sha)
            {
                return Err("ACCEPTANCE_STORED_HISTORY_INVALID".into());
            }
            let now: std::collections::BTreeSet<_> = receipt.accepted_feature_ids.iter().collect();
            if previous
                .accepted_feature_ids
                .iter()
                .any(|id| !now.contains(id))
            {
                return Err("ACCEPTANCE_STORED_HISTORY_INVALID".into());
            }
            before_last = Some(previous.head_sha.clone());
        }
        last = Some(receipt);
    }
    let last = last.ok_or("ACCEPTANCE_NO_PENDING_RECEIPTS")?;
    Ok((last, before_last))
}

/// No untrusted receipt may be injected: the native handler would load one
/// from SQLite and bind scope/owner/root using separately authorized sources.
/// Still only returns a corroborated PENDING result, never feature acceptance.
#[allow(dead_code)]
pub(super) async fn corroborate_latest_pending(
    store: &MemoryStore,
    project_id: &str,
    plan_sequence: i64,
    expected_scope_digest: &str,
    pinned_owner: &VerifyingKey,
    signer_id: &str,
    registered_root: &Path,
    expected_repo: &str,
) -> Result<PendingExternalCheck, String> {
    let (latest, previous_head) =
        read_latest_pending(store, project_id, plan_sequence, expected_scope_digest)?;
    // Reconstruct the actual local Blueprint scope from the project-bound
    // Memory Fabric rather than trusting the caller's supplied scope digest.
    // This is documentary corroboration only; owner-reviewed plan acceptance
    // must remain a separate gate before any verified percentage.
    let progress = store.project_mvp_progress(project_id, &latest.head_sha)?;
    super::scope_policy::audit_pending_feature_scope(&progress, &latest)?;
    corroborate_pending_external(
        &latest,
        pinned_owner,
        signer_id,
        registered_root,
        expected_repo,
        previous_head.as_deref(),
    )
    .await
}

/// Internally hosted authority path, not exposed to Tauri/IPC.
/// A freshly verified KATOOS UID is mandatory, but login alone gives no grant.
/// The native issuer key and the online-fetched signed grant MUST be
/// provisioned independently; no issuer pin is configured for production yet.
#[allow(dead_code)]
pub(super) async fn corroborate_latest_pending_with_owner_authority(
    store: &MemoryStore,
    project_id: &str,
    plan_sequence: i64,
    scope_digest: &str,
    signed_grant: &super::owner_authority::SignedOwnerGrant,
    pinned_katoos_issuer: &VerifyingKey,
    registered_root: &Path,
    expected_repo: &str,
) -> Result<PendingExternalCheck, String> {
    let uid = crate::github_app_auth::verified_katosync_user()
        .await
        .map_err(|_| "ACCEPTANCE_KATOOS_LOGIN_REQUIRED")?;
    let (receipt, _) = read_latest_pending(store, project_id, plan_sequence, scope_digest)?;
    let authority = super::owner_authority::validate_owner_grant(
        signed_grant,
        &receipt,
        &uid,
        project_id,
        pinned_katoos_issuer,
        chrono::Utc::now().timestamp_millis(),
    )?;
    let outcome = corroborate_latest_pending(
        store,
        project_id,
        plan_sequence,
        scope_digest,
        &authority.owner_key,
        &authority.signer_key_id,
        registered_root,
        expected_repo,
    )
    .await?;
    crate::mesh_identity::same_account_still_verified(&uid)
        .await
        .map_err(|_| "ACCEPTANCE_KATOOS_ACCOUNT_CHANGED")?;
    Ok(outcome)
}

/// Live-only, fail-closed QA bridge. It never accepts an issuer URL, user UID,
/// service-role key or approver grant from the WebView.
#[allow(dead_code)]
async fn fetch_current_qa_signed_owner_grant(
    project_id: &str,
) -> Result<super::owner_authority::SignedOwnerGrant, String> {
    const CANONICAL_KATOOS: &str = "https://xbnnlyyxiilklsygxcof.supabase.co";
    const MAX_BODY: usize = 4096;
    if !cfg!(feature = "katoos-auth-qa") || crate::KATOSYNC_AUTH_URL != CANONICAL_KATOOS {
        return Err("ACCEPTANCE_ISSUER_NOT_CONFIGURED".into());
    }
    let id = validate_project_id(project_id)?;
    if id.len() > 80
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b':'))
    {
        return Err("ACCEPTANCE_ISSUER_PROJECT_INVALID".into());
    }
    let token = zeroize::Zeroizing::new(
        crate::ensure_supabase_access_token()
            .await
            .map_err(|_| "ACCEPTANCE_KATOOS_LOGIN_REQUIRED".to_string())?,
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "ACCEPTANCE_ISSUER_UNAVAILABLE".to_string())?;
    let mut response = client
        .get(format!(
            "{CANONICAL_KATOOS}/functions/v1/feature-approver-grant-qa"
        ))
        .query(&[("projectId", id)])
        .header("apikey", crate::KATOSYNC_AUTH_ANON_KEY)
        .header("Cache-Control", "no-store")
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|_| "ACCEPTANCE_ISSUER_UNAVAILABLE".to_string())?;
    if response.status() != reqwest::StatusCode::OK
        || response
            .content_length()
            .is_some_and(|n| n > MAX_BODY as u64)
    {
        return Err("ACCEPTANCE_ISSUER_DENIED".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "ACCEPTANCE_ISSUER_UNAVAILABLE".to_string())?
    {
        if chunk.len() > MAX_BODY - bytes.len() {
            return Err("ACCEPTANCE_ISSUER_INVALID_RESPONSE".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    super::owner_authority::parse_signed_owner_grant(&bytes)
}

/// Every call obtains a NEW server-authorized, short-lived project grant.
/// A reusable / user-supplied grant cannot bypass this network gate. The
/// issuer key must be a native trusted pin, never a JSON response field.
/// No production key pin or frontend IPC is enabled yet.
#[allow(dead_code)]
pub(super) async fn corroborate_latest_pending_via_qa_issuer(
    store: &MemoryStore,
    project_id: &str,
    plan_sequence: i64,
    scope_digest: &str,
    pinned_katoos_issuer: &VerifyingKey,
    registered_root: &Path,
    expected_repo: &str,
) -> Result<PendingExternalCheck, String> {
    crate::github_app_auth::verified_katosync_user()
        .await
        .map_err(|_| "ACCEPTANCE_KATOOS_LOGIN_REQUIRED")?;
    let fresh = fetch_current_qa_signed_owner_grant(project_id).await?;
    corroborate_latest_pending_with_owner_authority(
        store,
        project_id,
        plan_sequence,
        scope_digest,
        &fresh,
        pinned_katoos_issuer,
        registered_root,
        expected_repo,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(head: &str) -> (Value, Value, CiReceipt) {
        let run = serde_json::json!({"id":123,"name":"CI","status":"completed",
          "conclusion":"success","run_attempt":2,"head_sha":head,
          "repository":{"full_name":"NMKato/KatoSync"},
          "head_repository":{"full_name":"NMKato/KatoSync"}});
        let jobs = serde_json::json!({"total_count":2,"jobs":[
          {"run_id":123,"run_attempt":2,"name":"unit","status":"completed","conclusion":"success"},
          {"run_id":123,"run_attempt":2,"name":"lint","status":"completed","conclusion":"failure"}]});
        let ci = CiReceipt {
            workflow: "CI".into(),
            job: "unit".into(),
            run_id: 123,
            head_sha: head.into(),
        };
        (run, jobs, ci)
    }
    #[test]
    fn exact_workflow_run_and_latest_attempt_job_required() {
        let (r, j, c) = fixture(&"a".repeat(40));
        assert!(validate_workflow_job(&r, &j, "NMKato/KatoSync", &c).is_ok());
    }
    #[test]
    fn rejects_mismatched_repo_head_run_or_missing_workflow_success() {
        let (mut r, j, c) = fixture(&"a".repeat(40));
        r["head_sha"] = serde_json::json!("b".repeat(40));
        assert!(validate_workflow_job(&r, &j, "NMKato/KatoSync", &c).is_err());
        r["head_sha"] = serde_json::json!("a".repeat(40));
        r["head_repository"]["full_name"] = serde_json::json!("Other/Fork");
        assert!(validate_workflow_job(&r, &j, "NMKato/KatoSync", &c).is_err());
        r["head_repository"]["full_name"] = serde_json::json!("NMKato/KatoSync");
        r["conclusion"] = serde_json::json!("failure");
        assert!(validate_workflow_job(&r, &j, "NMKato/KatoSync", &c).is_err());
    }
    #[test]
    fn denies_old_attempt_failed_job_duplicates_and_truncated_pages() {
        let (r, mut j, c) = fixture(&"a".repeat(40));
        j["jobs"][0]["run_attempt"] = serde_json::json!(1);
        assert!(validate_workflow_job(&r, &j, "NMKato/KatoSync", &c).is_err());
        j["jobs"][0]["run_attempt"] = serde_json::json!(2);
        j["jobs"][0]["conclusion"] = serde_json::json!("failure");
        assert!(validate_workflow_job(&r, &j, "NMKato/KatoSync", &c).is_err());
        j["jobs"][0]["conclusion"] = serde_json::json!("success");
        j["jobs"][1]["name"] = serde_json::json!("unit");
        assert!(validate_workflow_job(&r, &j, "NMKato/KatoSync", &c).is_err());
        j["jobs"][1]["name"] = serde_json::json!("lint");
        j["total_count"] = serde_json::json!(1000);
        assert!(validate_workflow_job(&r, &j, "NMKato/KatoSync", &c).is_err());
    }
    #[tokio::test]
    async fn does_not_probe_unsafe_nonexistent_repo_or_injected_sha() {
        assert!(check_git(
            Path::new("/not/a/registered/root"),
            "NMKato/KatoSync",
            &"a".repeat(40),
            None
        )
        .await
        .is_err());
        assert!(check_git(Path::new("."), "NMKato/KatoSync", "-wrong", None)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn real_local_git_ancestry_must_be_verified_not_inferred_from_sha_strings() {
        use std::{
            fs,
            process::Command,
            time::{SystemTime, UNIX_EPOCH},
        };
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "katosync-git-proof-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        let git = |args: &[&str]| -> String {
            let out = Command::new("git")
                .arg("-C")
                .arg(&root)
                .args(args)
                .output()
                .unwrap();
            assert!(out.status.success(), "git {:?} failed", args);
            String::from_utf8(out.stdout).unwrap().trim().to_string()
        };
        git(&["init", "-q"]);
        git(&[
            "remote",
            "add",
            "origin",
            "https://github.com/NMKato/KatoSync.git",
        ]);
        fs::write(root.join("sample.txt"), "one").unwrap();
        git(&["add", "sample.txt"]);
        git(&[
            "-c",
            "user.email=test@example.com",
            "-c",
            "user.name=QA",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-qm",
            "one",
        ]);
        let first = git(&["rev-parse", "HEAD"]);
        fs::write(root.join("sample.txt"), "two").unwrap();
        git(&["add", "sample.txt"]);
        git(&[
            "-c",
            "user.email=test@example.com",
            "-c",
            "user.name=QA",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-qm",
            "two",
        ]);
        let second = git(&["rev-parse", "HEAD"]);
        assert!(check_git(&root, "NMKato/KatoSync", &second, Some(&first))
            .await
            .is_ok());
        assert!(check_git(&root, "NMKato/Foreign", &second, Some(&first))
            .await
            .is_err());
        assert!(check_git(&root, "NMKato/KatoSync", &first, None)
            .await
            .is_err());
        assert!(check_git(&root, "NMKato/KatoSync", &second, Some(&second))
            .await
            .is_err());
        fs::write(root.join("sample.txt"), "dirty").unwrap();
        assert!(check_git(&root, "NMKato/KatoSync", &second, Some(&first))
            .await
            .is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sqlite_pending_chain_is_required_and_never_read_as_accepted() {
        use crate::memory_fabric::{IngestBatch, ProjectIdentity};
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
        use ed25519_dalek::{Signer, SigningKey};
        let mut store = MemoryStore::open_in_memory().unwrap();
        store
            .ingest(IngestBatch {
                identity: ProjectIdentity {
                    project_id: "qa-project".into(),
                    name: "QA".into(),
                    repo_identity: None,
                    root_fingerprint: "fixed-qa-fingerprint".into(),
                },
                git_head: Some("a".repeat(40)),
                git_branch: Some("main".into()),
                indexed_at: "2026-11-04T12:00:00Z".into(),
                sources: vec![],
            })
            .unwrap();
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let make = |head: &str, at: &str, features: &[&str], previous: Option<String>| {
            let mut receipt = SignedAcceptanceReceipt {
                schema_version: "katosync.feature-acceptance/v1".into(),
                project_id: "qa-project".into(),
                plan_journal_sequence: 17,
                scope_digest: "f".repeat(64),
                head_sha: head.repeat(40),
                accepted_at: at.into(),
                accepted_feature_ids: features.iter().map(|v| v.to_string()).collect(),
                ci: vec![CiReceipt {
                    workflow: "CI".into(),
                    job: "unit".into(),
                    run_id: 123,
                    head_sha: head.repeat(40),
                }],
                owner: crate::memory_fabric::acceptance_ledger::OwnerApproval {
                    decision_id: format!("owner-approval-{head}"),
                    signer_key_id: "trusted-qa-owner".into(),
                    signature: String::new(),
                },
                previous_hash: previous,
                hash: String::new(),
            };
            receipt.owner.signature = URL_SAFE_NO_PAD.encode(
                key.sign(&crate::memory_fabric::acceptance_ledger::signing_bytes(
                    &receipt,
                ))
                .to_bytes(),
            );
            receipt.hash = crate::memory_fabric::acceptance_ledger::receipt_hash(&receipt);
            receipt
        };
        let first = make("a", "2026-11-01T12:00:00.000Z", &["one"], None);
        store
            .stage_owner_signed_acceptance(&first, &key.verifying_key())
            .unwrap();
        let (current, previous) =
            read_latest_pending(&store, "qa-project", 17, &"f".repeat(64)).unwrap();
        assert_eq!(current.hash, first.hash);
        assert_eq!(previous, None);
        assert!(read_latest_pending(&store, "qa-project", 17, &"0".repeat(64)).is_err());
        let second = make(
            "b",
            "2026-11-02T12:00:00.000Z",
            &["one", "two"],
            Some(first.hash.clone()),
        );
        store
            .stage_owner_signed_acceptance(&second, &key.verifying_key())
            .unwrap();
        let (current, previous) =
            read_latest_pending(&store, "qa-project", 17, &"f".repeat(64)).unwrap();
        assert_eq!(current.hash, second.hash);
        assert_eq!(previous, Some("a".repeat(40)));
        assert_eq!(
            store
                .project_mvp_progress("qa-project", &"a".repeat(40))
                .unwrap()
                .verified_percent,
            None
        );
        // Simulate local DB tampering bypassing the app-level append-only trigger.
        store
            .conn
            .execute_batch("DROP TRIGGER acceptance_pending_no_update;")
            .unwrap();
        store
            .conn
            .execute(
                "UPDATE acceptance_pending_receipts SET payload_json='{}' WHERE receipt_hash=?1",
                [&first.hash],
            )
            .unwrap();
        assert!(read_latest_pending(&store, "qa-project", 17, &"f".repeat(64)).is_err());
    }
}
