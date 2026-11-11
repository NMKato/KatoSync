// Created by NMKato Solutions
//! Stage4W — single-use, explicitly owner-launched LAN QA with the REAL
//! existing Ed25519 device identities. This is **not** a permanent Mesh link.
//!
//! Never exports signing keys. The pre-TLS exchange carries PUBLIC DER
//! certificates only. Both are independently pinned to the account-scoped
//! Keychain entries by mesh_admission -> mesh_tls before any proof succeeds.
//! No network scans, remote tools, commands, file data, or automatic startup.

use crate::{
    mesh_admission,
    mesh_identity::{existing_identity, same_account_still_verified},
    mesh_tls::DeviceTlsIdentity,
};
use serde::Serialize;
use std::{
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::timeout,
};

const CERT_BYTES_MAX: usize = 8192;
const CERT_BYTES_MIN: usize = 100;
const PRELUDE_DEADLINE: Duration = Duration::from_secs(5);
const CONNECT_DEADLINE: Duration = Duration::from_secs(6);
const ACCEPT_DEADLINE: Duration = Duration::from_secs(35);
const QA_ENV: &str = "KATOSYNC_STAGE4W_LAN_QA_ONCE";
const QA_OPT_IN: &str = "OWNER_LAUNCHED_QA_ONLY";

fn gate_decision(compiled: bool, opt_in: Option<&str>) -> bool {
    compiled && opt_in == Some(QA_OPT_IN)
}
fn gate() -> Result<(), String> {
    if gate_decision(
        cfg!(feature = "stage4j-qa"),
        std::env::var(QA_ENV).ok().as_deref(),
    ) {
        Ok(())
    } else {
        Err("MESH_STAGE4W_EXPLICIT_QA_OPT_IN_REQUIRED".into())
    }
}

// Even direct IPC concurrency may never start multiple QA probes in one app.
static QA_ACTIVE: AtomicBool = AtomicBool::new(false);
struct SingleQaPermit;
impl SingleQaPermit {
    fn acquire() -> Result<Self, String> {
        QA_ACTIVE
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "MESH_STAGE4W_ALREADY_RUNNING".to_string())?;
        Ok(Self)
    }
}
impl Drop for SingleQaPermit {
    fn drop(&mut self) {
        QA_ACTIVE.store(false, Ordering::Release);
    }
}

fn private_same_subnet(a: &Ipv4Addr, b: &Ipv4Addr) -> bool {
    // Narrow first physical QA to one RFC1918 /24; no public, VPN, loopback,
    // wildcard or broad LAN destinations. Future route selection needs review.
    a.is_private()
        && b.is_private()
        && a.octets()[..3] == b.octets()[..3]
        && a != b
        && !a.is_broadcast()
        && !b.is_broadcast()
}

fn lan_addr(local: &str, remote: &str, port: u16) -> Result<(SocketAddr, Ipv4Addr), String> {
    let local: Ipv4Addr = local.parse().map_err(|_| "MESH_STAGE4W_BAD_LAN_IP")?;
    let remote: Ipv4Addr = remote.parse().map_err(|_| "MESH_STAGE4W_BAD_LAN_PEER")?;
    if !(1025..=65535).contains(&port) || !private_same_subnet(&local, &remote) {
        return Err("MESH_STAGE4W_LAN_POLICY_DENIED".into());
    }
    Ok((SocketAddr::V4(SocketAddrV4::new(local, port)), remote))
}

fn bounded_cert(cert: &[u8]) -> Result<(), String> {
    if !(CERT_BYTES_MIN..=CERT_BYTES_MAX).contains(&cert.len()) {
        return Err("MESH_STAGE4W_CERT_LENGTH_DENIED".into());
    }
    Ok(())
}
async fn write_cert(socket: &mut TcpStream, cert: &[u8]) -> Result<(), String> {
    bounded_cert(cert)?;
    timeout(PRELUDE_DEADLINE, async {
        socket
            .write_all(&(cert.len() as u16).to_be_bytes())
            .await
            .map_err(|_| "MESH_STAGE4W_CERT_IO".to_string())?;
        socket
            .write_all(cert)
            .await
            .map_err(|_| "MESH_STAGE4W_CERT_IO".to_string())?;
        socket
            .flush()
            .await
            .map_err(|_| "MESH_STAGE4W_CERT_IO".to_string())
    })
    .await
    .map_err(|_| "MESH_STAGE4W_CERT_TIMEOUT".to_string())?
}
async fn read_cert(socket: &mut TcpStream) -> Result<Vec<u8>, String> {
    timeout(PRELUDE_DEADLINE, async {
        let mut len = [0u8; 2];
        socket
            .read_exact(&mut len)
            .await
            .map_err(|_| "MESH_STAGE4W_CERT_IO".to_string())?;
        let count = usize::from(u16::from_be_bytes(len));
        if !(CERT_BYTES_MIN..=CERT_BYTES_MAX).contains(&count) {
            return Err("MESH_STAGE4W_CERT_LENGTH_DENIED".into());
        }
        let mut der = vec![0u8; count];
        socket
            .read_exact(&mut der)
            .await
            .map_err(|_| "MESH_STAGE4W_CERT_IO".to_string())?;
        Ok(der)
    })
    .await
    .map_err(|_| "MESH_STAGE4W_CERT_TIMEOUT".to_string())?
}

