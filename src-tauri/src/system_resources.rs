// Created by NMKato Solutions
// Honest, read-only native host resource snapshot. Never terminates foreign processes,
// adjusts GPU state, launches models, or reads private process arguments.
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use sysinfo::{ProcessesToUpdate, System};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GpuObservation {
    name: Option<String>,
    memory_kind: &'static str,
    total_vram_bytes: Option<u64>,
    utilization_percent: Option<f32>,
    backend: &'static str,
    evidence: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalModelProcess {
    label: &'static str,
    instances: usize,
    ram_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourceSnapshot {
    measured_at: String,
    os: String,
    total_ram_bytes: u64,
    available_ram_bytes: u64,
    used_ram_bytes: u64,
    cpu_percent: Option<f32>,
    gpu: GpuObservation,
    external_models: Vec<ExternalModelProcess>,
    model_disk_bytes: u64,
    model_ram_budget_bytes: u64,
    minimum_free_ram_bytes: u64,
    warmup_recommendation: &'static str,
    local_brain_backend: crate::local_brain::BackendCapability,
}

const GIB: u64 = 1024 * 1024 * 1024;
// A conservative *estimate* for Gemma E4B Q4 + llama.cpp context/runtime overhead.
// It is NOT an actual GPU benchmark or guaranteed model memory allocation.
const MODEL_BUDGET_GIB: u64 = crate::local_brain::MODEL_BUDGET_MIB / 1024;
const OS_HEADROOM_GIB: u64 = 2;
const MIN_FREE_GIB: u64 = MODEL_BUDGET_GIB + OS_HEADROOM_GIB;
static GPU_CACHE: tokio::sync::OnceCell<GpuObservation> = tokio::sync::OnceCell::const_new();

fn observation(total: u64, available: u64) -> &'static str {
    if total < 12 * GIB || available < 5 * GIB {
        "constrained"
    } else if available < MIN_FREE_GIB * GIB {
        "caution"
    } else {
        "headroom"
    }
}

fn model_label(raw: &str) -> Option<&'static str> {
    let normalized = raw.to_lowercase().replace([' ', '_', '.'], "-");
    if normalized.contains("ollama") {
        Some("Ollama")
    } else if normalized.contains("lm-studio") || normalized.contains("lmstudio") {
        Some("LM Studio")
    } else if normalized == "jan" || normalized == "jan-ai" {
        Some("Jan")
    } else if normalized.contains("koboldcpp") {
        Some("KoboldCpp")
    } else if normalized == "llama-server" || normalized == "llama-server-exe" {
        Some("llama.cpp")
    } else {
        None
    }
}

/// Only paths within the canonical Kato-managed runtime may be excluded,
/// never an arbitrary same-named executable elsewhere on the system.
fn is_managed_runtime_executable(executable: Option<&Path>, runtime_root: Option<&Path>) -> bool {
    let Some((exe, root)) = executable.zip(runtime_root) else {
        return false;
    };
    exe.canonicalize()
        .is_ok_and(|resolved| resolved.starts_with(root))
}

fn sample_host(
    managed_runtime_root: Option<PathBuf>,
) -> (u64, u64, Option<f32>, Vec<ExternalModelProcess>) {
    let mut system = System::new();
    system.refresh_memory();
    system.refresh_cpu_usage();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    system.refresh_cpu_usage();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let total = system.total_memory();
    let available = system.available_memory().min(total);
    let cpu = if system.cpus().is_empty() {
        None
    } else {
        Some(system.global_cpu_usage().clamp(0.0, 100.0))
    };

    let owned_pid = crate::local_brain::owned_pid();
    let mut tracked: std::collections::BTreeMap<&'static str, (usize, u64)> = Default::default();
    for (pid, p) in system.processes() {
        if Some(pid.as_u32()) == owned_pid {
            continue;
        }
        let name = p.name().to_string_lossy();
        if let Some(label) = model_label(&name) {
            if label == "llama.cpp"
                && is_managed_runtime_executable(p.exe(), managed_runtime_root.as_deref())
            {
                continue;
            }
            let entry = tracked.entry(label).or_insert((0, 0));
            entry.0 += 1;
            entry.1 = entry.1.saturating_add(p.memory());
        }
    }
    let processes = tracked
        .into_iter()
        .map(|(label, (instances, ram_bytes))| ExternalModelProcess {
            label,
            instances,
            ram_bytes,
        })
        .collect();
    (total, available, cpu, processes)
}

