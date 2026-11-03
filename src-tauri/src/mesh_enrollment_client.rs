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

const MAX_ERROR_BODY: usize = 256;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EnrollmentRejection {
    error: String,
}

// Only expected server error codes become user-facing states. Never forward
// arbitrary remote response bodies or session details to the WebView.
fn classify_enrollment_rejection(status: reqwest::StatusCode, raw: &[u8]) -> &'static str {
    if status != reqwest::StatusCode::TOO_MANY_REQUESTS {
        return "MESH_DISCOVERY_UNAVAILABLE";
    }
    let Ok(reply) = serde_json::from_slice::<EnrollmentRejection>(raw) else {
        return "MESH_DISCOVERY_UNAVAILABLE";
    };
    match reply.error.as_str() {
        "DEVICE_QUOTA" => "MESH_DISCOVERY_DEVICE_QUOTA",
        "RATE_LIMIT" => "MESH_DISCOVERY_RATE_LIMIT",
        _ => "MESH_DISCOVERY_UNAVAILABLE",
    }
}

async fn limited_enrollment_rejection(mut response: reqwest::Response) -> String {
    let status = response.status();
    if status != reqwest::StatusCode::TOO_MANY_REQUESTS
        || response
            .content_length()
            .is_some_and(|len| len > MAX_ERROR_BODY as u64)
    {
        return "MESH_DISCOVERY_UNAVAILABLE".into();
    }
    let mut body = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if chunk.len() > MAX_ERROR_BODY - body.len() {
                    return "MESH_DISCOVERY_UNAVAILABLE".into();
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(_) => return "MESH_DISCOVERY_UNAVAILABLE".into(),
        }
    }
    classify_enrollment_rejection(status, &body).into()
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
        return Err(limited_enrollment_rejection(challenge).await);
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
        return Err(limited_enrollment_rejection(result).await);
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

#[cfg(test)]
mod quota_diagnostics_tests {
    use super::*;

    #[test]
    fn quota_and_rate_limit_are_distinct_bounded_messages() {
        let status = reqwest::StatusCode::TOO_MANY_REQUESTS;
        assert_eq!(
            classify_enrollment_rejection(status, br#"{"error":"DEVICE_QUOTA"}"#),
            "MESH_DISCOVERY_DEVICE_QUOTA"
        );
        assert_eq!(
            classify_enrollment_rejection(status, br#"{"error":"RATE_LIMIT"}"#),
            "MESH_DISCOVERY_RATE_LIMIT"
        );
    }

    #[test]
    fn untrusted_error_payloads_are_never_forwarded() {
        let denied = reqwest::StatusCode::TOO_MANY_REQUESTS;
        for raw in [
            br#"{"error":"PRIVATE_TOKEN"}"#.as_slice(),
            br#"{"error":"DEVICE_QUOTA","extra":"unexpected"}"#,
            br#"not json"#,
        ] {
            assert_eq!(
                classify_enrollment_rejection(denied, raw),
                "MESH_DISCOVERY_UNAVAILABLE"
            );
        }
        assert_eq!(
            classify_enrollment_rejection(
                reqwest::StatusCode::UNAUTHORIZED,
                br#"{"error":"DEVICE_QUOTA"}"#
            ),
            "MESH_DISCOVERY_UNAVAILABLE"
        );
    }
}