async fn owner_qa_identity(requested_fingerprint: &str) -> Result<DeviceTlsIdentity, String> {
    // Admission fetches the exact existing pin from the OS Keychain; the
    // caller cannot create, rotate or substitute a device identity.
    mesh_admission::mesh_native_peer_preflight(requested_fingerprint.to_owned())
        .await
        .map_err(|_| "MESH_STAGE4W_ADMISSION_DENIED".to_string())?;
    let uid = crate::github_app_auth::verified_katosync_user()
        .await
        .map_err(|_| "MESH_STAGE4W_LOGIN_REQUIRED".to_string())?;
    let signing =
        existing_identity(&uid).map_err(|_| "MESH_STAGE4W_LOCAL_IDENTITY_MISSING".to_string())?;
    same_account_still_verified(&uid)
        .await
        .map_err(|_| "MESH_STAGE4W_ACCOUNT_CHANGED".to_string())?;
    DeviceTlsIdentity::from_signing_key(&signing)
        .map_err(|_| "MESH_STAGE4W_LOCAL_CERT_UNAVAILABLE".to_string())
}

/// Ephemeral read-only QA result. The socket is closed before returning;
/// "connected" and remote job claims remain false BY DESIGN.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OneShotQaResult {
    protocol: &'static str,
    peer_authenticated_once: bool,
    channel_still_active: bool,
    remote_jobs_enabled: bool,
    cross_device_writes: bool,
}
fn proof_complete() -> OneShotQaResult {
    OneShotQaResult {
        protocol: "katosync-stage4w-private-lan-once-v1",
        peer_authenticated_once: true,
        channel_still_active: false,
        remote_jobs_enabled: false,
        cross_device_writes: false,
    }
}

/// Owner-initiated, one-connection listener; never installed as background
/// LaunchAgent or started at Tauri setup. No automatic device approvals.
#[tauri::command]
pub(crate) async fn mesh_private_lan_listen_once_qa(
    local_ip: String,
    peer_ip: String,
    port: u16,
    requested_fingerprint: String,
) -> Result<OneShotQaResult, String> {
    gate()?;
    let _permit = SingleQaPermit::acquire()?;
    let (address, expected_ip) = lan_addr(&local_ip, &peer_ip, port)?;
    let identity = owner_qa_identity(&requested_fingerprint).await?;
    let listener = TcpListener::bind(address)
        .await
        .map_err(|_| "MESH_STAGE4W_LISTEN_UNAVAILABLE".to_string())?;
    let (mut socket, peer) = timeout(ACCEPT_DEADLINE, listener.accept())
        .await
        .map_err(|_| "MESH_STAGE4W_ACCEPT_TIMEOUT".to_string())?
        .map_err(|_| "MESH_STAGE4W_ACCEPT_FAILED".to_string())?;
    drop(listener); // no second client, no persistent listener
    if peer.ip() != expected_ip.into() {
        return Err("MESH_STAGE4W_SOURCE_IP_DENIED".into());
    }
    let certificate = read_cert(&mut socket).await?;
    write_cert(&mut socket, identity.certificate_der()).await?;
    // Rechecks issuer, same-account enrollment, live OS pin and revocation
    // before mTLS, then again afterwards. The remote cert is untrusted input.
    mesh_admission::probe_server_after_approval(socket, &requested_fingerprint, &certificate)
        .await
        .map_err(|_| "MESH_STAGE4W_PINNED_MTLS_DENIED".to_string())?;
    Ok(proof_complete())
}

