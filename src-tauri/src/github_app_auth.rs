// Created by NMKato Solutions
//! Explicit GitHub App OAuth device flow. No arbitrary client IDs or GitHub writes.
//! Device code only in RAM; provider tokens only in OS keychain, never frontend,
//! project registry, Memory Fabric, Blueprint, logs or cloud services.
//! GitHub App must be registered with *Device Flow enabled* by the owner.
//! This module does NOT grant repo/Project write permissions.
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::{
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use zeroize::Zeroize;

// Public GitHub App identifier, shared by all KatoSync customers; no secret.
const CLIENT_ID: Option<&str> = match option_env!("KATOSYNC_GITHUB_APP_CLIENT_ID") {
    Some(x) => Some(x),
    None => Some("Iv23liALq4EnjOcfPVOD"),
};
#[cfg(not(feature = "github-login-qa"))]
const KEYCHAIN_SERVICE: &str = "com.nmkato.katosync";
#[cfg(all(feature = "github-login-qa", not(feature = "katoos-auth-qa")))]
const KEYCHAIN_SERVICE: &str = "com.nmkato.katosync.github.login.qa";
#[cfg(feature = "katoos-auth-qa")]
const KEYCHAIN_SERVICE: &str = "com.nmkato.katosync.katoos.auth.qa";
const ACCOUNT_PREFIX: &str = "github-app-user-device-v2:";
static ACTIVE_USER: OnceLock<Mutex<Option<String>>> = OnceLock::new();
fn active_user() -> &'static Mutex<Option<String>> {
    ACTIVE_USER.get_or_init(|| Mutex::new(None))
}
fn clear_active_user() {
    if let Ok(mut s) = active_user().lock() {
        *s = None;
    }
}
fn cached_uid() -> Option<String> {
    active_user().lock().ok().and_then(|g| g.clone())
}
#[derive(Deserialize)]
struct SupabaseUserIdentity {
    id: String,
}
fn should_refresh_katosync_session(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::UNAUTHORIZED
}
async fn fetch_katosync_identity(token: &str) -> Result<reqwest::Response, String> {
    network()?
        .get(format!("{}/auth/v1/user", crate::KATOSYNC_AUTH_URL))
        .header("apikey", crate::KATOSYNC_AUTH_ANON_KEY)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "KatoSync-Sitzung nicht überprüfbar.".to_string())
}
pub(crate) async fn verified_katosync_user() -> Result<String, String> {
    let mut token = crate::ensure_supabase_access_token()
        .await
        .map_err(|_| "Bitte zuerst bei KatoSync anmelden.".to_string())?;
    let mut response = fetch_katosync_identity(&token).await;
    // Access tokens expire during long-running desktop sessions. Retry exactly
    // once after a 401, only if the rejected token still belongs to this session.
    if response
        .as_ref()
        .is_ok_and(|r| should_refresh_katosync_session(r.status()))
    {
        if !crate::invalidate_rejected_supabase_access_token(&token) {
            token.zeroize();
            return Err("KatoSync-Konto während der Prüfung gewechselt.".into());
        }
        token.zeroize();
        token = crate::ensure_supabase_access_token()
            .await
            .map_err(|_| "Bitte KatoSync-Sitzung erneuern.".to_string())?;
        response = fetch_katosync_identity(&token).await;
    }
    token.zeroize();
    let response = response?;
    if !response.status().is_success() {
        return Err("Bitte KatoSync-Sitzung erneuern.".into());
    }
    let identity: SupabaseUserIdentity = response
        .json()
        .await
        .map_err(|_| "Ungültige KatoSync-Benutzeridentität.".to_string())?;
    let uid = uuid::Uuid::parse_str(&identity.id)
        .map_err(|_| "KatoSync-Benutzerkennung ungültig.".to_string())?
        .to_string();
    if let Ok(mut x) = active_user().lock() {
        *x = Some(uid.clone());
    }
    Ok(uid)
}
const VERIFY_URL: &str = "https://github.com/login/device";
const MAX_POLL_INTERVAL: u64 = 120;

