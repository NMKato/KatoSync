// Created by NMKato Solutions
//! Stage 2M/2N: native recipient-bound signing; QA send is strictly opt-in, never peer trust.
//! The existing Keychain identity MUST match a registered owner-scoped source device.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::mesh_identity::{
    existing_identity, generate_offer, same_account_still_verified, MeshOffer,
};

const PROTOCOL: &str = "katosync-mesh-inbox-send-v1";
const ROSTER_LIMIT: usize = 10;
const ROSTER_MAX_BYTES: usize = 24_576;
// Two independent opt-ins: compile-time QA flag and server-side Edge deployment gate.
// Never derive a privileged service-role credential in the client.
fn send_qa_enabled() -> bool {
    option_env!("KATOSYNC_MESH_INBOX_SEND_QA") == Some("1")
}
const RESPONSE_MAX_BYTES: usize = 2048;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct DeviceRecord {
    device_id: Uuid,
    owner_user_id: Uuid,
    signing_public_key: String,
    membership_state: String,
    revoked_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeInboxInvite {
    protocol: &'static str,
    source_device_id: Uuid,
    target_device_id: Uuid,
    signed_offer: MeshOffer,
    dispatch_signature: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeliveryReceipt {
    request_id: Uuid,
    expires_at: String,
    delivery_only: bool,
    paired: bool,
    transport_ready: bool,
    remote_jobs_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshDeliveryStatus {
    pub request_id: Uuid,
    pub expires_at: String,
    pub delivery_only: bool,
    pub paired: bool,
    pub transport_ready: bool,
    pub remote_jobs_enabled: bool,
}

fn verify_receipt(
    receipt: DeliveryReceipt,
    offer: &MeshOffer,
    now: i64,
) -> Result<MeshDeliveryStatus, &'static str> {
    let expires = chrono::DateTime::parse_from_rfc3339(&receipt.expires_at)
        .map_err(|_| "MESH_INBOX_INVALID_RECEIPT")?;
    if receipt.delivery_only != true
        || receipt.paired
        || receipt.transport_ready
        || receipt.remote_jobs_enabled
        || expires.timestamp() != offer.expires_at
        || offer.expires_at <= now
    {
        return Err("MESH_INBOX_INVALID_RECEIPT");
    }
    Ok(MeshDeliveryStatus {
        request_id: receipt.request_id,
        expires_at: receipt.expires_at,
        delivery_only: true,
        paired: false,
        transport_ready: false,
        remote_jobs_enabled: false,
    })
}

fn classify_send_failure(status: reqwest::StatusCode, raw: &[u8]) -> &'static str {
    // Never propagate untrusted backend error bodies or session details to Tauri JS.
    let code = serde_json::from_slice::<serde_json::Value>(raw)
        .ok()
        .and_then(|value| value.get("error")?.as_str().map(str::to_string));
    match (status.as_u16(), code.as_deref()) {
        (401, _) => "MESH_INBOX_LOGIN_REQUIRED",
        (403, Some("KATOSYNC_MEMBERSHIP_REQUIRED")) => "MESH_INBOX_MEMBERSHIP_REQUIRED",
        (403, _) => "MESH_INBOX_DEVICE_NOT_ELIGIBLE",
        (409, Some("ALREADY_PENDING")) => "MESH_INBOX_ALREADY_PENDING",
        (409, _) => "MESH_INBOX_ALREADY_USED",
        (429, _) => "MESH_INBOX_RATE_LIMIT",
        (503, Some("INBOX_NOT_CONFIGURED")) | (404, _) => "MESH_INBOX_NOT_CONFIGURED",
        _ => "MESH_INBOX_UNAVAILABLE",
    }
}

fn identify_pair(
    records: &[DeviceRecord],
    owner: Uuid,
    sender_key: &str,
    recipient: Uuid,
) -> Result<(Uuid, Uuid), &'static str> {
    if records.is_empty() || records.len() > ROSTER_LIMIT {
        return Err("MESH_INBOX_INVALID_ROSTER");
    }
    let mut seen = std::collections::HashSet::new();
    let mut own: Option<Uuid> = None;
    let mut target: Option<Uuid> = None;
    for record in records {
        if record.owner_user_id != owner || !seen.insert(record.device_id) {
            return Err("MESH_INBOX_INVALID_ROSTER");
        }
        if record.signing_public_key == sender_key {
            if own.replace(record.device_id).is_some()
                || record.membership_state != "discovered"
                || record.revoked_at.is_some()
            {
                return Err("MESH_INBOX_SOURCE_INELIGIBLE");
            }
        }
        if record.device_id == recipient {
            if record.membership_state != "discovered" || record.revoked_at.is_some() {
                return Err("MESH_INBOX_TARGET_INELIGIBLE");
            }
            target = Some(record.device_id);
        }
    }
    let source = own.ok_or("MESH_INBOX_SOURCE_NOT_REGISTERED")?;
    let target = target.ok_or("MESH_INBOX_TARGET_NOT_REGISTERED")?;
    if source == target {
        return Err("MESH_INBOX_SELF_INVITE");
    }
    // Reject a duplicated public key even if records have distinct device UUIDs.
    if records
        .iter()
        .filter(|r| r.signing_public_key == sender_key)
        .count()
        != 1
    {
        return Err("MESH_INBOX_INVALID_ROSTER");
    }
    Ok((source, target))
}

