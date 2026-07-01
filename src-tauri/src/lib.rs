use anyhow::{anyhow, Context, Result};
use chrono::Local;
use keyring::Entry;
use regex::Regex;
use reqwest::multipart::{Form, Part};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::BTreeSet,
    env,
    ffi::OsStr,
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio::time::{sleep, timeout};
use uuid::Uuid;
use walkdir::{DirEntry, WalkDir};

// Immer aus Cargo.toml ableiten -> kein Drift mehr (war faelschlich hartkodiert "1.0.1").
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const KEYCHAIN_SERVICE: &str = "com.nmkato.katosync";
const KEYCHAIN_ACCOUNT: &str = "mistral-api-key";
const MCP_CONNECTOR_ACCOUNT: &str = "mcp-connector-token";
const SUPABASE_SESSION_ACCOUNT: &str = "supabase-refresh-token";
const USER_AGENT: &str = "KatoSync/1.0.1";
const LAUNCH_AGENT_ID: &str = "com.nmkato.katosync.sync";
// KatoSync-eigenes Supabase-Projekt (oeffentlicher Anon-Key, bewusst client-seitig). Getrennt von KatoOS.
const KATOSYNC_AUTH_URL: &str = "https://wspcuiylctlrvvpnwufk.supabase.co";
const KATOSYNC_AUTH_ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzcGN1aXlsY3RscnZ2cG53dWZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNzMwODMsImV4cCI6MjA5Nzk0OTA4M30.HJu_FxIFWoFDooVLE9TVOD10dgxJwLcpFZrUKK2_bv4";
static API_KEY_CACHE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static MCP_CONNECTOR_TOKEN_CACHE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static SUPABASE_ACCESS_TOKEN_CACHE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
// Cloud-Profil (Zero-Knowledge): der aus dem Passwort abgeleitete 32-Byte-Schluessel + das zugehoerige
// kdf_salt liegen NUR im RAM (nie auf Platte/Keychain) und nur fuer die laufende Sitzung. Wird beim Login
// gesetzt und beim Logout geraeumt. Ohne ihn kann das Cloud-Profil weder ent- noch verschluesselt werden.
static CLOUD_PROFILE_KEY: OnceLock<Mutex<Option<CloudKeyMaterial>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    app_version: String,
    #[serde(default = "default_device_config")]
    device: DeviceConfig,
    library_id: String,
    #[serde(default = "default_mcp_config")]
    mcp: McpConfig,
    source_roots: Vec<String>,
    output_dir: String,
    schedule: ScheduleConfig,
    scan_rules: ScanRules,
    safety: SafetyConfig,
    // Codex-Bridge v2: nach erfolgreichem Lauf den Branch pushen bzw. einen PR erstellen.
    #[serde(default = "default_true")]
    codex_auto_push: bool,
    #[serde(default = "default_true")]
    codex_create_pr: bool,
    // Coding-Modus: an = Ergebnis nach GitHub (Branch/Push/PR), aus = Datei-Modus (lokal im
    // Ergebnis-Ordner, Git unsichtbar im Hintergrund). Standard: aus (Datei-Modus).
    #[serde(default)]
    codex_coding_mode: bool,
    // Multi-Runner: bevorzugter lokaler Runner ("codex_cli" Default | "claude_cli").
    #[serde(default)]
    codex_preferred_runner: String,
    // KatoContext: lokaler Referenzordner (Lebenslauf/Zeugnisse/Kontext). Wird im Datei-Modus vor
    // dem Lauf nach <repo>/KatoContext/ materialisiert; bleibt lokal (nie in Mistral-Library).
    #[serde(default)]
    reference_root: String,
    // Codex-Bridge: gemerkter lokaler Repo-Ordner pro Projekt (projectExternalId -> Pfad).
    #[serde(default)]
    project_repos: std::collections::HashMap<String, String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConfig {
    device_id: String,
    device_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleConfig {
    enabled: bool,
    hour: u8,
    minute: u8,
    weekdays: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRules {
    include_memory: bool,
    include_roadmaps: bool,
    include_tasks: bool,
    include_csv: bool,
    #[serde(default)]
    include_documents: bool,
    // Alte Mistral-Dokumentversionen vor dem Upload loeschen. Default AUS (spart Requests gegen
    // das 429-Rate-Limit; an = saubere Library ohne Dubletten, aber mehr Requests pro Datei).
    #[serde(default)]
    dedupe_uploads: bool,
    max_file_size_mb: u64,
    upload_individual_status_files: bool,
    max_individual_uploads: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafetyConfig {
    dry_run_default: bool,
    cleanup_enabled: bool,
    secret_scan_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFinding {
    path: String,
    relative_path: String,
    category: String,
    size_bytes: u64,
    modified_at: String,
    skipped: bool,
    reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    scanned_files: usize,
    relevant_files: usize,
    skipped_files: usize,
    secret_warnings: usize,
    findings: Vec<FileFinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    file_name: String,
    document_id: Option<String>,
    processing_status: Option<String>,
    rate_limits: Vec<RateLimitMetric>,
    success: bool,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitMetric {
    label: String,
    limit: Option<String>,
    remaining: Option<String>,
    reset: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCheckResponse {
    message: String,
    rate_limits: Vec<RateLimitMetric>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    started_at: String,
    finished_at: String,
    output_dir: String,
    snapshot_dir: String,
    dry_run: bool,
    scan: ScanSummary,
    current_files: Vec<String>,
    uploaded: Vec<UploadResult>,
    warnings: Vec<String>,
    errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    exists: bool,
    masked: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchAgentStatus {
    installed: bool,
    loaded: bool,
    plist_path: String,
    message: String,
}

pub fn run() {
    if env::args().any(|arg| arg == "--run-sync") {
        let result = tokio::runtime::Runtime::new()
            .expect("Tokio runtime konnte nicht gestartet werden")
            .block_on(run_headless_sync());
        if let Err(error) = result {
            let _ = write_log("error", &format!("Headless-Sync fehlgeschlagen: {error:#}"));
            std::process::exit(1);
        }
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window
                    .dialog()
                    .message(
                        "KatoSync wird nur ausgeblendet und läuft im Hintergrund weiter. Automatische Uploads bleiben aktiv. Zum vollständigen Beenden nutze bitte den Button „Programm beenden“.",
                    )
                    .title("KatoSync läuft weiter")
                    .kind(MessageDialogKind::Info)
                    .blocking_show();
                let _ = window.hide();
                let _ = write_log(
                    "sync",
                    "Fenster geschlossen: KatoSync läuft im Hintergrund weiter.",
                );
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            save_api_key,
            api_key_status,
            delete_api_key,
            save_mcp_connector_token,
            mcp_connector_token_status,
            delete_mcp_connector_token,
            load_remote_action_plans,
            update_remote_action_plan_status,
            update_remote_action_task_status,
            load_remote_briefings,
            update_remote_briefing_status,
            archive_remote_briefing,
            delete_remote_briefing,
            login_supabase,
            signup_supabase,
            recover_supabase,
            supabase_session_status,
            logout_supabase,
            mint_connector_token,
            cloud_profile_sync_after_login,
            cloud_profile_push,
            cloud_profile_unlock_and_push,
            cloud_profile_key_present,
            cloud_profile_logout,
            run_codex_task,
            dir_exists,
            check_codex_task,
            test_mistral_connection,
            test_library,
            scan_project,
            run_sync,
            install_launch_agent,
            remove_launch_agent,
            launch_agent_status,
            read_logs,
            open_output_dir,
            quit_app
        ])
        .setup(|app| {
            let _ = app.path().app_data_dir().map(fs::create_dir_all);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Fehler beim Build von KatoSync")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = event {
                reopen_main_window(app_handle);
            }
        });
}

fn reopen_main_window(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = write_log("sync", "Fenster per Dock-Klick wieder geoeffnet.");
    }
}

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
    load_config_inner().map_err(error_to_string)
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<AppConfig, String> {
    save_config_inner(&config).map_err(error_to_string)?;
    Ok(config)
}

#[tauri::command]
async fn save_api_key(api_key: String) -> Result<KeyStatus, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("API-Key darf nicht leer sein.".to_string());
    }
    keychain_entry()
        .map_err(error_to_string)?
        .set_password(key)
        .map_err(error_to_string)?;
    cache_api_key(Some(key.to_string()));
    write_api_key_marker().map_err(error_to_string)?;
    Ok(KeyStatus {
        exists: true,
        masked: Some(mask_key(key)),
    })
}

#[tauri::command]
fn api_key_status() -> Result<KeyStatus, String> {
    if let Some(key) = cached_api_key() {
        return Ok(KeyStatus {
            exists: true,
            masked: Some(mask_key(&key)),
        });
    }
    Ok(KeyStatus {
        exists: api_key_marker_exists().map_err(error_to_string)?,
        masked: None,
    })
}

#[tauri::command]
fn delete_api_key() -> Result<KeyStatus, String> {
    let entry = keychain_entry().map_err(error_to_string)?;
    let _ = entry.delete_credential();
    cache_api_key(None);
    let _ = remove_api_key_marker();
    Ok(KeyStatus {
        exists: false,
        masked: None,
    })
}

#[tauri::command]
async fn save_mcp_connector_token(token: String) -> Result<KeyStatus, String> {
    let connector_token = token.trim();
    if connector_token.is_empty() {
        return Err("MCP Connector Token darf nicht leer sein.".to_string());
    }
    mcp_connector_keychain_entry()
        .map_err(error_to_string)?
        .set_password(connector_token)
        .map_err(error_to_string)?;
    cache_mcp_connector_token(Some(connector_token.to_string()));
    write_mcp_connector_token_marker().map_err(error_to_string)?;
    Ok(KeyStatus {
        exists: true,
        masked: Some(mask_key(connector_token)),
    })
}

#[tauri::command]
fn mcp_connector_token_status() -> Result<KeyStatus, String> {
    if let Some(token) = cached_mcp_connector_token() {
        return Ok(KeyStatus {
            exists: true,
            masked: Some(mask_key(&token)),
        });
    }
    Ok(KeyStatus {
        exists: mcp_connector_token_marker_exists().map_err(error_to_string)?,
        masked: None,
    })
}

#[tauri::command]
fn delete_mcp_connector_token() -> Result<KeyStatus, String> {
    let entry = mcp_connector_keychain_entry().map_err(error_to_string)?;
    let _ = entry.delete_credential();
    cache_mcp_connector_token(None);
    let _ = remove_mcp_connector_token_marker();
    Ok(KeyStatus {
        exists: false,
        masked: None,
    })
}

#[tauri::command]
async fn login_supabase(email: String, password: String) -> Result<SupabaseSessionStatus, String> {
    let email_trim = email.trim();
    if email_trim.is_empty() || password.trim().is_empty() {
        return Err("E-Mail und Passwort dürfen nicht leer sein.".to_string());
    }
    let session = supabase_password_login(email_trim, &password)
        .await
        .map_err(error_to_string)?;
    save_supabase_refresh_token(&session.refresh_token).map_err(error_to_string)?;
    cache_supabase_access_token(Some(session.access_token.clone()));
    let user_email = session
        .user
        .and_then(|user| user.email)
        .unwrap_or_else(|| email_trim.to_string());
    write_supabase_session_email(&user_email).map_err(error_to_string)?;
    Ok(SupabaseSessionStatus {
        logged_in: true,
        email: Some(user_email),
    })
}

#[tauri::command]
async fn recover_supabase(email: String) -> Result<(), String> {
    let email_trim = email.trim();
    if email_trim.is_empty() {
        return Err("Bitte E-Mail-Adresse eingeben.".to_string());
    }
    supabase_recover(email_trim).await.map_err(error_to_string)
}

#[tauri::command]
async fn signup_supabase(email: String, password: String) -> Result<SupabaseSessionStatus, String> {
    let email_trim = email.trim();
    if email_trim.is_empty() || password.trim().len() < 6 {
        return Err("Bitte E-Mail und ein Passwort mit mindestens 6 Zeichen angeben.".to_string());
    }
    let result = supabase_signup(email_trim, &password)
        .await
        .map_err(error_to_string)?;
    let resolved_email = result
        .user
        .and_then(|user| user.email)
        .or(result.email)
        .unwrap_or_else(|| email_trim.to_string());

    if let (Some(access), Some(refresh)) = (result.access_token, result.refresh_token) {
        // Projekt ohne E-Mail-Bestaetigung: direkt angemeldet.
        save_supabase_refresh_token(&refresh).map_err(error_to_string)?;
        cache_supabase_access_token(Some(access));
        write_supabase_session_email(&resolved_email).map_err(error_to_string)?;
        Ok(SupabaseSessionStatus {
            logged_in: true,
            email: Some(resolved_email),
        })
    } else {
        // E-Mail-Bestaetigung noetig: noch nicht eingeloggt.
        Ok(SupabaseSessionStatus {
            logged_in: false,
            email: Some(resolved_email),
        })
    }
}

#[tauri::command]
fn supabase_session_status() -> Result<SupabaseSessionStatus, String> {
    let email = read_supabase_session_email();
    Ok(SupabaseSessionStatus {
        logged_in: email.is_some(),
        email,
    })
}

#[tauri::command]
fn logout_supabase() -> Result<SupabaseSessionStatus, String> {
    if let Ok(entry) = supabase_session_keychain_entry() {
        let _ = entry.delete_credential();
    }
    cache_supabase_access_token(None);
    let _ = remove_supabase_session_email();
    Ok(SupabaseSessionStatus {
        logged_in: false,
        email: None,
    })
}

#[tauri::command]
async fn mint_connector_token(base_url: String) -> Result<serde_json::Value, String> {
    let access_token = ensure_supabase_access_token().await.map_err(error_to_string)?;
    let url = format!("{}/api/me/connector", normalize_base_url(&base_url));
    let response = reqwest::Client::new()
        .post(url)
        .header("User-Agent", USER_AGENT)
        .bearer_auth(access_token.trim())
        .json(&json!({}))
        .send()
        .await
        .map_err(error_to_string)?;

    let status = response.status();
    let text = response.text().await.map_err(error_to_string)?;
    if !status.is_success() {
        return Err(format!("Token-Generierung fehlgeschlagen ({status}): {text}"));
    }
    serde_json::from_str(&text).map_err(error_to_string)
}

// ============================================================================
// Cloud-Profil (Zero-Knowledge): Zugangsdaten folgen dem KatoOS-Konto.
//
// Beim Login wird aus Passwort + kdf_salt via Argon2id ein 32-Byte-Schluessel abgeleitet
// (nur im RAM, siehe CLOUD_PROFILE_KEY). Damit wird EIN Blob {apiKey, connectorToken} per
// AES-256-GCM ent-/verschluesselt. Der Server (/api/me/settings) speichert nur den opaken
// Cipher + Nonce + Salt + die nicht-geheime library_id und kann NICHTS entschluesseln.
// Geraete-Pfade (Quellordner/Zeitplan/Referenzordner) werden bewusst NICHT gesynct.
// ============================================================================

#[derive(Clone)]
struct CloudKeyMaterial {
    key: [u8; 32],
    salt_b64: String,
}

// Schluesselbytes beim Wegwerfen NULLEN (auch fuer Klone + set_cloud_key(None) beim Logout) ->
// der AES-Schluessel bleibt nicht als Klartext im RAM/Swap zurueck.
impl Drop for CloudKeyMaterial {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.key.zeroize();
    }
}

fn cloud_profile_key_store() -> &'static Mutex<Option<CloudKeyMaterial>> {
    CLOUD_PROFILE_KEY.get_or_init(|| Mutex::new(None))
}

fn cached_cloud_key() -> Option<CloudKeyMaterial> {
    cloud_profile_key_store()
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

fn set_cloud_key(value: Option<CloudKeyMaterial>) {
    if let Ok(mut guard) = cloud_profile_key_store().lock() {
        *guard = value;
    }
}

fn b64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn b64_decode(value: &str) -> Result<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|e| anyhow!("Base64-Dekodierung fehlgeschlagen: {e}"))
}

fn random_bytes<const N: usize>() -> [u8; N] {
    use rand::RngCore;
    let mut buf = [0u8; N];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    buf
}

// Argon2id -> 32-Byte-Schluessel. Parameter (m=19 MiB, t=2, p=1) EXPLIZIT gepinnt, NICHT der
// Crate-Default: ein spaeteres argon2-Update koennte Params::default() aendern und damit bei
// identischem Passwort+Salt einen anderen Schluessel liefern -> alle bestehenden Profile waeren
// still unlesbar. Diese Pinnung haelt die Ableitung versionsstabil.
fn derive_cloud_key(password: &str, salt: &[u8]) -> Result<[u8; 32]> {
    use argon2::{Algorithm, Argon2, Params, Version};
    let params = Params::new(19_456, 2, 1, Some(32))
        .map_err(|e| anyhow!("Argon2-Parameter ungültig: {e}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| anyhow!("Schlüsselableitung fehlgeschlagen: {e}"))?;
    Ok(out)
}

fn encrypt_cloud_blob(key: &[u8; 32], plaintext: &[u8]) -> Result<(String, String)> {
    use aes_gcm::aead::Aead;
    use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| anyhow!("AES-Schlüssel ungültig: {e}"))?;
    let nonce_bytes = random_bytes::<12>();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| anyhow!("Verschlüsselung fehlgeschlagen."))?;
    Ok((b64_encode(&ciphertext), b64_encode(&nonce_bytes)))
}

fn decrypt_cloud_blob(key: &[u8; 32], cipher_b64: &str, nonce_b64: &str) -> Result<Vec<u8>> {
    use aes_gcm::aead::Aead;
    use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
    let ciphertext = b64_decode(cipher_b64)?;
    let nonce_bytes = b64_decode(nonce_b64)?;
    if nonce_bytes.len() != 12 {
        return Err(anyhow!("Cloud-Profil beschädigt (Nonce-Länge)."));
    }
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| anyhow!("AES-Schlüssel ungültig: {e}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    cipher.decrypt(nonce, ciphertext.as_ref()).map_err(|_| {
        anyhow!("Entschlüsselung fehlgeschlagen (falsches Passwort oder beschädigtes Profil).")
    })
}

// Klartext-Blob, der verschluesselt in der Cloud liegt.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudSecretBlob {
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    connector_token: String,
}

// Antwort von GET /api/me/settings (Feld `settings`, sonst null).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteUserSettings {
    #[serde(default)]
    library_id: Option<String>,
    #[serde(default)]
    secret_cipher: Option<String>,
    #[serde(default)]
    secret_nonce: Option<String>,
    #[serde(default)]
    kdf_salt: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UserSettingsEnvelope {
    #[serde(default)]
    settings: Option<RemoteUserSettings>,
}

