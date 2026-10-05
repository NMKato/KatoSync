// Created by NMKato Solutions
use anyhow::{anyhow, Context, Result};
use flate2::read::GzDecoder;
use reqwest::{header::RANGE, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

const MANIFEST_JSON: &str = include_str!("../../src/lib/localBrainManifest.json");
const ENDPOINT: &str = "http://127.0.0.1:17842/v1";
const HEALTH_URL: &str = "http://127.0.0.1:17842/health";
const PORT: &str = "17842";
static CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u32,
    runtime: RuntimeManifest,
    models: Vec<ModelManifest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeManifest {
    id: String,
    version: String,
    targets: BTreeMap<String, RuntimeTarget>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeTarget {
    url: String,
    sha256: String,
    archive: String,
    executable: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelManifest {
    id: String,
    alias: String,
    display_name: String,
    source_repo: String,
    source_revision: String,
    file_name: String,
    url: String,
    sha256: String,
    size_bytes: u64,
    quantization: String,
    license: String,
    minimum_ram_gb: u64,
    preferred_ram_gb: u64,
    recommended: bool,
    vision_projection_required: bool,
    capabilities: ModelCapabilities,
}

#[derive(Debug, Clone, Deserialize)]
struct ModelCapabilities {
    text: bool,
    code: bool,
    tools: bool,
    image: bool,
    audio: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBrainStatus {
    supported: bool,
    target: String,
    ram_gb: Option<u64>,
    ram_fit: String,
    runtime_id: String,
    runtime_version: String,
    runtime_installed: bool,
    model_id: String,
    model_name: String,
    model_installed: bool,
    model_size_bytes: u64,
    quantization: String,
    license: String,
    source_repo: String,
    source_revision: String,
    text_ready: bool,
    code_ready: bool,
    tools_ready: bool,
    audio_ready: bool,
    running: bool,
    endpoint: String,
    model_alias: String,
    vision_ready: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalBrainProgress {
    phase: String,
    label: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    percent: Option<f64>,
}

fn child_slot() -> &'static Mutex<Option<Child>> {
    CHILD.get_or_init(|| Mutex::new(None))
}

fn manifest() -> Result<Manifest> {
    let parsed: Manifest =
        serde_json::from_str(MANIFEST_JSON).context("Local-Brain-Manifest ist ungueltig")?;
    if parsed.schema_version != 1 || parsed.models.is_empty() {
        return Err(anyhow!(
            "Local-Brain-Manifest hat eine nicht unterstuetzte Version"
        ));
    }
    Ok(parsed)
}

fn target_key() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

fn recommended_model(manifest: &Manifest) -> Result<&ModelManifest> {
    manifest
        .models
        .iter()
        .find(|model| model.recommended)
        .or_else(|| manifest.models.first())
        .ok_or_else(|| anyhow!("Kein Local-Brain-Modell im Manifest"))
}

fn root(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join("local-brain"))
}

fn runtime_dir(app: &AppHandle, manifest: &Manifest) -> Result<PathBuf> {
    Ok(root(app)?.join("runtime").join(&manifest.runtime.version))
}

fn model_path(app: &AppHandle, model: &ModelManifest) -> Result<PathBuf> {
    Ok(root(app)?.join("models").join(&model.file_name))
}

fn archive_path(
    app: &AppHandle,
    runtime: &RuntimeManifest,
    target: &RuntimeTarget,
) -> Result<PathBuf> {
    let ext = if target.archive == "zip" {
        "zip"
    } else {
        "tar.gz"
    };
    Ok(root(app)?
        .join("downloads")
        .join(format!("{}-{}.{}", runtime.id, runtime.version, ext)))
}

fn detect_ram_gb() -> Option<u64> {
    #[cfg(target_os = "macos")]
    {
        let out = Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .ok()?;
        let bytes = String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse::<u64>()
            .ok()?;
        return Some((bytes + (1 << 30) - 1) >> 30);
    }
    #[cfg(target_os = "linux")]
    {
        let text = fs::read_to_string("/proc/meminfo").ok()?;
        let kb = text
            .lines()
            .find(|line| line.starts_with("MemTotal:"))?
            .split_whitespace()
            .nth(1)?
            .parse::<u64>()
            .ok()?;
        return Some((kb * 1024 + (1 << 30) - 1) >> 30);
    }
    #[cfg(target_os = "windows")]
    {
        let out = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory",
            ])
            .output()
            .ok()?;
        let bytes = String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse::<u64>()
            .ok()?;
        return Some((bytes + (1 << 30) - 1) >> 30);
    }
    #[allow(unreachable_code)]
    None
}

fn find_runtime_binary(dir: &Path, executable: &str) -> Option<PathBuf> {
    if !dir.exists() {
        return None;
    }
    WalkDir::new(dir)
        .max_depth(4)
        .into_iter()
        .filter_map(Result::ok)
        .find(|entry| {
            entry.file_type().is_file() && entry.file_name().to_string_lossy() == executable
        })
        .map(|entry| entry.into_path())
}

fn running() -> bool {
    let Ok(mut guard) = child_slot().lock() else {
        return false;
    };
    let Some(child) = guard.as_mut() else {
        return false;
    };
    match child.try_wait() {
        Ok(None) => true,
        Ok(Some(_)) | Err(_) => {
            *guard = None;
            false
        }
    }
}

pub fn status(app: &AppHandle) -> Result<LocalBrainStatus> {
    let manifest = manifest()?;
    let model = recommended_model(&manifest)?;
    let key = target_key();
    let target = manifest.runtime.targets.get(&key);
    let runtime_installed = target
        .and_then(|target| {
            runtime_dir(app, &manifest)
                .ok()
                .and_then(|dir| find_runtime_binary(&dir, &target.executable))
        })
        .is_some();
    let model_installed = model_path(app, model)?.is_file();
    let ram = detect_ram_gb();
    let ram_fit = match ram {
        Some(value) if value < model.minimum_ram_gb => "unsupported",
        Some(value) if value < model.preferred_ram_gb => "supported",
        Some(_) => "recommended",
        None => "unknown",
    }
    .to_string();

    Ok(LocalBrainStatus {
        supported: target.is_some()
            && ram
                .map(|value| value >= model.minimum_ram_gb)
                .unwrap_or(true),
        target: key,
        ram_gb: ram,
        ram_fit,
        runtime_id: manifest.runtime.id.clone(),
        runtime_version: manifest.runtime.version.clone(),
        runtime_installed,
        model_id: model.id.clone(),
        model_name: model.display_name.clone(),
        model_installed,
        model_size_bytes: model.size_bytes,
        quantization: model.quantization.clone(),
        license: model.license.clone(),
        source_repo: model.source_repo.clone(),
        source_revision: model.source_revision.clone(),
        text_ready: model.capabilities.text,
        code_ready: model.capabilities.code,
        tools_ready: model.capabilities.tools,
        audio_ready: model.capabilities.audio,
        running: running(),
        endpoint: ENDPOINT.to_string(),
        model_alias: model.alias.clone(),
        vision_ready: model.capabilities.image && !model.vision_projection_required,
    })
}

fn emit_progress(app: &AppHandle, phase: &str, label: &str, downloaded: u64, total: Option<u64>) {
    let percent = total
        .filter(|total| *total > 0)
        .map(|total| (downloaded as f64 / total as f64 * 100.0).min(100.0));
    let _ = app.emit(
        "local-brain-progress",
        LocalBrainProgress {
            phase: phase.to_string(),
            label: label.to_string(),
            downloaded_bytes: downloaded,
            total_bytes: total,
            percent,
        },
    );
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file =
        File::open(path).with_context(|| format!("Hash-Datei fehlt: {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn download_verified(
    app: &AppHandle,
    phase: &str,
    label: &str,
    url: &str,
    destination: &Path,
    expected_sha256: &str,
    total_hint: Option<u64>,
) -> Result<()> {
    if destination.is_file() && sha256_file(destination)?.eq_ignore_ascii_case(expected_sha256) {
        emit_progress(app, phase, label, total_hint.unwrap_or(0), total_hint);
        return Ok(());
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let part = PathBuf::from(format!("{}.part", destination.display()));
    let existing = fs::metadata(&part).map(|meta| meta.len()).unwrap_or(0);
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(60 * 60 * 6))
        .build()?;
    let mut request = client.get(url);
    if existing > 0 {
        request = request.header(RANGE, format!("bytes={existing}-"));
    }
    let mut response = request.send().await?.error_for_status()?;
    let partial = response.status() == StatusCode::PARTIAL_CONTENT;
    let mut offset = if partial { existing } else { 0 };
    let response_total = response.content_length().map(|length| length + offset);
    let total = total_hint.or(response_total);

    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(partial)
        .truncate(!partial)
        .open(&part)?;
    emit_progress(app, phase, label, offset, total);

    while let Some(chunk) = response.chunk().await? {
        file.write_all(&chunk)?;
        offset += chunk.len() as u64;
        emit_progress(app, phase, label, offset, total);
    }
    file.flush()?;
    drop(file);

    let actual = sha256_file(&part)?;
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        let _ = fs::remove_file(&part);
        return Err(anyhow!(
            "SHA256-Mismatch fuer {label}: erwartet {expected_sha256}, erhalten {actual}"
        ));
    }
    fs::rename(&part, destination)?;
    emit_progress(app, phase, label, offset, total.or(Some(offset)));
    Ok(())
}

fn extract_runtime(archive: &Path, target: &RuntimeTarget, destination: &Path) -> Result<()> {
    let staging = destination.with_extension("staging");
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    fs::create_dir_all(&staging)?;

    match target.archive.as_str() {
        "tar.gz" => {
            let file = File::open(archive)?;
            let decoder = GzDecoder::new(file);
            let mut tar = tar::Archive::new(decoder);
            tar.unpack(&staging)?;
        }
        "zip" => {
            let file = File::open(archive)?;
            let mut archive = zip::ZipArchive::new(file)?;
            for index in 0..archive.len() {
                let mut entry = archive.by_index(index)?;
                let Some(relative) = entry.enclosed_name() else {
                    return Err(anyhow!("Unsicherer Pfad im Runtime-Archiv"));
                };
                let output = staging.join(relative);
                if entry.is_dir() {
                    fs::create_dir_all(&output)?;
                    continue;
                }
                if let Some(parent) = output.parent() {
                    fs::create_dir_all(parent)?;
                }
                let mut out = File::create(&output)?;
                std::io::copy(&mut entry, &mut out)?;
            }
        }
        other => return Err(anyhow!("Nicht unterstuetztes Runtime-Archiv: {other}")),
    }

    let binary = find_runtime_binary(&staging, &target.executable)
        .ok_or_else(|| anyhow!("Runtime enthaelt {} nicht", target.executable))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&binary)?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&binary, perms)?;
    }

    if destination.exists() {
        fs::remove_dir_all(destination)?;
    }
    fs::rename(staging, destination)?;
    Ok(())
}

