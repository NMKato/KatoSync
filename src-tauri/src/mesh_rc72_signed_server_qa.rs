// Created by NMKato Solutions
//! RC72 source-QA verification of Connector RC70 signed server notice.
//! The trust pin MUST come from independently verified KatoOS enrollment,
//! never from a WebSocket message, its `serverKid`, or its embedded fields.
//! This module neither accesses Keychain nor sends a heartbeat or tool result.
//! No runtime registration, Tauri IPC, auto-start or network sockets.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

const MAX_JWS_BYTES: usize = 24_576;
const MAX_SAFE_JS_INTEGER: u64 = 9_007_199_254_740_991;
const FRAME_TTL_MS: u64 = 15_000;
const CLOCK_SKEW_MS: u64 = 5_000;
const JWS_TYP: &str = "katosync-rc67-duplex-relay+jws";
const RC69_CHALLENGE_FIELDS: usize = 14;
const DENIED: &str = "RC72_SIGNED_SERVER_PROOF_NOT_VERIFIED";

/// Created from independently authenticated owner/device enrollment, never
/// from anything received over the websocket being authenticated.
pub(crate) struct PinnedServerContext<'a> {
    pub(crate) kid: &'a str,
    pub(crate) verifying_key: VerifyingKey,
    pub(crate) owner_id: Uuid,
    pub(crate) tenant_id: Uuid,
    pub(crate) grant_id: Uuid,
    pub(crate) device_id: Uuid,
    pub(crate) session_id: Uuid,
}

pub(crate) enum ExpectedServerNotice {
    Challenge {
        challenge_id: Uuid,
        revoke_epoch: u64,
    },
    PresenceAccepted {
        challenge_id: Uuid,
        device_sequence: u64,
    },
    ResultAccepted {
        request_id: Uuid,
        device_sequence: u64,
    },
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct VerifiedServerNotice {
    pub(crate) server_sequence: u64,
    pub(crate) request_id: Uuid,
    pub(crate) expires_at_ms: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProtectedHeader {
    alg: String,
    kid: String,
    typ: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Rc67Frame {
    version: u8,
    direction: String,
    kind: String,
    owner_id: String,
    tenant_id: String,
    grant_id: String,
    device_id: String,
    session_id: String,
    request_id: String,
    sequence: u64,
    issued_at_ms: u64,
    expires_at_ms: u64,
    body: Value,
}

fn valid_uuid(id: &str) -> Result<Uuid, &'static str> {
    let value = Uuid::parse_str(id).map_err(|_| DENIED)?;
    if !(1..=8).contains(&value.get_version_num())
        || !matches!(value.get_variant(), uuid::Variant::RFC4122)
        || value.to_string() != id
    {
        return Err(DENIED);
    }
    Ok(value)
}

fn field_uuid(frame_id: &str, expected: Uuid) -> Result<(), &'static str> {
    if valid_uuid(frame_id)? != expected {
        return Err(DENIED);
    }
    Ok(())
}

fn exact_body<'a>(
    body: &'a Value,
    count: usize,
    kind: &str,
) -> Result<&'a serde_json::Map<String, Value>, &'static str> {
    let object = body.as_object().ok_or(DENIED)?;
    if object.len() != count || body.get("type").and_then(Value::as_str) != Some(kind) {
        return Err(DENIED);
    }
    Ok(object)
}