async fn fetch_user_settings(base_url: &str) -> Result<Option<RemoteUserSettings>> {
    let access_token = ensure_supabase_access_token().await?;
    let url = format!("{}/api/me/settings", normalize_base_url(base_url));
    let response = reqwest::Client::new()
        .get(url)
        .header("User-Agent", USER_AGENT)
        .bearer_auth(access_token.trim())
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(anyhow!("Cloud-Profil nicht erreichbar ({status}): {text}"));
    }
    let envelope: UserSettingsEnvelope = serde_json::from_str(&text)?;
    Ok(envelope.settings)
}

async fn put_user_settings(
    base_url: &str,
    library_id: &str,
    cipher_b64: &str,
    nonce_b64: &str,
    salt_b64: &str,
) -> Result<()> {
    let access_token = ensure_supabase_access_token().await?;
    let url = format!("{}/api/me/settings", normalize_base_url(base_url));
    let response = reqwest::Client::new()
        .put(url)
        .header("User-Agent", USER_AGENT)
        .bearer_auth(access_token.trim())
        .json(&json!({
            "libraryId": library_id,
            "secretCipher": cipher_b64,
            "secretNonce": nonce_b64,
            "kdfSalt": salt_b64,
        }))
        .send()
        .await?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "Cloud-Profil speichern fehlgeschlagen ({status}): {text}"
        ));
    }
    Ok(())
}

// Aktuelle lokale Zugangsdaten einsammeln (leer = nicht gesetzt).
fn collect_local_secrets() -> (String, String, String) {
    let api_key = load_api_key().unwrap_or_default();
    let connector_token = load_mcp_connector_token().unwrap_or_default();
    let library_id = load_config_inner().map(|c| c.library_id).unwrap_or_default();
    (api_key, connector_token, library_id)
}

// Lokale Zugangsdaten mit dem RAM-Schluessel verschluesseln und in die Cloud schreiben.
async fn push_local_secrets_to_cloud(base_url: &str, material: &CloudKeyMaterial) -> Result<()> {
    let (api_key, connector_token, library_id) = collect_local_secrets();
    let blob = CloudSecretBlob {
        api_key,
        connector_token,
    };
    let mut plaintext = serde_json::to_vec(&blob)?;
    let (cipher_b64, nonce_b64) = encrypt_cloud_blob(&material.key, &plaintext)?;
    {
        use zeroize::Zeroize;
        plaintext.zeroize(); // Klartext-Geheimnisse nicht im RAM zuruecklassen
    }
    put_user_settings(
        base_url,
        &library_id,
        &cipher_b64,
        &nonce_b64,
        &material.salt_b64,
    )
    .await
}

// Entschluesselte Zugangsdaten lokal anwenden (Keychain + Config) -> "auf neuem Geraet alles wieder da".
fn apply_cloud_secrets(blob: &CloudSecretBlob, library_id: &str) -> Result<()> {
    let api_key = blob.api_key.trim();
    if !api_key.is_empty() {
        keychain_entry()?.set_password(api_key)?;
        cache_api_key(Some(api_key.to_string()));
        let _ = write_api_key_marker();
    }
    let connector_token = blob.connector_token.trim();
    if !connector_token.is_empty() {
        mcp_connector_keychain_entry()?.set_password(connector_token)?;
        cache_mcp_connector_token(Some(connector_token.to_string()));
        let _ = write_mcp_connector_token_marker();
    }
    let library = library_id.trim();
    if !library.is_empty() {
        let mut config = load_config_inner()?;
        config.library_id = library.to_string();
        save_config_inner(&config)?;
    }
    Ok(())
}

// Versucht ein vorhandenes Cloud-Profil mit dem Passwort zu entschluesseln. Liefert (Schluessel, Blob)
// NUR bei Erfolg; JEDER Fehler (kaputtes/zu kurzes Salt, Ableitungsfehler, falsches Passwort, Parse-
// Fehler) -> None, damit Aufrufer sauber selbstheilen statt hart abzubrechen.
fn try_unlock_profile(
    password: &str,
    salt_b64: &str,
    cipher_b64: &str,
    nonce_b64: &str,
) -> Option<([u8; 32], CloudSecretBlob)> {
    let salt = b64_decode(salt_b64).ok()?;
    if salt.len() < 8 {
        return None;
    }
    let key = derive_cloud_key(password, &salt).ok()?;
    let plaintext = decrypt_cloud_blob(&key, cipher_b64, nonce_b64).ok()?;
    let blob: CloudSecretBlob = serde_json::from_slice(&plaintext).ok()?;
    Some((key, blob))
}

// Ist das gespeicherte Salt grundsaetzlich brauchbar (dekodierbar + lang genug)? Unterscheidet ein
// echtes Profil (falsches Passwort -> NICHT ueberschreiben) von einem korrupten (frisch anlegen ok).
fn profile_salt_usable(salt_b64: &str) -> bool {
    b64_decode(salt_b64).map(|s| s.len() >= 8).unwrap_or(false)
}

// Passwort gegen das KatoOS-Konto verifizieren (GoTrue-Re-Login). Genutzt, wenn KEIN entschluesselbares
// Profil zum Gegenpruefen existiert -> verhindert, dass ein falsch getipptes Passwort ein Cloud-Profil
// unter falschem Schluessel anlegt (sonst waere der spaetere Login mit dem RICHTIGEN Passwort dauerhaft
// "unreadable" und die Zugangsdaten verloren).
async fn verify_account_password(password: &str) -> Result<()> {
    let email =
        read_supabase_session_email().ok_or_else(|| anyhow!("Keine aktive Sitzung gefunden."))?;
    supabase_password_login(&email, password)
        .await
        .map_err(|_| anyhow!("Falsches Passwort (oder Server nicht erreichbar)."))?;
    Ok(())
}

// Frisches Schluesselmaterial -- ABER nur nach erfolgreicher Konto-Verifikation des Passworts.
async fn verified_fresh_material(password: &str) -> Result<CloudKeyMaterial> {
    verify_account_password(password).await?;
    let new_salt = random_bytes::<16>();
    let new_salt_b64 = b64_encode(&new_salt);
    let key = derive_cloud_key(password, &new_salt)?;
    Ok(CloudKeyMaterial {
        key,
        salt_b64: new_salt_b64,
    })
}

// Schluessel aus dem Passwort ableiten (gegen das vorhandene Profil ODER das Konto verifizieren) und
// dann pushen. Schuetzt davor, das Cloud-Profil mit einem falschen Passwort zu ueberschreiben/anzulegen.
async fn cloud_profile_unlock_and_push_inner(base_url: &str, password: &str) -> Result<()> {
    if password.trim().is_empty() {
        return Err(anyhow!("Bitte Passwort eingeben."));
    }
    let settings = fetch_user_settings(base_url).await?;
    let has_profile = settings.as_ref().map_or(false, |s| {
        s.secret_cipher
            .as_deref()
            .map_or(false, |c| !c.trim().is_empty())
    });
    let material = if has_profile {
        let s = settings.unwrap();
        let salt_b64 = s.kdf_salt.clone().unwrap_or_default();
        let cipher = s.secret_cipher.clone().unwrap_or_default();
        let nonce = s.secret_nonce.clone().unwrap_or_default();
        if profile_salt_usable(&salt_b64) {
            // Echtes Profil -> Passwort MUSS es entschluesseln koennen, sonst NICHT ueberschreiben.
            match try_unlock_profile(password, &salt_b64, &cipher, &nonce) {
                Some((key, _)) => CloudKeyMaterial { key, salt_b64 },
                None => return Err(anyhow!("Falsches Passwort.")),
            }
        } else {
            // Korruptes/unbrauchbares Salt -> frisch, aber Passwort gegen das Konto verifizieren.
            verified_fresh_material(password).await?
        }
    } else {
        // Kein Profil zum Gegenpruefen -> Passwort gegen das Konto verifizieren, bevor wir es anlegen.
        verified_fresh_material(password).await?
    };
    push_local_secrets_to_cloud(base_url, &material).await?;
    set_cloud_key(Some(material));
    Ok(())
}

