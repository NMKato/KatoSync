// Created by NMKato Solutions
use crate::local_brain_runtime::{
    self as guard, LaunchIdentity, OwnershipRecord, RuntimeBinding, RuntimeLedger, VerifiedRuntime,
};
use crate::model_distribution::{
    self as dist, release_gate_blockers, Channel, DistributionBase, ExpectedArtifact, ModelPackage,
    OriginPolicy, PackagePublication, PackageStore, UpdateState,
};
use anyhow::{anyhow, bail, Context, Result};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

const MANIFEST_JSON: &str = include_str!("../../src/lib/localBrainManifest.json");
const ENDPOINT: &str = "http://127.0.0.1:17842/v1";
const HEALTH_URL: &str = "http://127.0.0.1:17842/health";
const MODELS_URL: &str = "http://127.0.0.1:17842/v1/models";
const PROBE_BODY_LIMIT: usize = 64 * 1024;
const PORT: u16 = 17842;
const MANIFEST_SCHEMA_VERSION: u32 = 2;
const STOP_GRACE: Duration = Duration::from_secs(3);
static CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
static APP_ROOT: OnceLock<PathBuf> = OnceLock::new();
static INSTALL_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static START_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u32,
    distribution: DistributionConfig,
    runtime: RuntimeManifest,
    models: Vec<ModelManifest>,
}

/// Verteilkanal fuer Modellgewichte. `baseUrl` zeigt spaeter auf die R2 Custom Domain;
/// ohne Base (oder ohne Lizenzfreigabe) wird nur der gepinnte Upstream genutzt.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DistributionConfig {
    base_url: Option<String>,
    allowed_hosts: Vec<String>,
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
    minimum_ram_gb: u64,
    preferred_ram_gb: u64,
    recommended: bool,
    vision_projection_required: bool,
    capabilities: ModelCapabilities,
    package: PackagePublication,
}

impl ModelManifest {
    /// Vollstaendiger Paketvertrag (entspricht `packages/<id>/<version>/manifest.json`).
    fn to_package(&self) -> ModelPackage {
        let publication = &self.package;
        ModelPackage {
            schema: dist::PACKAGE_SCHEMA.to_string(),
            package_id: publication.package_id.clone(),
            version: publication.version.clone(),
            channel: publication.channel,
            release_state: publication.release_state,
            file_name: self.file_name.clone(),
            size_bytes: self.size_bytes,
            sha256: self.sha256.clone(),
            quantization: self.quantization.clone(),
            minimum_ram_gb: self.minimum_ram_gb,
            preferred_ram_gb: self.preferred_ram_gb,
            context_tokens: publication.context_tokens,
            platforms: publication.platforms.clone(),
            runtime: publication.runtime.clone(),
            license: publication.license.clone(),
            object_key: publication.object_key.clone(),
            upstream_url: Some(self.url.clone()),
        }
    }
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
    package_id: String,
    package_version: String,
    package_channel: Channel,
    release_state: dist::ReleaseState,
    release_blockers: Vec<String>,
    installed_version: Option<String>,
    previous_version: Option<String>,
    pinned_version: Option<String>,
    update_state: String,
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

fn parse_manifest(json: &str) -> Result<Manifest> {
    let parsed: Manifest =
        serde_json::from_str(json).context("Local-Brain-Manifest ist ungueltig")?;
    if parsed.schema_version != MANIFEST_SCHEMA_VERSION || parsed.models.is_empty() {
        return Err(anyhow!(
            "Local-Brain-Manifest hat eine nicht unterstuetzte Version"
        ));
    }
    let policy = origin_policy(&parsed)?;
    if let Some(base) = &parsed.distribution.base_url {
        DistributionBase::parse(base, &policy)?;
    }
    for target in parsed.runtime.targets.values() {
        policy.check(&target.url)?;
        dist::validate_sha256(&target.sha256)?;
    }
    for model in &parsed.models {
        let package = model.to_package();
        package.validate(&policy)?;
        if package.runtime.id != parsed.runtime.id
            || !package.runtime.versions.contains(&parsed.runtime.version)
        {
            return Err(anyhow!(
                "{} ist nicht mit Runtime {} {} kompatibel",
                package.package_id,
                parsed.runtime.id,
                parsed.runtime.version
            ));
        }
    }
    Ok(parsed)
}

fn manifest() -> Result<Manifest> {
    parse_manifest(MANIFEST_JSON)
}

fn origin_policy(manifest: &Manifest) -> Result<OriginPolicy> {
    OriginPolicy::new(&manifest.distribution.allowed_hosts)
}

fn distribution_base(
    manifest: &Manifest,
    policy: &OriginPolicy,
) -> Result<Option<DistributionBase>> {
    manifest
        .distribution
        .base_url
        .as_deref()
        .map(|base| DistributionBase::parse(base, policy))
        .transpose()
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

/// Merkt sich das Local-Brain-Verzeichnis fuer Pfade ohne AppHandle (Provider-Lane, RAG).
pub fn register_app(app: &AppHandle) {
    if let Ok(local_root) = root(app) {
        let _ = APP_ROOT.set(local_root);
    }
}

fn registered_root() -> Option<PathBuf> {
    APP_ROOT.get().cloned()
}

fn runtime_root(local_root: &Path) -> PathBuf {
    local_root.join("runtime")
}

fn runtime_dir(app: &AppHandle, manifest: &Manifest) -> Result<PathBuf> {
    Ok(runtime_root(&root(app)?).join(&manifest.runtime.version))
}

fn runtime_binding<'a>(
    manifest: &'a Manifest,
    key: &'a str,
    target: &'a RuntimeTarget,
) -> RuntimeBinding<'a> {
    RuntimeBinding {
        runtime_id: &manifest.runtime.id,
        version: &manifest.runtime.version,
        target: key,
        archive_sha256: &target.sha256,
        executable_name: &target.executable,
    }
}

