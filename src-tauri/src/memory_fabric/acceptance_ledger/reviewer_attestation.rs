// NMKato Solutions — Stage Gate 9 native-independent reviewer signature readback.
// QA-only pure verifier. NO Tauri IPC, HTTP, SQL mutations or automatic grant.
// A caller MUST independently obtain a current, admin-authorized reviewer key;
// a database decision's own publicKey is NEVER a trust anchor.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

const PROTOCOL: &str = "katosync.owner-independent-review/v1";
const DOMAIN: &[u8] = b"KatoSync independent-owner-review v1\n";
const MAX_BYTES: usize = 4096;
const MAX_AGE_MS: i128 = 60_000;
const CLOCK_SKEW_MS: i128 = 5_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignedReviewerDecision {
    protocol: String,
    grant_id: String,
    challenge_id: String,
    project_id: String,
    subject_uid: String,
    owner_key_id: String,
    grant_revision: u64,
    reviewer_uid: String,
    reviewer_key_id: String,
    reviewer_key_revision: u64,
    reviewer_public_key: String,
    decision: String,
    reason: String,
    signed_at_ms: i64,
}

/// Every value here must originate from an independent FRESH privileged
/// reviewer/owner/project authorization read, NEVER from the signed decision
/// itself, WebView flags, JWT user_metadata or a stale cached reviewer role.
#[derive(Debug)]
#[allow(dead_code)]
pub(super) struct CurrentReviewerAuthority<'a> {
    pub grant_id: &'a str,
    pub challenge_id: &'a str,
    pub project_id: &'a str,
    pub subject_uid: &'a str,
    pub owner_key_id: &'a str,
    pub grant_revision: u64,
    pub reviewer_uid: &'a str,
    pub reviewer_key_id: &'a str,
    pub reviewer_key_revision: u64,
    pub reviewer_public_key: &'a VerifyingKey,
    pub reviewer_active: bool,
    pub owner_proof_consumed: bool,
    pub grant_pending: bool,
    pub project_active: bool,
}

/// Domain-separated 14-field canonical JSON array, identical to the KATOOS
/// Edge verifier's reviewerSigningBytes40(). Does NOT grant owner rights.
fn signing_bytes(v: &SignedReviewerDecision) -> Vec<u8> {
    let fields = json!([
        v.protocol,
        v.grant_id,
        v.challenge_id,
        v.project_id,
        v.subject_uid,
        v.owner_key_id,
        v.grant_revision,
        v.reviewer_uid,
        v.reviewer_key_id,
        v.reviewer_key_revision,
        v.reviewer_public_key,
        v.decision,
        v.reason,
        v.signed_at_ms
    ]);
    [DOMAIN, fields.to_string().as_bytes()].concat()
}

fn uuid(raw: &str) -> bool {
    Uuid::parse_str(raw).is_ok_and(|parsed| parsed.to_string() == raw)
}
fn key_id(raw: &str) -> bool {
    raw.strip_prefix("ed25519-sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    })
}
fn project_id(raw: &str) -> bool {
    !raw.is_empty()
        && raw.len() <= 80
        && raw
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b':' | b'-'))
}
fn canonical<const N: usize>(input: &str) -> Result<[u8; N], String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(input)
        .map_err(|_| "REVIEW_BAD_ENCODING")?;
    if bytes.len() != N || URL_SAFE_NO_PAD.encode(&bytes) != input {
        return Err("REVIEW_BAD_ENCODING".into());
    }
    bytes.try_into().map_err(|_| "REVIEW_BAD_ENCODING".into())
}

/// A signed rejection is NOT a feature approval. Caller receives an explicit
/// typed verdict and may NEVER interpret a generic Ok(()) as authorization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub(super) enum VerifiedReviewerVerdict {
    Approved,
    Rejected,
}

