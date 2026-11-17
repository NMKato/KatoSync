// Created by NMKato Solutions
//! RC70 Desktop outbound WSS transport supervisor. Strictly isolated QA-only.
//! A TLS WebSocket upgrade is NOT an authenticated KatoSync device session.
//! Until Connector RC69 publishes a signed server challenge, this supervisor
//! quarantines all inbound application frames: no native tools, no presence,
//! no credentials, no device claims, no background startup, and no IPC.
//! Production URL is allowlisted by hostname; a loopback ws:// exception is
//! available ONLY when Rust compiles its local unit tests.

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio::time::{sleep, timeout};
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{
        http::Uri,
        protocol::{frame::coding::CloseCode, CloseFrame, Message, WebSocketConfig},
    },
};

const RELAY_HOST: &str = "remote-mcp.katoos.de";
const MAX_SIGNED_FRAME_BYTES: usize = 24_576;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(7);
const SERVER_CHALLENGE_WAIT: Duration = Duration::from_secs(5);
const MAX_RECONNECT_DELAY: Duration = Duration::from_secs(16);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RelayTransportEvent {
    Connecting,
    TransportOpenUnverified,
    ContractRequired,
    ChallengeTimeout,
    TransportDropped,
    ReconnectScheduled,
    Stopped,
}

/// Deliberately requires a concrete, checked device-relay endpoint from
/// Connector RC69 (NOT the MCP Streamable HTTP `/mcp` endpoint).
/// Remote production/QA only: wss://remote-mcp.katoos.de on default TLS 443.
/// Cannot accept arbitrary target hosts, HTTP, credentials or query secrets.
pub(crate) fn validate_endpoint(endpoint: &str) -> Result<(), &'static str> {
    if endpoint.len() > 512 || endpoint.contains('#') || endpoint.contains('?') {
        return Err("RC70_UNVERIFIED_RELAY_ENDPOINT");
    }
    let uri: Uri = endpoint
        .parse()
        .map_err(|_| "RC70_UNVERIFIED_RELAY_ENDPOINT")?;
    let host = uri.host().ok_or("RC70_UNVERIFIED_RELAY_ENDPOINT")?;
    let authority = uri.authority().ok_or("RC70_UNVERIFIED_RELAY_ENDPOINT")?;
    if authority.as_str().contains('@') || uri.path().is_empty() || !uri.path().starts_with('/') {
        return Err("RC70_UNVERIFIED_RELAY_ENDPOINT");
    }
    let remote = uri.scheme_str() == Some("wss")
        && host.eq_ignore_ascii_case(RELAY_HOST)
        && (uri.port_u16().is_none() || uri.port_u16() == Some(443));
    // Unit tests may exercise an actual, in-process TCP/WebSocket handshake.
    // This never compiles into the QA app or release code.
    #[cfg(test)]
    let local = uri.scheme_str() == Some("ws") && host == "127.0.0.1";
    #[cfg(not(test))]
    let local = false;
    if !remote && !local {
        return Err("RC70_UNVERIFIED_RELAY_ENDPOINT");
    }
    Ok(())
}

pub(crate) fn bounded_ws_config() -> WebSocketConfig {
    WebSocketConfig {
        max_message_size: Some(MAX_SIGNED_FRAME_BYTES),
        max_frame_size: Some(MAX_SIGNED_FRAME_BYTES),
        ..Default::default()
    }
}

pub(crate) async fn close_quarantined_socket(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) {
    let _ = timeout(
        Duration::from_secs(1),
        socket.close(Some(CloseFrame {
            code: CloseCode::Policy,
            reason: "RC70_CHALLENGE_NOT_VERIFIED".into(),
        })),
    )
    .await;
}

enum QuarantineOutcome {
    ContractRequired,
    TimedOut,
    Disconnected,
    Shutdown,
}

