// Created by NMKato Solutions
//! Future mesh transport crypto core: strictly TLS 1.3, mutual Ed25519
//! certificates anchored to a *previously, explicitly approved* peer key.
//! No network listener, discovery, remote job dispatch or automatic connection.
//! No embedded credentials or unsafe "accept any certificate" verifier.

use ed25519_dalek::{pkcs8::EncodePrivateKey, SigningKey, VerifyingKey};
use rcgen::{CertificateParams, ExtendedKeyUsagePurpose, KeyPair, KeyUsagePurpose, PKCS_ED25519};
use rustls::{
    crypto::CryptoProvider,
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer},
    server::WebPkiClientVerifier,
    ClientConfig, RootCertStore, ServerConfig,
};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use zeroize::{Zeroize, Zeroizing};

use crate::mesh_identity::fingerprint;
use crate::mesh_trust::ApprovedPeer;

const TLS_PEER_DNS_NAME: &str = "mesh.katoos.invalid";
const CERT_MAX_BYTES: usize = 8192;

/// Only public certificate material and keychain-derived in-process private key.
/// Cannot be serialized or returned through Tauri IPC.
pub(crate) struct DeviceTlsIdentity {
    certificate_der: Vec<u8>,
    private_key_pkcs8: Zeroizing<Vec<u8>>,
}
impl DeviceTlsIdentity {
    pub(crate) fn certificate_der(&self) -> &[u8] {
        &self.certificate_der
    }
    /// Derive a stable Ed25519 TLS certificate from the *same long-term device key*.
    /// Does not create a new account credential, and never stores the private key on disk.
    pub(crate) fn from_signing_key(signing: &SigningKey) -> Result<Self, String> {
        let encoded = signing
            .to_pkcs8_der()
            .map_err(|_| "Geräteschlüssel kann nicht in TLS-Format gewandelt werden.")?;
        let key = KeyPair::from_pkcs8_der_and_sign_algo(
            &PrivatePkcs8KeyDer::from(encoded.as_bytes()),
            &PKCS_ED25519,
        )
        .map_err(|_| "TLS-Geräteschlüssel ungültig.")?;
        let mut params = CertificateParams::new(vec![TLS_PEER_DNS_NAME.to_string()])
            .map_err(|_| "TLS-Zertifikatsparameter ungültig.")?;
        params.not_before = rcgen::date_time_ymd(2026, 1, 1);
        params.not_after = rcgen::date_time_ymd(2033, 1, 1);
        params.serial_number = Some(rcgen::SerialNumber::from_slice(
            &Sha256::digest(signing.verifying_key().as_bytes())[..16],
        ));
        params.extended_key_usages = vec![
            ExtendedKeyUsagePurpose::ServerAuth,
            ExtendedKeyUsagePurpose::ClientAuth,
        ];
        params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        let certificate = params
            .self_signed(&key)
            .map_err(|_| "TLS-Zertifikat konnte nicht erstellt werden.")?;
        let mut private = key.serialize_der();
        let private_key_pkcs8 = Zeroizing::new(private.clone());
        private.zeroize();
        let certificate_der = certificate.der().as_ref().to_vec();
        if certificate_der.len() > CERT_MAX_BYTES {
            return Err("TLS-Zertifikat zu groß.".into());
        }
        Ok(Self {
            certificate_der,
            private_key_pkcs8,
        })
    }
}

/// Builds an independently authenticated peer trust anchor.
/// The certificate must have the exact Ed25519 public key pinned by Stage 1C.
/// An arbitrary self-signed certificate is NEVER a root without this validation.
fn approved_root(peer: &ApprovedPeer, certificate: &[u8]) -> Result<RootCertStore, String> {
    if certificate.len() < 100
        || certificate.len() > CERT_MAX_BYTES
        || peer.status != "locally_approved"
        || peer.approved_at <= 0
    {
        return Err("Peer ist nicht zur TLS-Verbindung freigegeben.".into());
    }
    let raw = base64::Engine::decode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        &peer.public_key,
    )
    .map_err(|_| "Gespeicherter Peer-Schlüssel ist ungültig.")?;
    let raw: [u8; 32] = raw
        .try_into()
        .map_err(|_| "Gespeicherter Peer-Schlüssel ist ungültig.")?;
    let verifying =
        VerifyingKey::from_bytes(&raw).map_err(|_| "Gespeicherter Peer-Schlüssel ist ungültig.")?;
    if peer.fingerprint != fingerprint(&verifying) {
        return Err("Gespeicherter Peer-Fingerprint stimmt nicht überein.".into());
    }
    let (remaining, parsed) = x509_parser::parse_x509_certificate(certificate)
        .map_err(|_| "Peer-Zertifikat konnte nicht geprüft werden.")?;
    if !remaining.is_empty()
        || parsed.public_key().algorithm.algorithm.to_id_string() != "1.3.101.112"
        || parsed.public_key().subject_public_key.data.as_ref() != raw
    {
        return Err("TLS-Zertifikat gehört nicht zur freigegebenen Geräteidentität.".into());
    }
    let mut roots = RootCertStore::empty();
    roots
        .add(CertificateDer::from(certificate.to_vec()))
        .map_err(|_| "TLS-Peer-Zertifikat konnte nicht als Trust Anchor verwendet werden.")?;
    Ok(roots)
}

