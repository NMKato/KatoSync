// Created by NMKato Solutions
//! Stage 2M: native, recipient-bound invite signing. No network write, no peer trust.
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
#[tauri::command]
pub async fn mesh_inbox_invite_prepare(
    target_device_id: String,
) -> Result<NativeInboxInvite, String> {
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
    Ok(invite)
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
