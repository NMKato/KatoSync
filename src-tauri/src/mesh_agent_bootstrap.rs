// Created by NMKato Solutions
//! Stage 3.5: local hardware capabilities and stable agent self-introduction.
//! Authentication is mandatory before a cryptographic identity is generated.
//! No public device enrollment, implicit peer trust, remote dispatch or socket.
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentHardwareProfile {
    pub platform: &'static str,
    pub architecture: &'static str,
    pub chip_family: Option<String>,
    pub logical_cpu_cores: u16,
    pub memory_gib_bucket: Option<u16>,
    pub recommended_role: &'static str,
    pub local_model_status: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBootstrapSnapshot {
    pub protocol: &'static str,
    pub agent_name: String,
    pub fingerprint: String,
    pub hardware: AgentHardwareProfile,
    pub owner_session_verified: bool,
    pub roster_discovery_allowed: bool,
    pub trusted_peers: u8,
    pub transport_ready: bool,
    pub remote_jobs_enabled: bool,
}

fn coarse_memory_gib(bytes: u64) -> Option<u16> {
    if bytes < (1 << 30) {
        return None;
    }
    let gib = bytes / (1 << 30);
    // Coarse rather than exact memory metrics; no unique hardware identifiers.
    let bucket = if gib < 8 {
        4
    } else if gib < 16 {
        8
    } else if gib < 32 {
        16
    } else if gib < 64 {
        32
    } else if gib < 128 {
        64
    } else {
        128
    };
    Some(bucket)
}

#[cfg(target_os = "macos")]
fn total_memory() -> Option<u64> {
    let result = Command::new("/usr/sbin/sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok()?;
    if !result.status.success() || result.stdout.len() > 32 {
        return None;
    }
    String::from_utf8(result.stdout).ok()?.trim().parse().ok()
}

#[cfg(target_os = "linux")]
fn total_memory() -> Option<u64> {
    let contents = std::fs::read_to_string("/proc/meminfo").ok()?;
    let kb = contents.lines().find_map(|line| {
        line.strip_prefix("MemTotal:")
            .and_then(|rest| rest.split_whitespace().next())
            .and_then(|n| n.parse::<u64>().ok())
    })?;
    kb.checked_mul(1024)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn total_memory() -> Option<u64> {
    // A missing probe is unknown, not an invented RAM capacity.
    None
}

fn role(cores: u16, memory: Option<u16>) -> &'static str {
    match memory {
        Some(m) if m >= 32 && cores >= 8 => "heavy_local",
        Some(m) if m >= 8 && cores >= 4 => "local_agent",
        Some(_) => "light_agent",
        None => "unassessed",
    }
}

#[cfg(target_os = "macos")]
fn chip_family() -> Option<String> {
    let result = Command::new("/usr/sbin/system_profiler")
        .args(["SPHardwareDataType", "-detailLevel", "mini"])
        .output()
        .ok()?;
    if !result.status.success() || result.stdout.len() > 16 * 1024 {
        return None;
    }
    let content = String::from_utf8(result.stdout).ok()?;
    let name = content
        .lines()
        .find_map(|line| line.trim().strip_prefix("Chip:"))
        .map(str::trim)?;
    // Strict allowlist: no serial number, host, model identifier, account or IP.
    if name.len() <= 40
        && name.starts_with("Apple M")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == ' ')
    {
        Some(name.to_string())
    } else {
        None
    }
}

#[cfg(not(target_os = "macos"))]
fn chip_family() -> Option<String> {
    None
}

fn hardware() -> AgentHardwareProfile {
    let cores = std::thread::available_parallelism()
        .map(|count| count.get().min(256) as u16)
        .unwrap_or(0);
    let memory = total_memory().and_then(coarse_memory_gib);
    AgentHardwareProfile {
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        chip_family: chip_family(),
        logical_cpu_cores: cores,
        memory_gib_bucket: memory,
        recommended_role: role(cores, memory),
        // Model availability must be verified separately by local_brain_status.
        local_model_status: "not_verified",
    }
}

fn agent_name(fingerprint: &str, platform: &str) -> Result<String, &'static str> {
    let clean = fingerprint.replace('-', "");
    if clean.len() != 32 || !clean.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("MESH_BOOTSTRAP_BAD_FINGERPRINT");
    }
    const NAMES: [&str; 16] = [
        "Nova", "Atlas", "Orion", "Lyra", "Astra", "Mira", "Vega", "Solis", "Echo", "Nexus", "Ari",
        "Lumen", "Tera", "Nika", "Sirius", "Pax",
    ];
    let last =
        u8::from_str_radix(&clean[30..32], 16).map_err(|_| "MESH_BOOTSTRAP_BAD_FINGERPRINT")?;
    let suffix = &clean[24..28];
    let family = match platform {
        "macos" => "Mac",
        "windows" => "Win",
        "linux" => "Linux",
        _ => "Device",
    };
    // Based on public key fingerprint, not usernames or hostnames.
    Ok(format!(
        "KAI {} {}-{}",
        NAMES[(last % 16) as usize],
        family,
        suffix
    ))
}

