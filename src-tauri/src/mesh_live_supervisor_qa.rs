// Created by NMKato Solutions
//! Stage4AB.2: owner-launched, bounded, open TLS1.3 pinned heartbeat QA.
//! The original bounded QA entry remains unchanged. The runtime child reuses
//! its pinned handshake and heartbeat for the user-started private beta.
//! Neither path accepts file/command requests or grants remote-job authority.
//!
//! A successful proof is only an ephemeral QA receipt; after return the mTLS
//! stream has been closed and a UI must *not* claim a live Mesh connection.

pub mod runtime;

use crate::{
    mesh_admission::{self, NativeAdmission},
    mesh_clock_gap_qa::ClockGapMonitor,
    mesh_durable_lease_qa::LiveTlsLease,
    mesh_private_lan_qa::{read_cert, write_cert, SingleQaPermit},
    mesh_tailnet_qa::{policy, require_owner_opt_ins, verify_live_tailnet},
    mesh_tls::{strict_client_config, strict_server_config, DeviceTlsIdentity, TLS_PEER_DNS_NAME},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::{TcpListener, TcpSocket, TcpStream},
    time::{sleep, timeout},
};
use tokio_rustls::{TlsAcceptor, TlsConnector};

/// Stage4AB.3.2 sealed QA-only test injection, never production,
/// never selected through Stage4AB.2 or Stage4AB.3.1 CLI.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum QaFault {
    ServerDropAfterFirstAuthenticatedHeartbeat,
    ClientRequireUnexpectedTlsClose,
}

const OPT_IN_NAME: &str = "KATOSYNC_STAGE4AB2_LIVE_QA_ONCE";
const OPT_IN_VALUE: &str = "OWNER_LAUNCHED_LIVE_QA_ONLY";
const ACCEPT_TIMEOUT: Duration = Duration::from_secs(35);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const TLS_TIMEOUT: Duration = Duration::from_secs(12);
const FRAME_TIMEOUT: Duration = Duration::from_secs(16);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);
const BOUNDED_QA_MAX: Duration = Duration::from_secs(100);
const HEARTBEAT_COUNT: u64 = 3;
const HELLO_TAG: &[u8; 8] = b"KSM2HELO";
const HELLO_ACK_TAG: &[u8; 8] = b"KSM2ACK!";
const HB_TAG: &[u8; 8] = b"KSM2PING";
const HB_ACK_TAG: &[u8; 8] = b"KSM2PONG";
const HELLO_LEN: usize = 40;
const HELLO_ACK_LEN: usize = 72;
const HEARTBEAT_LEN: usize = 48;

fn owner_gate(compiled: bool, value: Option<&str>) -> bool {
    compiled && value == Some(OPT_IN_VALUE)
}
fn require_all_opt_ins() -> Result<(), String> {
    require_owner_opt_ins()?;
    if owner_gate(
        cfg!(feature = "stage4j-qa"),
        std::env::var(OPT_IN_NAME).ok().as_deref(),
    ) {
        Ok(())
    } else {
        Err("MESH_STAGE4AB2_EXPLICIT_SUPERVISOR_QA_OPT_IN_REQUIRED".into())
    }
}

fn binding_material(admitted: &NativeAdmission) -> Result<([u8; 16], [u8; 32], [u8; 32]), String> {
    let owner = uuid::Uuid::parse_str(&admitted.owner_uid)
        .map_err(|_| "MESH_STAGE4AB2_OWNER_DENIED".to_string())?;
    let peer = URL_SAFE_NO_PAD
        .decode(&admitted.approved_peer.public_key)
        .map_err(|_| "MESH_STAGE4AB2_PEER_PIN_DENIED".to_string())?;
    let peer: [u8; 32] = peer
        .try_into()
        .map_err(|_| "MESH_STAGE4AB2_PEER_PIN_DENIED".to_string())?;
    Ok((
        *owner.as_bytes(),
        admitted.local_signing.verifying_key().to_bytes(),
        peer,
    ))
}