fn valid_pinned_kid(kid: &str) -> bool {
    (8..=80).contains(&kid.len())
        && kid
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Exact Ed25519 verifier for Connector `rc70SignServerNotice` JWS.
/// Scope and server key are out-of-band pinned, server sequence must increase,
/// and every outer frame is checked for its fixed 15-second lease.
pub(crate) fn verify_signed_server_notice(
    jws: &str,
    pin: &PinnedServerContext<'_>,
    expected: ExpectedServerNotice,
    last_server_sequence: u64,
    now_ms: u64,
) -> Result<VerifiedServerNotice, &'static str> {
    if jws.len() > MAX_JWS_BYTES
        || !valid_pinned_kid(pin.kid)
        || now_ms == 0
        || now_ms > MAX_SAFE_JS_INTEGER
        || last_server_sequence > MAX_SAFE_JS_INTEGER
    {
        return Err(DENIED);
    }
    let mut parts = jws.split('.');
    let (Some(head), Some(data), Some(sig), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(DENIED);
    };
    if head.is_empty()
        || head.len() > 1024
        || data.is_empty()
        || data.len() > MAX_JWS_BYTES
        || sig.len() != 86
    {
        return Err(DENIED);
    }
    let header: ProtectedHeader =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(head).map_err(|_| DENIED)?)
            .map_err(|_| DENIED)?;
    if header.alg != "EdDSA" || header.typ != JWS_TYP || header.kid != pin.kid {
        return Err(DENIED);
    }
    // A failure must never result in a partial trust decision. Verify the
    // original protected bytes before interpreting the claimed body/scope.
    let signature = Signature::from_slice(&URL_SAFE_NO_PAD.decode(sig).map_err(|_| DENIED)?)
        .map_err(|_| DENIED)?;
    pin.verifying_key
        .verify(format!("{head}.{data}").as_bytes(), &signature)
        .map_err(|_| DENIED)?;

    let payload: Rc67Frame =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(data).map_err(|_| DENIED)?)
            .map_err(|_| DENIED)?;
    if payload.version != 1
        || payload.direction != "cloud_to_device"
        || payload.kind != "mesh.notice"
        || payload.sequence <= last_server_sequence
        || payload.sequence > MAX_SAFE_JS_INTEGER
        || payload.issued_at_ms == 0
        || payload.issued_at_ms > MAX_SAFE_JS_INTEGER - FRAME_TTL_MS
        || payload.expires_at_ms != payload.issued_at_ms + FRAME_TTL_MS
        || now_ms >= payload.expires_at_ms
        || payload.issued_at_ms > now_ms.saturating_add(CLOCK_SKEW_MS)
    {
        return Err(DENIED);
    }
    field_uuid(&payload.owner_id, pin.owner_id)?;
    field_uuid(&payload.tenant_id, pin.tenant_id)?;
    field_uuid(&payload.grant_id, pin.grant_id)?;
    field_uuid(&payload.device_id, pin.device_id)?;
    field_uuid(&payload.session_id, pin.session_id)?;
    let request_id = valid_uuid(&payload.request_id)?;

    match expected {
        ExpectedServerNotice::Challenge {
            challenge_id,
            revoke_epoch,
        } => {
            let body = exact_body(&payload.body, 5, "rc70.challenge")?;
            if body.get("challengeId").and_then(Value::as_str)
                != Some(challenge_id.to_string().as_str())
                || body.get("protocol").and_then(Value::as_str) != Some("rc67-beta-native-v1")
                || body.get("transport").and_then(Value::as_str) != Some("outbound-wss")
                || body.get("revokeEpoch").and_then(Value::as_u64) != Some(revoke_epoch)
            {
                return Err(DENIED);
            }
        }
        ExpectedServerNotice::PresenceAccepted {
            challenge_id,
            device_sequence,
        } => {
            let body = exact_body(&payload.body, 3, "rc70.presence.accepted")?;
            if device_sequence == 0
                || device_sequence > MAX_SAFE_JS_INTEGER
                || body.get("challengeId").and_then(Value::as_str)
                    != Some(challenge_id.to_string().as_str())
                || body.get("acceptedSequence").and_then(Value::as_u64) != Some(device_sequence)
            {
                return Err(DENIED);
            }
        }
        ExpectedServerNotice::ResultAccepted {
            request_id: expected_id,
            device_sequence,
        } => {
            let body = exact_body(&payload.body, 3, "rc70.result.accepted")?;
            if device_sequence == 0
                || device_sequence > MAX_SAFE_JS_INTEGER
                || request_id != expected_id
                || body.get("requestId").and_then(Value::as_str)
                    != Some(expected_id.to_string().as_str())
                || body.get("acceptedSequence").and_then(Value::as_u64) != Some(device_sequence)
            {
                return Err(DENIED);
            }
        }
    }
    Ok(VerifiedServerNotice {
        server_sequence: payload.sequence,
        request_id,
        expires_at_ms: payload.expires_at_ms,
    })
}

