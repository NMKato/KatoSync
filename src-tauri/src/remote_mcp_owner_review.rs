// Created by NMKato Solutions
//! Native-only KatoOS actor -> separately reviewed ChatGPT client consent.
//! Tokens, intent nonces and GoTrue challenges never cross the IPC boundary.
//! This bridge cannot approve device access or execute a remote job.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use uuid::Uuid;
use zeroize::Zeroizing;

const ORIGIN: &str = "https://remote-mcp.katoos.de";
const OWNER_PATH: &str = "/api/owner/remote-mcp";
const MAX_RESPONSE: usize = 65_536;
const READ_TOOLS: [&str; 2] = ["devices.list", "device.status"];

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetClient {
    pub(crate) id: Uuid,
    pub(crate) name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientGrant {
    pub(crate) id: Uuid,
    pub(crate) status: String,
    pub(crate) expires_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TotpFactor {
    pub(crate) id: Uuid,
    friendly_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerSnapshot {
    protocol: &'static str,
    pub(crate) target_client: TargetClient,
    pub(crate) client_grant: Option<ClientGrant>,
    allowed_tools: Vec<String>,
    can_request_client: bool,
    can_approve: bool,
    can_revoke: bool,
    requires_mfa: bool,
    approval_state: String,
    revision: Option<String>,
    pub(crate) factors: Vec<TotpFactor>,
    device_access_enabled: bool,
    remote_execution_allowed: bool,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DecisionAction {
    ApproveClient,
    RevokeClient,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedReview {
    protocol: &'static str,
    review_id: Uuid,
    action: DecisionAction,
    target_client: TargetClient,
    allowed_tools: Vec<String>,
    expires_at: i64,
}

#[derive(Deserialize)]
struct WireGrant {
    grant_id: Uuid,
    status: String,
    allowed_tools: Vec<String>,
    expires_at: String,
    revoked_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireFactor {
    id: Uuid,
    friendly_name: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireSnapshot {
    version: u8,
    source: String,
    owner_verified: bool,
    target_client: TargetClient,
    client_grant: Option<WireGrant>,
    allowed_tools: Vec<String>,
    can_request_client: bool,
    can_approve: bool,
    #[serde(default)]
    can_revoke: bool,
    requires_mfa: bool,
    approval_state: String,
    #[serde(default)]
    revision: Option<String>,
    #[serde(default)]
    factors: Vec<WireFactor>,
    device_access_enabled: bool,
    remote_execution_allowed: bool,
}

pub(crate) struct OwnerContext {
    pub(crate) generation: u64,
    pub(crate) uid: String,
}

struct PendingReview {
    id: Uuid,
    context: OwnerContext,
    action: DecisionAction,
    grant_id: Uuid,
    target_client_id: Uuid,
    intent_id: Uuid,
    nonce: Zeroizing<String>,
    factor_id: Uuid,
    auth_challenge_id: Uuid,
    expires_at: i64,
}

#[derive(Default)]
struct ReviewState {
    operation: u64,
    pending: Option<PendingReview>,
}

static REVIEW: OnceLock<Mutex<ReviewState>> = OnceLock::new();
fn review_state() -> &'static Mutex<ReviewState> {
    REVIEW.get_or_init(|| Mutex::new(ReviewState::default()))
}

fn invalid() -> String {
    "REMOTE_MCP_OWNER_INVALID_RESPONSE".into()
}

pub(crate) fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub(crate) fn read_only_tools(tools: &[String]) -> bool {
    tools.len() == READ_TOOLS.len()
        && READ_TOOLS
            .iter()
            .all(|tool| tools.iter().filter(|x| x.as_str() == *tool).count() == 1)
}

pub(crate) fn valid_target(target: &TargetClient) -> bool {
    !target.id.is_nil() && !target.name.trim().is_empty() && target.name.chars().count() <= 80
}

pub(crate) fn valid_revision(revision: &str) -> bool {
    revision.len() == 64
        && revision
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(crate) fn parse_time(value: &str) -> Result<i64, String> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|time| time.timestamp_millis())
        .map_err(|_| invalid())
}

fn sanitize_snapshot(value: Value) -> Result<OwnerSnapshot, String> {
    let wire: WireSnapshot = serde_json::from_value(value).map_err(|_| invalid())?;
    if wire.version != 1
        || wire.source != "katosync-owner-review"
        || !wire.owner_verified
        || !valid_target(&wire.target_client)
        || !read_only_tools(&wire.allowed_tools)
        || !wire.requires_mfa
        || wire.device_access_enabled
        || wire.remote_execution_allowed
        || wire.factors.len() > 10
        || wire.revision.as_ref().is_some_and(|x| !valid_revision(x))
        || !matches!(
            wire.approval_state.as_str(),
            "actor_target_mfa_bridge_required"
                | "owner_approval_not_configured"
                | "owner_approval_unavailable"
                | "request_required"
                | "totp_enrollment_required"
                | "review_required"
                | "approved"
                | "revoked"
        )
    {
        return Err(invalid());
    }
    let mut factors = Vec::new();
    for factor in wire.factors {
        if factor.id.is_nil()
            || factor.kind != "totp"
            || factor.friendly_name.chars().count() > 80
            || factors.iter().any(|item: &TotpFactor| item.id == factor.id)
        {
            return Err(invalid());
        }
        factors.push(TotpFactor {
            id: factor.id,
            friendly_name: factor.friendly_name,
        });
    }
    let client_grant = match wire.client_grant {
        Some(grant) => {
            if grant.grant_id.is_nil()
                || !matches!(grant.status.as_str(), "pending" | "approved")
                || grant.revoked_at.is_some()
                || !read_only_tools(&grant.allowed_tools)
            {
                return Err(invalid());
            }
            parse_time(&grant.expires_at)?;
            Some(ClientGrant {
                id: grant.grant_id,
                status: grant.status,
                expires_at: grant.expires_at,
            })
        }
        None => None,
    };
    let grant_status = client_grant.as_ref().map(|grant| grant.status.as_str());
    if (wire.can_request_client && client_grant.is_some())
        || (wire.can_approve
            && (grant_status != Some("pending") || factors.is_empty() || wire.revision.is_none()))
        || (wire.can_revoke
            && (grant_status != Some("approved") || factors.is_empty() || wire.revision.is_none()))
    {
        return Err(invalid());
    }
    if wire.can_approve
        && parse_time(&client_grant.as_ref().ok_or_else(invalid)?.expires_at)? <= now_ms()
    {
        return Err("REMOTE_MCP_OWNER_REVIEW_EXPIRED".into());
    }
    Ok(OwnerSnapshot {
        protocol: "katosync-remote-mcp-owner-v1",
        target_client: wire.target_client,
        client_grant,
        allowed_tools: READ_TOOLS.iter().map(|x| x.to_string()).collect(),
        can_request_client: wire.can_request_client,
        can_approve: wire.can_approve,
        can_revoke: wire.can_revoke,
        requires_mfa: true,
        approval_state: wire.approval_state,
        revision: wire.revision,
        factors,
        device_access_enabled: false,
        remote_execution_allowed: false,
    })
}

pub(crate) fn check_generation(context: &OwnerContext) -> Result<(), String> {
    if context.generation != crate::native_owner_session_generation() {
        return Err("REMOTE_MCP_OWNER_SESSION_CHANGED".into());
    }
    Ok(())
}

pub(crate) async fn context() -> Result<OwnerContext, String> {
    if !cfg!(feature = "katoos-auth-qa") {
        return Err("REMOTE_MCP_OWNER_NOT_CONFIGURED".into());
    }
    let generation = crate::native_owner_session_generation();
    let uid = crate::github_app_auth::verified_katosync_user()
        .await
        .map_err(|_| "REMOTE_MCP_OWNER_LOGIN_REQUIRED".to_string())?;
    let context = OwnerContext { generation, uid };
    check_generation(&context)?;
    Ok(context)
}

pub(crate) async fn recheck(context: &OwnerContext) -> Result<(), String> {
    check_generation(context)?;
    crate::mesh_identity::same_account_still_verified(&context.uid)
        .await
        .map_err(|_| "REMOTE_MCP_OWNER_SESSION_CHANGED".to_string())?;
    check_generation(context)
}

pub(crate) async fn request(
    context: &OwnerContext,
    path: &'static str,
    body: Option<Value>,
) -> Result<Value, String> {
    recheck(context).await?;
    let token = Zeroizing::new(
        crate::ensure_supabase_access_token()
            .await
            .map_err(|_| "REMOTE_MCP_OWNER_LOGIN_REQUIRED".to_string())?,
    );
    check_generation(context)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "REMOTE_MCP_OWNER_UNAVAILABLE".to_string())?;
    let url = format!("{ORIGIN}{path}");
    let builder = if let Some(body) = body {
        client.post(url).json(&body)
    } else {
        client.get(url)
    };
    // A final auth-generation check is adjacent to the outbound operation.
    check_generation(context)?;
    let mut response = builder
        .bearer_auth(token.as_str())
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| "REMOTE_MCP_OWNER_UNAVAILABLE".to_string())?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 => "REMOTE_MCP_OWNER_LOGIN_REQUIRED",
            429 => "REMOTE_MCP_OWNER_RATE_LIMITED",
            400 | 409 => "REMOTE_MCP_OWNER_REVIEW_CHANGED",
            _ => "REMOTE_MCP_OWNER_UNAVAILABLE",
        }
        .into());
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE as u64)
    {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "REMOTE_MCP_OWNER_UNAVAILABLE".to_string())?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE {
            return Err(invalid());
        }
        bytes.extend_from_slice(&chunk);
    }
    recheck(context).await?;
    serde_json::from_slice(&bytes).map_err(|_| invalid())
}