/// Ledger der installierten Runtime; fehlt es oder passt es nicht zum gepinnten Manifest,
/// gilt die Runtime als nicht installiert (fail closed, Neuinstallation aus dem Archiv).
fn load_runtime_ledger(local_root: &Path, binding: &RuntimeBinding<'_>) -> Result<RuntimeLedger> {
    let ledger: RuntimeLedger =
        guard::load_private_json(&guard::ledger_path(local_root, binding.version)?)?
            .ok_or_else(|| anyhow!("Runtime-Integritaetsnachweis fehlt"))?;
    ledger.check_binding(binding)?;
    Ok(ledger)
}

/// Vollpruefung (alle Runtime-Dateien gegen das Ledger) fuer Start und Installation.
fn verify_installed_runtime(
    local_root: &Path,
    binding: &RuntimeBinding<'_>,
) -> Result<VerifiedRuntime> {
    let ledger = load_runtime_ledger(local_root, binding)?;
    let runtime_root = runtime_root(local_root);
    guard::verify_runtime_tree(&runtime_root, &runtime_root.join(binding.version), &ledger)
}

/// Erwartete Identitaet der verwalteten Runtime (ohne Hashing; fuer Statusabfragen).
struct ManagedExpectation {
    executable: PathBuf,
    executable_sha256: String,
    runtime_version: String,
    model_alias: String,
}

impl ManagedExpectation {
    fn launch(&self) -> LaunchIdentity<'_> {
        LaunchIdentity {
            executable: &self.executable,
            executable_sha256: &self.executable_sha256,
            runtime_version: &self.runtime_version,
            port: PORT,
            model_alias: &self.model_alias,
        }
    }
}

fn managed_expectation(local_root: &Path) -> Result<ManagedExpectation> {
    let manifest = manifest()?;
    let model = recommended_model(&manifest)?;
    let key = target_key();
    let target = manifest
        .runtime
        .targets
        .get(&key)
        .ok_or_else(|| anyhow!("Local Brain wird auf {key} noch nicht unterstuetzt"))?;
    let binding = runtime_binding(&manifest, &key, target);
    let ledger = load_runtime_ledger(local_root, &binding)?;
    let runtime_root = runtime_root(local_root);
    let executable = guard::managed_executable_path(
        &runtime_root,
        &runtime_root.join(&manifest.runtime.version),
        &ledger,
    )?;
    Ok(ManagedExpectation {
        executable,
        executable_sha256: ledger
            .executable_sha256()
            .ok_or_else(|| anyhow!("Runtime-Ledger ohne Executable-Hash"))?
            .to_string(),
        runtime_version: manifest.runtime.version.clone(),
        model_alias: model.alias.clone(),
    })
}

fn load_owner_record(local_root: &Path) -> Option<OwnershipRecord> {
    guard::load_private_json(&guard::owner_record_path(local_root))
        .ok()
        .flatten()
}

/// Einzige Quelle fuer "verwalteter Local Brain laeuft": der persistierte Besitznachweis passt
/// zur installierten Runtime UND der Live-Prozess (PID + Startidentitaet + Executable) haelt
/// 127.0.0.1:17842. Ein unbekannter, bereits laufender Listener wird nie uebernommen.
fn managed_runtime_verified(local_root: &Path) -> bool {
    if !guard::supports_ownership_proof() {
        // Ohne Kernel-Nachweis zaehlt nur der eigene Child-Handle dieser Sitzung.
        return owned_child_alive();
    }
    let Ok(expected) = managed_expectation(local_root) else {
        return false;
    };
    load_owner_record(local_root)
        .is_some_and(|record| guard::verify_ownership(&record, &expected.launch(), true).is_ok())
}

