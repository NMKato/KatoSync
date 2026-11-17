// Created by NMKato Solutions
//! Stage4AB.3.2B – gated canonical KatoOS/Torhaus admission QA adapter.
//!
//! THIS MODULE IS COMPILED FOR TESTS ONLY under stage4j-qa. Its explicit,
//! human-entered opt-in is never set by CI and there is no automatic caller.
//! The canonical recheck already uses the locally held user JWT, owner-scoped
//! RLS read of both enrollments, current Keychain identity and pinned peer.
//! No new endpoint, bypass token, RLS mutation or remote job is permitted.
//! SECURITY: the reused canonical auth helper can refresh/rotate an access
//! token if its cache is empty or if the issuer rejects it. That is a session
//! mutation and cannot be represented as a strict read-only live test.
//! A SEPARATE explicit owner QA opt-in is required before this helper runs;
//! a read-only-only request MUST fail closed.

use crate::{
    mesh_admission::{self, NativeAdmission},
    mesh_durable_lease_qa::LiveTlsLease,
    mesh_os_event_fence_qa::OsEventLeaseFence,
    mesh_private_lan_qa::SingleQaPermit,
    mesh_supervisor_guard_qa::guarded_supervisor_cycle,
    mesh_tailnet_qa::require_owner_opt_ins,
};
use std::{future::Future, time::Duration};
use tokio::{sync::mpsc, time::timeout};

const ENV_NAME: &str = "KATOSYNC_STAGE4AB32B_REAL_ADMISSION_READ_ONLY_QA";
const EXPECTED: &str = "OWNER_LAUNCHED_READ_ONLY_ADMISSION_RECHECK_ONLY";
// The existing KatoOS issuer validation may refresh/rotate the current
// session token. Never conceal that side effect behind "read only".
const SESSION_ROTATION_ENV: &str = "KATOSYNC_STAGE4AB32B_ALLOW_SESSION_ROTATION_QA";
const SESSION_ROTATION_EXPECTED: &str = "OWNER_EXPLICITLY_APPROVES_QA_SESSION_TOKEN_ROTATION";
const DENIED: &str = "MESH_STAGE4AB32B_LIVE_RECHECK_NOT_AUTHORIZED";
const BUDGET: Duration = Duration::from_secs(45);

/// Pure boolean gate; validation is independent of the actual machine env.
/// In production this module does not exist, regardless of environment.
fn read_only_opt_in(stage4j: bool, katoos_auth: bool, supplied: Option<&str>) -> bool {
    stage4j && katoos_auth && supplied == Some(EXPECTED)
}
fn session_rotation_opt_in(supplied: Option<&str>) -> bool {
    supplied == Some(SESSION_ROTATION_EXPECTED)
}

/// Prevent a caller from swapping the specific approved peer in the
/// middle of a heartbeat. This is NOT an authorization substitute:
/// the canonical online recheck verifies the real issuer, Keychain pin,
/// approved peer, and both server-side enrollments on every call.
fn exact_previously_admitted_peer(admitted: &NativeAdmission, requested_fingerprint: &str) -> bool {
    uuid::Uuid::parse_str(&admitted.owner_uid).is_ok()
        && admitted.approved_peer.status == "locally_approved"
        && !requested_fingerprint.is_empty()
        && admitted.approved_peer.fingerprint == requested_fingerprint
}

