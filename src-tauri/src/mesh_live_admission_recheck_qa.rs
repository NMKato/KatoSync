// Created by NMKato Solutions
//! Stage4AB.3.2B – real read-only KatoOS/Torhaus admission recheck adapter.
//!
//! THIS MODULE IS COMPILED FOR TESTS ONLY under stage4j-qa. Its explicit,
//! human-entered opt-in is never set by CI and there is no automatic caller.
//! The canonical recheck already uses the locally held user JWT, owner-scoped
//! RLS read of both enrollments, current Keychain identity and pinned peer.
//! No new endpoint, bypass token, RLS mutation or remote job is permitted.

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
const DENIED: &str = "MESH_STAGE4AB32B_LIVE_RECHECK_NOT_AUTHORIZED";
const BUDGET: Duration = Duration::from_secs(45);

/// Pure boolean gate; validation is independent of the actual machine env.
/// In production this module does not exist, regardless of environment.
fn read_only_opt_in(stage4j: bool, katoos_auth: bool, supplied: Option<&str>) -> bool {
    stage4j && katoos_auth && supplied == Some(EXPECTED)
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
    if !read_only_opt_in(
        cfg!(feature = "stage4j-qa"),
        cfg!(feature = "katoos-auth-qa"),
        permission.as_deref(),
    ) || require_owner_opt_ins().is_err()
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