fn new_nonce() -> [u8; 32] {
    let mut value = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut value);
    value
}

fn session_nonce(client: &[u8; 32], server: &[u8; 32]) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"katosync-stage4ab2-pinned-session-v1");
    hash.update(client);
    hash.update(server);
    hash.finalize().into()
}

/// Both nonces are exchanged only AFTER strict Ed25519-pinned TLS1.3 mutual
/// auth. A single Stage4AA proof or Tailscale-online result cannot call this.
async fn client_session_init<T: AsyncRead + AsyncWrite + Unpin>(
    tls: &mut T,
    client_nonce: [u8; 32],
) -> Result<[u8; 32], String> {
    timeout(TLS_TIMEOUT, async {
        let mut hello = [0u8; HELLO_LEN];
        hello[..8].copy_from_slice(HELLO_TAG);
        hello[8..].copy_from_slice(&client_nonce);
        tls.write_all(&hello)
            .await
            .map_err(|_| "MESH_STAGE4AB2_INIT_IO")?;
        tls.flush().await.map_err(|_| "MESH_STAGE4AB2_INIT_IO")?;
        let mut ack = [0u8; HELLO_ACK_LEN];
        tls.read_exact(&mut ack)
            .await
            .map_err(|_| "MESH_STAGE4AB2_INIT_IO")?;
        if &ack[..8] != HELLO_ACK_TAG || ack[8..40] != client_nonce {
            return Err("MESH_STAGE4AB2_BAD_INIT_ACK");
        }
        let mut server_nonce = [0u8; 32];
        server_nonce.copy_from_slice(&ack[40..]);
        if server_nonce.iter().all(|byte| *byte == 0) {
            return Err("MESH_STAGE4AB2_BAD_INIT_NONCE");
        }
        Ok(session_nonce(&client_nonce, &server_nonce))
    })
    .await
    .map_err(|_| "MESH_STAGE4AB2_INIT_TIMEOUT".to_string())?
    .map_err(str::to_string)
}

async fn server_session_init<T: AsyncRead + AsyncWrite + Unpin>(
    tls: &mut T,
    server_nonce: [u8; 32],
) -> Result<[u8; 32], String> {
    timeout(TLS_TIMEOUT, async {
        let mut hello = [0u8; HELLO_LEN];
        tls.read_exact(&mut hello)
            .await
            .map_err(|_| "MESH_STAGE4AB2_INIT_IO")?;
        if &hello[..8] != HELLO_TAG || hello[8..].iter().all(|byte| *byte == 0) {
            return Err("MESH_STAGE4AB2_BAD_INIT_HELLO");
        }
        let mut client_nonce = [0u8; 32];
        client_nonce.copy_from_slice(&hello[8..]);
        let mut ack = [0u8; HELLO_ACK_LEN];
        ack[..8].copy_from_slice(HELLO_ACK_TAG);
        ack[8..40].copy_from_slice(&client_nonce);
        ack[40..].copy_from_slice(&server_nonce);
        tls.write_all(&ack)
            .await
            .map_err(|_| "MESH_STAGE4AB2_INIT_IO")?;
        tls.flush().await.map_err(|_| "MESH_STAGE4AB2_INIT_IO")?;
        Ok(session_nonce(&client_nonce, &server_nonce))
    })
    .await
    .map_err(|_| "MESH_STAGE4AB2_INIT_TIMEOUT".to_string())?
    .map_err(str::to_string)
}

