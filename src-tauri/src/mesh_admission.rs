// Created by NMKato Solutions
//! Mesh Stage 2D: native-only, owner-scoped admission for a one-shot pinned
//! mTLS probe. UI fields and network discovery never grant peer trust.
//!
//! Only a manually invoked, read-only QA preflight is exposed to Tauri.
//! No socket listener, transport, remote dispatch, session persistence
//! or writer authorization is enabled.

use crate::{
    mesh_enrollment_gate::require_both_devices_enrolled,
    mesh_identity::{existing_identity, same_account_still_verified},
    mesh_tls::DeviceTlsIdentity,
    mesh_transport,
    mesh_trust::{approved_peer_for_account, ApprovedPeer},
};
use ed25519_dalek::SigningKey;
use serde::Serialize;
use tokio::net::TcpStream;

struct NativeAdmission {
    owner_uid: String,
    local_signing: SigningKey,
    approved_peer: ApprovedPeer,
}

fn qa_build_enabled() -> Result<(), &'static str> {
    if cfg!(feature = "katoos-auth-qa") {
        Ok(())
    } else {
        Err("MESH_ADMISSION_NOT_CONFIGURED")
    }
}

fn approval_unchanged(before: &ApprovedPeer, after: &ApprovedPeer) -> bool {
    before.fingerprint == after.fingerprint
        && before.public_key == after.public_key
        && before.approved_at == after.approved_at
        && before.status == after.status
}

async fn authorize(requested_fingerprint: &str) -> Result<NativeAdmission, String> {
    // Stage 2D is isolated to the explicit KATOOS Auth QA build. A stable
    // binary must not treat an unrelated legacy issuer as a Mesh owner.
    qa_build_enabled().map_err(str::to_string)?;
    // Canonical issuer identity is checked online; failure denies admission.
    let uid = crate::github_app_auth::verified_katosync_user()
        .await
        .map_err(|_| "MESH_ADMISSION_LOGIN_REQUIRED".to_string())?;

    // This is a read-only load. A missing local key must NOT be generated
    // by a transport request or accidentally overwrite a device identity.
    let signing =
        existing_identity(&uid).map_err(|_| "MESH_ADMISSION_LOCAL_IDENTITY_MISSING".to_string())?;
    let peer = approved_peer_for_account(&uid, requested_fingerprint, &signing.verifying_key())
        .map_err(|_| "MESH_ADMISSION_PEER_NOT_APPROVED".to_string())?;

    // Server-side registry must independently show both exact Ed25519 keys
    // under the verified owner, neither revoked. Discovery never grants trust.
    require_both_devices_enrolled(&uid, &signing.verifying_key(), &peer)
        .await
        .map_err(|_| "MESH_ADMISSION_ENROLLMENT_REQUIRED".to_string())?;
    same_account_still_verified(&uid)
        .await
        .map_err(|_| "MESH_ADMISSION_ACCOUNT_CHANGED".to_string())?;
    // No cached UI inventory is trusted after the issuer check.
    let current = approved_peer_for_account(&uid, requested_fingerprint, &signing.verifying_key())
        .map_err(|_| "MESH_ADMISSION_PEER_REVOKED".to_string())?;
    if !approval_unchanged(&peer, &current) {
        return Err("MESH_ADMISSION_PEER_CHANGED".into());
    }
    Ok(NativeAdmission {
        owner_uid: uid,
        local_signing: signing,
        approved_peer: current,
    })
}

async fn recheck_after_probe(
    admitted: &NativeAdmission,
    requested_fingerprint: &str,
) -> Result<(), String> {
    same_account_still_verified(&admitted.owner_uid)
        .await
        .map_err(|_| "MESH_ADMISSION_ACCOUNT_CHANGED".to_string())?;
    // A rotated/replaced local Keychain identity invalidates this probe.
    let live_signing = existing_identity(&admitted.owner_uid)
        .map_err(|_| "MESH_ADMISSION_LOCAL_IDENTITY_CHANGED".to_string())?;
    if live_signing.verifying_key() != admitted.local_signing.verifying_key() {
        return Err("MESH_ADMISSION_LOCAL_IDENTITY_CHANGED".into());
    }
    let fresh = approved_peer_for_account(
        &admitted.owner_uid,
        requested_fingerprint,
        &admitted.local_signing.verifying_key(),
    )
    .map_err(|_| "MESH_ADMISSION_PEER_REVOKED".to_string())?;
    if !approval_unchanged(&admitted.approved_peer, &fresh) {
        return Err("MESH_ADMISSION_PEER_CHANGED".into());
    }
    // Verify neither endpoint was de-registered while the one-shot TLS probe
    // was in flight. A persistent session still needs a revocation watcher.
    require_both_devices_enrolled(&admitted.owner_uid, &live_signing.verifying_key(), &fresh)
        .await
        .map_err(|_| "MESH_ADMISSION_ENROLLMENT_REVOKED".to_string())
}

/// Stage4I: explicit UI-triggered, READ-ONLY admission preflight.
/// A positive result authorizes NO trust, socket, remote job or durable
/// connection: it only indicates the existing QA admission predicates passed
/// at the moment of the check. Results must expire when the account, roster
/// or local Keychain approval changes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePeerPreflight {
    protocol: &'static str,
    admission_eligible: bool,
    paired: bool,
    transport_ready: bool,
    remote_jobs_enabled: bool,
    verified_peers: u8,
}

fn exact_public_fingerprint(value: &str) -> bool {
    value.len() == 47
        && value.bytes().enumerate().all(|(index, byte)| {
            if index % 3 == 2 {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit() && !byte.is_ascii_lowercase()
            }
        })
}