// Tenant-Isolierung: alle konto-/tenant-bezogenen lokalen Daten loeschen. Geraete-Identitaet
// (device_id/name), Server-URL und reine App-Praeferenzen (Scan-Regeln/Codex) bleiben erhalten.
fn wipe_local_account_data() -> Result<()> {
    // 1) Zugangsdaten aus der Keychain.
    if let Ok(entry) = keychain_entry() {
        let _ = entry.delete_credential();
    }
    cache_api_key(None);
    let _ = remove_api_key_marker();
    if let Ok(entry) = mcp_connector_keychain_entry() {
        let _ = entry.delete_credential();
    }
    cache_mcp_connector_token(None);
    let _ = remove_mcp_connector_token_marker();

    // 2) Tenant-/geraetebezogene Config-Felder zuruecksetzen (nichts vom vorigen Tenant bleibt).
    if let Ok(mut config) = load_config_inner() {
        config.library_id = String::new();
        config.source_roots = Vec::new();
        config.reference_root = String::new();
        config.project_repos = std::collections::HashMap::new();
        config.schedule.enabled = false;
        let _ = save_config_inner(&config);
    }

    // 3) Cloud-Schluessel + Supabase-Session.
    set_cloud_key(None);
    if let Ok(entry) = supabase_session_keychain_entry() {
        let _ = entry.delete_credential();
    }
    cache_supabase_access_token(None);
    let _ = remove_supabase_session_email();
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudProfileSyncResult {
    // "restored"   = Profil vorhanden + entschluesselt + lokal angewandt
    // "created"    = kein Profil -> aus vorhandenen lokalen Daten neu angelegt
    // "empty"      = kein Profil + keine lokalen Daten -> Schluessel bereit, noch nichts zu sichern
    // "unreadable" = Profil vorhanden, aber nicht entschluesselbar (Passwort-Reset) -> API-Key neu eingeben
    status: String,
    library_id: Option<String>,
}

// Beim Login (Passwort liegt vor): Cloud-Profil holen + entschluesseln + lokal anwenden, ODER neu anlegen.
#[tauri::command]
async fn cloud_profile_sync_after_login(
    base_url: String,
    password: String,
) -> Result<CloudProfileSyncResult, String> {
    if password.trim().is_empty() {
        return Err("Passwort fehlt für die Cloud-Profil-Synchronisierung.".to_string());
    }
    let settings = fetch_user_settings(&base_url).await.map_err(error_to_string)?;
    let has_profile = settings.as_ref().map_or(false, |s| {
        s.secret_cipher
            .as_deref()
            .map_or(false, |c| !c.trim().is_empty())
    });

    if has_profile {
        let s = settings.unwrap();
        let salt_b64 = s.kdf_salt.clone().unwrap_or_default();
        let cipher = s.secret_cipher.clone().unwrap_or_default();
        let nonce = s.secret_nonce.clone().unwrap_or_default();
        // Erfolgreich entschluesselt -> lokal anwenden. JEDER Fehler (falsches Passwort nach Reset,
        // kaputtes/zu kurzes Salt) faellt sauber in den Selbstheilungs-Zweig statt hart abzubrechen.
        if let Some((key, blob)) = try_unlock_profile(&password, &salt_b64, &cipher, &nonce) {
            let library_id = s.library_id.clone().unwrap_or_default();
            apply_cloud_secrets(&blob, &library_id).map_err(error_to_string)?;
            set_cloud_key(Some(CloudKeyMaterial { key, salt_b64 }));
            return Ok(CloudProfileSyncResult {
                status: "restored".to_string(),
                library_id: Some(library_id),
            });
        }
        // Nicht entschluesselbar: mit neuem Salt neu schluesseln, damit das naechste Speichern ein
        // frisches Profil unter dem aktuellen Passwort anlegt (API-Key einmal neu eingeben).
        let new_salt = random_bytes::<16>();
        let new_salt_b64 = b64_encode(&new_salt);
        let new_key = derive_cloud_key(&password, &new_salt).map_err(error_to_string)?;
        set_cloud_key(Some(CloudKeyMaterial {
            key: new_key,
            salt_b64: new_salt_b64,
        }));
        return Ok(CloudProfileSyncResult {
            status: "unreadable".to_string(),
            library_id: None,
        });
    }

    // Kein nutzbares Profil -> neues Salt + Schluessel; vorhandene lokale Daten sofort sichern.
    let new_salt = random_bytes::<16>();
    let new_salt_b64 = b64_encode(&new_salt);
    let new_key = derive_cloud_key(&password, &new_salt).map_err(error_to_string)?;
    let material = CloudKeyMaterial {
        key: new_key,
        salt_b64: new_salt_b64,
    };
    let (api_key, connector_token, _) = collect_local_secrets();
    let has_local = !api_key.trim().is_empty() || !connector_token.trim().is_empty();
    if has_local {
        push_local_secrets_to_cloud(&base_url, &material)
            .await
            .map_err(error_to_string)?;
    }
    set_cloud_key(Some(material));
    Ok(CloudProfileSyncResult {
        status: if has_local { "created" } else { "empty" }.to_string(),
        library_id: None,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudProfilePushResult {
    pushed: bool,
    needs_password: bool,
}

// Nach einer Zugangsdaten-Aenderung den aktuellen Stand sichern. Schluessel im RAM -> still pushen.
// Sonst -> needs_password (die UI fragt einmalig nach). Ohne Sitzung: stillschweigend nichts tun.
#[tauri::command]
async fn cloud_profile_push(base_url: String) -> Result<CloudProfilePushResult, String> {
    if load_supabase_refresh_token().is_err() {
        return Ok(CloudProfilePushResult {
            pushed: false,
            needs_password: false,
        });
    }
    match cached_cloud_key() {
        Some(material) => {
            push_local_secrets_to_cloud(&base_url, &material)
                .await
                .map_err(error_to_string)?;
            Ok(CloudProfilePushResult {
                pushed: true,
                needs_password: false,
            })
        }
        None => Ok(CloudProfilePushResult {
            pushed: false,
            needs_password: true,
        }),
    }
}

// Einmalige Passwort-Abfrage (still-wieder-eingeloggte Sitzung): Schluessel ableiten + pushen.
#[tauri::command]
async fn cloud_profile_unlock_and_push(base_url: String, password: String) -> Result<(), String> {
    cloud_profile_unlock_and_push_inner(&base_url, &password)
        .await
        .map_err(error_to_string)
}

#[tauri::command]
fn cloud_profile_key_present() -> bool {
    cached_cloud_key().is_some()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudProfileLogoutResult {
    // "logged_out" = gesichert + geraeumt; "needs_password" = Schluessel fehlt, Passwort noetig.
    status: String,
}

// Sicherer Logout/Konto-Wechsel: ERST den aktuellen Stand in die Cloud sichern, DANN alles raeumen.
// force = Notausgang (ohne Cloud-Sicherung raeumen). password = optional fuer den Sicherungs-Schritt.
#[tauri::command]
async fn cloud_profile_logout(
    base_url: String,
    password: Option<String>,
    force: bool,
) -> Result<CloudProfileLogoutResult, String> {
    if !force {
        let (api_key, connector_token, _) = collect_local_secrets();
        let has_local = !api_key.trim().is_empty() || !connector_token.trim().is_empty();
        if has_local {
            match cached_cloud_key() {
                Some(material) => {
                    push_local_secrets_to_cloud(&base_url, &material)
                        .await
                        .map_err(error_to_string)?;
                }
                None => match password.as_deref() {
                    Some(pw) if !pw.trim().is_empty() => {
                        cloud_profile_unlock_and_push_inner(&base_url, pw)
                            .await
                            .map_err(error_to_string)?;
                    }
                    _ => {
                        return Ok(CloudProfileLogoutResult {
                            status: "needs_password".to_string(),
                        });
                    }
                },
            }
        }
    }
    wipe_local_account_data().map_err(error_to_string)?;
    Ok(CloudProfileLogoutResult {
        status: "logged_out".to_string(),
    })
}

#[tauri::command]
async fn load_remote_action_plans(base_url: String) -> Result<serde_json::Value, String> {
    let token = load_mcp_connector_token().map_err(error_to_string)?;
    // Projekt-Board: auch freigegebene (approved) Plaene laden, damit deren Tasks ausfuehrbar sind.
    let url = format!(
        "{}/api/action-plans?status=pending_review,approved&includeTasks=true",
        normalize_base_url(&base_url)
    );
    let response = reqwest::Client::new()
        .get(url)
        .header("User-Agent", USER_AGENT)
        .bearer_auth(token.trim())
        .send()
        .await
        .map_err(error_to_string)?;

    let status = response.status();
    let text = response.text().await.map_err(error_to_string)?;
    if !status.is_success() {
        return Err(format!("MCP Action Queue nicht erreichbar ({status}): {text}"));
    }
    serde_json::from_str(&text).map_err(error_to_string)
}

#[tauri::command]
async fn update_remote_action_plan_status(
    base_url: String,
    plan_id: String,
    status: String,
) -> Result<serde_json::Value, String> {
    let token = load_mcp_connector_token().map_err(error_to_string)?;
    let url = format!(
        "{}/api/action-plans/{}/status",
        normalize_base_url(&base_url),
        plan_id
    );
    let response = reqwest::Client::new()
        .patch(url)
        .header("User-Agent", USER_AGENT)
        .bearer_auth(token.trim())
        .json(&json!({ "status": status }))
        .send()
        .await
        .map_err(error_to_string)?;

    let response_status = response.status();
    let text = response.text().await.map_err(error_to_string)?;
    if !response_status.is_success() {
        return Err(format!(
            "MCP Action Plan konnte nicht aktualisiert werden ({response_status}): {text}"
        ));
    }
    serde_json::from_str(&text).map_err(error_to_string)
}

#[tauri::command]
async fn update_remote_action_task_status(
    base_url: String,
    task_id: String,
    status: String,
    pr_url: Option<String>,
    branch: Option<String>,
) -> Result<serde_json::Value, String> {
    let token = load_mcp_connector_token().map_err(error_to_string)?;
    let url = format!(
        "{}/api/action-tasks/{}/status",
        normalize_base_url(&base_url),
        task_id
    );
    let mut body = json!({ "status": status });
    if let Some(p) = pr_url.as_deref() {
        if !p.is_empty() {
            body["prUrl"] = json!(p);
        }
    }
    if let Some(b) = branch.as_deref() {
        if !b.is_empty() {
            body["branch"] = json!(b);
        }
    }
    let response = reqwest::Client::new()
        .patch(url)
        .header("User-Agent", USER_AGENT)
        .bearer_auth(token.trim())
        .json(&body)
        .send()
        .await
        .map_err(error_to_string)?;

    let response_status = response.status();
    let text = response.text().await.map_err(error_to_string)?;
    if !response_status.is_success() {
        return Err(format!(
            "MCP Action Task konnte nicht aktualisiert werden ({response_status}): {text}"
        ));
    }
    serde_json::from_str(&text).map_err(error_to_string)
}

#[tauri::command]
async fn load_remote_briefings(base_url: String) -> Result<serde_json::Value, String> {
    let token = load_mcp_connector_token().map_err(error_to_string)?;
    let url = format!(
        "{}/api/briefings?includeArchived=true&limit=100",
        normalize_base_url(&base_url)
    );
    let response = reqwest::Client::new()
        .get(url)
        .header("User-Agent", USER_AGENT)
        .bearer_auth(token.trim())
        .send()
        .await
        .map_err(error_to_string)?;

    let status = response.status();
    let text = response.text().await.map_err(error_to_string)?;
    if !status.is_success() {
        return Err(format!("MCP Briefings nicht erreichbar ({status}): {text}"));
    }
    serde_json::from_str(&text).map_err(error_to_string)
}

#[tauri::command]
async fn update_remote_briefing_status(
    base_url: String,
    briefing_id: String,
    status: String,
) -> Result<serde_json::Value, String> {
    let token = load_mcp_connector_token().map_err(error_to_string)?;
    let url = format!(
        "{}/api/briefings/{}/status",
        normalize_base_url(&base_url),
        briefing_id
    );
    let response = reqwest::Client::new()
        .patch(url)
        .header("User-Agent", USER_AGENT)
        .bearer_auth(token.trim())
        .json(&json!({ "status": status }))
        .send()
        .await
        .map_err(error_to_string)?;

    let response_status = response.status();
    let text = response.text().await.map_err(error_to_string)?;
    if !response_status.is_success() {
        return Err(format!(
            "MCP Briefing konnte nicht aktualisiert werden ({response_status}): {text}"
        ));
    }
    serde_json::from_str(&text).map_err(error_to_string)
}

#[tauri::command]
async fn archive_remote_briefing(
    base_url: String,
    briefing_id: String,
    archived: bool,
) -> Result<serde_json::Value, String> {
    let token = load_mcp_connector_token().map_err(error_to_string)?;
    let url = format!(
        "{}/api/briefings/{}/archive",
        normalize_base_url(&base_url),
        briefing_id
    );
    let response = reqwest::Client::new()
        .patch(url)
        .header("User-Agent", USER_AGENT)
        .bearer_auth(token.trim())
        .json(&json!({ "archived": archived }))
        .send()
        .await
        .map_err(error_to_string)?;

    let response_status = response.status();
    let text = response.text().await.map_err(error_to_string)?;
    if !response_status.is_success() {
        return Err(format!(
            "MCP Briefing konnte nicht archiviert werden ({response_status}): {text}"
        ));
    }
    serde_json::from_str(&text).map_err(error_to_string)
}

#[tauri::command]
async fn delete_remote_briefing(
    base_url: String,
    briefing_id: String,
) -> Result<serde_json::Value, String> {
    let token = load_mcp_connector_token().map_err(error_to_string)?;
    let url = format!(
        "{}/api/briefings/{}",
        normalize_base_url(&base_url),
        briefing_id
    );
    let response = reqwest::Client::new()
        .delete(url)
        .header("User-Agent", USER_AGENT)
        .bearer_auth(token.trim())
        .send()
        .await
        .map_err(error_to_string)?;

    let response_status = response.status();
    let text = response.text().await.map_err(error_to_string)?;
    if !response_status.is_success() {
        return Err(format!(
            "MCP Briefing konnte nicht geloescht werden ({response_status}): {text}"
        ));
    }
    serde_json::from_str(&text).map_err(error_to_string)
}

// ===== Codex-Bridge: lokale Ausfuehrung freigegebener Aufgaben via Codex-CLI =====

const CODEX_BIN: &str = "/Applications/Codex.app/Contents/Resources/codex";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRunRequest {
    base_url: String,
    repo_path: String,
    trigger: String,
    #[serde(default)]
    action_plan_id: Option<String>,
    #[serde(default)]
    action_task_id: Option<String>,
    #[serde(default)]
    briefing_id: Option<String>,
    #[serde(default)]
    project_id: String,
    #[serde(default)]
    priority: u32,
    title: String,
    #[serde(default)]
    risk_level: String,
    prompt: String,
    #[serde(default)]
    input_plan: serde_json::Value,
    #[serde(default)]
    dry_run: bool,
    #[serde(default)]
    timeout_secs: Option<u64>,
    // Multi-Runner: welcher lokale Runner ausfuehrt ("codex_cli" Default, "claude_cli" = Claude Code CLI).
    #[serde(default)]
    runner: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRunResult {
    status: String,
    branch: String,
    run_dir: String,
    changed_files: Vec<String>,
    commit: Option<String>,
    result_summary: String,
    exit_code: Option<i32>,
    duration_ms: u64,
    error: Option<String>,
    // Codex-Bridge v2
    pushed: bool,
    branch_url: Option<String>,
    pr_url: Option<String>,
    // Datei-Modus dieses Laufs (autoritativ aus der frisch von der Platte geladenen Config),
    // damit das Frontend den Task-Status nicht aus evtl. ungespeicherter In-Memory-Config ableitet.
    file_mode: bool,
}

fn codex_bin() -> String {
    if Path::new(CODEX_BIN).exists() {
        CODEX_BIN.to_string()
    } else {
        "codex".to_string()
    }
}

// Claude Code CLI (Multi-Runner). GUI-Prozess erbt den Shell-PATH nicht -> absolute Pfade probieren
// (Native-Installer legt das Binary in ~/.local/bin/claude). Auth = Claude-Abo-Login (claude login),
// keine API-Kosten — analog zu Codex' ChatGPT-Login.
fn claude_bin() -> String {
    if let Ok(home) = std::env::var("HOME") {
        let p = format!("{home}/.local/bin/claude");
        if Path::new(&p).exists() {
            return p;
        }
    }
    for p in ["/opt/homebrew/bin/claude", "/usr/local/bin/claude"] {
        if Path::new(p).exists() {
            return p.to_string();
        }
    }
    "claude".to_string()
}

// Codex-Bridge v2: gh-CLI (GUI-Prozess erbt den Shell-PATH nicht -> absolute Pfade probieren).
fn gh_bin() -> String {
    for p in ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"] {
        if Path::new(p).exists() {
            return p.to_string();
        }
    }
    "gh".to_string()
}

fn pdftotext_bin() -> Option<String> {
    // 1) Gebuendelte poppler-Binary (self-contained, Contents/Resources/poppler/pdftotext) ->
    //    PDF->Text funktioniert IMMER, auch ohne System-Installation. Pfad relativ zur laufenden
    //    Executable (Contents/MacOS/<app> -> ../Resources/poppler/pdftotext).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(contents) = exe.parent().and_then(Path::parent) {
            let res = contents.join("Resources");
            // Je nach Tauri-Resource-Mapping liegt es unter Resources/poppler/ oder
            // Resources/resources/poppler/ -> beide Kandidaten pruefen.
            for cand in [
                res.join("poppler").join("pdftotext"),
                res.join("resources").join("poppler").join("pdftotext"),
            ] {
                if cand.exists() {
                    return Some(cand.to_string_lossy().into_owned());
                }
            }
        }
    }
    // 2) Fallback: System-poppler (Homebrew) fuer die Dev-Umgebung.
    for p in ["/opt/homebrew/bin/pdftotext", "/usr/local/bin/pdftotext"] {
        if Path::new(p).exists() {
            return Some(p.to_string());
        }
    }
    None
}

// KatoContext (nur Datei-Modus): Top-Level-Dateien des Referenzordners (Lebenslauf/Zeugnisse/
// Kontext) nach <repo>/KatoContext/ kopieren, damit der Runner sie als Faktenbasis liest. PDFs
// zusaetzlich best-effort als .txt-Zwilling (pdftotext/poppler, falls installiert -> auch Codex
// liest sie; Claude liest PDFs ohnehin nativ). KatoContext bleibt LOKAL: nie in die Mistral-
// Library, nie committet/gescannt (von allen git-Pathspecs + der Scan-Blockliste ausgeschlossen).
// KatoContext/ und .katosync/ dauerhaft in .git/info/exclude eintragen (idempotent). Schuetzt die
// privaten Faktenbasis-Daten + Lauf-Artefakte gegen JEDE git-Operation, nicht nur KatoSyncs eigene
// ":!"-Pathspecs (Nutzer, IDE-"Stage All", Hook, autonomer Agent).
fn ensure_git_excludes(repo_path: &str) {
    let git_dir = git_capture(repo_path, &["rev-parse", "--git-dir"])
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| ".git".to_string());
    let git_dir = if Path::new(&git_dir).is_absolute() {
        git_dir
    } else {
        format!("{repo_path}/{git_dir}")
    };
    let info_dir = format!("{git_dir}/info");
    if fs::create_dir_all(&info_dir).is_err() {
        return;
    }
    let exclude_path = format!("{info_dir}/exclude");
    let existing = fs::read_to_string(&exclude_path).unwrap_or_default();
    let mut content = existing.clone();
    let mut changed = false;
    for entry in ["KatoContext/", ".katosync/", "._*"] {
        if !existing.lines().any(|l| l.trim() == entry) {
            if !content.is_empty() && !content.ends_with('\n') {
                content.push('\n');
            }
            content.push_str(entry);
            content.push('\n');
            changed = true;
        }
    }
    if changed {
        let _ = fs::write(&exclude_path, content);
    }
}

async fn materialize_kato_context(repo_path: &str, reference_root: &str) -> usize {
    let dst = format!("{repo_path}/KatoContext");
    let _ = fs::remove_dir_all(&dst); // frisch: Referenzordner koennte sich geaendert haben
    if fs::create_dir_all(&dst).is_err() {
        let _ = write_log("codex", "KatoContext konnte nicht angelegt werden.");
        return 0;
    }
    let pdftotext = pdftotext_bin();
    let mut count = 0usize;
    let Ok(entries) = fs::read_dir(reference_root) else {
        let _ = write_log("codex", "KatoContext: Referenzordner nicht lesbar.");
        return 0;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(OsStr::to_str) else {
            continue;
        };
        if name.starts_with('.') {
            continue; // versteckte/AppleDouble-Sidecars ueberspringen
        }
        let target = format!("{dst}/{name}");
        if let Err(e) = fs::copy(&path, &target) {
            // Nicht still verschlucken: der Runner behandelt KatoContext als verbindliche Faktenbasis.
            let _ = write_log("codex", &format!("KatoContext: Datei uebersprungen ({name}): {e}"));
            continue;
        }
        count += 1;
        if name.to_lowercase().ends_with(".pdf") {
            if let Some(ref bin) = pdftotext {
                // Kollisionsschutz: hat der Nutzer im Referenzordner bereits eine kuratierte "<name>.txt",
                // den maschinellen Extrakt als "<name>.extracted.txt" ablegen statt sie zu ueberschreiben.
                let twin = if Path::new(reference_root).join(format!("{name}.txt")).exists() {
                    format!("{dst}/{name}.extracted.txt")
                } else {
                    format!("{dst}/{name}.txt")
                };
                // pdftotext mit Timeout + kill_on_drop: eine kaputte/pathologische PDF (poppler-Hang)
                // darf den ganzen Lauf nicht einfrieren.
                let extract = timeout(
                    Duration::from_secs(30),
                    TokioCommand::new(bin)
                        .arg("-layout")
                        .arg(&target)
                        .arg(&twin)
                        .kill_on_drop(true)
                        .output(),
                )
                .await;
                if extract.is_err() {
                    let _ = write_log("codex", &format!("KatoContext: pdftotext-Timeout fuer {name}."));
                }
            }
        }
    }
    count
}

// Default-Branch offline ermitteln (origin/HEAD ist oft nicht gesetzt): main -> master -> aktueller.
fn detect_default_branch(repo: &str) -> String {
    if git_capture(repo, &["show-ref", "--verify", "--quiet", "refs/heads/main"]).is_ok() {
        return "main".to_string();
    }
    if git_capture(repo, &["show-ref", "--verify", "--quiet", "refs/heads/master"]).is_ok() {
        return "master".to_string();
    }
    git_capture(repo, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|_| "main".to_string())
}

// origin-Remote als https-Basis-URL (ssh -> https), ohne abschliessendes .git. Fuer Branch-/PR-Links.
fn git_remote_https_url(repo: &str) -> Option<String> {
    let raw = git_capture(repo, &["remote", "get-url", "origin"]).ok()?;
    let raw = raw.trim();
    let url = if let Some(rest) = raw.strip_prefix("git@github.com:") {
        format!("https://github.com/{rest}")
    } else if let Some(rest) = raw.strip_prefix("ssh://git@github.com/") {
        format!("https://github.com/{rest}")
    } else {
        raw.to_string()
    };
    Some(url.trim_end_matches(".git").trim_end_matches('/').to_string())
}

// Codex --json Event -> (Label, Kurztext) fuer den Live-Feed. Defensiv ueber unbekannte Schemata.
fn summarize_codex_event(line: &str) -> (String, String) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return ("event".to_string(), String::new());
    }
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let label = v
            .get("type")
            .and_then(|t| t.as_str())
            .or_else(|| v.pointer("/msg/type").and_then(|t| t.as_str()))
            .or_else(|| v.pointer("/item/type").and_then(|t| t.as_str()))
            .unwrap_or("event")
            .to_string();
        let text = v
            .pointer("/msg/message")
            .and_then(|t| t.as_str())
            .or_else(|| v.pointer("/msg/text").and_then(|t| t.as_str()))
            .or_else(|| v.get("message").and_then(|t| t.as_str()))
            .or_else(|| v.pointer("/item/text").and_then(|t| t.as_str()))
            .or_else(|| v.pointer("/item/title").and_then(|t| t.as_str()))
            .unwrap_or("");
        let text: String = sanitize_log(text).chars().take(160).collect();
        return (sanitize_log(&label), text);
    }
    let raw: String = sanitize_log(trimmed).chars().take(160).collect();
    ("log".to_string(), raw)
}

// Claude Code --output-format stream-json -> (Label, Kurztext) fuer denselben Live-Feed.
// Event-Typen: system/init, assistant (message.content[].text), tool_use, tool_result, result.
fn summarize_claude_event(line: &str) -> (String, String) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return ("event".to_string(), String::new());
    }
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let typ = v.get("type").and_then(|t| t.as_str()).unwrap_or("event");
        let text: String = match typ {
            "assistant" => {
                // content[] enthaelt Text- UND tool_use-Bloecke (Feld "name", nicht "tool_name").
                // Ersten Text-Block nehmen, sonst den Tool-Namen — sonst bliebe der Feed bei
                // Tool-Schritten leer.
                let mut out = String::new();
                if let Some(blocks) = v.pointer("/message/content").and_then(|c| c.as_array()) {
                    for b in blocks {
                        match b.get("type").and_then(|t| t.as_str()) {
                            Some("text") => {
                                if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
                                    out = t.to_string();
                                    break;
                                }
                            }
                            Some("tool_use") => {
                                if let Some(n) = b.get("name").and_then(|n| n.as_str()) {
                                    out = format!("Tool: {n}");
                                    break;
                                }
                            }
                            _ => {}
                        }
                    }
                }
                out
            }
            "result" => {
                let is_err = v.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false)
                    || v.get("subtype").and_then(|s| s.as_str()) == Some("error");
                let fallback = if is_err { "fehlgeschlagen" } else { "fertig" };
                v.get("result")
                    .and_then(|t| t.as_str())
                    .unwrap_or(fallback)
                    .to_string()
            }
            _ => String::new(),
        };
        let text: String = sanitize_log(&text).chars().take(160).collect();
        return (sanitize_log(typ), text);
    }
    let raw: String = sanitize_log(trimmed).chars().take(160).collect();
    ("log".to_string(), raw)
}