fn heartbeat_frame(tag: &[u8; 8], sequence: u64, session: &[u8; 32]) -> [u8; HEARTBEAT_LEN] {
    let mut frame = [0u8; HEARTBEAT_LEN];
    frame[..8].copy_from_slice(tag);
    frame[8..16].copy_from_slice(&sequence.to_be_bytes());
    frame[16..].copy_from_slice(session);
    frame
}
fn verify_heartbeat_frame(
    frame: &[u8; HEARTBEAT_LEN],
    tag: &[u8; 8],
    sequence: u64,
    session: &[u8; 32],
) -> Result<(), String> {
    if frame != &heartbeat_frame(tag, sequence, session) {
        return Err("MESH_STAGE4AB2_HEARTBEAT_REPLAY_OR_MISMATCH".into());
    }
    Ok(())
}
async fn heartbeat_client<T: AsyncRead + AsyncWrite + Unpin>(
    tls: &mut T,
    sequence: u64,
    session: &[u8; 32],
) -> Result<(), String> {
    timeout(FRAME_TIMEOUT, async {
        tls.write_all(&heartbeat_frame(HB_TAG, sequence, session))
            .await
            .map_err(|_| "MESH_STAGE4AB2_HEARTBEAT_IO")?;
        tls.flush()
            .await
            .map_err(|_| "MESH_STAGE4AB2_HEARTBEAT_IO")?;
        let mut response = [0u8; HEARTBEAT_LEN];
        tls.read_exact(&mut response)
            .await
            .map_err(|_| "MESH_STAGE4AB2_HEARTBEAT_IO")?;
        verify_heartbeat_frame(&response, HB_ACK_TAG, sequence, session)
            .map_err(|_| "MESH_STAGE4AB2_HEARTBEAT_DENIED")
    })
    .await
    .map_err(|_| "MESH_STAGE4AB2_HEARTBEAT_TIMEOUT".to_string())?
    .map_err(str::to_string)
}
// Test-only adapter to the exact existing pinned-TLS supervisor heartbeat
// parser / sequence / timeout. No QA CLI, Tauri command or runtime entry.
#[cfg(test)]
pub(crate) async fn heartbeat_client_for_os_callback_qa<T: AsyncRead + AsyncWrite + Unpin>(
    tls: &mut T,
    sequence: u64,
    session: &[u8; 32],
) -> Result<(), String> {
    heartbeat_client(tls, sequence, session).await
}

async fn heartbeat_server<T: AsyncRead + AsyncWrite + Unpin>(
    tls: &mut T,
    sequence: u64,
    session: &[u8; 32],
    admitted: &NativeAdmission,
    peer_fingerprint: &str,
) -> Result<(), String> {
    timeout(FRAME_TIMEOUT, async {
        let mut request = [0u8; HEARTBEAT_LEN];
        tls.read_exact(&mut request)
            .await
            .map_err(|_| "MESH_STAGE4AB2_HEARTBEAT_IO")?;
        verify_heartbeat_frame(&request, HB_TAG, sequence, session)
            .map_err(|_| "MESH_STAGE4AB2_HEARTBEAT_DENIED")?;
        // Revalidate server pin, owner session and BOTH enrollments *before*
        // the responder ACK is issued. Revocation must never yield success.
        let authority = mesh_admission::recheck_after_probe(admitted, peer_fingerprint).await;
        acknowledge_server_heartbeat_after_recheck(tls, sequence, session, authority).await
    })
    .await
    .map_err(|_| "MESH_STAGE4AB2_HEARTBEAT_TIMEOUT".to_string())?
    .map_err(str::to_string)
}

async fn acknowledge_server_heartbeat_after_recheck<T: AsyncWrite + Unpin>(
    tls: &mut T,
    sequence: u64,
    session: &[u8; 32],
    authority: Result<(), String>,
) -> Result<(), &'static str> {
    // This exact code is emitted only by the typed native authority classifier.
    // A temporary outage still denies this heartbeat; a new connection must
    // repeat full admission. Every other failure remains a terminal denial.
    authority.map_err(|error| match error.as_str() {
        "MESH_ADMISSION_AUTHORITY_UNAVAILABLE" => "MESH_ADMISSION_AUTHORITY_UNAVAILABLE",
        _ => "MESH_STAGE4AB2_OWNER_OR_PIN_REVOKED",
    })?;
    tls.write_all(&heartbeat_frame(HB_ACK_TAG, sequence, session))
        .await
        .map_err(|_| "MESH_STAGE4AB2_HEARTBEAT_IO")?;
    tls.flush().await.map_err(|_| "MESH_STAGE4AB2_HEARTBEAT_IO")
}

