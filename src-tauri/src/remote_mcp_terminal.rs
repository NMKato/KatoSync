// Created by NMKato Solutions
//! Native Prüfung einer einzelnen CLI-Profilfreigabe. Keine Shell-Freigabe.
//! Nonces, MFA-Challenges und Gerätesignaturen verlassen die native Seite nicht.
use crate::remote_mcp_device_review as device;
use crate::remote_mcp_owner_review as owner;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::Signer;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use uuid::Uuid;
use zeroize::Zeroizing;

pub(crate) const TOOL: &str = "katosync_run_terminal_profile";
pub(crate) const PROFILE: &str = "git_version";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Scope {
    pub relay_generation: u64,
    pub owner_generation: u64,
    pub owner_id: Uuid,
    pub tenant_id: Uuid,
    pub oauth_client_id: Uuid,
    pub grant_id: Uuid,
    pub device_id: Uuid,
    pub project_id: String,
    pub authority_revision: String,
    pub root: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Arguments<'a> {
    device_id: Uuid,
    operation_id: Uuid,
    profile_id: &'a str,
    project_id: &'a str,
}
#[derive(Serialize)]
struct DigestInput<'a> {
    name: &'static str,
    args: Arguments<'a>,
}

/// Gleiche Bytefolge wie rc67ArgumentsSha256, einschließlich sortierter Argumente.
pub(crate) fn arguments_sha256(device_id: Uuid, operation_id: Uuid, project_id: &str) -> String {
    let input = DigestInput {
        name: TOOL,
        args: Arguments {
            device_id,
            operation_id,
            profile_id: PROFILE,
            project_id,
        },
    };
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&input).expect("fixed profile arguments"))
    )
}
pub(crate) fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn invalid() -> String {
    "REMOTE_MCP_TERMINAL_REVIEW_CHANGED".into()
}
fn now() -> Result<u64, String> {
    owner::now_ms().try_into().map_err(|_| invalid())
}
fn same_live_scope(scope: &Scope) -> Result<(), String> {
    if crate::remote_mcp_relay::terminal_review_scope(&scope.project_id)? != *scope {
        return Err(invalid());
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Factor {
    id: Uuid,
    friendly_name: String,
    #[serde(rename = "type")]
    kind: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OperationIntent {
    version: u8,
    operation_id: Uuid,
    nonce: String,
    owner_id: Uuid,
    tenant_id: Uuid,
    oauth_client_id: Uuid,
    grant_id: Uuid,
    device_id: Uuid,
    project_id: String,
    profile_id: String,
    arguments_sha256: String,
    authority_revision: String,
    expires_at_ms: u64,
    factors: Vec<Factor>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Challenge {
    version: u8,
    operation_id: Uuid,
    factor_id: Uuid,
    auth_challenge_id: Uuid,
    expires_at_ms: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Approved {
    version: u8,
    status: String,
    operation_id: Uuid,
    arguments_sha256: String,
    expires_at_ms: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceProof<'a> {
    version: u8,
    kind: &'static str,
    owner_id: Uuid,
    tenant_id: Uuid,
    oauth_client_id: Uuid,
    grant_id: Uuid,
    device_id: Uuid,
    operation_id: Uuid,
    project_id: &'a str,
    profile_id: &'static str,
    arguments_sha256: &'a str,
    authority_revision: &'a str,
    nonce: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreparedReview {
    protocol: &'static str,
    review_id: Uuid,
    operation_id: Uuid,
    project_id: String,
    profile_id: &'static str,
    command: &'static str,
    arguments_sha256: String,
    expires_at: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApprovalReceipt {
    protocol: &'static str,
    operation_id: Uuid,
    project_id: String,
    profile_id: &'static str,
    arguments_sha256: String,
    expires_at: u64,
}
struct Pending {
    id: Uuid,
    context: owner::OwnerContext,
    scope: Scope,
    actor_session: Uuid,
    key_hash: String,
    operation_id: Uuid,
    arguments_sha256: String,
    nonce: Zeroizing<String>,
    payload: Zeroizing<String>,
    signature: String,
    factor_id: Uuid,
    challenge_id: Uuid,
    expires_at: u64,
}
struct LocalApproval {
    review_id: Uuid,
    scope: Scope,
    operation_id: Uuid,
    arguments_sha256: String,
    device_proof_sha256: String,
    expires_at: u64,
    deadline: Instant,
}
#[derive(Default)]
struct State {
    generation: u64,
    pending: Option<Pending>,
    confirming: Option<Uuid>,
    approvals: HashMap<Uuid, LocalApproval>,
}
impl State {
    fn cancel(&mut self, id: Uuid) {
        let pending_matches = self.pending.as_ref().is_some_and(|p| p.id == id);
        let confirming_matches = self.confirming == Some(id);
        if pending_matches {
            self.pending = None;
        }
        if confirming_matches {
            self.confirming = None;
        }
        // Also fence a success which arrived just before UI cancellation.
        self.approvals
            .retain(|_, approval| approval.review_id != id);
        if pending_matches || confirming_matches {
            self.generation = self.generation.wrapping_add(1);
        }
    }
    fn commit(&mut self, id: Uuid, generation: u64, approval: LocalApproval) -> Result<(), String> {
        if self.generation != generation
            || self.confirming != Some(id)
            || approval.review_id != id
            || self.approvals.contains_key(&approval.operation_id)
            || approval.scope.owner_generation != crate::native_owner_session_generation()
            || now()? >= approval.expires_at
            || Instant::now() >= approval.deadline
        {
            return Err(invalid());
        }
        self.confirming = None;
        self.approvals.insert(approval.operation_id, approval);
        Ok(())
    }
}
fn current_confirmation(id: Uuid, generation: u64) -> Result<(), String> {
    let s = state().lock().map_err(|_| invalid())?;
    if s.generation != generation || s.confirming != Some(id) {
        return Err(invalid());
    }
    Ok(())
}
struct ConfirmationLease {
    id: Uuid,
    generation: u64,
}
impl Drop for ConfirmationLease {
    fn drop(&mut self) {
        if let Ok(mut s) = state().lock() {
            if s.generation == self.generation && s.confirming == Some(self.id) {
                s.confirming = None;
            }
        }
    }
}
static STATE: OnceLock<Mutex<State>> = OnceLock::new();
fn state() -> &'static Mutex<State> {
    STATE.get_or_init(|| Mutex::new(State::default()))
}

pub(crate) fn invalidate() {
    let mut s = state().lock().unwrap_or_else(|e| e.into_inner());
    s.generation = s.generation.wrapping_add(1);
    s.pending = None;
    s.confirming = None;
    s.approvals.clear();
}
pub(crate) fn cancel_review(id: Uuid) -> Result<(), String> {
    let mut s = state().lock().map_err(|_| invalid())?;
    s.cancel(id);
    Ok(())
}
fn validate_intent(
    intent: &OperationIntent,
    scope: &Scope,
    factor: Uuid,
    clock: u64,
) -> Result<(), String> {
    let unique: std::collections::HashSet<_> = intent.factors.iter().map(|f| f.id).collect();
    if intent.version != 1
        || intent.operation_id.is_nil()
        || intent.owner_id != scope.owner_id
        || intent.tenant_id != scope.tenant_id
        || intent.oauth_client_id != scope.oauth_client_id
        || intent.grant_id != scope.grant_id
        || intent.device_id != scope.device_id
        || intent.project_id != scope.project_id
        || intent.profile_id != PROFILE
        || intent.authority_revision != scope.authority_revision
        || intent.arguments_sha256
            != arguments_sha256(scope.device_id, intent.operation_id, &scope.project_id)
        || intent.nonce.len() != 43
        || !intent
            .nonce
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        || intent.expires_at_ms <= clock
        || intent.expires_at_ms > clock.saturating_add(300_000)
        || intent.factors.is_empty()
        || intent.factors.len() > 10
        || unique.len() != intent.factors.len()
        || intent
            .factors
            .iter()
            .any(|f| f.id.is_nil() || f.kind != "totp" || f.friendly_name.len() > 80)
        || !intent.factors.iter().any(|f| f.id == factor)
    {
        return Err(invalid());
    }
    Ok(())
}

/// Erstellt eine einmalige, exakt an das aktuelle Gerät und Projekt gebundene Prüfung.
pub(crate) async fn prepare(
    project_id: String,
    factor_id: String,
) -> Result<PreparedReview, String> {
    let context = owner::context().await?;
    let scope = crate::remote_mcp_relay::terminal_review_scope(&project_id)?;
    if scope.owner_generation != context.generation || scope.owner_id.to_string() != context.uid {
        return Err(invalid());
    }
    let factor_id = Uuid::parse_str(&factor_id).map_err(|_| invalid())?;
    let generation = {
        let mut s = state().lock().map_err(|_| invalid())?;
        s.generation = s.generation.wrapping_add(1);
        s.pending = None;
        s.confirming = None;
        s.approvals
            .retain(|_, a| Instant::now() < a.deadline && a.expires_at > now().unwrap_or(u64::MAX));
        if s.approvals.len() >= 8 {
            return Err("REMOTE_MCP_TERMINAL_APPROVAL_LIMIT".into());
        }
        s.generation
    };
    let client = owner::snapshot_for(&context).await?;
    if client.allowed_tools.len() != 4
        || !client
            .allowed_tools
            .iter()
            .any(|t| t == "terminal.run_profile")
        || !client.allowed_tools.iter().any(|t| t == "git.status")
        || client
            .client_grant
            .as_ref()
            .is_none_or(|g| g.id != scope.grant_id || g.status != "approved")
        || client.target_client.id != scope.oauth_client_id
        || !client.factors.iter().any(|f| f.id == factor_id)
    {
        return Err(invalid());
    }
    let local = device::local_device(&context).await?;
    if local.id != scope.device_id {
        return Err(invalid());
    }
    let actor_session = device::actor_session(&context).await?;
    let intent: OperationIntent = serde_json::from_value(
        owner::request(
            &context,
            "/api/owner/remote-mcp/operations",
            Some(json!({"deviceId":scope.device_id,"projectId":project_id,"profileId":PROFILE})),
        )
        .await?,
    )
    .map_err(|_| invalid())?;
    validate_intent(&intent, &scope, factor_id, now()?)?;
    same_live_scope(&scope)?;
    let payload = Zeroizing::new(
        serde_json::to_string(&DeviceProof {
            version: 1,
            kind: "BETA4_NATIVE_CLI_OPERATION_ACK",
            owner_id: scope.owner_id,
            tenant_id: scope.tenant_id,
            oauth_client_id: scope.oauth_client_id,
            grant_id: scope.grant_id,
            device_id: scope.device_id,
            operation_id: intent.operation_id,
            project_id: &scope.project_id,
            profile_id: PROFILE,
            arguments_sha256: &intent.arguments_sha256,
            authority_revision: &scope.authority_revision,
            nonce: &intent.nonce,
        })
        .map_err(|_| invalid())?,
    );
    let signature = URL_SAFE_NO_PAD.encode(local.signer.sign(payload.as_bytes()).to_bytes());
    let challenge: Challenge = serde_json::from_value(
        owner::request(
            &context,
            "/api/owner/remote-mcp/operations/challenge",
            Some(
                json!({"deviceId":scope.device_id,"operationId":intent.operation_id,
            "nonce":intent.nonce,"factorId":factor_id}),
            ),
        )
        .await?,
    )
    .map_err(|_| invalid())?;
    if challenge.version != 1
        || challenge.operation_id != intent.operation_id
        || challenge.factor_id != factor_id
        || challenge.auth_challenge_id.is_nil()
        || challenge.expires_at_ms > intent.expires_at_ms
        || challenge.expires_at_ms <= now()?
    {
        return Err(invalid());
    }
    owner::recheck(&context).await?;
    same_live_scope(&scope)?;
    let id = Uuid::new_v4();
    let review = PreparedReview {
        protocol: "katosync-remote-mcp-terminal-review-v1",
        review_id: id,
        operation_id: intent.operation_id,
        project_id: scope.project_id.clone(),
        profile_id: PROFILE,
        command: "git --version",
        arguments_sha256: intent.arguments_sha256.clone(),
        expires_at: challenge.expires_at_ms,
    };
    let mut s = state().lock().map_err(|_| invalid())?;
    if s.generation != generation {
        return Err("REMOTE_MCP_OWNER_CANCELLED".into());
    }
    owner::check_generation(&context)?;
    s.pending = Some(Pending {
        id,
        context,
        scope,
        actor_session,
        key_hash: local.hash,
        operation_id: intent.operation_id,
        arguments_sha256: intent.arguments_sha256,
        nonce: Zeroizing::new(intent.nonce),
        payload,
        signature,
        factor_id,
        challenge_id: challenge.auth_challenge_id,
        expires_at: challenge.expires_at_ms,
    });
    Ok(review)
}

/// Der eingegebene Code wird nur an den bereits gebundenen GoTrue-Challenge gesendet.
pub(crate) async fn confirm(review_id: String, code: String) -> Result<ApprovalReceipt, String> {
    let code = Zeroizing::new(code);
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err("REMOTE_MCP_OWNER_MFA_INVALID_CODE".into());
    }
    let id = Uuid::parse_str(&review_id).map_err(|_| invalid())?;
    let (pending, generation) = {
        let mut s = state().lock().map_err(|_| invalid())?;
        if !s.pending.as_ref().is_some_and(|p| p.id == id) {
            return Err("REMOTE_MCP_OWNER_REVIEW_EXPIRED".into());
        }
        let pending = s.pending.take().ok_or_else(invalid)?;
        s.confirming = Some(id);
        (pending, s.generation)
    };
    let _confirmation = ConfirmationLease { id, generation };
    if pending.expires_at <= now()? {
        return Err("REMOTE_MCP_OWNER_REVIEW_EXPIRED".into());
    }
    owner::recheck(&pending.context).await?;
    same_live_scope(&pending.scope)?;
    if device::actor_session(&pending.context).await? != pending.actor_session {
        return Err(invalid());
    }
    let local = device::local_device(&pending.context).await?;
    if local.id != pending.scope.device_id || local.hash != pending.key_hash {
        return Err(invalid());
    }
    current_confirmation(id, generation)?;
    crate::verify_remote_mcp_totp_native(
        &pending.factor_id.to_string(),
        &pending.challenge_id.to_string(),
        code.as_str(),
    )
    .await?;
    owner::recheck(&pending.context).await?;
    same_live_scope(&pending.scope)?;
    if pending.expires_at <= now()?
        || device::actor_session(&pending.context).await? != pending.actor_session
    {
        return Err("REMOTE_MCP_OWNER_REVIEW_EXPIRED".into());
    }
    let current = device::local_device(&pending.context).await?;
    if current.id != pending.scope.device_id || current.hash != pending.key_hash {
        return Err(invalid());
    }
    current_confirmation(id, generation)?;
    let approved: Approved = serde_json::from_value(owner::request(&pending.context,
        "/api/owner/remote-mcp/operations/approve",
        Some(json!({"deviceId":pending.scope.device_id,"operationId":pending.operation_id,
            "nonce":pending.nonce.as_str(),"factorId":pending.factor_id,"authChallengeId":pending.challenge_id,
            "deviceProof":{"payload":pending.payload.as_str(),"signature":pending.signature}})))
        .await?).map_err(|_| invalid())?;
    let clock = now()?;
    if approved.version != 1
        || approved.status != "approved"
        || approved.operation_id != pending.operation_id
        || approved.arguments_sha256 != pending.arguments_sha256
        || approved.expires_at_ms <= clock
        || approved.expires_at_ms > clock.saturating_add(60_000)
    {
        return Err(invalid());
    }
    owner::recheck(&pending.context).await?;
    same_live_scope(&pending.scope)?;
    let receipt = ApprovalReceipt {
        protocol: "katosync-remote-mcp-terminal-approval-v1",
        operation_id: pending.operation_id,
        project_id: pending.scope.project_id.clone(),
        profile_id: PROFILE,
        arguments_sha256: pending.arguments_sha256.clone(),
        expires_at: approved.expires_at_ms,
    };
    owner::check_generation(&pending.context)?;
    let remaining = approved
        .expires_at_ms
        .checked_sub(now()?)
        .filter(|n| *n > 0)
        .ok_or_else(invalid)?;
    state().lock().map_err(|_| invalid())?.commit(
        id,
        generation,
        LocalApproval {
            review_id: id,
            scope: pending.scope,
            operation_id: pending.operation_id,
            arguments_sha256: pending.arguments_sha256,
            device_proof_sha256: format!("{:x}", Sha256::digest(pending.payload.as_bytes())),
            expires_at: approved.expires_at_ms,
            deadline: Instant::now() + Duration::from_millis(remaining),
        },
    )?;
    Ok(receipt)
}

pub(crate) struct DispatchConsent<'a> {
    pub operation_id: Uuid,
    pub arguments_sha256: &'a str,
    pub device_proof_sha256: &'a str,
    pub approval_expires_at: u64,
}
/// Entfernt die lokale Zustimmung atomar VOR jedem Prozessstart, auch bei Fehlern.
pub(crate) fn consume(
    scope: &Scope,
    claim: &DispatchConsent<'_>,
    clock: u64,
) -> Result<(), String> {
    let mut s = state().lock().map_err(|_| invalid())?;
    let approval = s
        .approvals
        .remove(&claim.operation_id)
        .ok_or("REMOTE_MCP_TERMINAL_LOCAL_APPROVAL_REQUIRED")?;
    if approval.scope != *scope
        || approval.operation_id != claim.operation_id
        || approval.arguments_sha256 != claim.arguments_sha256
        || approval.device_proof_sha256 != claim.device_proof_sha256
        || approval.expires_at != claim.approval_expires_at
        || clock >= approval.expires_at
        || Instant::now() >= approval.deadline
        || scope.owner_generation != crate::native_owner_session_generation()
    {
        return Err("REMOTE_MCP_TERMINAL_LOCAL_APPROVAL_REQUIRED".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scope() -> Scope {
        Scope {
            relay_generation: 7,
            owner_generation: crate::native_owner_session_generation(),
            owner_id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            oauth_client_id: Uuid::new_v4(),
            grant_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            project_id: "katosync".into(),
            authority_revision: "ab".repeat(32),
            root: std::env::temp_dir(),
        }
    }
    fn insert(scope: Scope, operation: Uuid, clock: u64) -> (String, String) {
        let args = arguments_sha256(scope.device_id, operation, &scope.project_id);
        let proof = "cd".repeat(32);
        state().lock().unwrap().approvals.insert(
            operation,
            LocalApproval {
                review_id: Uuid::new_v4(),
                scope,
                operation_id: operation,
                arguments_sha256: args.clone(),
                device_proof_sha256: proof.clone(),
                expires_at: clock + 60_000,
                deadline: Instant::now() + Duration::from_secs(60),
            },
        );
        (args, proof)
    }
    #[test]
    fn local_approval_is_single_use_and_changed_authority_consumes_without_running() {
        let clock = 1_800_000_000_000;
        let original = scope();
        let operation = Uuid::new_v4();
        let (args, proof) = insert(original.clone(), operation, clock);
        let claim = DispatchConsent {
            operation_id: operation,
            arguments_sha256: &args,
            device_proof_sha256: &proof,
            approval_expires_at: clock + 60000,
        };
        assert!(consume(&original, &claim, clock).is_ok());
        assert!(consume(&original, &claim, clock).is_err());
        let operation = Uuid::new_v4();
        let (args, proof) = insert(original.clone(), operation, clock);
        let claim = DispatchConsent {
            operation_id: operation,
            arguments_sha256: &args,
            device_proof_sha256: &proof,
            approval_expires_at: clock + 60000,
        };
        let mut changed = original.clone();
        changed.root = changed.root.join("different");
        assert!(consume(&changed, &claim, clock).is_err());
        assert!(consume(&original, &claim, clock).is_err());
    }
    #[test]
    fn local_approval_rejects_expiry_proof_and_connection_replacement() {
        let clock = 1_800_000_000_000;
        for case in 0..4 {
            let original = scope();
            let operation = Uuid::new_v4();
            let (args, proof) = insert(original.clone(), operation, clock);
            let mut changed = original.clone();
            let wrong = "ef".repeat(32);
            if case == 2 {
                changed.relay_generation += 1;
            }
            if case == 3 {
                changed.authority_revision = wrong.clone();
            }
            let claim = DispatchConsent {
                operation_id: operation,
                arguments_sha256: &args,
                device_proof_sha256: if case == 1 { &wrong } else { &proof },
                approval_expires_at: clock + 60000,
            };
            assert!(consume(
                &changed,
                &claim,
                if case == 0 { clock + 60000 } else { clock }
            )
            .is_err());
            assert!(consume(&original, &claim, clock).is_err());
        }
    }

    #[test]
    fn connector_operation_ack_and_arguments_are_byte_identical() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/beta4_terminal_profile_wire.json"
        ))
        .unwrap();
        let intent: OperationIntent = serde_json::from_value(fixture["operation"].clone()).unwrap();
        let scope = Scope {
            relay_generation: 7,
            owner_generation: crate::native_owner_session_generation(),
            owner_id: intent.owner_id,
            tenant_id: intent.tenant_id,
            oauth_client_id: intent.oauth_client_id,
            grant_id: intent.grant_id,
            device_id: intent.device_id,
            project_id: intent.project_id.clone(),
            authority_revision: intent.authority_revision.clone(),
            root: std::env::temp_dir(),
        };
        validate_intent(
            &intent,
            &scope,
            intent.factors[0].id,
            fixture["nowMs"].as_u64().unwrap(),
        )
        .unwrap();
        assert_eq!(
            arguments_sha256(scope.device_id, intent.operation_id, &scope.project_id),
            intent.arguments_sha256
        );
        let payload = serde_json::to_string(&DeviceProof {
            version: 1,
            kind: "BETA4_NATIVE_CLI_OPERATION_ACK",
            owner_id: scope.owner_id,
            tenant_id: scope.tenant_id,
            oauth_client_id: scope.oauth_client_id,
            grant_id: scope.grant_id,
            device_id: scope.device_id,
            operation_id: intent.operation_id,
            project_id: &scope.project_id,
            profile_id: PROFILE,
            arguments_sha256: &intent.arguments_sha256,
            authority_revision: &scope.authority_revision,
            nonce: &intent.nonce,
        })
        .unwrap();
        assert_eq!(payload, fixture["deviceProof"]["payload"].as_str().unwrap());
        assert_eq!(
            format!("{:x}", Sha256::digest(payload.as_bytes())),
            fixture["deviceProofSha256"].as_str().unwrap()
        );
        let key = ed25519_dalek::SigningKey::from_bytes(
            &[fixture["deviceSeedByte"].as_u64().unwrap() as u8; 32],
        );
        assert_eq!(
            URL_SAFE_NO_PAD.encode(key.sign(payload.as_bytes()).to_bytes()),
            fixture["deviceProof"]["signature"].as_str().unwrap()
        );
        let approved: Approved =
            serde_json::from_value(fixture["approvalResponse"].clone()).unwrap();
        assert_eq!(approved.operation_id, intent.operation_id);
        assert_eq!(
            approved.expires_at_ms,
            fixture["approvalPayload"]["expiresAtMs"].as_u64().unwrap()
        );
    }

    fn approval_for_test(review_id: Uuid, operation_id: Uuid) -> LocalApproval {
        LocalApproval {
            review_id,
            scope: scope(),
            operation_id,
            arguments_sha256: "ab".repeat(32),
            device_proof_sha256: "cd".repeat(32),
            expires_at: now().unwrap() + 60_000,
            deadline: Instant::now() + Duration::from_secs(60),
        }
    }
    #[test]
    fn cancel_in_flight_confirmation_fences_late_success_without_canceling_a_new_review() {
        let review = Uuid::new_v4();
        let operation = Uuid::new_v4();
        // confirm has consumed Pending, while the bound network operation is in flight.
        let mut s = State {
            generation: 7,
            confirming: Some(review),
            ..State::default()
        };
        s.cancel(review);
        assert!(s
            .commit(review, 7, approval_for_test(review, operation))
            .is_err());
        assert!(!s.approvals.contains_key(&operation));
        let new_review = Uuid::new_v4();
        let new_operation = Uuid::new_v4();
        s.confirming = Some(new_review);
        let new_generation = s.generation;
        s.cancel(review);
        assert_eq!(s.generation, new_generation);
        s.commit(
            new_review,
            new_generation,
            approval_for_test(new_review, new_operation),
        )
        .unwrap();
        // A cancellation racing just after server success removes only its own receipt.
        s.cancel(review);
        assert!(s.approvals.contains_key(&new_operation));
        s.cancel(new_review);
        assert!(!s.approvals.contains_key(&new_operation));
    }
}