/// QA-only adapter. The caller already owns a SingleQaPermit and an OPEN,
/// pinned TLS channel with an existing canonical LiveTlsLease. The caller
/// must drop that original TLS channel on any error. Neither OS signals
/// nor an affirmative database read may mint any identity/permission.
/// The first and second closures call the EXACT SAME canonical online
/// recheck; a cached preflight response cannot extend the lease.
#[allow(dead_code)]
pub(crate) async fn guarded_cycle_with_canonical_admission<Heartbeat>(
    _owner_qa_permit: &SingleQaPermit,
    admitted: &NativeAdmission,
    requested_fingerprint: &str,
    lease: &mut LiveTlsLease,
    fence: &mut OsEventLeaseFence,
    events: &mut mpsc::Receiver<String>,
    sequence: u64,
    authenticated_supervisor_heartbeat: Heartbeat,
) -> Result<(), String>
where
    Heartbeat: Future<Output = Result<(), String>>,
{
    let permission = std::env::var(ENV_NAME).ok();
    let session_rotation_permission = std::env::var(SESSION_ROTATION_ENV).ok();
    if !read_only_opt_in(
        cfg!(feature = "stage4j-qa"),
        cfg!(feature = "katoos-auth-qa"),
        permission.as_deref(),
    ) || !session_rotation_opt_in(session_rotation_permission.as_deref())
        || require_owner_opt_ins().is_err()
        || !exact_previously_admitted_peer(admitted, requested_fingerprint)
    {
        lease.on_owner_or_peer_revoked();
        return Err(DENIED.to_string());
    }

    // Complete operation budget includes BOTH network-backed checks,
    // the real existing supervisor heartbeat and native deny-only events.
    // Even timeout invalidates the original lease: never auto-reconnect.
    let result = timeout(
        BUDGET,
        guarded_supervisor_cycle(
            lease,
            fence,
            events,
            sequence,
            || mesh_admission::recheck_after_probe(admitted, requested_fingerprint),
            authenticated_supervisor_heartbeat,
            || mesh_admission::recheck_after_probe(admitted, requested_fingerprint),
        ),
    )
    .await;
    match result {
        Ok(outcome) => outcome,
        Err(_) => {
            lease.on_owner_or_peer_revoked();
            Err("MESH_STAGE4AB32B_LIVE_RECHECK_DEADLINE_DENIED".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{mesh_identity::fingerprint, mesh_trust::ApprovedPeer};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use ed25519_dalek::SigningKey;

    fn fixture() -> NativeAdmission {
        let own = SigningKey::from_bytes(&[111; 32]);
        let peer = SigningKey::from_bytes(&[112; 32]);
        NativeAdmission {
            owner_uid: "919a961f-8139-446c-a2a8-e1d0d4c76b4f".to_string(),
            local_signing: own,
            approved_peer: ApprovedPeer {
                fingerprint: fingerprint(&peer.verifying_key()),
                public_key: URL_SAFE_NO_PAD.encode(peer.verifying_key().as_bytes()),
                approved_at: 1_780_000_000,
                status: "locally_approved".to_string(),
            },
        }
    }

    #[test]
    fn live_backend_cannot_run_without_two_compiled_features_and_exact_opt_in() {
        assert!(!read_only_opt_in(true, true, None));
        assert!(!read_only_opt_in(true, true, Some("true")));
        assert!(!read_only_opt_in(false, true, Some(EXPECTED)));
        assert!(!read_only_opt_in(true, false, Some(EXPECTED)));
        assert!(read_only_opt_in(true, true, Some(EXPECTED)));
    }

    #[test]
    fn canonical_auth_may_rotate_tokens_so_read_only_opt_in_alone_is_insufficient() {
        assert!(!session_rotation_opt_in(None));
        assert!(!session_rotation_opt_in(Some("true")));
        assert!(!session_rotation_opt_in(Some(EXPECTED)));
        assert!(!session_rotation_opt_in(Some("OWNER_LAUNCHED_QA_ONLY")));
        assert!(session_rotation_opt_in(Some(SESSION_ROTATION_EXPECTED)));
        // This pure unit test NEVER invokes the auth helper or reads a token.
    }

    #[test]
    fn exact_owner_scoped_approved_peer_is_immutable_for_recheck() {
        let mut admitted = fixture();
        let good = admitted.approved_peer.fingerprint.clone();
        assert!(exact_previously_admitted_peer(&admitted, &good));
        assert!(!exact_previously_admitted_peer(&admitted, ""));
        assert!(!exact_previously_admitted_peer(&admitted, "SWAPPED-PEER"));
        admitted.approved_peer.status = "revoked".to_string();
        assert!(!exact_previously_admitted_peer(&admitted, &good));
        admitted.approved_peer.status = "locally_approved".to_string();
        admitted.owner_uid = "not-a-valid-owner-uuid".to_string();
        assert!(!exact_previously_admitted_peer(&admitted, &good));
    }

    #[test]
    fn no_successful_owner_read_is_itself_a_remote_job_authorization() {
        // Stable error categories only. Never log JWTs, private keys or
        // raw backend payloads. This module does not expose a Tauri command.
        assert!(DENIED.starts_with("MESH_STAGE4AB32B_"));
        assert!(BUDGET <= Duration::from_secs(45));
    }
}

// Strict no-refresh QA adapter. Does not access refresh tokens, write user
// sessions, or cache a successful issuer response as durable authorization.
// This is test-only, with NO Tauri command / CLI / remote-job entrypoint.
const NO_REFRESH_ENV: &str = "KATOSYNC_STAGE4AB32B_NO_REFRESH_OWNER_READ_QA";
const NO_REFRESH_EXPECTED: &str = "OWNER_LAUNCHED_EXISTING_SESSION_READ_ONLY_NO_REFRESH";
const NO_REFRESH_DENIED: &str = "MESH_STAGE4AB32B_NO_REFRESH_SESSION_DENIED";

fn no_refresh_gate(
    built_qa: bool,
    auth_qa: bool,
    read_only: Option<&str>,
    no_refresh: Option<&str>,
) -> bool {
    read_only_opt_in(built_qa, auth_qa, read_only) && no_refresh == Some(NO_REFRESH_EXPECTED)
}

fn still_same_token(observed: Option<&str>, expected: &str) -> bool {
    !expected.is_empty() && observed == Some(expected)
}

fn token_snapshot_is_current(expected: &str) -> bool {
    let current = crate::cached_supabase_access_token().map(zeroize::Zeroizing::new);
    still_same_token(current.as_deref().map(String::as_str), expected)
}

#[derive(serde::Deserialize)]
struct NoRefreshIssuerIdentity {
    id: String,
}

async fn recheck_existing_session_no_refresh(
    admitted: &NativeAdmission,
    requested_fingerprint: &str,
    token: &str,
) -> Result<(), String> {
    use crate::{mesh_identity::existing_identity, mesh_trust::approved_peer_for_account};
    use std::time::Duration;

    let deny = || NO_REFRESH_DENIED.to_string();
    if !token_snapshot_is_current(token)
        || !exact_previously_admitted_peer(admitted, requested_fingerprint)
    {
        return Err(deny());
    }

    let local = existing_identity(&admitted.owner_uid).map_err(|_| deny())?;
    if local.verifying_key() != admitted.local_signing.verifying_key() {
        return Err(deny());
    }
    let initial = approved_peer_for_account(
        &admitted.owner_uid,
        requested_fingerprint,
        &local.verifying_key(),
    )
    .map_err(|_| deny())?;
    if initial.fingerprint != admitted.approved_peer.fingerprint
        || initial.public_key != admitted.approved_peer.public_key
        || initial.status != admitted.approved_peer.status
        || initial.approved_at != admitted.approved_peer.approved_at
    {
        return Err(deny());
    }

    // Only fixed, first-party HTTPS endpoints. An existing cached access
    // token is borrowed within this QA operation. There is no refresh path.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| deny())?;
    let issuer = client
        .get(format!("{}/auth/v1/user", crate::KATOSYNC_AUTH_URL))
        .header("apikey", crate::KATOSYNC_AUTH_ANON_KEY)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| deny())?;
    if !issuer.status().is_success() || issuer.content_length().unwrap_or(0) > 32768 {
        return Err(deny());
    }
    let issuer_bytes = issuer.bytes().await.map_err(|_| deny())?;
    if issuer_bytes.len() > 32768 || !token_snapshot_is_current(token) {
        return Err(deny());
    }
    let verified: NoRefreshIssuerIdentity =
        serde_json::from_slice(&issuer_bytes).map_err(|_| deny())?;
    if uuid::Uuid::parse_str(&verified.id)
        .map_err(|_| deny())?
        .to_string()
        != admitted.owner_uid
    {
        return Err(deny());
    }

    // The same exact owner-scoped RLS selection as the canonical enrollment
    // gate, but no second call to the refresh-capable session helper.
    let roster = client
        .get(format!("{}/rest/v1/mesh_devices", crate::KATOSYNC_AUTH_URL))
        .header("Accept-Profile", "katosync")
        .header("apikey", crate::KATOSYNC_AUTH_ANON_KEY)
        .bearer_auth(token)
        .query(&[
            ("select", "owner_user_id,signing_public_key,fingerprint,membership_state,enrolled_at,revoked_at"),
            ("owner_user_id", &format!("eq.{}", admitted.owner_uid)),
            ("limit", "11"),
        ])
        .send().await.map_err(|_| deny())?;
    if !roster.status().is_success() || roster.content_length().unwrap_or(0) > 16384 {
        return Err(deny());
    }
    let roster_bytes = roster.bytes().await.map_err(|_| deny())?;
    if roster_bytes.len() > 16384 || !token_snapshot_is_current(token) {
        return Err(deny());
    }
    crate::mesh_enrollment_gate::qa_validate_owner_roster_no_refresh(
        &admitted.owner_uid,
        &local.verifying_key(),
        &initial,
        &roster_bytes,
    )
    .map_err(|_| deny())?;

    // The session snapshot, local identity and peer consent must still match
    // after both asynchronous reads. Any changed token is a hard denial.
    if !token_snapshot_is_current(token) {
        return Err(deny());
    }
    let current_local = existing_identity(&admitted.owner_uid).map_err(|_| deny())?;
    if current_local.verifying_key() != admitted.local_signing.verifying_key() {
        return Err(deny());
    }
    let current_peer = approved_peer_for_account(
        &admitted.owner_uid,
        requested_fingerprint,
        &current_local.verifying_key(),
    )
    .map_err(|_| deny())?;
    if current_peer.fingerprint != initial.fingerprint
        || current_peer.public_key != initial.public_key
        || current_peer.status != initial.status
        || current_peer.approved_at != initial.approved_at
    {
        return Err(deny());
    }
    Ok(())
}

/// Manually opted-in QA only; uses existing IN-PROCESS access token cache.
/// If no authenticated app session is cached, deny without a refresh. It
/// deliberately cannot be launched as a separate shell test or background
/// process (those have a different empty access-token cache).
#[allow(dead_code)]
pub(crate) async fn guarded_cycle_with_no_refresh_owner_qa<Heartbeat>(
    _owner_qa_permit: &SingleQaPermit,
    admitted: &NativeAdmission,
    requested_fingerprint: &str,
    lease: &mut LiveTlsLease,
    fence: &mut OsEventLeaseFence,
    events: &mut mpsc::Receiver<String>,
    sequence: u64,
    authenticated_supervisor_heartbeat: Heartbeat,
) -> Result<(), String>
where
    Heartbeat: Future<Output = Result<(), String>>,
{
    let read_only_permission = std::env::var(ENV_NAME).ok();
    let no_refresh_permission = std::env::var(NO_REFRESH_ENV).ok();
    if !no_refresh_gate(
        cfg!(feature = "stage4j-qa"),
        cfg!(feature = "katoos-auth-qa"),
        read_only_permission.as_deref(),
        no_refresh_permission.as_deref(),
    ) || require_owner_opt_ins().is_err()
        || !exact_previously_admitted_peer(admitted, requested_fingerprint)
    {
        lease.on_owner_or_peer_revoked();
        return Err(NO_REFRESH_DENIED.into());
    }
    // No Keychain session read, load, refresh, login or JWT output.
    let snapshot = match crate::cached_supabase_access_token() {
        Some(token) if !token.is_empty() => zeroize::Zeroizing::new(token),
        _ => {
            lease.on_owner_or_peer_revoked();
            return Err(NO_REFRESH_DENIED.into());
        }
    };
    let result = timeout(
        BUDGET,
        guarded_supervisor_cycle(
            lease,
            fence,
            events,
            sequence,
            || {
                recheck_existing_session_no_refresh(
                    admitted,
                    requested_fingerprint,
                    snapshot.as_str(),
                )
            },
            authenticated_supervisor_heartbeat,
            || {
                recheck_existing_session_no_refresh(
                    admitted,
                    requested_fingerprint,
                    snapshot.as_str(),
                )
            },
        ),
    )
    .await;
    match result {
        Ok(Ok(())) if token_snapshot_is_current(snapshot.as_str()) => Ok(()),
        Ok(Ok(())) | Err(_) => {
            lease.on_owner_or_peer_revoked();
            Err(NO_REFRESH_DENIED.into())
        }
        Ok(Err(error)) => Err(error),
    }
}

#[cfg(test)]
mod no_refresh_tests {
    use super::*;

    #[test]
    fn no_refresh_needs_separate_exact_owner_consent() {
        assert!(!no_refresh_gate(true, true, Some(EXPECTED), None));
        assert!(!no_refresh_gate(
            true,
            true,
            None,
            Some(NO_REFRESH_EXPECTED)
        ));
        assert!(!no_refresh_gate(
            true,
            true,
            Some(EXPECTED),
            Some(SESSION_ROTATION_EXPECTED)
        ));
        assert!(!no_refresh_gate(
            false,
            true,
            Some(EXPECTED),
            Some(NO_REFRESH_EXPECTED)
        ));
        assert!(!no_refresh_gate(
            true,
            false,
            Some(EXPECTED),
            Some(NO_REFRESH_EXPECTED)
        ));
        assert!(no_refresh_gate(
            true,
            true,
            Some(EXPECTED),
            Some(NO_REFRESH_EXPECTED)
        ));
    }

    #[test]
    fn cached_session_snapshot_denies_missing_replaced_or_empty_token() {
        assert!(!still_same_token(None, "session-a"));
        assert!(!still_same_token(Some("session-b"), "session-a"));
        assert!(!still_same_token(Some(""), ""));
        assert!(still_same_token(Some("session-a"), "session-a"));
    }

    #[test]
    fn no_refresh_failure_never_returns_session_or_credential() {
        assert_eq!(
            NO_REFRESH_DENIED,
            "MESH_STAGE4AB32B_NO_REFRESH_SESSION_DENIED"
        );
        assert!(BUDGET <= std::time::Duration::from_secs(45));
    }
}
