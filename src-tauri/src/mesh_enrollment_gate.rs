// Created by NMKato Solutions
//! Read-only, same-owner device enrollment verification.
//!
//! A server-side discovery receipt proves ownership of an Ed25519 key, NOT
//! trust. Native admission independently requires a user-approved Keychain
//! peer pin and an online-verified KATOOS account. Never use this result to
//! pair, create keys, authorize jobs, or mark a Mesh session as connected.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::VerifyingKey;
use serde::Deserialize;
use std::{collections::HashSet, time::Duration};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::{
    mesh_identity::{fingerprint, same_account_still_verified},
    mesh_trust::ApprovedPeer,
};

const MAX_OWNER_DEVICES: usize = 10;
const MAX_RESPONSE_BYTES: usize = 16_384;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnrollmentRecord {
    owner_user_id: Uuid,
    signing_public_key: String,
    fingerprint: String,
    membership_state: String,
    enrolled_at: Option<String>,
    revoked_at: Option<String>,
}

fn parse_public_key(encoded: &str) -> Result<VerifyingKey, &'static str> {
    let raw = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "MESH_ENROLLMENT_INVALID_ROSTER")?;
    if URL_SAFE_NO_PAD.encode(&raw) != encoded {
        return Err("MESH_ENROLLMENT_INVALID_ROSTER");
    }
    let bytes: [u8; 32] = raw
        .try_into()
        .map_err(|_| "MESH_ENROLLMENT_INVALID_ROSTER")?;
    VerifyingKey::from_bytes(&bytes).map_err(|_| "MESH_ENROLLMENT_INVALID_ROSTER")
}

/// Verify that BOTH exact signing keys are enrolled under one canonical owner.
/// Membership discovered/pending/trusted represents registration state only;
/// none of these statuses grant peer trust.
fn validate_two_enrollments(
    records: &[EnrollmentRecord],
    owner: Uuid,
    own: &VerifyingKey,
    peer: &VerifyingKey,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<(), &'static str> {
    if own == peer || records.len() > MAX_OWNER_DEVICES {
        return Err("MESH_ENROLLMENT_INVALID_ROSTER");
    }

    let mut seen = HashSet::new();
    let mut own_present = false;
    let mut peer_present = false;
    for record in records {
        if record.owner_user_id != owner {
            return Err("MESH_ENROLLMENT_WRONG_OWNER");
        }
        let key = parse_public_key(&record.signing_public_key)?;
        if record.fingerprint != fingerprint(&key)
            || !seen.insert(record.signing_public_key.as_str())
            || !matches!(
                record.membership_state.as_str(),
                "discovered" | "pending" | "trusted" | "revoked"
            )
        {
            return Err("MESH_ENROLLMENT_INVALID_ROSTER");
        }

        let enrolled = record
            .enrolled_at
            .as_ref()
            .ok_or("MESH_ENROLLMENT_MISSING_PROOF")
            .and_then(|time| {
                chrono::DateTime::parse_from_rfc3339(time)
                    .map(|value| value.with_timezone(&chrono::Utc))
                    .map_err(|_| "MESH_ENROLLMENT_INVALID_ROSTER")
            })?;
        if enrolled > now + chrono::Duration::seconds(5) {
            return Err("MESH_ENROLLMENT_INVALID_ROSTER");
        }

        if key == *own || key == *peer {
            if record.membership_state == "revoked" || record.revoked_at.is_some() {
                return Err("MESH_ENROLLMENT_REVOKED");
            }
            if key == *own {
                own_present = true;
            } else {
                peer_present = true;
            }
        } else if (record.membership_state == "revoked") != record.revoked_at.is_some() {
            return Err("MESH_ENROLLMENT_INVALID_ROSTER");
        }
    }
    if !own_present || !peer_present {
        return Err("MESH_ENROLLMENT_DEVICE_NOT_ENROLLED");
    }
    Ok(())
}

