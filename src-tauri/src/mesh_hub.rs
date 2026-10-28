// Created by NMKato Solutions
//! Lokale, account-unabhängige Gerätepräferenz für eine künftige Mesh-Hub-Rolle.
//! Aus dieser Präferenz entstehen KEINE Netzwerk-Sockets, Leases oder Rechte.
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::Path,
};
use tauri::Manager;

const CONFIG_FILE: &str = "mesh-hub-preference-v1.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredHubPreference {
    schema_version: u8,
    preferred: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshHubPreference {
    preferred: bool,
    hub_active: bool,
    transport_ready: bool,
    remote_jobs_enabled: bool,
    status: &'static str,
}

fn report(preferred: bool) -> MeshHubPreference {
    MeshHubPreference {
        preferred,
        hub_active: false,
        transport_ready: false,
        remote_jobs_enabled: false,
        status: "preference_only",
    }
}

fn decode(raw: &[u8]) -> Result<bool, String> {
    if raw.len() > 128 {
        return Err("MESH_HUB_PREF_INVALID".into());
    }
    let setting: StoredHubPreference =
        serde_json::from_slice(raw).map_err(|_| "MESH_HUB_PREF_INVALID".to_string())?;
    if setting.schema_version != 1 {
        return Err("MESH_HUB_PREF_INVALID".into());
    }
    Ok(setting.preferred)
}

fn load(path: &Path) -> Result<bool, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("MESH_HUB_PREF_UNAVAILABLE".into()),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 128 {
        return Err("MESH_HUB_PREF_INVALID".into());
    }
    let bytes = fs::read(path).map_err(|_| "MESH_HUB_PREF_UNAVAILABLE".to_string())?;
    decode(&bytes)
}

fn store(path: &Path, preferred: bool) -> Result<(), String> {
    let parent = path.parent().ok_or("MESH_HUB_PREF_UNAVAILABLE")?;
    fs::create_dir_all(parent).map_err(|_| "MESH_HUB_PREF_UNAVAILABLE".to_string())?;
    // Never overwrite a symlink or an unexpectedly shaped existing preference.
    match fs::symlink_metadata(path) {
        Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() => {
            return Err("MESH_HUB_PREF_INVALID".into());
        }
        Ok(_) => {
            load(path)?;
        }
        Err(e) if e.kind() == ErrorKind::NotFound => {}
        Err(_) => return Err("MESH_HUB_PREF_UNAVAILABLE".into()),
    }
    let temp = parent.join(format!(".mesh-hub-preference-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<(), String> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temp)
            .map_err(|_| "MESH_HUB_PREF_UNAVAILABLE")?;
        let payload = serde_json::to_vec(&StoredHubPreference {
            schema_version: 1,
            preferred,
        })
        .map_err(|_| "MESH_HUB_PREF_UNAVAILABLE")?;
        file.write_all(&payload)
            .and_then(|_| file.sync_all())
            .map_err(|_| "MESH_HUB_PREF_UNAVAILABLE")?;
        fs::rename(&temp, path).map_err(|_| "MESH_HUB_PREF_UNAVAILABLE")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

#[tauri::command]
pub fn mesh_hub_preference_get(app: tauri::AppHandle) -> Result<MeshHubPreference, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|_| "MESH_HUB_PREF_UNAVAILABLE".to_string())?
        .join(CONFIG_FILE);
    load(&path).map(report)
}

#[tauri::command]
pub fn mesh_hub_preference_set(
    app: tauri::AppHandle,
    preferred: bool,
) -> Result<MeshHubPreference, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|_| "MESH_HUB_PREF_UNAVAILABLE".to_string())?
        .join(CONFIG_FILE);
    store(&path, preferred)?;
    let reloaded = load(&path)?;
    if reloaded != preferred {
        return Err("MESH_HUB_PREF_UNAVAILABLE".into());
    }
    Ok(report(reloaded))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_disabled_with_no_file_and_never_claims_server_status() {
        let dir = std::env::temp_dir().join(format!("katosync-hub-test-{}", uuid::Uuid::new_v4()));
        let path = dir.join(CONFIG_FILE);
        assert!(!load(&path).unwrap());
        let state = report(true);
        assert!(state.preferred);
        assert!(!state.hub_active && !state.transport_ready && !state.remote_jobs_enabled);
        assert_eq!(state.status, "preference_only");
    }

    #[test]
    fn toggling_survives_restart_via_atomic_readback() {
        let dir = std::env::temp_dir().join(format!("katosync-hub-test-{}", uuid::Uuid::new_v4()));
        let path = dir.join(CONFIG_FILE);
        store(&path, true).unwrap();
        assert!(load(&path).unwrap());
        store(&path, false).unwrap();
        assert!(!load(&path).unwrap());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn malformed_or_privilege_like_fields_are_rejected() {
        assert!(
            decode(br#"{"schema_version":1,"preferred":true,"remoteJobsEnabled":true}"#).is_err()
        );
        assert!(decode(br#"{"schema_version":2,"preferred":true}"#).is_err());
        assert!(decode(&vec![b'A'; 129]).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_preference_cannot_be_followed_or_written() {
        use std::os::unix::fs::symlink;
        let dir = std::env::temp_dir().join(format!("katosync-hub-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("target");
        std::fs::write(&target, b"do-not-touch").unwrap();
        let path = dir.join(CONFIG_FILE);
        symlink(&target, &path).unwrap();
        assert!(load(&path).is_err());
        assert!(store(&path, true).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"do-not-touch");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
