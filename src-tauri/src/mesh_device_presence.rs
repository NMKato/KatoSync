// NMKato Solutions — Stage35d authenticated presence, separate from peer trust.
// A recent cloud report does NOT mean a live P2P channel is connected.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use zeroize::Zeroizing;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PresenceProof {
    protocol: &'static str,
    device_id: String,
    public_key: String,
    observed_at_ms: i64,
    signature: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeshPresenceReceipt {
    pub accepted: bool,
    pub reported_recently: bool,
    pub paired: bool,
    pub transport_ready: bool,
    pub remote_jobs_enabled: bool,
    pub next_poll_seconds: u64,
}

fn heartbeat_message(owner: &str, device_id: &str, public_key: &str, time_ms: i64) -> String {
    format!("katosync-mesh-device-heartbeat-v1\n{owner}\n{device_id}\n{public_key}\n{time_ms}")
}
fn sign_presence(
    identity: &SigningKey,
    owner: &str,
    device_id: &str,
    observed_at_ms: i64,
) -> Result<PresenceProof, &'static str> {
    if uuid::Uuid::parse_str(owner).is_err()
        || uuid::Uuid::parse_str(device_id).is_err()
        || observed_at_ms <= 0
    {
        return Err("MESH_PRESENCE_INVALID_IDENTITY");
    }
    let public_key = URL_SAFE_NO_PAD.encode(identity.verifying_key().as_bytes());
    let payload = heartbeat_message(owner, device_id, &public_key, observed_at_ms);
    let signature = URL_SAFE_NO_PAD.encode(identity.sign(payload.as_bytes()).to_bytes());
    Ok(PresenceProof {
        protocol: "katosync-mesh-device-heartbeat-v1",
        device_id: device_id.to_owned(),
        public_key,
        observed_at_ms,
        signature,
    })
}

#[tauri::command]
pub async fn mesh_device_presence_report() -> Result<MeshPresenceReceipt, String> {
    // Stage35 QA only. Production cannot silently gain a new remote API.
    if !cfg!(feature = "stage35-qa") {
        return Err("MESH_PRESENCE_NOT_CONFIGURED".into());
    }
    let uid = crate::github_app_auth::verified_katosync_user()
        .await
        .map_err(|_| "MESH_PRESENCE_LOGIN_REQUIRED".to_owned())?;
    // No silent generation of an unregistered device identity.
    let identity = crate::mesh_identity::existing_identity(&uid)
        .map_err(|_| "MESH_PRESENCE_IDENTITY_REQUIRED".to_owned())?;
    let local_fingerprint = crate::mesh_identity::fingerprint(&identity.verifying_key());
    // The directory is RLS-scoped and checked against the authenticated account.
    let roster = crate::mesh_directory::mesh_account_devices_list()
        .await
        .map_err(|_| "MESH_PRESENCE_DIRECTORY_UNAVAILABLE".to_owned())?;
    if !roster.account_verified || !roster.discovery_only || roster.transport_ready {
        return Err("MESH_PRESENCE_DIRECTORY_UNAVAILABLE".into());
    }
    let own = roster
        .devices
        .iter()
        .find(|device| {
            device.fingerprint == local_fingerprint && device.membership_state != "revoked"
        })
        .ok_or_else(|| "MESH_PRESENCE_NOT_REGISTERED".to_owned())?;
    let proof = sign_presence(
        &identity,
        &uid,
        &own.device_id.to_string(),
        chrono::Utc::now().timestamp_millis(),
    )
    .map_err(str::to_owned)?;
    crate::mesh_identity::same_account_still_verified(&uid)
        .await
        .map_err(|_| "MESH_PRESENCE_ACCOUNT_CHANGED".to_owned())?;
    let token = Zeroizing::new(
        crate::ensure_supabase_access_token()
            .await
            .map_err(|_| "MESH_PRESENCE_LOGIN_REQUIRED".to_owned())?,
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(9))
        .build()
        .map_err(|_| "MESH_PRESENCE_UNAVAILABLE".to_owned())?;
    let endpoint = format!(
        "{}/functions/v1/mesh-device-presence-qa",
        crate::KATOSYNC_AUTH_URL
    );
    let response = client
        .post(endpoint)
        .header("apikey", crate::KATOSYNC_AUTH_ANON_KEY)
        .bearer_auth(token.as_str())
        .json(&proof)
        .send()
        .await
        .map_err(|_| "MESH_PRESENCE_UNAVAILABLE".to_owned())?;
    if !response.status().is_success() {
        // Never forward server body, account details or source URLs into WebView.
        return Err("MESH_PRESENCE_UNAVAILABLE".into());
    }
    if response.content_length().is_some_and(|x| x > 1024) {
        return Err("MESH_PRESENCE_UNAVAILABLE".into());
    }
    let raw = response
        .bytes()
        .await
        .map_err(|_| "MESH_PRESENCE_UNAVAILABLE".to_owned())?;
    if raw.len() > 1024 {
        return Err("MESH_PRESENCE_UNAVAILABLE".into());
    }
    let receipt: MeshPresenceReceipt =
        serde_json::from_slice(&raw).map_err(|_| "MESH_PRESENCE_INVALID_RECEIPT".to_owned())?;
    if !receipt.accepted
        || !receipt.reported_recently
        || receipt.paired
        || receipt.transport_ready
        || receipt.remote_jobs_enabled
        || !(300..=3600).contains(&receipt.next_poll_seconds)
    {
        return Err("MESH_PRESENCE_INVALID_RECEIPT".into());
    }
    crate::mesh_identity::same_account_still_verified(&uid)
        .await
        .map_err(|_| "MESH_PRESENCE_ACCOUNT_CHANGED".to_owned())?;
    Ok(receipt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Verifier;

    #[test]
    fn native_signed_heartbeat_is_bound_to_exact_device_and_owner() {
        let key = SigningKey::from_bytes(&[11u8; 32]);
        let user = "11111111-1111-4111-8111-111111111111";
        let device = "22222222-2222-4222-8222-222222222222";
        let proof = sign_presence(&key, user, device, 1_793_773_200_000).unwrap();
        let message = heartbeat_message(user, device, &proof.public_key, proof.observed_at_ms);
        let sig = URL_SAFE_NO_PAD.decode(&proof.signature).unwrap();
        let signature = ed25519_dalek::Signature::from_slice(&sig).unwrap();
        assert!(key
            .verifying_key()
            .verify(message.as_bytes(), &signature)
            .is_ok());
        assert!(key
            .verifying_key()
            .verify(
                heartbeat_message(
                    user,
                    "33333333-3333-4333-8333-333333333333",
                    &proof.public_key,
                    proof.observed_at_ms
                )
                .as_bytes(),
                &signature
            )
            .is_err());
    }

    #[test]
    fn malformed_owner_or_device_cannot_be_signed() {
        let key = SigningKey::from_bytes(&[17u8; 32]);
        assert!(sign_presence(&key, "bad", "22222222-2222-4222-8222-222222222222", 1).is_err());
        assert!(sign_presence(&key, "11111111-1111-4111-8111-111111111111", "bad", 1).is_err());
        assert!(sign_presence(
            &key,
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
            -1
        )
        .is_err());
    }
}
