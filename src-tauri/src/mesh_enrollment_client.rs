// Created by NMKato Solutions
//! Explicit scan action: owner-verified challenge, native Ed25519 key proof,
//! discovery-only server registration, then the existing fail-closed roster.
//! The function does NOT establish trust, mTLS or remote job permissions.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;
use zeroize::Zeroizing;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiscoveryReceipt {
    discovered: bool,
    paired: bool,
    transport_ready: bool,
    remote_jobs_enabled: bool,
}

#[tauri::command]
pub async fn mesh_account_device_discover(
) -> Result<crate::mesh_directory::MeshDirectoryRead, String> {
    if !cfg!(feature = "katoos-auth-qa") {
        return Err("MESH_DISCOVERY_NOT_CONFIGURED".into());
    }
    let uid = crate::github_app_auth::verified_katosync_user()
        .await
        .map_err(|_| "MESH_DISCOVERY_LOGIN_REQUIRED".to_string())?;
    let identity = crate::mesh_identity::ensure_identity(&uid)
        .map_err(|_| "MESH_DISCOVERY_IDENTITY_UNAVAILABLE".to_string())?;
    let public_key = URL_SAFE_NO_PAD.encode(identity.verifying_key().as_bytes());
    let token = Zeroizing::new(
        crate::ensure_supabase_access_token()
            .await
            .map_err(|_| "MESH_DISCOVERY_LOGIN_REQUIRED".to_string())?,
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "MESH_DISCOVERY_UNAVAILABLE".to_string())?;
    // URL is fixed to canonical KATOOS; the UI cannot provide a target host.
    let base = format!(
        "{}/functions/v1/mesh-device-enrollment",
        crate::KATOSYNC_AUTH_URL
    );
    let challenge = client
        .post(&base)
        .header("apikey", crate::KATOSYNC_AUTH_ANON_KEY)
        .bearer_auth(token.as_str())
        .json(&json!({"publicKey":public_key}))
        .send()
        .await
        .map_err(|_| "MESH_DISCOVERY_UNAVAILABLE".to_string())?;
    if !challenge.status().is_success() {
        return Err("MESH_DISCOVERY_UNAVAILABLE".into());
    }
    let challenge: crate::mesh_identity::MeshEnrollmentChallenge = challenge
        .json()
        .await
        .map_err(|_| "MESH_DISCOVERY_INVALID_CHALLENGE".to_string())?;
    let proof = crate::mesh_identity::mesh_device_enrollment_proof(challenge)
        .await
        .map_err(|_| "MESH_DISCOVERY_INVALID_CHALLENGE".to_string())?;
    let short = &proof.public_key[..5];
    let os = std::env::consts::OS;
    if !matches!(os, "macos" | "windows" | "linux") {
        return Err("MESH_DISCOVERY_PLATFORM_UNAVAILABLE".into());
    }
    let name = format!("KatoSync {os} {short}");
    let payload = json!({
        "protocol": proof.protocol,
        "challengeId": proof.challenge_id,
        "nonce": proof.nonce,
        "publicKey": proof.public_key,
        "expiresAt": proof.expires_at,
        "signature": proof.signature,
        "deviceName": name,
        "platformOs": os,
    });
    let result = client
        .post(format!("{base}/complete"))
        .header("apikey", crate::KATOSYNC_AUTH_ANON_KEY)
        .bearer_auth(token.as_str())
        .json(&payload)
        .send()
        .await
        .map_err(|_| "MESH_DISCOVERY_UNAVAILABLE".to_string())?;
    if !result.status().is_success() {
        return Err("MESH_DISCOVERY_UNAVAILABLE".into());
    }
    let receipt: DiscoveryReceipt = result
        .json()
        .await
        .map_err(|_| "MESH_DISCOVERY_INVALID_RECEIPT".to_string())?;
    if !receipt.discovered
        || receipt.paired
        || receipt.transport_ready
        || receipt.remote_jobs_enabled
    {
        return Err("MESH_DISCOVERY_INVALID_RECEIPT".into());
    }
    crate::mesh_identity::same_account_still_verified(&uid)
        .await
        .map_err(|_| "MESH_DISCOVERY_LOGIN_REQUIRED".to_string())?;
    crate::mesh_directory::mesh_account_devices_list().await
}
