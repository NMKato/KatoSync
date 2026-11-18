// Created by NMKato Solutions
//! RC71: exact RC69 private-DO QA ticket and challenge wire compatibility.
//! No live admission: RC69's challenge is unsigned. Validating its JSON shape
//! NEVER authorizes a device, Keychain signing, online presence or tool call.
//! This module has no IPC caller; it is compiled only for isolated KatoOS QA.

use crate::mesh_rc70_outbound_wss_qa::{
    bounded_ws_config, close_quarantined_socket, validate_endpoint,
};
use futures_util::StreamExt;
use serde_json::Value;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::{sync::watch, time::timeout};
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{
        client::IntoClientRequest,
        http::{HeaderValue, Uri},
        protocol::Message,
    },
};

const RC69_PRIVATE_ROUTE: &str = "/private/rc69/device-wss";
const TICKET_TTL_MS: u64 = 30_000;
const READ_CHALLENGE_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_SAFE_JS_INT: u64 = 9_007_199_254_740_991;

/// An ephemeral private QA admission ticket, not an authorization record.
/// No Clone or Debug: never disclose ticket bytes in logs, events or errors.
/// The server must *independently* verify KatoOS Owner/Device/Grant/Consent;
/// the current DO's synthetic admitQaSession is not that authority.
pub(crate) struct Rc69QaOneTimeTicket {
    secret: String,
    expires_at_ms: u64,
}

fn now_ms() -> Result<u64, &'static str> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "RC71_CLOCK_UNAVAILABLE")?;
    u64::try_from(now.as_millis()).map_err(|_| "RC71_CLOCK_UNAVAILABLE")
}

impl Rc69QaOneTimeTicket {
    pub(crate) fn new(secret: &str, expires_at_ms: u64) -> Result<Self, &'static str> {
        let now = now_ms()?;
        if secret.len() != 64
            || !secret
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || expires_at_ms <= now
            || expires_at_ms > now.saturating_add(TICKET_TTL_MS)
            || expires_at_ms > MAX_SAFE_JS_INT
        {
            return Err("RC71_QA_TICKET_REJECTED");
        }
        Ok(Self {
            secret: secret.to_owned(),
            expires_at_ms,
        })
    }
}

/// Strictly identifies the *shape* of RC69's currently unsigned QA challenge.
/// Never promote its fields to verified session/device identity.
fn matches_unsigned_rc69_qa_challenge(text: &str) -> bool {
    let Ok(doc) = serde_json::from_str::<Value>(text) else {
        return false;
    };
    let Some(map) = doc.as_object() else {
        return false;
    };
    if map.len() != 12
        || doc["type"] != "rc69.challenge"
        || doc["version"] != 1
        || doc["protocol"] != "rc67-beta-native-v1"
        || doc["transport"] != "outbound-wss"
        || doc["expectedDirection"] != "device_to_cloud"
        || doc["frameTtlMs"] != 15_000
    {
        return false;
    }
    for name in ["sessionId", "challengeId"] {
        let Some(id) = doc[name].as_str() else {
            return false;
        };
        let Ok(id) = uuid::Uuid::parse_str(id) else {
            return false;
        };
        if !(1..=8).contains(&id.get_version_num())
            || !matches!(id.get_variant(), uuid::Variant::RFC4122)
        {
            return false;
        }
    }
    let Some(issued) = doc["nonceIssuedAtMs"].as_u64() else {
        return false;
    };
    let Some(challenge_expires) = doc["challengeExpiresAtMs"].as_u64() else {
        return false;
    };
    let Some(session_expires) = doc["expiresAtMs"].as_u64() else {
        return false;
    };
    let Some(revoke_epoch) = doc["revokeEpoch"].as_u64() else {
        return false;
    };
    issued > 0
        && issued <= MAX_SAFE_JS_INT
        && challenge_expires > issued
        && challenge_expires - issued <= 60_000
        && session_expires > issued
        && session_expires <= MAX_SAFE_JS_INT
        && revoke_epoch <= MAX_SAFE_JS_INT
}