/// Der Local-Brain-Port ist fuer die verwaltete Runtime reserviert (jede Loopback-Schreibweise).
pub(crate) fn is_reserved_endpoint(url: &reqwest::Url) -> bool {
    if url.port_or_known_default() != Some(PORT) {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    host == "localhost"
        || host.ends_with(".localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback() || ip.is_unspecified())
}

/// Provider-Lane-Gate: der reservierte Endpunkt wird nur angesprochen, wenn er exakt
/// `http://127.0.0.1:17842` ist und der Besitznachweis der verwalteten Runtime gilt.
pub(crate) fn managed_endpoint_verified(url: &reqwest::Url) -> bool {
    url.scheme() == "http"
        && url.host_str() == Some(guard::LOOPBACK_HOST)
        && url.port() == Some(PORT)
        && url.username().is_empty()
        && url.password().is_none()
        && registered_root().is_some_and(|local_root| managed_runtime_verified(&local_root))
}

fn package_store(app: &AppHandle) -> Result<PackageStore> {
    Ok(PackageStore::new(root(app)?))
}

/// Vor-Paket-Layout (`models/<file>`): wurde vom frueheren Installer nur nach SHA-Pruefung
/// umbenannt, wird aber vor Nutzung erneut verifiziert und in den Paketbaum uebernommen.
fn legacy_model_path(root: &Path, model: &ModelManifest) -> PathBuf {
    root.join("models").join(&model.file_name)
}

/// Verschiebt Altbestand (fertig oder `.part`) als Teil-Download ins Staging, damit er
/// denselben Verifikations-/Resume-Pfad durchlaeuft. Liefert true, wenn etwas uebernommen wurde.
fn stage_legacy_model(root: &Path, model: &ModelManifest, staging: &Path) -> Result<bool> {
    let part = dist::staging_part_path(staging, &model.sha256);
    if part.exists() {
        return Ok(false);
    }
    let legacy = legacy_model_path(root, model);
    let legacy_part = PathBuf::from(format!("{}.part", legacy.display()));
    for candidate in [legacy, legacy_part] {
        if fs::symlink_metadata(&candidate).is_ok_and(|meta| meta.file_type().is_file()) {
            fs::create_dir_all(staging)?;
            fs::rename(&candidate, &part)?;
            if let Some(dir) = candidate.parent() {
                fs::remove_dir(dir).ok();
            }
            return Ok(true);
        }
    }
    Ok(false)
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

fn owned_child_alive() -> bool {
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

fn snapshot(app: &AppHandle) -> Result<LocalBrainStatus> {
    let manifest = manifest()?;
    let model = recommended_model(&manifest)?;
    let package = model.to_package();
    let key = target_key();
    let target = manifest
        .runtime
        .targets
        .get(&key)
        .filter(|_| package.supports(&key, &manifest.runtime.version));
    let local_root = root(app)?;
    // Installiert = gueltiges Ledger zum gepinnten Manifest + strukturell intaktes Executable.
    // Die vollstaendige Hash-Pruefung laeuft vor jedem Start und bei der Installation.
    let runtime_installed = target.is_some_and(|target| {
        load_runtime_ledger(&local_root, &runtime_binding(&manifest, &key, target)).is_ok_and(
            |ledger| {
                runtime_dir(app, &manifest).is_ok_and(|dir| {
                    guard::managed_executable_path(&runtime_root(&local_root), &dir, &ledger)
                        .is_ok()
                })
            },
        )
    });
    let store = PackageStore::new(local_root.clone());
    // Beschaedigtes Ledger = nicht installiert (fail closed); Entfernen setzt es zurueck.
    let ledger = store.load_ledger(&package.package_id).ok().flatten();
    let active_installed = store
        .active_installed(&package.package_id)
        .ok()
        .flatten()
        .is_some();
    let model_installed = active_installed || legacy_model_path(&local_root, model).is_file();
    let update_state = if active_installed {
        dist::plan_update(ledger.as_ref(), &package.version)?
    } else if model_installed {
        UpdateState::Current
    } else {
        UpdateState::NotInstalled
    };
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
        license: package.license.spdx.clone(),
        source_repo: model.source_repo.clone(),
        source_revision: model.source_revision.clone(),
        text_ready: model.capabilities.text,
        code_ready: model.capabilities.code,
        tools_ready: model.capabilities.tools,
        audio_ready: model.capabilities.audio,
        running: false,
        endpoint: ENDPOINT.to_string(),
        model_alias: model.alias.clone(),
        vision_ready: model.capabilities.image && !model.vision_projection_required,
        release_blockers: release_gate_blockers(&package)
            .into_iter()
            .map(str::to_string)
            .collect(),
        installed_version: ledger
            .as_ref()
            .and_then(|l| l.active.clone())
            .filter(|_| active_installed),
        previous_version: ledger.as_ref().and_then(|l| l.previous.clone()),
        pinned_version: ledger.as_ref().and_then(|l| l.pinned.clone()),
        update_state: update_state.as_str().to_string(),
        package_id: package.package_id,
        package_version: package.version,
        package_channel: package.channel,
        release_state: package.release_state,
    })
}

fn models_include_alias(body: &serde_json::Value, alias: &str) -> bool {
    body.get("data")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|models| {
            models
                .iter()
                .any(|model| model.get("id").and_then(serde_json::Value::as_str) == Some(alias))
        })
}

fn is_loopback_probe_url(value: &str) -> bool {
    reqwest::Url::parse(value).is_ok_and(|url| {
        url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.username().is_empty()
    })
}

/// Belegt einen laufenden Local Brain nur, wenn der Loopback-Server gesund ist UND das
/// gepinnte Modell-Alias ausliefert. Fremde Server auf dem Port gelten nicht als bereit.
async fn serves_alias(health_url: &str, models_url: &str, alias: &str) -> bool {
    if !is_loopback_probe_url(health_url) || !is_loopback_probe_url(models_url) {
        return false;
    }
    let Ok(client) = guard::loopback_client(Duration::from_secs(2)) else {
        return false;
    };
    let healthy = client
        .get(health_url)
        .send()
        .await
        .is_ok_and(|response| response.status().is_success());
    if !healthy {
        return false;
    }
    let Ok(response) = client.get(models_url).send().await else {
        return false;
    };
    if !response.status().is_success() {
        return false;
    }
    let Ok(bytes) = response.bytes().await else {
        return false;
    };
    if bytes.len() > PROBE_BODY_LIMIT {
        return false;
    }
    serde_json::from_slice::<serde_json::Value>(&bytes)
        .is_ok_and(|body| models_include_alias(&body, alias))
}

#[derive(Debug, Deserialize)]
struct GroundedChatResponse {
    choices: Vec<GroundedChatChoice>,
}

#[derive(Debug, Deserialize)]
struct GroundedChatChoice {
    message: GroundedChatMessage,
}

#[derive(Debug, Deserialize)]
struct GroundedChatMessage {
    #[serde(default)]
    content: String,
}

/// Providerneutraler, lokal gebundener RAG-Fast-Path.
/// Nutzt ausschliesslich die gepinnte Kato-Local-Brain-Alias auf Loopback und gibt nie
/// reasoning_content weiter. Fuer belegte RAG-Fakten ist Thinking explizit deaktiviert.
pub(crate) async fn grounded_chat(context: &str, question: &str) -> Result<String> {
    let manifest = manifest()?;
    let model = recommended_model(&manifest)?;
    let owned = registered_root().is_some_and(|local_root| managed_runtime_verified(&local_root));
    if !owned || !serves_alias(HEALTH_URL, MODELS_URL, &model.alias).await {
        return Err(anyhow!(
            "Local Brain ist nicht als KatoSync-verwaltete Runtime belegt oder nicht bereit"
        ));
    }

    let context = crate::context_pack::bounded_text(context.trim(), 16_000);
    let question = crate::context_pack::bounded_text(question.trim(), 2_000);
    if question.is_empty() {
        return Err(anyhow!("Local-Brain-Frage darf nicht leer sein"));
    }

    let client = guard::loopback_client(Duration::from_secs(30))?;
    let response = client
        .post(format!("{ENDPOINT}/chat/completions"))
        .json(&serde_json::json!({
            "model": model.alias,
            "messages": [
                {
                    "role": "system",
                    "content": format!(
                        "You are REX, the local KatoSync brain. Use ONLY the verified memory block below.                          If the answer is not explicitly covered by the memory, answer exactly NOT_IN_MEMORY.\n\n{context}"
                    )
                },
                {"role": "user", "content": question}
            ],
            "temperature": 0,
            "reasoning": "off",
            "reasoning_budget": 0,
            "reasoning_effort": "none",
            "chat_template_kwargs": {"enable_thinking": false},
            "max_tokens": 384
        }))
        .send()
        .await
        .context("Local-Brain-RAG-Anfrage fehlgeschlagen")?;

    if !response.status().is_success() {
        return Err(anyhow!(
            "Local Brain hat die RAG-Anfrage abgelehnt ({})",
            response.status()
        ));
    }
    let body: GroundedChatResponse = response
        .json()
        .await
        .context("Local-Brain-RAG-Antwort ist ungueltig")?;
    let answer = body
        .choices
        .first()
        .map(|choice| choice.message.content.trim())
        .unwrap_or_default();
    if answer.is_empty() {
        return Err(anyhow!("Local Brain lieferte keine belegte Antwort"));
    }
    Ok(crate::context_pack::bounded_text(answer, 4_000))
}

/// Laufzeitwahrheit: nur ein nachweislich von KatoSync gestarteter Prozess zaehlt. Ein aus
/// einer frueheren Sitzung uebernommener Prozess muss zusaetzlich das gepinnte Alias liefern.
pub async fn status(app: &AppHandle) -> Result<LocalBrainStatus> {
    let mut status = snapshot(app)?;
    status.running = status.runtime_installed
        && managed_runtime_verified(&root(app)?)
        && (owned_child_alive() || serves_alias(HEALTH_URL, MODELS_URL, &status.model_alias).await);
    Ok(status)
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

/// Progress-Callback fuer den verifizierten Download.
fn progress_reporter<'a>(
    app: &'a AppHandle,
    phase: &'a str,
    label: &'a str,
) -> impl FnMut(u64, Option<u64>) + Send + 'a {
    move |downloaded, total| emit_progress(app, phase, label, downloaded, total)
}