/// Native independent cryptographic READBACK of the reviewer decision.
///
/// A positive result means only that this *one* attestation matches an
/// independently authorized reviewer and exact pending owner challenge.
/// It MUST NOT transition acceptance to "verified", change roles or enable
/// Mesh/remote execution. Native CI/ancestry/owner-acceptance gates remain.
#[allow(dead_code)]
pub(super) fn verify_reviewer_decision_readback(
    encoded_decision: &[u8],
    signature_b64url: &str,
    current: &CurrentReviewerAuthority<'_>,
    now_ms: i64,
) -> Result<VerifiedReviewerVerdict, String> {
    if encoded_decision.is_empty() || encoded_decision.len() > MAX_BYTES {
        return Err("REVIEW_PAYLOAD_INVALID".into());
    }
    let decision: SignedReviewerDecision =
        serde_json::from_slice(encoded_decision).map_err(|_| "REVIEW_PAYLOAD_INVALID")?;

    if !current.reviewer_active
        || !current.owner_proof_consumed
        || !current.grant_pending
        || !current.project_active
    {
        return Err("REVIEW_AUTHORITY_INACTIVE".into());
    }

    if decision.protocol != PROTOCOL
        || !uuid(&decision.grant_id)
        || !uuid(&decision.challenge_id)
        || !project_id(&decision.project_id)
        || !uuid(&decision.subject_uid)
        || !uuid(&decision.reviewer_uid)
        || decision.subject_uid == decision.reviewer_uid
        || !key_id(&decision.owner_key_id)
        || !key_id(&decision.reviewer_key_id)
        || decision.grant_revision == 0
        || decision.reviewer_key_revision == 0
        || !matches!(decision.decision.as_str(), "approved" | "rejected")
        || decision.reason.trim() != decision.reason
        || !(12..=1000).contains(&decision.reason.encode_utf16().count())
        || decision.reason.chars().any(|c| c.is_ascii_control())
    {
        return Err("REVIEW_FIELDS_INVALID".into());
    }

    if decision.grant_id != current.grant_id
        || decision.challenge_id != current.challenge_id
        || decision.project_id != current.project_id
        || decision.subject_uid != current.subject_uid
        || decision.owner_key_id != current.owner_key_id
        || decision.grant_revision != current.grant_revision
        || decision.reviewer_uid != current.reviewer_uid
        || decision.reviewer_key_id != current.reviewer_key_id
        || decision.reviewer_key_revision != current.reviewer_key_revision
    {
        return Err("REVIEW_SCOPE_OR_REVISION_MISMATCH".into());
    }

    let now = i128::from(now_ms);
    let signed = i128::from(decision.signed_at_ms);
    if signed > now + CLOCK_SKEW_MS || signed < now - MAX_AGE_MS {
        return Err("REVIEW_SIGNATURE_STALE".into());
    }

    let public_bytes = canonical::<32>(&decision.reviewer_public_key)?;
    if &public_bytes != current.reviewer_public_key.as_bytes()
        || format!("ed25519-sha256:{:x}", Sha256::digest(public_bytes)) != decision.reviewer_key_id
    {
        return Err("REVIEW_UNTRUSTED_SIGNING_KEY".into());
    }

    let signature_bytes = canonical::<64>(signature_b64url)?;
    let signature =
        Signature::from_slice(&signature_bytes).map_err(|_| "REVIEW_SIGNATURE_INVALID")?;
    current
        .reviewer_public_key
        .verify_strict(&signing_bytes(&decision), &signature)
        .map_err(|_| "REVIEW_SIGNATURE_INVALID".to_string())?;
    Ok(if decision.decision == "approved" {
        VerifiedReviewerVerdict::Approved
    } else {
        VerifiedReviewerVerdict::Rejected
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    const NOW: i64 = 1_793_829_600_000;
    const OWNER: &str = "22222222-2222-4222-8222-222222222222";
    const REVIEWER: &str = "11111111-1111-4111-8111-111111111111";
    const GRANT: &str = "33333333-3333-4333-8333-333333333333";
    const CHALLENGE: &str = "44444444-4444-4444-8444-444444444444";
    const OWNER_KEY: &str =
        "ed25519-sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

    fn setup() -> (SigningKey, SignedReviewerDecision) {
        let key = SigningKey::from_bytes(&[41; 32]); // public synthetic QA-only seed
        let raw = key.verifying_key();
        let attestation = SignedReviewerDecision {
            protocol: PROTOCOL.into(),
            grant_id: GRANT.into(),
            challenge_id: CHALLENGE.into(),
            project_id: "katosync".into(),
            subject_uid: OWNER.into(),
            owner_key_id: OWNER_KEY.into(),
            grant_revision: 3,
            reviewer_uid: REVIEWER.into(),
            reviewer_key_id: format!("ed25519-sha256:{:x}", Sha256::digest(raw.as_bytes())),
            reviewer_key_revision: 2,
            reviewer_public_key: URL_SAFE_NO_PAD.encode(raw.as_bytes()),
            decision: "approved".into(),
            reason: "Independent synthetic QA reviewer checked owner proof".into(),
            signed_at_ms: NOW,
        };
        (key, attestation)
    }
    fn authority<'a>(
        key: &'a VerifyingKey,
        decision: &'a SignedReviewerDecision,
    ) -> CurrentReviewerAuthority<'a> {
        CurrentReviewerAuthority {
            grant_id: GRANT,
            challenge_id: CHALLENGE,
            project_id: "katosync",
            subject_uid: OWNER,
            owner_key_id: OWNER_KEY,
            grant_revision: 3,
            reviewer_uid: REVIEWER,
            reviewer_key_id: &decision.reviewer_key_id,
            reviewer_key_revision: 2,
            reviewer_public_key: key,
            reviewer_active: true,
            owner_proof_consumed: true,
            grant_pending: true,
            project_active: true,
        }
    }
    fn sign(key: &SigningKey, decision: &SignedReviewerDecision) -> String {
        URL_SAFE_NO_PAD.encode(key.sign(&signing_bytes(decision)).to_bytes())
    }
    fn check(
        key: &SigningKey,
        decision: &SignedReviewerDecision,
        signature: &str,
        now: i64,
    ) -> Result<VerifiedReviewerVerdict, String> {
        verify_reviewer_decision_readback(
            serde_json::to_vec(decision).unwrap().as_slice(),
            signature,
            &authority(&key.verifying_key(), decision),
            now,
        )
    }
    #[test]
    fn independently_pinned_synthetic_reviewer_proof_verifies_not_activates() {
        let (key, signed) = setup();
        let signature = sign(&key, &signed);
        assert_eq!(
            check(&key, &signed, &signature, NOW).unwrap(),
            VerifiedReviewerVerdict::Approved
        );
        // A properly signed REJECTION remains a rejection, never an approval.
        let mut rejected = signed.clone();
        rejected.decision = "rejected".into();
        let rejection_signature = sign(&key, &rejected);
        assert_eq!(
            check(&key, &rejected, &rejection_signature, NOW).unwrap(),
            VerifiedReviewerVerdict::Rejected
        );
        assert!(signing_bytes(&signed).starts_with(DOMAIN));
        // Independently generated with the actual TypeScript reviewerSigningBytes40
        // and Node crypto Ed25519 PKCS8 fixture (seed [41;32]), not Rust JSON.
        assert_eq!(
            format!("{:x}", Sha256::digest(signing_bytes(&signed))),
            "d0942d714bed03bf4192288172d5a3737edafdd1a2bc26c3ca4c18fff1b9f82d"
        );
        assert_eq!(signature,
            "5h-b9UQ7Sp0IeAcR-17mFa49xXI_Dksj4ZvaBTLu50v3KHY3NlszUyd02kKIkfvggg3ze02eGbP551hkm0fWAA");
    }
    #[test]
    fn attacker_cannot_transfer_signed_decision_to_other_owner_project_or_grant() {
        let (key, signed) = setup();
        let sig = sign(&key, &signed);
        let mut poisoned = signed.clone();
        poisoned.subject_uid = REVIEWER.into();
        assert!(check(&key, &poisoned, &sig, NOW).is_err());
        poisoned = signed.clone();
        poisoned.project_id = "other-project".into();
        assert!(check(&key, &poisoned, &sig, NOW).is_err());
        poisoned = signed.clone();
        poisoned.grant_id = CHALLENGE.into();
        assert!(check(&key, &poisoned, &sig, NOW).is_err());
        poisoned = signed.clone();
        poisoned.challenge_id = GRANT.into();
        assert!(check(&key, &poisoned, &sig, NOW).is_err());
        poisoned = signed.clone();
        poisoned.owner_key_id = format!("ed25519-sha256:{}", "f".repeat(64));
        assert!(check(&key, &poisoned, &sig, NOW).is_err());
    }
    #[test]
    fn revision_change_replay_revocation_and_wrong_signer_fail_closed() {
        let (key, signed) = setup();
        let sig = sign(&key, &signed);
        let mut poisoned = signed.clone();
        poisoned.grant_revision += 1;
        assert!(check(&key, &poisoned, &sig, NOW).is_err());
        poisoned = signed.clone();
        poisoned.reviewer_key_revision += 1;
        assert!(check(&key, &poisoned, &sig, NOW).is_err());
        poisoned = signed.clone();
        poisoned.decision = "rejected".into();
        assert!(check(&key, &poisoned, &sig, NOW).is_err());
        poisoned = signed.clone();
        poisoned.reason = "Different reviewer reasons for approval".into();
        assert!(check(&key, &poisoned, &sig, NOW).is_err());
        assert!(check(&key, &signed, &sig, NOW + 70_000).is_err());
        assert!(check(&key, &signed, &sig, NOW - 6_000).is_err());
        let other = SigningKey::from_bytes(&[42; 32]);
        assert!(verify_reviewer_decision_readback(
            &serde_json::to_vec(&signed).unwrap(),
            &sig,
            &authority(&other.verifying_key(), &signed),
            NOW,
        )
        .is_err());
        let trusted = key.verifying_key();
        let mut inactive = authority(&trusted, &signed);
        inactive.reviewer_active = false;
        assert!(verify_reviewer_decision_readback(
            &serde_json::to_vec(&signed).unwrap(),
            &sig,
            &inactive,
            NOW,
        )
        .is_err());
    }
    #[test]
    fn extra_fields_invalid_encoding_and_missing_independent_evidence_deny() {
        let (key, signed) = setup();
        let sig = sign(&key, &signed);
        let mut body = serde_json::to_value(&signed).unwrap();
        body["grantsRights"] = json!(true);
        assert!(verify_reviewer_decision_readback(
            &serde_json::to_vec(&body).unwrap(),
            &sig,
            &authority(&key.verifying_key(), &signed),
            NOW
        )
        .is_err());
        assert!(check(&key, &signed, "@@@@@@", NOW).is_err());
        assert!(check(&key, &signed, &sig, NOW).is_ok());
        let trusted = key.verifying_key();
        let mut stale = authority(&trusted, &signed);
        stale.owner_proof_consumed = false;
        assert!(verify_reviewer_decision_readback(
            &serde_json::to_vec(&signed).unwrap(),
            &sig,
            &stale,
            NOW
        )
        .is_err());
        stale.owner_proof_consumed = true;
        stale.grant_pending = false;
        assert!(verify_reviewer_decision_readback(
            &serde_json::to_vec(&signed).unwrap(),
            &sig,
            &stale,
            NOW
        )
        .is_err());
    }
}
