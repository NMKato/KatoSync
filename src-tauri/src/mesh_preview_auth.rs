//! Stage 3S: independent Preview GoTrue QA login; no production credential reuse.
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::{sync::OnceLock, time::Duration};
use tokio::sync::Mutex;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

const SERVICE: &str = "com.nmkato.katosync.mesh.preview.auth.qa";
const ACCOUNT: &str = "isolated-preview-refresh-v1";
const MAX_RESPONSE: usize = 8192;
static TRANSITION: OnceLock<Mutex<()>> = OnceLock::new();
fn transition() -> &'static Mutex<()> {
    TRANSITION.get_or_init(|| Mutex::new(()))
}
#[derive(Clone)]
struct PreviewConfig {
    origin: &'static str,
    project_ref: &'static str,
    api_key: &'static str,
}
fn configured() -> Option<PreviewConfig> {
    if !cfg!(feature = "mesh-preview-auth-qa") {
        return None;
    }
    let origin = option_env!("KATOSYNC_MESH_PREVIEW_SUPABASE_URL")?;
    let reference = option_env!("KATOSYNC_MESH_PREVIEW_PROJECT_REF")?;
    let deployment = option_env!("KATOSYNC_MESH_PREVIEW_DEPLOYMENT_ID")?;
    let api_key = option_env!("KATOSYNC_MESH_PREVIEW_PUBLISHABLE_KEY")?;
    if !crate::mesh_native_issuer::parse_preview_target(origin, reference, deployment)
        || !api_key.starts_with("sb_publishable_")
        || api_key.len() < 25
        || api_key.len() > 256
        || !api_key
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        return None;
    }
    Some(PreviewConfig {
        origin,
        project_ref: reference,
        api_key,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAuthStatus {
    protocol: &'static str,
    configured: bool,
    preview_issuer_only: bool,
    independent_keychain: bool,
    session_verified: bool,
    account_email: Option<String>,
    paired: bool,
    transport_ready: bool,
    remote_jobs_enabled: bool,
}
fn status(cfg: bool, email: Option<String>) -> PreviewAuthStatus {
    PreviewAuthStatus {
        protocol: "mesh-preview-auth-v1",
        configured: cfg,
        preview_issuer_only: cfg,
        independent_keychain: cfg,
        session_verified: email.is_some(),
        account_email: email,
        paired: false,
        transport_ready: false,
        remote_jobs_enabled: false,
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredPreviewSession {
    issuer_origin: String,
    owner_id: String,
    refresh_token: String,
}
impl Drop for StoredPreviewSession {
    fn drop(&mut self) {
        self.refresh_token.zeroize();
    }
}
fn preview_account(cfg: &PreviewConfig) -> String {
    format!("{ACCOUNT}:{}", cfg.project_ref)
}
fn isolated_entry(cfg: &PreviewConfig) -> Result<Entry, String> {
    Entry::new(SERVICE, &preview_account(cfg)).map_err(|_| "PREVIEW_KEYCHAIN_UNAVAILABLE".into())
}
fn load_session(cfg: &PreviewConfig) -> Result<StoredPreviewSession, String> {
    let raw = Zeroizing::new(
        isolated_entry(cfg)?
            .get_password()
            .map_err(|_| "PREVIEW_LOGIN_REQUIRED".to_string())?,
    );
    let stored: StoredPreviewSession =
        serde_json::from_str(&raw).map_err(|_| "PREVIEW_SESSION_INVALID".to_string())?;
    if stored.issuer_origin != cfg.origin
        || Uuid::parse_str(&stored.owner_id).is_err()
        || stored.refresh_token.len() < 12
        || stored.refresh_token.len() > 8192
    {
        return Err("PREVIEW_SESSION_INVALID".into());
    }
    Ok(stored)
}
fn save_session(cfg: &PreviewConfig, owner: &str, refresh: &str) -> Result<(), String> {
    if Uuid::parse_str(owner).is_err() || refresh.len() < 12 || refresh.len() > 8192 {
        return Err("PREVIEW_SESSION_INVALID".into());
    }
    let raw = Zeroizing::new(
        serde_json::json!({
         "issuer_origin":cfg.origin,"owner_id":owner,"refresh_token":refresh
        })
        .to_string(),
    );
    isolated_entry(cfg)?
        .set_password(raw.as_str())
        .map_err(|_| "PREVIEW_KEYCHAIN_UNAVAILABLE".into())
}
#[derive(Deserialize)]
struct GoTrueTokens {
    access_token: String,
    refresh_token: String,
    token_type: String,
    expires_in: i64,
}
#[derive(Deserialize)]
struct GoTrueIdentity {
    id: String,
    email: Option<String>,
    is_anonymous: Option<bool>,
}

fn safe_tokens(v: &GoTrueTokens) -> bool {
    v.token_type.eq_ignore_ascii_case("bearer")
        && v.expires_in > 0
        && v.expires_in <= 86400
        && (20..=8192).contains(&v.access_token.len())
        && (12..=8192).contains(&v.refresh_token.len())
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "PREVIEW_NETWORK_UNAVAILABLE".into())
}
// Cap both advertised and chunked responses before accumulating into memory.
async fn bounded_auth_body(
    mut response: reqwest::Response,
    failure: &'static str,
) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE as u64)
    {
        return Err(failure.into());
    }
    let mut out = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| failure.to_string())? {
        if chunk.len() > MAX_RESPONSE - out.len() {
            return Err(failure.into());
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}
async fn token_grant(
    c: &reqwest::Client,
    cfg: &PreviewConfig,
    kind: &'static str,
    payload: serde_json::Value,
) -> Result<GoTrueTokens, String> {
    let url = format!("{}/auth/v1/token?grant_type={kind}", cfg.origin);
    let response = c
        .post(url)
        .header("apikey", cfg.api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|_| "PREVIEW_NETWORK_UNAVAILABLE".to_string())?;
    if !response.status().is_success() {
        return Err("PREVIEW_LOGIN_REJECTED".into());
    }
    let bytes = bounded_auth_body(response, "PREVIEW_INVALID_RESPONSE").await?;
    let tokens: GoTrueTokens =
        serde_json::from_slice(&bytes).map_err(|_| "PREVIEW_INVALID_RESPONSE".to_string())?;
    if !safe_tokens(&tokens) {
        return Err("PREVIEW_INVALID_RESPONSE".into());
    }
    Ok(tokens)
}
impl Drop for GoTrueTokens {
    fn drop(&mut self) {
        self.access_token.zeroize();
        self.refresh_token.zeroize();
    }
}
async fn verified_identity(
    c: &reqwest::Client,
    cfg: &PreviewConfig,
    access: &str,
) -> Result<GoTrueIdentity, String> {
    let response = c
        .get(format!("{}/auth/v1/user", cfg.origin))
        .header("apikey", cfg.api_key)
        .bearer_auth(access)
        .send()
        .await
        .map_err(|_| "PREVIEW_NETWORK_UNAVAILABLE".to_string())?;
    if !response.status().is_success() {
        return Err("PREVIEW_IDENTITY_REJECTED".into());
    }
    let bytes = bounded_auth_body(response, "PREVIEW_IDENTITY_REJECTED").await?;
    let user: GoTrueIdentity =
        serde_json::from_slice(&bytes).map_err(|_| "PREVIEW_IDENTITY_REJECTED".to_string())?;
    if Uuid::parse_str(&user.id).is_err()
        || user.is_anonymous == Some(true)
        || !user
            .email
            .as_deref()
            .is_some_and(|x| x.len() <= 254 && x.contains('@'))
    {
        return Err("PREVIEW_IDENTITY_REJECTED".into());
    }
    Ok(user)
}
#[tauri::command]
pub fn mesh_preview_auth_status() -> PreviewAuthStatus {
    // This method never reads Keychain or authenticates from a stale email marker.
    status(configured().is_some(), None)
}
#[tauri::command]
pub async fn mesh_preview_auth_login(
    email: String,
    password: String,
) -> Result<PreviewAuthStatus, String> {
    let cfg = configured().ok_or("PREVIEW_NOT_CONFIGURED")?;
    let user_email = email.trim();
    if user_email.len() < 3
        || user_email.len() > 254
        || !user_email.contains('@')
        || user_email.chars().any(char::is_control)
        || password.is_empty()
        || password.len() > 1024
    {
        return Err("PREVIEW_LOGIN_INVALID_INPUT".into());
    }
    let password = Zeroizing::new(password);
    let _guard = transition().lock().await;
    let c = client()?;
    let session = token_grant(
        &c,
        &cfg,
        "password",
        serde_json::json!({
            "email":user_email,"password":password.as_str()
        }),
    )
    .await?;
    let identity = verified_identity(&c, &cfg, &session.access_token).await?;
    if !identity
        .email
        .as_deref()
        .is_some_and(|saved| saved.eq_ignore_ascii_case(user_email))
    {
        return Err("PREVIEW_IDENTITY_MISMATCH".into());
    }
    // Existing preview owner cannot be switched without an explicit preview logout.
    match load_session(&cfg) {
        Ok(previous) if previous.owner_id != identity.id => {
            return Err("PREVIEW_ACCOUNT_SWITCH_BLOCKED".into())
        }
        Err(reason) if reason != "PREVIEW_LOGIN_REQUIRED" => return Err(reason),
        _ => {}
    }
    save_session(&cfg, &identity.id, &session.refresh_token)?;
    Ok(status(true, identity.email))
}
#[tauri::command]
pub async fn mesh_preview_auth_verify_session() -> Result<PreviewAuthStatus, String> {
    let cfg = configured().ok_or("PREVIEW_NOT_CONFIGURED")?;
    let _guard = transition().lock().await;
    let previous = load_session(&cfg)?;
    let c = client()?;
    let next = token_grant(
        &c,
        &cfg,
        "refresh_token",
        serde_json::json!({
            "refresh_token":previous.refresh_token
        }),
    )
    .await?;
    let identity = verified_identity(&c, &cfg, &next.access_token).await?;
    if identity.id != previous.owner_id {
        return Err("PREVIEW_ACCOUNT_SWITCH_BLOCKED".into());
    }
    // Persist rotated refresh only AFTER online owner verification.
    save_session(&cfg, &identity.id, &next.refresh_token)?;
    Ok(status(true, identity.email))
}

#[tauri::command]
pub async fn mesh_preview_auth_logout() -> Result<PreviewAuthStatus, String> {
    let cfg = configured().ok_or("PREVIEW_NOT_CONFIGURED")?;
    let _guard = transition().lock().await;
    let entry = isolated_entry(&cfg)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(status(!cfg.origin.is_empty(), None)),
        Err(_) => Err("PREVIEW_KEYCHAIN_UNAVAILABLE".into()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_storage_is_separate_from_legacy_and_shared_katoos() {
        assert_ne!(SERVICE, crate::KEYCHAIN_SERVICE);
        assert_ne!(SERVICE, "com.nmkato.katosync");
        assert_ne!(SERVICE, "com.nmkato.katosync.katoos.auth.qa");
        assert_ne!(SERVICE, "com.nmkato.katosync.github.login.qa");
        assert_eq!(ACCOUNT, "isolated-preview-refresh-v1");
        let report = mesh_preview_auth_status();
        assert!(!report.session_verified);
        assert!(report.account_email.is_none());
        assert!(!report.paired && !report.transport_ready && !report.remote_jobs_enabled);
    }
    #[test]
    fn synthetic_grants_must_be_short_lived_valid_bearer_strings() {
        let ok = GoTrueTokens {
            access_token: "a".repeat(40),
            refresh_token: "b".repeat(40),
            token_type: "bearer".into(),
            expires_in: 3600,
        };
        assert!(safe_tokens(&ok));
        let mut wrong = GoTrueTokens {
            expires_in: 100000,
            access_token: ok.access_token.clone(),
            refresh_token: ok.refresh_token.clone(),
            token_type: ok.token_type.clone(),
        };
        assert!(!safe_tokens(&wrong));
        wrong.expires_in = 3600;
        wrong.token_type = "macaroon".into();
        assert!(!safe_tokens(&wrong));
        wrong.token_type = "bearer".into();
        wrong.refresh_token = "x".into();
        assert!(!safe_tokens(&wrong));
    }
    #[test]
    fn preview_credentials_never_enable_mesh_or_preview_without_configuration() {
        let r = status(false, None);
        assert!(!r.configured && !r.preview_issuer_only && !r.independent_keychain);
        assert!(!r.session_verified && !r.paired && !r.transport_ready);
        let r = status(true, Some("qa@example.invalid".into()));
        assert!(r.session_verified && r.preview_issuer_only && r.independent_keychain);
        assert!(!r.paired && !r.transport_ready && !r.remote_jobs_enabled);
    }
}

// Stage 3T: exercise actual reqwest + GoTrue decoding on disposable loopback only.
#[cfg(test)]
#[path = "mesh_preview_auth_tests_3t.rs"]
mod stage3t_tests;