fn diagnostic_preflight_result() -> NativePeerPreflight {
    NativePeerPreflight {
        protocol: "katosync-mesh-native-peer-preflight-v1",
        admission_eligible: true,
        paired: false,
        transport_ready: false,
        remote_jobs_enabled: false,
        verified_peers: 0,
    }
}

#[tauri::command]
pub async fn mesh_native_peer_preflight(
    requested_fingerprint: String,
) -> Result<NativePeerPreflight, String> {
    // No peer is trusted merely because a public inventory row exists.
    if !exact_public_fingerprint(&requested_fingerprint) {
        return Err("MESH_PREFLIGHT_INVALID_PEER".into());
    }
    // Reuse all existing checks: isolated QA feature, live authenticated
    // owner, existing Keychain identity, locally approved exact peer pin,
    // owner-scoped RLS GET for BOTH enrolled keys and a fresh account check.
    let admitted = authorize(&requested_fingerprint)
        .await
        .map_err(|_| "MESH_PREFLIGHT_NOT_READY".to_string())?;
    // Check again after every await to reject a rotated key, revoked peer,
    // changed owner, or invalidated server-side enrollment.
    recheck_after_probe(&admitted, &requested_fingerprint)
        .await
        .map_err(|_| "MESH_PREFLIGHT_NOT_READY".to_string())?;
    // No TcpStream / listener / trust write / job dispatch from this IPC path.
    Ok(diagnostic_preflight_result())
}

/// An internal service must supply the peer certificate and a socket. Never
/// expose this API through the frontend. The TLS layer validates the cert
/// against a Keychain-derived *explicitly approved* public-key pin.
pub(crate) async fn probe_client_after_approval(
    socket: TcpStream,
    requested_fingerprint: &str,
    peer_certificate: &[u8],
) -> Result<(), String> {
    let admitted = authorize(requested_fingerprint).await?;
    let local = DeviceTlsIdentity::from_signing_key(&admitted.local_signing)
        .map_err(|_| "MESH_ADMISSION_CERTIFICATE_UNAVAILABLE".to_string())?;
    mesh_transport::client_probe(socket, &local, &admitted.approved_peer, peer_certificate).await?;
    recheck_after_probe(&admitted, requested_fingerprint).await
}

/// Does not bind a TCP port. A future service may pass an explicitly accepted
/// socket ONLY after separate listener/security-gate review.
pub(crate) async fn probe_server_after_approval(
    socket: TcpStream,
    requested_fingerprint: &str,
    peer_certificate: &[u8],
) -> Result<(), String> {
    let admitted = authorize(requested_fingerprint).await?;
    let local = DeviceTlsIdentity::from_signing_key(&admitted.local_signing)
        .map_err(|_| "MESH_ADMISSION_CERTIFICATE_UNAVAILABLE".to_string())?;
    mesh_transport::server_probe(socket, &local, &admitted.approved_peer, peer_certificate).await?;
    recheck_after_probe(&admitted, requested_fingerprint).await
}

// No real-Keychain tests here: those would mutate a live user's OS account.
// Pure key selection/revocation cases reside in mesh_trust::tests, while the
// synthetic TLS hardware tests remain in mesh_transport::tests.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh_identity::fingerprint;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

    fn peer(seed: u8, at: i64) -> ApprovedPeer {
        let signing = SigningKey::from_bytes(&[seed; 32]);
        ApprovedPeer {
            public_key: URL_SAFE_NO_PAD.encode(signing.verifying_key().as_bytes()),
            fingerprint: fingerprint(&signing.verifying_key()),
            approved_at: at,
            status: "locally_approved".into(),
        }
    }

    #[test]
    fn stage4i_preflight_rejects_untrusted_peer_ids_before_network_or_keychain() {
        let valid = fingerprint(&SigningKey::from_bytes(&[71; 32]).verifying_key());
        assert!(exact_public_fingerprint(&valid));
        for bad in [
            "",
            "A",
            "wrong-peer",
            "00:11:22",
            &valid.to_ascii_lowercase(),
            &format!("{}{}", valid, "-00"),
        ] {
            assert!(!exact_public_fingerprint(bad));
        }
    }

    #[test]
    fn stage4i_preflight_never_claims_real_pairing_or_transport_permissions() {
        let result = serde_json::to_value(diagnostic_preflight_result()).unwrap();
        assert_eq!(result["protocol"], "katosync-mesh-native-peer-preflight-v1");
        assert_eq!(result["admissionEligible"], true);
        assert_eq!(result["paired"], false);
        assert_eq!(result["transportReady"], false);
        assert_eq!(result["remoteJobsEnabled"], false);
        assert_eq!(result["verifiedPeers"], 0);
    }

    #[test]
    fn qa_gate_does_not_silently_enable_stable_mesh() {
        assert_eq!(qa_build_enabled().is_ok(), cfg!(feature = "katoos-auth-qa"));
    }

    #[test]
    fn any_pin_or_approval_change_invalidates_single_probe_admission() {
        let original = peer(2, 100);
        assert!(approval_unchanged(&original, &original));
        assert!(!approval_unchanged(&original, &peer(3, 100)));
        assert!(!approval_unchanged(&original, &peer(2, 101)));
        let mut changed = original.clone();
        changed.status = "revoked".into();
        assert!(!approval_unchanged(&original, &changed));
        changed = original.clone();
        changed.fingerprint = "INVALID".into();
        assert!(!approval_unchanged(&original, &changed));
    }
}