async fn server_once(
    local: Ipv4Addr,
    peer: Ipv4Addr,
    port: u16,
    peer_fingerprint: &str,
    fault: Option<QaFault>,
) -> Result<(), String> {
    verify_live_tailnet(local, peer).await?;
    let admitted = mesh_admission::authorize(peer_fingerprint)
        .await
        .map_err(|_| "MESH_STAGE4AB2_ADMISSION_DENIED".to_string())?;
    let identity = DeviceTlsIdentity::from_signing_key(&admitted.local_signing)
        .map_err(|_| "MESH_STAGE4AB2_LOCAL_TLS_DENIED".to_string())?;
    verify_live_tailnet(local, peer).await?;
    let endpoint = SocketAddr::V4(SocketAddrV4::new(local, port));
    let listener = TcpListener::bind(endpoint)
        .await
        .map_err(|_| "MESH_STAGE4AB2_BIND_DENIED".to_string())?;
    let (mut socket, source) = timeout(ACCEPT_TIMEOUT, listener.accept())
        .await
        .map_err(|_| "MESH_STAGE4AB2_ACCEPT_TIMEOUT".to_string())?
        .map_err(|_| "MESH_STAGE4AB2_ACCEPT_DENIED".to_string())?;
    drop(listener);
    if source.ip() != IpAddr::V4(peer) {
        return Err("MESH_STAGE4AB2_SOURCE_IP_DENIED".into());
    }
    verify_live_tailnet(local, peer).await?;
    let client_cert = read_cert(&mut socket).await?;
    write_cert(&mut socket, identity.certificate_der()).await?;
    let config = strict_server_config(&identity, &admitted.approved_peer, &client_cert)
        .map_err(|_| "MESH_STAGE4AB2_CERT_PIN_DENIED".to_string())?;
    let mut tls = timeout(
        TLS_TIMEOUT,
        TlsAcceptor::from(Arc::new(config)).accept(socket),
    )
    .await
    .map_err(|_| "MESH_STAGE4AB2_TLS_TIMEOUT".to_string())?
    .map_err(|_| "MESH_STAGE4AB2_TLS_REJECTED".to_string())?;
    let session = server_session_init(&mut tls, new_nonce()).await?;
    mesh_admission::recheck_after_probe(&admitted, peer_fingerprint)
        .await
        .map_err(|_| "MESH_STAGE4AB2_ADMISSION_REVOKED".to_string())?;
    let (owner, local_key, remote_key) = binding_material(&admitted)?;
    let mut lease = LiveTlsLease::after_verified_open_channel(
        owner,
        local_key,
        remote_key,
        session,
        Instant::now(),
    )?;
    // Fail closed on macOS sleep/wake gaps even if the kernel does not
    // emit a socket EOF and Instant pauses while the machine sleeps.
    let mut clock_gap = ClockGapMonitor::capture();
    for seq in 1..=HEARTBEAT_COUNT {
        clock_gap
            .check_or_invalidate(&mut lease)
            .map_err(str::to_string)?;
        if !lease.is_live(Instant::now()) {
            return Err("MESH_STAGE4AB2_LEASE_EXPIRED".into());
        }
        verify_live_tailnet(local, peer).await?;
        heartbeat_server(&mut tls, seq, &session, &admitted, peer_fingerprint).await?;
        clock_gap
            .check_or_invalidate(&mut lease)
            .map_err(str::to_string)?;
        mesh_admission::recheck_after_probe(&admitted, peer_fingerprint)
            .await
            .map_err(|_| "MESH_STAGE4AB2_ADMISSION_REVOKED".to_string())?;
        clock_gap
            .check_or_invalidate(&mut lease)
            .map_err(str::to_string)?;
        lease.verified_in_channel_heartbeat(seq, Instant::now())?;
        if seq == 1 && fault == Some(QaFault::ServerDropAfterFirstAuthenticatedHeartbeat) {
            // A REAL open, pinned TLS stream is dropped now. No synthetic
            // "connected" event, no Tailscale/OS device or key manipulation.
            // Client must observe the closed stream before any reconnect.
            lease.on_network_loss();
            return Err("MESH_STAGE4AB32_VERIFIED_TLS_STREAM_INTENTIONALLY_DROPPED".into());
        }
    }
    lease.close();
    // Stream scope ends here. Positive return must NOT imply current online
    // status. No remote jobs, no background listener or persistent socket.
    Ok(())
}