struct Pending {
    nonce: String,
    katosync_uid: String,
    device_code: String,
    expires: Instant,
    poll_after: Instant,
    interval: Duration,
    polling: bool,
}
impl Drop for Pending {
    fn drop(&mut self) {
        self.device_code.zeroize();
    }
}
static PENDING: OnceLock<Mutex<Option<Pending>>> = OnceLock::new();
fn pending() -> &'static Mutex<Option<Pending>> {
    PENDING.get_or_init(|| Mutex::new(None))
}
fn valid_client_id(s: &str) -> bool {
    // GitHub App client IDs use a dotted prefix, for example Iv1.abc123.
    // Unlike the numeric App ID, this is a public build-time identifier.
    // Never accept URL components, whitespace or a runtime-supplied ID.
    // GitHub has issued both legacy Iv1.<suffix> and newer Iv23<suffix>
    // client IDs. Neither is a numeric App ID.
    if !(10..=120).contains(&s.len()) || !s.starts_with("Iv") {
        return false;
    }
    let tail = &s[2..];
    if let Some((numeric, suffix)) = tail.split_once('.') {
        !numeric.is_empty()
            && numeric.bytes().all(|b| b.is_ascii_digit())
            && suffix.len() >= 6
            && suffix.bytes().all(|b| b.is_ascii_alphanumeric())
    } else {
        tail.len() >= 8 && tail.bytes().all(|b| b.is_ascii_alphanumeric())
    }
}
fn client_id() -> Option<&'static str> {
    CLIENT_ID.filter(|s| valid_client_id(s))
}
fn entry(uid: &str) -> Result<Entry, String> {
    let uid =
        uuid::Uuid::parse_str(uid).map_err(|_| "KatoSync-Benutzerkennung ungültig.".to_string())?;
    Entry::new(KEYCHAIN_SERVICE, &format!("{ACCOUNT_PREFIX}{uid}"))
        .map_err(|_| "Betriebssystem-Schlüsselbund nicht verfügbar.".into())
}
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubAppAuthStatus {
    pub configured: bool,
    pub connected: bool,
    pub login: Option<String>,
    pub expires_at: Option<u64>,
    pub permissions_checked: bool,
    pub write_access_granted: bool,
    pub auth_source: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubDeviceBegin {
    pub session_id: String,
    pub user_code: String,
    pub verification_uri: &'static str,
    pub expires_in: u64,
    pub interval: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubDevicePoll {
    pub state: &'static str,
    pub retry_after_seconds: u64,
    pub login: Option<String>,
}
#[derive(Deserialize)]
struct DeviceResponse {
    device_code: Option<String>,
    user_code: Option<String>,
    verification_uri: Option<String>,
    expires_in: Option<u64>,
    interval: Option<u64>,
    error: Option<String>,
}
#[derive(Deserialize)]
struct AccessResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    refresh_token_expires_in: Option<u64>,
    token_type: Option<String>,
    error: Option<String>,
    interval: Option<u64>,
}
impl Drop for AccessResponse {
    fn drop(&mut self) {
        if let Some(s) = &mut self.access_token {
            s.zeroize();
        }
        if let Some(s) = &mut self.refresh_token {
            s.zeroize();
        }
    }
}
#[derive(Deserialize)]
struct GhUser {
    id: u64,
    login: String,
}
#[derive(Serialize, Deserialize)]
struct Credential {
    client_id: String,
    katosync_uid: String,
    user_id: u64,
    login: String,
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    refresh_expires_at: u64,
}
impl Drop for Credential {
    fn drop(&mut self) {
        self.access_token.zeroize();
        self.refresh_token.zeroize();
    }
}
fn status_from(credential: Option<Credential>, uid: Option<&str>) -> GithubAppAuthStatus {
    let configured = client_id().is_some();
    let valid = credential.filter(|c| {
        Some(c.client_id.as_str()) == client_id()
            && uid == Some(c.katosync_uid.as_str())
            && c.expires_at > now_secs() + 10
            && c.user_id != 0
            && !c.login.is_empty()
    });
    GithubAppAuthStatus {
        configured,
        connected: valid.is_some(),
        login: valid.as_ref().map(|x| x.login.clone()),
        expires_at: valid.as_ref().map(|x| x.expires_at),
        permissions_checked: false,
        write_access_granted: false,
        auth_source: "github_app_device_flow",
    }
}
// GitHub App user-to-server access tokens expire after 8 hours. A device-flow
// refresh token can rotate them without a client secret. Never send a stored
// token through the WebView or borrow tokens from the GitHub CLI.
static REFRESH_MUTEX: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
fn refresh_mutex() -> &'static tokio::sync::Mutex<()> {
    REFRESH_MUTEX.get_or_init(|| tokio::sync::Mutex::new(()))
}
fn owned_credential(record: &Credential, uid: &str) -> bool {
    record.katosync_uid == uid
        && Some(record.client_id.as_str()) == client_id()
        && record.user_id != 0
        && safe_login(&record.login)
}
fn refresh_needed(record: &Credential, now: u64) -> bool {
    record.expires_at <= now.saturating_add(120)
}
fn valid_rotated_token(resp: &AccessResponse) -> bool {
    let access = resp.access_token.as_deref().unwrap_or("");
    let refresh = resp.refresh_token.as_deref().unwrap_or("");
    matches!(resp.token_type.as_deref(), Some("bearer"))
        && (300..=28800).contains(&resp.expires_in.unwrap_or(0))
        && (3600..=15897600).contains(&resp.refresh_token_expires_in.unwrap_or(0))
        && (20..=1024).contains(&access.len())
        && (20..=1024).contains(&refresh.len())
}
async fn ensure_fresh_github_credentials(uid: &str) -> Result<Option<Credential>, String> {
    let initial = credentials(uid)?;
    let Some(ref record) = initial else {
        return Ok(None);
    };
    if !owned_credential(record, uid) || !refresh_needed(record, now_secs()) {
        return Ok(initial);
    }
    let _serial = refresh_mutex().lock().await;
    // Re-read under the lock: an earlier UI request may have rotated the pair.
    let Some(record) = credentials(uid)? else {
        return Ok(None);
    };
    if !owned_credential(&record, uid) || !refresh_needed(&record, now_secs()) {
        return Ok(Some(record));
    }
    if record.refresh_expires_at <= now_secs().saturating_add(60) {
        // Fail closed, but keep the UI retryable: an expired access token
        // will yield connected=false and an explicit Device-Flow button.
        return Ok(Some(record));
    }
    let id = client_id().ok_or("GitHub App nicht konfiguriert.")?;
    let response = network()?
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", id),
            ("grant_type", "refresh_token"),
            ("refresh_token", record.refresh_token.as_str()),
        ])
        .send()
        .await
        .map_err(|_| "GitHub-Verlängerung vorübergehend nicht erreichbar.".to_string())?;
    if !response.status().is_success() {
        return Err("GitHub-Verlängerung wurde abgelehnt.".into());
    }
    let rotated: AccessResponse = response
        .json()
        .await
        .map_err(|_| "GitHub-Verlängerung lieferte keine gültige Antwort.".to_string())?;
    if matches!(
        rotated.error.as_deref(),
        Some("bad_refresh_token" | "expired_token" | "access_denied")
    ) {
        // GitHub has revoked/expired the refresh grant. Never pretend the
        // expired access token is live; allow explicit fresh authorization.
        return Ok(Some(record));
    }
    if rotated.error.is_some() || !valid_rotated_token(&rotated) {
        return Err("GitHub-Verlängerung lieferte unerwartete Werte.".into());
    }
    let access = rotated.access_token.as_deref().unwrap_or_default();
    // Confirm the GitHub identity has not silently changed during token rotation.
    let response = network()?
        .get("https://api.github.com/user")
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(access)
        .send()
        .await
        .map_err(|_| "GitHub-Konto nach Verlängerung nicht überprüfbar.".to_string())?;
    if !response.status().is_success() {
        return Err("GitHub-Konto nach Verlängerung ungültig.".into());
    }
    let returned: GhUser = response
        .json()
        .await
        .map_err(|_| "GitHub-Kontoidentität ungültig.".to_string())?;
    if returned.id != record.user_id || returned.login != record.login {
        return Err("GitHub-Kontoidentität bei Verlängerung gewechselt.".into());
    }
    if verified_katosync_user().await? != uid {
        return Err("KatoSync-Konto während GitHub-Verlängerung gewechselt.".into());
    }
    // Check that the credential has not been explicitly revoked/replaced while
    // network I/O was running. Rotation is one-shot; never overwrite new login.
    let current = credentials(uid)?.ok_or("GitHub-Verbindung während Verlängerung entfernt.")?;
    if current.refresh_token != record.refresh_token || !owned_credential(&current, uid) {
        return Err("GitHub-Verbindung während Verlängerung geändert.".into());
    }
    let next = Credential {
        client_id: record.client_id.clone(),
        katosync_uid: uid.to_owned(),
        user_id: record.user_id,
        login: record.login.clone(),
        access_token: rotated
            .access_token
            .as_deref()
            .unwrap_or_default()
            .to_owned(),
        refresh_token: rotated
            .refresh_token
            .as_deref()
            .unwrap_or_default()
            .to_owned(),
        expires_at: now_secs().saturating_add(rotated.expires_in.unwrap_or(0)),
        refresh_expires_at: now_secs()
            .saturating_add(rotated.refresh_token_expires_in.unwrap_or(0)),
    };
    let mut secret_json =
        serde_json::to_string(&next).map_err(|_| "GitHub-Schlüsselbundformat ungültig.")?;
    let saved = entry(uid)?
        .set_password(&secret_json)
        .map_err(|_| "GitHub-Verlängerung konnte nicht sicher gespeichert werden.".to_string());
    secret_json.zeroize();
    saved?;
    Ok(Some(next))
}