/// Entpackt das SHA-256-verifizierte Archiv, haertet die Rechte, erzeugt das Hash-Ledger
/// aus dem frischen Staging-Baum und tauscht erst danach das Runtime-Verzeichnis aus.
fn extract_runtime(
    archive: &Path,
    target: &RuntimeTarget,
    binding: &RuntimeBinding<'_>,
    destination: &Path,
) -> Result<RuntimeLedger> {
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

    let ledger = guard::build_runtime_ledger(&staging, binding)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let binary = staging.join(ledger.executable_relative()?);
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o700))?;
    }
    guard::harden_runtime_permissions(&staging)?;

    if fs::symlink_metadata(destination).is_ok() {
        if fs::symlink_metadata(destination)?.file_type().is_dir() {
            fs::remove_dir_all(destination)?;
        } else {
            fs::remove_file(destination)?;
        }
    }
    fs::rename(staging, destination)?;
    Ok(ledger)
}

pub async fn install(app: &AppHandle) -> Result<LocalBrainStatus> {
    let _guard = INSTALL_LOCK
        .try_lock()
        .map_err(|_| anyhow!("Local-Brain-Installation laeuft bereits"))?;
    let manifest = manifest()?;
    let model = recommended_model(&manifest)?;
    let package = model.to_package();
    let key = target_key();
    let target = manifest
        .runtime
        .targets
        .get(&key)
        .filter(|_| package.supports(&key, &manifest.runtime.version))
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

    let policy = origin_policy(&manifest)?;
    let client = policy.http_client()?;
    let local_root = root(app)?;
    let store = PackageStore::new(local_root.clone());

    let runtime_dir = runtime_dir(app, &manifest)?;
    let binding = runtime_binding(&manifest, &key, target);
    let runtime_verified = {
        let local_root = local_root.clone();
        let manifest = manifest.clone();
        let key = key.clone();
        let target = target.clone();
        tokio::task::spawn_blocking(move || {
            verify_installed_runtime(&local_root, &runtime_binding(&manifest, &key, &target))
        })
        .await
        .map_err(|err| anyhow!("Runtime-Pruefung abgebrochen: {err}"))?
        .is_ok()
    };
    if !runtime_verified {
        // Fehlender/abweichender Integritaetsnachweis: nie reparieren, immer neu aus dem
        // gepinnten Archiv. Eine eigene Runtime aus dem alten Baum wird vorher beendet.
        stop_managed(&local_root)?;
        let ledger_file = guard::ledger_path(&local_root, &manifest.runtime.version)?;
        match fs::remove_file(&ledger_file) {
            Err(err) if err.kind() != std::io::ErrorKind::NotFound => return Err(err.into()),
            _ => {}
        }
        let label = "llama.cpp Runtime";
        emit_progress(app, "runtime", label, 0, None);
        let archive = dist::fetch_verified(
            &client,
            &[policy.check(&target.url)?],
            &store.staging_dir(),
            ExpectedArtifact {
                sha256: &target.sha256,
                size_bytes: None,
            },
            &mut progress_reporter(app, "runtime", label),
        )
        .await?;
        fs::create_dir_all(runtime_root(&local_root))?;
        let ledger = extract_runtime(archive.path(), target, &binding, &runtime_dir);
        fs::remove_file(archive.path()).ok();
        guard::harden_runtime_permissions(&runtime_root(&local_root))?;
        guard::save_private_json(&ledger_file, &ledger?)?;
        verify_installed_runtime(&local_root, &binding)
            .context("Frisch installierte Runtime besteht die Integritaetspruefung nicht")?;
    }

    let ledger = store.load_ledger(&package.package_id).context(
        "Modellpaket-Ledger ist beschaedigt; Local Brain entfernen und neu installieren",
    )?;
    let healthy = store.active_installed(&package.package_id)?.is_some();
    let needs_download = match dist::plan_update(ledger.as_ref(), &package.version)? {
        UpdateState::NotInstalled | UpdateState::UpdateAvailable => true,
        UpdateState::Current | UpdateState::NewerInstalled => !healthy,
        UpdateState::Pinned if healthy => false,
        UpdateState::Pinned => {
            return Err(anyhow!(
                "Gepinnte Modellversion ist nicht mehr intakt; Pin aufheben und neu installieren"
            ))
        }
    };

    if needs_download {
        let staging = store.staging_dir();
        stage_legacy_model(&local_root, model, &staging)?;
        let sources = dist::download_sources(
            &package,
            distribution_base(&manifest, &policy)?.as_ref(),
            &policy,
        )?;
        emit_progress(app, "model", &model.display_name, 0, Some(model.size_bytes));
        let verified = dist::fetch_verified(
            &client,
            &sources,
            &staging,
            ExpectedArtifact {
                sha256: &package.sha256,
                size_bytes: Some(package.size_bytes),
            },
            &mut progress_reporter(app, "model", &model.display_name),
        )
        .await?;
        store.promote(&package, verified)?;
    }

    emit_progress(
        app,
        "verify",
        "Installation verifiziert",
        model.size_bytes,
        Some(model.size_bytes),
    );
    status(app).await
}