/// Makes exactly ONE ticketed WSS attempt to the known private RC69 path.
/// **Never retries an already consumed ticket.** In this contract version even
/// a well-formed QA challenge is unsigned: always send policy close 1008 and
/// return an explicit NO-GO. The future production path requires server JWS,
/// pinned server public key/rotation and verified KatoOS admission before any
/// heartbeat, native read handler or signed tool.result can be dispatched.
pub(crate) async fn probe_private_rc69_qa_upgrade(
    endpoint: &str,
    ticket: Rc69QaOneTimeTicket,
    mut stop: watch::Receiver<bool>,
) -> Result<(), &'static str> {
    validate_endpoint(endpoint)?;
    let uri: Uri = endpoint.parse().map_err(|_| "RC71_QA_ENDPOINT_REJECTED")?;
    if uri.path() != RC69_PRIVATE_ROUTE {
        return Err("RC71_QA_ENDPOINT_REJECTED");
    }
    if ticket.expires_at_ms <= now_ms()? {
        return Err("RC71_QA_TICKET_EXPIRED");
    }

    let mut request = endpoint
        .into_client_request()
        .map_err(|_| "RC71_QA_ENDPOINT_REJECTED")?;
    request.headers_mut().insert(
        "X-KatoSync-Relay-Ticket",
        HeaderValue::from_str(&ticket.secret).map_err(|_| "RC71_QA_TICKET_REJECTED")?,
    );
    // No tokens in query params, no extra HTTP auth headers, no auth/session
    // assertions from a client message, and no retry once ticket is consumed.
    let connect = connect_async_with_config(request, Some(bounded_ws_config()), false);
    let dial = tokio::select! {
        result = timeout(Duration::from_secs(7), connect) => result,
        _ = stop.changed() => return Err("RC71_QA_STOPPED"),
    };
    let (mut socket, _response) = dial
        .map_err(|_| "RC71_QA_UPGRADE_TIMEOUT")?
        .map_err(|_| "RC71_QA_UPGRADE_NOT_AUTHORIZED")?;

    let received = tokio::select! {
        result = timeout(READ_CHALLENGE_TIMEOUT, socket.next()) => result,
        _ = stop.changed() => {
            close_quarantined_socket(&mut socket).await;
            return Err("RC71_QA_STOPPED");
        }
    };
    let recognized = match received {
        Ok(Some(Ok(Message::Text(text)))) => matches_unsigned_rc69_qa_challenge(&text),
        _ => false,
    };
    close_quarantined_socket(&mut socket).await;
    if recognized {
        Err("RC71_UNSIGNED_QA_CHALLENGE_REJECTED")
    } else {
        Err("RC71_QA_INCOMPATIBLE_CHALLENGE")
    }
}

