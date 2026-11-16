// NMKato Solutions — Stage4AI source-only RC66K wire-contract verification.
// This parser verifies CONTROL-PLANE QA ACK, NOT DEVICE DELIVERY OR EXECUTION.
// No network, trust-on-first-use, public IPC, production keys or remote rights.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

const MAX_JWS_BYTES: usize = 4096;
const MAX_PAYLOAD_BYTES: usize = 2048;
const MAX_HEADER_BYTES: usize = 300;
const RC66K_KIND: &str = "RC66K_CONTROL_PLANE_QA_ACK";
const RC66K_TYP: &str = "katosync-rc66k-qa-invalidate-ack+jws";

#[derive(Debug, Clone, PartialEq, Eq)]
struct QaRc66kClaim {
    audit_id: String,
    worker_id: String,
    lease_token: String,
    owner_id: String,
    grant_id: String,
    device_id: Option<String>,
    consent_id: Option<String>,
    action: String,
    leased_until_ms: u64,
    attempt: u8,
}
#[derive(Debug, Clone)]
struct QaRc66kEnvelope {
    payload_text: String,
    jws: String,
    sha256: String,
}
#[derive(Debug, PartialEq, Eq)]
struct VerifiedControlPlaneAck {
    audit_id: String,
    owner_id: String,
    grant_id: String,
    device_id: Option<String>,
    action: String,
    payload_digest: [u8; 32],
    // Intentionally NO task, session, consent-to-execute or device-ACK bit.
}
#[derive(Debug, PartialEq, Eq)]
enum Denial {
    Malformed,
    Signature,
    Identity,
    Stale,
}

