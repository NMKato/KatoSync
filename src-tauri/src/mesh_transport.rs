// Created by NMKato Solutions
//! Minimal, **read-only** authenticated Mesh transport probe over a real TCP
//! stream. Native-only service: NO Tauri IPC command, listener, device
//! discovery, remote jobs, or automatic pairing.
//!
//! The caller must provide a previously, explicitly approved peer key and the
//! matching certificate. The socket is never accepted as proof of trust:
//! mesh_tls strictly verifies both Ed25519 identities with TLS 1.3 mTLS.
//! This module cannot promote a peer to "connected" or authorize work.
//!
//! Protocol v1: a fixed 40-byte client hello (8-byte tag + fresh 32-byte
//! nonce), followed by a fixed 40-byte server acknowledgement (tag + nonce).
//! There is no deserialization, allocation from untrusted lengths, payload
//! forwarding, command execution, or cleartext fallback.

use crate::mesh_tls::{
    strict_client_config, strict_server_config, DeviceTlsIdentity, TLS_PEER_DNS_NAME,
};
use crate::mesh_trust::ApprovedPeer;
use rand::RngCore;
use std::{sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time::timeout,
};
use tokio_rustls::{TlsAcceptor, TlsConnector};

const CLIENT_TAG: &[u8; 8] = b"KSM1HELO";
const SERVER_TAG: &[u8; 8] = b"KSM1ACK!";
const NONCE_LEN: usize = 32;
const FRAME_LEN: usize = 8 + NONCE_LEN;
const PROBE_DEADLINE: Duration = Duration::from_secs(4);

/// A successful probe proves a live, pinned TLS peer for this connection
/// only. It does NOT grant peer trust, persistent liveness, or job authority.
pub(crate) async fn client_probe(
    socket: TcpStream,
    local: &DeviceTlsIdentity,
    approved_server: &ApprovedPeer,
    server_certificate: &[u8],
) -> Result<(), String> {
    let config = strict_client_config(local, approved_server, server_certificate)?;
    timeout(PROBE_DEADLINE, async move {
        let name = rustls::pki_types::ServerName::try_from(TLS_PEER_DNS_NAME)
            .map_err(|_| "MESH_PROBE_INVALID_PEER_NAME".to_string())?;
        let mut channel = TlsConnector::from(Arc::new(config))
            .connect(name, socket)
            .await
            .map_err(|_| "MESH_PROBE_TLS_REJECTED".to_string())?;

        let mut hello = [0u8; FRAME_LEN];
        hello[..8].copy_from_slice(CLIENT_TAG);
        rand::rngs::OsRng.fill_bytes(&mut hello[8..]);
        channel
            .write_all(&hello)
            .await
            .map_err(|_| "MESH_PROBE_IO".to_string())?;

        let mut acknowledgment = [0u8; FRAME_LEN];
        channel
            .read_exact(&mut acknowledgment)
            .await
            .map_err(|_| "MESH_PROBE_IO".to_string())?;
        if &acknowledgment[..8] != SERVER_TAG || acknowledgment[8..] != hello[8..] {
            return Err("MESH_PROBE_WRONG_ACK".into());
        }
        Ok(())
    })
    .await
    .map_err(|_| "MESH_PROBE_TIMEOUT".to_string())?
}

