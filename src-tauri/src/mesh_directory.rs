// Created by NMKato Solutions
//! Fail-closed, authenticated, read-only Supabase Mesh device directory.
//! A discovered device is NOT a trusted peer. No writer, socket listener or
//! pair-on-login side effect. Session tokens never cross the Tauri IPC boundary.
use serde::{Deserialize, Serialize};
use std::time::Duration;
use uuid::Uuid;
use zeroize::Zeroizing;

const MAX_ROSTER: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeshDirectoryDevice {
    pub device_id: Uuid,
    pub owner_user_id: Uuid,
    pub display_name: String,
    pub persona_name: Option<String>,
    pub platform_os: String,
    pub membership_state: String,
    pub fingerprint: String,
    pub last_seen_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshDirectoryRead {
    pub devices: Vec<MeshDirectoryDevice>,
    pub account_verified: bool,
    pub discovery_only: bool,
    pub transport_ready: bool,
    pub remote_jobs_enabled: bool,
}

fn validate_roster(
    records: &[MeshDirectoryDevice],
    verified_uid: &str,
) -> Result<(), &'static str> {
    let owner = Uuid::parse_str(verified_uid).map_err(|_| "MESH_DIRECTORY_BAD_ACCOUNT")?;
    if records.len() > MAX_ROSTER {
        return Err("MESH_DIRECTORY_LIMIT");
    }
    let mut identities = std::collections::HashSet::new();
    for device in records {
        if device.owner_user_id != owner {
            return Err("MESH_DIRECTORY_WRONG_OWNER");
        }
        if device.display_name.is_empty()
            || device.display_name.chars().count() > 80
            || device
                .persona_name
                .as_ref()
                .is_some_and(|v| v.chars().count() > 80)
            || device.fingerprint.len() != 47
            || !device
                .fingerprint
                .as_bytes()
                .chunks(3)
                .enumerate()
                .all(|(i, chunk)| {
                    if i < 15 {
                        chunk.len() == 3
                            && chunk[0].is_ascii_hexdigit()
                            && chunk[1].is_ascii_hexdigit()
                            && chunk[2] == b'-'
                    } else {
                        chunk.len() == 2
                            && chunk[0].is_ascii_hexdigit()
                            && chunk[1].is_ascii_hexdigit()
                    }
                })
            || !matches!(device.platform_os.as_str(), "macos" | "windows" | "linux")
            || !matches!(
                device.membership_state.as_str(),
                "discovered" | "pending" | "trusted" | "revoked"
            )
            || device
                .last_seen_at
                .as_ref()
                .is_some_and(|x| chrono::DateTime::parse_from_rfc3339(x).is_err())
            || !identities.insert(device.device_id)
        {
            return Err("MESH_DIRECTORY_INVALID_RECORD");
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn mesh_account_devices_list() -> Result<MeshDirectoryRead, String> {
    // Existing non-KATOOS auth configurations MUST NOT query a different account realm.
    if !cfg!(feature = "katoos-auth-qa") {
        return Err("MESH_DIRECTORY_NOT_CONFIGURED".into());
    }
    let uid = crate::github_app_auth::verified_katosync_user()
        .await
        .map_err(|_| "MESH_DIRECTORY_LOGIN_REQUIRED".to_string())?;
    let token = Zeroizing::new(
        crate::ensure_supabase_access_token()
            .await
            .map_err(|_| "MESH_DIRECTORY_LOGIN_REQUIRED".to_string())?,
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| "MESH_DIRECTORY_UNAVAILABLE".to_string())?;
    // Hardcoded database origin and allowlisted columns; no caller-supplied URL.
    let url = format!("{}/rest/v1/katosync_mesh_devices", crate::KATOSYNC_AUTH_URL);
    let request = client
        .get(url)
        .query(&[("select","device_id,owner_user_id,display_name,persona_name,platform_os,membership_state,fingerprint,last_seen_at"),("order","created_at.desc"),("limit","11")])
        .header("apikey",crate::KATOSYNC_AUTH_ANON_KEY)
        .bearer_auth(token.as_str());
    let response = request.send().await;
    let response = response.map_err(|_| "MESH_DIRECTORY_UNAVAILABLE".to_string())?;
    if !response.status().is_success() {
        return Err("MESH_DIRECTORY_UNAVAILABLE".into());
    }
    let content = response
        .bytes()
        .await
        .map_err(|_| "MESH_DIRECTORY_UNAVAILABLE".to_string())?;
    if content.len() > 32768 {
        return Err("MESH_DIRECTORY_LIMIT".into());
    }
    let devices: Vec<MeshDirectoryDevice> = serde_json::from_slice(&content)
        .map_err(|_| "MESH_DIRECTORY_INVALID_RECORD".to_string())?;
    validate_roster(&devices, &uid).map_err(str::to_string)?;
    crate::mesh_identity::same_account_still_verified(&uid)
        .await
        .map_err(|_| "MESH_DIRECTORY_LOGIN_REQUIRED".to_string())?;
    Ok(MeshDirectoryRead {
        devices,
        account_verified: true,
        discovery_only: true,
        transport_ready: false,
        remote_jobs_enabled: false,
    })
}

#[cfg(test)]
mod mesh_directory_tests {
    use super::*;
    const A: &str = "11111111-1111-4111-8111-111111111111";
    fn entry(owner: &str) -> MeshDirectoryDevice {
        MeshDirectoryDevice {
            device_id: Uuid::new_v4(),
            owner_user_id: Uuid::parse_str(owner).unwrap(),
            display_name: "M2".into(),
            persona_name: Some("Kato".into()),
            platform_os: "macos".into(),
            membership_state: "discovered".into(),
            fingerprint: (0..16).map(|_| "AB").collect::<Vec<_>>().join("-"),
            last_seen_at: None,
        }
    }
    #[test]
    fn only_the_verified_owner_sees_records() {
        assert!(validate_roster(&[entry(A)], A).is_ok());
        assert_eq!(
            validate_roster(&[entry(A)], "22222222-2222-4222-8222-222222222222"),
            Err("MESH_DIRECTORY_WRONG_OWNER")
        );
    }
    #[test]
    fn reject_fake_peer_status_and_duplicate_entries() {
        let mut first = entry(A);
        first.membership_state = "connected".into();
        assert_eq!(
            validate_roster(&[first], A),
            Err("MESH_DIRECTORY_INVALID_RECORD")
        );
        let first = entry(A);
        assert_eq!(
            validate_roster(&[first.clone(), first], A),
            Err("MESH_DIRECTORY_INVALID_RECORD")
        );
    }
    #[test]
    fn fail_closed_for_bad_fingerprint_and_oversized_directory() {
        let mut first = entry(A);
        first.fingerprint = "bogus".into();
        assert_eq!(
            validate_roster(&[first], A),
            Err("MESH_DIRECTORY_INVALID_RECORD")
        );
        let devices = (0..11).map(|_| entry(A)).collect::<Vec<_>>();
        assert_eq!(validate_roster(&devices, A), Err("MESH_DIRECTORY_LIMIT"));
    }
}
