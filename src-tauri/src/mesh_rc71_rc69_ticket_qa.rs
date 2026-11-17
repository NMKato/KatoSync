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
