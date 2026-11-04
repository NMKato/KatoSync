// Created by NMKato Solutions
//! KatoSync 4.0: native cryptographic owner/approver grant verification.
//! A KATOOS login is NOT an owner approval. A signed, fresh authority grant
//! is required separately from the owner's Ed25519 feature-receipt signature.
//! Internal contract only: no Tauri IPC, no release, no automatic approval.
use super::{validate_owner_signed, SignedAcceptanceReceipt};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Utc};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

const GRANT_PROTOCOL: &str = "katosync-project-feature-approver-grant/v1";
const MAX_AGE_MS: i64 = 90_000;
const MAX_LIFETIME_MS: i64 = 300_000;
const CLOCK_SKEW_MS: i64 = 30_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SignedOwnerGrant {
    protocol: String,
    subject_uid: String,
    project_id: String,
    role: String,
    permission: String,
    key_id: String,
    signing_public_key: String,
    grant_revision: u64,
    state: String,
    issued_at_ms: i64,
    expires_at_ms: i64,
    revoked_at_ms: Option<i64>,
    issuer_signature: String,
}
/// Independent domain separator: this signature MUST be created by the
/// trustworthy KATOOS approver-authority, not the account / WebView.
const MAX_GRANT_RESPONSE_BYTES: usize = 4096;
/// Strict parser for a future bounded, authenticated KATOOS authority response.
/// Unknown fields, missing signatures and oversized payloads fail closed.
#[allow(dead_code)]
pub(super) fn parse_signed_owner_grant(bytes: &[u8]) -> Result<SignedOwnerGrant, String> {
    if bytes.is_empty() || bytes.len() > MAX_GRANT_RESPONSE_BYTES {
        return Err("OWNER_GRANT_RESPONSE_INVALID".into());
    }
    serde_json::from_slice(bytes).map_err(|_| "OWNER_GRANT_RESPONSE_INVALID".into())
}
fn grant_signing_bytes(g: &SignedOwnerGrant) -> Vec<u8> {
    let fields = json!([
        g.protocol,
        g.subject_uid,
        g.project_id,
        g.role,
        g.permission,
        g.key_id,
        g.signing_public_key,
        g.grant_revision,
        g.state,
        g.issued_at_ms,
        g.expires_at_ms,
        g.revoked_at_ms
    ]);
    [
        b"KatoSync owner-approval-grant v1\n".as_slice(),
        fields.to_string().as_bytes(),
    ]
    .concat()
}
fn decode_canonical<const N: usize>(raw: &str) -> Result<[u8; N], String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(raw)
        .map_err(|_| "OWNER_GRANT_ENCODING_INVALID")?;
    if bytes.len() != N || URL_SAFE_NO_PAD.encode(&bytes) != raw {
        return Err("OWNER_GRANT_ENCODING_INVALID".into());
    }
    bytes
        .try_into()
        .map_err(|_| "OWNER_GRANT_ENCODING_INVALID".into())
}
fn key_id(key: &VerifyingKey) -> String {
    format!("ed25519-sha256:{}", hex_sha(key.as_bytes()))
}
fn hex_sha(raw: &[u8]) -> String {
    format!("{:x}", Sha256::digest(raw))
}
#[derive(Debug, Clone)]
pub(super) struct AuthorizedFeatureApprover {
    pub(super) owner_key: VerifyingKey,
    pub(super) signer_key_id: String,
}
/// Accept only a *fresh* authority-signed grant scoped to the issuer-verified
/// current account, registered project and the exact owner-signed decision.
///
/// The pinned issuer public key MUST come from native trusted configuration.
/// The current UID MUST be freshly verified against /auth/v1/user, NOT cached.
/// No user-supplied public key or self-signed grant can grant owner rights.
/// This has no network connectivity yet and is deliberately not a live gate.
#[allow(dead_code)]
pub(super) fn validate_owner_grant(
    grant: &SignedOwnerGrant,
    receipt: &SignedAcceptanceReceipt,
    verified_uid: &str,
    expected_project_id: &str,
    pinned_issuer: &VerifyingKey,
    now_ms: i64,
) -> Result<AuthorizedFeatureApprover, String> {
    let uid = Uuid::parse_str(verified_uid).map_err(|_| "OWNER_GRANT_INVALID_USER")?;
    let subject = Uuid::parse_str(&grant.subject_uid).map_err(|_| "OWNER_GRANT_INVALID_USER")?;
    if uid != subject
        || grant.subject_uid != verified_uid
        || grant.project_id != expected_project_id
        || receipt.project_id != expected_project_id
        || grant.protocol != GRANT_PROTOCOL
        || !matches!(grant.role.as_str(), "project_owner" | "feature_approver")
        || grant.permission != "approve_feature_acceptance"
        || grant.grant_revision == 0
        || grant.state != "active"
        || grant.revoked_at_ms.is_some()
    {
        return Err("OWNER_GRANT_UNAUTHORIZED".into());
    }
    // Compare as i128 so hostile i64 timestamp extremes cannot overflow.
    let now = i128::from(now_ms);
    let issued = i128::from(grant.issued_at_ms);
    let expires = i128::from(grant.expires_at_ms);
    if now < issued - i128::from(CLOCK_SKEW_MS)
        || now - issued > i128::from(MAX_AGE_MS)
        || expires <= now
        || expires <= issued
        || expires - issued > i128::from(MAX_LIFETIME_MS)
    {
        return Err("OWNER_GRANT_EXPIRED_OR_STALE".into());
    }
    let public = decode_canonical::<32>(&grant.signing_public_key)?;
    let owner_key = VerifyingKey::from_bytes(&public).map_err(|_| "OWNER_GRANT_KEY_INVALID")?;
    let canonical_key_id = key_id(&owner_key);
    if grant.key_id != canonical_key_id || receipt.owner.signer_key_id != canonical_key_id {
        return Err("OWNER_GRANT_KEY_MISMATCH".into());
    }
    let issuer_signature = Signature::from_slice(&decode_canonical::<64>(&grant.issuer_signature)?)
        .map_err(|_| "OWNER_GRANT_ISSUER_SIGNATURE_INVALID")?;
    pinned_issuer
        .verify_strict(&grant_signing_bytes(grant), &issuer_signature)
        .map_err(|_| "OWNER_GRANT_ISSUER_SIGNATURE_INVALID".to_string())?;
    let receipt_time = DateTime::parse_from_rfc3339(&receipt.accepted_at)
        .map_err(|_| "OWNER_GRANT_RECEIPT_TIME_INVALID")?
        .with_timezone(&Utc)
        .timestamp_millis();
    let receipt_time = i128::from(receipt_time);
    if receipt_time < issued - i128::from(CLOCK_SKEW_MS)
        || receipt_time > now + i128::from(CLOCK_SKEW_MS)
        || receipt_time >= expires
    {
        return Err("OWNER_GRANT_RECEIPT_TIME_OUTSIDE_LEASE".into());
    }
    validate_owner_signed(receipt, &owner_key)?;
    Ok(AuthorizedFeatureApprover {
        owner_key,
        signer_key_id: canonical_key_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory_fabric::acceptance_ledger::{CiReceipt, OwnerApproval};
    use ed25519_dalek::{Signer, SigningKey};
    const UID: &str = "11111111-1111-4111-8111-111111111111";
    const OTHER_UID: &str = "22222222-2222-4222-8222-222222222222";
    const NOW: i64 = 1_783_623_600_000; // Fixed QA clock, never machine-dependent.

    fn qa_receipt(owner: &SigningKey) -> SignedAcceptanceReceipt {
        let key = key_id(&owner.verifying_key());
        let mut receipt = SignedAcceptanceReceipt {
            schema_version: "katosync.feature-acceptance/v1".into(),
            project_id: "project-a".into(),
            plan_journal_sequence: 7,
            scope_digest: "f".repeat(64),
            head_sha: "a".repeat(40),
            accepted_at: DateTime::from_timestamp_millis(NOW - 15_000)
                .unwrap()
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            accepted_feature_ids: vec!["feat-a".into()],
            ci: vec![CiReceipt {
                workflow: "CI".into(),
                job: "unit".into(),
                run_id: 17,
                head_sha: "a".repeat(40),
            }],
            owner: OwnerApproval {
                decision_id: "decision-1".into(),
                signer_key_id: key,
                signature: String::new(),
            },
            previous_hash: None,
            hash: String::new(),
        };
        receipt.owner.signature = URL_SAFE_NO_PAD.encode(
            owner
                .sign(&super::super::signing_bytes(&receipt))
                .to_bytes(),
        );
        receipt.hash = super::super::receipt_hash(&receipt);
        receipt
    }
    fn signed_grant(owner: &SigningKey, authority: &SigningKey) -> SignedOwnerGrant {
        let mut grant = SignedOwnerGrant {
            protocol: GRANT_PROTOCOL.into(),
            subject_uid: UID.into(),
            project_id: "project-a".into(),
            role: "project_owner".into(),
            permission: "approve_feature_acceptance".into(),
            key_id: key_id(&owner.verifying_key()),
            signing_public_key: URL_SAFE_NO_PAD.encode(owner.verifying_key().as_bytes()),
            grant_revision: 1,
            state: "active".into(),
            issued_at_ms: NOW - 25_000,
            expires_at_ms: NOW + 60_000,
            revoked_at_ms: None,
            issuer_signature: String::new(),
        };
        resign(&mut grant, authority);
        grant
    }
    fn resign(grant: &mut SignedOwnerGrant, authority: &SigningKey) {
        grant.issuer_signature =
            URL_SAFE_NO_PAD.encode(authority.sign(&grant_signing_bytes(grant)).to_bytes());
    }
    #[test]
    fn edge_and_rust_issuer_domain_and_array_bytes_have_one_fixed_sha256() {
        // SHA vector calculated independently by TypeScript/WebCrypto Edge QA.
        let g = SignedOwnerGrant {
            protocol: GRANT_PROTOCOL.into(),
            subject_uid: UID.into(),
            project_id: "project-a".into(),
            role: "project_owner".into(),
            permission: "approve_feature_acceptance".into(),
            key_id: format!("ed25519-sha256:{}", "f".repeat(64)),
            signing_public_key: "A".repeat(43),
            grant_revision: 3,
            state: "active".into(),
            issued_at_ms: 1_793_829_600_000,
            expires_at_ms: 1_793_829_660_000,
            revoked_at_ms: None,
            issuer_signature: String::new(),
        };
        let bytes = grant_signing_bytes(&g);
        assert_eq!(bytes.len(), 347);
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            "1f874636616a22ee30ff57ce3f355f92dfedb59ffc437c4c302af6a3a1466561"
        );
    }
    #[test]
    fn fresh_independent_issuer_and_owner_signatures_required() {
        let owner = SigningKey::from_bytes(&[11; 32]);
        let issuer = SigningKey::from_bytes(&[12; 32]);
        let grant = signed_grant(&owner, &issuer);
        let receipt = qa_receipt(&owner);
        let accepted = validate_owner_grant(
            &grant,
            &receipt,
            UID,
            "project-a",
            &issuer.verifying_key(),
            NOW,
        )
        .unwrap();
        assert_eq!(accepted.signer_key_id, receipt.owner.signer_key_id);
        assert_eq!(accepted.owner_key, owner.verifying_key());
        let foreign = SigningKey::from_bytes(&[13; 32]);
        assert!(validate_owner_grant(
            &grant,
            &receipt,
            UID,
            "project-a",
            &foreign.verifying_key(),
            NOW
        )
        .is_err());
    }
    #[test]
    fn parser_rejects_bloated_or_extra_fields_without_signature_authority() {
        let owner = SigningKey::from_bytes(&[11; 32]);
        let issuer = SigningKey::from_bytes(&[12; 32]);
        let grant = signed_grant(&owner, &issuer);
        let json = serde_json::to_vec(&grant).unwrap();
        assert!(parse_signed_owner_grant(&json).is_ok());
        assert!(parse_signed_owner_grant(&vec![b'x'; 4097]).is_err());
        assert!(parse_signed_owner_grant(b"").is_err());
        let mut forged: serde_json::Value = serde_json::from_slice(&json).unwrap();
        forged["forceApproved"] = serde_json::json!(true);
        assert!(parse_signed_owner_grant(forged.to_string().as_bytes()).is_err());
        forged.as_object_mut().unwrap().remove("forceApproved");
        forged.as_object_mut().unwrap().remove("issuerSignature");
        assert!(parse_signed_owner_grant(forged.to_string().as_bytes()).is_err());
    }
    #[test]
    fn login_alone_wrong_owner_or_project_cannot_approve() {
        let owner = SigningKey::from_bytes(&[11; 32]);
        let issuer = SigningKey::from_bytes(&[12; 32]);
        let grant = signed_grant(&owner, &issuer);
        let receipt = qa_receipt(&owner);
        for (uid, project) in [(OTHER_UID, "project-a"), (UID, "project-b")] {
            assert!(validate_owner_grant(
                &grant,
                &receipt,
                uid,
                project,
                &issuer.verifying_key(),
                NOW
            )
            .is_err());
        }
    }
    #[test]
    fn signed_revocation_suspension_or_missing_right_fails_closed() {
        let owner = SigningKey::from_bytes(&[11; 32]);
        let issuer = SigningKey::from_bytes(&[12; 32]);
        let receipt = qa_receipt(&owner);
        for mutate in 0..4 {
            let mut grant = signed_grant(&owner, &issuer);
            match mutate {
                0 => grant.state = "revoked".into(),
                1 => grant.revoked_at_ms = Some(NOW - 1),
                2 => grant.permission = "read_project".into(),
                _ => grant.role = "viewer".into(),
            }
            resign(&mut grant, &issuer);
            assert!(validate_owner_grant(
                &grant,
                &receipt,
                UID,
                "project-a",
                &issuer.verifying_key(),
                NOW
            )
            .is_err());
        }
    }
    #[test]
    fn expired_future_and_overlong_grants_fail_even_with_valid_signatures() {
        let owner = SigningKey::from_bytes(&[11; 32]);
        let issuer = SigningKey::from_bytes(&[12; 32]);
        let receipt = qa_receipt(&owner);
        for mutate in 0..4 {
            let mut grant = signed_grant(&owner, &issuer);
            match mutate {
                0 => grant.expires_at_ms = NOW - 1,
                1 => grant.issued_at_ms = NOW - 180_000,
                2 => grant.issued_at_ms = NOW + 40_000,
                _ => grant.expires_at_ms = NOW + MAX_LIFETIME_MS + 1,
            }
            resign(&mut grant, &issuer);
            assert!(validate_owner_grant(
                &grant,
                &receipt,
                UID,
                "project-a",
                &issuer.verifying_key(),
                NOW
            )
            .is_err());
        }
    }
    #[test]
    fn rotated_key_or_tampered_grant_is_not_sufficient() {
        let owner = SigningKey::from_bytes(&[11; 32]);
        let issuer = SigningKey::from_bytes(&[12; 32]);
        let receipt = qa_receipt(&owner);
        let mut grant = signed_grant(&owner, &issuer);
        let other = SigningKey::from_bytes(&[14; 32]);
        grant.key_id = key_id(&other.verifying_key());
        resign(&mut grant, &issuer);
        assert!(validate_owner_grant(
            &grant,
            &receipt,
            UID,
            "project-a",
            &issuer.verifying_key(),
            NOW
        )
        .is_err());
        let mut grant = signed_grant(&owner, &issuer);
        grant.grant_revision += 1; // signature is now invalid
        assert!(validate_owner_grant(
            &grant,
            &receipt,
            UID,
            "project-a",
            &issuer.verifying_key(),
            NOW
        )
        .is_err());
    }
}