fn git_capture(repo: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map_err(error_to_string)?;
    if !output.status.success() {
        return Err(format!(
            "git {} fehlgeschlagen: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// Wie git_capture, aber liefert rohes stdout ohne Trim — fuer NUL-getrennte (-z) Ausgaben,
// bei denen git Pfade unescaped laesst (sonst quotet git Nicht-ASCII/Umlaute mit fuehrendem '"').
fn git_capture_raw(repo: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map_err(error_to_string)?;
    if !output.status.success() {
        return Err(format!(
            "git {} fehlgeschlagen: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output.stdout)
}

async fn patch_action_plan_status_inner(
    base_url: &str,
    plan_id: &str,
    status: &str,
) -> Result<(), String> {
    let token = load_mcp_connector_token().map_err(error_to_string)?;
    let url = format!(
        "{}/api/action-plans/{}/status",
        normalize_base_url(base_url),
        plan_id
    );
    let response = reqwest::Client::new()
        .patch(url)
        .header("User-Agent", USER_AGENT)
        .bearer_auth(token.trim())
        .json(&json!({ "status": status }))
        .send()
        .await
        .map_err(error_to_string)?;
    if !response.status().is_success() {
        let s = response.status();
        let t = response.text().await.unwrap_or_default();
        return Err(format!("Status-Update fehlgeschlagen ({s}): {t}"));
    }
    Ok(())
}

// Projekt-Board: Task-Status-Rueckkanal (best effort) waehrend eines Codex-Laufs.
// pr_url/branch werden beim Wechsel auf 'executed' mitgeschickt (Board-Anzeige + Merge-Polling).
async fn patch_action_task_status_inner(
    base_url: &str,
    task_id: &str,
    status: &str,
    pr_url: Option<&str>,
    branch: Option<&str>,
) -> Result<(), String> {
    let token = load_mcp_connector_token().map_err(error_to_string)?;
    let url = format!(
        "{}/api/action-tasks/{}/status",
        normalize_base_url(base_url),
        task_id
    );
    let mut body = json!({ "status": status });
    if let Some(p) = pr_url {
        if !p.is_empty() {
            body["prUrl"] = json!(p);
        }
    }
    if let Some(b) = branch {
        if !b.is_empty() {
            body["branch"] = json!(b);
        }
    }
    let response = reqwest::Client::new()
        .patch(url)
        .header("User-Agent", USER_AGENT)
        .bearer_auth(token.trim())
        .json(&body)
        .send()
        .await
        .map_err(error_to_string)?;
    if !response.status().is_success() {
        let s = response.status();
        let t = response.text().await.unwrap_or_default();
        return Err(format!("Task-Status-Update fehlgeschlagen ({s}): {t}"));
    }
    Ok(())
}

async fn post_execution_result(base_url: &str, body: &serde_json::Value) -> Result<(), String> {
    let token = load_mcp_connector_token().map_err(error_to_string)?;
    let url = format!("{}/api/execution-results", normalize_base_url(base_url));
    let response = reqwest::Client::new()
        .post(url)
        .header("User-Agent", USER_AGENT)
        .bearer_auth(token.trim())
        .json(body)
        .send()
        .await
        .map_err(error_to_string)?;
    if !response.status().is_success() {
        let s = response.status();
        let t = response.text().await.unwrap_or_default();
        return Err(format!("execution-results POST fehlgeschlagen ({s}): {t}"));
    }
    Ok(())
}

#[tauri::command]
fn dir_exists(path: String) -> bool {
    let p = path.trim();
    !p.is_empty() && Path::new(p).is_dir()
}

// Abschluss-Rueckkanal: prueft, ob ein ausgefuehrter Task wirklich erledigt ist.
// Liefert "merged" | "closed" | "open" (Frontend macht aus invoke-Fehlern "unknown").
//  1) PR-Status via gh (wenn pr_url eine echte PR-URL ist) -> deckt auch Squash/Rebase-Merges ab.
//  2) lokaler Merge-Check (Fallback ohne PR): Branch in den Default-Branch gemerged?
//     Hinweis: erkennt nur Merge-Commits, nicht Squash/Rebase (andere SHAs); dafuer ist der gh-Pfad zustaendig.
#[tauri::command]
async fn check_codex_task(repo_path: String, branch: String, pr_url: String) -> Result<String, String> {
    let pr = pr_url.trim();
    if pr.contains("/pull/") && !pr.contains("/pull/new/") {
        let mut cmd = Command::new(gh_bin());
        cmd.args(["pr", "view", pr, "--json", "state", "-q", ".state"]);
        let repo = repo_path.trim();
        if !repo.is_empty() && Path::new(repo).is_dir() {
            cmd.current_dir(repo);
        }
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                match String::from_utf8_lossy(&out.stdout).trim().to_uppercase().as_str() {
                    "MERGED" => return Ok("merged".to_string()),
                    "CLOSED" => return Ok("closed".to_string()),
                    "OPEN" => return Ok("open".to_string()),
                    _ => {}
                }
            }
        }
    }

    // Lokaler Merge-Check (z.B. manuell gemerged ohne PR).
    let repo = repo_path.trim();
    let br = branch.trim();
    if !repo.is_empty() && Path::new(repo).is_dir() && !br.is_empty() {
        let default_branch = detect_default_branch(repo);
        let _ = git_capture(repo, &["fetch", "origin", &default_branch]); // best effort
        for base in [format!("origin/{default_branch}"), default_branch.clone()] {
            if let Ok(list) = git_capture(repo, &["branch", "--merged", &base]) {
                let merged = list
                    .lines()
                    .any(|l| l.trim().trim_start_matches('*').trim() == br);
                if merged {
                    return Ok("merged".to_string());
                }
            }
        }
    }

    Ok("open".to_string())
}

#[tauri::command]
async fn run_codex_task(req: CodexRunRequest, app: tauri::AppHandle) -> Result<CodexRunResult, String> {
    let started = std::time::Instant::now();
    let run_stamp = Local::now().format("%Y%m%d%H%M%S").to_string();
    let repo_path = req.repo_path.trim().to_string();

    // ---- Preflight (hart) ----
    if req.risk_level.to_lowercase() == "critical" {
        return Err(
            "Kritische Aufgaben muessen manuell bearbeitet werden. Kein automatischer Lauf."
                .to_string(),
        );
    }
    let repo = Path::new(&repo_path);
    if !repo.is_dir() {
        return Err(format!("Projektordner nicht gefunden: {repo_path}"));
    }
    let config = load_config_inner().map_err(error_to_string)?;
    // Coding-Modus an = GitHub (Branch/Push/PR), aus = Datei-Modus (lokal). Datei-Modus ist Standard.
    let file_mode = !config.codex_coding_mode;
    // Multi-Runner: Codex (Default) oder Claude Code CLI.
    let is_claude = req.runner.as_deref() == Some("claude_cli");
    let runner_label = if is_claude { "Claude" } else { "Codex" };
    // Keine sourceRoots-Allowlist mehr: der Nutzer waehlt den Ordner bewusst im
    // Datei-Dialog (= explizite Freigabe). Schutz kommt aus Git-Repo-Pflicht,
    // sauberem Arbeitsbaum, eigenem Branch, Sandbox und critical-Abbruch.
    if is_claude {
        // Claude Code CLI: nur Binary/PATH pruefen (claude --version). Die Auth (Claude-Abo-Login,
        // keine API-Kosten) wird NICHT vorab geprueft -> fehlende Auth/Limit zeigt sich als Lauf-Fehler.
        let probe = Command::new(claude_bin())
            .arg("--version")
            .output()
            .map_err(error_to_string)?;
        if !probe.status.success() {
            return Err(
                "Claude Code CLI nicht gefunden. Bitte installieren und mit 'claude login' anmelden."
                    .to_string(),
            );
        }
    } else {
        let login = Command::new(codex_bin())
            .arg("login")
            .arg("status")
            .output()
            .map_err(error_to_string)?;
        if !login.status.success() {
            return Err("Bitte zuerst in Codex per ChatGPT einloggen (codex login).".to_string());
        }
    }
    let is_git = git_capture(&repo_path, &["rev-parse", "--is-inside-work-tree"]).unwrap_or_default()
        == "true";
    if !is_git {
        if file_mode {
            // Datei-Modus: Git unsichtbar einrichten, damit Branch/Commit/Diff den Lauf
            // schuetzen (sauberer Ausgangszustand, klar erkennbare neue Dateien). Kein Push.
            git_capture(&repo_path, &["init"])
                .map_err(|e| format!("git init im Datei-Modus fehlgeschlagen: {e}"))?;
            // Lokale Identitaet als Fallback (nur dieser frisch angelegte Ordner), damit der
            // Baseline-Commit auch ohne globale git-Identitaet gelingt.
            let _ = git_capture(&repo_path, &["config", "user.email", "katosync@local"]);
            let _ = git_capture(&repo_path, &["config", "user.name", "KatoSync"]);
        } else {
            return Err("Der Projektordner ist kein Git-Repository.".to_string());
        }
    }
    // KatoContext/ + .katosync/ dauerhaft auf Repo-Ebene ignorieren (.git/info/exclude) -> schuetzt die
    // privaten Faktenbasis-Daten (CV/Zeugnisse) + Lauf-Artefakte gegen JEDEN git-Befehl (Nutzer, IDE,
    // Hook, autonomer Agent), nicht nur gegen KatoSyncs eigene ":!"-Pathspecs.
    ensure_git_excludes(&repo_path);
    // Stale KatoContext eines frueheren Laufs IMMER entfernen (auch wenn jetzt kein/ein anderer
    // Referenzordner gesetzt ist oder im Coding-Modus) -> private Daten ueberleben ihre Quelle nicht.
    let _ = fs::remove_dir_all(format!("{repo_path}/KatoContext"));
    if file_mode && !is_git {
        // NUR ein frisch angelegtes Repo: aktuellen Inhalt als Ausgangszustand committen, damit
        // ein HEAD existiert und der spaetere Diff nur Codex' neue Dateien zeigt. Lokal, ohne Push.
        let _ = git_capture(&repo_path, &["add", "-A", "--", ":!.katosync", ":!KatoContext"]);
        git_capture(
            &repo_path,
            &["commit", "-m", "katosync: Ausgangszustand", "--allow-empty"],
        )
        .map_err(|e| {
            format!("Git-Baseline im Datei-Modus fehlgeschlagen (fehlt eine git-Identitaet?): {e}")
        })?;
    } else if !file_mode
        && !git_capture(&repo_path, &["status", "--porcelain", "--", ":!.katosync", ":!KatoContext", ":!KatoResults"])?
            .is_empty()
    {
        // NUR Coding-Modus: dort passieren Branch/Commit/Push/PR -> keine fremden Aenderungen
        // mitcommitten. Datei-Modus schreibt nur nach KatoResults (kein Push) -> ein "unsauberer"
        // Arbeitsbaum blockiert dort NICHT (das war unnoetige Reibung).
        return Err("Der Arbeitsbaum ist nicht sauber. Bitte erst committen oder stashen.".to_string());
    }

    // ---- Branch + Run-Ordner ----
    let date = Local::now().format("%Y-%m-%d").to_string();
    let project_slug = {
        let s = slugify(&req.project_id);
        if s.is_empty() { "projekt".to_string() } else { s }
    };
    let title_slug = {
        let s: String = slugify(&req.title).chars().take(40).collect();
        let s = s.trim_matches('-').to_string();
        if s.is_empty() { "aufgabe".to_string() } else { s }
    };
    // Prefix-Fix: bei generischem Projekt ("katosync"/leer) das Projekt-Segment weglassen
    // -> kein doppeltes "katosync/katosync/".
    let project_segment = if project_slug == "katosync" || project_slug == "projekt" {
        String::new()
    } else {
        format!("{project_slug}/")
    };
    let branch = format!(
        "katosync/{}{}/task-{}-{}",
        project_segment, date, req.priority, title_slug
    );
    let default_branch = detect_default_branch(&repo_path);
    let task_id = req
        .action_task_id
        .clone()
        .or_else(|| req.briefing_id.clone())
        .unwrap_or_else(|| run_stamp.clone());
    let task_slug = {
        let s = slugify(&task_id);
        if s.is_empty() { "run".to_string() } else { s }
    };
    let run_dir = format!("{}/.katosync/runs/{}/task-{}", repo_path, date, task_slug);
    fs::create_dir_all(&run_dir).map_err(error_to_string)?;
    fs::write(
        format!("{run_dir}/input_plan.json"),
        serde_json::to_string_pretty(&req.input_plan).unwrap_or_else(|_| "{}".to_string()),
    )
    .map_err(error_to_string)?;
    fs::write(format!("{run_dir}/prompt.md"), sanitize_log(&req.prompt)).map_err(error_to_string)?;

    // Wahrheit: den Referenzordner IMMER als Faktenbasis materialisieren (beide Modi), wenn gesetzt
    // -> der Runner prueft gegen echte Daten. Die Git-Leak-Guards (.git/info/exclude + Pre-Cleanup,
    // oben) laufen modus-unabhaengig, KatoContext/ landet also nie in git/PR.
    let result_rel = format!("KatoResults/task-{task_slug}");
    let context_files = if !config.reference_root.trim().is_empty()
        && Path::new(config.reference_root.trim()).is_dir()
    {
        materialize_kato_context(&repo_path, config.reference_root.trim()).await
    } else {
        0
    };
    let context_block = if context_files > 0 {
        "\n\n## Faktenbasis (verbindlich)\nQuellen: (a) die Aufgabe/das Briefing oben — daraus NUR Stellen-/Unternehmensdaten (Position, Firma, Anforderungen); und (b) der Ordner `KatoContext/` (Lebenslauf, Zeugnisse, Kontakt des Bewerbers), NUR-LESEN.\nWICHTIG — persoenliche BEWERBERDATEN (Absenderadresse, Postleitzahl, Ort, Telefon, E-Mail, Name des Bewerbers, Geburtsdatum) NUR aus `KatoContext/` uebernehmen, NIEMALS aus dem Briefing: im Briefing koennen erfundene Angaben stehen (z. B. eine aus dem Stellen-Standort geratene Adresse). Steht eine Bewerberangabe nicht WOERTLICH im `KatoContext/`, schreibe [bitte ergaenzen] — nicht raten, nicht aus dem Briefing kopieren, nicht ableiten.\nErfinde generell nichts hinzu (keine Ansprechpartner, Fristen, Zahlen). Wahrheit vor Vollstaendigkeit."
    } else {
        "\n\n## Faktenbasis (verbindlich)\nNutze ausschliesslich Angaben, die woertlich in der Aufgabe oben stehen. ERFINDE NICHTS hinzu (keine Adressen, Ansprechpartner, Namen, Daten, Zahlen). Fehlt eine Angabe, schreibe woertlich [bitte ergaenzen]."
    };
    let effective_prompt = if file_mode {
        let result_dir = format!("{repo_path}/{result_rel}");
        fs::create_dir_all(&result_dir).map_err(error_to_string)?;
        format!(
            "{}\n\n## Datei-Modus (verbindlich)\nSchreibe dein Ergebnis als fertige Datei(en) AUSSCHLIESSLICH in den Ordner `{result_rel}/`. Aendere, verschiebe oder loesche KEINE anderen Dateien. Erstelle keinen Code ausserhalb dieses Ergebnis-Ordners.{context_block}",
            req.prompt
        )
    } else {
        // Coding-Modus: dieselbe Faktenbasis anhaengen -> auch bei Code wird gegen echte Daten
        // geprueft (Wahrheit); keine Datei-Modus-Schreibbeschraenkung.
        format!("{}{context_block}", req.prompt)
    };

    // Immer von main/Default abzweigen (nicht vom aktuellen HEAD -> kein Codex-auf-Codex-Stapeln).
    let _ = git_capture(&repo_path, &["fetch", "origin", &default_branch]); // best effort
    git_capture(&repo_path, &["checkout", &default_branch])
        .map_err(|e| format!("Wechsel auf {default_branch} fehlgeschlagen: {e}"))?;
    git_capture(&repo_path, &["checkout", "-b", &branch])
        .map_err(|e| format!("Branch konnte nicht angelegt werden ({branch}): {e}"))?;
    let _ = write_log(
        "codex",
        &format!("{runner_label}-Lauf gestartet: {} (Branch {branch} von {default_branch})", sanitize_log(&req.title)),
    );
    // Datei-Modus erlaubt einen unsauberen Baum -> pre-existierende fremde Aenderungen merken,
    // damit der spaetere "ausserhalb geschrieben"-Check sie NICHT als Codex-Verstoss wertet.
    let pre_dirty: std::collections::HashSet<String> = if file_mode {
        git_capture_raw(
            &repo_path,
            &["-c", "core.quotepath=false", "status", "--porcelain", "-z", "--", ":!.katosync", ":!KatoContext"],
        )
        .unwrap_or_default()
        .split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).chars().skip(3).collect::<String>())
        .collect()
    } else {
        std::collections::HashSet::new()
    };

    if let Some(plan_id) = &req.action_plan_id {
        if let Err(e) = patch_action_plan_status_inner(&req.base_url, plan_id, "running").await {
            let _ = write_log("codex", &format!("Warnung: Status running fehlgeschlagen: {e}"));
        }
    }
    if let Some(task_id) = &req.action_task_id {
        if let Err(e) = patch_action_task_status_inner(&req.base_url, task_id, "running", None, None).await {
            let _ = write_log("codex", &format!("Warnung: Task-Status running fehlgeschlagen: {e}"));
        }
    }

    // ---- codex exec (Sandbox + Timeout) ----
    let sandbox = if req.dry_run { "read-only" } else { "workspace-write" };
    let timeout_secs = req.timeout_secs.unwrap_or(900);
    let output_path = format!("{run_dir}/output.txt");
    let events_path = format!("{run_dir}/execution_log.jsonl");
    let stderr_path = format!("{run_dir}/codex_stderr.log");
    // events-Datei leeren (der Reader haengt die JSONL-Zeilen an); stderr direkt in Datei.
    fs::File::create(&events_path).map_err(error_to_string)?;
    let stderr_file = fs::File::create(&stderr_path).map_err(error_to_string)?;

    let mut codex_error: Option<String> = None;
    let mut exit_code: Option<i32> = None;
    // Nur der exec-Aufruf ist runner-spezifisch; spawn/Reader/Timeout teilen sich beide.
    let mut command = if is_claude {
        // Claude Code CLI: headless, ordnergebunden, schreibend, stream-json Live-Feed.
        // permission-mode plan = read-only (Dry-Run), acceptEdits = Datei-Edits/Writes im Ordner.
        // Hinweis: acceptEdits genehmigt NUR Datei-Edits (ideal fuer Datei-Modus/Dokumente);
        // Bash/Shell wird headless nicht auto-genehmigt -> Code-Aufgaben mit Build/Test sind
        // mit dem Claude-Runner derzeit eingeschraenkt. Hat kein -o: finaler Ergebnis-Text
        // wird unten aus dem result-Event gezogen.
        let mut c = TokioCommand::new(claude_bin());
        c.arg("-p")
            .arg(&effective_prompt)
            .arg("--output-format")
            .arg("stream-json")
            .arg("--verbose")
            .arg("--permission-mode")
            .arg(if req.dry_run { "plan" } else { "acceptEdits" })
            .arg("--add-dir")
            .arg(&repo_path)
            .current_dir(&repo_path);
        c
    } else {
        let mut c = TokioCommand::new(codex_bin());
        c.arg("exec")
            .arg(&effective_prompt)
            .arg("--cd")
            .arg(&repo_path)
            .arg("--sandbox")
            .arg(sandbox)
            .arg("--json")
            .arg("-o")
            .arg(&output_path)
            .arg("--color")
            .arg("never")
            .arg("-c")
            .arg("approval_policy=\"never\"");
        c
    };
    command.stdout(Stdio::piped()).stderr(Stdio::from(stderr_file));
    match command.spawn()
    {
        Ok(mut child) => {
            // Live-Feed: codex-stdout (JSONL) zeilenweise -> in execution_log.jsonl schreiben
            // UND als Tauri-Event "codex-event" ans Frontend streamen.
            let reader_handle = child.stdout.take().map(|stdout| {
                let app = app.clone();
                let events_path = events_path.clone();
                let task_label = task_id.clone();
                tokio::spawn(async move {
                    let mut file = std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&events_path)
                        .ok();
                    let mut lines = BufReader::new(stdout).lines();
                    let mut seq: u64 = 0;
                    while let Ok(Some(line)) = lines.next_line().await {
                        if let Some(f) = file.as_mut() {
                            let _ = writeln!(f, "{line}");
                        }
                        seq += 1;
                        let (label, text) = if is_claude {
                            summarize_claude_event(&line)
                        } else {
                            summarize_codex_event(&line)
                        };
                        let _ = app.emit(
                            "codex-event",
                            json!({
                                "taskId": task_label,
                                "seq": seq,
                                "label": label,
                                "text": text,
                            }),
                        );
                    }
                })
            });

            match timeout(Duration::from_secs(timeout_secs), child.wait()).await {
                Ok(Ok(status)) => {
                    exit_code = status.code();
                    if !status.success() {
                        codex_error = Some(format!("{runner_label} Exit-Code {:?}", status.code()));
                    }
                }
                Ok(Err(e)) => codex_error = Some(error_to_string(e)),
                Err(_) => {
                    let _ = child.kill().await;
                    codex_error = Some(format!("{runner_label}-Timeout nach {timeout_secs}s"));
                }
            }
            // Restliche Zeilen flushen lassen — aber nie unbegrenzt warten: falls ein
            // Codex-Subprozess das stdout-Pipe offen haelt (kein EOF nach kill), den Reader abbrechen,
            // sonst wuerde der Timeout ausgehebelt und der Command haengen.
            if let Some(handle) = reader_handle {
                let abort = handle.abort_handle();
                if timeout(Duration::from_secs(5), handle).await.is_err() {
                    abort.abort();
                }
            }
        }
        Err(e) => codex_error = Some(format!("{runner_label}-Start fehlgeschlagen: {}", error_to_string(e))),
    }

    // Bei Fehler: aussagekraeftige Meldung aus den JSONL-Events ziehen (z.B. Usage-Limit).
    if codex_error.is_some() {
        if let Ok(events) = fs::read_to_string(&events_path) {
            for line in events.lines().rev() {
                if !line.contains("\"error\"") {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                    let msg = v
                        .get("message")
                        .and_then(|m| m.as_str())
                        .or_else(|| v.pointer("/error/message").and_then(|m| m.as_str()));
                    if let Some(m) = msg {
                        codex_error = Some(sanitize_log(m));
                        break;
                    }
                }
            }
        }
    }

    // Claude stream-json hat kein -o: finalen result-Text aus den Events ziehen -> output_path
    // (fuer result_summary), und Fehler aus dem result-Event erkennen (is_error/subtype=error).
    if is_claude {
        if let Ok(events) = fs::read_to_string(&events_path) {
            for line in events.lines().rev() {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
                    continue;
                };
                if v.get("type").and_then(|t| t.as_str()) != Some("result") {
                    continue;
                }
                let is_err = v.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false)
                    || v.get("subtype").and_then(|s| s.as_str()) == Some("error");
                if let Some(text) = v.get("result").and_then(|r| r.as_str()) {
                    let _ = fs::write(&output_path, text);
                    if is_err && codex_error.is_none() {
                        codex_error = Some(sanitize_log(text));
                    }
                } else if is_err {
                    // Fehler-result ohne result-Text (z.B. error_max_turns): Marker in output_path
                    // schreiben, damit result_summary nicht leer bleibt.
                    let sub = v.get("subtype").and_then(|s| s.as_str()).unwrap_or("error");
                    let m = format!("Claude-Lauf fehlgeschlagen ({sub}).");
                    let _ = fs::write(&output_path, &m);
                    if codex_error.is_none() {
                        codex_error = Some(m);
                    }
                }
                break;
            }
        }
    }

    // ---- Diff + Auto-Commit (nur bei Erfolg) ----
    // Datei-Modus: den Ergebnis-Ordner FORCE-adden, falls ihn eine .gitignore/exclude-Regel
    // ignorieren wuerde -> sonst waere der Diff leer und der Lauf gaelte faelschlich als
    // "Codex hat keine Ergebnisdatei erzeugt", obwohl die Dateien geschrieben wurden.
    if file_mode {
        let _ = git_capture(&repo_path, &["add", "-f", "--", &result_rel]);
    }
    // Run-Ordner (.katosync) bewusst NICHT mitcommitten -> bleibt lokaler Audit-Trail,
    // die "geaenderte Dateien"-Liste zeigt nur die echten Aenderungen.
    let _ = git_capture(&repo_path, &["add", "-A", "--", ":!.katosync", ":!KatoContext"]);
    // -z + core.quotepath=false: NUL-getrennte, UNescapte UTF-8-Pfade. Ohne das quotet git
    // Umlaut-Namen (z.B. "Lebenslauf_Mueller.md" mit Ue) mit fuehrendem '"' -> der starts_with-
    // Scope-Check unten wuerde sie faelschlich als "ausserhalb" werten und den Lauf verwerfen.
    let changed_files: Vec<String> = git_capture_raw(
        &repo_path,
        &["-c", "core.quotepath=false", "diff", "--cached", "-z", "--name-only"],
    )
    .unwrap_or_default()
    .split(|b| *b == 0)
    .filter(|s| !s.is_empty())
    .map(|s| String::from_utf8_lossy(s).to_string())
    .collect();

    // Datei-Modus: Codex darf nur in den Ergebnis-Ordner geschrieben haben. Aenderungen
    // ausserhalb -> Lauf verwerfen (kein blindes Mergen ins Projekt).
    if file_mode && codex_error.is_none() {
        // Mit abschliessendem '/' vergleichen, sonst wuerde ein Geschwister-Ordner wie
        // "KatoResults/task-<slug>-x/" den starts_with-Check faelschlich bestehen.
        let scope_prefix = format!("{result_rel}/");
        let out_of_scope: Vec<&str> = changed_files
            .iter()
            .filter(|f| !f.starts_with(&scope_prefix) && !pre_dirty.contains(f.as_str()))
            .map(|f| f.as_str())
            .collect();
        if !out_of_scope.is_empty() {
            codex_error = Some(format!(
                "Datei-Modus: {runner_label} hat ausserhalb von {result_rel}/ geschrieben ({}). Lauf verworfen.",
                out_of_scope.join(", ")
            ));
            let _ = git_capture(&repo_path, &["reset", "--hard"]);
            let _ = git_capture(&repo_path, &["clean", "-fd", "-e", ".katosync", "-e", "KatoContext"]);
        }
    }

    let result_summary = fs::read_to_string(&output_path)
        .unwrap_or_default()
        .trim()
        .to_string();

    // Defensiv: KatoContext/.katosync NIE mitcommitten (auch im Coding-Modus, der keinen Scope-Check
    // hat) - selbst wenn ein autonomer Runner sie vorab gestaged hat; der ":!"-add oben entfernt
    // bereits Gestagetes nicht.
    let _ = git_capture(&repo_path, &["reset", "-q", "--", "KatoContext", ".katosync"]);
    let mut commit: Option<String> = None;
    if codex_error.is_none() && !changed_files.is_empty() {
        let msg = format!("katosync: {} (task {})", req.title.replace('\n', " "), task_id);
        match git_capture(&repo_path, &["commit", "-m", &msg]) {
            Ok(_) => commit = git_capture(&repo_path, &["rev-parse", "HEAD"]).ok(),
            Err(e) => codex_error = Some(format!("Commit fehlgeschlagen: {e}")),
        }
    }
    // Datei-Modus: ohne erzeugte Ergebnisdatei (kein Commit) gilt der Lauf nicht als erfolgreich.
    if file_mode && codex_error.is_none() && commit.is_none() {
        codex_error = Some(format!("Datei-Modus: {runner_label} hat keine Ergebnisdatei erzeugt."));
    }
    let final_status = if codex_error.is_none() { "completed" } else { "failed" };

    let _ = fs::write(
        format!("{run_dir}/changed_files.json"),
        serde_json::to_string_pretty(&changed_files).unwrap_or_else(|_| "[]".to_string()),
    );
    let _ = fs::write(format!("{run_dir}/result_summary.md"), &result_summary);
    let _ = fs::write(
        format!("{run_dir}/status_update.md"),
        format!(
            "# Codex Run Status: {final_status}\n\nBranch: {branch}\nCommit: {}\nGeaenderte Dateien: {}\n",
            commit.clone().unwrap_or_else(|| "-".to_string()),
            changed_files.len()
        ),
    );

    // ---- Codex-Bridge v2: Push + PR (nur bei Erfolg, best effort) ----
    let mut pushed = false;
    let mut branch_url: Option<String> = None;
    let mut pr_url: Option<String> = None;
    let repo_web = git_remote_https_url(&repo_path);
    if !file_mode && final_status == "completed" && commit.is_some() && config.codex_auto_push {
        match git_capture(&repo_path, &["push", "-u", "origin", &branch]) {
            Ok(_) => {
                pushed = true;
                branch_url = repo_web.as_ref().map(|u| format!("{u}/tree/{branch}"));
                let _ = write_log("codex", &format!("Branch gepusht: {branch}"));
                if config.codex_create_pr {
                    let pr_title = format!("KatoSync: {}", req.title.replace('\n', " "));
                    let pr_body = format!(
                        "Automatischer Codex-Lauf aus KatoSync.\n\nBranch: `{branch}`\nGeaenderte Dateien: {}\n",
                        changed_files.len()
                    );
                    let pr_out = Command::new(gh_bin())
                        .current_dir(&repo_path)
                        .args([
                            "pr",
                            "create",
                            "--base",
                            &default_branch,
                            "--head",
                            &branch,
                            "--title",
                            &pr_title,
                            "--body",
                            &pr_body,
                        ])
                        .output();
                    match pr_out {
                        Ok(o) if o.status.success() => {
                            let url = String::from_utf8_lossy(&o.stdout).trim().to_string();
                            if !url.is_empty() {
                                let _ = write_log("codex", &format!("PR erstellt: {url}"));
                                pr_url = Some(url);
                            }
                        }
                        Ok(o) => {
                            let _ = write_log(
                                "codex",
                                &format!("gh pr create Hinweis: {}", String::from_utf8_lossy(&o.stderr).trim()),
                            );
                        }
                        Err(e) => {
                            let _ = write_log("codex", &format!("gh nicht verfuegbar: {e}"));
                        }
                    }
                }
                // Fallback: ohne erzeugten PR den GitHub "Compare & pull request"-Link anbieten.
                if pr_url.is_none() {
                    pr_url = repo_web.as_ref().map(|u| format!("{u}/pull/new/{branch}"));
                }
            }
            Err(e) => {
                let _ = write_log("codex", &format!("Warnung: git push fehlgeschlagen: {e}"));
            }
        }
    }

    // ---- Rueckkanal an den Server (best effort) ----
    let artifacts = json!({
        "branch": branch,
        "commit": commit,
        "runDir": run_dir,
        "deviceId": config.device.device_id,
        "changedFiles": changed_files,
        "exitCode": exit_code,
        "durationMs": started.elapsed().as_millis() as u64,
        "trigger": req.trigger,
        "dryRun": req.dry_run,
        "pushed": pushed,
        "branchUrl": branch_url.clone(),
        "prUrl": pr_url.clone(),
    });
    let mut body = json!({
        "idempotencyKey": format!("codex-{task_slug}-{run_stamp}"),
        "status": final_status,
        "message": codex_error.clone().unwrap_or_else(|| format!("{runner_label}-Lauf abgeschlossen")),
        "artifacts": artifacts,
    });
    if let Some(id) = &req.action_plan_id {
        body["actionPlanId"] = json!(id);
    }
    if let Some(id) = &req.action_task_id {
        body["actionTaskId"] = json!(id);
    }
    if let Some(id) = &req.briefing_id {
        body["briefingId"] = json!(id);
    }
    if let Err(e) = post_execution_result(&req.base_url, &body).await {
        let _ = write_log("codex", &format!("Warnung: execution-results POST fehlgeschlagen: {e}"));
    }
    if let Some(plan_id) = &req.action_plan_id {
        if let Err(e) = patch_action_plan_status_inner(&req.base_url, plan_id, final_status).await {
            let _ = write_log("codex", &format!("Warnung: Status {final_status} fehlgeschlagen: {e}"));
        }
    }
    // Task-Status: Erfolg = 'executed' (ausgefuehrt, wartet auf Merge/Verifikation), inkl. PR/Branch.
    if let Some(task_id) = &req.action_task_id {
        // Datei-Modus: kein PR/Merge-Check -> Task direkt als erledigt. Sonst "executed" (wartet auf Merge).
        let task_status = if final_status == "completed" {
            if file_mode { "completed" } else { "executed" }
        } else {
            final_status
        };
        if let Err(e) =
            patch_action_task_status_inner(&req.base_url, task_id, task_status, pr_url.as_deref(), Some(&branch))
                .await
        {
            let _ = write_log("codex", &format!("Warnung: Task-Status {task_status} fehlgeschlagen: {e}"));
        }
    }

    // Datei-Modus + Fehlschlag (kein Commit): evtl. von Codex geschriebene Teil-Dateien NICHT
    // mit auf den Default-Branch nehmen. Sonst bliebe der Arbeitsbaum dauerhaft schmutzig und
    // jeder weitere Lauf scheiterte am sauberer-Baum-Check. Auf den Ausgangszustand zuruecksetzen.
    if file_mode && commit.is_none() {
        let _ = git_capture(&repo_path, &["reset", "--hard"]);
        let _ = git_capture(&repo_path, &["clean", "-fd", "-e", ".katosync", "-e", "KatoContext"]);
    }
    // Zurueck auf den Default-Branch -> Arbeitskopie bleibt sauber; Codex-Aenderungen leben auf dem Branch.
    let _ = git_capture(&repo_path, &["checkout", &default_branch]);
    if file_mode && commit.is_some() {
        // Datei-Modus: Ergebnis in den Default-Branch mergen, damit es lokal im Ordner sichtbar ist
        // (kein GitHub-Push). Branch NUR loeschen, wenn der Merge wirklich gelang -> sonst ginge
        // der Ergebnis-Commit durch das force-Delete (-D) verloren.
        match git_capture(&repo_path, &["merge", "--ff-only", &branch]) {
            Ok(_) => {
                let _ = git_capture(&repo_path, &["branch", "-D", &branch]);
            }
            Err(e) => {
                let _ = write_log(
                    "codex",
                    &format!("Datei-Modus: ff-only-Merge fehlgeschlagen, Branch {branch} bleibt erhalten: {e}"),
                );
            }
        }
    } else if commit.is_none() {
        // Fehlgeschlagener Lauf ohne Commit -> leeren Codex-Branch wieder entfernen.
        let _ = git_capture(&repo_path, &["branch", "-D", &branch]);
    }

    let _ = write_log(
        "codex",
        &format!("{runner_label}-Lauf {final_status}: {} (Branch {branch})", sanitize_log(&req.title)),
    );

    Ok(CodexRunResult {
        status: final_status.to_string(),
        branch,
        run_dir,
        changed_files,
        commit,
        result_summary,
        exit_code,
        duration_ms: started.elapsed().as_millis() as u64,
        error: codex_error,
        pushed,
        branch_url,
        pr_url,
        file_mode,
    })
}

