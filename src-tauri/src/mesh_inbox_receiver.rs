// Created by NMKato Solutions
//! Stage 2O: device-attested, single-use receiver operations. NO peer trust.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Utc};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use crate::mesh_identity::{
    existing_identity, same_account_still_verified, verify_offer, MeshOffer,
};

const PROTOCOL: &str = "katosync-mesh-inbox-recipient-v1";
const LIST_SENTINEL: &str = "00000000-0000-4000-8000-000000000000";
const MAX_RESPONSE: usize = 32_768;
const MAX_INBOX: usize = 10;
const MAX_REQUEST: usize = 1100;

fn receiver_qa_enabled() -> bool {
    option_env!("KATOSYNC_MESH_INBOX_RECEIVE_QA") == Some("1")
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LocalDeviceRecord {
    device_id: Uuid,
    owner_user_id: Uuid,
    signing_public_key: String,
    membership_state: String,
    revoked_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecipientProof<'a> {
    protocol: &'static str,
    device_id: Uuid,
    action: &'a str,
    request_id: Uuid,
    nonce: String,
    expires_at: i64,
    signature: String,
}

fn proof_payload(uid: &str, proof: &RecipientProof<'_>) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}",
        PROTOCOL,
        uid,
        proof.device_id,
        proof.action,
        proof.request_id,
        proof.nonce,
        proof.expires_at
    )
}