#[tauri::command]
pub async fn mesh_agent_bootstrap_snapshot() -> Result<AgentBootstrapSnapshot, String> {
    let uid = crate::github_app_auth::verified_katosync_user()
        .await
        .map_err(|_| "MESH_BOOTSTRAP_LOGIN_REQUIRED".to_string())?;
    // Existing key first; create on the first authenticated start only.
    let signing = crate::mesh_identity::ensure_identity(&uid)
        .map_err(|_| "MESH_BOOTSTRAP_KEYCHAIN_UNAVAILABLE".to_string())?;
    crate::mesh_identity::same_account_still_verified(&uid)
        .await
        .map_err(|_| "MESH_BOOTSTRAP_SESSION_CHANGED".to_string())?;
    let fp = crate::mesh_identity::fingerprint(&signing.verifying_key());
    // Never run system_profiler on the asynchronous GUI worker.
    let hw = tokio::task::spawn_blocking(hardware)
        .await
        .map_err(|_| "MESH_BOOTSTRAP_HARDWARE_UNAVAILABLE".to_string())?;
    let name = agent_name(&fp, hw.platform).map_err(str::to_string)?;
    Ok(AgentBootstrapSnapshot {
        protocol: "katosync-mesh-agent-bootstrap-v35",
        agent_name: name,
        fingerprint: fp,
        hardware: hw,
        owner_session_verified: true,
        roster_discovery_allowed: true,
        trusted_peers: 0,
        transport_ready: false,
        remote_jobs_enabled: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn naming_is_stable_and_contains_no_hostname_or_account() {
        let fp = "A1-B2-C3-D4-E5-F6-12-34-56-78-AB-CD-EF-98-76-54";
        let a = agent_name(fp, "macos").unwrap();
        let b = agent_name(fp, "macos").unwrap();
        assert_eq!(a, b);
        assert!(a.starts_with("KAI "));
        assert!(a.contains(" Mac-"));
        assert!(a.len() <= 36);
        assert!(!a.contains("fritz"));
        assert!(agent_name("bad", "macos").is_err());
    }
    #[test]
    fn conservative_hardware_roles() {
        assert_eq!(coarse_memory_gib(16 * 1024 * 1024 * 1024), Some(16));
        assert_eq!(role(12, Some(64)), "heavy_local");
        assert_eq!(role(8, Some(8)), "local_agent");
        assert_eq!(role(2, Some(4)), "light_agent");
        assert_eq!(role(32, None), "unassessed");
    }
    #[test]
    fn local_hardware_probe_does_not_claim_model_or_mesh_connection() {
        let h = hardware();
        assert!(!h.platform.is_empty());
        assert_eq!(h.local_model_status, "not_verified");
        if let Some(chip) = h.chip_family {
            assert!(chip.starts_with("Apple M"));
            assert!(!chip.contains("Serial"));
        }
    }
}