#[tauri::command]
async fn test_mistral_connection(api_key: Option<String>) -> Result<ApiCheckResponse, String> {
    let key = match api_key {
        Some(key) if !key.trim().is_empty() => key,
        _ => load_api_key().map_err(error_to_string)?,
    };
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.mistral.ai/v1/libraries?page_size=1")
        .bearer_auth(key.trim())
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|error| format!("Mistral ist nicht erreichbar: {error}"))?;
    if response.status().is_success() {
        let rate_limits = rate_limits_from_headers(response.headers());
        Ok(ApiCheckResponse {
            message: "Verbindung erfolgreich.".to_string(),
            rate_limits,
        })
    } else {
        Err(format!(
            "Mistral antwortete mit HTTP {}.",
            response.status()
        ))
    }
}

#[tauri::command]
async fn test_library(
    library_id: String,
    api_key: Option<String>,
) -> Result<ApiCheckResponse, String> {
    let library_id = library_id.trim();
    if library_id.is_empty() {
        return Err("Library ID darf nicht leer sein.".to_string());
    }
    let key = match api_key {
        Some(key) if !key.trim().is_empty() => key,
        _ => load_api_key().map_err(error_to_string)?,
    };
    let client = reqwest::Client::new();
    let url = format!("https://api.mistral.ai/v1/libraries/{library_id}");
    let response = client
        .get(url)
        .bearer_auth(key.trim())
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|error| format!("Library-Test fehlgeschlagen: {error}"))?;
    if response.status().is_success() {
        let rate_limits = rate_limits_from_headers(response.headers());
        Ok(ApiCheckResponse {
            message: "Library gefunden und erreichbar.".to_string(),
            rate_limits,
        })
    } else {
        Err(format!("Library-Test ergab HTTP {}.", response.status()))
    }
}

#[tauri::command]
async fn scan_project(config: AppConfig) -> Result<ScanSummary, String> {
    tauri::async_runtime::spawn_blocking(move || scan_roots(&config))
        .await
        .map_err(error_to_string)?
        .map_err(error_to_string)
}

#[tauri::command]
async fn run_sync(config: AppConfig, dry_run: Option<bool>, app: tauri::AppHandle) -> Result<SyncReport, String> {
    let effective_dry_run = dry_run.unwrap_or(config.safety.dry_run_default);
    if config.source_roots.iter().all(|root| root.trim().is_empty()) {
        return Err(
            "Kein Quellordner verbunden. Bitte zuerst in den Einstellungen einen Ordner hinzufuegen."
                .to_string(),
        );
    }
    save_config_inner(&config).map_err(error_to_string)?;
    sync_once(&config, effective_dry_run, Some(&app))
        .await
        .map_err(error_to_string)
}

#[tauri::command]
fn install_launch_agent(config: AppConfig) -> Result<LaunchAgentStatus, String> {
    save_config_inner(&config).map_err(error_to_string)?;
    let plist_path = launch_agent_path().map_err(error_to_string)?;
    let app_binary = current_exe_for_launch_agent().map_err(error_to_string)?;
    let stdout = logs_dir()
        .map_err(error_to_string)?
        .join("launch-agent.out.log");
    let stderr = logs_dir()
        .map_err(error_to_string)?
        .join("launch-agent.err.log");
    fs::create_dir_all(logs_dir().map_err(error_to_string)?).map_err(error_to_string)?;

    let plist = render_launch_agent_plist(&app_binary, &stdout, &stderr, &config.schedule);
    fs::write(&plist_path, plist).map_err(error_to_string)?;

    let _ = Command::new("launchctl")
        .arg("unload")
        .arg(&plist_path)
        .output();
    let output = Command::new("launchctl")
        .arg("load")
        .arg(&plist_path)
        .output()
        .map_err(error_to_string)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    launch_agent_status()
}

#[tauri::command]
fn remove_launch_agent() -> Result<LaunchAgentStatus, String> {
    let plist_path = launch_agent_path().map_err(error_to_string)?;
    if plist_path.exists() {
        let _ = Command::new("launchctl")
            .arg("unload")
            .arg(&plist_path)
            .output();
        fs::remove_file(&plist_path).map_err(error_to_string)?;
    }
    launch_agent_status()
}

#[tauri::command]
fn launch_agent_status() -> Result<LaunchAgentStatus, String> {
    let plist_path = launch_agent_path().map_err(error_to_string)?;
    let installed = plist_path.exists();
    let output = Command::new("launchctl")
        .arg("list")
        .arg(LAUNCH_AGENT_ID)
        .output();
    let loaded = output
        .as_ref()
        .map(|out| out.status.success())
        .unwrap_or(false);
    Ok(LaunchAgentStatus {
        installed,
        loaded,
        plist_path: plist_path.to_string_lossy().to_string(),
        message: if installed && loaded {
            "LaunchAgent installiert und geladen.".to_string()
        } else if installed {
            "LaunchAgent installiert, aber aktuell nicht geladen.".to_string()
        } else {
            "LaunchAgent nicht installiert.".to_string()
        },
    })
}