/// RC69 12 JSON fields + RC70 serverProofJws and serverKid. These plaintext
/// fields are only compatibility markers: the signed JWS must independently
/// validate scope, pinned kid, session, challenge and revocation epoch.
/// This does not authorize sending anything and has no runtime caller.
pub(crate) fn verify_rc70_challenge_packet(
    packet: &str,
    pin: &PinnedServerContext<'_>,
    provisioned_challenge_id: Uuid,
    provisioned_revoke_epoch: u64,
    last_server_sequence: u64,
    now_ms: u64,
) -> Result<VerifiedServerNotice, &'static str> {
    if packet.len() > MAX_JWS_BYTES {
        return Err(DENIED);
    }
    let doc: Value = serde_json::from_str(packet).map_err(|_| DENIED)?;
    let map = doc.as_object().ok_or(DENIED)?;
    if map.len() != RC69_CHALLENGE_FIELDS
        || doc["type"] != "rc69.challenge"
        || doc["version"] != 1
        || doc["protocol"] != "rc67-beta-native-v1"
        || doc["transport"] != "outbound-wss"
        || doc["expectedDirection"] != "device_to_cloud"
        || doc["frameTtlMs"] != FRAME_TTL_MS
        || doc["serverKid"].as_str() != Some(pin.kid)
        || doc["sessionId"].as_str() != Some(pin.session_id.to_string().as_str())
        || doc["challengeId"].as_str() != Some(provisioned_challenge_id.to_string().as_str())
        || doc["revokeEpoch"].as_u64() != Some(provisioned_revoke_epoch)
    {
        return Err(DENIED);
    }
    let issued = doc["nonceIssuedAtMs"].as_u64().ok_or(DENIED)?;
    let expires = doc["challengeExpiresAtMs"].as_u64().ok_or(DENIED)?;
    let session_expires = doc["expiresAtMs"].as_u64().ok_or(DENIED)?;
    if issued == 0
        || expires <= issued
        || expires - issued > 60_000
        || session_expires <= issued
        || session_expires > MAX_SAFE_JS_INTEGER
        || now_ms >= expires
        || now_ms >= session_expires
    {
        return Err(DENIED);
    }
    let jws = doc["serverProofJws"].as_str().ok_or(DENIED)?;
    verify_signed_server_notice(
        jws,
        pin,
        ExpectedServerNotice::Challenge {
            challenge_id: provisioned_challenge_id,
            revoke_epoch: provisioned_revoke_epoch,
        },
        last_server_sequence,
        now_ms,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use serde_json::json;

    struct Fixture {
        key: SigningKey,
        scope: [Uuid; 5],
        challenge: Uuid,
        request: Uuid,
        now: u64,
    }
    impl Fixture {
        fn new() -> Self {
            Self {
                key: SigningKey::from_bytes(&[91_u8; 32]),
                scope: [
                    Uuid::new_v4(),
                    Uuid::new_v4(),
                    Uuid::new_v4(),
                    Uuid::new_v4(),
                    Uuid::new_v4(),
                ],
                challenge: Uuid::new_v4(),
                request: Uuid::new_v4(),
                now: 1_795_000_000_000,
            }
        }
        fn pin(&self) -> PinnedServerContext<'_> {
            PinnedServerContext {
                kid: "rc70_server_pinned_qa_01",
                verifying_key: self.key.verifying_key(),
                owner_id: self.scope[0],
                tenant_id: self.scope[1],
                grant_id: self.scope[2],
                device_id: self.scope[3],
                session_id: self.scope[4],
            }
        }
        fn sign(
            &self,
            kind: &str,
            body: Value,
            sequence: u64,
            request_id: Uuid,
            issuer_ms: u64,
        ) -> String {
            let protected = json!({"alg":"EdDSA","kid":"rc70_server_pinned_qa_01","typ":JWS_TYP});
            let payload = json!({
                "version":1,"direction":"cloud_to_device","kind":"mesh.notice",
                "ownerId":self.scope[0],"tenantId":self.scope[1],"grantId":self.scope[2],
                "deviceId":self.scope[3],"sessionId":self.scope[4],
                "requestId":request_id,"sequence":sequence,
                "issuedAtMs":issuer_ms,"expiresAtMs":issuer_ms+15_000,"body":body
            });
            let header64 = URL_SAFE_NO_PAD.encode(protected.to_string());
            let payload64 = URL_SAFE_NO_PAD.encode(payload.to_string());
            let message = format!("{header64}.{payload64}");
            let signature = self.key.sign(message.as_bytes());
            assert_eq!(kind, "mesh.notice");
            format!("{message}.{}", URL_SAFE_NO_PAD.encode(signature.to_bytes()))
        }
        fn challenge_jws(&self) -> String {
            self.sign(
                "mesh.notice",
                json!({
                    "type":"rc70.challenge",
                    "challengeId":self.challenge,
                    "protocol":"rc67-beta-native-v1",
                    "transport":"outbound-wss","revokeEpoch":5
                }),
                1,
                self.request,
                self.now,
            )
        }
        fn packet(&self, jws: &str) -> String {
            json!({
                "type":"rc69.challenge","version":1,
                "protocol":"rc67-beta-native-v1","transport":"outbound-wss",
                "sessionId":self.scope[4],"challengeId":self.challenge,
                "nonceIssuedAtMs":self.now,"challengeExpiresAtMs":self.now+60_000,
                "expiresAtMs":self.now+120_000,"revokeEpoch":5,
                "expectedDirection":"device_to_cloud","frameTtlMs":15_000,
                "serverProofJws":jws,"serverKid":"rc70_server_pinned_qa_01"
            })
            .to_string()
        }
    }

    #[test]
    fn actual_signed_ed25519_rc70_challenge_matches_pinned_scope_and_packet() {
        let f = Fixture::new();
        let jws = f.challenge_jws();
        let got =
            verify_rc70_challenge_packet(&f.packet(&jws), &f.pin(), f.challenge, 5, 0, f.now + 100)
                .unwrap();
        assert_eq!(got.server_sequence, 1);
        assert_eq!(got.request_id, f.request);
        assert_eq!(got.expires_at_ms, f.now + 15_000);
    }
    #[test]
    fn rejects_wrong_pin_scope_expiration_replay_and_tampering() {
        let f = Fixture::new();
        let jws = f.challenge_jws();
        let wrong = SigningKey::from_bytes(&[92_u8; 32]);
        let mut p = f.pin();
        p.verifying_key = wrong.verifying_key();
        assert_eq!(
            verify_rc70_challenge_packet(&f.packet(&jws), &p, f.challenge, 5, 0, f.now + 100),
            Err(DENIED)
        );
        let mut p = f.pin();
        p.tenant_id = Uuid::new_v4();
        assert_eq!(
            verify_rc70_challenge_packet(&f.packet(&jws), &p, f.challenge, 5, 0, f.now + 100),
            Err(DENIED)
        );
        assert_eq!(
            verify_rc70_challenge_packet(&f.packet(&jws), &f.pin(), f.challenge, 5, 1, f.now + 100),
            Err(DENIED)
        );
        assert_eq!(
            verify_rc70_challenge_packet(
                &f.packet(&jws),
                &f.pin(),
                f.challenge,
                5,
                0,
                f.now + 15_000
            ),
            Err(DENIED)
        );
        let changed = format!("{}{}", &jws[..jws.len() - 5], "tampr");
        assert_eq!(
            verify_rc70_challenge_packet(
                &f.packet(&changed),
                &f.pin(),
                f.challenge,
                5,
                0,
                f.now + 100
            ),
            Err(DENIED)
        );
    }
    #[test]
    fn rejects_unsigned_packet_unpinned_kid_and_false_claims() {
        let f = Fixture::new();
        let jws = f.challenge_jws();
        let mut pkt: Value = serde_json::from_str(&f.packet(&jws)).unwrap();
        pkt.as_object_mut().unwrap().remove("serverProofJws");
        assert_eq!(
            verify_rc70_challenge_packet(
                &pkt.to_string(),
                &f.pin(),
                f.challenge,
                5,
                0,
                f.now + 100
            ),
            Err(DENIED)
        );
        pkt = serde_json::from_str(&f.packet(&jws)).unwrap();
        pkt["serverKid"] = json!("client_supplied_kid_02");
        assert_eq!(
            verify_rc70_challenge_packet(
                &pkt.to_string(),
                &f.pin(),
                f.challenge,
                5,
                0,
                f.now + 100
            ),
            Err(DENIED)
        );
        pkt = serde_json::from_str(&f.packet(&jws)).unwrap();
        pkt["ownerApproved"] = json!(true);
        assert_eq!(
            verify_rc70_challenge_packet(
                &pkt.to_string(),
                &f.pin(),
                f.challenge,
                5,
                0,
                f.now + 100
            ),
            Err(DENIED)
        );
    }
    #[test]
    fn independently_verifies_signed_presence_and_request_bound_result_acks() {
        let f = Fixture::new();
        let presence = f.sign(
            "mesh.notice",
            json!({
                "type":"rc70.presence.accepted","challengeId":f.challenge,"acceptedSequence":9
            }),
            2,
            Uuid::new_v4(),
            f.now,
        );
        let good = verify_signed_server_notice(
            &presence,
            &f.pin(),
            ExpectedServerNotice::PresenceAccepted {
                challenge_id: f.challenge,
                device_sequence: 9,
            },
            1,
            f.now + 100,
        )
        .unwrap();
        assert_eq!(good.server_sequence, 2);
        let result = f.sign(
            "mesh.notice",
            json!({
                "type":"rc70.result.accepted","requestId":f.request,"acceptedSequence":10
            }),
            4,
            f.request,
            f.now,
        );
        let good = verify_signed_server_notice(
            &result,
            &f.pin(),
            ExpectedServerNotice::ResultAccepted {
                request_id: f.request,
                device_sequence: 10,
            },
            3,
            f.now + 100,
        )
        .unwrap();
        assert_eq!(good.request_id, f.request);
        assert_eq!(
            verify_signed_server_notice(
                &result,
                &f.pin(),
                ExpectedServerNotice::ResultAccepted {
                    request_id: Uuid::new_v4(),
                    device_sequence: 10
                },
                3,
                f.now + 100
            ),
            Err(DENIED)
        );
    }
}
