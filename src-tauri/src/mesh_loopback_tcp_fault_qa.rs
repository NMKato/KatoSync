// Created by NMKato Solutions
//! Stage4AB.3.2B: test-only real kernel TCP loopback TLS1.3 fault coverage.
//!
//! All sockets bind exclusively to 127.0.0.1 with an ephemeral port.
//! Fixtures use synthetic Ed25519 identities; no KatoOS, production
//! Keychain, remote device, WLAN, Tailscale, router, OS sleep or commands.
//! This is NOT physical M2/M3 link loss or production supervisor proof.

use crate::{
    mesh_durable_lease_qa::LiveTlsLease,
    mesh_fault_policy_qa::{classify_attempt, AttemptDecision, SimulatedRevalidation, TransportFault},
    mesh_identity::fingerprint,
    mesh_tls::{strict_client_config, strict_server_config, DeviceTlsIdentity, TLS_PEER_DNS_NAME},
    mesh_trust::ApprovedPeer,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::SigningKey;
use std::{net::{Ipv4Addr, SocketAddrV4}, sync::Arc, time::{Duration, Instant}};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::oneshot,
    time::timeout,
};
use tokio_rustls::{TlsAcceptor, TlsConnector};

#[derive(Clone, Copy)]
enum LoopbackFault {
    PeerCloses,
    PeerStalls,
}

fn synthetic_peer(signing: &SigningKey) -> ApprovedPeer {
    ApprovedPeer {
        fingerprint: fingerprint(&signing.verifying_key()),
        public_key: URL_SAFE_NO_PAD.encode(signing.verifying_key().as_bytes()),
        approved_at: 1_780_000_000,
        status: "locally_approved".to_string(),
    }
}

fn preflight_without_network() -> SimulatedRevalidation {
    SimulatedRevalidation {
        owner_session_current: true,
        exact_local_keychain_pin_current: true,
        both_enrollments_current: true,
        user_consent_current: true,
        network_reachable: false,
    }
}

async fn run_local_kernel_tcp_fault(fault: LoopbackFault) {
    let client_key = SigningKey::from_bytes(&[71; 32]);
    let server_key = SigningKey::from_bytes(&[72; 32]);
    let client_identity = DeviceTlsIdentity::from_signing_key(&client_key).unwrap();
    let server_identity = DeviceTlsIdentity::from_signing_key(&server_key).unwrap();
    let client_config = strict_client_config(
        &client_identity,
        &synthetic_peer(&server_key),
        server_identity.certificate_der(),
    ).unwrap();
    let server_config = strict_server_config(
        &server_identity,
        &synthetic_peer(&client_key),
        client_identity.certificate_der(),
    ).unwrap();

    // The kernel assigns a new ephemeral port. Never bind an overlay, LAN,
    // all-interfaces address or the Stage4AB32 hardware QA port.
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .await.unwrap();
    let listen_addr = listener.local_addr().unwrap();
    assert!(listen_addr.ip().is_loopback());
    assert_ne!(listen_addr.port(), 39402);

    let (stall_seen_tx, stall_seen_rx) = oneshot::channel::<()>();
    let (timeout_done_tx, timeout_done_rx) = oneshot::channel::<()>();

    let client = async move {
        let tcp = TcpStream::connect(listen_addr).await.unwrap();
        assert!(tcp.local_addr().unwrap().ip().is_loopback());
        assert!(tcp.peer_addr().unwrap().ip().is_loopback());
        let name = rustls::pki_types::ServerName::try_from(TLS_PEER_DNS_NAME).unwrap();
        let mut tls = TlsConnector::from(Arc::new(client_config))
            .connect(name, tcp).await.unwrap();
        assert_eq!(
            tls.get_ref().1.protocol_version(),
            Some(rustls::ProtocolVersion::TLSv1_3),
        );
        let mut lease = LiveTlsLease::after_verified_open_channel(
            [1; 16],
            client_key.verifying_key().to_bytes(),
            server_key.verifying_key().to_bytes(),
            [73; 32], // synthetic test fixture, never production handshake material
            Instant::now(),
        ).unwrap();
        tls.write_all(b"PING").await.unwrap();
        tls.flush().await.unwrap();
        let mut pong = [0u8; 4];
        tls.read_exact(&mut pong).await.unwrap();
        assert_eq!(&pong, b"PONG");
        lease.verified_in_channel_heartbeat(1, Instant::now()).unwrap();
        assert!(lease.is_live(Instant::now()));

        // A second heartbeat must NEVER refresh the old lease after the
        // peer fails: real EOF or a genuinely open, unresponsive TCP socket.
        let still_valid = match fault {
            LoopbackFault::PeerCloses => {
                if tls.write_all(b"PING").await.is_ok() {
                    timeout(Duration::from_millis(700), tls.read_exact(&mut pong))
                        .await.map(|r| r.is_ok()).unwrap_or(false)
                } else { false }
            },
            LoopbackFault::PeerStalls => {
                tls.write_all(b"PING").await.unwrap();
                tls.flush().await.unwrap();
                stall_seen_rx.await.unwrap();
                let received = timeout(Duration::from_millis(250), tls.read_exact(&mut pong)).await;
                assert!(received.is_err(), "silent peer unexpectedly ACKed");
                timeout_done_tx.send(()).unwrap();
                false
            }
        };
        assert!(!still_valid, "old TLS session accepted after peer failure");
        lease.on_network_loss();
        assert!(!lease.is_live(Instant::now()));
        assert_eq!(
            classify_attempt(
                TransportFault::NetworkLost,
                preflight_without_network(),
                0,
                Duration::from_secs(30),
            ),
            AttemptDecision::StopNoValidRevalidation,
        );
        drop(tls);
    };

    let server = async move {
        let (socket, address) = listener.accept().await.unwrap();
        assert!(address.ip().is_loopback());
        assert!(socket.local_addr().unwrap().ip().is_loopback());
        let mut tls = TlsAcceptor::from(Arc::new(server_config))
            .accept(socket).await.unwrap();
        assert_eq!(
            tls.get_ref().1.protocol_version(),
            Some(rustls::ProtocolVersion::TLSv1_3),
        );
        let mut ping = [0u8; 4];
        tls.read_exact(&mut ping).await.unwrap();
        assert_eq!(&ping, b"PING");
        tls.write_all(b"PONG").await.unwrap();
        tls.flush().await.unwrap();
        match fault {
            LoopbackFault::PeerCloses => {
                // No close_notify; real kernel TCP EOF must fail the next ACK.
                drop(tls);
            }
            LoopbackFault::PeerStalls => {
                tls.read_exact(&mut ping).await.unwrap();
                assert_eq!(&ping, b"PING");
                stall_seen_tx.send(()).unwrap();
                // Deliberately preserve OPEN TCP/TLS while withholding PONG.
                timeout_done_rx.await.unwrap();
                drop(tls);
            }
        }
    };

    timeout(Duration::from_secs(8), async {
        tokio::join!(client, server);
    }).await.expect("loopback fault test exceeded 8s");
}

#[tokio::test]
async fn local_kernel_tcp_tls13_peer_close_revokes_live_lease() {
    run_local_kernel_tcp_fault(LoopbackFault::PeerCloses).await;
}

#[tokio::test]
async fn local_kernel_tcp_tls13_half_open_timeout_revokes_live_lease() {
    run_local_kernel_tcp_fault(LoopbackFault::PeerStalls).await;
}