#[tauri::command]
fn read_logs() -> Result<String, String> {
    let sync = logs_dir().map_err(error_to_string)?.join("sync.log");
    let errors = logs_dir().map_err(error_to_string)?.join("error.log");
    let mut content = String::new();
    if sync.exists() {
        content.push_str("== sync.log ==\n");
        content.push_str(&read_log_tail(&sync, 80_000).map_err(error_to_string)?);
    }
    if errors.exists() {
        content.push_str("\n== error.log ==\n");
        content.push_str(&read_log_tail(&errors, 80_000).map_err(error_to_string)?);
    }
    Ok(content)
}

#[tauri::command]
fn open_output_dir() -> Result<String, String> {
    let config = load_config_inner().map_err(error_to_string)?;
    let output_dir = PathBuf::from(config.output_dir);
    fs::create_dir_all(&output_dir).map_err(error_to_string)?;
    opener_command(&output_dir).map_err(error_to_string)?;
    Ok(output_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

async fn run_headless_sync() -> Result<()> {
    let config = load_config_inner()?;
    if !config.schedule.enabled {
        write_log(
            "sync",
            "Headless-Sync übersprungen: lokaler Uploadplan deaktiviert.",
        )?;
        return Ok(());
    }
    let _ = sync_once(&config, false, None).await?;
    Ok(())
}

async fn sync_once(config: &AppConfig, dry_run: bool, app: Option<&AppHandle>) -> Result<SyncReport> {
    let started_at = now_string();
    write_log("sync", &format!("Sync gestartet dry_run={dry_run}"))?;
    let scan = scan_roots(config)?;
    let mut warnings = Vec::new();
    let mut errors = Vec::new();
    let output_dir = PathBuf::from(&config.output_dir);
    let date = Local::now().format("%Y-%m-%d").to_string();
    let snapshot_dir = output_dir.join("snapshots").join(&date);

    fs::create_dir_all(&snapshot_dir)?;
    fs::create_dir_all(&output_dir)?;

    let current_files =
        write_current_files(config, &scan, &output_dir, &snapshot_dir, &mut warnings)?;
    let mut uploaded = Vec::new();

    if dry_run {
        write_log("sync", "Dry-Run: Upload zu Mistral übersprungen.")?;
    } else {
        let key = load_api_key()?;
        if config.library_id.trim().is_empty() {
            errors.push("Library ID fehlt.".to_string());
        } else {
            let files = upload_order(&output_dir, config, &scan);
            let total = files.len();
            for (idx, file_path) in files.into_iter().enumerate() {
                if let Some(app) = app {
                    let _ = app.emit(
                        "sync-event",
                        json!({
                            "phase": "uploading",
                            "file": file_path.file_name().and_then(OsStr::to_str).unwrap_or(""),
                            "index": idx + 1,
                            "total": total,
                        }),
                    );
                }
                // Prune (alte Versionen loeschen) nur wenn ausdruecklich gewuenscht: es macht pro
                // Datei einen Extra-Request und treibt das Mistral-Rate-Limit (429) hoch. Default
                // AUS -> weniger Requests, die Uploads (v.a. die Quelldokumente) gehen zuerst durch.
                // Nachteil ohne Prune: erneuter Sync derselben Datei kann eine Dublette anlegen.
                if config.scan_rules.dedupe_uploads {
                    if let Some(file_name) = file_path.file_name().and_then(OsStr::to_str) {
                        match prune_existing_document_versions(&key, &config.library_id, file_name)
                            .await
                        {
                            Ok(deleted) if deleted > 0 => {
                                let message = format!(
                                    "{deleted} alte Mistral-Dokumentversion(en) für {file_name} entfernt."
                                );
                                write_log("sync", &message)?;
                                warnings.push(message);
                            }
                            Ok(_) => {}
                            Err(error) => {
                                let message = format!(
                                    "Vorhandene Versionen für {file_name} konnten nicht bereinigt werden: {error:#}"
                                );
                                write_log("warn", &message)?;
                                warnings.push(message);
                            }
                        }
                    }
                }
                match upload_with_backoff(&key, &config.library_id, &file_path, app).await {
                    Ok(result) => uploaded.push(result),
                    Err(error) => {
                        let message = format!(
                            "Upload fehlgeschlagen für {}: {error:#}",
                            file_path.file_name().and_then(OsStr::to_str).unwrap_or("?")
                        );
                        write_log("error", &message)?;
                        errors.push(message);
                        // Anhaltendes Rate-Limit: die naechsten Dateien wuerden ebenfalls 429 ->
                        // den GANZEN Sync abbrechen, statt jede Datei einzeln durch den Backoff zu
                        // schicken (sonst N x ~100s, das fuehlt sich wie "haengt ewig" an).
                        if error.to_string().contains("429")
                            || error.to_string().contains("Rate-Limit")
                            || error.to_string().contains("Tageslimit")
                        {
                            let remaining = total.saturating_sub(idx + 1);
                            let is_day = error.to_string().contains("Tageslimit");
                            if remaining > 0 {
                                errors.push(if is_day {
                                    format!(
                                        "Tageslimit für Dokument-Verarbeitung erreicht - {remaining} weitere Datei(en) heute nicht hochladbar. Morgen erneut synchronisieren oder höheren Mistral-Plan (Scale) wählen."
                                    )
                                } else {
                                    format!(
                                        "Rate-Limit erreicht - {remaining} weitere Datei(en) nicht hochgeladen. Bitte in ~1 Minute erneut synchronisieren."
                                    )
                                });
                            }
                            if let Some(app) = app {
                                let phase = if is_day {
                                    "rate_limit_abort_day"
                                } else {
                                    "rate_limit_abort"
                                };
                                let _ = app.emit(
                                    "sync-event",
                                    json!({ "phase": phase, "remaining": remaining }),
                                );
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    let finished_at = now_string();
    let report = SyncReport {
        started_at,
        finished_at,
        output_dir: output_dir.to_string_lossy().to_string(),
        snapshot_dir: snapshot_dir.to_string_lossy().to_string(),
        dry_run,
        scan,
        current_files,
        uploaded,
        warnings,
        errors,
    };
    write_log("sync", &sync_report_summary(&report))?;
    write_last_report(&report)?;
    Ok(report)
}

fn scan_roots(config: &AppConfig) -> Result<ScanSummary> {
    let mut findings = Vec::new();
    let mut scanned_files = 0usize;
    let mut relevant_files = 0usize;
    let mut skipped_files = 0usize;
    let mut secret_warnings = 0usize;

    for root in config
        .source_roots
        .iter()
        .filter(|root| !root.trim().is_empty())
    {
        let root_path = PathBuf::from(root);
        if !root_path.exists() {
            findings.push(FileFinding {
                path: root.clone(),
                relative_path: root.clone(),
                category: "missing".to_string(),
                size_bytes: 0,
                modified_at: "-".to_string(),
                skipped: true,
                reason: Some("Ordner nicht gefunden".to_string()),
            });
            skipped_files += 1;
            continue;
        }
        for entry in WalkDir::new(&root_path)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| should_enter(entry, config))
        {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            if !entry.file_type().is_file() {
                continue;
            }
            if is_apple_metadata_file(entry.path()) {
                continue;
            }
            scanned_files += 1;
            let path = entry.path().to_path_buf();
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            let relative_path = path
                .strip_prefix(&root_path)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();
            let mut category = categorize_file(&path, &config.scan_rules);
            let mut skipped = false;
            let mut reason = None;

            let has_secret = config.safety.secret_scan_enabled
                && (file_name_has_secret_marker(&path)
                    || (category != "ignore" && file_content_has_secret(&path)?));

            if has_secret {
                skipped = true;
                secret_warnings += 1;
                reason = Some("Secret-Muster erkannt".to_string());
                if category == "ignore" {
                    category = "secret".to_string();
                }
            } else if category == "ignore" {
                skipped = true;
                reason = Some("Dateityp oder Name nicht relevant".to_string());
            } else if metadata.len() > config.scan_rules.max_file_size_mb * 1024 * 1024 {
                skipped = true;
                reason = Some("Datei größer als Maximalgröße".to_string());
            }

            if skipped {
                skipped_files += 1;
            } else {
                relevant_files += 1;
            }

            findings.push(FileFinding {
                path: path.to_string_lossy().to_string(),
                relative_path,
                category,
                size_bytes: metadata.len(),
                modified_at: format_system_time(metadata.modified().unwrap_or(UNIX_EPOCH)),
                skipped,
                reason,
            });
        }
    }

    Ok(ScanSummary {
        scanned_files,
        relevant_files,
        skipped_files,
        secret_warnings,
        findings,
    })
}

fn write_current_files(
    config: &AppConfig,
    scan: &ScanSummary,
    output_dir: &Path,
    snapshot_dir: &Path,
    warnings: &mut Vec<String>,
) -> Result<Vec<String>> {
    let date = Local::now().format("%Y-%m-%d").to_string();
    let relevant: Vec<&FileFinding> = scan
        .findings
        .iter()
        .filter(|finding| !finding.skipped && finding.category != "ignore")
        .collect();
    let areas = project_areas(&relevant);

    for finding in &relevant {
        let src = PathBuf::from(&finding.path);
        let safe = safe_filename(&finding.relative_path);
        let target = snapshot_dir.join(safe);
        if let Err(error) = fs::copy(&src, target) {
            warnings.push(format!(
                "Konnte Datei nicht kopieren: {} ({error})",
                finding.relative_path
            ));
        }
    }

    let manifest = output_dir.join(current_file_name(config, "CURRENT_MANIFEST", "md"));
    let index = output_dir.join(current_file_name(config, "CURRENT_SNAPSHOT_INDEX", "md"));
    let status_all = output_dir.join(current_file_name(
        config,
        "CURRENT_PROJECT_STATUS_ALL",
        "md",
    ));
    let memory_all = output_dir.join(current_file_name(config, "CURRENT_MEMORY_ALL", "md"));
    let brief_md = output_dir.join(current_file_name(
        config,
        "CURRENT_MISTRAL_BRIEFING_SOURCE",
        "md",
    ));
    let brief_txt = output_dir.join(current_file_name(
        config,
        "CURRENT_MISTRAL_BRIEFING_SOURCE",
        "txt",
    ));

    fs::write(&manifest, render_manifest(config, scan, &date, warnings))?;
    fs::write(&index, render_index(config, scan, &date, &areas))?;
    fs::write(
        &status_all,
        render_aggregate(config, &relevant, &["status", "roadmap"], &date)?,
    )?;
    fs::write(
        &memory_all,
        render_aggregate(config, &relevant, &["memory"], &date)?,
    )?;
    let briefing = render_briefing(config, scan, &date, &areas, &status_all, &memory_all)?;
    fs::write(&brief_md, &briefing)?;
    fs::write(&brief_txt, &briefing)?;

    let files = vec![brief_md, brief_txt, status_all, memory_all, index, manifest]
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect();
    Ok(files)
}

fn render_manifest(
    config: &AppConfig,
    scan: &ScanSummary,
    date: &str,
    warnings: &[String],
) -> String {
    let mut text = String::new();
    text.push_str(&format!("# CURRENT MANIFEST - KatoSync {date}\n\n"));
    text.push_str("_Created by NMK Solutions_\n\n");
    text.push_str(&format!("- App-Version: `{}`\n", APP_VERSION));
    text.push_str(&format!(
        "- Gerät: `{}` (`{}`)\n",
        config.device.device_name, config.device.device_id
    ));
    text.push_str(&format!("- Library ID: `{}`\n", config.library_id));
    text.push_str(&format!("- Output: `{}`\n", config.output_dir));
    text.push_str(&format!("- Gescannt: {}\n", scan.scanned_files));
    text.push_str(&format!("- Relevant: {}\n", scan.relevant_files));
    text.push_str(&format!("- Übersprungen: {}\n", scan.skipped_files));
    text.push_str(&format!("- Secret-Warnungen: {}\n", scan.secret_warnings));
    text.push_str("\n## Quellordner\n\n");
    for root in &config.source_roots {
        text.push_str(&format!("- `{root}`\n"));
    }
    text.push_str("\n## Warnungen\n\n");
    if warnings.is_empty() {
        text.push_str("- Keine\n");
    } else {
        for warning in warnings {
            text.push_str(&format!("- {warning}\n"));
        }
    }
    text
}

fn render_index(config: &AppConfig, scan: &ScanSummary, date: &str, areas: &[String]) -> String {
    let mut text = String::new();
    text.push_str(&format!("# CURRENT SNAPSHOT INDEX - {date}\n\n"));
    text.push_str("_Kompakte Agenten-Übersicht. Created by NMK Solutions._\n\n");
    text.push_str(&format!(
        "- Gerät: `{}` (`{}`)\n",
        config.device.device_name, config.device.device_id
    ));
    text.push_str(&format!("- Dateien gesamt: {}\n", scan.scanned_files));
    text.push_str(&format!("- Relevante Dateien: {}\n", scan.relevant_files));
    text.push_str(&format!("- Übersprungen: {}\n\n", scan.skipped_files));
    text.push_str("## Erkannte Projektbereiche\n\n");
    for area in areas {
        text.push_str(&format!("- {area}\n"));
    }
    text.push_str("\n## Dateien\n\n");
    text.push_str("| Datei | Kategorie | Geändert | Größe | Status |\n");
    text.push_str("|---|---|---|---:|---|\n");
    for finding in &scan.findings {
        let status = finding.reason.as_deref().unwrap_or("bereit");
        text.push_str(&format!(
            "| {} | {} | {} | {} | {} |\n",
            finding.relative_path,
            finding.category,
            finding.modified_at,
            finding.size_bytes,
            status
        ));
    }
    text
}

fn render_aggregate(
    config: &AppConfig,
    files: &[&FileFinding],
    categories: &[&str],
    date: &str,
) -> Result<String> {
    let title = if categories.contains(&"memory") {
        "GESAMMELTE MEMORY"
    } else {
        "ÜBERGREIFENDER PROJEKTSTATUS"
    };
    let mut text = String::new();
    text.push_str(&format!("# {title} - {date}\n\n"));
    text.push_str("_Automatisch gebündelt. Created by NMK Solutions._\n\n");
    text.push_str(&format!(
        "- Gerät: `{}` (`{}`)\n\n",
        config.device.device_name, config.device.device_id
    ));
    for finding in files {
        if !categories
            .iter()
            .any(|category| finding.category == *category)
        {
            continue;
        }
        let path = PathBuf::from(&finding.path);
        let content = fs::read_to_string(&path)
            .unwrap_or_else(|_| "[Datei konnte nicht gelesen werden]".to_string());
        text.push_str(&format!("## {}\n\n", finding.relative_path));
        text.push_str(&format!("- Original: `{}`\n", finding.path));
        text.push_str(&format!("- Geändert: {}\n\n", finding.modified_at));
        text.push_str("```markdown\n");
        text.push_str(&first_lines(&content, 240));
        text.push_str("\n```\n\n---\n\n");
    }
    Ok(text)
}

fn render_briefing(
    config: &AppConfig,
    scan: &ScanSummary,
    date: &str,
    areas: &[String],
    status_all: &Path,
    memory_all: &Path,
) -> Result<String> {
    let mut text = String::new();
    text.push_str("# AKTUELLE PROJEKTGRUNDLAGE FÜR MISTRAL-AGENTEN\n\n");
    text.push_str("**Diese Datei ist die aktuelle Projektgrundlage für Mistral-Agenten.**\n");
    text.push_str(&format!("_Created by NMK Solutions - Stand: {date}_\n\n"));
    text.push_str(&format!(
        "- Gerät: `{}` (`{}`)\n",
        config.device.device_name, config.device.device_id
    ));
    text.push_str(&format!(
        "- Gesammelte Dateien: {} relevant, {} übersprungen\n",
        scan.relevant_files, scan.skipped_files
    ));
    text.push_str(&format!("- Secret-Warnungen: {}\n\n", scan.secret_warnings));
    text.push_str("## Wichtigste Projektbereiche\n\n");
    for area in areas {
        text.push_str(&format!("- {area}\n"));
    }
    text.push_str("\n## Gesammelte Status-Dateien\n\n");
    for finding in scan.findings.iter().filter(|finding| {
        !finding.skipped && (finding.category == "status" || finding.category == "roadmap")
    }) {
        text.push_str(&format!("- {}\n", finding.relative_path));
    }
    text.push_str("\n## Zusammengefasster Projektstatus\n\n");
    text.push_str(&fs::read_to_string(status_all).unwrap_or_default());
    text.push_str("\n## Memory-Zusammenfassung\n\n");
    text.push_str(&fs::read_to_string(memory_all).unwrap_or_default());
    text.push_str("\n## Hinweise\n\n");
    text.push_str("- CURRENT-Dateien sind der aktuelle Stand.\n");
    text.push_str("- Datierte Snapshot-Ordner dienen nur als lokales Archiv.\n");
    text.push_str("- Dateien mit Secret-Mustern werden nicht hochgeladen.\n");
    Ok(text)
}

fn upload_order(output_dir: &Path, config: &AppConfig, scan: &ScanSummary) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = Vec::new();
    // ZUERST die echten Quelldokumente (PDF/Bilder/Text, z.B. die Stellenanzeige): das ist der
    // wichtigste Inhalt fuer Mistral/Helena. Frueher standen sie ganz hinten und wurden von den
    // CURRENT-Metadaten + einem einsetzenden Rate-Limit verdraengt -> die PDF kam nie in die Library.
    if config.scan_rules.include_documents {
        files.extend(
            scan.findings
                .iter()
                .filter(|finding| !finding.skipped && finding.category == "document")
                .map(|finding| PathBuf::from(&finding.path)),
        );
    }
    // Danach die CURRENT-Manifeste/Indizes (Metadaten/Briefing-Quelle).
    files.extend(
        [
            current_file_name(config, "CURRENT_MISTRAL_BRIEFING_SOURCE", "md"),
            current_file_name(config, "CURRENT_MISTRAL_BRIEFING_SOURCE", "txt"),
            current_file_name(config, "CURRENT_PROJECT_STATUS_ALL", "md"),
            current_file_name(config, "CURRENT_MEMORY_ALL", "md"),
            current_file_name(config, "CURRENT_SNAPSHOT_INDEX", "md"),
            current_file_name(config, "CURRENT_MANIFEST", "md"),
        ]
        .into_iter()
        .map(|name| output_dir.join(name)),
    );
    if config.scan_rules.upload_individual_status_files {
        files.extend(
            scan.findings
                .iter()
                .filter(|finding| {
                    !finding.skipped
                        && (finding.category == "status" || finding.category == "roadmap")
                })
                .take(config.scan_rules.max_individual_uploads)
                .map(|finding| PathBuf::from(&finding.path)),
        );
    }
    files
}

fn current_file_name(config: &AppConfig, stem: &str, extension: &str) -> String {
    let device = device_slug(config);
    format!("{stem}__{device}.{extension}")
}

fn device_slug(config: &AppConfig) -> String {
    let name = slugify(&config.device.device_name);
    let id = slugify(&config.device.device_id);
    let short_id = id
        .chars()
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    match (name.is_empty(), short_id.is_empty()) {
        (false, false) => format!("{name}_{short_id}"),
        (false, true) => name,
        (true, false) => short_id,
        (true, true) => "device".to_string(),
    }
}

fn slugify(value: &str) -> String {
    let mut output = String::new();
    let mut previous_dash = false;
    for ch in value.to_lowercase().chars() {
        let normalized = match ch {
            'ä' => 'a',
            'ö' => 'o',
            'ü' => 'u',
            'ß' => 's',
            'a'..='z' | '0'..='9' => ch,
            _ => '-',
        };
        if normalized == '-' {
            if !previous_dash && !output.is_empty() {
                output.push('-');
                previous_dash = true;
            }
        } else {
            output.push(normalized);
            previous_dash = false;
        }
    }
    output.trim_matches('-').to_string()
}

// Mistral-HTTP-Client MIT Timeouts. Ohne das kann ein haengender Request (Mistral nimmt den
// Upload an, haelt die Antwort beim serverseitigen Verarbeiten aber offen) den Sync endlos
// blockieren -> der Sync-Button dreht ewig. connect_timeout fuer tote Verbindungen, timeout
// als harte Obergrenze fuer die Gesamtdauer (inkl. Response-Body). Fallback auf Default-Client.
fn mistral_client(timeout_secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

async fn prune_existing_document_versions(
    api_key: &str,
    library_id: &str,
    file_name: &str,
) -> Result<usize> {
    let client = mistral_client(60);
    let mut deleted = 0;
    // Wenige Seiten reichen (nach created_at desc sortiert -> neueste/relevante Versionen zuerst);
    // 20 Seiten waeren unnoetig viele Requests und treiben das Rate-Limit hoch.
    for page in 0..3 {
        let url = format!("https://api.mistral.ai/v1/libraries/{library_id}/documents");
        let response = client
            .get(&url)
            .bearer_auth(api_key.trim())
            .header("User-Agent", USER_AGENT)
            .query(&[
                ("search", file_name),
                ("page_size", "100"),
                ("page", &page.to_string()),
                ("sort_by", "created_at"),
                ("sort_order", "desc"),
            ])
            .send()
            .await?;
        let status = response.status();
        let value: serde_json::Value = response.json().await.unwrap_or_else(|_| json!({}));
        if !status.is_success() {
            return Err(anyhow!("HTTP {status}: {}", sanitize_json(&value)));
        }
        let Some(documents) = value.get("data").and_then(|data| data.as_array()) else {
            break;
        };
        if documents.is_empty() {
            break;
        }
        for document in documents {
            let name_matches = document
                .get("name")
                .and_then(|name| name.as_str())
                .is_some_and(|name| name == file_name);
            if !name_matches {
                continue;
            }
            let Some(document_id) = document.get("id").and_then(|id| id.as_str()) else {
                continue;
            };
            delete_library_document(&client, api_key, library_id, document_id).await?;
            deleted += 1;
        }
        if documents.len() < 100 {
            break;
        }
    }
    Ok(deleted)
}

async fn delete_library_document(
    client: &reqwest::Client,
    api_key: &str,
    library_id: &str,
    document_id: &str,
) -> Result<()> {
    let url = format!("https://api.mistral.ai/v1/libraries/{library_id}/documents/{document_id}");
    let response = client
        .delete(url)
        .bearer_auth(api_key.trim())
        .header("User-Agent", USER_AGENT)
        .send()
        .await?;
    let status = response.status();
    if status == StatusCode::NO_CONTENT || status.is_success() {
        Ok(())
    } else {
        let value: serde_json::Value = response.json().await.unwrap_or_else(|_| json!({}));
        Err(anyhow!("HTTP {status}: {}", sanitize_json(&value)))
    }
}

async fn upload_with_backoff(
    api_key: &str,
    library_id: &str,
    file_path: &Path,
    app: Option<&AppHandle>,
) -> Result<UploadResult> {
    // Kuerzerer, interaktiv-tauglicher Backoff (statt 30/60/120 = bis 3,5 Min stumm): 10/30/60s,
    // gibt dem Minuten-Limit eine Chance zu resetten, blockiert den Sync-Button aber nicht ewig.
    let waits = [10_u64, 30, 60];
    let file_name = file_path.file_name().and_then(OsStr::to_str).unwrap_or("");
    for attempt in 0..=waits.len() {
        match upload_document(api_key, library_id, file_path).await {
            Ok(result) => return Ok(result),
            // Monats-Token-Budget ODER Tages-Dokumentlimit erschoepft: Backoff/Retry hilft heute NICHT
            // -> sofort scheitern (statt 4x sinnlos zu grinden + das Minuten-Limit hochzutreiben).
            Err(error)
                if error.to_string().contains("Monats")
                    || error.to_string().contains("Tageslimit") =>
            {
                return Err(error)
            }
            Err(error) if error.to_string().contains("HTTP 429") => {
                if attempt < waits.len() {
                    write_log(
                        "sync",
                        &format!(
                            "Mistral-Rate-Limit für {}. Neuer Versuch in {}s ({}/{}).",
                            file_path.display(),
                            waits[attempt],
                            attempt + 2,
                            waits.len() + 1
                        ),
                    )?;
                    // Sichtbar machen, dass der Sync NICHT haengt, sondern auf das Rate-Limit wartet.
                    if let Some(app) = app {
                        let _ = app.emit(
                            "sync-event",
                            json!({
                                "phase": "rate_limit",
                                "file": file_name,
                                "attempt": attempt + 2,
                                "total": waits.len() + 1,
                                "waitSecs": waits[attempt],
                            }),
                        );
                    }
                    sleep(Duration::from_secs(waits[attempt])).await;
                } else {
                    return Err(anyhow!(
                        "Mistral-Rate-Limit (HTTP 429) erreicht. Bitte kurz warten und erneut synchronisieren."
                    ));
                }
            }
            Err(error) => return Err(error),
        }
    }
    Err(anyhow!(
        "Mistral-Rate-Limit (HTTP 429) erreicht. Bitte kurz warten und erneut synchronisieren."
    ))
}

async fn upload_document(
    api_key: &str,
    library_id: &str,
    file_path: &Path,
) -> Result<UploadResult> {
    let file_name = file_path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| anyhow!("Ungültiger Dateiname"))?
        .to_string();
    // Secrets nie hochladen: Dateiname-Marker greift fuer Text UND Binaer (.env/.key/.pem/...).
    if file_name_has_secret_marker(file_path) {
        return Ok(UploadResult {
            file_name,
            document_id: None,
            processing_status: None,
            rate_limits: Vec::new(),
            success: false,
            error: Some("Secret-Datei vom Upload ausgeschlossen.".to_string()),
        });
    }

    let lower = file_name.to_lowercase();
    let is_binary = lower.ends_with(".pdf")
        || lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg");

    let (bytes, mime): (Vec<u8>, &str) = if is_binary {
        // Binaer (PDF/Bild): direkt als Bytes hochladen. Inhalts-Secret-Scan ist auf
        // Binaerdaten nicht moeglich -> Schutz ueber Dateiname + Ordner-Ausschluss (Scan).
        let data = fs::read(file_path)
            .with_context(|| format!("Datei kann nicht gelesen werden: {}", file_path.display()))?;
        let mime = if lower.ends_with(".pdf") {
            "application/pdf"
        } else if lower.ends_with(".png") {
            "image/png"
        } else {
            "image/jpeg"
        };
        (data, mime)
    } else {
        let content = fs::read_to_string(file_path)
            .with_context(|| format!("Datei kann nicht gelesen werden: {}", file_path.display()))?;
        if secret_regex().is_match(&content) {
            return Ok(UploadResult {
                file_name,
                document_id: None,
                processing_status: None,
                rate_limits: Vec::new(),
                success: false,
                error: Some("Secret-Muster im Upload-Inhalt erkannt.".to_string()),
            });
        }
        let mime = if lower.ends_with(".txt") {
            "text/plain"
        } else if lower.ends_with(".json") {
            "application/json"
        } else if lower.ends_with(".csv") {
            "text/csv"
        } else {
            "text/markdown"
        };
        (content.into_bytes(), mime)
    };

    let url = format!("https://api.mistral.ai/v1/libraries/{library_id}/documents");
    let part = Part::bytes(bytes)
        .file_name(file_name.clone())
        .mime_str(mime)?;
    let form = Form::new().part("file", part);
    // Grosszuegiger Upload-Timeout (180s) -> erlaubt langsame, aber fortschreitende Uploads,
    // bricht aber einen echten Haenger ab, statt den Sync-Button ewig drehen zu lassen.
    let response = mistral_client(180)
        .post(url)
        .bearer_auth(api_key.trim())
        .header("User-Agent", USER_AGENT)
        .multipart(form)
        .send()
        .await?;

    let status = response.status();
    let headers = response.headers();
    // 429 transparent machen: echte Reset-Zeit (retry-after) und ob das Monats-Token-Budget leer
    // ist (dann hilft kurzes Warten NICHT) aus den Headern ziehen.
    let retry_after = headers
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string());
    let monthly_exhausted = header_string(headers, "x-ratelimit-remaining-tokens-month")
        .map(|v| v.trim() == "0")
        .unwrap_or(false);
    // Tages-Dokumentlimit (eigene Mistral-Kategorie, getrennt von Minuten-Takt + Monats-Token):
    // ist es 0, hilft Backoff/Warten HEUTE nicht -> wie beim Monat sofort permanent scheitern.
    let document_day_exhausted = header_string(headers, "x-ratelimit-remaining-document-day")
        .map(|v| v.trim() == "0")
        .unwrap_or(false);
    let rate_limits = rate_limits_from_headers(headers);
    let value: serde_json::Value = response.json().await.unwrap_or_else(|_| json!({}));
    if status == StatusCode::TOO_MANY_REQUESTS {
        if monthly_exhausted {
            return Err(anyhow!(
                "HTTP 429 Rate-Limit: Mistral-Monats-Token-Budget erschöpft. Kurzes Warten hilft nicht - höheres Plan/Kontingent nötig oder bis zum Monatswechsel warten."
            ));
        }
        if document_day_exhausted {
            return Err(anyhow!(
                "HTTP 429 Tageslimit: Mistrals Tageslimit für Dokument-Verarbeitung ist heute aufgebraucht. Warten hilft heute NICHT - es setzt erst nach ~24h zurück; für mehr einen höheren Mistral-Plan (Scale/Pay-as-you-go) wählen."
            ));
        }
        let hint = retry_after
            .map(|ra| format!(" (zuruecksetzen in ~{ra}s)"))
            .unwrap_or_default();
        return Err(anyhow!("HTTP 429 Rate-Limit{hint}"));
    }
    if !status.is_success() {
        return Err(anyhow!("HTTP {status}: {}", sanitize_json(&value)));
    }

    Ok(UploadResult {
        file_name,
        document_id: value
            .get("id")
            .and_then(|id| id.as_str())
            .map(ToOwned::to_owned),
        processing_status: value
            .get("processing_status")
            .and_then(|status| status.as_str())
            .map(ToOwned::to_owned),
        rate_limits,
        success: true,
        error: None,
    })
}

fn rate_limits_from_headers(headers: &reqwest::header::HeaderMap) -> Vec<RateLimitMetric> {
    let pairs = [
        (
            "Anfragen/Minute",
            "x-ratelimit-limit-req-minute",
            "x-ratelimit-remaining-req-minute",
            "x-ratelimit-reset-req-minute",
        ),
        (
            "Tokens/Minute",
            "x-ratelimit-limit-tokens-minute",
            "x-ratelimit-remaining-tokens-minute",
            "x-ratelimit-reset-tokens-minute",
        ),
        (
            "Tokens/5 Minuten",
            "x-ratelimit-limit-tokens-5-minute",
            "x-ratelimit-remaining-tokens-5-minute",
            "x-ratelimit-reset-tokens-5-minute",
        ),
        (
            "Tokens/Monat",
            "x-ratelimit-limit-tokens-month",
            "x-ratelimit-remaining-tokens-month",
            "x-ratelimit-reset-tokens-month",
        ),
        // Dokument-Verarbeitung (eigene Mistral-Kategorie) -> sonst sieht der Nutzer genau das Limit,
        // das Uploads blockiert (Dokumente/Tag), nie. Erscheint zuverlaessig auf der POST-/documents-Antwort.
        (
            "Dokumente/Minute",
            "x-ratelimit-limit-document-minute",
            "x-ratelimit-remaining-document-minute",
            "x-ratelimit-reset-document-minute",
        ),
        (
            "Dokumente/Tag",
            "x-ratelimit-limit-document-day",
            "x-ratelimit-remaining-document-day",
            "x-ratelimit-reset-document-day",
        ),
    ];
    pairs
        .iter()
        .filter_map(|(label, limit, remaining, reset)| {
            let limit_value = header_string(headers, limit);
            let remaining_value = header_string(headers, remaining);
            let reset_value = header_string(headers, reset);
            if limit_value.is_none() && remaining_value.is_none() && reset_value.is_none() {
                None
            } else {
                Some(RateLimitMetric {
                    label: (*label).to_string(),
                    limit: limit_value,
                    remaining: remaining_value,
                    reset: reset_value,
                })
            }
        })
        .collect()
}

fn header_string(headers: &reqwest::header::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned)
}

fn should_enter(entry: &DirEntry, config: &AppConfig) -> bool {
    if !entry.file_type().is_dir() {
        return true;
    }
    let name = entry.file_name().to_string_lossy().to_lowercase();
    let blocked_names = [
        ".git",
        ".katosync",
        "katoresults",
        "katocontext",
        "node_modules",
        ".env",
        "secrets",
        "private",
        "keys",
        "credentials",
        "deriveddata",
        ".build",
        "target",
        ".gradle",
        ".idea",
        ".next",
        ".nuxt",
        ".turbo",
        ".cache",
        "coverage",
        "carthage",
        "pods",
        ".swiftpm",
        "venv",
        ".venv",
        "dist",
        "build",
        "backup",
        "archive",
        "archiv",
        "__macosx",
        "__pycache__",
        "old",
    ];
    if blocked_names.iter().any(|blocked| name.contains(blocked)) {
        return false;
    }
    // Referenzordner (KatoContext-Quelle: CV/Zeugnisse) NIE in die Mistral-Library scannen, auch wenn
    // er (oder ein Elternordner) zugleich als Quellordner gewaehlt ist.
    let reference = config.reference_root.trim().trim_end_matches('/');
    if !reference.is_empty() && entry.path().starts_with(reference) {
        return false;
    }
    let output = PathBuf::from(&config.output_dir);
    !entry.path().starts_with(output)
}

fn is_apple_metadata_file(path: &Path) -> bool {
    let name = path.file_name().and_then(OsStr::to_str).unwrap_or_default();
    name == ".DS_Store" || name.starts_with("._")
}

fn categorize_file(path: &Path, rules: &ScanRules) -> String {
    let name = path
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_lowercase();
    let extension = path
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_lowercase();
    // Binaere Dokumente (PDF/Bilder) gibt es nur im Dokument-Modus und immer als Kategorie "document";
    // sie koennen nicht als Text-Aggregat gerendert werden.
    let is_binary_doc_ext =
        extension == "pdf" || extension == "png" || extension == "jpg" || extension == "jpeg";
    if is_binary_doc_ext {
        if rules.include_documents {
            return "document".to_string();
        }
        return "ignore".to_string();
    }
    let is_text_ext = extension == "md"
        || extension == "txt"
        || extension == "json"
        || (rules.include_csv && extension == "csv");
    if !is_text_ext {
        return "ignore".to_string();
    }
    if name.contains("memory") && rules.include_memory {
        return "memory".to_string();
    }
    if name.contains("projektstatus")
        || name.contains("project_status")
        || name.contains("projectstatus")
        || name.contains("statusflow")
        || name.contains("briefing")
        || name.contains("summary")
    {
        return "status".to_string();
    }
    if name.contains("roadmap") && rules.include_roadmaps {
        return "roadmap".to_string();
    }
    if (name.contains("todo") || name.contains("tasks") || name.contains("open_tasks"))
        && rules.include_tasks
    {
        return "task".to_string();
    }
    // Beliebige andere Text-Datei: im Dokument-Modus als allgemeines Dokument behandeln.
    if rules.include_documents {
        return "document".to_string();
    }
    "ignore".to_string()
}

fn file_name_has_secret_marker(path: &Path) -> bool {
    let name = path.file_name().and_then(OsStr::to_str).unwrap_or_default();
    secret_filename_regex().is_match(name)
}

fn file_content_has_secret(path: &Path) -> Result<bool> {
    let content = fs::read_to_string(path).unwrap_or_default();
    Ok(secret_regex().is_match(&content))
}

fn secret_regex() -> Regex {
    Regex::new(
        r"(?i)(API_KEY\s*=|SECRET\s*=|TOKEN\s*=|PASSWORD\s*=|PRIVATE_KEY|BEGIN RSA PRIVATE KEY|BEGIN OPENSSH PRIVATE KEY|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE|DATABASE_URL|mistral_[A-Za-z0-9_\-]{12,}|sk-[A-Za-z0-9_\-]{16,})",
    )
    .expect("Secret-RegEx ist statisch gültig")
}

fn secret_filename_regex() -> Regex {
    Regex::new(
        r"(?i)(^\.env(\.|$)|secret|apikey|api_key|private_key|credential|\.pem$|\.key$|\.p12$)",
    )
    .expect("Secret-Dateiname-RegEx ist statisch gültig")
}

fn project_areas(files: &[&FileFinding]) -> Vec<String> {
    let mut areas = BTreeSet::new();
    for finding in files {
        let area = finding
            .relative_path
            .split('/')
            .next()
            .unwrap_or(&finding.relative_path);
        if !area.is_empty() {
            areas.insert(area.to_string());
        }
    }
    areas.into_iter().collect()
}

fn first_lines(content: &str, max_lines: usize) -> String {
    content
        .lines()
        .take(max_lines)
        .collect::<Vec<_>>()
        .join("\n")
}

fn safe_filename(relative_path: &str) -> String {
    relative_path
        .chars()
        .map(|ch| match ch {
            '/' => '_',
            'A'..='Z' | 'a'..='z' | '0'..='9' | '.' | '_' | '-' => ch,
            _ => '_',
        })
        .collect()
}

fn load_config_inner() -> Result<AppConfig> {
    let path = config_path()?;
    if !path.exists() {
        let config = default_config()?;
        save_config_inner(&config)?;
        return Ok(config);
    }
    let content = fs::read_to_string(path)?;
    let mut config: AppConfig = serde_json::from_str(&content)?;
    normalize_config(&mut config);
    save_config_inner(&config)?;
    Ok(config)
}

fn save_config_inner(config: &AppConfig) -> Result<()> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut normalized = config.clone();
    normalize_config(&mut normalized);
    let json = serde_json::to_string_pretty(&normalized)?;
    fs::write(path, json)?;
    Ok(())
}

fn normalize_config(config: &mut AppConfig) {
    config.app_version = APP_VERSION.to_string();
    config.safety.cleanup_enabled = false;
    if config.device.device_id.trim().is_empty() {
        config.device.device_id = generate_device_id();
    }
    if config.device.device_name.trim().is_empty() {
        config.device.device_name = default_device_name();
    }
    if config.mcp.base_url.trim().is_empty() {
        config.mcp = default_mcp_config();
    }
    // REST-Basis dauerhaft auf scheme://host normalisieren -> ein versehentlich gespeicherter Pfad
    // (z.B. ".../mcp") heilt sich beim naechsten Speichern, statt "/api/..."-Aufrufe zu brechen.
    config.mcp.base_url = normalize_base_url(&config.mcp.base_url);
}

fn default_config() -> Result<AppConfig> {
    let support = app_support_dir()?;
    Ok(AppConfig {
        app_version: APP_VERSION.to_string(),
        device: default_device_config(),
        library_id: String::new(),
        mcp: default_mcp_config(),
        source_roots: Vec::new(),
        output_dir: support.join("current").to_string_lossy().to_string(),
        schedule: ScheduleConfig {
            enabled: false,
            hour: 22,
            minute: 0,
            weekdays: vec![
                "mon".to_string(),
                "tue".to_string(),
                "wed".to_string(),
                "thu".to_string(),
                "fri".to_string(),
            ],
        },
        scan_rules: ScanRules {
            include_memory: true,
            include_roadmaps: true,
            include_tasks: true,
            include_csv: false,
            include_documents: false,
            dedupe_uploads: false,
            max_file_size_mb: 5,
            upload_individual_status_files: false,
            max_individual_uploads: 5,
        },
        safety: SafetyConfig {
            dry_run_default: false,
            cleanup_enabled: false,
            secret_scan_enabled: true,
        },
        codex_auto_push: true,
        codex_create_pr: true,
        codex_coding_mode: false,
        codex_preferred_runner: "codex_cli".to_string(),
        reference_root: String::new(),
        project_repos: std::collections::HashMap::new(),
    })
}

fn default_device_config() -> DeviceConfig {
    DeviceConfig {
        device_id: generate_device_id(),
        device_name: default_device_name(),
    }
}

fn default_mcp_config() -> McpConfig {
    McpConfig {
        base_url: "https://mcp.katoos.de".to_string(),
    }
}

fn generate_device_id() -> String {
    format!("ks-{}", Uuid::new_v4())
}

fn default_device_name() -> String {
    if let Ok(output) = Command::new("scutil")
        .args(["--get", "ComputerName"])
        .output()
    {
        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !value.is_empty() {
            return value;
        }
    }
    env::var("COMPUTERNAME")
        .or_else(|_| env::var("HOSTNAME"))
        .or_else(|_| env::var("USER"))
        .unwrap_or_else(|_| "Dieser Rechner".to_string())
}

fn app_support_dir() -> Result<PathBuf> {
    let dir = dirs::data_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| anyhow!("Home-Verzeichnis nicht gefunden"))?
        .join("KatoSync");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn config_path() -> Result<PathBuf> {
    Ok(app_support_dir()?.join("config.json"))
}

fn logs_dir() -> Result<PathBuf> {
    let dir = dirs::home_dir()
        .ok_or_else(|| anyhow!("Home-Verzeichnis nicht gefunden"))?
        .join("Library")
        .join("Logs")
        .join("KatoSync");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn write_last_report(report: &SyncReport) -> Result<()> {
    let path = app_support_dir()?.join("last-report.json");
    fs::write(path, serde_json::to_string_pretty(report)?)?;
    Ok(())
}

fn write_log(kind: &str, message: &str) -> Result<()> {
    let file_name = if kind == "error" {
        "error.log"
    } else {
        "sync.log"
    };
    let path = logs_dir()?.join(file_name);
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "[{}] {}", now_string(), sanitize_log(message))?;
    Ok(())
}

fn read_log_tail(path: &Path, max_bytes: u64) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(max_bytes);
    if start > 0 {
        file.seek(SeekFrom::Start(start))?;
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let mut text = String::from_utf8_lossy(&bytes).to_string();
    if start > 0 {
        if let Some(index) = text.find('\n') {
            text = text[index + 1..].to_string();
        }
        text.insert_str(
            0,
            "[Log gekürzt: nur die letzten Einträge werden angezeigt]\n",
        );
    }
    Ok(text)
}

fn sync_report_summary(report: &SyncReport) -> String {
    format!(
        "Sync beendet: dry_run={}, relevant={}, secrets={}, uploads={}, warnings={}, errors={}, output={}",
        report.dry_run,
        report.scan.relevant_files,
        report.scan.secret_warnings,
        report.uploaded.len(),
        report.warnings.len(),
        report.errors.len(),
        report.output_dir
    )
}

fn keychain_entry() -> Result<Entry> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(Into::into)
}

fn load_api_key() -> Result<String> {
    if let Some(key) = cached_api_key() {
        return Ok(key);
    }
    let key = keychain_entry()?
        .get_password()
        .context("Kein Mistral API-Key in der Keychain gespeichert")?;
    cache_api_key(Some(key.clone()));
    let _ = write_api_key_marker();
    Ok(key)
}

fn api_key_cache() -> &'static Mutex<Option<String>> {
    API_KEY_CACHE.get_or_init(|| Mutex::new(None))
}

fn cached_api_key() -> Option<String> {
    api_key_cache().lock().ok().and_then(|guard| guard.clone())
}

fn cache_api_key(value: Option<String>) {
    if let Ok(mut guard) = api_key_cache().lock() {
        *guard = value;
    }
}

fn api_key_marker_path() -> Result<PathBuf> {
    Ok(app_support_dir()?.join("api-key.saved"))
}

fn api_key_marker_exists() -> Result<bool> {
    Ok(api_key_marker_path()?.exists())
}

fn write_api_key_marker() -> Result<()> {
    fs::write(api_key_marker_path()?, "saved")?;
    Ok(())
}

fn remove_api_key_marker() -> Result<()> {
    let path = api_key_marker_path()?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn mcp_connector_keychain_entry() -> Result<Entry> {
    Entry::new(KEYCHAIN_SERVICE, MCP_CONNECTOR_ACCOUNT).map_err(Into::into)
}

fn load_mcp_connector_token() -> Result<String> {
    if let Some(token) = cached_mcp_connector_token() {
        return Ok(token);
    }
    let token = mcp_connector_keychain_entry()?
        .get_password()
        .context("Kein MCP Connector Token im Schlüsselbund gespeichert")?;
    cache_mcp_connector_token(Some(token.clone()));
    let _ = write_mcp_connector_token_marker();
    Ok(token)
}

fn mcp_connector_token_cache() -> &'static Mutex<Option<String>> {
    MCP_CONNECTOR_TOKEN_CACHE.get_or_init(|| Mutex::new(None))
}

fn cached_mcp_connector_token() -> Option<String> {
    mcp_connector_token_cache()
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

fn cache_mcp_connector_token(value: Option<String>) {
    if let Ok(mut guard) = mcp_connector_token_cache().lock() {
        *guard = value;
    }
}

fn mcp_connector_token_marker_path() -> Result<PathBuf> {
    Ok(app_support_dir()?.join("mcp-connector-token.saved"))
}

fn mcp_connector_token_marker_exists() -> Result<bool> {
    Ok(mcp_connector_token_marker_path()?.exists())
}

fn write_mcp_connector_token_marker() -> Result<()> {
    fs::write(mcp_connector_token_marker_path()?, "saved")?;
    Ok(())
}

fn remove_mcp_connector_token_marker() -> Result<()> {
    let path = mcp_connector_token_marker_path()?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupabaseSessionStatus {
    logged_in: bool,
    email: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SupabaseAuthUser {
    email: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SupabaseTokenResponse {
    access_token: String,
    refresh_token: String,
    #[serde(default)]
    user: Option<SupabaseAuthUser>,
}

#[derive(Debug, Deserialize)]
struct SupabaseSignupResponse {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    user: Option<SupabaseAuthUser>,
    #[serde(default)]
    email: Option<String>,
}

fn supabase_session_keychain_entry() -> Result<Entry> {
    Entry::new(KEYCHAIN_SERVICE, SUPABASE_SESSION_ACCOUNT).map_err(Into::into)
}

fn supabase_access_token_cache() -> &'static Mutex<Option<String>> {
    SUPABASE_ACCESS_TOKEN_CACHE.get_or_init(|| Mutex::new(None))
}

fn cached_supabase_access_token() -> Option<String> {
    supabase_access_token_cache()
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

fn cache_supabase_access_token(value: Option<String>) {
    if let Ok(mut guard) = supabase_access_token_cache().lock() {
        *guard = value;
    }
}

fn save_supabase_refresh_token(token: &str) -> Result<()> {
    supabase_session_keychain_entry()?.set_password(token)?;
    Ok(())
}

fn load_supabase_refresh_token() -> Result<String> {
    supabase_session_keychain_entry()?
        .get_password()
        .context("Keine aktive KatoOS-Sitzung gefunden")
}

fn supabase_session_email_path() -> Result<PathBuf> {
    Ok(app_support_dir()?.join("supabase-session.email"))
}

fn read_supabase_session_email() -> Option<String> {
    let path = supabase_session_email_path().ok()?;
    let value = fs::read_to_string(path).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn write_supabase_session_email(email: &str) -> Result<()> {
    fs::write(supabase_session_email_path()?, email.trim())?;
    Ok(())
}

fn remove_supabase_session_email() -> Result<()> {
    let path = supabase_session_email_path()?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

async fn supabase_password_login(email: &str, password: &str) -> Result<SupabaseTokenResponse> {
    let url = format!("{KATOSYNC_AUTH_URL}/auth/v1/token?grant_type=password");
    let response = reqwest::Client::new()
        .post(url)
        .header("apikey", KATOSYNC_AUTH_ANON_KEY)
        .header("User-Agent", USER_AGENT)
        .json(&json!({ "email": email, "password": password }))
        .send()
        .await?;

    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(anyhow!(
            "Login fehlgeschlagen ({status}). Bitte E-Mail und Passwort pruefen."
        ));
    }
    serde_json::from_str(&text).map_err(Into::into)
}

async fn supabase_signup(email: &str, password: &str) -> Result<SupabaseSignupResponse> {
    let url = format!("{KATOSYNC_AUTH_URL}/auth/v1/signup");
    let response = reqwest::Client::new()
        .post(url)
        .header("apikey", KATOSYNC_AUTH_ANON_KEY)
        .header("User-Agent", USER_AGENT)
        .json(&json!({ "email": email, "password": password }))
        .send()
        .await?;

    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(anyhow!("Registrierung fehlgeschlagen ({status}): {text}"));
    }
    serde_json::from_str(&text).map_err(Into::into)
}

// Passwort-Reset anstossen: GoTrue schickt eine Reset-Mail. Der Link in der Mail nutzt die im
// Supabase-Dashboard hinterlegte Site URL (siehe Tester-Punkt #1) - muss dort korrekt gesetzt sein.
async fn supabase_recover(email: &str) -> Result<()> {
    let url = format!("{KATOSYNC_AUTH_URL}/auth/v1/recover");
    let response = reqwest::Client::new()
        .post(url)
        .header("apikey", KATOSYNC_AUTH_ANON_KEY)
        .header("User-Agent", USER_AGENT)
        .json(&json!({ "email": email }))
        .send()
        .await?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("Passwort-Reset fehlgeschlagen ({status}): {text}"));
    }
    Ok(())
}

async fn supabase_refresh_session(refresh_token: &str) -> Result<SupabaseTokenResponse> {
    let url = format!("{KATOSYNC_AUTH_URL}/auth/v1/token?grant_type=refresh_token");
    let response = reqwest::Client::new()
        .post(url)
        .header("apikey", KATOSYNC_AUTH_ANON_KEY)
        .header("User-Agent", USER_AGENT)
        .json(&json!({ "refresh_token": refresh_token }))
        .send()
        .await?;

    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(anyhow!("KatoOS-Sitzung abgelaufen ({status}). Bitte neu anmelden."));
    }
    serde_json::from_str(&text).map_err(Into::into)
}

// Liefert ein gueltiges Access-Token: aus dem Cache, sonst per Refresh-Token erneuern.
async fn ensure_supabase_access_token() -> Result<String> {
    if let Some(token) = cached_supabase_access_token() {
        return Ok(token);
    }
    let refresh = load_supabase_refresh_token()?;
    let session = supabase_refresh_session(&refresh).await?;
    let _ = save_supabase_refresh_token(&session.refresh_token);
    cache_supabase_access_token(Some(session.access_token.clone()));
    Ok(session.access_token)
}

const DEFAULT_BASE_URL: &str = "https://mcp.katoos.de";

// Token-Exfiltration verhindern: der Connector-Token darf NUR an bekannte KatoOS-Hosts gehen
// (https, mcp.katoos.de / *.katoos.de / der katoos-Worker). Sonst koennte eine manipulierte
// base_url-Config (oder ein Webview-Skript) den Bearer-Token an einen fremden Host schicken.
// Validierten Host extrahieren (userinfo/Port-sicher), NUR der reine Host ohne Pfad/Query/Port.
// Authority = bis zum ersten /, ?, #. Danach userinfo (alles vor dem letzten @) und Port abtrennen,
// sonst koennte "mcp.katoos.de@evil.com" oder "...:8080@evil.com" die Pruefung austricksen
// (echter Host steht nach dem @).
fn extract_allowed_host(url: &str) -> Option<String> {
    let lower = url.trim().to_lowercase();
    let rest = lower.strip_prefix("https://")?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host_port = authority.rsplit('@').next().unwrap_or("");
    let host = host_port.split(':').next().unwrap_or("");
    if host == "mcp.katoos.de"
        || host.ends_with(".katoos.de")
        || host == "katoos-mcp-server.nmkato.workers.dev"
    {
        Some(host.to_string())
    } else {
        None
    }
}

fn base_url_host_allowed(url: &str) -> bool {
    extract_allowed_host(url).is_some()
}

// REST-Basis: IMMER nur scheme://host (Pfad/Query/Port verworfen). Sonst landet ein in der base_url
// versehentlich enthaltener Pfad (z.B. ".../mcp", der MCP-JSON-RPC-Endpunkt) VOR "/api/..." -> 404.
// Nicht-allowlisteter (oder nicht-https) Host -> sicherer Default, damit der Token nie an einen
// fremden Host geht.
fn normalize_base_url(base_url: &str) -> String {
    match extract_allowed_host(base_url) {
        Some(host) => format!("https://{host}"),
        None => DEFAULT_BASE_URL.to_string(),
    }
}

fn mask_key(key: &str) -> String {
    if key.len() <= 8 {
        return "****".to_string();
    }
    format!("{}****{}", &key[..key.len().min(7)], &key[key.len() - 4..])
}

fn launch_agent_path() -> Result<PathBuf> {
    let dir = dirs::home_dir()
        .ok_or_else(|| anyhow!("Home-Verzeichnis nicht gefunden"))?
        .join("Library")
        .join("LaunchAgents");
    fs::create_dir_all(&dir)?;
    Ok(dir.join(format!("{LAUNCH_AGENT_ID}.plist")))
}

fn current_exe_for_launch_agent() -> Result<PathBuf> {
    let exe = env::current_exe()?;
    Ok(exe)
}

fn render_launch_agent_plist(
    exe: &Path,
    stdout: &Path,
    stderr: &Path,
    schedule: &ScheduleConfig,
) -> String {
    let weekdays = weekday_numbers(&schedule.weekdays);
    let intervals = if weekdays.is_empty() {
        format!(
            "<dict><key>Hour</key><integer>{}</integer><key>Minute</key><integer>{}</integer></dict>",
            schedule.hour, schedule.minute
        )
    } else {
        weekdays
            .iter()
            .map(|weekday| {
                format!(
                    "<dict><key>Weekday</key><integer>{weekday}</integer><key>Hour</key><integer>{}</integer><key>Minute</key><integer>{}</integer></dict>",
                    schedule.hour, schedule.minute
                )
            })
            .collect::<Vec<_>>()
            .join("")
    };

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LAUNCH_AGENT_ID}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{}</string>
    <string>--run-sync</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>{intervals}</array>
  <key>StandardOutPath</key>
  <string>{}</string>
  <key>StandardErrorPath</key>
  <string>{}</string>
  <key>WorkingDirectory</key>
  <string>{}</string>
</dict>
</plist>
"#,
        xml_escape(&exe.to_string_lossy()),
        xml_escape(&stdout.to_string_lossy()),
        xml_escape(&stderr.to_string_lossy()),
        xml_escape(
            &app_support_dir()
                .unwrap_or_else(|_| PathBuf::from("/tmp"))
                .to_string_lossy()
        )
    )
}

fn weekday_numbers(weekdays: &[String]) -> Vec<u8> {
    weekdays
        .iter()
        .filter_map(|day| match day.as_str() {
            "sun" => Some(0),
            "mon" => Some(1),
            "tue" => Some(2),
            "wed" => Some(3),
            "thu" => Some(4),
            "fri" => Some(5),
            "sat" => Some(6),
            _ => None,
        })
        .collect()
}

fn opener_command(path: &Path) -> Result<()> {
    let output = Command::new("open").arg(path).output()?;
    if output.status.success() {
        Ok(())
    } else {
        Err(anyhow!(String::from_utf8_lossy(&output.stderr).to_string()))
    }
}

fn format_system_time(time: SystemTime) -> String {
    let secs = time
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    chrono::DateTime::<Local>::from(UNIX_EPOCH + Duration::from_secs(secs as u64))
        .format("%Y-%m-%d %H:%M")
        .to_string()
}

fn now_string() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn sanitize_json(value: &serde_json::Value) -> String {
    sanitize_log(&value.to_string())
}

fn sanitize_log(message: &str) -> String {
    secret_regex()
        .replace_all(message, "[REDACTED]")
        .to_string()
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn error_to_string(error: impl std::fmt::Display) -> String {
    sanitize_log(&error.to_string())
}
