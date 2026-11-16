// Created by NMKato Solutions
//! Stage4AB.3.2B – synthetic half-open network stall on a REAL mutually
//! pinned TLS1.3 stream in memory. No real network, sleep or enrollment changes.
//! A transport timeout MUST invalidate the canonical live lease and forbid a
//! stale "connected" claim. This is not physical M2/M3 network-loss proof.

use crate::{
    mesh_durable_lease_qa::LiveTlsLease,
    mesh_fault_policy_qa::{classify_attempt, AttemptDecision, SimulatedRevalidation, TransportFault},
    mesh_identity::fingerprint,
    mesh_tls::{strict_client_config, strict_server_config, DeviceTlsIdentity, TLS_PEER_DNS_NAME},
    mesh_trust::ApprovedPeer,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::SigningKey;
use std::{sync::Arc, time::{Duration, Instant}};
use tokio::{
    io::{duplex, AsyncReadExt, AsyncWriteExt},
    sync::oneshot,
    time::timeout,
};
use tokio_rustls::{TlsAcceptor, TlsConnector};

fn approved_fixture(key: &SigningKey) -> ApprovedPeer {
    ApprovedPeer {
        fingerprint: fingerprint(&key.verifying_key()),
        public_key: URL_SAFE_NO_PAD.encode(key.verifying_key().as_bytes()),
        approved_at: 1_780_000_000,
        status: "locally_approved".to_string(),
    }
}

fn current_fixture(network_reachable: bool) -> SimulatedRevalidation {
    SimulatedRevalidation {
        owner_session_current: true,
        exact_local_keychain_pin_current: true,
        both_enrollments_current: true,
        user_consent_current: true,
        network_reachable,
    }
}

#[tokio::test]
async fn real_pinned_tls13_half_open_heartbeat_timeout_cannot_keep_live_lease() {
    let client_key = SigningKey::from_bytes(&[61; 32]);
    let server_key = SigningKey::from_bytes(&[62; 32]);
    let client_identity = DeviceTlsIdentity::from_signing_key(&client_key).unwrap();
    let server_identity = DeviceTlsIdentity::from_signing_key(&server_key).unwrap();
    let client_config = strict_client_config(
        &client_identity,
        &approved_fixture(&server_key),
        server_identity.certificate_der(),
    ).unwrap();
    let server_config = strict_server_config(
        &server_identity,
        &approved_fixture(&client_key),
        client_identity.certificate_der(),
    ).unwrap();
    let (client_io, server_io) = duplex(16_384);
    let (second_request_seen, server_may_finish) = oneshot::channel::<()>();

    let client = async move {
        let server_name = rustls::pki_types::ServerName::try_from(TLS_PEER_DNS_NAME).unwrap();
        let mut tls = TlsConnector::from(Arc::new(client_config))
            .connect(server_name, client_io).await.unwrap();
        assert_eq!(tls.get_ref().1.protocol_version(), Some(rustls::ProtocolVersion::TLSv1_3));
        let mut lease = LiveTlsLease::after_verified_open_channel(
            [1; 16],
            client_key.verifying_key().to_bytes(),
            server_key.verifying_key().to_bytes(),
            [91; 32], // synthetic, NOT a runtime TLS nonce
            Instant::now(),
        ).unwrap();
        tls.write_all(b"PING").await.unwrap();
        tls.flush().await.unwrap();
        let mut response = [0u8; 4];
        tls.read_exact(&mut response).await.unwrap();
        assert_eq!(&response, b"PONG");
        lease.verified_in_channel_heartbeat(1, Instant::now()).unwrap();
        assert!(lease.is_live(Instant::now()));

        // Simulate packets silently lost in one direction: the peer socket
        // remains genuinely OPEN but never emits the second PONG.
        tls.write_all(b"PING").await.unwrap();
        tls.flush().await.unwrap();
        let stalled = timeout(Duration::from_millis(180), tls.read_exact(&mut response)).await;
        assert!(stalled.is_err(), "half-open channel did not time out");
        lease.on_network_loss();
        assert!(!lease.is_live(Instant::now()));
        assert_eq!(
            classify_attempt(
                TransportFault::NetworkLost,
                current_fixture(false),
                0,
                Duration::from_secs(60),
            ),
            AttemptDecision::StopNoValidRevalidation,
        );
        // Only restored network + all approvals could permit an ATTEMPT,
        // never falsely assert a fresh TLS session was authenticated.
        assert_eq!(
            classify_attempt(
                TransportFault::NetworkLost,
                current_fixture(true),
                0,
                Duration::from_secs(60),
            ),
            AttemptDecision::AttemptNewFullTlsAfter(Duration::from_secs(2)),
        );
        server_may_finish.send(()).unwrap();
        drop(tls);
    };

    let server = async move {
        let mut tls = TlsAcceptor::from(Arc::new(server_config))
            .accept(server_io).await.unwrap();
        assert_eq!(tls.get_ref().1.protocol_version(), Some(rustls::ProtocolVersion::TLSv1_3));
        let mut first = [0u8; 4];
        tls.read_exact(&mut first).await.unwrap();
        assert_eq!(&first, b"PING");
        tls.write_all(b"PONG").await.unwrap();
        tls.flush().await.unwrap();
        let mut second = [0u8; 4];
        tls.read_exact(&mut second).await.unwrap();
        assert_eq!(&second, b"PING");
        // HOLD the TLS connection open without sending an ACK.
        second_request_seen.send(()).unwrap();
        // Deliberately withhold the second PONG until the client times out.
        let _ = server_may_finish.await;
        drop(tls);
    };

    timeout(Duration::from_secs(8), async {
        tokio::join!(client, server);
    }).await.expect("half-open QA exceeded 8s");
}

#[tokio::test]
async fn simulated_sleep_wake_invalidates_a_live_lease_without_remote_jobs() {
    let now = Instant::now();
    let mut lease = LiveTlsLease::after_verified_open_channel(
        [1; 16], [61; 32], [62; 32], [91; 32], now,
    ).unwrap();
    lease.verified_in_channel_heartbeat(1, now).unwrap();
    assert!(lease.is_live(now));
    lease.on_sleep_or_wake();
    assert!(!lease.is_live(now));
    assert_eq!(
        classify_attempt(TransportFault::SleepOrWake, current_fixture(false), 0, Duration::from_secs(60)),
        AttemptDecision::StopNoValidRevalidation,
    );
}