/// Liefert ausschliesslich verifizierte Gewichte; Altbestand wird vorher geprueft und uebernommen.
async fn verified_model_for_launch(app: &AppHandle, model: &ModelManifest) -> Result<PathBuf> {
    let package = model.to_package();
    let local_root = root(app)?;
    let model = model.clone();
    tokio::task::spawn_blocking(move || -> Result<PathBuf> {
        let store = PackageStore::new(local_root.clone());
        if store.load_ledger(&package.package_id)?.is_none()
            && stage_legacy_model(&local_root, &model, &store.staging_dir())?
        {
            let part = dist::staging_part_path(&store.staging_dir(), &package.sha256);
            let verified = dist::verify_or_discard(
                &part,
                ExpectedArtifact {
                    sha256: &package.sha256,
                    size_bytes: Some(package.size_bytes),
                },
            )?;
            store.promote(&package, verified)?;
        }
        store.resolve_for_launch(&package.package_id)
    })
    .await
    .map_err(|err| anyhow!("Modellpruefung abgebrochen: {err}"))?
    .context("Local-Brain-Modell ist nicht installiert oder nicht verifiziert")
}

/// Strukturierter Startbefehl (keine Shell): nur Loopback, gepinnter Kontext und Alias,
/// minimale Allowlist-Umgebung und eigene Prozessgruppe.
fn launch_command(
    executable: &Path,
    model_file: &Path,
    context_tokens: u32,
    alias: &str,
    work_dir: &Path,
) -> Command {
    let mut command = Command::new(executable);
    command
        .arg("-m")
        .arg(model_file)
        .args(["--host", guard::LOOPBACK_HOST, "--port"])
        .arg(PORT.to_string())
        .arg("--ctx-size")
        .arg(context_tokens.to_string())
        .args(["--alias", alias])
        .current_dir(work_dir);
    #[cfg(target_os = "macos")]
    {
        command.args(["-ngl", "99"]);
    }
    guard::harden_launch(&mut command);
    command
}