fn vstr<'a>(v: &'a Value, key: &str) -> Result<&'a str, Denial> {
    v.get(key).and_then(Value::as_str).ok_or(Denial::Malformed)
}
fn is_uuid(v: &str) -> bool {
    let x = v.as_bytes();
    if x.len() != 36 || ![8, 13, 18, 23].iter().all(|i| x[*i] == b'-') {
        return false;
    }
    b"12345678".contains(&x[14])
        && b"89abAB".contains(&x[19])
        && x.iter()
            .enumerate()
            .all(|(i, c)| [8, 13, 18, 23].contains(&i) || c.is_ascii_hexdigit())
}
fn valid_claim(e: &QaRc66kClaim) -> bool {
    is_uuid(&e.audit_id)
        && is_uuid(&e.lease_token)
        && is_uuid(&e.worker_id)
        && is_uuid(&e.owner_id)
        && is_uuid(&e.grant_id)
        && e.device_id.as_deref().is_none_or(is_uuid)
        && e.consent_id.as_deref().is_none_or(is_uuid)
        && match e.action.as_str() {
            "revoke_device" | "approve_device" => {
                e.device_id.as_deref().is_some_and(is_uuid)
                    && e.consent_id.as_deref().is_some_and(is_uuid)
            }
            "revoke_client" | "approve_client" => e.device_id.is_none() && e.consent_id.is_none(),
            _ => false,
        }
        && e.leased_until_ms > 0
        && e.leased_until_ms <= 9_007_199_254_740_991
        && (1..=20).contains(&e.attempt)
}
fn hex_lower_digest(data: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let h: [u8; 32] = Sha256::digest(data).into();
    let mut result = String::with_capacity(64);
    for b in &h {
        result.push(H[(b >> 4) as usize] as char);
        result.push(H[(b & 15) as usize] as char);
    }
    result
}
fn exact_payload_fields(value: &Value) -> Result<&Map<String, Value>, Denial> {
    value.as_object().ok_or(Denial::Malformed)
}
fn opt_json_str(v: &Value, key: &str) -> Result<Option<String>, Denial> {
    match v.get(key) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.to_owned())),
        _ => Err(Denial::Malformed),
    }
}
// Independent pinned key comes from the trusted QA fixture, NEVER from JWS.
// This maps the *current RC66K JavaScript acknowledgement wire shape* only.
fn verify_rc66k_control_plane_ack(
    claim: &QaRc66kClaim,
    envelope: &QaRc66kEnvelope,
    pinned_server_key: &VerifyingKey,
    pinned_kid: &str,
    now_ms: u64,
) -> Result<VerifiedControlPlaneAck, Denial> {
    if !valid_claim(claim)
        || pinned_kid.len() < 8
        || pinned_kid.len() > 80
        || !pinned_kid
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        || claim.leased_until_ms <= now_ms
        || envelope.jws.len() > MAX_JWS_BYTES
        || envelope.payload_text.len() > MAX_PAYLOAD_BYTES
        || envelope.payload_text.is_empty()
        || envelope.sha256 != hex_lower_digest(envelope.payload_text.as_bytes())
    {
        return Err(Denial::Malformed);
    }
    let mut parts = envelope.jws.split('.');
    let (Some(h), Some(p), Some(s), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(Denial::Malformed);
    };
    if h.len() > 400 || p.len() > 2800 || s.len() != 86 {
        return Err(Denial::Malformed);
    }
    let raw_header = URL_SAFE_NO_PAD.decode(h).map_err(|_| Denial::Malformed)?;
    if raw_header.len() > MAX_HEADER_BYTES {
        return Err(Denial::Malformed);
    }
    let header: Value = serde_json::from_slice(&raw_header).map_err(|_| Denial::Malformed)?;
    if exact_payload_fields(&header)?.len() != 3
        || vstr(&header, "alg")? != "EdDSA"
        || vstr(&header, "typ")? != RC66K_TYP
        || vstr(&header, "kid")? != pinned_kid
    {
        return Err(Denial::Malformed);
    }
    let payload = URL_SAFE_NO_PAD.decode(p).map_err(|_| Denial::Malformed)?;
    if payload != envelope.payload_text.as_bytes() {
        return Err(Denial::Malformed);
    }
    let signature_bytes = URL_SAFE_NO_PAD.decode(s).map_err(|_| Denial::Malformed)?;
    let signature_raw: [u8; 64] = signature_bytes.try_into().map_err(|_| Denial::Malformed)?;
    let signed_input = format!("{h}.{p}");
    pinned_server_key
        .verify(
            signed_input.as_bytes(),
            &Signature::from_bytes(&signature_raw),
        )
        .map_err(|_| Denial::Signature)?;

    let receipt: Value = serde_json::from_slice(&payload).map_err(|_| Denial::Malformed)?;
    let obj = exact_payload_fields(&receipt)?;
    if obj.len() != 14
        || receipt.get("version").and_then(Value::as_u64) != Some(1)
        || vstr(&receipt, "kind")? != RC66K_KIND
        || receipt.get("controlPlaneInvalidated") != Some(&Value::Bool(true))
        || vstr(&receipt, "receivingSystem")? != "synthetic-control-plane"
        || vstr(&receipt, "auditId")? != claim.audit_id
        || vstr(&receipt, "workerId")? != claim.worker_id
        || vstr(&receipt, "leaseToken")? != claim.lease_token
        || vstr(&receipt, "ownerId")? != claim.owner_id
        || vstr(&receipt, "grantId")? != claim.grant_id
        || opt_json_str(&receipt, "deviceId")? != claim.device_id
        || opt_json_str(&receipt, "consentId")? != claim.consent_id
        || vstr(&receipt, "action")? != claim.action
    {
        return Err(Denial::Identity);
    }
    let issued = receipt
        .get("issuedAtMs")
        .and_then(Value::as_u64)
        .ok_or(Denial::Stale)?;
    let expires = receipt
        .get("expiresAtMs")
        .and_then(Value::as_u64)
        .ok_or(Denial::Stale)?;
    if issued > now_ms
        || expires <= now_ms
        || expires.saturating_sub(issued) != 30_000
        || expires > 9_007_199_254_740_991
    {
        return Err(Denial::Stale);
    }
    Ok(VerifiedControlPlaneAck {
        audit_id: claim.audit_id.clone(),
        owner_id: claim.owner_id.clone(),
        grant_id: claim.grant_id.clone(),
        device_id: claim.device_id.clone(),
        action: claim.action.clone(),
        payload_digest: Sha256::digest(&payload).into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use serde_json::json;
    const NOW: u64 = 1_800_000_000_000;
    const A: &str = "550e8400-e29b-41d4-a716-446655440001";
    const B: &str = "550e8400-e29b-41d4-a716-446655440002";
    const C: &str = "550e8400-e29b-41d4-a716-446655440003";
    const D: &str = "550e8400-e29b-41d4-a716-446655440004";
    const E: &str = "550e8400-e29b-41d4-a716-446655440005";
    const F: &str = "550e8400-e29b-41d4-a716-446655440006";
    const G: &str = "550e8400-e29b-41d4-a716-446655440007";
    fn key() -> SigningKey {
        SigningKey::from_bytes(&[71; 32])
    }
    fn claim() -> QaRc66kClaim {
        QaRc66kClaim {
            audit_id: A.into(),
            lease_token: B.into(),
            worker_id: C.into(),
            owner_id: D.into(),
            grant_id: E.into(),
            consent_id: Some(F.into()),
            device_id: Some(G.into()),
            action: "revoke_device".into(),
            leased_until_ms: NOW + 20_000,
            attempt: 1,
        }
    }
    fn envelope(c: &QaRc66kClaim) -> QaRc66kEnvelope {
        let p = json!({
            "version":1,"kind":RC66K_KIND,"controlPlaneInvalidated":true,
            "receivingSystem":"synthetic-control-plane",
            "auditId":c.audit_id,"leaseToken":c.lease_token,
            "workerId":c.worker_id,"ownerId":c.owner_id,
            "grantId":c.grant_id,"consentId":c.consent_id,
            "deviceId":c.device_id,"action":c.action,
            "issuedAtMs": NOW-100,"expiresAtMs":NOW+29_900
        })
        .to_string();
        let h = json!({"alg":"EdDSA","kid":"pinnedQA01","typ":RC66K_TYP}).to_string();
        let unsigned = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(h.as_bytes()),
            URL_SAFE_NO_PAD.encode(p.as_bytes())
        );
        let sig = key().sign(unsigned.as_bytes()).to_bytes();
        QaRc66kEnvelope {
            sha256: hex_lower_digest(p.as_bytes()),
            payload_text: p,
            jws: format!("{}.{}", unsigned, URL_SAFE_NO_PAD.encode(sig)),
        }
    }
    fn verify(c: &QaRc66kClaim, e: &QaRc66kEnvelope) -> Result<VerifiedControlPlaneAck, Denial> {
        verify_rc66k_control_plane_ack(c, e, &key().verifying_key(), "pinnedQA01", NOW)
    }
    #[test]
    fn real_ed25519_compact_jws_matches_rc66k_qa_ack_without_device_claim() {
        let c = claim();
        let e = envelope(&c);
        let a = verify(&c, &e).unwrap();
        assert_eq!(a.action, "revoke_device");
        assert_eq!(a.audit_id, c.audit_id);
        assert_eq!(a.device_id, c.device_id);
        // A CONTROL-PLANE ACK cannot attest a task-scoped device revoke.
    }
    #[test]
    fn wrong_key_header_kid_and_modified_signature_fail() {
        let c = claim();
        let e = envelope(&c);
        let wrong = SigningKey::from_bytes(&[90; 32]).verifying_key();
        assert_eq!(
            verify_rc66k_control_plane_ack(&c, &e, &wrong, "pinnedQA01", NOW),
            Err(Denial::Signature)
        );
        assert_eq!(
            verify_rc66k_control_plane_ack(&c, &e, &key().verifying_key(), "evilQA12", NOW),
            Err(Denial::Malformed)
        );
        let mut tampered = e.clone();
        tampered.jws.push('A');
        assert!(verify(&c, &tampered).is_err());
    }
    #[test]
    fn wrong_audit_grant_owner_or_lease_and_stale_ack_are_rejected() {
        let c = claim();
        let e = envelope(&c);
        let mut bad = c.clone();
        bad.audit_id = B.into();
        assert_eq!(verify(&bad, &e), Err(Denial::Identity));
        bad = c.clone();
        bad.grant_id = A.into();
        assert_eq!(verify(&bad, &e), Err(Denial::Identity));
        bad = c.clone();
        bad.owner_id = C.into();
        assert_eq!(verify(&bad, &e), Err(Denial::Identity));
        bad = c.clone();
        bad.lease_token = A.into();
        assert_eq!(verify(&bad, &e), Err(Denial::Identity));
        bad = c.clone();
        bad.leased_until_ms = NOW;
        assert_eq!(verify(&bad, &e), Err(Denial::Malformed));
        assert_eq!(
            verify_rc66k_control_plane_ack(
                &c,
                &e,
                &key().verifying_key(),
                "pinnedQA01",
                NOW + 31_000
            ),
            Err(Denial::Malformed)
        );
    }
    #[test]
    fn payload_hash_and_compact_segments_require_byte_exactness() {
        let c = claim();
        let mut e = envelope(&c);
        e.payload_text.push(' ');
        assert_eq!(verify(&c, &e), Err(Denial::Malformed));
        e = envelope(&c);
        e.sha256 = "0".repeat(64);
        assert_eq!(verify(&c, &e), Err(Denial::Malformed));
        e = envelope(&c);
        e.jws.push_str(".extra");
        assert_eq!(verify(&c, &e), Err(Denial::Malformed));
    }
    #[test]
    fn invalid_uuid_version_variant_attempt_or_unbounded_json_integer_fail_closed() {
        let c = claim();
        let e = envelope(&c);
        let mut invalid = c.clone();
        invalid.audit_id = "550e8400-e29b-01d4-a716-446655440001".into();
        assert_eq!(verify(&invalid, &e), Err(Denial::Malformed));
        invalid = c.clone();
        invalid.audit_id = "550e8400-e29b-41d4-f716-446655440001".into();
        assert_eq!(verify(&invalid, &e), Err(Denial::Malformed));
        invalid = c.clone();
        invalid.attempt = 0;
        assert_eq!(verify(&invalid, &e), Err(Denial::Malformed));
        invalid = c.clone();
        invalid.attempt = 21;
        assert_eq!(verify(&invalid, &e), Err(Denial::Malformed));
        invalid = c.clone();
        invalid.leased_until_ms = u64::MAX;
        assert_eq!(verify(&invalid, &e), Err(Denial::Malformed));
    }
    #[test]
    fn client_ack_cannot_be_misrepresented_as_device_revoke() {
        let mut c = claim();
        c.action = "revoke_client".into();
        c.device_id = None;
        c.consent_id = None;
        let ack = verify(&c, &envelope(&c)).unwrap();
        assert_eq!(ack.action, "revoke_client");
        assert_eq!(ack.device_id, None);
    }
}
