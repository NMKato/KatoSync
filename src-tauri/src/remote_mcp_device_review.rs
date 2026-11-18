// Created by NMKato Solutions
//! Explicit approval of this app's existing registered device key only.
//! Never creates keys, resets peer pins or approves other registrations.
use crate::remote_mcp_owner_review as owner;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::{Mutex, OnceLock};
use uuid::Uuid;
use zeroize::Zeroizing;

const PROOF_PREFIX: &[u8] = b"KatoSync/native-device-consent/v1\0";
const DEVICE_PATH: &str = "/api/owner/remote-mcp/device";

fn invalid() -> String {
    "REMOTE_MCP_DEVICE_INVALID_RESPONSE".into()
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WireDevice {
    device_id: Uuid,
    name: String,
    membership_state: String,
    signing_key_sha256: String,
    consent_status: Option<String>,
    consent_expires_at: Option<String>,
    revoke_epoch: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentDevice {
    device_id: Uuid,
    name: String,
    fingerprint: String,
    membership_state: String,
    consent_status: Option<String>,
    consent_expires_at: Option<String>,
    revoke_epoch: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSnapshot {
    protocol: &'static str,
    target_client: owner::TargetClient,
    grant_id: Uuid,
    current_device: CurrentDevice,
    revision: String,
    can_approve_device: bool,
    requires_mfa: bool,
    device_access_enabled: bool,
    remote_jobs_enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedDeviceReview {
    protocol: &'static str,
    review_id: Uuid,
    action: &'static str,
    target_client: owner::TargetClient,
    current_device: CurrentDevice,
    allowed_tools: Vec<String>,
    expires_at: i64,
    device_consent_expires_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireSnapshot {
    version: u8,
    source: String,
    target_client: owner::TargetClient,
    grant_id: Uuid,
    current_device: WireDevice,
    revision: String,
    can_approve_device: bool,
    requires_mfa: bool,
    device_access_enabled: bool,
}

struct LocalDevice {
    id: Uuid,
    fingerprint: String,
    hash: String,
    signer: SigningKey,
}

fn key_hash(key: &SigningKey) -> String {
    format!("{:x}", Sha256::digest(key.verifying_key().as_bytes()))
}

async fn local_device(context: &owner::OwnerContext) -> Result<LocalDevice, String> {
    owner::recheck(context).await?;
    let signer = crate::mesh_identity::existing_identity(&context.uid)
        .map_err(|_| "REMOTE_MCP_DEVICE_IDENTITY_REQUIRED".to_string())?;
    let fingerprint = crate::mesh_identity::fingerprint(&signer.verifying_key());
    let roster = crate::mesh_directory::mesh_account_devices_list()
        .await
        .map_err(|_| "REMOTE_MCP_DEVICE_REGISTRATION_REQUIRED".to_string())?;
    let uid = Uuid::parse_str(&context.uid).map_err(|_| invalid())?;
    let matches: Vec<_> = roster
        .devices
        .iter()
        .filter(|device| {
            device.owner_user_id == uid
                && device.fingerprint == fingerprint
                && device.membership_state != "revoked"
        })
        .collect();
    if matches.len() != 1 {
        return Err("REMOTE_MCP_DEVICE_REGISTRATION_REQUIRED".into());
    }
    owner::recheck(context).await?;
    Ok(LocalDevice {
        id: matches[0].device_id,
        fingerprint,
        hash: key_hash(&signer),
        signer,
    })
}

fn valid_device(device: &WireDevice, local: &LocalDevice) -> bool {
    device.device_id == local.id
        && device.signing_key_sha256 == local.hash
        && !device.name.trim().is_empty()
        && device.name.chars().count() <= 80
        && matches!(
            device.membership_state.as_str(),
            "discovered" | "pending" | "trusted"
        )
        && matches!(
            device.consent_status.as_deref(),
            None | Some("pending" | "approved" | "revoked")
        )
        && device
            .revoke_epoch
            .is_none_or(|epoch| epoch <= 2_147_483_647)
        && device
            .consent_expires_at
            .as_ref()
            .is_none_or(|time| owner::parse_time(time).is_ok())
        && (device.consent_status.as_deref() != Some("approved")
            || (device.revoke_epoch.is_some() && device.consent_expires_at.is_some()))
}

fn public_device(device: &WireDevice, local: &LocalDevice) -> CurrentDevice {
    CurrentDevice {
        device_id: device.device_id,
        name: device.name.clone(),
        fingerprint: local.fingerprint.clone(),
        membership_state: device.membership_state.clone(),
        consent_status: device.consent_status.clone(),
        consent_expires_at: device.consent_expires_at.clone(),
        revoke_epoch: device.revoke_epoch,
    }
}

async fn read_device(
    context: &owner::OwnerContext,
    local: &LocalDevice,
) -> Result<(DeviceSnapshot, WireSnapshot, owner::OwnerSnapshot), String> {
    let client = owner::snapshot_for(context).await?;
    let grant = client
        .client_grant
        .as_ref()
        .filter(|grant| grant.status == "approved")
        .ok_or("REMOTE_MCP_DEVICE_CLIENT_REQUIRED")?;
    if owner::parse_time(&grant.expires_at)? <= owner::now_ms() {
        return Err("REMOTE_MCP_OWNER_REVIEW_EXPIRED".into());
    }
    let wire: WireSnapshot = serde_json::from_value(
        owner::request(context, DEVICE_PATH, Some(json!({"deviceId": local.id}))).await?,
    )
    .map_err(|_| invalid())?;
    if wire.version != 1
        || wire.source != "katosync-owner-device-review"
        || !wire.requires_mfa
        || wire.device_access_enabled
        || wire.target_client.id != client.target_client.id
        || !owner::valid_target(&wire.target_client)
        || wire.grant_id != grant.id
        || !owner::valid_revision(&wire.revision)
        || !valid_device(&wire.current_device, local)
    {
        return Err(invalid());
    }
    let snapshot = DeviceSnapshot {
        protocol: "katosync-remote-mcp-device-v1",
        target_client: wire.target_client.clone(),
        grant_id: wire.grant_id,
        current_device: public_device(&wire.current_device, local),
        revision: wire.revision.clone(),
        can_approve_device: wire.can_approve_device,
        requires_mfa: true,
        device_access_enabled: false,
        remote_jobs_enabled: false,
    };
    owner::check_generation(context)?;
    Ok((snapshot, wire, client))
}

pub async fn remote_mcp_owner_device_snapshot() -> Result<DeviceSnapshot, String> {
    let context = owner::context().await?;
    let local = local_device(&context).await?;
    Ok(read_device(&context, &local).await?.0)
}

// Decoding is only a consistency check against the fixed, online-verified
// native SSO session. The service independently verifies the JWT signature.
async fn actor_session(context: &owner::OwnerContext) -> Result<Uuid, String> {
    owner::recheck(context).await?;
    let token = Zeroizing::new(
        crate::ensure_supabase_access_token()
            .await
            .map_err(|_| "REMOTE_MCP_OWNER_LOGIN_REQUIRED")?,
    );
    if token.len() > 16_384 {
        return Err(invalid());
    }
    let pieces: Vec<_> = token.split('.').collect();
    if pieces.len() != 3 {
        return Err(invalid());
    }
    let bytes = Zeroizing::new(URL_SAFE_NO_PAD.decode(pieces[1]).map_err(|_| invalid())?);
    let claims: Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    let session = claims
        .get("session_id")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let id = Uuid::parse_str(session).map_err(|_| invalid())?;
    if id.is_nil()
        || id.to_string() != session
        || claims.get("sub").and_then(Value::as_str) != Some(context.uid.as_str())
        || claims.get("iss").and_then(Value::as_str)
            != Some(format!("{}/auth/v1", crate::KATOSYNC_AUTH_URL).as_str())
        || claims.get("aud").and_then(Value::as_str) != Some("authenticated")
        || claims.get("role").and_then(Value::as_str) != Some("authenticated")
        || claims
            .get("exp")
            .and_then(Value::as_i64)
            .is_none_or(|expiry| expiry <= chrono::Utc::now().timestamp())
        || claims
            .get("oauth_client_id")
            .is_some_and(|value| !value.is_null())
        || claims
            .get("client_id")
            .is_some_and(|value| !value.is_null())
    {
        return Err(invalid());
    }
    owner::check_generation(context)?;
    Ok(id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceIntent {
    version: u8,
    intent_id: Uuid,
    nonce: String,
    expires_at: String,
    action: String,
    grant_id: Uuid,
    expected_revision: String,
    target_client: owner::TargetClient,
    allowed_tools: Vec<String>,
    device_access_enabled: bool,
    device_proof_payload: String,
    device_consent_expires_at: String,
    current_device: WireDevice,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeviceProofPayload {
    version: u8,
    kind: String,
    intent_id: Uuid,
    nonce: String,
    owner_id: Uuid,
    tenant_id: Uuid,
    actor_session_id: Uuid,
    oauth_client_id: Uuid,
    grant_id: Uuid,
    device_id: Uuid,
    signing_key_sha256: String,
    revoke_epoch: u32,
    action: String,
    expected_revision: String,
    issued_at_ms: i64,
    expires_at_ms: i64,
}

fn validate_proof(
    intent: &DeviceIntent,
    context: &owner::OwnerContext,
    local: &LocalDevice,
    session: Uuid,
    grant_id: Uuid,
    client_id: Uuid,
    expected_epoch: u32,
    now: i64,
) -> Result<i64, String> {
    if intent.device_proof_payload.len() > 4096 {
        return Err(invalid());
    }
    let proof: DeviceProofPayload =
        serde_json::from_str(&intent.device_proof_payload).map_err(|_| invalid())?;
    let expires = owner::parse_time(&intent.expires_at)?;
    if intent.version != 1
        || intent.action != "approve_device"
        || intent.intent_id.is_nil()
        || intent.grant_id != grant_id
        || intent.target_client.id != client_id
        || !owner::valid_target(&intent.target_client)
        || !owner::read_only_tools(&intent.allowed_tools)
        || intent.device_access_enabled
        || !owner::valid_revision(&intent.expected_revision)
        || !valid_device(&intent.current_device, local)
        || intent.current_device.revoke_epoch != Some(expected_epoch)
        || intent.nonce.len() != 43
        || !intent
            .nonce
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        || proof.version != 1
        || proof.kind != "KATOSYNC_NATIVE_DEVICE_CONSENT"
        || proof.intent_id != intent.intent_id
        || proof.nonce != intent.nonce
        || proof.owner_id.to_string() != context.uid
        || proof.tenant_id.is_nil()
        || proof.actor_session_id != session
        || proof.oauth_client_id != client_id
        || proof.grant_id != grant_id
        || proof.device_id != local.id
        || proof.signing_key_sha256 != local.hash
        || proof.revoke_epoch != expected_epoch
        || proof.action != "approve_device"
        || proof.expected_revision != intent.expected_revision
        || proof.expires_at_ms != expires
        || proof.issued_at_ms > now + 5_000
        || proof.expires_at_ms <= now
        || proof.expires_at_ms <= proof.issued_at_ms
        || proof
            .expires_at_ms
            .checked_sub(proof.issued_at_ms)
            .is_none_or(|age| age > 90_000)
    {
        return Err(invalid());
    }
    Ok(expires)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Challenge {
    version: u8,
    intent_id: Uuid,
    factor_id: Uuid,
    auth_challenge_id: Uuid,
    expires_at: String,
}

struct PendingDeviceReview {
    id: Uuid,
    context: owner::OwnerContext,
    actor_session: Uuid,
    device_id: Uuid,
    key_hash: String,
    grant_id: Uuid,
    client_id: Uuid,
    epoch: u32,
    intent_id: Uuid,
    nonce: Zeroizing<String>,
    payload: Zeroizing<String>,
    signature: String,
    factor_id: Uuid,
    auth_challenge_id: Uuid,
    expires_at: i64,
}
#[derive(Default)]
struct DeviceReviewState {
    operation: u64,
    pending: Option<PendingDeviceReview>,
}
static REVIEWS: OnceLock<Mutex<DeviceReviewState>> = OnceLock::new();
fn reviews() -> &'static Mutex<DeviceReviewState> {
    REVIEWS.get_or_init(|| Mutex::new(DeviceReviewState::default()))
}

pub(crate) fn cancel_review(id: Uuid) -> Result<(), String> {
    let mut state = reviews().lock().map_err(|_| invalid())?;
    if state
        .pending
        .as_ref()
        .is_some_and(|pending| pending.id == id)
    {
        state.pending = None;
        state.operation = state.operation.checked_add(1).ok_or_else(invalid)?;
    }
    Ok(())
}

pub async fn remote_mcp_owner_prepare_device_decision(
    expected_revision: String,
    factor_id: String,
) -> Result<PreparedDeviceReview, String> {
    let context = owner::context().await?;
    let factor_id = Uuid::parse_str(&factor_id).map_err(|_| invalid())?;
    if !owner::valid_revision(&expected_revision) {
        return Err(invalid());
    }
    let operation = {
        let mut state = reviews().lock().map_err(|_| invalid())?;
        state.operation = state.operation.checked_add(1).ok_or_else(invalid)?;
        state.pending = None;
        state.operation
    };
    let local = local_device(&context).await?;
    let (before, wire, client) = read_device(&context, &local).await?;
    if !before.can_approve_device
        || before.revision != expected_revision
        || !client.factors.iter().any(|factor| factor.id == factor_id)
    {
        return Err("REMOTE_MCP_OWNER_REVIEW_CHANGED".into());
    }
    let session = actor_session(&context).await?;
    let intent: DeviceIntent = serde_json::from_value(owner::request(&context, "/api/owner/remote-mcp/intents", Some(json!({
        "version":1,"action":"approve_device","grantId":before.grant_id,"expectedRevision":expected_revision,"deviceId":local.id
    }))).await?).map_err(|_| invalid())?;
    // A null pre-review epoch can become persisted zero only in this explicit
    // pending-intent transaction. An issued intent must report an actual epoch.
    let epoch = match wire.current_device.revoke_epoch {
        Some(epoch) => epoch,
        None if intent.current_device.revoke_epoch == Some(0) => 0,
        None => return Err(invalid()),
    };
    let intent_expiry = validate_proof(
        &intent,
        &context,
        &local,
        session,
        before.grant_id,
        before.target_client.id,
        epoch,
        owner::now_ms(),
    )?;
    if !owner::same_tools(&intent.allowed_tools, &client.allowed_tools)
        || intent.current_device.membership_state != wire.current_device.membership_state
        || (wire.current_device.consent_status.is_none()
            && intent.current_device.consent_status.as_deref() != Some("pending"))
        || (wire.current_device.consent_status.is_some()
            && intent.current_device.consent_status != wire.current_device.consent_status)
        || intent.current_device.consent_expires_at.as_deref()
            != Some(intent.device_consent_expires_at.as_str())
    {
        return Err(invalid());
    }
    let consent_expiry = owner::parse_time(&intent.device_consent_expires_at)?;
    let client_expiry =
        owner::parse_time(&client.client_grant.as_ref().ok_or_else(invalid)?.expires_at)?;
    if consent_expiry <= owner::now_ms() || consent_expiry > client_expiry {
        return Err(invalid());
    }
    let mut bytes = Vec::with_capacity(PROOF_PREFIX.len() + intent.device_proof_payload.len());
    bytes.extend_from_slice(PROOF_PREFIX);
    bytes.extend_from_slice(intent.device_proof_payload.as_bytes());
    let signature = URL_SAFE_NO_PAD.encode(local.signer.sign(&bytes).to_bytes());
    let challenge: Challenge = serde_json::from_value(
        owner::request(
            &context,
            "/api/owner/remote-mcp/intents/challenge",
            Some(json!({
                "intentId":intent.intent_id,"nonce":intent.nonce,"factorId":factor_id
            })),
        )
        .await?,
    )
    .map_err(|_| invalid())?;
    let challenge_expiry = owner::parse_time(&challenge.expires_at)?;
    if challenge.version != 1
        || challenge.intent_id != intent.intent_id
        || challenge.factor_id != factor_id
        || challenge.auth_challenge_id.is_nil()
        || challenge_expiry > intent_expiry
        || challenge_expiry <= owner::now_ms()
    {
        return Err(invalid());
    }
    owner::recheck(&context).await?;
    let id = Uuid::new_v4();
    let expires_at = challenge_expiry.min(consent_expiry);
    let receipt = PreparedDeviceReview {
        protocol: "katosync-remote-mcp-device-review-v1",
        review_id: id,
        action: "approve_device",
        target_client: intent.target_client.clone(),
        current_device: public_device(&intent.current_device, &local),
        allowed_tools: intent.allowed_tools.clone(),
        expires_at,
        device_consent_expires_at: intent.device_consent_expires_at.clone(),
    };
    let mut state = reviews().lock().map_err(|_| invalid())?;
    if operation != state.operation {
        return Err("REMOTE_MCP_OWNER_CANCELLED".into());
    }
    owner::check_generation(&context)?;
    state.pending = Some(PendingDeviceReview {
        id,
        context,
        actor_session: session,
        device_id: local.id,
        key_hash: local.hash,
        grant_id: before.grant_id,
        client_id: before.target_client.id,
        epoch,
        intent_id: intent.intent_id,
        nonce: Zeroizing::new(intent.nonce),
        payload: Zeroizing::new(intent.device_proof_payload),
        signature,
        factor_id,
        auth_challenge_id: challenge.auth_challenge_id,
        expires_at,
    });
    Ok(receipt)
}

pub async fn remote_mcp_owner_confirm_device_decision(
    review_id: String,
    code: String,
) -> Result<DeviceSnapshot, String> {
    let code = Zeroizing::new(code);
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err("REMOTE_MCP_OWNER_MFA_INVALID_CODE".into());
    }
    let id = Uuid::parse_str(&review_id).map_err(|_| invalid())?;
    let pending = {
        let mut state = reviews().lock().map_err(|_| invalid())?;
        if !state
            .pending
            .as_ref()
            .is_some_and(|pending| pending.id == id)
        {
            return Err("REMOTE_MCP_OWNER_REVIEW_EXPIRED".into());
        }
        state.pending.take().ok_or_else(invalid)?
    };
    owner::recheck(&pending.context).await?;
    if pending.expires_at <= owner::now_ms()
        || actor_session(&pending.context).await? != pending.actor_session
    {
        return Err("REMOTE_MCP_OWNER_REVIEW_EXPIRED".into());
    }
    let local = local_device(&pending.context).await?;
    if local.id != pending.device_id || local.hash != pending.key_hash {
        return Err("REMOTE_MCP_OWNER_REVIEW_CHANGED".into());
    }
    crate::verify_remote_mcp_totp_native(
        &pending.factor_id.to_string(),
        &pending.auth_challenge_id.to_string(),
        code.as_str(),
    )
    .await?;
    owner::recheck(&pending.context).await?;
    if pending.expires_at <= owner::now_ms()
        || actor_session(&pending.context).await? != pending.actor_session
    {
        return Err("REMOTE_MCP_OWNER_REVIEW_EXPIRED".into());
    }
    let current_key = crate::mesh_identity::existing_identity(&pending.context.uid)
        .map_err(|_| "REMOTE_MCP_OWNER_REVIEW_CHANGED".to_string())?;
    if key_hash(&current_key) != pending.key_hash {
        return Err("REMOTE_MCP_OWNER_REVIEW_CHANGED".into());
    }
    owner::check_generation(&pending.context)?;
    let result = owner::request(&pending.context,"/api/owner/remote-mcp/decisions",Some(json!({
        "intentId":pending.intent_id,"nonce":pending.nonce.as_str(),"factorId":pending.factor_id,
        "authChallengeId":pending.auth_challenge_id,"deviceProof":{"payload":pending.payload.as_str(),"signature":pending.signature}
    }))).await?;
    if result.get("version").and_then(Value::as_u64) != Some(1)
        || result.get("status").and_then(Value::as_str) != Some("approved")
        || result.get("deviceId").and_then(Value::as_str)
            != Some(pending.device_id.to_string().as_str())
        || result.get("deviceConsentChanged") != Some(&Value::Bool(true))
        || result.get("deviceAccessEnabled") != Some(&Value::Bool(false))
        || result.get("remoteExecutionAllowed") != Some(&Value::Bool(false))
        || result
            .get("auditId")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
            .is_none()
    {
        return Err(invalid());
    }
    let snapshot = read_device(&pending.context, &local).await?.0;
    if snapshot.grant_id != pending.grant_id
        || snapshot.target_client.id != pending.client_id
        || snapshot.current_device.membership_state != "trusted"
        || snapshot.current_device.consent_status.as_deref() != Some("approved")
        || snapshot.current_device.revoke_epoch != Some(pending.epoch)
        || snapshot
            .current_device
            .consent_expires_at
            .as_ref()
            .and_then(|x| owner::parse_time(x).ok())
            .is_none_or(|x| x <= owner::now_ms())
    {
        return Err("REMOTE_MCP_OWNER_REVIEW_CHANGED".into());
    }
    owner::check_generation(&pending.context)?;
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Verifier;

    #[test]
    fn proof_checks_every_identity_binding_before_signing_original_bytes() {
        let signer = SigningKey::from_bytes(&[7; 32]);
        let hash = key_hash(&signer);
        let local = LocalDevice {
            id: Uuid::from_u128(2),
            fingerprint: crate::mesh_identity::fingerprint(&signer.verifying_key()),
            hash: hash.clone(),
            signer,
        };
        let context = owner::OwnerContext {
            generation: 0,
            uid: Uuid::from_u128(1).to_string(),
        };
        let session = Uuid::from_u128(3);
        let client = Uuid::from_u128(4);
        let grant = Uuid::from_u128(5);
        let intent_id = Uuid::from_u128(6);
        let now = owner::now_ms();
        let revision = "a".repeat(64);
        let nonce = "A".repeat(43);
        let payload = json!({"version":1,"kind":"KATOSYNC_NATIVE_DEVICE_CONSENT","intentId":intent_id,"nonce":nonce,
            "ownerId":context.uid,"tenantId":Uuid::from_u128(7),"actorSessionId":session,"oauthClientId":client,
            "grantId":grant,"deviceId":local.id,"signingKeySha256":hash,"revokeEpoch":0,"action":"approve_device",
            "expectedRevision":revision,"issuedAtMs":now,"expiresAtMs":now+90_000});
        let mut intent = DeviceIntent {
            version: 1,
            intent_id,
            nonce: nonce.clone(),
            expires_at: chrono::DateTime::from_timestamp_millis(now + 90_000)
                .unwrap()
                .to_rfc3339(),
            action: "approve_device".into(),
            grant_id: grant,
            expected_revision: revision.clone(),
            target_client: owner::TargetClient {
                id: client,
                name: "ChatGPT".into(),
            },
            allowed_tools: vec!["devices.list".into(), "device.status".into()],
            device_access_enabled: false,
            device_proof_payload: payload.to_string(),
            device_consent_expires_at: "2099-01-01T00:00:00Z".into(),
            current_device: WireDevice {
                device_id: local.id,
                name: "This Mac".into(),
                membership_state: "discovered".into(),
                signing_key_sha256: hash,
                consent_status: Some("pending".into()),
                consent_expires_at: None,
                revoke_epoch: Some(0),
            },
        };
        assert!(validate_proof(&intent, &context, &local, session, grant, client, 0, now).is_ok());
        for (field, value) in [
            ("ownerId", json!(Uuid::from_u128(99))),
            ("actorSessionId", json!(Uuid::from_u128(99))),
            ("deviceId", json!(Uuid::from_u128(99))),
            ("grantId", json!(Uuid::from_u128(99))),
            ("oauthClientId", json!(Uuid::from_u128(99))),
            ("nonce", json!("B".repeat(43))),
            ("signingKeySha256", json!("b".repeat(64))),
            ("revokeEpoch", json!(1)),
            ("action", json!("approve_client")),
            ("expectedRevision", json!("b".repeat(64))),
            ("expiresAtMs", json!(now)),
            ("issuedAtMs", json!(i64::MIN)),
            ("extraPermission", json!(true)),
        ] {
            let mut bad = payload.clone();
            bad[field] = value;
            intent.device_proof_payload = bad.to_string();
            assert!(
                validate_proof(&intent, &context, &local, session, grant, client, 0, now).is_err(),
                "{field}"
            );
        }
        intent.device_proof_payload = payload.to_string();
        let mut exact = PROOF_PREFIX.to_vec();
        exact.extend_from_slice(intent.device_proof_payload.as_bytes());
        let signature = local.signer.sign(&exact);
        assert!(local
            .signer
            .verifying_key()
            .verify(&exact, &signature)
            .is_ok());
        assert!(local
            .signer
            .verifying_key()
            .verify(intent.device_proof_payload.as_bytes(), &signature)
            .is_err());
        intent.current_device.revoke_epoch = None;
        assert!(validate_proof(&intent, &context, &local, session, grant, client, 0, now).is_err());
    }
}