/// Owner-initiated outbound QA; requires the listener's exact private LAN IP.
/// Does not inspect any received peer data beyond a bounded public cert.
#[tauri::command]
pub(crate) async fn mesh_private_lan_connect_once_qa(
    local_ip: String,
    peer_ip: String,
    port: u16,
    requested_fingerprint: String,
) -> Result<OneShotQaResult, String> {
    gate()?;
    let _permit = SingleQaPermit::acquire()?;
    // The endpoint is the PEER address, but both endpoints must be
    // explicitly private, distinct and on the same /24.
    let (_, expected_ip) = lan_addr(&local_ip, &peer_ip, port)?;
    let address = SocketAddr::V4(SocketAddrV4::new(expected_ip, port));
    let identity = owner_qa_identity(&requested_fingerprint).await?;
    let mut socket = timeout(CONNECT_DEADLINE, TcpStream::connect(address))
        .await
        .map_err(|_| "MESH_STAGE4W_CONNECT_TIMEOUT".to_string())?
        .map_err(|_| "MESH_STAGE4W_CONNECT_FAILED".to_string())?;
    if socket.peer_addr().map(|a| a.ip()).ok() != Some(expected_ip.into()) {
        return Err("MESH_STAGE4W_REMOTE_ADDRESS_MISMATCH".into());
    }
    write_cert(&mut socket, identity.certificate_der()).await?;
    let certificate = read_cert(&mut socket).await?;
    mesh_admission::probe_client_after_approval(socket, &requested_fingerprint, &certificate)
        .await
        .map_err(|_| "MESH_STAGE4W_PINNED_MTLS_DENIED".to_string())?;
    Ok(proof_complete())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        mesh_identity::fingerprint,
        mesh_transport::{client_probe, server_probe},
        mesh_trust::ApprovedPeer,
    };
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use ed25519_dalek::SigningKey;

    fn pin(signing: &SigningKey) -> ApprovedPeer {
        ApprovedPeer {
            fingerprint: fingerprint(&signing.verifying_key()),
            public_key: URL_SAFE_NO_PAD.encode(signing.verifying_key().as_bytes()),
            approved_at: 1_800_000_000,
            status: "locally_approved".into(),
        }
    }
    #[test]
    fn rejects_external_loopback_multicast_cross_subnet_and_privileged_ports() {
        assert!(lan_addr("192.168.178.97", "192.168.178.162", 39402).is_ok());
        for (a, b, port) in [
            ("192.168.178.97", "8.8.8.8", 39402),
            ("127.0.0.1", "192.168.178.162", 39402),
            ("0.0.0.0", "192.168.178.162", 39402),
            ("192.168.178.97", "192.168.177.162", 39402),
            ("192.168.178.97", "192.168.178.97", 39402),
            ("192.168.178.97", "192.168.178.162", 443),
        ] {
            assert!(lan_addr(a, b, port).is_err());
        }
    }
    #[test]
    fn owner_flag_and_feature_gate_reject_all_but_explicit_qa_opt_in() {
        assert!(!gate_decision(false, Some(QA_OPT_IN)));
        assert!(!gate_decision(true, None));
        assert!(!gate_decision(true, Some("1")));
        assert!(!gate_decision(true, Some("always")));
        assert!(gate_decision(true, Some(QA_OPT_IN)));
    }
    #[test]
    fn concurrent_native_qa_operations_fail_closed() {
        let one = SingleQaPermit::acquire().expect("first session");
        assert!(SingleQaPermit::acquire().is_err());
        drop(one);
        assert!(SingleQaPermit::acquire().is_ok());
    }
    #[test]
    fn only_a_one_shot_proof_without_remote_permissions_is_reported() {
        let value = serde_json::to_value(proof_complete()).unwrap();
        assert_eq!(value["peerAuthenticatedOnce"], true);
        assert_eq!(value["channelStillActive"], false);
        assert_eq!(value["remoteJobsEnabled"], false);
        assert_eq!(value["crossDeviceWrites"], false);
    }
    #[tokio::test]
    async fn bounded_public_cert_prelude_and_strict_tls_work_on_real_tcp_loopback() {
        let a = SigningKey::from_bytes(&[41; 32]);
        let b = SigningKey::from_bytes(&[42; 32]);
        let a_cert = DeviceTlsIdentity::from_signing_key(&a).unwrap();
        let b_cert = DeviceTlsIdentity::from_signing_key(&b).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (client, server) = tokio::join!(TcpStream::connect(addr), listener.accept());
        let mut client = client.unwrap();
        let mut server = server.unwrap().0;
        let left = async {
            write_cert(&mut client, a_cert.certificate_der())
                .await
                .unwrap();
            let der = read_cert(&mut client).await.unwrap();
            assert_eq!(der, b_cert.certificate_der());
            client_probe(client, &a_cert, &pin(&b), &der).await
        };
        let right = async {
            let der = read_cert(&mut server).await.unwrap();
            write_cert(&mut server, b_cert.certificate_der())
                .await
                .unwrap();
            assert_eq!(der, a_cert.certificate_der());
            server_probe(server, &b_cert, &pin(&a), &der).await
        };
        let (client_result, server_result) = tokio::join!(left, right);
        assert!(client_result.is_ok(), "{client_result:?}");
        assert!(server_result.is_ok(), "{server_result:?}");
    }
    #[tokio::test]
    async fn bad_cert_length_is_rejected_before_allocation_or_tls() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (client, server) = tokio::join!(TcpStream::connect(addr), listener.accept());
        let mut client = client.unwrap();
        let mut server = server.unwrap().0;
        client.write_all(&u16::MAX.to_be_bytes()).await.unwrap();
        let result = read_cert(&mut server).await;
        assert_eq!(
            result.err().as_deref(),
            Some("MESH_STAGE4W_CERT_LENGTH_DENIED")
        );
    }
}