/// A single connection probe; the caller must provide a socket and a pinned,
/// previously approved client. This function does NOT bind any port.
pub(crate) async fn server_probe(
    socket: TcpStream,
    local: &DeviceTlsIdentity,
    approved_client: &ApprovedPeer,
    client_certificate: &[u8],
) -> Result<(), String> {
    let config = strict_server_config(local, approved_client, client_certificate)?;
    timeout(PROBE_DEADLINE, async move {
        let mut channel = TlsAcceptor::from(Arc::new(config))
            .accept(socket)
            .await
            .map_err(|_| "MESH_PROBE_TLS_REJECTED".to_string())?;
        let mut hello = [0u8; FRAME_LEN];
        channel
            .read_exact(&mut hello)
            .await
            .map_err(|_| "MESH_PROBE_IO".to_string())?;
        if &hello[..8] != CLIENT_TAG {
            return Err("MESH_PROBE_BAD_HELLO".into());
        }

        let mut response = [0u8; FRAME_LEN];
        response[..8].copy_from_slice(SERVER_TAG);
        response[8..].copy_from_slice(&hello[8..]);
        channel
            .write_all(&response)
            .await
            .map_err(|_| "MESH_PROBE_IO".to_string())?;
        channel
            .flush()
            .await
            .map_err(|_| "MESH_PROBE_IO".to_string())?;
        Ok(())
    })
    .await
    .map_err(|_| "MESH_PROBE_TIMEOUT".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh_identity::fingerprint;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use ed25519_dalek::SigningKey;
    use tokio::net::TcpListener;

    fn signing(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }
    fn approved(key: &SigningKey) -> ApprovedPeer {
        ApprovedPeer {
            fingerprint: fingerprint(&key.verifying_key()),
            public_key: URL_SAFE_NO_PAD.encode(key.verifying_key().as_bytes()),
            approved_at: 1_800_000_000,
            status: "locally_approved".into(),
        }
    }
    async fn socket_pair() -> (TcpStream, TcpStream) {
        // OS TCP sockets, not tokio::io::duplex. Loopback only, random port.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let client = TcpStream::connect(address);
        let server = listener.accept();
        let (client, server) = tokio::join!(client, server);
        (client.unwrap(), server.unwrap().0)
    }

    #[tokio::test]
    async fn real_tcp_socket_mutual_tls_roundtrip_without_remote_job_permission() {
        let a = signing(41);
        let b = signing(42);
        let a_cert = DeviceTlsIdentity::from_signing_key(&a).unwrap();
        let b_cert = DeviceTlsIdentity::from_signing_key(&b).unwrap();
        let (client, server) = socket_pair().await;
        let a_pin = approved(&a);
        let b_pin = approved(&b);
        let (received, replied) = tokio::join!(
            client_probe(client, &a_cert, &b_pin, b_cert.certificate_der()),
            server_probe(server, &b_cert, &a_pin, a_cert.certificate_der())
        );
        assert!(
            received.is_ok(),
            "client refused pinned TLS probe: {received:?}"
        );
        assert!(
            replied.is_ok(),
            "server refused pinned TLS probe: {replied:?}"
        );
        let status = crate::mesh_readiness::mesh_local_readiness();
        let state = serde_json::to_value(status).unwrap();
        assert_eq!(state["verifiedPeers"], 0);
        assert_eq!(state["remoteReadOnlyDispatch"], false);
        assert_eq!(state["crossDeviceWrites"], false);
    }

    #[tokio::test]
    async fn unapproved_or_wrong_pinned_certificate_fails_before_socket_handshake() {
        let a = signing(41);
        let b = signing(42);
        let stranger = signing(43);
        let local_a = DeviceTlsIdentity::from_signing_key(&a).unwrap();
        let local_b = DeviceTlsIdentity::from_signing_key(&b).unwrap();
        let (client, _server) = socket_pair().await;
        assert!(client_probe(
            client,
            &local_a,
            &approved(&stranger),
            local_b.certificate_der()
        )
        .await
        .is_err());

        let (client, _server) = socket_pair().await;
        let mut unapproved = approved(&b);
        unapproved.status = "revoked".into();
        assert!(
            client_probe(client, &local_a, &unapproved, local_b.certificate_der())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn malformed_hello_is_never_acknowledged() {
        let a = signing(41);
        let b = signing(42);
        let local_a = DeviceTlsIdentity::from_signing_key(&a).unwrap();
        let local_b = DeviceTlsIdentity::from_signing_key(&b).unwrap();
        let client_config =
            strict_client_config(&local_a, &approved(&b), local_b.certificate_der()).unwrap();
        let (client, server) = socket_pair().await;
        let malicious = async move {
            let name = rustls::pki_types::ServerName::try_from(TLS_PEER_DNS_NAME).unwrap();
            let mut channel = TlsConnector::from(Arc::new(client_config))
                .connect(name, client)
                .await
                .unwrap();
            let mut data = [0u8; FRAME_LEN];
            data[..8].copy_from_slice(b"BADHELLO");
            channel.write_all(&data).await.unwrap();
        };
        let a_pin = approved(&a);
        let ((), result) = tokio::join!(
            malicious,
            server_probe(server, &local_b, &a_pin, local_a.certificate_der())
        );
        assert_eq!(result.err().as_deref(), Some("MESH_PROBE_BAD_HELLO"));
    }

    #[tokio::test]
    async fn wrong_echoed_nonce_fails_to_prove_liveness() {
        let a = signing(41);
        let b = signing(42);
        let local_a = DeviceTlsIdentity::from_signing_key(&a).unwrap();
        let local_b = DeviceTlsIdentity::from_signing_key(&b).unwrap();
        let server_config =
            strict_server_config(&local_b, &approved(&a), local_a.certificate_der()).unwrap();
        let (client, server) = socket_pair().await;
        let dishonest = async move {
            let mut channel = TlsAcceptor::from(Arc::new(server_config))
                .accept(server)
                .await
                .unwrap();
            let mut hello = [0u8; FRAME_LEN];
            channel.read_exact(&mut hello).await.unwrap();
            let mut wrong = [0u8; FRAME_LEN];
            wrong[..8].copy_from_slice(SERVER_TAG);
            wrong[8..].copy_from_slice(&hello[8..]);
            wrong[8] ^= 0xFF;
            channel.write_all(&wrong).await.unwrap();
        };
        let b_pin = approved(&b);
        let (client_result, ()) = tokio::join!(
            client_probe(client, &local_a, &b_pin, local_b.certificate_der()),
            dishonest
        );
        assert_eq!(client_result.err().as_deref(), Some("MESH_PROBE_WRONG_ACK"));
    }

    #[tokio::test]
    async fn silent_peer_times_out_without_insecure_retry_or_fallback() {
        let a = signing(41);
        let b = signing(42);
        let local_a = DeviceTlsIdentity::from_signing_key(&a).unwrap();
        let local_b = DeviceTlsIdentity::from_signing_key(&b).unwrap();
        let (client, server) = socket_pair().await;
        let b_pin = approved(&b);
        let pending = client_probe(client, &local_a, &b_pin, local_b.certificate_der());
        let (result, _socket) = tokio::join!(pending, async {
            tokio::time::sleep(PROBE_DEADLINE + Duration::from_millis(200)).await;
            server
        });
        assert_eq!(result.err().as_deref(), Some("MESH_PROBE_TIMEOUT"));
    }

    // Pure test-only input policy, independent from network IO and UI.
    // Check source/destination relative to the selected QA role.
    fn allowed_private_lan_fixture(
        role: &str,
        address: std::net::SocketAddr,
        expected_ip: std::net::IpAddr,
    ) -> bool {
        use std::net::IpAddr;
        let private_lan = |ip: IpAddr| matches!(ip, IpAddr::V4(v) if v.is_private() && !v.is_loopback() && !v.is_link_local());
        private_lan(address.ip())
            && private_lan(expected_ip)
            && address.port() > 1024
            && match role {
                "server" => address.ip() != expected_ip,
                "client" | "client-wrong-pin" => address.ip() == expected_ip,
                _ => false,
            }
    }

    #[test]
    fn hardware_qa_guard_rejects_public_loopback_and_role_mismatches() {
        use std::net::{IpAddr, SocketAddr};
        let server: SocketAddr = "192.168.1.10:39400".parse().unwrap();
        let remote: IpAddr = "192.168.1.20".parse().unwrap();
        assert!(allowed_private_lan_fixture("server", server, remote));
        assert!(!allowed_private_lan_fixture("server", server, server.ip()));
        assert!(!allowed_private_lan_fixture("client", server, remote));
        assert!(allowed_private_lan_fixture("client", server, server.ip()));
        assert!(allowed_private_lan_fixture(
            "client-wrong-pin",
            server,
            server.ip()
        ));
        assert!(!allowed_private_lan_fixture("unknown", server, remote));
        assert!(!allowed_private_lan_fixture(
            "server",
            "127.0.0.1:39400".parse().unwrap(),
            remote
        ));
        assert!(!allowed_private_lan_fixture(
            "server",
            "8.8.8.8:39400".parse().unwrap(),
            remote
        ));
        assert!(!allowed_private_lan_fixture(
            "server",
            "192.168.1.10:443".parse().unwrap(),
            remote
        ));
        assert!(!allowed_private_lan_fixture(
            "server",
            server,
            "2001:db8::1".parse().unwrap()
        ));
    }

    /// Explicit opt-in hardware QA only. Two Macs share ONLY these public,
    /// synthetic fixture identities; they cannot access OS keychains,
    /// register a device, or authorize any real Mesh job. The test must be
    /// launched separately on each device using private LAN addresses.
    #[tokio::test]
    #[ignore = "manual two-machine LAN QA: synthetic test keys, explicit one-shot private socket only"]
    async fn manual_two_host_private_lan_pinned_tls_probe() {
        use std::{
            env,
            net::{IpAddr, SocketAddr},
        };

        assert_eq!(
            env::var("KATOSYNC_MESH_LAN_QA_ALLOW").as_deref(),
            Ok("SYNTHETIC_FIXTURES_ONLY"),
            "Manual LAN test requires an explicit synthetic-only approval flag."
        );
        let address: SocketAddr = env::var("KATOSYNC_MESH_LAN_QA_ADDRESS")
            .expect("Explicit LAN test socket address is required")
            .parse()
            .expect("Invalid LAN socket address");
        let expected_ip: IpAddr = env::var("KATOSYNC_MESH_LAN_QA_EXPECT_PEER")
            .expect("Explicit expected remote peer IP is required")
            .parse()
            .expect("Invalid expected peer IP");
        let role = env::var("KATOSYNC_MESH_LAN_QA_ROLE")
            .expect("Required QA role: server, client or client-wrong-pin");
        assert!(
            allowed_private_lan_fixture(&role, address, expected_ip),
            "Manual QA requires permitted RFC1918 peers, roles and unprivileged port"
        );

        let a = signing(41);
        let b = signing(42);
        let local_a = DeviceTlsIdentity::from_signing_key(&a).unwrap();
        let local_b = DeviceTlsIdentity::from_signing_key(&b).unwrap();
        match role.as_str() {
            "server" => {
                let listener = TcpListener::bind(address)
                    .await
                    .expect("Could not bind explicit private LAN interface");
                // One connection, bounded lifetime. Never a background server.
                let (socket, peer) =
                    tokio::time::timeout(Duration::from_secs(45), listener.accept())
                        .await
                        .expect("Peer did not arrive")
                        .expect("TCP accept failed");
                assert_eq!(peer.ip(), expected_ip, "Unknown LAN source refused");
                let result =
                    server_probe(socket, &local_b, &approved(&a), local_a.certificate_der()).await;
                // The negative client mode should never be mistaken for success.
                let negative =
                    env::var("KATOSYNC_MESH_LAN_QA_NEGATIVE").ok().as_deref() == Some("YES");
                if negative {
                    assert!(result.is_err(), "Negative TLS probe unexpectedly succeeded");
                } else {
                    result.expect("Pinned mutual TLS LAN server probe failed");
                }
            }
            "client" | "client-wrong-pin" => {
                let socket =
                    tokio::time::timeout(Duration::from_secs(5), TcpStream::connect(address))
                        .await
                        .expect("TCP connect timed out")
                        .expect("TCP connection failed");
                assert_eq!(
                    socket.peer_addr().unwrap().ip(),
                    expected_ip,
                    "Connected to unexpected LAN peer"
                );
                let actual = approved(&b);
                let outsider = signing(43);
                let invalid = approved(&outsider);
                let pin = if role == "client" { &actual } else { &invalid };
                let result = client_probe(socket, &local_a, pin, local_b.certificate_der()).await;
                if role == "client" {
                    result.expect("Pinned mutual TLS LAN client probe failed");
                } else {
                    assert_eq!(
                        result.err().as_deref(),
                        Some("TLS-Zertifikat gehört nicht zur freigegebenen Geräteidentität."),
                        "Wrong pinned key must fail at peer certificate binding, not just IO"
                    );
                }
            }
            _ => panic!("Unsupported QA role; no network operation allowed"),
        }
        // A successful native two-host proof is transport-only. Neither the
        // positive nor the negative test may change account trust or jobs.
        let readiness =
            serde_json::to_value(crate::mesh_readiness::mesh_local_readiness()).unwrap();
        assert_eq!(readiness["verifiedPeers"], 0);
        assert_eq!(readiness["remoteReadOnlyDispatch"], false);
        assert_eq!(readiness["crossDeviceWrites"], false);
    }
}
