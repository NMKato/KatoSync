// NMKato Solutions – Stage 3I. Explicit, QA-gated native relay IPC.
// Signed public pairing material ONLY; no peer pinning or remote execution.
// Never mint a local identity: only existing OS Keychain identity may sign.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, time::Duration};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use crate::mesh_identity::{existing_identity, same_account_still_verified};

const PROTOCOL: &str = "katosync-mesh-pairing-relay-v1";
const LIST_PROTOCOL: &str = "katosync-mesh-pairing-relay-list-v1";
const MAX_PUBLIC_JSON: usize = 8192;
const MAX_HTTP_BODY: usize = 65_536;

fn qa_enabled() -> bool {
    cfg!(feature = "katoos-auth-qa") && option_env!("KATOSYNC_MESH_PAIRING_RELAY_QA") == Some("1")
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    device_id: Uuid,
    owner_user_id: Uuid,
    signing_public_key: String,
    membership_state: String,
    revoked_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    protocol: String,
    request_id: Uuid,
    sender_device_id: Uuid,
    recipient_device_id: Uuid,
    kind: String,
    payload_b64: String,
    nonce: String,
    expires_at: i64,
    signature: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListProof {
    protocol: &'static str,
    device_id: Uuid,
    nonce: String,
    expires_at: i64,
    signature: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireReceipt {
    message_id: Uuid,
    delivery_only: bool,
    paired: bool,
    transport_ready: bool,
    remote_jobs_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayDelivery {
    message_id: Uuid,
    delivery_only: bool,
    paired: bool,
    transport_ready: bool,
    remote_jobs_enabled: bool,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListWire {
    messages: Vec<Envelope>,
    delivery_only: bool,
    paired: bool,
    transport_ready: bool,
    remote_jobs_enabled: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayReadMessage {
    request_id: Uuid,
    sender_device_id: Uuid,
    recipient_device_id: Uuid,
    kind: String,
    payload_json: String,
    expires_at: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayRead {
    messages: Vec<RelayReadMessage>,
    delivery_only: bool,
    paired: bool,
    transport_ready: bool,
    remote_jobs_enabled: bool,
}
fn nonce() -> String {
    let mut raw = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut raw);
    let encoded = URL_SAFE_NO_PAD.encode(raw);
    raw.zeroize();
    encoded
}
fn message(owner: &str, p: &Envelope) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|{}",
        p.protocol,
        owner,
        p.request_id,
        p.sender_device_id,
        p.recipient_device_id,
        p.kind,
        p.payload_b64,
        p.nonce,
        p.expires_at
    )
}
fn make_envelope(
    signing: &SigningKey,
    owner: &str,
    request: Uuid,
    own: Uuid,
    other: Uuid,
    kind: &str,
    public_json: &str,
    expires: i64,
) -> Result<Envelope, &'static str> {
    if !matches!(kind, "challenge" | "response")
        || own == other
        || public_json.len() > MAX_PUBLIC_JSON
        || expires <= Utc::now().timestamp()
    {
        return Err("MESH_RELAY_INVALID_MESSAGE");
    }
    let mut result = Envelope {
        protocol: PROTOCOL.to_string(),
        request_id: request,
        sender_device_id: own,
        recipient_device_id: other,
        kind: kind.to_string(),
        payload_b64: URL_SAFE_NO_PAD.encode(public_json.as_bytes()),
        nonce: nonce(),
        expires_at: expires,
        signature: String::new(),
    };
    result.signature =
        URL_SAFE_NO_PAD.encode(signing.sign(message(owner, &result).as_bytes()).to_bytes());
    Ok(result)
}
fn signed_list(signing: &SigningKey, uid: &str, own: Uuid, now: i64) -> ListProof {
    let mut p = ListProof {
        protocol: LIST_PROTOCOL,
        device_id: own,
        nonce: nonce(),
        expires_at: now + 65,
        signature: String::new(),
    };
    let payload = format!(
        "{}|{}|{}|{}|{}",
        p.protocol, uid, p.device_id, p.nonce, p.expires_at
    );
    p.signature = URL_SAFE_NO_PAD.encode(signing.sign(payload.as_bytes()).to_bytes());
    p
}
fn signed_envelope_valid(env: &Envelope, owner: &str, key: &VerifyingKey, now: i64) -> bool {
    if env.protocol != PROTOCOL
        || !matches!(env.kind.as_str(), "challenge" | "response")
        || env.sender_device_id == env.recipient_device_id
        || env.expires_at <= now
        || env.expires_at > now + 310
        || env.payload_b64.len() > 11_000
    {
        return false;
    }
    let payload = match URL_SAFE_NO_PAD.decode(&env.payload_b64) {
        Ok(x) => x,
        Err(_) => return false,
    };
    if payload.len() > MAX_PUBLIC_JSON
        || serde_json::from_slice::<serde_json::Value>(&payload).is_err()
    {
        return false;
    }
    let sig = match URL_SAFE_NO_PAD
        .decode(&env.signature)
        .ok()
        .and_then(|v| Signature::from_slice(&v).ok())
    {
        Some(x) => x,
        None => return false,
    };
    key.verify(message(owner, env).as_bytes(), &sig).is_ok()
}
fn verified_public_payload(
    uid: &str,
    kind: &str,
    data: &str,
    now: i64,
) -> Result<(String, String, i64), String> {
    crate::mesh_handshake::relay_public_peer_keys(uid, kind, data, now)
}
fn validate_received(
    wire: ListWire,
    owner: &str,
    own: Uuid,
    signing: &SigningKey,
    roster: &HashMap<Uuid, VerifyingKey>,
    now: i64,
) -> Result<RelayRead, &'static str> {
    if !wire.delivery_only
        || wire.paired
        || wire.transport_ready
        || wire.remote_jobs_enabled
        || wire.messages.len() > 10
    {
        return Err("MESH_RELAY_INVALID_RECEIPT");
    }
    let mut result = Vec::with_capacity(wire.messages.len());
    let mut seen = std::collections::HashSet::new();
    for env in wire.messages {
        if env.recipient_device_id != own || !seen.insert((env.request_id, env.kind.clone())) {
            return Err("MESH_RELAY_INVALID_RECEIPT");
        }
        let sender = roster
            .get(&env.sender_device_id)
            .ok_or("MESH_RELAY_INVALID_SENDER")?;
        if !signed_envelope_valid(&env, owner, sender, now) {
            return Err("MESH_RELAY_INVALID_SIGNATURE");
        }
        let bytes = URL_SAFE_NO_PAD
            .decode(&env.payload_b64)
            .map_err(|_| "MESH_RELAY_INVALID_MESSAGE")?;
        let json = String::from_utf8(bytes).map_err(|_| "MESH_RELAY_INVALID_MESSAGE")?;
        let (initiator, responder, expires) = verified_public_payload(owner, &env.kind, &json, now)
            .map_err(|_| "MESH_RELAY_INVALID_SIGNATURE")?;
        let own_key = URL_SAFE_NO_PAD.encode(signing.verifying_key().as_bytes());
        let sender_key = URL_SAFE_NO_PAD.encode(sender.as_bytes());
        let sender_matches = if env.kind == "challenge" {
            responder == sender_key && initiator == own_key
        } else {
            initiator == sender_key && responder == own_key
        };
        if !sender_matches || env.expires_at > expires {
            return Err("MESH_RELAY_INVALID_SIGNATURE");
        }
        result.push(RelayReadMessage {
            request_id: env.request_id,
            sender_device_id: env.sender_device_id,
            recipient_device_id: env.recipient_device_id,
            kind: env.kind,
            payload_json: json,
            expires_at: env.expires_at,
        });
    }
    Ok(RelayRead {
        messages: result,
        delivery_only: true,
        paired: false,
        transport_ready: false,
        remote_jobs_enabled: false,
    })
}
struct Context {
    owner: String,
    token: Zeroizing<String>,
    signing: SigningKey,
    own: Uuid,
    roster: HashMap<Uuid, VerifyingKey>,
}
async fn context() -> Result<Context, String> {
    if !qa_enabled() {
        return Err("MESH_RELAY_NOT_CONFIGURED".into());
    }
    let owner = crate::github_app_auth::verified_katosync_user()
        .await
        .map_err(|_| "MESH_RELAY_LOGIN_REQUIRED")?;
    let uid = Uuid::parse_str(&owner).map_err(|_| "MESH_RELAY_LOGIN_REQUIRED")?;
    // Never silently generate a key; identity creation remains its own user action.
    let signing = existing_identity(&owner).map_err(|_| "MESH_RELAY_IDENTITY_UNAVAILABLE")?;
    let local = URL_SAFE_NO_PAD.encode(signing.verifying_key().as_bytes());
    let token = Zeroizing::new(
        crate::ensure_supabase_access_token()
            .await
            .map_err(|_| "MESH_RELAY_LOGIN_REQUIRED")?,
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| "MESH_RELAY_REGISTRY_UNAVAILABLE")?;
    let resp = client
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
        .map_err(|_| "MESH_RELAY_REGISTRY_UNAVAILABLE")?;
    if !resp.status().is_success() {
        return Err("MESH_RELAY_REGISTRY_UNAVAILABLE".into());
    }
    let buf = resp
        .bytes()
        .await
        .map_err(|_| "MESH_RELAY_REGISTRY_UNAVAILABLE")?;
    if buf.len() > 24_576 {
        return Err("MESH_RELAY_INVALID_ROSTER".into());
    }
    let records: Vec<Record> =
        serde_json::from_slice(&buf).map_err(|_| "MESH_RELAY_INVALID_ROSTER")?;
    if records.is_empty() || records.len() > 10 {
        return Err("MESH_RELAY_INVALID_ROSTER".into());
    }
    let mut roster = HashMap::new();
    let mut own = None;
    for r in records {
        if r.owner_user_id != uid || r.membership_state != "discovered" || r.revoked_at.is_some() {
            return Err("MESH_RELAY_INELIGIBLE_DEVICE".into());
        }
        let decoded = URL_SAFE_NO_PAD
            .decode(&r.signing_public_key)
            .map_err(|_| "MESH_RELAY_INVALID_ROSTER")?;
        let raw: [u8; 32] = decoded
            .try_into()
            .map_err(|_| "MESH_RELAY_INVALID_ROSTER")?;
        let key = VerifyingKey::from_bytes(&raw).map_err(|_| "MESH_RELAY_INVALID_ROSTER")?;
        if r.signing_public_key == local {
            own = Some(r.device_id);
        }
        if roster.insert(r.device_id, key).is_some() {
            return Err("MESH_RELAY_INVALID_ROSTER".into());
        }
    }
    if roster
        .values()
        .filter(|k| **k == signing.verifying_key())
        .count()
        != 1
    {
        return Err("MESH_RELAY_INVALID_ROSTER".into());
    }
    let own = own.ok_or("MESH_RELAY_DEVICE_NOT_REGISTERED")?;
    same_account_still_verified(&owner)
        .await
        .map_err(|_| "MESH_RELAY_LOGIN_REQUIRED")?;
    Ok(Context {
        owner,
        token,
        signing,
        own,
        roster,
    })
}
async fn invoke_endpoint(
    body: serde_json::Value,
    token: &str,
    expected: reqwest::StatusCode,
) -> Result<Vec<u8>, String> {
    let raw = serde_json::to_vec(&body).map_err(|_| "MESH_RELAY_INVALID_REQUEST")?;
    if raw.len() > 14_000 {
        return Err("MESH_RELAY_INVALID_REQUEST".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| "MESH_RELAY_UNAVAILABLE")?;
    let response = client
        .post(format!(
            "{}/functions/v1/mesh-pairing-relay",
            crate::KATOSYNC_AUTH_URL
        ))
        .header("apikey", crate::KATOSYNC_AUTH_ANON_KEY)
        .bearer_auth(token)
        .header("Content-Type", "application/json")
        .body(raw)
        .send()
        .await
        .map_err(|_| "MESH_RELAY_UNAVAILABLE")?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "MESH_RELAY_UNAVAILABLE")?;
    if bytes.len() > MAX_HTTP_BODY {
        return Err("MESH_RELAY_INVALID_RECEIPT".into());
    }
    if status != expected {
        return Err(match status.as_u16() {
            401 => "MESH_RELAY_LOGIN_REQUIRED",
            403 => "MESH_RELAY_DENIED",
            409 => "MESH_RELAY_STALE_OR_DUPLICATE",
            429 => "MESH_RELAY_RATE_LIMIT",
            404 | 503 => "MESH_RELAY_NOT_CONFIGURED",
            _ => "MESH_RELAY_UNAVAILABLE",
        }
        .into());
    }
    Ok(bytes.to_vec())
}
/// Only an explicit QA action sends PUBLIC material, never grants peer trust.
#[tauri::command]
pub async fn mesh_pairing_relay_send(
    request_id: String,
    recipient_device_id: String,
    kind: String,
    payload_json: String,
) -> Result<RelayDelivery, String> {
    let request = Uuid::parse_str(&request_id).map_err(|_| "MESH_RELAY_INVALID_REQUEST")?;
    let recipient =
        Uuid::parse_str(&recipient_device_id).map_err(|_| "MESH_RELAY_INVALID_TARGET")?;
    let cx = context().await?;
    if recipient == cx.own || !cx.roster.contains_key(&recipient) {
        return Err("MESH_RELAY_INVALID_TARGET".into());
    }
    let now = Utc::now().timestamp();
    let (initiator, responder, expires) =
        verified_public_payload(&cx.owner, &kind, &payload_json, now)
            .map_err(|_| "MESH_RELAY_INVALID_MESSAGE")?;
    let own_key = URL_SAFE_NO_PAD.encode(cx.signing.verifying_key().as_bytes());
    let target_key = URL_SAFE_NO_PAD.encode(cx.roster[&recipient].as_bytes());
    let proper = if kind == "challenge" {
        own_key == responder && target_key == initiator
    } else if kind == "response" {
        own_key == initiator && target_key == responder
    } else {
        false
    };
    if !proper {
        return Err("MESH_RELAY_DIRECTION_MISMATCH".into());
    }
    let envelope = make_envelope(
        &cx.signing,
        &cx.owner,
        request,
        cx.own,
        recipient,
        &kind,
        &payload_json,
        expires.min(now + 250),
    )
    .map_err(str::to_string)?;
    same_account_still_verified(&cx.owner)
        .await
        .map_err(|_| "MESH_RELAY_LOGIN_REQUIRED")?;
    let raw = invoke_endpoint(
        serde_json::json!({"action":"send","payload":envelope}),
        cx.token.as_str(),
        reqwest::StatusCode::ACCEPTED,
    )
    .await?;
    let receipt: WireReceipt =
        serde_json::from_slice(&raw).map_err(|_| "MESH_RELAY_INVALID_RECEIPT")?;
    if !receipt.delivery_only
        || receipt.paired
        || receipt.transport_ready
        || receipt.remote_jobs_enabled
    {
        return Err("MESH_RELAY_INVALID_RECEIPT".into());
    }
    same_account_still_verified(&cx.owner)
        .await
        .map_err(|_| "MESH_RELAY_LOGIN_REQUIRED")?;
    Ok(RelayDelivery {
        message_id: receipt.message_id,
        delivery_only: true,
        paired: false,
        transport_ready: false,
        remote_jobs_enabled: false,
    })
}
/// Recipient deliberately fetches signed public messages; never polls itself.
#[tauri::command]
pub async fn mesh_pairing_relay_list() -> Result<RelayRead, String> {
    let cx = context().await?;
    let proof = signed_list(&cx.signing, &cx.owner, cx.own, Utc::now().timestamp());
    let raw = invoke_endpoint(
        serde_json::json!({"action":"list","payload":proof}),
        cx.token.as_str(),
        reqwest::StatusCode::OK,
    )
    .await?;
    let wire: ListWire = serde_json::from_slice(&raw).map_err(|_| "MESH_RELAY_INVALID_RECEIPT")?;
    let validated = validate_received(
        wire,
        &cx.owner,
        cx.own,
        &cx.signing,
        &cx.roster,
        Utc::now().timestamp(),
    )
    .map_err(str::to_string)?;
    same_account_still_verified(&cx.owner)
        .await
        .map_err(|_| "MESH_RELAY_LOGIN_REQUIRED")?;
    Ok(validated)
}
#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    fn signing() -> SigningKey {
        SigningKey::from_bytes(&[14u8; 32])
    }
    const OWNER: &str = "11111111-1111-4111-8111-111111111111";
    #[test]
    fn outer_signatures_are_bound_to_owner_direction_message_and_expiry() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let req = Uuid::new_v4();
        let now = Utc::now().timestamp();
        let env = make_envelope(
            &signing(),
            OWNER,
            req,
            a,
            b,
            "challenge",
            r#"{"hello":1}"#,
            now + 60,
        )
        .unwrap();
        assert!(signed_envelope_valid(
            &env,
            OWNER,
            &signing().verifying_key(),
            now
        ));
        let mut bad = env.clone();
        bad.kind = "response".into();
        assert!(!signed_envelope_valid(
            &bad,
            OWNER,
            &signing().verifying_key(),
            now
        ));
        let mut bad = env.clone();
        bad.recipient_device_id = Uuid::new_v4();
        assert!(!signed_envelope_valid(
            &bad,
            OWNER,
            &signing().verifying_key(),
            now
        ));
        let mut bad = env.clone();
        bad.payload_b64 = URL_SAFE_NO_PAD.encode(b"forged");
        assert!(!signed_envelope_valid(
            &bad,
            OWNER,
            &signing().verifying_key(),
            now
        ));
        assert!(!signed_envelope_valid(
            &env,
            "99999999-9999-4999-8999-999999999999",
            &signing().verifying_key(),
            now
        ));
        assert!(!signed_envelope_valid(
            &env,
            OWNER,
            &signing().verifying_key(),
            now + 61
        ));
    }
    /// Actual Rust production serializers and ed25519-dalek signatures become
    /// the public, secret-free fixture tested by TypeScript WebCrypto and Edge.
    /// No OS-Keychain, Supabase, TCP or remote device operations.
    #[test]
    fn qa_emit_stage3j_edge_interop_fixture() {
        // Stage 3J stays deterministic; Stage 3K explicitly opts into fresh
        // wall-clock timestamps for PostgreSQL's real expiry constraints.
        // Test-only keys remain synthetic and never enter the OS Keychain.
        let now = if std::env::var("KATOSYNC_STAGE3K_FRESH_TEST_TIME").as_deref()
            == Ok("EPHEMERAL_ONLY")
        {
            Utc::now().timestamp()
        } else {
            2_000_000_000_i64
        };
        let initiator = SigningKey::from_bytes(&[41u8; 32]);
        let recipient = SigningKey::from_bytes(&[42u8; 32]);
        let a = Uuid::parse_str("22222222-2222-4222-8222-222222222222").unwrap();
        let b = Uuid::parse_str("33333333-3333-4333-8333-333333333333").unwrap();
        let req = Uuid::parse_str("44444444-4444-4444-8444-444444444444").unwrap();
        let offer = crate::mesh_identity::make_test_offer(&initiator, OWNER, now);
        let (challenge, response) = crate::mesh_handshake::qa_relay_test_transcript(
            offer.clone(),
            &recipient,
            &initiator,
            now + 1,
        );
        let challenge_json = serde_json::to_string(&challenge).unwrap();
        let response_json = serde_json::to_string(&response).unwrap();
        // The registered recipient B sends its signed challenge to initiator A.
        let c = make_envelope(
            &recipient,
            OWNER,
            req,
            b,
            a,
            "challenge",
            &challenge_json,
            now + 245,
        )
        .unwrap();
        let r = make_envelope(
            &initiator,
            OWNER,
            req,
            a,
            b,
            "response",
            &response_json,
            now + 245,
        )
        .unwrap();
        let pa = signed_list(&initiator, OWNER, a, now + 2);
        let pb = signed_list(&recipient, OWNER, b, now + 2);
        assert!(signed_envelope_valid(
            &c,
            OWNER,
            &recipient.verifying_key(),
            now + 2
        ));
        assert!(signed_envelope_valid(
            &r,
            OWNER,
            &initiator.verifying_key(),
            now + 2
        ));
        assert!(crate::mesh_handshake::relay_public_peer_keys(
            OWNER,
            "challenge",
            &challenge_json,
            now + 2
        )
        .is_ok());
        assert!(crate::mesh_handshake::relay_public_peer_keys(
            OWNER,
            "response",
            &response_json,
            now + 2
        )
        .is_ok());
        let fixture = serde_json::json!({
            "generatedBy":"rust-production-ed25519-dalek-serde",
            "fixtureOnly":true,
            "owner":OWNER,"nowMs":(now+2)*1000,
            "sourceDeviceId":a,"targetDeviceId":b,"requestId":req,
            "sourcePublicKey":URL_SAFE_NO_PAD.encode(initiator.verifying_key().as_bytes()),
            "targetPublicKey":URL_SAFE_NO_PAD.encode(recipient.verifying_key().as_bytes()),
            "invite":{
                "request_id":req,"owner_user_id":OWNER,"source_device_id":a,
                "target_device_id":b,"state":"accepted",
                "expires_at":chrono::DateTime::from_timestamp(offer.expires_at,0).unwrap().to_rfc3339(),
                "signed_offer":offer
            },
            "challenge":c,"response":r,
            "listInitiator":pa,"listRecipient":pb
        });
        // Single marker for an explicit, authorized fixture capture by QA script.
        println!("KATOSYNC_STAGE3J_RUST_FIXTURE={}", fixture);
    }

    #[test]
    fn signed_read_proof_is_fresh_bound_to_device_and_owner() {
        let dev = Uuid::new_v4();
        let p = signed_list(&signing(), OWNER, dev, Utc::now().timestamp());
        let msg = format!(
            "{}|{}|{}|{}|{}",
            p.protocol, OWNER, p.device_id, p.nonce, p.expires_at
        );
        let bytes = URL_SAFE_NO_PAD.decode(p.signature).unwrap();
        let sig = Signature::from_slice(&bytes).unwrap();
        assert!(signing()
            .verifying_key()
            .verify(msg.as_bytes(), &sig)
            .is_ok());
        assert!(signing()
            .verifying_key()
            .verify(
                msg.replace(OWNER, "99999999-9999-4999-8999-999999999999")
                    .as_bytes(),
                &sig
            )
            .is_err());
    }
}