fn credentials(uid: &str) -> Result<Option<Credential>, String> {
    let storage = entry(uid)?;
    match storage.get_password() {
        Ok(mut raw) => {
            let parsed = serde_json::from_str::<Credential>(&raw)
                .map_err(|_| "GitHub-Anmeldedaten ungültig. Bitte Verbindung trennen.".to_string());
            raw.zeroize();
            Ok(Some(parsed?))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Schlüsselbund kann nicht gelesen werden.".into()),
    }
}
fn network() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("KatoSync/2.0 (GitHub App device authorization)")
        .build()
        .map_err(|_| "Sicherer GitHub-HTTP-Client nicht verfügbar.".into())
}
fn start_session(resp: DeviceResponse, uid: &str) -> Result<(GithubDeviceBegin, Pending), String> {
    if resp.error.is_some() {
        return Err("GitHub Device Flow nicht verfügbar. GitHub-App-Konfiguration prüfen.".into());
    }
    let device = resp.device_code.ok_or("GitHub Device Code fehlt.")?;
    let code = resp.user_code.ok_or("GitHub Benutzer-Code fehlt.")?;
    if !(20..=100).contains(&device.len())
        || !device
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        || code.len() < 8
        || code.len() > 15
        || !code
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-')
        || resp.verification_uri.as_deref() != Some(VERIFY_URL)
    {
        return Err("GitHub Device-Antwort enthält unerwartete Werte.".into());
    }
    let expires = resp.expires_in.ok_or("GitHub Ablaufzeit fehlt.")?;
    let interval = resp.interval.unwrap_or(5).max(5);
    if !(60..=1800).contains(&expires) || interval > MAX_POLL_INTERVAL {
        return Err("GitHub Device-Zeitangaben ungültig.".into());
    }
    let nonce = uuid::Uuid::new_v4().to_string();
    let pending = Pending {
        nonce: nonce.clone(),
        katosync_uid: uid.to_owned(),
        device_code: device,
        expires: Instant::now() + Duration::from_secs(expires),
        poll_after: Instant::now() + Duration::from_secs(interval),
        interval: Duration::from_secs(interval),
        polling: false,
    };
    Ok((
        GithubDeviceBegin {
            session_id: nonce,
            user_code: code,
            verification_uri: VERIFY_URL,
            expires_in: expires,
            interval,
        },
        pending,
    ))
}
fn safe_login(s: &str) -> bool {
    !s.is_empty() && s.len() <= 39 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
fn retry(state: &'static str, seconds: u64) -> GithubDevicePoll {
    GithubDevicePoll {
        state,
        retry_after_seconds: seconds,
        login: None,
    }
}
#[tauri::command]
pub(crate) async fn github_app_connection_status() -> Result<GithubAppAuthStatus, String> {
    if client_id().is_none() {
        return Ok(status_from(None, None));
    }
    let uid = verified_katosync_user().await?;
    Ok(status_from(
        ensure_fresh_github_credentials(&uid).await?,
        Some(&uid),
    ))
}
#[tauri::command]
pub(crate) async fn github_app_device_begin() -> Result<GithubDeviceBegin, String> {
    let id = client_id()
        .ok_or_else(|| "GitHub App ist noch nicht registriert/konfiguriert.".to_string())?;
    let uid = verified_katosync_user().await?;
    if status_from(ensure_fresh_github_credentials(&uid).await?, Some(&uid)).connected {
        return Err("GitHub ist bereits verbunden. Erst trennen, dann erneut anmelden.".into());
    }
    {
        let mut state = pending()
            .lock()
            .map_err(|_| "Anmeldestatus gesperrt.".to_string())?;
        if state
            .as_ref()
            .is_some_and(|s| s.expires > Instant::now() && s.katosync_uid == uid)
        {
            return Err(
                "Es läuft bereits eine GitHub-Anmeldung. Bitte fortsetzen oder abbrechen.".into(),
            );
        }
        *state = None;
    }
    let response = network()?
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", id), ("scope", "offline_access")])
        .send()
        .await
        .map_err(|_| "GitHub konnte nicht erreicht werden.".to_string())?;
    if !response.status().is_success() {
        return Err("GitHub Device-Anfrage abgelehnt.".into());
    }
    let parsed: DeviceResponse = response
        .json()
        .await
        .map_err(|_| "GitHub Device-Antwort ungültig.".to_string())?;
    let (public, session) = start_session(parsed, &uid)?;
    let mut state = pending()
        .lock()
        .map_err(|_| "Anmeldestatus gesperrt.".to_string())?;
    *state = Some(session);
    Ok(public)
}
#[tauri::command]
pub(crate) async fn github_app_device_cancel() -> Result<(), String> {
    let uid = verified_katosync_user().await?;
    let mut s = pending()
        .lock()
        .map_err(|_| "Anmeldestatus gesperrt.".to_string())?;
    if s.as_ref().is_some_and(|p| p.katosync_uid != uid) {
        return Err("Diese Anmeldung gehört einem anderen KatoSync-Konto.".into());
    }
    *s = None;
    Ok(())
}
pub(crate) fn clear_pending() {
    if let Ok(mut s) = pending().lock() {
        *s = None;
    }
}
#[tauri::command]
pub(crate) async fn github_app_device_poll(session_id: String) -> Result<GithubDevicePoll, String> {
    if session_id.len() != 36
        || !session_id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() || b == b'-')
    {
        return Err("Ungültige Anmeldesitzung.".into());
    }
    let id = client_id().ok_or("GitHub App nicht eingerichtet.")?;
    let uid = verified_katosync_user().await?;
    let code = {
        let mut state = pending()
            .lock()
            .map_err(|_| "Anmeldestatus gesperrt.".to_string())?;
        let session = state.as_mut().ok_or("Keine aktive GitHub-Anmeldung.")?;
        if session.nonce != session_id || session.katosync_uid != uid {
            return Err("Anmeldesitzung wurde ersetzt.".into());
        }
        if Instant::now() >= session.expires {
            *state = None;
            return Ok(retry("expired", 0));
        }
        if session.polling {
            return Ok(retry("pending", 5));
        }
        if Instant::now() < session.poll_after {
            return Ok(retry(
                "pending",
                session
                    .poll_after
                    .saturating_duration_since(Instant::now())
                    .as_secs()
                    + 1,
            ));
        }
        session.polling = true;
        session.poll_after = Instant::now() + session.interval;
        session.device_code.clone()
    };
    let result: Result<AccessResponse, String> = async {
        let response = network()?
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", id),
                ("device_code", &code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|_| "GitHub Token-Abfrage fehlgeschlagen.".to_string())?;
        if !response.status().is_success() {
            return Err("GitHub Token-Anfrage abgelehnt.".into());
        }
        let data: AccessResponse = response
            .json()
            .await
            .map_err(|_| "GitHub Token-Antwort ungültig.".to_string())?;
        Ok(data)
    }
    .await;
    let mut code = code;
    code.zeroize();
    let next_check = {
        let mut state = pending()
            .lock()
            .map_err(|_| "Anmeldestatus gesperrt.".to_string())?;
        let session = state.as_mut().ok_or("GitHub-Anmeldung abgebrochen.")?;
        if session.nonce != session_id || session.katosync_uid != uid {
            return Err("GitHub-Anmeldung wurde ersetzt.".into());
        }
        session.polling = false;
        if let Ok(ref response) = result {
            if response.error.as_deref() == Some("slow_down") {
                let next = response
                    .interval
                    .unwrap_or(session.interval.as_secs() + 5)
                    .max(session.interval.as_secs() + 5)
                    .min(MAX_POLL_INTERVAL);
                session.interval = Duration::from_secs(next);
                session.poll_after = Instant::now() + session.interval;
            }
        }
        session
            .poll_after
            .saturating_duration_since(Instant::now())
            .as_secs()
            + 1
    };
    let response = result?;
    match response.error.as_deref() {
        Some("authorization_pending") => return Ok(retry("pending", next_check)),
        Some("slow_down") => return Ok(retry("slow_down", next_check)),
        Some("expired_token") | Some("access_denied") => {
            clear_pending();
            return Ok(retry("expired_or_denied", 0));
        }
        Some(_) => return Err("GitHub-Autorisierung nicht abgeschlossen.".into()),
        None => {}
    }
    let token = response
        .access_token
        .as_deref()
        .ok_or("GitHub hat keinen Zugangstoken zurückgegeben.")?;
    let refresh = response
        .refresh_token
        .as_deref()
        .ok_or("GitHub hat keinen kurzlebigen Refresh-Token zurückgegeben.")?;
    let access_ttl = response.expires_in.unwrap_or(0);
    let refresh_ttl = response.refresh_token_expires_in.unwrap_or(0);
    if !matches!(response.token_type.as_deref(), Some("bearer"))
        || !(300..=28800).contains(&access_ttl)
        || !(3600..=15897600).contains(&refresh_ttl)
        || token.len() > 1024
        || token.len() < 20
        || refresh.len() > 1024
        || refresh.len() < 20
    {
        return Err("Nur kurzlebige GitHub App Tokens sind erlaubt.".into());
    }
    let identity = network()?
        .get("https://api.github.com/user")
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "GitHub-Kontoidentität nicht überprüfbar.".to_string())?;
    if !identity.status().is_success() {
        return Err("GitHub-Kontoautorisierung ungültig.".into());
    }
    let user: GhUser = identity
        .json()
        .await
        .map_err(|_| "GitHub-Kontoantwort ungültig.".to_string())?;
    if user.id == 0 || !safe_login(&user.login) {
        return Err("GitHub-Kontoidentität ungültig.".into());
    }
    // User may switch KatoSync accounts during GitHub's network roundtrip.
    if verified_katosync_user().await? != uid {
        return Err("KatoSync-Konto während der Anmeldung gewechselt.".into());
    }
    // Store only under the verified tenant's keychain account.
    let mut state = pending()
        .lock()
        .map_err(|_| "Anmeldestatus gesperrt.".to_string())?;
    if !state
        .as_ref()
        .is_some_and(|s| s.nonce == session_id && s.katosync_uid == uid)
    {
        return Err("GitHub-Anmeldung wurde zwischenzeitlich abgebrochen.".into());
    }
    let cred = Credential {
        client_id: id.into(),
        katosync_uid: uid.clone(),
        user_id: user.id,
        login: user.login.clone(),
        access_token: token.to_string(),
        refresh_token: refresh.to_string(),
        expires_at: now_secs().saturating_add(access_ttl),
        refresh_expires_at: now_secs().saturating_add(refresh_ttl),
    };
    let mut payload = serde_json::to_string(&cred)
        .map_err(|_| "GitHub-Schlüsselbunddaten konnten nicht erstellt werden.".to_string())?;
    let storage = entry(&uid)?;
    let saved = storage.set_password(&payload).map_err(|_| {
        "GitHub konnte nicht sicher im Betriebssystem-Schlüsselbund gespeichert werden.".to_string()
    });
    payload.zeroize();
    saved?;
    *state = None;
    Ok(GithubDevicePoll {
        state: "connected",
        retry_after_seconds: 0,
        login: Some(user.login),
    })
}
#[tauri::command]
pub(crate) async fn github_app_disconnect() -> Result<GithubAppAuthStatus, String> {
    let uid = verified_katosync_user().await?;
    clear_pending();
    let item = entry(&uid)?;
    match item.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(_) => {
            return Err("GitHub-Konto konnte nicht aus dem Schlüsselbund entfernt werden.".into())
        }
    }
    Ok(status_from(None, Some(&uid)))
}
/// Called by account-data purge; best-effort local credential removal.
pub(crate) fn purge_local_credentials() {
    clear_pending();
    if let Some(uid) = cached_uid() {
        if let Ok(storage) = entry(&uid) {
            let _ = storage.delete_credential();
        }
    }
    clear_active_user();
}
pub(crate) fn on_katosync_account_switch() {
    clear_pending();
    clear_active_user();
}

