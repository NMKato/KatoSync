// Created by NMKato Solutions
//! Stage4AB.2: internal owner-bound heartbeat protocol on a genuinely pinned
//! TLS 1.3 socket. NO runtime caller, CLI, IPC, persistent listener or jobs.
//! Never claim that a closed Stage4AA one-shot grants a live Mesh lease.
use super::{ChannelBinding, MeshLeaseMachine, ValidatedOpenTlsSocket, VerifiedInChannelHeartbeat};
use crate::{
    mesh_tls::{strict_client_config, strict_server_config, DeviceTlsIdentity, TLS_PEER_DNS_NAME},
    mesh_trust::ApprovedPeer,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::SigningKey;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time::timeout,
};
use tokio_rustls::{TlsAcceptor, TlsConnector};

const OPEN: &[u8; 8] = b"KAB2OPEN";
const ACCEPT: &[u8; 8] = b"KAB2ACPT";
const BEAT: &[u8; 8] = b"KAB2BEAT";
const REPLY: &[u8; 8] = b"KAB2RPLY";
const WAIT: Duration = Duration::from_secs(6);
// Stage4AM: only a test-only native RC66L receive proof on the SAME pinned
// rustls channel. No production caller, listener, IPC or remote job path.
#[cfg(test)]
#[path = "inchannel_qa/stage4am_rc66l_native_qa.rs"]
mod stage4am_rc66l_native_qa;
fn deny() -> String {
    "STAGE4AB2_INCHANNEL_DENIED".into()
}
fn nonce() -> [u8; 32] {
    let mut n = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut n);
    n
}
fn validate_owner(owner: [u8; 16]) -> Result<(), String> {
    if owner.iter().all(|x| *x == 0) {
        Err(deny())
    } else {
        Ok(())
    }
}
fn binding(
    owner: [u8; 16],
    local: &SigningKey,
    peer: &ApprovedPeer,
    a: [u8; 32],
    b: [u8; 32],
) -> Result<ChannelBinding, String> {
    let remote: [u8; 32] = URL_SAFE_NO_PAD
        .decode(&peer.public_key)
        .map_err(|_| deny())?
        .try_into()
        .map_err(|_| deny())?;
    if local.verifying_key().to_bytes() == remote {
        return Err(deny());
    }
    let mut hash = Sha256::new();
    hash.update(b"KatoSync Stage4AB2 verified TLS peer session");
    hash.update(owner);
    hash.update(a);
    hash.update(b);
    Ok(ChannelBinding {
        owner_id: owner,
        local_ed25519: local.verifying_key().to_bytes(),
        peer_ed25519: remote,
        tls_session_nonce: hash.finalize().into(),
    })
}
fn lease(b: ChannelBinding) -> Result<MeshLeaseMachine, String> {
    let mut m = MeshLeaseMachine::default();
    if !m.locally_approved()
        || !m.begin_verification()
        || !m.on_still_open_tls_socket(ValidatedOpenTlsSocket { binding: b }, Instant::now())
    {
        return Err(deny());
    }
    Ok(m)
}
#[derive(Debug)]
struct Proof {
    verified: u64,
    live_before_close: bool,
    live_after_close: bool,
    jobs_enabled: bool,
}
fn close(mut m: MeshLeaseMachine, n: u64) -> Result<Proof, String> {
    let before = m.snapshot(Instant::now());
    if !before.live_peer_authenticated
        || before.remote_jobs_enabled
        || before.remote_read_only_dispatch
        || n != 2
    {
        return Err(deny());
    }
    m.socket_closed();
    let after = m.snapshot(Instant::now());
    Ok(Proof {
        verified: n,
        live_before_close: before.live_peer_authenticated,
        live_after_close: after.live_peer_authenticated,
        jobs_enabled: after.remote_jobs_enabled,
    })
}
// The authenticated owner/key pin MUST originate from native KatoOS admission.
// This private function is not routable from a model, UI or remote MCP.
async fn client(
    socket: TcpStream,
    signing: &SigningKey,
    approved: &ApprovedPeer,
    cert: &[u8],
    owner: [u8; 16],
    sequences: [u64; 2],
) -> Result<Proof, String> {
    validate_owner(owner)?;
    let local = DeviceTlsIdentity::from_signing_key(signing).map_err(|_| deny())?;
    let config = strict_client_config(&local, approved, cert).map_err(|_| deny())?;
    let dns = rustls::pki_types::ServerName::try_from(TLS_PEER_DNS_NAME).map_err(|_| deny())?;
    let mut tls = timeout(
        WAIT,
        TlsConnector::from(Arc::new(config)).connect(dns, socket),
    )
    .await
    .map_err(|_| deny())?
    .map_err(|_| deny())?;
    if tls.get_ref().1.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3) {
        return Err(deny());
    }
    let client_nonce = nonce();
    let mut request = [0u8; 56];
    request[..8].copy_from_slice(OPEN);
    request[8..24].copy_from_slice(&owner);
    request[24..].copy_from_slice(&client_nonce);
    timeout(WAIT, tls.write_all(&request))
        .await
        .map_err(|_| deny())?
        .map_err(|_| deny())?;
    let mut response = [0u8; 72];
    timeout(WAIT, tls.read_exact(&mut response))
        .await
        .map_err(|_| deny())?
        .map_err(|_| deny())?;
    if &response[..8] != ACCEPT || response[8..40] != client_nonce {
        return Err(deny());
    }
    let server_nonce: [u8; 32] = response[40..].try_into().map_err(|_| deny())?;
    let b = binding(owner, signing, approved, client_nonce, server_nonce)?;
    let mut state = lease(b)?;
    for seq in sequences {
        let mut msg = [0u8; 48];
        msg[..8].copy_from_slice(BEAT);
        msg[8..16].copy_from_slice(&seq.to_be_bytes());
        msg[16..].copy_from_slice(&b.tls_session_nonce);
        timeout(WAIT, tls.write_all(&msg))
            .await
            .map_err(|_| deny())?
            .map_err(|_| deny())?;
        let mut ack = [0u8; 48];
        timeout(WAIT, tls.read_exact(&mut ack))
            .await
            .map_err(|_| deny())?
            .map_err(|_| deny())?;
        if &ack[..8] != REPLY || ack[8..] != msg[8..] {
            return Err(deny());
        }
        if !state.on_verified_channel_heartbeat(
            VerifiedInChannelHeartbeat {
                binding: b,
                sequence: seq,
            },
            Instant::now(),
        ) {
            return Err(deny());
        }
    }
    timeout(WAIT, tls.shutdown())
        .await
        .map_err(|_| deny())?
        .map_err(|_| deny())?;
    close(state, 2)
}
async fn server(
    socket: TcpStream,
    signing: &SigningKey,
    approved: &ApprovedPeer,
    cert: &[u8],
    owner: [u8; 16],
) -> Result<Proof, String> {
    validate_owner(owner)?;
    let local = DeviceTlsIdentity::from_signing_key(signing).map_err(|_| deny())?;
    let config = strict_server_config(&local, approved, cert).map_err(|_| deny())?;
    let mut tls = timeout(WAIT, TlsAcceptor::from(Arc::new(config)).accept(socket))
        .await
        .map_err(|_| deny())?
        .map_err(|_| deny())?;
    if tls.get_ref().1.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3) {
        return Err(deny());
    }
    let mut request = [0u8; 56];
    timeout(WAIT, tls.read_exact(&mut request))
        .await
        .map_err(|_| deny())?
        .map_err(|_| deny())?;
    if &request[..8] != OPEN || request[8..24] != owner {
        return Err(deny());
    }
    let client_nonce: [u8; 32] = request[24..].try_into().map_err(|_| deny())?;
    let server_nonce = nonce();
    let b = binding(owner, signing, approved, client_nonce, server_nonce)?;
    let mut state = lease(b)?;
    let mut response = [0u8; 72];
    response[..8].copy_from_slice(ACCEPT);
    response[8..40].copy_from_slice(&client_nonce);
    response[40..].copy_from_slice(&server_nonce);
    timeout(WAIT, tls.write_all(&response))
        .await
        .map_err(|_| deny())?
        .map_err(|_| deny())?;
    for _ in 0..2 {
        let mut msg = [0u8; 48];
        timeout(WAIT, tls.read_exact(&mut msg))
            .await
            .map_err(|_| deny())?
            .map_err(|_| deny())?;
        if &msg[..8] != BEAT || msg[16..] != b.tls_session_nonce {
            return Err(deny());
        }
        let seq = u64::from_be_bytes(msg[8..16].try_into().map_err(|_| deny())?);
        if !state.on_verified_channel_heartbeat(
            VerifiedInChannelHeartbeat {
                binding: b,
                sequence: seq,
            },
            Instant::now(),
        ) {
            return Err(deny());
        }
        let mut ack = [0u8; 48];
        ack[..8].copy_from_slice(REPLY);
        ack[8..].copy_from_slice(&msg[8..]);
        timeout(WAIT, tls.write_all(&ack))
            .await
            .map_err(|_| deny())?
            .map_err(|_| deny())?;
    }
    let mut extra = [0u8; 1];
    let count = timeout(WAIT, tls.read(&mut extra))
        .await
        .map_err(|_| deny())?
        .map_err(|_| deny())?;
    if count != 0 {
        return Err(deny());
    }
    close(state, 2)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh_identity::fingerprint;
    use tokio::net::TcpListener;
    fn key(n: u8) -> SigningKey {
        SigningKey::from_bytes(&[n; 32])
    }
    fn approved(k: &SigningKey) -> ApprovedPeer {
        ApprovedPeer {
            fingerprint: fingerprint(&k.verifying_key()),
            public_key: URL_SAFE_NO_PAD.encode(k.verifying_key().as_bytes()),
            approved_at: 1800000000,
            status: "locally_approved".into(),
        }
    }
    async fn pair(
        a_owner: [u8; 16],
        b_owner: [u8; 16],
        seq: [u64; 2],
    ) -> (Result<Proof, String>, Result<Proof, String>) {
        let a = key(41);
        let b = key(42);
        let ac = DeviceTlsIdentity::from_signing_key(&a).unwrap();
        let bc = DeviceTlsIdentity::from_signing_key(&b).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (caller, answer) = tokio::join!(TcpStream::connect(address), listener.accept());
        // These peer grants must outlive BOTH asynchronously polled futures.
        // No temporary ApprovedPeer references across tokio::join!.
        let pinned_server = approved(&b);
        let pinned_client = approved(&a);
        tokio::join!(
            client(
                caller.unwrap(),
                &a,
                &pinned_server,
                bc.certificate_der(),
                a_owner,
                seq
            ),
            server(
                answer.unwrap().0,
                &b,
                &pinned_client,
                ac.certificate_der(),
                b_owner
            )
        )
    }
    #[tokio::test]
    async fn real_tcp_pinned_tls_two_heartbeats_and_socket_close() {
        let (a, b) = pair([1; 16], [1; 16], [1, 2]).await;
        for p in [a.unwrap(), b.unwrap()] {
            assert_eq!(p.verified, 2);
            assert!(p.live_before_close);
            assert!(!p.live_after_close);
            assert!(!p.jobs_enabled);
        }
    }
    #[tokio::test]
    async fn cross_owner_tls_is_not_authorized() {
        let (a, b) = pair([1; 16], [9; 16], [1, 2]).await;
        assert!(a.is_err());
        assert!(b.is_err());
    }
    #[tokio::test]
    async fn replayed_sequence_cannot_renew() {
        let (a, b) = pair([1; 16], [1; 16], [1, 1]).await;
        assert!(a.is_err());
        assert!(b.is_err());
    }
    #[tokio::test]
    async fn wrong_certificate_and_revoked_public_pin_fail() {
        let a = key(41);
        let b = key(42);
        let outsider = key(43);
        let a_tls = DeviceTlsIdentity::from_signing_key(&a).unwrap();
        let b_tls = DeviceTlsIdentity::from_signing_key(&b).unwrap();
        assert!(
            strict_client_config(&a_tls, &approved(&outsider), b_tls.certificate_der()).is_err()
        );
        let mut revoked = approved(&b);
        revoked.status = "revoked".into();
        assert!(strict_client_config(&a_tls, &revoked, b_tls.certificate_der()).is_err());
    }
    #[test]
    fn invalid_owner_or_self_identity_denied() {
        assert!(validate_owner([0; 16]).is_err());
        let a = key(41);
        assert!(binding([1; 16], &a, &approved(&a), [2; 32], [3; 32]).is_err());
    }
}
