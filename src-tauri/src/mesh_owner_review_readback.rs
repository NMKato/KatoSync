//! KatoSync Gate10 — native-only KATOOS owner readback transport (QA).
//! Reuses protected native KATOOS login; JWT NEVER enters WebView.
//! A server's signed assertion is NOT an independently trusted reviewer grant.
//! No production deploy, account/device mutation, Tauri token export or job rights.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;
use uuid::Uuid;
use zeroize::Zeroizing;

const ORIGIN: &str = "https://xbnnlyyxiilklsygxcof.supabase.co";
const ENDPOINT: &str =
    "https://xbnnlyyxiilklsygxcof.supabase.co/functions/v1/feature-owner-readback-qa";
const MAX_BODY: usize = 8192;
const FRESHNESS_MS: i128 = 15_000;
const SIGNATURE_AGE_MS: i128 = 60_000;
const SKEW_MS: i128 = 5_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gate10NativeReadback {
    protocol: &'static str,
    status: &'static str,
    owner_authenticated: bool,
    server_attestation_received: bool,
    independent_reviewer_verified: bool,
    grants_rights: bool,
    verified_percent: Option<u8>,
    remote_jobs_enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReviewerAttestation {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadbackEnvelope {
    protocol: String,
    state: String,
    subject_uid: String,
    decision_id: String,
    readback_at_ms: i64,
    attestation: ReviewerAttestation,
    reviewer_signature: String,
    authority_evidence_source: String,
    grants_rights: bool,
    verified_percent: serde_json::Value,
}

fn canonical_uid(v: &str) -> Option<Uuid> {
    let id = Uuid::parse_str(v).ok()?;
    (id.to_string() == v).then_some(id)
}
fn key_id(id: &str) -> bool {
    id.strip_prefix("ed25519-sha256:").is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    })
}
fn canonical_bytes(value: &str, expected_len: usize) -> Option<Vec<u8>> {
    let bytes = URL_SAFE_NO_PAD.decode(value).ok()?;
    (bytes.len() == expected_len && URL_SAFE_NO_PAD.encode(&bytes) == value).then_some(bytes)
}

/// Pure server ENVELOPE parser; it does not grant trust in the signer's key.
/// Native independent key pinning remains a separate authorization gate.
fn verify_untrusted_readback_shape(
    raw: &[u8],
    owner: &str,
    decision_id: &str,
    grant_id: &str,
    now_ms: i64,
) -> Result<(), &'static str> {
    if raw.is_empty()
        || raw.len() > MAX_BODY
        || canonical_uid(owner).is_none()
        || canonical_uid(decision_id).is_none()
        || canonical_uid(grant_id).is_none()
    {
        return Err("GATE10_READBACK_INVALID");
    }
    // Strict DIRECT typed parse also rejects duplicate keys. A conversion
    // through serde_json::Value would silently hide duplicate JSON fields.
    let body: ReadbackEnvelope =
        serde_json::from_slice(raw).map_err(|_| "GATE10_READBACK_INVALID")?;
    if body.protocol != "katosync.owner-review-readback/v1"
        || body.state != "server_signed_review_readback_not_native_authorization"
        || body.authority_evidence_source != "server_read_only_untrusted_until_native_recheck"
        || body.grants_rights
        || !body.verified_percent.is_null()
        || body.subject_uid != owner
        || body.decision_id != decision_id
    {
        return Err("GATE10_READBACK_NOT_AUTHORIZED");
    }
    let now = i128::from(now_ms);
    let at = i128::from(body.readback_at_ms);
    if at > now + SKEW_MS || at < now - FRESHNESS_MS {
        return Err("GATE10_READBACK_EXPIRED");
    }
    let signed = &body.attestation;
    if signed.protocol != "katosync.owner-independent-review/v1"
        || signed.grant_id != grant_id
        || signed.subject_uid != owner
        || signed.reviewer_uid == owner
        || canonical_uid(&signed.challenge_id).is_none()
        || canonical_uid(&signed.reviewer_uid).is_none()
        || signed.project_id.is_empty()
        || signed.project_id.len() > 80
        || !signed
            .project_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b':' | b'-'))
        || !key_id(&signed.owner_key_id)
        || !key_id(&signed.reviewer_key_id)
        || signed.grant_revision == 0
        || signed.reviewer_key_revision == 0
        || !matches!(signed.decision.as_str(), "approved" | "rejected")
        || signed.reason.len() < 12
        || signed.reason.len() > 1000
        || signed.reason.trim() != signed.reason
        || signed.reason.chars().any(|c| c.is_ascii_control())
    {
        return Err("GATE10_REVIEW_INVALID");
    }
    let issued = i128::from(signed.signed_at_ms);
    if issued > now + SKEW_MS || issued < now - SIGNATURE_AGE_MS {
        return Err("GATE10_REVIEW_EXPIRED");
    }
    let public_key =
        canonical_bytes(&signed.reviewer_public_key, 32).ok_or("GATE10_SIGNER_INVALID")?;
    if format!("ed25519-sha256:{:x}", Sha256::digest(public_key)) != signed.reviewer_key_id
        || canonical_bytes(&body.reviewer_signature, 64).is_none()
    {
        return Err("GATE10_SIGNER_INVALID");
    }
    // Existence/shape is NOT cryptographic authority. The reviewer key is
    // still from the same UNTRUSTED server response and is NOT pinned here.
    Ok(())
}