pub(crate) async fn snapshot_for(context: &OwnerContext) -> Result<OwnerSnapshot, String> {
    let snapshot = sanitize_snapshot(request(context, OWNER_PATH, None).await?)?;
    check_generation(context)?;
    Ok(snapshot)
}

pub async fn remote_mcp_owner_snapshot() -> Result<OwnerSnapshot, String> {
    let context = context().await?;
    snapshot_for(&context).await
}

pub async fn remote_mcp_owner_request_client() -> Result<OwnerSnapshot, String> {
    let context = context().await?;
    let before = snapshot_for(&context).await?;
    if !before.can_request_client || before.client_grant.is_some() {
        return Err("REMOTE_MCP_OWNER_REVIEW_CHANGED".into());
    }
    let result = request(&context, "/api/owner/remote-mcp/requests", Some(json!({}))).await?;
    if !result.get("requestCreated").is_some_and(Value::is_boolean)
        || !matches!(
            result.get("status").and_then(Value::as_str),
            Some("pending_review" | "request_exists")
        )
        || result.get("deviceAccessEnabled") != Some(&Value::Bool(false))
        || result.get("remoteExecutionAllowed") != Some(&Value::Bool(false))
    {
        return Err(invalid());
    }
    snapshot_for(&context).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireIntent {
    version: u8,
    intent_id: Uuid,
    nonce: String,
    expires_at: String,
    action: DecisionAction,
    grant_id: Uuid,
    expected_revision: String,
    target_client: TargetClient,
    allowed_tools: Vec<String>,
    device_access_enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireChallenge {
    version: u8,
    intent_id: Uuid,
    factor_id: Uuid,
    auth_challenge_id: Uuid,
    expires_at: String,
}

fn validate_intent(
    intent: &WireIntent,
    action: DecisionAction,
    grant_id: Uuid,
    revision: &str,
    client_id: Uuid,
    now: i64,
) -> Result<i64, String> {
    let expires = parse_time(&intent.expires_at)?;
    if intent.version != 1
        || intent.intent_id.is_nil()
        || intent.action != action
        || intent.grant_id != grant_id
        || intent.expected_revision != revision
        || intent.target_client.id != client_id
        || !valid_target(&intent.target_client)
        || !read_only_tools(&intent.allowed_tools)
        || intent.device_access_enabled
        || intent.nonce.len() != 43
        || !intent
            .nonce
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        || expires <= now
        || expires > now + 5 * 60_000
    {
        return Err(invalid());
    }
    Ok(expires)
}

pub async fn remote_mcp_owner_prepare_decision(
    action: DecisionAction,
    grant_id: String,
    expected_revision: String,
    factor_id: String,
) -> Result<PreparedReview, String> {
    let context = context().await?;
    let grant_id = Uuid::parse_str(&grant_id).map_err(|_| invalid())?;
    let factor_id = Uuid::parse_str(&factor_id).map_err(|_| invalid())?;
    if !valid_revision(&expected_revision) {
        return Err(invalid());
    }
    let operation = {
        let mut state = review_state().lock().map_err(|_| invalid())?;
        state.operation = state.operation.checked_add(1).ok_or_else(invalid)?;
        state.pending = None;
        state.operation
    };
    let before = snapshot_for(&context).await?;
    let permitted = match action {
        DecisionAction::ApproveClient => before.can_approve,
        DecisionAction::RevokeClient => before.can_revoke,
    };
    if !permitted
        || before.client_grant.as_ref().map(|grant| grant.id) != Some(grant_id)
        || before.revision.as_deref() != Some(expected_revision.as_str())
        || !before.factors.iter().any(|factor| factor.id == factor_id)
    {
        return Err("REMOTE_MCP_OWNER_REVIEW_CHANGED".into());
    }
    let intent: WireIntent = serde_json::from_value(request(&context, "/api/owner/remote-mcp/intents", Some(json!({
        "version": 1, "action": action, "grantId": grant_id, "expectedRevision": expected_revision, "deviceId": null
    }))).await?).map_err(|_| invalid())?;
    let expires_at = validate_intent(
        &intent,
        action,
        grant_id,
        &expected_revision,
        before.target_client.id,
        now_ms(),
    )?;
    let nonce = Zeroizing::new(intent.nonce);
    let challenge: WireChallenge = serde_json::from_value(
        request(
            &context,
            "/api/owner/remote-mcp/intents/challenge",
            Some(json!({
                "intentId": intent.intent_id, "nonce": nonce.as_str(), "factorId": factor_id
            })),
        )
        .await?,
    )
    .map_err(|_| invalid())?;
    let challenge_expiry = parse_time(&challenge.expires_at)?;
    if challenge.version != 1
        || challenge.intent_id != intent.intent_id
        || challenge.factor_id != factor_id
        || challenge.auth_challenge_id.is_nil()
        || challenge_expiry > expires_at
        || challenge_expiry <= now_ms()
    {
        return Err(invalid());
    }
    recheck(&context).await?;
    let id = Uuid::new_v4();
    let receipt = PreparedReview {
        protocol: "katosync-remote-mcp-review-v1",
        review_id: id,
        action,
        target_client: intent.target_client.clone(),
        allowed_tools: READ_TOOLS.iter().map(|x| x.to_string()).collect(),
        expires_at: challenge_expiry,
    };
    let mut state = review_state().lock().map_err(|_| invalid())?;
    if operation != state.operation {
        return Err("REMOTE_MCP_OWNER_CANCELLED".into());
    }
    check_generation(&context)?;
    state.pending = Some(PendingReview {
        id,
        context,
        action,
        grant_id,
        target_client_id: intent.target_client.id,
        intent_id: intent.intent_id,
        nonce,
        factor_id,
        auth_challenge_id: challenge.auth_challenge_id,
        expires_at: challenge_expiry,
    });
    Ok(receipt)
}

pub fn remote_mcp_owner_cancel_review(review_id: String) -> Result<(), String> {
    let id = Uuid::parse_str(&review_id).map_err(|_| invalid())?;
    let mut state = review_state().lock().map_err(|_| invalid())?;
    if state.pending.as_ref().is_some_and(|review| review.id == id) {
        state.pending = None;
        state.operation = state.operation.checked_add(1).ok_or_else(invalid)?;
    }
    drop(state);
    crate::remote_mcp_device_review::cancel_review(id)
}

pub async fn remote_mcp_owner_confirm_decision(
    review_id: String,
    code: String,
) -> Result<OwnerSnapshot, String> {
    let code = Zeroizing::new(code);
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err("REMOTE_MCP_OWNER_MFA_INVALID_CODE".into());
    }
    let id = Uuid::parse_str(&review_id).map_err(|_| invalid())?;
    let pending = {
        let mut state = review_state().lock().map_err(|_| invalid())?;
        if !state.pending.as_ref().is_some_and(|review| review.id == id) {
            return Err("REMOTE_MCP_OWNER_REVIEW_EXPIRED".into());
        }
        // Every attempt consumes the local review exactly once, including failed codes.
        state.pending.take().ok_or_else(invalid)?
    };
    if pending.expires_at <= now_ms() {
        return Err("REMOTE_MCP_OWNER_REVIEW_EXPIRED".into());
    }
    recheck(&pending.context).await?;
    crate::verify_remote_mcp_totp_native(
        &pending.factor_id.to_string(),
        &pending.auth_challenge_id.to_string(),
        code.as_str(),
    )
    .await?;
    // Native MFA verification persisted rotated credentials. The next request
    // fetches that current AAL2 bearer; no credential is returned to JavaScript.
    recheck(&pending.context).await?;
    if pending.expires_at <= now_ms() {
        return Err("REMOTE_MCP_OWNER_REVIEW_EXPIRED".into());
    }
    let result = request(
        &pending.context,
        "/api/owner/remote-mcp/decisions",
        Some(json!({
            "intentId": pending.intent_id, "nonce": pending.nonce.as_str(),
            "factorId": pending.factor_id, "authChallengeId": pending.auth_challenge_id
        })),
    )
    .await?;
    let expected = match pending.action {
        DecisionAction::ApproveClient => "approved",
        DecisionAction::RevokeClient => "revoked",
    };
    if result.get("version").and_then(Value::as_u64) != Some(1)
        || result.get("status").and_then(Value::as_str) != Some(expected)
        || result.get("clientGrantChanged") != Some(&Value::Bool(true))
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
    let snapshot = snapshot_for(&pending.context).await?;
    if snapshot.target_client.id != pending.target_client_id
        || (pending.action == DecisionAction::ApproveClient
            && !snapshot
                .client_grant
                .as_ref()
                .is_some_and(|grant| grant.id == pending.grant_id && grant.status == "approved"))
        || (pending.action == DecisionAction::RevokeClient
            && snapshot
                .client_grant
                .as_ref()
                .is_some_and(|grant| grant.id == pending.grant_id && grant.status == "approved"))
    {
        return Err("REMOTE_MCP_OWNER_REVIEW_CHANGED".into());
    }
    check_generation(&pending.context)?;
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wire() -> Value {
        json!({"version":1,"source":"katosync-owner-review","ownerVerified":true,
            "targetClient":{"id":"11111111-1111-4111-8111-111111111111","name":"ChatGPT KatoSync"},
            "clientGrant":null,"allowedTools":["devices.list","device.status"],
            "canRequestClient":true,"canApprove":false,"requiresMfa":true,
            "approvalState":"owner_approval_not_configured","deviceAccessEnabled":false,"remoteExecutionAllowed":false})
    }

    #[test]
    fn pending_only_snapshot_never_invents_mfa_or_device_permission() {
        let parsed = sanitize_snapshot(wire()).unwrap();
        assert!(parsed.can_request_client);
        assert!(!parsed.can_approve);
        assert!(!parsed.can_revoke);
        assert!(parsed.revision.is_none());
        assert!(parsed.factors.is_empty());
        assert!(!parsed.device_access_enabled);
        assert!(!parsed.remote_execution_allowed);
    }

    #[test]
    fn owner_target_readonly_scope_and_mfa_are_mandatory() {
        for (key, value) in [
            ("ownerVerified", json!(false)),
            ("requiresMfa", json!(false)),
            ("deviceAccessEnabled", json!(true)),
            ("remoteExecutionAllowed", json!(true)),
            ("allowedTools", json!(["devices.list", "remote.exec"])),
            ("canApprove", json!(true)),
        ] {
            let mut invalid = wire();
            invalid[key] = value;
            assert!(sanitize_snapshot(invalid).is_err(), "{key}");
        }
    }

    #[test]
    fn sanitized_native_receipt_drops_server_private_fields() {
        let mut input = wire();
        input["access_token"] = json!("must-not-cross-ipc");
        input["nonce"] = json!("private");
        input["targetClient"]["authChallengeId"] = json!("private");
        let serialized = serde_json::to_value(sanitize_snapshot(input).unwrap()).unwrap();
        assert!(serialized.get("access_token").is_none());
        assert!(serialized.get("nonce").is_none());
        assert!(serialized["targetClient"].get("authChallengeId").is_none());
    }

    #[test]
    fn prepared_intent_is_bound_to_exact_action_grant_target_revision_and_expiry() {
        let client = Uuid::from_u128(1);
        let grant = Uuid::from_u128(2);
        let revision = "a".repeat(64);
        let current = now_ms();
        let mut intent = WireIntent {
            version: 1,
            intent_id: Uuid::from_u128(3),
            nonce: "A".repeat(43),
            expires_at: (chrono::Utc::now() + chrono::Duration::seconds(90)).to_rfc3339(),
            action: DecisionAction::ApproveClient,
            grant_id: grant,
            expected_revision: revision.clone(),
            target_client: TargetClient {
                id: client,
                name: "ChatGPT".into(),
            },
            allowed_tools: READ_TOOLS.iter().map(|x| x.to_string()).collect(),
            device_access_enabled: false,
        };
        assert!(validate_intent(
            &intent,
            DecisionAction::ApproveClient,
            grant,
            &revision,
            client,
            current
        )
        .is_ok());
        assert!(validate_intent(
            &intent,
            DecisionAction::RevokeClient,
            grant,
            &revision,
            client,
            current
        )
        .is_err());
        assert!(validate_intent(
            &intent,
            DecisionAction::ApproveClient,
            Uuid::from_u128(4),
            &revision,
            client,
            current
        )
        .is_err());
        assert!(validate_intent(
            &intent,
            DecisionAction::ApproveClient,
            grant,
            &"b".repeat(64),
            client,
            current
        )
        .is_err());
        assert!(validate_intent(
            &intent,
            DecisionAction::ApproveClient,
            grant,
            &revision,
            Uuid::from_u128(4),
            current
        )
        .is_err());
        intent.expires_at = (chrono::Utc::now() - chrono::Duration::seconds(1)).to_rfc3339();
        assert!(validate_intent(
            &intent,
            DecisionAction::ApproveClient,
            grant,
            &revision,
            client,
            current
        )
        .is_err());
    }
}