fn delivery_message(offer: &MeshOffer, source: Uuid, recipient: Uuid) -> String {
    format!(
        "{PROTOCOL}|{}|{}|{}|{}|{}",
        offer.account_scope, source, recipient, offer.nonce, offer.expires_at
    )
}

fn prepare_signed(
    key: &SigningKey,
    uid: &str,
    source: Uuid,
    recipient: Uuid,
    now: i64,
) -> Result<NativeInboxInvite, &'static str> {
    if source == recipient {
        return Err("MESH_INBOX_SELF_INVITE");
    }
    let signed_offer = generate_offer(key, uid, now);
    let dispatch_signature = URL_SAFE_NO_PAD.encode(
        key.sign(delivery_message(&signed_offer, source, recipient).as_bytes())
            .to_bytes(),
    );
    Ok(NativeInboxInvite {
        protocol: PROTOCOL,
        source_device_id: source,
        target_device_id: recipient,
        signed_offer,
        dispatch_signature,
    })
}

/// Prepare a signed payload for the *future* inbox transport.
/// Never sends it, pairs devices, creates trust, or grants any remote task.
async fn prepare_inbox_message(
    target_device_id: String,
) -> Result<(NativeInboxInvite, String, Zeroizing<String>), String> {
    if !cfg!(feature = "katoos-auth-qa") {
        return Err("MESH_INBOX_NOT_CONFIGURED".into());
    }
    let recipient =
        Uuid::parse_str(&target_device_id).map_err(|_| "MESH_INBOX_INVALID_TARGET".to_string())?;
    let uid = crate::github_app_auth::verified_katosync_user()
        .await
        .map_err(|_| "MESH_INBOX_LOGIN_REQUIRED".to_string())?;
    let owner = Uuid::parse_str(&uid).map_err(|_| "MESH_INBOX_LOGIN_REQUIRED".to_string())?;
    // Read-only local identity: a missing Keychain key must not be silently generated.
    let identity =
        existing_identity(&uid).map_err(|_| "MESH_INBOX_IDENTITY_UNAVAILABLE".to_string())?;
    let sender_key = URL_SAFE_NO_PAD.encode(identity.verifying_key().as_bytes());
    let token = Zeroizing::new(
        crate::ensure_supabase_access_token()
            .await
            .map_err(|_| "MESH_INBOX_LOGIN_REQUIRED".to_string())?,
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| "MESH_INBOX_REGISTRY_UNAVAILABLE".to_string())?;
    let response = client
        .get(format!("{}/rest/v1/mesh_devices", crate::KATOSYNC_AUTH_URL))
        .header("Accept-Profile", "katosync")
        .query(&[
            (
                "select",
                "device_id,owner_user_id,signing_public_key,membership_state,revoked_at",
            ),
            ("owner_user_id", &format!("eq.{owner}")),
            ("limit", "11"),
        ])
        .header("apikey", crate::KATOSYNC_AUTH_ANON_KEY)
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|_| "MESH_INBOX_REGISTRY_UNAVAILABLE".to_string())?;
    if !response.status().is_success() {
        return Err("MESH_INBOX_REGISTRY_UNAVAILABLE".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "MESH_INBOX_REGISTRY_UNAVAILABLE".to_string())?;
    if bytes.len() > ROSTER_MAX_BYTES {
        return Err("MESH_INBOX_INVALID_ROSTER".into());
    }
    let records: Vec<DeviceRecord> =
        serde_json::from_slice(&bytes).map_err(|_| "MESH_INBOX_INVALID_ROSTER".to_string())?;
    let (source, target) =
        identify_pair(&records, owner, &sender_key, recipient).map_err(str::to_string)?;
    // Re-confirm account after network lookup, before writing local one-time offer state.
    same_account_still_verified(&uid)
        .await
        .map_err(|_| "MESH_INBOX_LOGIN_REQUIRED".to_string())?;
    let invite = prepare_signed(&identity, &uid, source, target, Utc::now().timestamp())
        .map_err(str::to_string)?;
    crate::mesh_handshake::store_outbound_offer(&uid, &invite.signed_offer)
        .map_err(|_| "MESH_INBOX_LOCAL_STATE_UNAVAILABLE".to_string())?;
    Ok((invite, uid, token))
}

