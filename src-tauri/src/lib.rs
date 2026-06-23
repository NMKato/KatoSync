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
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tokio::time::sleep;
use walkdir::{DirEntry, WalkDir};

const APP_VERSION: &str = "1.0.0";
const KEYCHAIN_SERVICE: &str = "com.nmkato.katosync";
const KEYCHAIN_ACCOUNT: &str = "mistral-api-key";
const USER_AGENT: &str = "KatoSync/1.0.0";
const LAUNCH_AGENT_ID: &str = "com.nmkato.katosync.sync";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    app_version: String,
    library_id: String,
    source_roots: Vec<String>,
    output_dir: String,
    schedule: ScheduleConfig,
    scan_rules: ScanRules,
    safety: SafetyConfig,
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
        .run(tauri::generate_context!())
        .expect("Fehler beim Start von KatoSync");
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
    if api_key.trim().is_empty() {
        return Err("API-Key darf nicht leer sein.".to_string());
    }
    keychain_entry()
        .map_err(error_to_string)?
        .set_password(api_key.trim())
        .map_err(error_to_string)?;
    api_key_status()
}

#[tauri::command]
fn api_key_status() -> Result<KeyStatus, String> {
    match keychain_entry().map_err(error_to_string)?.get_password() {
        Ok(key) => Ok(KeyStatus {
            exists: true,
            masked: Some(mask_key(&key)),
        }),
        Err(_) => Ok(KeyStatus {
            exists: false,
            masked: None,
        }),
    }
}