fn sign_proof(
    signing: &SigningKey,
    owner: &str,
    device: Uuid,
    action: &str,
    request: Uuid,
    now: i64,
) -> Result<RecipientProof<'static>, &'static str> {
    if !matches!(action, "list" | "accept" | "reject")
        || (action == "list") != (request.to_string() == LIST_SENTINEL)
    {
        return Err("MESH_INBOX_INVALID_ACTION");
    }
    let mut nonce = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let mut proof = RecipientProof {
        protocol: PROTOCOL,
        device_id: device,
        action: match action {
            "list" => "list",
            "accept" => "accept",
            _ => "reject",
        },
        request_id: request,
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        expires_at: now + 65,
        signature: String::new(),
    };
    nonce.zeroize();
    proof.signature = URL_SAFE_NO_PAD.encode(
        signing
            .sign(proof_payload(owner, &proof).as_bytes())
            .to_bytes(),
    );
    Ok(proof)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InboundInvite {
    request_id: Uuid,
    source_device_id: Uuid,
    target_device_id: Uuid,
    expires_at: String,
    signed_offer: MeshOffer,
    dispatch_signature: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InboxWire {
    invitations: Vec<InboundInvite>,
    discovery_only: bool,
    paired: bool,
    transport_ready: bool,
    remote_jobs_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    request_id: Uuid,
    source_device_id: Uuid,
    expires_at: String,
    fingerprint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxView {
    invitations: Vec<InboxItem>,
    paired: bool,
    transport_ready: bool,
    remote_jobs_enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DecisionWire {
    request_id: Uuid,
    state: String,
    decision_only: bool,
    paired: bool,
    transport_ready: bool,
    remote_jobs_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionView {
    request_id: Uuid,
    state: String,
    decision_only: bool,
    paired: bool,
    transport_ready: bool,
    remote_jobs_enabled: bool,
}

fn validate_inbox(
    wire: InboxWire,
    uid: &str,
    own_device: Uuid,
    now: i64,
) -> Result<InboxView, &'static str> {
    if !wire.discovery_only
        || wire.paired
        || wire.transport_ready
        || wire.remote_jobs_enabled
        || wire.invitations.len() > MAX_INBOX
    {
        return Err("MESH_INBOX_INVALID_RECEIPT");
    }
    let mut ids = std::collections::HashSet::new();
    let mut safe = Vec::with_capacity(wire.invitations.len());
    for entry in wire.invitations {
        if !ids.insert(entry.request_id)
            || entry.source_device_id == own_device
            || entry.target_device_id != own_device
        {
            return Err("MESH_INBOX_INVALID_RECEIPT");
        }
        let expires = DateTime::parse_from_rfc3339(&entry.expires_at)
            .map_err(|_| "MESH_INBOX_INVALID_RECEIPT")?;
        if expires.timestamp() != entry.signed_offer.expires_at
            || expires.timestamp() <= now
            || expires.timestamp() > now + 310
        {
            return Err("MESH_INBOX_INVALID_RECEIPT");
        }
        let key = verify_offer(&entry.signed_offer, uid, now)
            .map_err(|_| "MESH_INBOX_INVALID_SIGNATURE")?;
        let raw = URL_SAFE_NO_PAD
            .decode(&entry.dispatch_signature)
            .map_err(|_| "MESH_INBOX_INVALID_SIGNATURE")?;
        let sig = Signature::from_slice(&raw).map_err(|_| "MESH_INBOX_INVALID_SIGNATURE")?;
        let message = format!(
            "katosync-mesh-inbox-send-v1|{}|{}|{}|{}|{}",
            entry.signed_offer.account_scope,
            entry.source_device_id,
            entry.target_device_id,
            entry.signed_offer.nonce,
            entry.signed_offer.expires_at
        );
        key.verify(message.as_bytes(), &sig)
            .map_err(|_| "MESH_INBOX_INVALID_SIGNATURE")?;
        safe.push(InboxItem {
            request_id: entry.request_id,
            source_device_id: entry.source_device_id,
            expires_at: entry.expires_at,
            fingerprint: crate::mesh_identity::fingerprint(&key),
        });
    }
    Ok(InboxView {
        invitations: safe,
        paired: false,
        transport_ready: false,
        remote_jobs_enabled: false,
    })
}

fn validate_decision(
    wire: DecisionWire,
    request: Uuid,
    action: &str,
) -> Result<DecisionView, &'static str> {
    let expected = match action {
        "accept" => "accepted",
        "reject" => "rejected",
        _ => return Err("MESH_INBOX_INVALID_ACTION"),
    };
    if wire.request_id != request
        || wire.state != expected
        || !wire.decision_only
        || wire.paired
        || wire.transport_ready
        || wire.remote_jobs_enabled
    {
        return Err("MESH_INBOX_INVALID_RECEIPT");
    }
    Ok(DecisionView {
        request_id: wire.request_id,
        state: wire.state,
        decision_only: true,
        paired: false,
        transport_ready: false,
        remote_jobs_enabled: false,
    })
}

async fn receiver_proof_and_token(
    action: &str,
    request: Uuid,
) -> Result<(RecipientProof<'static>, String, Zeroizing<String>), String> {
    if !cfg!(feature = "katoos-auth-qa") || !receiver_qa_enabled() {
        return Err("MESH_INBOX_RECEIVE_NOT_CONFIGURED".into());
    }
    let uid = crate::github_app_auth::verified_katosync_user()
        .await
        .map_err(|_| "MESH_INBOX_LOGIN_REQUIRED".to_string())?;
    let owner = Uuid::parse_str(&uid).map_err(|_| "MESH_INBOX_LOGIN_REQUIRED".to_string())?;
    let signing =
        existing_identity(&uid).map_err(|_| "MESH_INBOX_IDENTITY_UNAVAILABLE".to_string())?;
    let public = URL_SAFE_NO_PAD.encode(signing.verifying_key().as_bytes());
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
            ("signing_public_key", &format!("eq.{public}")),
            ("limit", "2"),
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
    if bytes.len() > MAX_RESPONSE {
        return Err("MESH_INBOX_REGISTRY_UNAVAILABLE".into());
    }
    let entries: Vec<LocalDeviceRecord> =
        serde_json::from_slice(&bytes).map_err(|_| "MESH_INBOX_INVALID_ROSTER".to_string())?;
    if entries.len() != 1
        || entries[0].owner_user_id != owner
        || entries[0].signing_public_key != public
        || entries[0].membership_state != "discovered"
        || entries[0].revoked_at.is_some()
    {
        return Err("MESH_INBOX_DEVICE_NOT_ELIGIBLE".into());
    }
    same_account_still_verified(&uid)
        .await
        .map_err(|_| "MESH_INBOX_LOGIN_REQUIRED".to_string())?;
    let proof = sign_proof(
        &signing,
        &uid,
        entries[0].device_id,
        action,
        request,
        Utc::now().timestamp(),
    )
    .map_err(str::to_string)?;
    Ok((proof, uid, token))
}

async fn post_inbox(proof: &RecipientProof<'_>, token: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| "MESH_INBOX_UNAVAILABLE".to_string())?;
    let data = serde_json::to_vec(proof).map_err(|_| "MESH_INBOX_INVALID_PROOF".to_string())?;
    if data.len() > MAX_REQUEST {
        return Err("MESH_INBOX_INVALID_PROOF".into());
    }
    let response = client
        .post(format!(
            "{}/functions/v1/mesh-inbox-receive",
            crate::KATOSYNC_AUTH_URL
        ))
        .header("apikey", crate::KATOSYNC_AUTH_ANON_KEY)
        .bearer_auth(token)
        .header("Content-Type", "application/json")
        .body(data)
        .send()
        .await
        .map_err(|_| "MESH_INBOX_UNAVAILABLE".to_string())?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(match response.status().as_u16() {
            401 => "MESH_INBOX_LOGIN_REQUIRED",
            403 => "MESH_INBOX_DEVICE_NOT_ELIGIBLE",
            409 => "MESH_INBOX_STALE_OR_USED",
            429 => "MESH_INBOX_RATE_LIMIT",
            503 | 404 => "MESH_INBOX_UNAVAILABLE",
            _ => "MESH_INBOX_UNAVAILABLE",
        }
        .into());
    }
    let body = response
        .bytes()
        .await
        .map_err(|_| "MESH_INBOX_UNAVAILABLE".to_string())?;
    if body.len() > MAX_RESPONSE {
        return Err("MESH_INBOX_INVALID_RECEIPT".into());
    }
    Ok(body.to_vec())
}

/// User-triggered receiver inbox scan, never auto-pair or auto-accept.
#[tauri::command]
pub async fn mesh_inbox_recipient_list() -> Result<InboxView, String> {
    let request =
        Uuid::parse_str(LIST_SENTINEL).map_err(|_| "MESH_INBOX_INVALID_ACTION".to_string())?;
    let (proof, uid, token) = receiver_proof_and_token("list", request).await?;
    let raw = post_inbox(&proof, token.as_str()).await?;
    let parsed: InboxWire =
        serde_json::from_slice(&raw).map_err(|_| "MESH_INBOX_INVALID_RECEIPT".to_string())?;
    let safe = validate_inbox(parsed, &uid, proof.device_id, Utc::now().timestamp())
        .map_err(str::to_string)?;
    same_account_still_verified(&uid)
        .await
        .map_err(|_| "MESH_INBOX_LOGIN_REQUIRED".to_string())?;
    Ok(safe)
}

/// A user's conscious recipient decision; still no trust, SAS or transport.
#[tauri::command]
pub async fn mesh_inbox_recipient_decide(
    request_id: String,
    action: String,
) -> Result<DecisionView, String> {
    if !matches!(action.as_str(), "accept" | "reject") {
        return Err("MESH_INBOX_INVALID_ACTION".into());
    }
    let id = Uuid::parse_str(&request_id).map_err(|_| "MESH_INBOX_INVALID_REQUEST".to_string())?;
    let (proof, uid, token) = receiver_proof_and_token(&action, id).await?;
    let raw = post_inbox(&proof, token.as_str()).await?;
    let parsed: DecisionWire =
        serde_json::from_slice(&raw).map_err(|_| "MESH_INBOX_INVALID_RECEIPT".to_string())?;
    let safe = validate_decision(parsed, id, &action).map_err(str::to_string)?;
    same_account_still_verified(&uid)
        .await
        .map_err(|_| "MESH_INBOX_LOGIN_REQUIRED".to_string())?;
    Ok(safe)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn signing() -> SigningKey {
        SigningKey::from_bytes(&[5u8; 32])
    }
    const OWNER: &str = "11111111-1111-4111-8111-111111111111";
    #[test]
    fn device_proof_is_bound_to_the_owner_target_action_and_nonce() {
        let device = Uuid::new_v4();
        let request = Uuid::new_v4();
        let p = sign_proof(&signing(), OWNER, device, "accept", request, 1_800_000_000).unwrap();
        let bytes = URL_SAFE_NO_PAD.decode(p.signature.as_str()).unwrap();
        let signature = Signature::from_slice(&bytes).unwrap();
        assert!(signing()
            .verifying_key()
            .verify(proof_payload(OWNER, &p).as_bytes(), &signature)
            .is_ok());
        let altered = proof_payload("99999999-9999-4999-8999-999999999999", &p);
        assert!(signing()
            .verifying_key()
            .verify(altered.as_bytes(), &signature)
            .is_err());
        let wrong_action = sign_proof(&signing(), OWNER, device, "list", request, 1_800_000_000);
        assert!(wrong_action.is_err());
    }
    #[test]
    fn decision_result_must_never_claim_peer_trust() {
        let request = Uuid::new_v4();
        let wire = DecisionWire {
            request_id: request,
            state: "accepted".into(),
            decision_only: true,
            paired: false,
            transport_ready: false,
            remote_jobs_enabled: false,
        };
        assert!(validate_decision(wire, request, "accept").is_ok());
        let wrong = DecisionWire {
            request_id: request,
            state: "accepted".into(),
            decision_only: true,
            paired: true,
            transport_ready: false,
            remote_jobs_enabled: false,
        };
        assert!(validate_decision(wrong, request, "accept").is_err());
    }
}