async fn client_once(
    local: Ipv4Addr,
    peer: Ipv4Addr,
    port: u16,
    peer_fingerprint: &str,
    fault: Option<QaFault>,
) -> Result<(), String> {
    verify_live_tailnet(local, peer).await?;
    let admitted = mesh_admission::authorize(peer_fingerprint)
        .await
        .map_err(|_| "MESH_STAGE4AB2_ADMISSION_DENIED".to_string())?;
    let identity = DeviceTlsIdentity::from_signing_key(&admitted.local_signing)
        .map_err(|_| "MESH_STAGE4AB2_LOCAL_TLS_DENIED".to_string())?;
    verify_live_tailnet(local, peer).await?;
    let socket = TcpSocket::new_v4().map_err(|_| "MESH_STAGE4AB2_SOCKET_DENIED")?;
    socket
        .bind(SocketAddr::V4(SocketAddrV4::new(local, 0)))
        .map_err(|_| "MESH_STAGE4AB2_SOURCE_BIND_DENIED")?;
    let destination = SocketAddr::V4(SocketAddrV4::new(peer, port));
    let mut socket: TcpStream = timeout(CONNECT_TIMEOUT, socket.connect(destination))
        .await
        .map_err(|_| "MESH_STAGE4AB2_CONNECT_TIMEOUT")?
        .map_err(|_| "MESH_STAGE4AB2_CONNECT_DENIED")?;
    if socket.peer_addr().ok().map(|v| v.ip()) != Some(IpAddr::V4(peer))
        || socket.local_addr().ok().map(|v| v.ip()) != Some(IpAddr::V4(local))
    {
        return Err("MESH_STAGE4AB2_SOURCE_OR_PEER_IP_DENIED".into());
    }
    write_cert(&mut socket, identity.certificate_der()).await?;
    let server_cert = read_cert(&mut socket).await?;
    let config = strict_client_config(&identity, &admitted.approved_peer, &server_cert)
        .map_err(|_| "MESH_STAGE4AB2_CERT_PIN_DENIED".to_string())?;
    let server_name = rustls::pki_types::ServerName::try_from(TLS_PEER_DNS_NAME)
        .map_err(|_| "MESH_STAGE4AB2_TLS_NAME_DENIED".to_string())?;
    let mut tls = timeout(
        TLS_TIMEOUT,
        TlsConnector::from(Arc::new(config)).connect(server_name, socket),
    )
    .await
    .map_err(|_| "MESH_STAGE4AB2_TLS_TIMEOUT".to_string())?
    .map_err(|_| "MESH_STAGE4AB2_TLS_REJECTED".to_string())?;
    let session = client_session_init(&mut tls, new_nonce()).await?;
    mesh_admission::recheck_after_probe(&admitted, peer_fingerprint)
        .await
        .map_err(|_| "MESH_STAGE4AB2_ADMISSION_REVOKED".to_string())?;
    let (owner, local_key, remote_key) = binding_material(&admitted)?;
    let mut lease = LiveTlsLease::after_verified_open_channel(
        owner,
        local_key,
        remote_key,
        session,
        Instant::now(),
    )?;
    // Fail closed on macOS sleep/wake gaps even if the kernel does not
    // emit a socket EOF and Instant pauses while the machine sleeps.
    let mut clock_gap = ClockGapMonitor::capture();
    for seq in 1..=HEARTBEAT_COUNT {
        clock_gap
            .check_or_invalidate(&mut lease)
            .map_err(str::to_string)?;
        sleep(HEARTBEAT_INTERVAL).await;
        if !lease.is_live(Instant::now()) {
            return Err("MESH_STAGE4AB2_LEASE_EXPIRED".into());
        }
        verify_live_tailnet(local, peer).await?;
        mesh_admission::recheck_after_probe(&admitted, peer_fingerprint)
            .await
            .map_err(|_| "MESH_STAGE4AB2_ADMISSION_REVOKED".to_string())?;
        if seq == 2 && fault == Some(QaFault::ClientRequireUnexpectedTlsClose) {
            match heartbeat_client(&mut tls, seq, &session).await {
                Err(error) if error == "MESH_STAGE4AB2_HEARTBEAT_IO" => {
                    lease.on_network_loss();
                    return Err("MESH_STAGE4AB32_REMOTE_TLS_CLOSED_AFTER_AUTHENTICATED_HB".into());
                }
                Ok(()) => return Err("MESH_STAGE4AB32_EXPECTED_DROP_DID_NOT_HAPPEN".into()),
                Err(error) => return Err(error),
            }
        }
        heartbeat_client(&mut tls, seq, &session).await?;
        clock_gap
            .check_or_invalidate(&mut lease)
            .map_err(str::to_string)?;
        mesh_admission::recheck_after_probe(&admitted, peer_fingerprint)
            .await
            .map_err(|_| "MESH_STAGE4AB2_ADMISSION_REVOKED".to_string())?;
        clock_gap
            .check_or_invalidate(&mut lease)
            .map_err(str::to_string)?;
        lease.verified_in_channel_heartbeat(seq, Instant::now())?;
    }
    lease.close();
    Ok(())
}