#[tauri::command]
pub async fn mesh_owner_review_readback_qa(
    decision_id: String,
    grant_id: String,
    expected_owner_uid: String,
) -> Result<Gate10NativeReadback, String> {
    // QA compiled only; env opt-in is separate and intentionally absent on
    // stable installations. This route never initiates reviewer enrolment.
    if !cfg!(feature = "katoos-auth-qa")
        || crate::KATOSYNC_AUTH_URL != ORIGIN
        || std::env::var("KATOSYNC_FEATURE_APPROVAL_STAGE").as_deref() != Ok("qa")
    {
        return Err("GATE10_NATIVE_QA_DISABLED".into());
    }
    if canonical_uid(&decision_id).is_none()
        || canonical_uid(&grant_id).is_none()
        || canonical_uid(&expected_owner_uid).is_none()
    {
        return Err("GATE10_INVALID_REFERENCE".into());
    }
    // Existing native trusted issuer proves current account without token
    // exposure to UI or client-provided fake account metadata.
    let owner = crate::github_app_auth::verified_katosync_user()
        .await
        .map_err(|_| "GATE10_NATIVE_LOGIN_REQUIRED".to_string())?;
    if owner != expected_owner_uid {
        return Err("GATE10_NATIVE_OWNER_CHANGED".into());
    }
    let token = Zeroizing::new(
        crate::ensure_supabase_access_token()
            .await
            .map_err(|_| "GATE10_NATIVE_LOGIN_REQUIRED".to_string())?,
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "GATE10_NATIVE_UNAVAILABLE".to_string())?;
    let response = client
        .post(ENDPOINT)
        .header("apikey", crate::KATOSYNC_AUTH_ANON_KEY)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("Cache-Control", "no-store")
        .bearer_auth(token.as_str())
        .body(
            serde_json::json!({
                "action": "readback", "decisionId": decision_id, "grantId": grant_id
            })
            .to_string(),
        )
        .send()
        .await
        .map_err(|_| "GATE10_NATIVE_UNAVAILABLE".to_string())?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err("GATE10_NATIVE_LOGIN_REQUIRED".into());
    }
    if response.status() != reqwest::StatusCode::OK {
        return Err("GATE10_NATIVE_UNAVAILABLE".into());
    }
    if !response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.to_ascii_lowercase().starts_with("application/json"))
        || !response
            .headers()
            .get("cache-control")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.to_ascii_lowercase().contains("no-store"))
    {
        return Err("GATE10_NATIVE_BAD_RESPONSE".into());
    }
    if response
        .content_length()
        .is_some_and(|v| v > MAX_BODY as u64)
    {
        return Err("GATE10_NATIVE_BAD_RESPONSE".into());
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "GATE10_NATIVE_UNAVAILABLE".to_string())?
    {
        if chunk.len() > MAX_BODY - bytes.len() {
            return Err("GATE10_NATIVE_BAD_RESPONSE".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    verify_untrusted_readback_shape(
        &bytes,
        &owner,
        &decision_id,
        &grant_id,
        chrono::Utc::now().timestamp_millis(),
    )
    .map_err(str::to_string)?;
    // Abort if any concurrent login/logout switched the account.
    crate::mesh_identity::same_account_still_verified(&owner)
        .await
        .map_err(|_| "GATE10_NATIVE_OWNER_CHANGED".to_string())?;

    // Do NOT return signature, key, decision string or JWT to WebView.
    // No reviewer authority has yet been independently pinned and checked.
    Ok(Gate10NativeReadback {
        protocol: "katosync.native-owner-review-readback-qa/v1",
        status: "server_attested_unverified",
        owner_authenticated: true,
        server_attestation_received: true,
        independent_reviewer_verified: false,
        grants_rights: false,
        verified_percent: None,
        remote_jobs_enabled: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    const OWNER: &str = "22222222-2222-4222-8222-222222222222";
    const REVIEWER: &str = "11111111-1111-4111-8111-111111111111";
    const GRANT: &str = "33333333-3333-4333-8333-333333333333";
    const CHALLENGE: &str = "44444444-4444-4444-8444-444444444444";
    const DECISION: &str = "55555555-5555-4555-8555-555555555555";
    const NOW: i64 = 1_793_829_600_000;
    fn review() -> serde_json::Value {
        let public = vec![41u8; 32];
        let pk = URL_SAFE_NO_PAD.encode(&public);
        let kid = format!("ed25519-sha256:{:x}", Sha256::digest(&public));
        serde_json::json!({
            "protocol":"katosync.owner-review-readback/v1",
            "state":"server_signed_review_readback_not_native_authorization",
            "subjectUid":OWNER, "decisionId":DECISION,
            "readbackAtMs":NOW-1000,"verifiedPercent":null,
            "grantsRights":false,
            "authorityEvidenceSource":"server_read_only_untrusted_until_native_recheck",
            "reviewerSignature":URL_SAFE_NO_PAD.encode([0u8;64]),
            "attestation":{
                "protocol":"katosync.owner-independent-review/v1",
                "grantId":GRANT,"challengeId":CHALLENGE,"projectId":"katosync",
                "subjectUid":OWNER,
                "ownerKeyId":format!("ed25519-sha256:{}", "e".repeat(64)),
                "grantRevision":3,"reviewerUid":REVIEWER,"reviewerKeyId":kid,
                "reviewerKeyRevision":2,"reviewerPublicKey":pk,
                "decision":"approved",
                "reason":"Synthetic QA reviewer verified owner possession",
                "signedAtMs":NOW-3000
            }
        })
    }
    fn validate(v: &serde_json::Value, at: i64) -> Result<(), &'static str> {
        verify_untrusted_readback_shape(&serde_json::to_vec(v).unwrap(), OWNER, DECISION, GRANT, at)
    }
    #[test]
    fn canonical_owner_scoped_envelope_is_only_unverified_transport_evidence() {
        assert_eq!(validate(&review(), NOW), Ok(()));
        assert!(verify_untrusted_readback_shape(
            &serde_json::to_vec(&review()).unwrap(),
            REVIEWER,
            DECISION,
            GRANT,
            NOW
        )
        .is_err());
    }
    #[test]
    fn metadata_elevation_other_account_and_stale_response_are_refused() {
        let mut v = review();
        v["grantsRights"] = serde_json::json!(true);
        assert!(validate(&v, NOW).is_err());
        let mut v = review();
        v["verifiedPercent"] = serde_json::json!(100);
        assert!(validate(&v, NOW).is_err());
        let mut v = review();
        v["subjectUid"] = serde_json::json!(REVIEWER);
        assert!(validate(&v, NOW).is_err());
        let mut v = review();
        v["decisionId"] = serde_json::json!(CHALLENGE);
        assert!(validate(&v, NOW).is_err());
        let mut v = review();
        v["readbackAtMs"] = serde_json::json!(NOW - 16000);
        assert!(validate(&v, NOW).is_err());
        let mut v = review();
        v["attestation"]["subjectUid"] = serde_json::json!(REVIEWER);
        assert!(validate(&v, NOW).is_err());
        let mut v = review();
        v["attestation"]["reviewerUid"] = serde_json::json!(OWNER);
        assert!(validate(&v, NOW).is_err());
    }
    #[test]
    fn repeated_missing_or_unknown_fields_fail_closed_even_with_valid_shape() {
        let mut v = review();
        v["autoMerge"] = serde_json::json!(true);
        assert!(validate(&v, NOW).is_err());
        let mut v = review();
        v.as_object_mut().unwrap().remove("grantsRights");
        assert!(validate(&v, NOW).is_err());
        let raw = serde_json::to_string(&review()).unwrap();
        let dup = raw.replacen(
            "\"grantsRights\":false",
            "\"grantsRights\":false,\"grantsRights\":false",
            1,
        );
        assert_ne!(dup, raw);
        assert!(
            verify_untrusted_readback_shape(dup.as_bytes(), OWNER, DECISION, GRANT, NOW).is_err()
        );
        let mut v = review();
        v["attestation"]["reviewerSignature"] = serde_json::json!("malicious");
        assert!(validate(&v, NOW).is_err());
    }
    #[test]
    fn signer_key_mismatch_and_malformed_review_denied_without_granting() {
        let mut v = review();
        v["attestation"]["reviewerKeyId"] =
            serde_json::json!(format!("ed25519-sha256:{}", "a".repeat(64)));
        assert!(validate(&v, NOW).is_err());
        let mut v = review();
        v["reviewerSignature"] = serde_json::json!("@");
        assert!(validate(&v, NOW).is_err());
        let mut v = review();
        v["attestation"]["signedAtMs"] = serde_json::json!(NOW - 61000);
        assert!(validate(&v, NOW).is_err());
        let mut v = review();
        v["attestation"]["decision"] = serde_json::json!("rejected");
        // Even a rejected decision can be fetched, but never yields authority.
        assert_eq!(validate(&v, NOW), Ok(()));
    }
}
