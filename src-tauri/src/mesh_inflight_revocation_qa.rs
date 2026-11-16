// Created by NMKato Solutions
//! Stage4AB.3.2B – real mutual TLS1.3 over an in-memory duplex,
//! with ONLY synthetic Ed25519 fixtures and an in-memory revocation event.
//!
//! No KatoOS session, no real enrollment, no OS network/sleep changes,
//! no production keys, listeners, Tauri commands, persistence or jobs.
//! Passing here is NOT proof of actual live server-side enrollment revocation.

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

fn synthetic_approved(peer: &SigningKey) -> ApprovedPeer {
    ApprovedPeer {
        fingerprint: fingerprint(&peer.verifying_key()),
        public_key: URL_SAFE_NO_PAD.encode(peer.verifying_key().as_bytes()),
        approved_at: 1_780_000_000,
        status: "locally_approved".into(),
    }
}

fn simulated_current() -> SimulatedRevalidation {
    SimulatedRevalidation {
        owner_session_current: true,
        exact_local_keychain_pin_current: true,
        both_enrollments_current: true,
        user_consent_current: true,
        network_reachable: true,
    }
}

/// In-memory revocation models the signal only; no real server database
/// is written. TLS and its failure after the first heartbeat are real.
async fn run_synthetic_in_flight_revoke(fault: TransportFault) {
    assert!(matches!(fault, TransportFault::PeerRevoked | TransportFault::OwnerChanged));
    let client_key = SigningKey::from_bytes(&[41u8; 32]);
    let server_key = SigningKey::from_bytes(&[42u8; 32]);
    let local_client = DeviceTlsIdentity::from_signing_key(&client_key).unwrap();
    let local_server = DeviceTlsIdentity::from_signing_key(&server_key).unwrap();
    let client_cfg = strict_client_config(
        &local_client,
        &synthetic_approved(&server_key),
        local_server.certificate_der(),
    ).unwrap();
    let server_cfg = strict_server_config(
        &local_server,
        &synthetic_approved(&client_key),
        local_client.certificate_der(),
    ).unwrap();
    let (client_io, server_io) = duplex(16_384);
    let (signal_revoke, receive_revoke) = oneshot::channel::<()>();

    let client = async move {
        let dns = rustls::pki_types::ServerName::try_from(TLS_PEER_DNS_NAME).unwrap();
        let mut tls = TlsConnector::from(Arc::new(client_cfg))
            .connect(dns, client_io).await.unwrap();
        assert_eq!(
            tls.get_ref().1.protocol_version(),
            Some(rustls::ProtocolVersion::TLSv1_3)
        );

        tls.write_all(b"PING").await.unwrap();
        tls.flush().await.unwrap();
        let mut response = [0u8; 4];
        tls.read_exact(&mut response).await.unwrap();
        assert_eq!(&response, b"PONG");
        signal_revoke.send(()).unwrap();

        // In-flight revocation must not let the second application message
        // produce a successful heartbeat or become a stale "connected" claim.
        let wrongly_accepted = if tls.write_all(b"PING").await.is_ok() {
            let mut second = [0u8; 4];
            tls.read_exact(&mut second).await.is_ok()
        } else {
            false
        };
        assert!(!wrongly_accepted, "revoked TLS session received an ACK");
    };

    let server = async move {
        let mut tls = TlsAcceptor::from(Arc::new(server_cfg))
            .accept(server_io).await.unwrap();
        assert_eq!(
            tls.get_ref().1.protocol_version(),
            Some(rustls::ProtocolVersion::TLSv1_3)
        );
        // This is a synthetic binding fixture, not the negotiated production
        // session nonce. Canonical LiveTlsLease invalidation is under test.
        let now = Instant::now();
        let mut lease = LiveTlsLease::after_verified_open_channel(
            [1u8; 16],
            server_key.verifying_key().to_bytes(),
            client_key.verifying_key().to_bytes(),
            [88u8; 32],
            now,
        ).unwrap();
        let mut first = [0u8; 4];
        tls.read_exact(&mut first).await.unwrap();
        assert_eq!(&first, b"PING");
        lease.verified_in_channel_heartbeat(1, Instant::now()).unwrap();
        tls.write_all(b"PONG").await.unwrap();
        tls.flush().await.unwrap();
        assert!(lease.is_live(Instant::now()));

        receive_revoke.await.unwrap();
        lease.on_owner_or_peer_revoked();
        assert!(!lease.is_live(Instant::now()));
        // Drop the genuine open TLS stream rather than merely toggling a
        // Boolean "connected" indicator; no retry or downgrade is possible.
        drop(tls);
        assert_eq!(
            classify_attempt(fault, simulated_current(), 0, Duration::from_secs(60)),
            AttemptDecision::StopSecurityEvent
        );
    };

    timeout(Duration::from_secs(8), async {
        tokio::join!(client, server);
    }).await.expect("synthetic revocation test exceeded its bounded deadline");
}

#[tokio::test]
async fn in_flight_synthetic_peer_revoke_closes_real_pinned_tls13_without_reconnect() {
    run_synthetic_in_flight_revoke(TransportFault::PeerRevoked).await;
}

#[tokio::test]
async fn in_flight_synthetic_owner_change_closes_real_pinned_tls13_without_reconnect() {
    run_synthetic_in_flight_revoke(TransportFault::OwnerChanged).await;
}