pub async fn install(app: &AppHandle) -> Result<LocalBrainStatus> {
    let manifest = manifest()?;
    let model = recommended_model(&manifest)?;
    let key = target_key();
    let target = manifest
        .runtime
        .targets
        .get(&key)
        .ok_or_else(|| anyhow!("Local Brain wird auf {key} noch nicht unterstuetzt"))?;

    if let Some(ram) = detect_ram_gb() {
        if ram < model.minimum_ram_gb {
            return Err(anyhow!(
                "{} braucht mindestens {} GB RAM; erkannt wurden {} GB",
                model.display_name,
                model.minimum_ram_gb,
                ram
            ));
        }
    }

    let runtime_dir = runtime_dir(app, &manifest)?;
    if find_runtime_binary(&runtime_dir, &target.executable).is_none() {
        emit_progress(app, "runtime", "llama.cpp Runtime", 0, None);
        let archive = archive_path(app, &manifest.runtime, target)?;
        download_verified(
            app,
            "runtime",
            "llama.cpp Runtime",
            &target.url,
            &archive,
            &target.sha256,
            None,
        )
        .await?;
        extract_runtime(&archive, target, &runtime_dir)?;
    }

    let model_path = model_path(app, model)?;
    emit_progress(app, "model", &model.display_name, 0, Some(model.size_bytes));
    download_verified(
        app,
        "model",
        &model.display_name,
        &model.url,
        &model_path,
        &model.sha256,
        Some(model.size_bytes),
    )
    .await?;

    emit_progress(
        app,
        "verify",
        "Installation verifiziert",
        model.size_bytes,
        Some(model.size_bytes),
    );
    status(app)
}