/// Additional online gate (not a substitute for local two-way SAS consent).
/// Reads public owner-scoped device metadata via JWT/RLS. Never requests a
/// service-role credential or accepts an arbitrary URL from the frontend.
pub(crate) async fn require_both_devices_enrolled(
    owner_uid: &str,
    own: &VerifyingKey,
    approved_peer: &ApprovedPeer,
) -> Result<(), String> {
    if !cfg!(feature = "katoos-auth-qa") {
        return Err("MESH_ENROLLMENT_NOT_CONFIGURED".into());
    }
    let owner =
        Uuid::parse_str(owner_uid).map_err(|_| "MESH_ENROLLMENT_WRONG_OWNER".to_string())?;
    let peer = parse_public_key(&approved_peer.public_key).map_err(str::to_string)?;
    if peer == *own
        || fingerprint(&peer) != approved_peer.fingerprint
        || approved_peer.status != "locally_approved"
    {
        return Err("MESH_ENROLLMENT_PEER_NOT_APPROVED".into());
    }
    let token = Zeroizing::new(
        crate::ensure_supabase_access_token()
            .await
            .map_err(|_| "MESH_ENROLLMENT_LOGIN_REQUIRED".to_string())?,
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| "MESH_ENROLLMENT_UNAVAILABLE".to_string())?;
    let url = format!("{}/rest/v1/katosync_mesh_devices", crate::KATOSYNC_AUTH_URL);
    let response = client
        .get(url)
        .query(&[
            ("select", "owner_user_id,signing_public_key,fingerprint,membership_state,enrolled_at,revoked_at"),
            ("owner_user_id", &format!("eq.{owner}")),
            ("limit", "11"),
        ])
        .header("apikey", crate::KATOSYNC_AUTH_ANON_KEY)
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|_| "MESH_ENROLLMENT_UNAVAILABLE".to_string())?;
    if !response.status().is_success() {
        return Err("MESH_ENROLLMENT_UNAVAILABLE".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "MESH_ENROLLMENT_UNAVAILABLE".to_string())?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("MESH_ENROLLMENT_INVALID_ROSTER".into());
    }
    let records: Vec<EnrollmentRecord> =
        serde_json::from_slice(&bytes).map_err(|_| "MESH_ENROLLMENT_INVALID_ROSTER".to_string())?;
    validate_two_enrollments(&records, owner, own, &peer, chrono::Utc::now())
        .map_err(str::to_string)?;
    same_account_still_verified(owner_uid)
        .await
        .map_err(|_| "MESH_ENROLLMENT_ACCOUNT_CHANGED".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    const UID: &str = "819d749b-f932-44b9-90b7-8b27684e5efe";
    const OTHER: &str = "9a1ee918-6af6-4109-a50f-31c01abf789c";

    fn key(seed: u8) -> VerifyingKey {
        SigningKey::from_bytes(&[seed; 32]).verifying_key()
    }
    fn record(seed: u8, owner: &str) -> EnrollmentRecord {
        let key = key(seed);
        EnrollmentRecord {
            owner_user_id: Uuid::parse_str(owner).unwrap(),
            signing_public_key: URL_SAFE_NO_PAD.encode(key.as_bytes()),
            fingerprint: fingerprint(&key),
            membership_state: "discovered".into(),
            enrolled_at: Some("2026-10-28T12:00:00Z".into()),
            revoked_at: None,
        }
    }
    fn check(records: &[EnrollmentRecord]) -> Result<(), &'static str> {
        validate_two_enrollments(
            records,
            Uuid::parse_str(UID).unwrap(),
            &key(3),
            &key(4),
            chrono::DateTime::parse_from_rfc3339("2026-10-28T18:00:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        )
    }

    #[test]
    fn both_registered_keys_are_required_but_not_treated_as_trust() {
        assert!(check(&[record(3, UID), record(4, UID)]).is_ok());
        assert_eq!(
            check(&[record(3, UID)]),
            Err("MESH_ENROLLMENT_DEVICE_NOT_ENROLLED")
        );
        assert_eq!(
            check(&[record(4, UID)]),
            Err("MESH_ENROLLMENT_DEVICE_NOT_ENROLLED")
        );
        assert_eq!(check(&[]), Err("MESH_ENROLLMENT_DEVICE_NOT_ENROLLED"));
        assert!(check(&[record(3, UID), record(4, UID), record(5, UID)]).is_ok());
    }
    #[test]
    fn cross_account_and_replayed_duplicate_key_fail_closed() {
        assert_eq!(
            check(&[record(3, UID), record(4, OTHER)]),
            Err("MESH_ENROLLMENT_WRONG_OWNER")
        );
        let repeated = record(3, UID);
        assert_eq!(
            check(&[repeated.clone(), repeated, record(4, UID)]),
            Err("MESH_ENROLLMENT_INVALID_ROSTER")
        );
    }
    #[test]
    fn revoked_or_unverified_enrollment_is_rejected() {
        let mut revoked = record(4, UID);
        revoked.membership_state = "revoked".into();
        revoked.revoked_at = Some("2026-10-28T12:01:00Z".into());
        assert_eq!(
            check(&[record(3, UID), revoked]),
            Err("MESH_ENROLLMENT_REVOKED")
        );

        let mut unverified = record(3, UID);
        unverified.enrolled_at = None;
        assert_eq!(
            check(&[unverified, record(4, UID)]),
            Err("MESH_ENROLLMENT_MISSING_PROOF")
        );
        let mut future = record(4, UID);
        future.enrolled_at = Some("2026-11-28T12:00:00Z".into());
        assert_eq!(
            check(&[record(3, UID), future]),
            Err("MESH_ENROLLMENT_INVALID_ROSTER")
        );
    }
    #[test]
    fn same_device_and_oversized_registry_are_never_admitted() {
        let owner = Uuid::parse_str(UID).unwrap();
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-28T18:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert_eq!(
            validate_two_enrollments(&[record(3, UID)], owner, &key(3), &key(3), now),
            Err("MESH_ENROLLMENT_INVALID_ROSTER"),
        );
        let mut many = (5..16).map(|seed| record(seed, UID)).collect::<Vec<_>>();
        many.push(record(3, UID));
        many.push(record(4, UID));
        assert_eq!(check(&many), Err("MESH_ENROLLMENT_INVALID_ROSTER"));
    }

    #[test]
    fn tampered_key_fingerprint_and_invalid_membership_fail_closed() {
        let mut tampered = record(4, UID);
        tampered.fingerprint = fingerprint(&key(9));
        assert_eq!(
            check(&[record(3, UID), tampered]),
            Err("MESH_ENROLLMENT_INVALID_ROSTER")
        );
        let mut invalid = record(3, UID);
        invalid.signing_public_key = "!".into();
        assert_eq!(
            check(&[invalid, record(4, UID)]),
            Err("MESH_ENROLLMENT_INVALID_ROSTER")
        );
        let mut invented = record(4, UID);
        invented.membership_state = "connected".into();
        assert_eq!(
            check(&[record(3, UID), invented]),
            Err("MESH_ENROLLMENT_INVALID_ROSTER")
        );
    }
}