pub(crate) async fn run_once(args: Vec<String>) -> Result<(), String> {
    require_all_opt_ins()?;
    let _permit = SingleQaPermit::acquire()
        .map_err(|_| "MESH_STAGE4AB2_CONCURRENT_PROBE_DENIED".to_string())?;
    run_once_under_existing_qa_permit(&_permit, args).await
}

/// Stage4AB.3 internal-only entry: the caller already owns the original
/// SingleQaPermit across BOTH bounded re-authenticated sessions. The AB2
/// owner/QA gates are rechecked on each attempt. Not exposed to IPC.
pub(crate) async fn run_once_under_existing_qa_permit(
    _permit: &SingleQaPermit,
    args: Vec<String>,
) -> Result<(), String> {
    run_once_with_optional_qa_fault(_permit, args, None).await
}

/// Only Stage4AB.3.2 may request a controlled fault. This requires the
/// original sealed exclusive permit AND the normal owner triple opt-ins.
pub(crate) async fn run_fault_under_existing_qa_permit(
    permit: &SingleQaPermit,
    args: Vec<String>,
    fault: QaFault,
) -> Result<(), String> {
    run_once_with_optional_qa_fault(permit, args, Some(fault)).await
}

async fn run_once_with_optional_qa_fault(
    _permit: &SingleQaPermit,
    args: Vec<String>,
    fault: Option<QaFault>,
) -> Result<(), String> {
    require_all_opt_ins()?;
    if args.len() != 5 {
        return Err("MESH_STAGE4AB2_ARGUMENTS_DENIED".into());
    }
    let port = args[3]
        .parse::<u16>()
        .map_err(|_| "MESH_STAGE4AB2_PORT_DENIED")?;
    let (local, remote) = policy(&args[1], &args[2], port)?;
    let result = match (args[0].as_str(), fault) {
        ("listen", None | Some(QaFault::ServerDropAfterFirstAuthenticatedHeartbeat)) => {
            timeout(
                BOUNDED_QA_MAX,
                server_once(local, remote, port, &args[4], fault),
            )
            .await
        }
        ("connect", None | Some(QaFault::ClientRequireUnexpectedTlsClose)) => {
            timeout(
                BOUNDED_QA_MAX,
                client_once(local, remote, port, &args[4], fault),
            )
            .await
        }
        _ => return Err("MESH_STAGE4AB32_ROLE_OR_FAULT_DENIED".into()),
    };
    result.map_err(|_| "MESH_STAGE4AB2_QA_DEADLINE_EXCEEDED".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    async fn server_ack_after_recheck(
        authority: Result<(), String>,
    ) -> (Result<(), &'static str>, Vec<u8>) {
        let (mut client, mut server) = duplex(256);
        let result =
            acknowledge_server_heartbeat_after_recheck(&mut server, 1, &[7; 32], authority).await;
        drop(server);
        let mut reply = Vec::new();
        client.read_to_end(&mut reply).await.unwrap();
        (result, reply)
    }

    #[tokio::test]
    async fn server_heartbeat_preserves_temporary_authority_failure_without_ack() {
        let (result, reply) =
            server_ack_after_recheck(Err("MESH_ADMISSION_AUTHORITY_UNAVAILABLE".into())).await;
        assert_eq!(result, Err("MESH_ADMISSION_AUTHORITY_UNAVAILABLE"));
        assert!(
            reply.is_empty(),
            "an unavailable authority must never issue an ACK"
        );
    }

    #[tokio::test]
    async fn server_heartbeat_denials_and_unclassified_errors_never_ack_or_become_retryable() {
        for error in [
            "MESH_ADMISSION_LOGIN_REQUIRED",
            "MESH_ADMISSION_ACCOUNT_CHANGED",
            "MESH_ADMISSION_LOCAL_IDENTITY_MISSING",
            "MESH_ADMISSION_LOCAL_IDENTITY_CHANGED",
            "MESH_ADMISSION_PEER_NOT_APPROVED",
            "MESH_ADMISSION_PEER_REVOKED",
            "MESH_ADMISSION_PEER_CHANGED",
            "MESH_ADMISSION_ENROLLMENT_REQUIRED",
            "MESH_ADMISSION_ENROLLMENT_REVOKED",
            "SESSION_EXPIRED",
            "timeout after peer revocation",
            "HTTP 503: enrollment denied",
            "MESH_ADMISSION_AUTHORITY_UNAVAILABLE: revoked",
            "mesh_admission_authority_unavailable",
            "unknown",
        ] {
            let (result, reply) = server_ack_after_recheck(Err(error.into())).await;
            assert_eq!(
                result,
                Err("MESH_STAGE4AB2_OWNER_OR_PIN_REVOKED"),
                "{error}"
            );
            assert!(reply.is_empty(), "denied authority issued an ACK: {error}");
        }
    }

    #[tokio::test]
    async fn server_heartbeat_ack_requires_successful_authority_recheck() {
        let (result, reply) = server_ack_after_recheck(Ok(())).await;
        assert_eq!(result, Ok(()));
        assert_eq!(reply, heartbeat_frame(HB_ACK_TAG, 1, &[7; 32]));
    }

    #[test]
    fn supervisor_requires_separate_explicit_opt_in() {
        assert!(!owner_gate(true, None));
        assert!(!owner_gate(false, Some(OPT_IN_VALUE)));
        assert!(!owner_gate(true, Some("true")));
        assert!(owner_gate(true, Some(OPT_IN_VALUE)));
    }

    #[tokio::test]
    async fn authenticated_stream_frames_bind_nonce_and_strictly_ordered_sequence() {
        let (mut client, mut server) = duplex(1024);
        let (client_nonce, server_nonce) = ([3u8; 32], [7u8; 32]);
        let (a, b) = tokio::join!(
            client_session_init(&mut client, client_nonce),
            server_session_init(&mut server, server_nonce)
        );
        let (client_session, server_session) = (a.unwrap(), b.unwrap());
        assert_eq!(client_session, server_session);
        let (a, b) = tokio::join!(heartbeat_client(&mut client, 1, &client_session), async {
            let mut request = [0u8; HEARTBEAT_LEN];
            server.read_exact(&mut request).await.unwrap();
            verify_heartbeat_frame(&request, HB_TAG, 1, &server_session).unwrap();
            server
                .write_all(&heartbeat_frame(HB_ACK_TAG, 1, &server_session))
                .await
                .unwrap();
        });
        assert!(a.is_ok(), "{a:?}");
        b;
        assert!(verify_heartbeat_frame(
            &heartbeat_frame(HB_TAG, 1, &client_session),
            HB_TAG,
            2,
            &client_session
        )
        .is_err());
        assert!(verify_heartbeat_frame(
            &heartbeat_frame(HB_TAG, 1, &client_session),
            HB_TAG,
            1,
            &[8u8; 32]
        )
        .is_err());
        assert!(verify_heartbeat_frame(
            &heartbeat_frame(HB_TAG, 1, &client_session),
            HB_ACK_TAG,
            1,
            &client_session
        )
        .is_err());
    }

    #[tokio::test]
    async fn ab32_client_observes_real_io_close_after_first_valid_heartbeat() {
        let (mut client, mut server) = duplex(1024);
        let session = [7u8; 32];
        let (client_result, ()) = tokio::join!(
            async {
                let first = heartbeat_client(&mut client, 1, &session).await;
                let second = heartbeat_client(&mut client, 2, &session).await;
                (first, second)
            },
            async {
                let mut incoming = [0u8; HEARTBEAT_LEN];
                server.read_exact(&mut incoming).await.unwrap();
                verify_heartbeat_frame(&incoming, HB_TAG, 1, &session).unwrap();
                server
                    .write_all(&heartbeat_frame(HB_ACK_TAG, 1, &session))
                    .await
                    .unwrap();
                server.flush().await.unwrap();
                // Physical half of in-memory stream closes. Next heartbeat
                // must NOT be accepted or converted to a live session.
                drop(server);
            }
        );
        assert!(client_result.0.is_ok());
        assert_eq!(
            client_result.1.err().as_deref(),
            Some("MESH_STAGE4AB2_HEARTBEAT_IO")
        );
    }

    #[tokio::test]
    async fn forged_server_ack_is_rejected_before_lease_creation() {
        let (mut client, mut server) = duplex(256);
        let (result, ()) = tokio::join!(client_session_init(&mut client, [9u8; 32]), async {
            let mut hello = [0u8; HELLO_LEN];
            server.read_exact(&mut hello).await.unwrap();
            let mut bad = [0u8; HELLO_ACK_LEN];
            bad[..8].copy_from_slice(HELLO_ACK_TAG);
            bad[8..40].copy_from_slice(&[8u8; 32]);
            bad[40..].copy_from_slice(&[7u8; 32]);
            server.write_all(&bad).await.unwrap();
        });
        assert_eq!(result.err().as_deref(), Some("MESH_STAGE4AB2_BAD_INIT_ACK"));
    }

    #[test]
    fn raw_heartbeat_frames_reject_replayed_sequence_or_wrong_session() {
        let session = [4u8; 32];
        let first = heartbeat_frame(HB_TAG, 1, &session);
        assert!(verify_heartbeat_frame(&first, HB_TAG, 1, &session).is_ok());
        assert!(verify_heartbeat_frame(&first, HB_TAG, 2, &session).is_err());
        assert!(verify_heartbeat_frame(&first, HB_TAG, 1, &[9u8; 32]).is_err());
    }
}