/// On this stage no server payload is trusted. We only drive the WebSocket
/// protocol (including built-in Ping/Pong handling) and reject any application
/// data. Authenticated challenge parsing belongs to the future connector-pinned
/// verifier, not this transport-level loop.
async fn quarantine_until_server_contract(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    shutdown: &mut watch::Receiver<bool>,
) -> QuarantineOutcome {
    let deadline = tokio::time::Instant::now() + SERVER_CHALLENGE_WAIT;
    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(deadline) => {
                close_quarantined_socket(socket).await;
                return QuarantineOutcome::TimedOut;
            },
            change = shutdown.changed() => {
                if change.is_err() || *shutdown.borrow_and_update() {
                    close_quarantined_socket(socket).await;
                    return QuarantineOutcome::Shutdown;
                }
            },
            incoming = socket.next() => {
                match incoming {
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {
                        // WebSocket protocol housekeeping is not signed presence.
                    },
                    Some(Ok(Message::Text(_))) | Some(Ok(Message::Binary(_))) => {
                        close_quarantined_socket(socket).await;
                        return QuarantineOutcome::ContractRequired;
                    },
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => {
                        return QuarantineOutcome::Disconnected;
                    },
                    _ => return QuarantineOutcome::Disconnected,
                }
            },
        }
    }
}

fn backoff_for(failures: u32) -> Duration {
    Duration::from_secs((1_u64 << failures.min(4)).min(MAX_RECONNECT_DELAY.as_secs()))
}

async fn signal(
    events: &mpsc::Sender<RelayTransportEvent>,
    event: RelayTransportEvent,
) -> Result<(), &'static str> {
    events
        .send(event)
        .await
        .map_err(|_| "RC70_RELAY_EVENT_RECEIVER_CLOSED")
}