fn aes256_tls13_provider() -> Result<Arc<CryptoProvider>, String> {
    let mut p = rustls::crypto::ring::default_provider();
    p.cipher_suites
        .retain(|c| c.suite() == rustls::CipherSuite::TLS13_AES_256_GCM_SHA384);
    p.kx_groups
        .retain(|g| g.name() == rustls::NamedGroup::X25519);
    if p.cipher_suites.len() != 1 || p.kx_groups.is_empty() {
        return Err("TLS 1.3 mit X25519 und AES-256-GCM nicht verfügbar.".into());
    }
    Ok(Arc::new(p))
}
fn local_certificate(local: &DeviceTlsIdentity) -> Vec<CertificateDer<'static>> {
    vec![CertificateDer::from(local.certificate_der.clone())]
}
fn local_key(local: &DeviceTlsIdentity) -> PrivateKeyDer<'static> {
    PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(local.private_key_pkcs8.to_vec()))
}

/// This is a *configuration builder*, not a network socket. Requires a
/// reviewed and approved peer public-key pin plus matching X.509 cert.
pub(crate) fn strict_client_config(
    local: &DeviceTlsIdentity,
    peer: &ApprovedPeer,
    peer_certificate: &[u8],
) -> Result<ClientConfig, String> {
    let roots = approved_root(peer, peer_certificate)?;
    let mut config = ClientConfig::builder_with_provider(aes256_tls13_provider()?)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|_| "Unsichere oder nicht verfügbare TLS-Version.")?
        .with_root_certificates(roots)
        .with_client_auth_cert(local_certificate(local), local_key(local))
        .map_err(|_| "TLS-Client-Zertifikat ungültig.")?;
    config.enable_early_data = false;
    config.enable_sni = true;
    Ok(config)
}
pub(crate) fn strict_server_config(
    local: &DeviceTlsIdentity,
    peer: &ApprovedPeer,
    peer_certificate: &[u8],
) -> Result<ServerConfig, String> {
    let roots = approved_root(peer, peer_certificate)?;
    let verifier =
        WebPkiClientVerifier::builder_with_provider(Arc::new(roots), aes256_tls13_provider()?)
            .build()
            .map_err(|_| "Gegenseitige Peer-Zertifikatsprüfung nicht möglich.")?;
    let mut config = ServerConfig::builder_with_provider(aes256_tls13_provider()?)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|_| "Unsichere oder nicht verfügbare TLS-Version.")?
        .with_client_cert_verifier(verifier)
        .with_single_cert(local_certificate(local), local_key(local))
        .map_err(|_| "TLS-Server-Zertifikat ungültig.")?;
    config.max_early_data_size = 0;
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use tokio::io::{duplex, AsyncReadExt, AsyncWriteExt};
    use tokio_rustls::{TlsAcceptor, TlsConnector};

    fn signing(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }
    fn approved(signing: &SigningKey) -> ApprovedPeer {
        ApprovedPeer {
            fingerprint: fingerprint(&signing.verifying_key()),
            public_key: URL_SAFE_NO_PAD.encode(signing.verifying_key().as_bytes()),
            approved_at: 1780000000,
            status: "locally_approved".into(),
        }
    }
    async fn run_pair(
        a: &SigningKey,
        b: &SigningKey,
        trust_a: &ApprovedPeer,
        trust_b: &ApprovedPeer,
    ) -> Result<Vec<u8>, String> {
        let local_a = DeviceTlsIdentity::from_signing_key(a)?;
        let local_b = DeviceTlsIdentity::from_signing_key(b)?;
        let config_a = strict_client_config(&local_a, trust_b, local_b.certificate_der())?;
        let config_b = strict_server_config(&local_b, trust_a, local_a.certificate_der())?;
        let (a_io, b_io) = duplex(16384);
        let client = async move {
            let name = rustls::pki_types::ServerName::try_from(TLS_PEER_DNS_NAME)
                .map_err(|_| "Invalid peer DNS".to_string())?;
            let mut session = TlsConnector::from(Arc::new(config_a))
                .connect(name, a_io)
                .await
                .map_err(|_| "TLS client rejected".to_string())?;
            if session.get_ref().1.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3)
                || session
                    .get_ref()
                    .1
                    .negotiated_cipher_suite()
                    .map(|s| s.suite())
                    != Some(rustls::CipherSuite::TLS13_AES_256_GCM_SHA384)
            {
                return Err("Unexpected TLS protocol or cipher".into());
            }
            session
                .write_all(b"PING")
                .await
                .map_err(|_| "Client write failed")?;
            let mut msg = [0u8; 4];
            session
                .read_exact(&mut msg)
                .await
                .map_err(|_| "Client read failed")?;
            Ok::<_, String>(msg.to_vec())
        };
        let server = async move {
            let mut session = TlsAcceptor::from(Arc::new(config_b))
                .accept(b_io)
                .await
                .map_err(|_| "TLS server rejected".to_string())?;
            if session.get_ref().1.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3)
                || session
                    .get_ref()
                    .1
                    .negotiated_cipher_suite()
                    .map(|s| s.suite())
                    != Some(rustls::CipherSuite::TLS13_AES_256_GCM_SHA384)
            {
                return Err("Unexpected TLS server protocol or cipher".into());
            }
            let mut msg = [0u8; 4];
            session
                .read_exact(&mut msg)
                .await
                .map_err(|_| "Server read failed")?;
            if &msg != b"PING" {
                return Err("Unknown application message".into());
            }
            session
                .write_all(b"PONG")
                .await
                .map_err(|_| "Server write failed")?;
            Ok::<_, String>(())
        };
        let (client_result, server_result) =
            tokio::time::timeout(std::time::Duration::from_secs(5), async {
                tokio::join!(client, server)
            })
            .await
            .map_err(|_| "Handshake timeout".to_string())?;
        server_result?;
        client_result
    }

    #[tokio::test]
    async fn aes256_tls13_mutually_authenticated_encrypted_loopback() {
        let a = signing(2);
        let b = signing(3);
        assert_eq!(
            run_pair(&a, &b, &approved(&a), &approved(&b))
                .await
                .unwrap(),
            b"PONG"
        );
    }
    #[tokio::test]
    async fn wrong_client_pin_or_unapproved_peer_fails_closed() {
        let a = signing(2);
        let b = signing(3);
        let outsider = signing(4);
        assert!(run_pair(&a, &b, &approved(&outsider), &approved(&b))
            .await
            .is_err());
        assert!(run_pair(&a, &b, &approved(&a), &approved(&outsider))
            .await
            .is_err());
    }
    #[test]
    fn certificate_identity_is_stable_and_wrong_pin_is_rejected() {
        let a = signing(8);
        let b = signing(9);
        let first = DeviceTlsIdentity::from_signing_key(&a).unwrap();
        let second = DeviceTlsIdentity::from_signing_key(&a).unwrap();
        assert_eq!(first.certificate_der(), second.certificate_der());
        assert!(approved_root(&approved(&a), first.certificate_der()).is_ok());
        assert!(approved_root(&approved(&b), first.certificate_der()).is_err());
        assert!(approved_root(&approved(&a), b"not a certificate").is_err());
    }
    #[test]
    fn self_approved_or_invalid_key_metadata_cannot_be_used_without_pin() {
        let a = signing(1);
        let identity = DeviceTlsIdentity::from_signing_key(&a).unwrap();
        let mut peer = approved(&a);
        peer.status = "unapproved".into();
        assert!(strict_client_config(&identity, &peer, identity.certificate_der()).is_err());
        peer.status = "locally_approved".into();
        peer.fingerprint = "WRONG".into();
        assert!(strict_server_config(&identity, &peer, identity.certificate_der()).is_err());
    }
}