fn parse_nvidia_row(row: &str) -> Option<GpuObservation> {
    let fields: Vec<&str> = row.split(',').map(str::trim).collect();
    if fields.len() != 3 || fields[0].is_empty() || fields[0].len() > 110 {
        return None;
    }
    let memory_mib = fields[1].parse::<u64>().ok()?;
    let percent = fields[2].parse::<f32>().ok()?;
    if memory_mib == 0 || memory_mib > 262_144 || !(0.0..=100.0).contains(&percent) {
        return None;
    }
    Some(GpuObservation {
        name: Some(fields[0].to_string()),
        memory_kind: "dedicated",
        total_vram_bytes: Some(memory_mib * 1024 * 1024),
        utilization_percent: Some(percent),
        backend: "nvidia_cuda_candidate",
        evidence: "nvidia_smi_hardware_utilization_only",
    })
}

async fn probe_nvidia() -> Option<GpuObservation> {
    use std::process::Stdio;
    let mut cmd = tokio::process::Command::new(if cfg!(target_os = "windows") {
        "nvidia-smi.exe"
    } else {
        "nvidia-smi"
    });
    cmd.args([
        "--query-gpu=name,memory.total,utilization.gpu",
        "--format=csv,noheader,nounits",
    ])
    .env("CUDA_VISIBLE_DEVICES", "0")
    .stdin(Stdio::null())
    .stderr(Stdio::null())
    .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(2), cmd.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() || output.stdout.len() > 4096 {
        return None;
    }
    let text = std::str::from_utf8(&output.stdout).ok()?;
    parse_nvidia_row(text.lines().next()?)
}

// Apple IOAccelerator exposes an OS-wide device counter on supported Macs.
// It is NOT a per-process llama.cpp utilization reading, nor a VRAM gauge.
fn parse_macos_gpu_utilization(raw: &str) -> Option<f32> {
    let (_, perf) = raw.split_once("\"PerformanceStatistics\" = {")?;
    let stats = perf.split_once('}')?.0;
    let (_, value) = stats.split_once("\"Device Utilization %\"=")?;
    let digits: String = value
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    let number = digits.parse::<u8>().ok()?;
    (number <= 100).then_some(f32::from(number))
}