/// Outbound-only supervisor. Not started by the application: no production
/// connection will be attempted until the Connector signs and publishes its
/// actual relay endpoint/session contract. Shutdown works during connect,
/// quarantine and backoff. No local listener or remote execution is created.
pub(crate) async fn supervise_quarantined_outbound_wss(
    endpoint: &str,
    mut shutdown: watch::Receiver<bool>,
    events: mpsc::Sender<RelayTransportEvent>,
) -> Result<(), &'static str> {
    validate_endpoint(endpoint)?;
    let mut failures = 0_u32;
    loop {
        if *shutdown.borrow() {
            signal(&events, RelayTransportEvent::Stopped).await?;
            return Ok(());
        }
        signal(&events, RelayTransportEvent::Connecting).await?;
        let connect = connect_async_with_config(endpoint, Some(bounded_ws_config()), false);
        let dial = tokio::select! {
            _ = shutdown.changed() => {
                signal(&events, RelayTransportEvent::Stopped).await?;
                return Ok(());
            },
            result = timeout(CONNECT_TIMEOUT, connect) => result,
        };
        match dial {
            Ok(Ok((mut socket, _response))) => {
                signal(&events, RelayTransportEvent::TransportOpenUnverified).await?;
                // Successful TLS/WSS transport does not imply owner approval.
                match quarantine_until_server_contract(&mut socket, &mut shutdown).await {
                    QuarantineOutcome::ContractRequired => {
                        signal(&events, RelayTransportEvent::ContractRequired).await?;
                        signal(&events, RelayTransportEvent::Stopped).await?;
                        return Err("RC70_SERVER_CHALLENGE_CONTRACT_REQUIRED");
                    }
                    QuarantineOutcome::Shutdown => {
                        signal(&events, RelayTransportEvent::Stopped).await?;
                        return Ok(());
                    }
                    QuarantineOutcome::TimedOut => {
                        signal(&events, RelayTransportEvent::ChallengeTimeout).await?;
                    }
                    QuarantineOutcome::Disconnected => {
                        signal(&events, RelayTransportEvent::TransportDropped).await?;
                    }
                }
            }
            _ => signal(&events, RelayTransportEvent::TransportDropped).await?,
        }
        failures = failures.saturating_add(1);
        signal(&events, RelayTransportEvent::ReconnectScheduled).await?;
        tokio::select! {
            _ = sleep(backoff_for(failures)) => {},
            _ = shutdown.changed() => {
                signal(&events, RelayTransportEvent::Stopped).await?;
                return Ok(());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;
    use tokio_tungstenite::{accept_async, tungstenite::Message};

    #[test]
    fn endpoint_allowlist_rejects_password_query_and_wrong_host() {
        for target in [
            "http://remote-mcp.katoos.de/rc70",
            "ws://remote-mcp.katoos.de/rc70",
            "wss://example.com/rc70",
            "wss://remote-mcp.katoos.de:8443/rc70",
            "wss://login@remote-mcp.katoos.de/rc70",
            "wss://remote-mcp.katoos.de/rc70?token=secret",
            "wss://remote-mcp.katoos.de/rc70#fragment",
            "ws://localhost:7000/rc70",
        ] {
            assert_eq!(
                validate_endpoint(target),
                Err("RC70_UNVERIFIED_RELAY_ENDPOINT"),
                "{target}"
            );
        }
        assert!(validate_endpoint("wss://remote-mcp.katoos.de/rc70").is_ok());
        assert!(validate_endpoint("ws://127.0.0.1:18999/test-only").is_ok());
    }

    #[test]
    fn reconnect_delays_are_bounded() {
        assert_eq!(backoff_for(0), Duration::from_secs(1));
        assert_eq!(backoff_for(1), Duration::from_secs(2));
        assert_eq!(backoff_for(2), Duration::from_secs(4));
        assert_eq!(backoff_for(9), Duration::from_secs(16));
    }

    #[tokio::test]
    async fn actual_loopback_websocket_rejects_unsigned_application_frame() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut peer = accept_async(stream).await.unwrap();
            peer.send(Message::Text("unverified-challenge".into()))
                .await
                .unwrap();
            // The client must close rather than accept this unsigned frame.
            let close = timeout(Duration::from_secs(3), peer.next()).await.unwrap();
            assert!(matches!(close, Some(Ok(Message::Close(_)))));
        });
        let (_tx, rx) = watch::channel(false);
        let (evt_tx, mut evt_rx) = mpsc::channel(20);
        let endpoint = format!("ws://127.0.0.1:{}/test-only", address.port());
        let outcome = timeout(
            Duration::from_secs(5),
            supervise_quarantined_outbound_wss(&endpoint, rx, evt_tx),
        )
        .await
        .unwrap();
        assert_eq!(outcome, Err("RC70_SERVER_CHALLENGE_CONTRACT_REQUIRED"));
        let mut events = vec![];
        while let Ok(e) = evt_rx.try_recv() {
            events.push(e);
        }
        assert!(events.contains(&RelayTransportEvent::Connecting));
        assert!(events.contains(&RelayTransportEvent::TransportOpenUnverified));
        assert!(events.contains(&RelayTransportEvent::ContractRequired));
        assert!(events.contains(&RelayTransportEvent::Stopped));
        assert!(!events.contains(&RelayTransportEvent::ChallengeTimeout));
        task.await.unwrap();
    }

    #[tokio::test]
    async fn shutdown_during_reconnect_never_claims_authenticated_device() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener); // A known closed loopback port.
        let (stop_tx, stop_rx) = watch::channel(false);
        let (evt_tx, mut evt_rx) = mpsc::channel(16);
        let endpoint = format!("ws://127.0.0.1:{}/test-only", address.port());
        let runner = tokio::spawn(async move {
            supervise_quarantined_outbound_wss(&endpoint, stop_rx, evt_tx).await
        });
        let mut events = vec![];
        for _ in 0..3 {
            let event = timeout(Duration::from_secs(4), evt_rx.recv())
                .await
                .unwrap()
                .unwrap();
            events.push(event);
            if event == RelayTransportEvent::ReconnectScheduled {
                break;
            }
        }
        assert!(events.contains(&RelayTransportEvent::TransportDropped));
        stop_tx.send(true).unwrap();
        assert_eq!(
            timeout(Duration::from_secs(3), runner)
                .await
                .unwrap()
                .unwrap(),
            Ok(())
        );
        assert_eq!(evt_rx.recv().await, Some(RelayTransportEvent::Stopped));
    }
}