/// RC73 source-QA-only: joins RC71's real ticketed WebSocket upgrade to the
/// *independently pinned* RC72 Ed25519 server challenge verifier. The trusted
/// pin and provisioned challenge MUST be obtained outside this websocket.
/// The socket is always closed after the one challenge: even a valid JWS
/// NEVER starts device presence, Keychain signing or native job dispatch.
/// No caller in the application runtime or MCP. Ticket is consumed once.
pub(crate) async fn probe_private_rc70_pinned_upgrade(
    endpoint: &str,
    ticket: Rc69QaOneTimeTicket,
    pinned_server: &crate::mesh_rc72_signed_server_qa::PinnedServerContext<'_>,
    provisioned_challenge_id: uuid::Uuid,
    provisioned_revoke_epoch: u64,
    last_server_sequence: u64,
    mut stop: watch::Receiver<bool>,
) -> Result<crate::mesh_rc72_signed_server_qa::VerifiedServerNotice, &'static str> {
    validate_endpoint(endpoint)?;
    let uri: Uri = endpoint.parse().map_err(|_| "RC73_QA_ENDPOINT_REJECTED")?;
    if uri.path() != RC69_PRIVATE_ROUTE {
        return Err("RC73_QA_ENDPOINT_REJECTED");
    }
    if ticket.expires_at_ms <= now_ms()? {
        return Err("RC73_QA_TICKET_EXPIRED");
    }
    if *stop.borrow() {
        return Err("RC73_QA_STOPPED");
    }
    let mut request = endpoint
        .into_client_request()
        .map_err(|_| "RC73_QA_ENDPOINT_REJECTED")?;
    request.headers_mut().insert(
        "X-KatoSync-Relay-Ticket",
        HeaderValue::from_str(&ticket.secret).map_err(|_| "RC73_QA_TICKET_REJECTED")?,
    );
    let connect = connect_async_with_config(request, Some(bounded_ws_config()), false);
    let dial = tokio::select! {
        result = timeout(Duration::from_secs(7), connect) => result,
        _ = stop.changed() => return Err("RC73_QA_STOPPED"),
    };
    let (mut socket, _response) = dial
        .map_err(|_| "RC73_QA_UPGRADE_TIMEOUT")?
        .map_err(|_| "RC73_QA_UPGRADE_REJECTED")?;
    let received = tokio::select! {
        result = timeout(READ_CHALLENGE_TIMEOUT, socket.next()) => result,
        _ = stop.changed() => {
            close_quarantined_socket(&mut socket).await;
            return Err("RC73_QA_STOPPED");
        }
    };
    let result = match received {
        Ok(Some(Ok(Message::Text(text)))) => {
            crate::mesh_rc72_signed_server_qa::verify_rc70_challenge_packet(
                &text,
                pinned_server,
                provisioned_challenge_id,
                provisioned_revoke_epoch,
                last_server_sequence,
                now_ms()?,
            )
        }
        _ => Err("RC73_SIGNED_CHALLENGE_REJECTED"),
    };
    // Deliberate source-QA boundary: DO NOT advertise online status or
    // send any signed device bytes even after authenticating the server JWS.
    close_quarantined_socket(&mut socket).await;
    result.map_err(|_| "RC73_SIGNED_CHALLENGE_REJECTED")
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use tokio::net::TcpListener;
    use tokio_tungstenite::{
        accept_hdr_async,
        tungstenite::{
            handshake::server::{Request, Response},
            protocol::{frame::coding::CloseCode, Message},
        },
    };

    #[test]
    fn denies_non_private_path_bad_ticket_or_expired_ticket() {
        assert!(Rc69QaOneTimeTicket::new("nope", now_ms().unwrap() + 500).is_err());
        assert!(Rc69QaOneTimeTicket::new(&"F".repeat(64), now_ms().unwrap() + 500).is_err());
        assert!(Rc69QaOneTimeTicket::new(&"a".repeat(64), now_ms().unwrap() - 1).is_err());
        assert!(Rc69QaOneTimeTicket::new(&"a".repeat(64), now_ms().unwrap() + 40_000).is_err());
        assert!(Rc69QaOneTimeTicket::new(&"a".repeat(64), now_ms().unwrap() + 20_000).is_ok());
    }

    #[test]
    fn parses_exact_unsigned_qa_challenge_but_never_trusts_it() {
        let mut doc = serde_json::json!({
            "type":"rc69.challenge", "version":1,
            "protocol":"rc67-beta-native-v1", "transport":"outbound-wss",
            "sessionId":uuid::Uuid::new_v4().to_string(),
            "challengeId":uuid::Uuid::new_v4().to_string(),
            "nonceIssuedAtMs": 1_794_940_000_000_u64,
            "challengeExpiresAtMs": 1_794_940_060_000_u64,
            "expiresAtMs": 1_794_940_120_000_u64,
            "revokeEpoch":5, "expectedDirection":"device_to_cloud",
            "frameTtlMs":15_000
        });
        assert!(matches_unsigned_rc69_qa_challenge(&doc.to_string()));
        doc["frameTtlMs"] = serde_json::json!(90_000);
        assert!(!matches_unsigned_rc69_qa_challenge(&doc.to_string()));
        doc["frameTtlMs"] = serde_json::json!(15_000);
        doc["ownerApproved"] = serde_json::json!(true);
        assert!(!matches_unsigned_rc69_qa_challenge(&doc.to_string()));
    }

    #[tokio::test]
    async fn actual_ticket_header_and_unsigned_challenge_are_rejected_fail_closed() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let saw_ticket = Arc::new(AtomicBool::new(false));
        let server_saw = Arc::clone(&saw_ticket);
        let backend = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut peer = accept_hdr_async(stream, move |req: &Request, response: Response| {
                assert_eq!(req.uri().path(), RC69_PRIVATE_ROUTE);
                assert_eq!(
                    req.headers()
                        .get("X-KatoSync-Relay-Ticket")
                        .unwrap()
                        .to_str()
                        .unwrap(),
                    "a".repeat(64)
                );
                server_saw.store(true, Ordering::SeqCst);
                Ok(response)
            })
            .await
            .unwrap();
            let now = now_ms().unwrap();
            let message = serde_json::json!({
                "type":"rc69.challenge", "version":1,
                "protocol":"rc67-beta-native-v1", "transport":"outbound-wss",
                "sessionId":uuid::Uuid::new_v4().to_string(),
                "challengeId":uuid::Uuid::new_v4().to_string(),
                "nonceIssuedAtMs":now,
                "challengeExpiresAtMs":now+60_000,
                "expiresAtMs":now+120_000,
                "revokeEpoch":5, "expectedDirection":"device_to_cloud",
                "frameTtlMs":15_000
            });
            peer.send(Message::Text(message.to_string().into()))
                .await
                .unwrap();
            let close = timeout(Duration::from_secs(3), peer.next()).await.unwrap();
            match close {
                Some(Ok(Message::Close(Some(frame)))) => assert_eq!(frame.code, CloseCode::Policy),
                other => panic!("Expected policy close, got {other:?}"),
            }
        });
        let ticket = Rc69QaOneTimeTicket::new(&"a".repeat(64), now_ms().unwrap() + 15_000).unwrap();
        let (_stop_tx, stop_rx) = watch::channel(false);
        let endpoint = format!("ws://127.0.0.1:{}{}", addr.port(), RC69_PRIVATE_ROUTE);
        let result = timeout(
            Duration::from_secs(5),
            probe_private_rc69_qa_upgrade(&endpoint, ticket, stop_rx),
        )
        .await
        .unwrap();
        assert_eq!(result, Err("RC71_UNSIGNED_QA_CHALLENGE_REJECTED"));
        backend.await.unwrap();
        assert!(saw_ticket.load(Ordering::SeqCst));
    }

    // Each case uses a genuine TCP+WebSocket upgrade and a genuine Ed25519
    // signature. The verifier pin is preselected independently of the frame.
    async fn signed_rc70_roundtrip(mode: u8) {
        use crate::mesh_rc72_signed_server_qa::PinnedServerContext;
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
        use ed25519_dalek::{Signer, SigningKey};
        use serde_json::json;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let owner = uuid::Uuid::new_v4();
        let tenant = uuid::Uuid::new_v4();
        let grant = uuid::Uuid::new_v4();
        let device = uuid::Uuid::new_v4();
        let session = uuid::Uuid::new_v4();
        let challenge = uuid::Uuid::new_v4();
        let request_id = uuid::Uuid::new_v4();
        let signer = SigningKey::from_bytes(&[81; 32]);
        let pin_key = if mode == 1 {
            SigningKey::from_bytes(&[82; 32]).verifying_key()
        } else {
            signer.verifying_key()
        };
        let pin = PinnedServerContext {
            kid: "rc70_qa_pinned_server_key_01",
            verifying_key: pin_key,
            owner_id: owner,
            tenant_id: tenant,
            grant_id: grant,
            device_id: device,
            session_id: if mode == 3 {
                uuid::Uuid::new_v4()
            } else {
                session
            },
        };
        let issued = now_ms().unwrap();
        let protected = json!({
            "alg":"EdDSA", "kid":"rc70_qa_pinned_server_key_01",
            "typ":"katosync-rc67-duplex-relay+jws"
        });
        let payload = json!({
            "version":1, "direction":"cloud_to_device", "kind":"mesh.notice",
            "ownerId":owner, "tenantId":tenant, "grantId":grant,
            "deviceId":device, "sessionId":session,
            "requestId":request_id, "sequence":1,
            "issuedAtMs":issued,"expiresAtMs":issued+15_000,
            "body":{"type":"rc70.challenge","challengeId":challenge,
                "protocol":"rc67-beta-native-v1","transport":"outbound-wss",
                "revokeEpoch":5}
        });
        let signed = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(protected.to_string()),
            URL_SAFE_NO_PAD.encode(payload.to_string())
        );
        let signed_jws = format!(
            "{}.{}",
            signed,
            URL_SAFE_NO_PAD.encode(signer.sign(signed.as_bytes()).to_bytes())
        );
        let mut packet = json!({
            "type":"rc69.challenge","version":1,
            "protocol":"rc67-beta-native-v1","transport":"outbound-wss",
            "sessionId":session,"challengeId":challenge,
            "nonceIssuedAtMs":issued,"challengeExpiresAtMs":issued+60_000,
            "expiresAtMs":issued+120_000,"revokeEpoch":5,
            "expectedDirection":"device_to_cloud","frameTtlMs":15_000,
            "serverProofJws":signed_jws,"serverKid":"rc70_qa_pinned_server_key_01"
        });
        if mode == 4 {
            packet.as_object_mut().unwrap().remove("serverProofJws");
        }
        let backend = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut peer = accept_hdr_async(stream, move |req: &Request, res: Response| {
                assert_eq!(req.uri().path(), RC69_PRIVATE_ROUTE);
                assert_eq!(
                    req.headers()
                        .get("X-KatoSync-Relay-Ticket")
                        .unwrap()
                        .to_str()
                        .unwrap(),
                    "c".repeat(64)
                );
                Ok(res)
            })
            .await
            .unwrap();
            peer.send(Message::Text(packet.to_string().into()))
                .await
                .unwrap();
            let closed = timeout(Duration::from_secs(3), peer.next()).await.unwrap();
            match closed {
                Some(Ok(Message::Close(Some(frame)))) => {
                    assert_eq!(frame.code, CloseCode::Policy);
                }
                other => panic!("RC73 must send only a policy close, got {other:?}"),
            }
        });
        let ticket = Rc69QaOneTimeTicket::new(&"c".repeat(64), now_ms().unwrap() + 20_000).unwrap();
        let (_stop_tx, stop_rx) = watch::channel(false);
        let endpoint = format!("ws://127.0.0.1:{}{}", addr.port(), RC69_PRIVATE_ROUTE);
        let result = timeout(
            Duration::from_secs(5),
            probe_private_rc70_pinned_upgrade(
                &endpoint,
                ticket,
                &pin,
                challenge,
                5,
                if mode == 2 { 1 } else { 0 },
                stop_rx,
            ),
        )
        .await
        .unwrap();
        if mode == 0 {
            let proof = result.unwrap();
            assert_eq!(proof.server_sequence, 1);
            assert_eq!(proof.request_id, request_id);
        } else {
            assert_eq!(result, Err("RC73_SIGNED_CHALLENGE_REJECTED"));
        }
        backend.await.unwrap();
    }

    #[tokio::test]
    async fn real_ticketed_wss_verifies_signed_rc70_challenge_but_closes_qa_socket() {
        signed_rc70_roundtrip(0).await;
    }
    #[tokio::test]
    async fn real_ticketed_wss_denies_wrong_pin_replay_wrong_session_and_unsigned_proof() {
        for mode in 1..=4 {
            signed_rc70_roundtrip(mode).await;
        }
    }

    #[tokio::test]
    async fn bad_route_never_reaches_network() {
        let ticket = Rc69QaOneTimeTicket::new(&"b".repeat(64), now_ms().unwrap() + 15_000).unwrap();
        let (_stop_tx, stop_rx) = watch::channel(false);
        assert_eq!(
            probe_private_rc69_qa_upgrade("wss://remote-mcp.katoos.de/mcp", ticket, stop_rx).await,
            Err("RC71_QA_ENDPOINT_REJECTED")
        );
    }
}