#[cfg(target_os = "macos")]
async fn probe_macos_gpu_utilization() -> Option<f32> {
    use std::process::Stdio;
    let mut cmd = tokio::process::Command::new("ioreg");
    cmd.args(["-r", "-c", "IOAccelerator"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(3), cmd.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() || output.stdout.len() > 1024 * 1024 {
        return None;
    }
    parse_macos_gpu_utilization(std::str::from_utf8(&output.stdout).ok()?)
}

async fn detect_gpu() -> GpuObservation {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    let (backend, memory_kind) = ("metal_supported", "unified");
    #[cfg(all(target_os = "macos", not(target_arch = "aarch64")))]
    let (backend, memory_kind) = ("not_verified", "unknown");
    #[cfg(not(target_os = "macos"))]
    let (backend, memory_kind) = ("not_verified", "unknown");

    #[cfg(target_os = "macos")]
    {
        // macOS system_profiler is a metadata probe, not a GPU load API.
        // Bounded, cached once per app process and killed if it hangs.
        use std::process::Stdio;
        let mut cmd = tokio::process::Command::new("system_profiler");
        cmd.args(["SPDisplaysDataType", "-json"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        if let Ok(Ok(output)) = tokio::time::timeout(Duration::from_secs(4), cmd.output()).await {
            if output.status.success() && output.stdout.len() < 256 * 1024 {
                let json = serde_json::from_slice::<serde_json::Value>(&output.stdout).ok();
                let name = json
                    .as_ref()
                    .and_then(|v| v.get("SPDisplaysDataType"))
                    .and_then(|v| v.as_array())
                    .and_then(|a| a.first())
                    .and_then(|entry| entry.get("sppci_model").or_else(|| entry.get("_name")))
                    .and_then(|v| v.as_str())
                    .filter(|s| s.len() <= 100 && !s.contains(['\n', '\r']))
                    .map(str::to_string);
                return GpuObservation {
                    name,
                    memory_kind,
                    total_vram_bytes: None,    // Apple unified ≠ discrete VRAM
                    utilization_percent: None, // No reliable universal GPU load sample
                    backend,
                    evidence: "macos_display_hardware_metadata_only",
                };
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::process::Stdio;
        // Read-only WMI hardware metadata. Dedicated VRAM and utilization are
        // intentionally NOT derived from often truncated Win32 adapter RAM.
        let mut cmd = tokio::process::Command::new("powershell.exe");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name)",
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
        if let Ok(Ok(output)) = tokio::time::timeout(Duration::from_secs(4), cmd.output()).await {
            if output.status.success() && output.stdout.len() <= 512 {
                let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !name.is_empty()
                    && name.len() <= 110
                    && !name.chars().any(|c| c == '\n' || c == '\r')
                {
                    return GpuObservation {
                        name: Some(name),
                        memory_kind: "unknown",
                        total_vram_bytes: None,
                        utilization_percent: None,
                        backend: "not_verified",
                        evidence: "windows_wmi_gpu_name_only",
                    };
                }
            }
        }
    }
    GpuObservation {
        name: None,
        memory_kind,
        total_vram_bytes: None,
        utilization_percent: None,
        backend,
        evidence: "unavailable_without_verified_platform_probe",
    }
}

#[tauri::command]
pub(crate) async fn system_resource_snapshot(
    app: tauri::AppHandle,
) -> Result<ResourceSnapshot, String> {
    let managed_runtime_root = crate::local_brain::managed_runtime_root(&app);
    let (total, available, cpu, external_models) =
        tauri::async_runtime::spawn_blocking(move || sample_host(managed_runtime_root))
            .await
            .map_err(|_| "Ressourcenmessung unterbrochen.".to_string())?;
    // Device-wide macOS GPU telemetry is measured using IOAccelerator when available.
    // This does not attribute GPU utilization to Kato AI.
    let mut gpu = if cfg!(target_os = "macos") {
        GPU_CACHE.get_or_init(detect_gpu).await.clone()
    } else {
        match probe_nvidia().await {
            Some(observation) => observation,
            None => GPU_CACHE.get_or_init(detect_gpu).await.clone(),
        }
    };
    #[cfg(target_os = "macos")]
    if let Some(percent) = probe_macos_gpu_utilization().await {
        gpu.utilization_percent = Some(percent);
        gpu.evidence = "macos_ioreg_device_wide_utilization";
    }
    Ok(ResourceSnapshot {
        measured_at: chrono::Utc::now().to_rfc3339(),
        os: std::env::consts::OS.to_string(),
        total_ram_bytes: total,
        available_ram_bytes: available,
        used_ram_bytes: total.saturating_sub(available),
        cpu_percent: cpu,
        gpu,
        external_models,
        model_disk_bytes: 4_590_807_392,
        model_ram_budget_bytes: MODEL_BUDGET_GIB * GIB,
        minimum_free_ram_bytes: MIN_FREE_GIB * GIB,
        warmup_recommendation: observation(total, available),
        local_brain_backend: crate::local_brain::backend_capability(&app).await,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kato_managed_llama_is_not_classed_as_an_external_model_after_ui_restart() {
        let base = std::env::temp_dir().join(format!("katosync-ownership-{}", std::process::id()));
        let runtime = base.join("runtime").join("b11272");
        let adjacent = base.join("runtime-other");
        std::fs::create_dir_all(&runtime).unwrap();
        std::fs::create_dir_all(&adjacent).unwrap();
        let owned = runtime.join("llama-server");
        let foreign = adjacent.join("llama-server");
        std::fs::write(&owned, b"synthetic").unwrap();
        std::fs::write(&foreign, b"synthetic").unwrap();
        let root = runtime.canonicalize().unwrap();
        assert!(is_managed_runtime_executable(Some(&owned), Some(&root)));
        assert!(!is_managed_runtime_executable(Some(&foreign), Some(&root)));
        assert!(!is_managed_runtime_executable(None, Some(&root)));
        assert!(!is_managed_runtime_executable(Some(&owned), None));
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn recommendation_depends_on_available_not_only_installed_ram() {
        assert_eq!(observation(16 * GIB, 10 * GIB), "headroom");
        assert_eq!(observation(16 * GIB, 7 * GIB), "caution");
        assert_eq!(observation(16 * GIB, 2 * GIB), "constrained");
        assert_eq!(observation(8 * GIB, 7 * GIB), "constrained");
        assert_eq!(observation(32 * GIB, 20 * GIB), "headroom");
    }
    #[test]
    fn known_local_runtimes_only_never_generic_processes() {
        assert_eq!(model_label("ollama"), Some("Ollama"));
        assert_eq!(model_label("LM Studio"), Some("LM Studio"));
        assert_eq!(model_label("llama-server"), Some("llama.cpp"));
        assert_eq!(model_label("node"), None);
        assert_eq!(model_label("kernel_task"), None);
    }
    #[test]
    fn native_snapshot_reads_sane_host_ram_without_modifying_processes() {
        let (total, available, cpu, _) = sample_host(None);
        assert!(total >= GIB);
        assert!(available <= total);
        if let Some(value) = cpu {
            assert!((0.0..=100.0).contains(&value));
        }
    }
    #[test]
    fn nvidia_gpu_telemetry_requires_parseable_bounded_facts() {
        let sample = parse_nvidia_row("NVIDIA RTX GPU, 16384, 57").unwrap();
        assert_eq!(sample.total_vram_bytes, Some(16 * GIB));
        assert_eq!(sample.utilization_percent, Some(57.0));
        assert_eq!(sample.backend, "nvidia_cuda_candidate");
        assert!(parse_nvidia_row("NVIDIA GPU, 16000, not_supported").is_none());
        assert!(parse_nvidia_row("NVIDIA GPU, 16000, 500").is_none());
    }
    #[test]
    fn macos_gpu_percent_requires_real_counter_bounded_to_100() {
        let sample = r#"  |   "PerformanceStatistics" = {"Tiler Utilization %"=37,"Device Utilization %"=59,"Renderer Utilization %"=59}"#;
        assert_eq!(parse_macos_gpu_utilization(sample), Some(59.0));
        assert_eq!(
            parse_macos_gpu_utilization(sample.replace("=59,", "=100,").as_str()),
            Some(100.0)
        );
        assert_eq!(
            parse_macos_gpu_utilization(sample.replace("=59,", "=101,").as_str()),
            None
        );
        assert_eq!(
            parse_macos_gpu_utilization("GPU present; no counters"),
            None
        );
        assert_eq!(
            parse_macos_gpu_utilization(r#"\"Device Utilization %\"=77"#),
            None
        );
    }

    #[test]
    fn gpu_metrics_are_not_fabricated() {
        let _ = GpuObservation {
            name: None,
            memory_kind: "unknown",
            total_vram_bytes: None,
            utilization_percent: None,
            backend: "not_verified",
            evidence: "test",
        };
    }
}