pub async fn start(app: &AppHandle) -> Result<LocalBrainStatus> {
    let _start = START_LOCK.lock().await;
    let manifest = manifest()?;
    let model = recommended_model(&manifest)?;
    let key = target_key();
    let target = manifest
        .runtime
        .targets
        .get(&key)
        .ok_or_else(|| anyhow!("Local Brain wird auf {key} noch nicht unterstuetzt"))?;
    let local_root = root(app)?;
    if managed_runtime_verified(&local_root) || owned_child_alive() {
        return status(app).await;
    }
    // Fail closed: ein fremder Listener auf dem reservierten Port wird nie uebernommen.
    if guard::loopback_port_in_use(PORT) {
        bail!(
            "Port {PORT} ist von einem nicht von KatoSync gestarteten Prozess belegt; \
             Local Brain wird nicht uebernommen. Fremden Prozess beenden und erneut starten."
        );
    }

    let model_file = verified_model_for_launch(app, model).await?;
    let verified = {
        let local_root = local_root.clone();
        let manifest = manifest.clone();
        let key = key.clone();
        let target = target.clone();
        tokio::task::spawn_blocking(move || {
            verify_installed_runtime(&local_root, &runtime_binding(&manifest, &key, &target))
        })
        .await
        .map_err(|err| anyhow!("Runtime-Pruefung abgebrochen: {err}"))?
        .context("llama.cpp Runtime ist nicht installiert oder nicht verifiziert; Local Brain neu installieren")?
    };

    let logs = local_root.join("logs");
    fs::create_dir_all(&logs)?;
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs.join("llama-server.log"))?;
    let mut command = launch_command(
        &verified.executable,
        &model_file,
        model.package.context_tokens,
        &model.alias,
        &logs,
    );
    command
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log));

    // Verify -> Exec so eng wie moeglich: erneuter Executable-Hash direkt vor spawn.
    guard::recheck_before_spawn(&verified)?;
    let mut child = command
        .spawn()
        .context("llama-server konnte nicht gestartet werden")?;
    let launch = LaunchIdentity {
        executable: &verified.executable,
        executable_sha256: &verified.executable_sha256,
        runtime_version: &manifest.runtime.version,
        port: PORT,
        model_alias: &model.alias,
    };
    let record = if guard::supports_ownership_proof() {
        let captured = OwnershipRecord::capture(child.id(), &launch).and_then(|record| {
            guard::save_private_json(&guard::owner_record_path(&local_root), &record)?;
            Ok(record)
        });
        match captured {
            Ok(record) => Some(record),
            Err(err) => {
                guard::terminate_child(&mut child, STOP_GRACE);
                return Err(err.context("Besitznachweis der gestarteten Runtime fehlgeschlagen"));
            }
        }
    } else {
        None
    };
    *child_slot()
        .lock()
        .map_err(|_| anyhow!("Local-Brain-Prozesslock ist beschaedigt"))? = Some(child);

    let client = guard::loopback_client(Duration::from_secs(2))?;
    for _ in 0..45 {
        if !owned_child_alive() {
            let _ = stop_managed(&local_root);
            bail!("llama-server wurde unerwartet beendet (Port belegt oder Startfehler; siehe llama-server.log)");
        }
        let owned = record
            .as_ref()
            .is_none_or(|record| guard::verify_ownership(record, &launch, true).is_ok());
        if owned {
            if let Ok(response) = client.get(HEALTH_URL).send().await {
                if response.status().is_success() {
                    return status(app).await;
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }

    let _ = stop_managed(&local_root);
    Err(anyhow!(
        "Local Brain wurde gestartet, aber der Health-Check blieb 45 Sekunden lang rot"
    ))
}

/// Beendet die verwaltete Runtime samt Prozessgruppe: den eigenen Child dieser Sitzung oder
/// einen per Besitznachweis positiv identifizierten Prozess einer frueheren Sitzung. Fremde
/// oder nicht identifizierbare Prozesse werden nie signalisiert.
fn stop_managed(local_root: &Path) -> Result<()> {
    let mut slot = child_slot()
        .lock()
        .map_err(|_| anyhow!("Local-Brain-Prozesslock ist beschaedigt"))?;
    if let Some(mut child) = slot.take() {
        guard::terminate_child(&mut child, STOP_GRACE);
    } else if let Some(record) = load_owner_record(local_root) {
        guard::terminate_recorded(&record, &runtime_root(local_root), STOP_GRACE);
    }
    match fs::remove_file(guard::owner_record_path(local_root)) {
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err.into()),
        _ => Ok(()),
    }
}

pub fn stop_owned(app: &AppHandle) -> Result<()> {
    stop_managed(&root(app)?)
}

pub async fn stop(app: &AppHandle) -> Result<LocalBrainStatus> {
    stop_owned(app)?;
    status(app).await
}

fn active_package_id() -> Result<String> {
    Ok(recommended_model(&manifest()?)?.package.package_id.clone())
}

/// Aktiviert die vorherige Modellversion und pinnt sie. Eine eigene Runtime wird vorher
/// gestoppt, damit nie die abgeloeste Version weiterlaeuft.
pub async fn rollback_model(app: &AppHandle) -> Result<LocalBrainStatus> {
    let _guard = INSTALL_LOCK
        .try_lock()
        .map_err(|_| anyhow!("Local-Brain-Installation laeuft gerade"))?;
    stop_owned(app)?;
    package_store(app)?.rollback(&active_package_id()?)?;
    status(app).await
}

pub async fn set_model_pin(app: &AppHandle, version: Option<String>) -> Result<LocalBrainStatus> {
    let _guard = INSTALL_LOCK
        .try_lock()
        .map_err(|_| anyhow!("Local-Brain-Installation laeuft gerade"))?;
    package_store(app)?.set_pin(&active_package_id()?, version.as_deref())?;
    status(app).await
}

/// Entfernt genau eine installierte Modellversion; die aktive nur, wenn sie nicht laeuft.
pub async fn remove_model_version(app: &AppHandle, version: String) -> Result<LocalBrainStatus> {
    let _guard = INSTALL_LOCK
        .try_lock()
        .map_err(|_| anyhow!("Local-Brain-Installation laeuft gerade"))?;
    let manifest = manifest()?;
    let model = recommended_model(&manifest)?;
    let in_use = owned_child_alive() || serves_alias(HEALTH_URL, MODELS_URL, &model.alias).await;
    package_store(app)?.remove_version(&model.package.package_id, &version, in_use)?;
    status(app).await
}

pub async fn remove(app: &AppHandle) -> Result<LocalBrainStatus> {
    let _ = stop_owned(app);
    let local_root = root(app)?;
    if local_root.exists() {
        fs::remove_dir_all(&local_root)?;
    }
    status(app).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn embedded_manifest_is_versioned_and_has_recommended_model() {
        let manifest = manifest().unwrap();
        assert_eq!(manifest.schema_version, MANIFEST_SCHEMA_VERSION);
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
    fn embedded_package_is_valid_but_not_public_until_license_review() {
        let manifest = manifest().unwrap();
        let package = recommended_model(&manifest).unwrap().to_package();
        package
            .validate(&origin_policy(&manifest).unwrap())
            .unwrap();
        assert_eq!(package.version, "1.0.0");
        assert_eq!(package.channel, Channel::Stable);
        assert_ne!(package.release_state, dist::ReleaseState::Public);
        assert!(release_gate_blockers(&package).contains(&"redistribution_not_approved"));
        assert!(package.supports("macos-aarch64", &manifest.runtime.version));
        assert!(manifest.distribution.base_url.is_none());
        // Nicht oeffentlich → nie ueber den eigenen Kanal, nur gepinnter Upstream.
        let policy = origin_policy(&manifest).unwrap();
        let base = DistributionBase::parse("https://github.com/placeholder", &policy).unwrap();
        let sources = dist::download_sources(&package, Some(&base), &policy).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].host_str(), Some("huggingface.co"));
    }

    fn mutated_manifest(edit: impl FnOnce(&mut serde_json::Value)) -> Result<Manifest> {
        let mut value: serde_json::Value = serde_json::from_str(MANIFEST_JSON).unwrap();
        edit(&mut value);
        parse_manifest(&value.to_string())
    }

    #[test]
    fn manifest_rejects_unsafe_or_ungated_packages() {
        assert!(mutated_manifest(|_| {}).is_ok());
        type Edit = Box<dyn FnOnce(&mut serde_json::Value)>;
        let cases: Vec<(&str, Edit)> = vec![
            (
                "public ohne Freigabe",
                Box::new(|v| {
                    v["models"][0]["package"]["releaseState"] = "public".into();
                }),
            ),
            (
                "Traversal im Objekt-Schluessel",
                Box::new(|v| {
                    v["models"][0]["package"]["objectKey"] = "packages/../../secret.gguf".into();
                }),
            ),
            (
                "HTTP-Upstream",
                Box::new(|v| {
                    v["models"][0]["url"] = "http://huggingface.co/x.gguf".into();
                }),
            ),
            (
                "signierte URL",
                Box::new(|v| {
                    v["models"][0]["url"] =
                        "https://huggingface.co/x.gguf?X-Amz-Credential=abc".into();
                }),
            ),
            (
                "fremder Host",
                Box::new(|v| {
                    v["models"][0]["url"] = "https://evil.example.com/x.gguf".into();
                }),
            ),
            (
                "Base mit Token",
                Box::new(|v| {
                    v["distribution"]["baseUrl"] = "https://huggingface.co/?token=abc".into();
                }),
            ),
            (
                "Base ausserhalb Allowlist",
                Box::new(|v| {
                    v["distribution"]["baseUrl"] = "https://models.example.org/".into();
                }),
            ),
            (
                "inkompatible Runtime",
                Box::new(|v| {
                    v["models"][0]["package"]["runtime"]["versions"] = serde_json::json!(["b1"]);
                }),
            ),
            (
                "Schema 1",
                Box::new(|v| {
                    v["schemaVersion"] = 1.into();
                }),
            ),
        ];
        for (label, edit) in cases {
            assert!(mutated_manifest(edit).is_err(), "{label} muss scheitern");
        }
    }

    #[test]
    fn legacy_download_is_staged_for_reverification_not_trusted() {
        let manifest = manifest().unwrap();
        let model = recommended_model(&manifest).unwrap();
        let root =
            std::env::temp_dir().join(format!("katosync-legacy-{}", uuid::Uuid::new_v4().simple()));
        let staging = root.join("staging");
        fs::create_dir_all(root.join("models")).unwrap();
        fs::write(legacy_model_path(&root, model), b"not the real weights").unwrap();

        assert!(stage_legacy_model(&root, model, &staging).unwrap());
        assert!(!legacy_model_path(&root, model).exists());
        let part = dist::staging_part_path(&staging, &model.sha256);
        assert!(part.exists());
        let verdict = dist::verify_or_discard(
            &part,
            ExpectedArtifact {
                sha256: &model.sha256,
                size_bytes: Some(model.size_bytes),
            },
        );
        assert!(verdict.is_err());
        assert!(!part.exists(), "unverifizierte Gewichte werden verworfen");
        fs::remove_dir_all(root).ok();
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
            origin_policy(&manifest)
                .unwrap()
                .check(&target.url)
                .unwrap();
            assert!(target.executable.starts_with("llama-server"));
        }
    }

    /// Minimaler Loopback-HTTP-Server: beantwortet /health und /v1/models mit festen Antworten.
    fn mock_llama_server(health_status: u16, models_body: &'static str) -> String {
        use std::io::{BufRead, BufReader};
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming().take(2) {
                let Ok(mut stream) = stream else { return };
                let mut request_line = String::new();
                let _ = BufReader::new(&stream).read_line(&mut request_line);
                let (code, body) = if request_line.contains("/health") {
                    (health_status, r#"{"status":"ok"}"#)
                } else {
                    (200, models_body)
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 {code} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        base
    }

    const KATO_MODELS: &str =
        r#"{"object":"list","data":[{"id":"kato-local-brain","object":"model"}]}"#;

    #[tokio::test]
    async fn healthy_loopback_runtime_with_pinned_alias_counts_as_running() {
        let base = mock_llama_server(200, KATO_MODELS);
        assert!(
            serves_alias(
                &format!("{base}/health"),
                &format!("{base}/v1/models"),
                "kato-local-brain"
            )
            .await
        );
    }

    /// Ein gesunder Listener mit dem gepinnten Alias ist kein Besitznachweis: ohne
    /// verifiziertes Runtime-Ledger und passenden Live-Prozess gilt er nie als verwaltet.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[tokio::test]
    async fn healthy_impersonator_without_ownership_proof_is_not_managed() {
        let base = mock_llama_server(200, KATO_MODELS);
        assert!(
            serves_alias(
                &format!("{base}/health"),
                &format!("{base}/v1/models"),
                "kato-local-brain"
            )
            .await
        );
        let local_root = std::env::temp_dir().join(format!(
            "katosync-impersonator-{}",
            uuid::Uuid::new_v4().simple()
        ));
        assert!(!managed_runtime_verified(&local_root));

        // Selbst ein Besitznachweis fuer einen echten Live-Prozess hilft nicht, solange die
        // installierte Runtime nicht ueber das gepinnte Ledger belegt ist.
        let exe = fs::canonicalize(std::env::current_exe().unwrap()).unwrap();
        let record = OwnershipRecord::capture(
            std::process::id(),
            &LaunchIdentity {
                executable: &exe,
                executable_sha256: &"0".repeat(64),
                runtime_version: &manifest().unwrap().runtime.version,
                port: PORT,
                model_alias: "kato-local-brain",
            },
        )
        .unwrap();
        guard::save_private_json(&guard::owner_record_path(&local_root), &record).unwrap();
        assert!(load_owner_record(&local_root).is_some());
        assert!(!managed_runtime_verified(&local_root));
        fs::remove_dir_all(&local_root).ok();
    }

    #[tokio::test]
    async fn unhealthy_foreign_or_absent_runtime_is_not_running() {
        let unhealthy = mock_llama_server(503, KATO_MODELS);
        assert!(
            !serves_alias(
                &format!("{unhealthy}/health"),
                &format!("{unhealthy}/v1/models"),
                "kato-local-brain"
            )
            .await
        );

        let foreign = mock_llama_server(200, r#"{"data":[{"id":"other-model"}]}"#);
        assert!(
            !serves_alias(
                &format!("{foreign}/health"),
                &format!("{foreign}/v1/models"),
                "kato-local-brain"
            )
            .await
        );

        let absent = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            format!("http://{}", listener.local_addr().unwrap())
        };
        assert!(
            !serves_alias(
                &format!("{absent}/health"),
                &format!("{absent}/v1/models"),
                "kato-local-brain"
            )
            .await
        );
    }

    #[tokio::test]
    async fn probe_refuses_non_loopback_endpoints() {
        assert!(!is_loopback_probe_url("http://192.168.1.10:17842/health"));
        assert!(!is_loopback_probe_url("https://example.com/health"));
        assert!(!is_loopback_probe_url("http://user@127.0.0.1:17842/health"));
        assert!(is_loopback_probe_url(HEALTH_URL));
        assert!(is_loopback_probe_url(MODELS_URL));
        assert!(
            !serves_alias(
                "http://example.com/health",
                "http://example.com/v1/models",
                "kato-local-brain"
            )
            .await
        );
    }

    #[test]
    fn models_alias_match_is_exact() {
        let body: serde_json::Value = serde_json::from_str(KATO_MODELS).unwrap();
        assert!(models_include_alias(&body, "kato-local-brain"));
        assert!(!models_include_alias(&body, "kato-local"));
        assert!(!models_include_alias(
            &serde_json::json!({}),
            "kato-local-brain"
        ));
    }
}