pub async fn start(app: &AppHandle) -> Result<LocalBrainStatus> {
    let manifest = manifest()?;
    let model = recommended_model(&manifest)?;
    let key = target_key();
    let target = manifest
        .runtime
        .targets
        .get(&key)
        .ok_or_else(|| anyhow!("Local Brain wird auf {key} noch nicht unterstuetzt"))?;
    let runtime = runtime_dir(app, &manifest)?;
    let binary = find_runtime_binary(&runtime, &target.executable)
        .ok_or_else(|| anyhow!("llama.cpp Runtime ist nicht installiert"))?;
    let model_file = model_path(app, model)?;
    if !model_file.is_file() {
        return Err(anyhow!("Local-Brain-Modell ist nicht installiert"));
    }

    if running() {
        return status(app);
    }

    let logs = root(app)?.join("logs");
    fs::create_dir_all(&logs)?;
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs.join("llama-server.log"))?;

    let mut command = Command::new(binary);
    command
        .arg("-m")
        .arg(&model_file)
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            PORT,
            "--ctx-size",
            "8192",
            "--alias",
            &model.alias,
        ])
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log));

    #[cfg(target_os = "macos")]
    {
        command.args(["-ngl", "99"]);
    }

    let child = command
        .spawn()
        .context("llama-server konnte nicht gestartet werden")?;
    *child_slot()
        .lock()
        .map_err(|_| anyhow!("Local-Brain-Prozesslock ist beschaedigt"))? = Some(child);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()?;
    for _ in 0..45 {
        if let Ok(response) = client.get(HEALTH_URL).send().await {
            if response.status().is_success() {
                return status(app);
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }

    let _ = stop(app);
    Err(anyhow!(
        "Local Brain wurde gestartet, aber der Health-Check blieb 45 Sekunden lang rot"
    ))
}

pub fn stop(app: &AppHandle) -> Result<LocalBrainStatus> {
    let mut guard = child_slot()
        .lock()
        .map_err(|_| anyhow!("Local-Brain-Prozesslock ist beschaedigt"))?;
    if let Some(child) = guard.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *guard = None;
    drop(guard);
    status(app)
}

pub fn remove(app: &AppHandle) -> Result<LocalBrainStatus> {
    let _ = stop(app);
    let local_root = root(app)?;
    if local_root.exists() {
        fs::remove_dir_all(&local_root)?;
    }
    status(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_manifest_is_versioned_and_has_recommended_model() {
        let manifest = manifest().unwrap();
        assert_eq!(manifest.schema_version, 1);
        let model = recommended_model(&manifest).unwrap();
        assert_eq!(model.id, "gemma-4-e4b-it-q4_0");
        assert_eq!(model.alias, "kato-local-brain");
        assert_eq!(model.sha256.len(), 64);
        assert!(model.capabilities.text);
        assert!(model.capabilities.code);
        assert!(model.capabilities.tools);
        assert!(!model.capabilities.audio);
        assert!(!model.source_repo.is_empty());
    }

    #[test]
    fn supported_targets_have_pinned_hashes_and_loopback_runtime() {
        let manifest = manifest().unwrap();
        for (key, target) in &manifest.runtime.targets {
            assert!(!key.is_empty());
            assert_eq!(target.sha256.len(), 64);
            assert!(target
                .url
                .starts_with("https://github.com/ggml-org/llama.cpp/releases/download/"));
            assert!(target.executable.starts_with("llama-server"));
        }
    }
}