/// Only creates a public native Ed25519 payload; NEVER sends.
#[tauri::command]
pub async fn mesh_inbox_invite_prepare(
    target_device_id: String,
) -> Result<NativeInboxInvite, String> {
    let (invite, _, _) = prepare_inbox_message(target_device_id).await?;
    Ok(invite)
}

/// Sends a freshly signed, owner-scoped invitation only on explicit user action.
/// This never approves a peer, enables transport, or grants remote job privileges.
#[tauri::command]
pub async fn mesh_inbox_invite_send(
    target_device_id: String,
) -> Result<MeshDeliveryStatus, String> {
    if !cfg!(feature = "katoos-auth-qa") || !send_qa_enabled() {
        return Err("MESH_INBOX_NOT_CONFIGURED".into());
    }
    let (invite, uid, token) = prepare_inbox_message(target_device_id).await?;
    same_account_still_verified(&uid)
        .await
        .map_err(|_| "MESH_INBOX_LOGIN_REQUIRED".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| "MESH_INBOX_UNAVAILABLE".to_string())?;
    let response = client
        .post(format!(
            "{}/functions/v1/mesh-inbox-send",
            crate::KATOSYNC_AUTH_URL
        ))
        .header("apikey", crate::KATOSYNC_AUTH_ANON_KEY)
        .bearer_auth(token.as_str())
        .json(&invite)
        .send()
        .await
        .map_err(|_| "MESH_INBOX_UNAVAILABLE".to_string())?;
    let status = response.status();
    // Strong bounded receipt: never trust a backend response only for status 202.
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "MESH_INBOX_UNAVAILABLE".to_string())?;
    if bytes.len() > RESPONSE_MAX_BYTES {
        return Err("MESH_INBOX_INVALID_RECEIPT".into());
    }
    if status != reqwest::StatusCode::ACCEPTED {
        return Err(classify_send_failure(status, &bytes).into());
    }
    let receipt: DeliveryReceipt =
        serde_json::from_slice(&bytes).map_err(|_| "MESH_INBOX_INVALID_RECEIPT".to_string())?;
    let output = verify_receipt(receipt, &invite.signed_offer, Utc::now().timestamp())
        .map_err(str::to_string)?;
    // Cross-account navigation or logout must not turn a stale backend receipt
    // into a user-facing success state.
    same_account_still_verified(&uid)
        .await
        .map_err(|_| "MESH_INBOX_LOGIN_REQUIRED".to_string())?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier};

    fn device(id: u8, owner: Uuid, key: &str) -> DeviceRecord {
        DeviceRecord {
            device_id: Uuid::from_bytes([id; 16]),
            owner_user_id: owner,
            signing_public_key: key.to_string(),
            membership_state: "discovered".into(),
            revoked_at: None,
        }
    }

    #[test]
    fn verified_sender_and_target_are_distinct_and_owner_scoped() {
        let owner = Uuid::from_bytes([1; 16]);
        let a = device(2, owner, "A");
        let b = device(3, owner, "B");
        assert_eq!(
            identify_pair(&[a.clone(), b.clone()], owner, "A", b.device_id),
            Ok((a.device_id, b.device_id))
        );
        assert_eq!(
            identify_pair(&[a.clone(), b.clone()], owner, "A", a.device_id),
            Err("MESH_INBOX_SELF_INVITE")
        );
        assert_eq!(
            identify_pair(&[a.clone()], owner, "A", b.device_id),
            Err("MESH_INBOX_TARGET_NOT_REGISTERED")
        );
        assert_eq!(
            identify_pair(&[a.clone(), b.clone()], owner, "X", b.device_id),
            Err("MESH_INBOX_SOURCE_NOT_REGISTERED")
        );
        assert_eq!(
            identify_pair(&[a.clone(), a], owner, "A", b.device_id),
            Err("MESH_INBOX_INVALID_ROSTER")
        );
    }

    #[test]
    fn revoked_or_foreign_device_cannot_be_selected() {
        let owner = Uuid::from_bytes([1; 16]);
        let a = device(2, owner, "A");
        let mut b = device(3, owner, "B");
        b.owner_user_id = Uuid::from_bytes([9; 16]);
        assert_eq!(
            identify_pair(&[a.clone(), b.clone()], owner, "A", b.device_id),
            Err("MESH_INBOX_INVALID_ROSTER")
        );
        b.owner_user_id = owner;
        b.membership_state = "revoked".into();
        b.revoked_at = Some("2026-10-29T12:00:00Z".into());
        assert_eq!(
            identify_pair(&[a.clone(), b.clone()], owner, "A", b.device_id),
            Err("MESH_INBOX_TARGET_INELIGIBLE")
        );
        b.membership_state = "discovered".into();
        b.revoked_at = None;
        let mut revoked_source = a;
        revoked_source.membership_state = "revoked".into();
        revoked_source.revoked_at = Some("2026-10-29T12:00:00Z".into());
        assert_eq!(
            identify_pair(&[revoked_source, b.clone()], owner, "A", b.device_id),
            Err("MESH_INBOX_SOURCE_INELIGIBLE")
        );
    }

    #[test]
    fn receipt_cannot_claim_trust_or_wrong_expiry() {
        let signing = SigningKey::from_bytes(&[7; 32]);
        let uid = "11111111-1111-4111-8111-111111111111";
        let invite =
            prepare_signed(&signing, uid, Uuid::new_v4(), Uuid::new_v4(), 1_800_000_000).unwrap();
        let status = DeliveryReceipt {
            request_id: Uuid::new_v4(),
            expires_at: chrono::DateTime::from_timestamp(invite.signed_offer.expires_at, 0)
                .unwrap()
                .to_rfc3339(),
            delivery_only: true,
            paired: false,
            transport_ready: false,
            remote_jobs_enabled: false,
        };
        assert!(verify_receipt(
            DeliveryReceipt { ..status },
            &invite.signed_offer,
            1_800_000_001
        )
        .is_ok());
        let bad = DeliveryReceipt {
            request_id: Uuid::new_v4(),
            expires_at: chrono::DateTime::from_timestamp(invite.signed_offer.expires_at, 0)
                .unwrap()
                .to_rfc3339(),
            delivery_only: true,
            paired: false,
            transport_ready: true,
            remote_jobs_enabled: false,
        };
        assert!(verify_receipt(bad, &invite.signed_offer, 1_800_000_001).is_err());
    }

    #[test]
    fn backend_errors_are_stable_and_never_echo_untrusted_text() {
        assert_eq!(
            classify_send_failure(reqwest::StatusCode::TOO_MANY_REQUESTS, b"broken"),
            "MESH_INBOX_RATE_LIMIT"
        );
        assert_eq!(
            classify_send_failure(
                reqwest::StatusCode::FORBIDDEN,
                br#"{"error":"DEVICE_NOT_ELIGIBLE"}"#
            ),
            "MESH_INBOX_DEVICE_NOT_ELIGIBLE"
        );
        assert_eq!(
            classify_send_failure(
                reqwest::StatusCode::SERVICE_UNAVAILABLE,
                br#"{"error":"server secret token=do-not-leak"}"#
            ),
            "MESH_INBOX_UNAVAILABLE"
        );
    }

    #[test]
    fn signed_payload_proves_specific_recipient_but_not_trust() {
        const UID: &str = "11111111-1111-4111-8111-111111111111";
        let signing = SigningKey::from_bytes(&[7; 32]);
        let a = Uuid::from_bytes([2; 16]);
        let b = Uuid::from_bytes([3; 16]);
        let c = Uuid::from_bytes([4; 16]);
        let invite = prepare_signed(&signing, UID, a, b, 1_800_000_000).unwrap();
        assert_eq!(invite.protocol, PROTOCOL);
        assert_eq!(invite.source_device_id, a);
        assert_eq!(invite.target_device_id, b);
        assert!(
            crate::mesh_identity::verify_offer(&invite.signed_offer, UID, 1_800_000_001).is_ok()
        );
        let decoded = URL_SAFE_NO_PAD.decode(&invite.dispatch_signature).unwrap();
        let signature = Signature::from_slice(&decoded).unwrap();
        assert!(signing
            .verifying_key()
            .verify(
                delivery_message(&invite.signed_offer, a, b).as_bytes(),
                &signature
            )
            .is_ok());
        assert!(signing
            .verifying_key()
            .verify(
                delivery_message(&invite.signed_offer, a, c).as_bytes(),
                &signature
            )
            .is_err());
        assert!(signing
            .verifying_key()
            .verify(
                delivery_message(&invite.signed_offer, b, a).as_bytes(),
                &signature
            )
            .is_err());
        let public_json = serde_json::to_string(&invite).unwrap();
        assert!(!public_json.contains("private_key"));
        assert!(!public_json.contains("access_token"));
        assert_eq!(
            prepare_signed(&signing, UID, a, a, 1_800_000_000).err(),
            Some("MESH_INBOX_SELF_INVITE")
        );
    }
}