#[cfg(test)]
mod tests {
    use super::*;
    fn device() -> DeviceResponse {
        DeviceResponse {
            device_code: Some("x".repeat(40)),
            user_code: Some("ABCD-1234".into()),
            verification_uri: Some(VERIFY_URL.into()),
            expires_in: Some(900),
            interval: Some(5),
            error: None,
        }
    }
    #[test]
    fn only_expired_access_token_401_triggers_one_session_refresh() {
        assert!(should_refresh_katosync_session(
            reqwest::StatusCode::UNAUTHORIZED
        ));
        for status in [
            reqwest::StatusCode::FORBIDDEN,
            reqwest::StatusCode::BAD_REQUEST,
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            reqwest::StatusCode::OK,
        ] {
            assert!(!should_refresh_katosync_session(status));
        }
    }

    #[test]
    fn accepts_real_github_app_client_id_shape_not_numeric_app_id() {
        assert!(valid_client_id("Iv1.ab1112223334445c"));
        assert!(valid_client_id("Iv23.0123456789abcdef"));
        assert!(valid_client_id("Iv23liALq4EnjOcfPVOD"));
        for bad in [
            "12345678",
            "Iv1",
            "Iv1.",
            "Iv1.abc",
            "Iv1.bad/secret",
            "Iv1.bad secret",
            "https://github.com",
            "OAuthClientID",
            "Iv1.abc123.extra",
        ] {
            assert!(
                !valid_client_id(bad),
                "should reject unexpected client id: {bad}"
            );
        }
    }