#[tauri::command]
fn delete_api_key() -> Result<KeyStatus, String> {
    let entry = keychain_entry().map_err(error_to_string)?;
    let _ = entry.delete_credential();
    Ok(KeyStatus {
        exists: false,
        masked: None,
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
async fn run_sync(config: AppConfig, dry_run: Option<bool>) -> Result<SyncReport, String> {
    let effective_dry_run = dry_run.unwrap_or(config.safety.dry_run_default);
    save_config_inner(&config).map_err(error_to_string)?;
    sync_once(&config, effective_dry_run)
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
        content.push_str(&fs::read_to_string(sync).map_err(error_to_string)?);
    }
    if errors.exists() {
        content.push_str("\n== error.log ==\n");
        content.push_str(&fs::read_to_string(errors).map_err(error_to_string)?);
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
    let _ = sync_once(&config, false).await?;
    Ok(())
}

async fn sync_once(config: &AppConfig, dry_run: bool) -> Result<SyncReport> {
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
            for file_path in upload_order(&output_dir, config, &scan) {
                match upload_with_backoff(&key, &config.library_id, &file_path).await {
                    Ok(result) => uploaded.push(result),
                    Err(error) => {
                        let message = format!(
                            "Upload fehlgeschlagen für {}: {error:#}",
                            file_path.file_name().and_then(OsStr::to_str).unwrap_or("?")
                        );
                        write_log("error", &message)?;
                        errors.push(message);
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
    write_log(
        "sync",
        &format!("Sync beendet: {}", serde_json::to_string(&report)?),
    )?;
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

    let manifest = output_dir.join("CURRENT_MANIFEST.md");
    let index = output_dir.join("CURRENT_SNAPSHOT_INDEX.md");
    let status_all = output_dir.join("CURRENT_PROJECT_STATUS_ALL.md");
    let memory_all = output_dir.join("CURRENT_MEMORY_ALL.md");
    let brief_md = output_dir.join("CURRENT_MISTRAL_BRIEFING_SOURCE.md");
    let brief_txt = output_dir.join("CURRENT_MISTRAL_BRIEFING_SOURCE.txt");

    fs::write(&manifest, render_manifest(config, scan, &date, warnings))?;
    fs::write(&index, render_index(scan, &date, &areas))?;
    fs::write(
        &status_all,
        render_aggregate(&relevant, &["status", "roadmap"], &date)?,
    )?;
    fs::write(
        &memory_all,
        render_aggregate(&relevant, &["memory"], &date)?,
    )?;
    let briefing = render_briefing(scan, &date, &areas, &status_all, &memory_all)?;
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

fn render_index(scan: &ScanSummary, date: &str, areas: &[String]) -> String {
    let mut text = String::new();
    text.push_str(&format!("# CURRENT SNAPSHOT INDEX - {date}\n\n"));
    text.push_str("_Kompakte Agenten-Übersicht. Created by NMK Solutions._\n\n");
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

fn render_aggregate(files: &[&FileFinding], categories: &[&str], date: &str) -> Result<String> {
    let title = if categories.contains(&"memory") {
        "GESAMMELTE MEMORY"
    } else {
        "ÜBERGREIFENDER PROJEKTSTATUS"
    };
    let mut text = String::new();
    text.push_str(&format!("# {title} - {date}\n\n"));
    text.push_str("_Automatisch gebündelt. Created by NMK Solutions._\n\n");
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
    let mut files = vec![
        "CURRENT_MISTRAL_BRIEFING_SOURCE.md",
        "CURRENT_MISTRAL_BRIEFING_SOURCE.txt",
        "CURRENT_PROJECT_STATUS_ALL.md",
        "CURRENT_MEMORY_ALL.md",
        "CURRENT_SNAPSHOT_INDEX.md",
        "CURRENT_MANIFEST.md",
    ]
    .into_iter()
    .map(|name| output_dir.join(name))
    .collect::<Vec<_>>();

    if config.scan_rules.upload_individual_status_files {
        let mut individual = scan
            .findings
            .iter()
            .filter(|finding| {
                !finding.skipped && (finding.category == "status" || finding.category == "roadmap")
            })
            .take(config.scan_rules.max_individual_uploads)
            .map(|finding| PathBuf::from(&finding.path))
            .collect::<Vec<_>>();
        files.append(&mut individual);
    }
    files
}

async fn upload_with_backoff(
    api_key: &str,
    library_id: &str,
    file_path: &Path,
) -> Result<UploadResult> {
    let waits = [30_u64, 60, 120];
    for attempt in 0..=waits.len() {
        match upload_document(api_key, library_id, file_path).await {
            Ok(result) => return Ok(result),
            Err(error) if error.to_string().contains("HTTP 429") && attempt < waits.len() => {
                write_log(
                    "sync",
                    &format!(
                        "Rate-Limit für {}. Retry in {}s.",
                        file_path.display(),
                        waits[attempt]
                    ),
                )?;
                sleep(Duration::from_secs(waits[attempt])).await;
            }
            Err(error) => return Err(error),
        }
    }
    Err(anyhow!("Upload nach Backoff abgebrochen."))
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

    let url = format!("https://api.mistral.ai/v1/libraries/{library_id}/documents");
    let mime = if file_name.ends_with(".txt") {
        "text/plain"
    } else if file_name.ends_with(".json") {
        "application/json"
    } else if file_name.ends_with(".csv") {
        "text/csv"
    } else {
        "text/markdown"
    };
    let part = Part::bytes(content.into_bytes())
        .file_name(file_name.clone())
        .mime_str(mime)?;
    let form = Form::new().part("file", part);
    let response = reqwest::Client::new()
        .post(url)
        .bearer_auth(api_key.trim())
        .header("User-Agent", USER_AGENT)
        .multipart(form)
        .send()
        .await?;

    let status = response.status();
    let rate_limits = rate_limits_from_headers(response.headers());
    let value: serde_json::Value = response.json().await.unwrap_or_else(|_| json!({}));
    if status == StatusCode::TOO_MANY_REQUESTS {
        return Err(anyhow!("HTTP 429 Rate-Limit"));
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
            "Requests",
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
    let allowed_ext = extension == "md"
        || extension == "txt"
        || extension == "json"
        || (rules.include_csv && extension == "csv");
    if !allowed_ext {
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
    let config: AppConfig = serde_json::from_str(&content)?;
    Ok(config)
}

fn save_config_inner(config: &AppConfig) -> Result<()> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut normalized = config.clone();
    normalized.app_version = APP_VERSION.to_string();
    normalized.safety.cleanup_enabled = false;
    let json = serde_json::to_string_pretty(&normalized)?;
    fs::write(path, json)?;
    Ok(())
}

fn default_config() -> Result<AppConfig> {
    let support = app_support_dir()?;
    Ok(AppConfig {
        app_version: APP_VERSION.to_string(),
        library_id: String::new(),
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
            max_file_size_mb: 5,
            upload_individual_status_files: false,
            max_individual_uploads: 5,
        },
        safety: SafetyConfig {
            dry_run_default: false,
            cleanup_enabled: false,
            secret_scan_enabled: true,
        },
    })
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

fn keychain_entry() -> Result<Entry> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(Into::into)
}

fn load_api_key() -> Result<String> {
    keychain_entry()?
        .get_password()
        .context("Kein Mistral API-Key in der Keychain gespeichert")
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