    #[test]
    fn rejects_forged_verification_site_or_bad_codes() {
        let (public, _session) =
            start_session(device(), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").unwrap();
        assert_eq!(public.verification_uri, VERIFY_URL);
        assert_eq!(public.interval, 5);
        let mut bad = device();
        bad.verification_uri = Some("https://evil.example/verify".into());
        assert!(start_session(bad, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").is_err());
        let mut bad = device();
        bad.user_code = Some("BAD<script>".into());
        assert!(start_session(bad, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").is_err());
        let mut bad = device();
        bad.expires_in = Some(999999);
        assert!(start_session(bad, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").is_err());
    }
    #[test]
    fn device_login_never_becomes_enabled_without_registered_client_id() {
        if client_id().is_none() {
            let state = status_from(None, None);
            assert!(!state.configured);
            assert!(!state.connected);
            assert!(!state.write_access_granted);
            assert!(!state.permissions_checked);
        }
    }
    /// Network smoke for the REAL configured public GitHub App.
    /// Explicitly ignored by default: requires internet; NEVER prints user
    /// or device codes and NEVER exchanges a token or writes to OS keychain.
    #[tokio::test]
    #[ignore = "Manual live GitHub App device-code request; no credentials or user approval"]
    async fn manual_live_github_app_device_flow_preflight() {
        let id = client_id().expect("public GitHub App client ID configured");
        let response = network()
            .unwrap()
            .post("https://github.com/login/device/code")
            .header("Accept", "application/json")
            .form(&[("client_id", id), ("scope", "offline_access")])
            .send()
            .await
            .expect("GitHub device endpoint reachable");
        assert!(
            response.status().is_success(),
            "GitHub App Device Flow must be enabled"
        );
        let raw: DeviceResponse = response.json().await.expect("valid JSON");
        let (start, _secret_session) = start_session(raw, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
            .expect("provider response must match native parser");
        assert_eq!(start.verification_uri, "https://github.com/login/device");
        assert!((60..=1800).contains(&start.expires_in));
        assert!(start.interval >= 5);
    }

    #[cfg(feature = "github-login-qa")]
    #[test]
    fn github_qa_does_not_share_production_keychain_or_data_directory() {
        assert_eq!(
            KEYCHAIN_SERVICE,
            if cfg!(feature = "katoos-auth-qa") {
                "com.nmkato.katosync.katoos.auth.qa"
            } else {
                "com.nmkato.katosync.github.login.qa"
            }
        );
        assert_eq!(KEYCHAIN_SERVICE, crate::KEYCHAIN_SERVICE);
        assert_ne!(KEYCHAIN_SERVICE, "com.nmkato.katosync");
        assert_ne!(crate::LAUNCH_AGENT_ID, "com.nmkato.katosync.sync");
        let qa = crate::app_support_dir().expect("isolated QA data folder");
        assert_eq!(
            qa.file_name().unwrap().to_str(),
            Some(if cfg!(feature = "katoos-auth-qa") {
                "KatoSync KATOOS Auth QA"
            } else {
                "KatoSync GitHub Login QA"
            })
        );
    }

    #[test]
    fn github_credentials_cannot_cross_katosync_tenants() {
        let a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        assert!(entry(a).is_ok());
        assert!(entry(b).is_ok());
        assert!(entry("owner@example.com").is_err());
        let record = Credential {
            client_id: client_id().unwrap().into(),
            katosync_uid: a.into(),
            user_id: 123,
            login: "test-owner".into(),
            access_token: "fake-test-token".into(),
            refresh_token: "fake-test-refresh".into(),
            expires_at: now_secs() + 300,
            refresh_expires_at: now_secs() + 3600,
        };
        assert!(status_from(Some(record), Some(b)).login.is_none());
    }
    #[test]
    fn automatic_refresh_preserves_identity_and_validates_rotating_expiry() {
        let uid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let record = Credential {
            client_id: client_id().unwrap().into(),
            katosync_uid: uid.into(),
            user_id: 1,
            login: "test-user".into(),
            access_token: "fake-access-test-only".into(),
            refresh_token: "fake-refresh-test-only".into(),
            expires_at: now_secs() + 40,
            refresh_expires_at: now_secs() + 86400,
        };
        assert!(owned_credential(&record, uid));
        assert!(refresh_needed(&record, now_secs()));
        assert!(!owned_credential(
            &record,
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        ));
        let answer = AccessResponse {
            access_token: Some("a".repeat(44)),
            refresh_token: Some("b".repeat(44)),
            expires_in: Some(28800),
            refresh_token_expires_in: Some(15897600),
            token_type: Some("bearer".into()),
            error: None,
            interval: None,
        };
        assert!(valid_rotated_token(&answer));
        let mut bad = answer;
        bad.error = Some("bad_refresh_token".into());
        assert!(!bad.error.is_none());
    }

    #[test]
    fn only_valid_short_lived_credentials_count_as_connected() {
        let record = Credential {
            client_id: "dummy".into(),
            katosync_uid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".into(),
            user_id: 1,
            login: "Example-user".into(),
            access_token: "fake-key-not-for-api".into(),
            refresh_token: "fake-refresh-not-for-api".into(),
            expires_at: now_secs() + 120,
            refresh_expires_at: now_secs() + 300,
        };
        assert!(
            !status_from(Some(record), Some("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).connected,
            "unknown client ID cannot elevate credentials"
        );
        assert!(!safe_login("fake/owner"));
        assert!(safe_login("safe-user"));
    }
}

// Read-only App inventory; credentials never leave this backend module.
#[path = "github_app_inventory.rs"]
pub(crate) mod inventory;
