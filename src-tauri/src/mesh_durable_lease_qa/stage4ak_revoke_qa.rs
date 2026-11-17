// NMKato Solutions — Stage4AK canonical Mesh state revocation QA.
// Compiles ONLY during tests; does not implement a network/RC66K listener.
// Pinned control-plane signing, independent registry scope and disk state must
// all be verified. A failed persistence write leaves the Mesh lease revoked.
use super::{ChannelBinding, MeshLeaseMachine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
};

const DOMAIN: &[u8] = b"KatoSync-Stage4AK-pinned-Mesh-revoke-QA-v1";
const MARKER: &str = "stage4ak-canonical-mesh-revoked.lock";
#[derive(Clone, Copy)]
struct TrustedRegistryScope {
    binding: ChannelBinding,
    tenant: [u8; 16],
    client: [u8; 16],
    owner_session: [u8; 16],
    grant: [u8; 16],
    consent: [u8; 16],
    project: [u8; 16],
    task: [u8; 16],
    rc66k_ack_sha256: [u8; 32],
}
#[derive(Clone)]
struct QaSignedCanonicalRevoke {
    scope: TrustedRegistryScope,
    sequence: u64,
    issued_at_ms: u64,
    expires_at_ms: u64,
    signature: [u8; 64],
}
#[derive(Debug, PartialEq, Eq)]
enum Denial {
    BadSigner,
    WrongScope,
    StaleOrReplay,
    UnsafeJournal,
    StorageFailure,
}
#[derive(Debug, PartialEq, Eq)]
enum Startup {
    RevokedOrPoisoned,
    ClosedPendingServerReconciliation,
}

impl QaSignedCanonicalRevoke {
    fn canonical_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(320);
        out.extend_from_slice(DOMAIN);
        for a in [
            self.scope.binding.owner_id,
            self.scope.tenant,
            self.scope.client,
            self.scope.owner_session,
            self.scope.grant,
            self.scope.consent,
            self.scope.project,
            self.scope.task,
        ] {
            out.extend_from_slice(&a);
        }
        for a in [
            self.scope.binding.local_ed25519,
            self.scope.binding.peer_ed25519,
            self.scope.binding.tls_session_nonce,
            self.scope.rc66k_ack_sha256,
        ] {
            out.extend_from_slice(&a);
        }
        for x in [self.sequence, self.issued_at_ms, self.expires_at_ms] {
            out.extend_from_slice(&x.to_be_bytes());
        }
        out
    }
}
fn journal_path(root: &Path) -> Result<std::path::PathBuf, Denial> {
    let m = fs::symlink_metadata(root).map_err(|_| Denial::UnsafeJournal)?;
    if !m.is_dir()
        || m.file_type().is_symlink()
        || root.canonicalize().map_err(|_| Denial::UnsafeJournal)? != root
    {
        return Err(Denial::UnsafeJournal);
    }
    #[cfg(unix)]
    if m.permissions().mode() & 0o077 != 0 {
        return Err(Denial::UnsafeJournal);
    }
    Ok(root.join(MARKER))
}
fn ensure_scope(
    expected: TrustedRegistryScope,
    notice: &QaSignedCanonicalRevoke,
    now_ms: u64,
) -> Result<(), Denial> {
    let s = notice.scope;
    if s.binding != expected.binding
        || s.tenant != expected.tenant
        || s.client != expected.client
        || s.owner_session != expected.owner_session
        || s.grant != expected.grant
        || s.consent != expected.consent
        || s.project != expected.project
        || s.task != expected.task
        || s.rc66k_ack_sha256 != expected.rc66k_ack_sha256
        || s.rc66k_ack_sha256.iter().all(|b| *b == 0)
        || s.grant.iter().all(|b| *b == 0)
        || s.consent.iter().all(|b| *b == 0)
        || !s.binding.valid()
    {
        return Err(Denial::WrongScope);
    }
    if notice.sequence == 0
        || notice.issued_at_ms > now_ms
        || notice.expires_at_ms <= now_ms
        || notice.expires_at_ms <= notice.issued_at_ms
        || notice.expires_at_ms - notice.issued_at_ms > 30_000
        || now_ms - notice.issued_at_ms > 30_000
    {
        return Err(Denial::StaleOrReplay);
    }
    Ok(())
}
// This function is NOT a public runtime entry: only a non-exported test module
// may supply a pinned signer, canonical local scope and existing private root.
// It does not accept arbitrary JS/MCP messages or enable a read-only executor.
fn apply_test_only_verified_revoke(
    mesh: &mut MeshLeaseMachine,
    notice: &QaSignedCanonicalRevoke,
    expected: TrustedRegistryScope,
    pinned_control_plane: &VerifyingKey,
    root: &Path,
    now_ms: u64,
) -> Result<(), Denial> {
    pinned_control_plane
        .verify(
            &notice.canonical_bytes(),
            &Signature::from_bytes(&notice.signature),
        )
        .map_err(|_| Denial::BadSigner)?;
    ensure_scope(expected, notice, now_ms)?;
    // If connected, also enforce the CURRENT sealed TLS session identity.
    if let Some(active) = mesh.session {
        if active.binding != expected.binding {
            return Err(Denial::WrongScope);
        }
    }
    // First close the ACTUAL canonical Mesh machine. Disk may now fail;
    // the device must stay revoked and recover server authority after restart.
    mesh.revoked_or_owner_changed();
    let dest = journal_path(root)?;
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    opts.mode(0o600);
    let mut f = opts.open(dest).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            Denial::StaleOrReplay
        } else {
            Denial::StorageFailure
        }
    })?;
    let digest: [u8; 32] = Sha256::digest(notice.canonical_bytes()).into();
    f.write_all(DOMAIN)
        .and_then(|_| f.write_all(&notice.sequence.to_be_bytes()))
        .and_then(|_| f.write_all(&digest))
        .and_then(|_| f.sync_all())
        .map_err(|_| Denial::StorageFailure)?;
    File::open(root)
        .and_then(|d| d.sync_all())
        .map_err(|_| Denial::StorageFailure)
}
fn restart_closed(mesh: &mut MeshLeaseMachine, root: &Path) -> Result<Startup, Denial> {
    // The recovery entry MUST revoke first. Even an inaccessible or unsafe
    // journal cannot leave a previously live lease authenticated.
    mesh.revoked_or_owner_changed();
    let file = journal_path(root)?;
    match fs::symlink_metadata(&file) {
        Ok(_) => Ok(Startup::RevokedOrPoisoned),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(Startup::ClosedPendingServerReconciliation)
        }
        Err(_) => Ok(Startup::RevokedOrPoisoned),
    }
}
#[cfg(test)]
mod tests {
    use super::super::{MeshLinkState, ValidatedOpenTlsSocket};
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::{path::PathBuf, time::Instant};
    const T: u64 = 1_800_000_000_000;
    fn signer() -> SigningKey {
        SigningKey::from_bytes(&[118; 32])
    }
    fn scope() -> TrustedRegistryScope {
        TrustedRegistryScope {
            binding: ChannelBinding {
                owner_id: [1; 16],
                local_ed25519: [2; 32],
                peer_ed25519: [3; 32],
                tls_session_nonce: [4; 32],
            },
            tenant: [5; 16],
            client: [6; 16],
            owner_session: [7; 16],
            grant: [8; 16],
            consent: [9; 16],
            project: [10; 16],
            task: [11; 16],
            rc66k_ack_sha256: [12; 32],
        }
    }
    fn signed() -> QaSignedCanonicalRevoke {
        let mut n = QaSignedCanonicalRevoke {
            scope: scope(),
            sequence: 42,
            issued_at_ms: T - 100,
            expires_at_ms: T + 5_000,
            signature: [0; 64],
        };
        n.signature = signer().sign(&n.canonical_bytes()).to_bytes();
        n
    }
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let p =
                std::env::temp_dir().join(format!("stage4ak-canonical-{}", uuid::Uuid::new_v4()));
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                fs::DirBuilder::new().mode(0o700).create(&p).unwrap();
            }
            #[cfg(not(unix))]
            fs::create_dir(&p).unwrap();
            Self(p.canonicalize().unwrap())
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn live(now: Instant) -> MeshLeaseMachine {
        let mut m = MeshLeaseMachine::default();
        assert!(m.locally_approved());
        assert!(m.begin_verification());
        assert!(m.on_still_open_tls_socket(
            ValidatedOpenTlsSocket {
                binding: scope().binding
            },
            now
        ));
        m
    }
    #[test]
    fn real_canonical_mesh_lease_is_terminated_only_after_signed_scope_verification() {
        let f = Temp::new();
        let now = Instant::now();
        let mut m = live(now);
        assert!(m.snapshot(now).live_peer_authenticated);
        assert_eq!(
            apply_test_only_verified_revoke(
                &mut m,
                &signed(),
                scope(),
                &signer().verifying_key(),
                &f.0,
                T
            ),
            Ok(())
        );
        assert_eq!(m.state, MeshLinkState::Revoked);
        assert!(m.session.is_none());
        let shot = m.snapshot(now);
        assert!(!shot.live_peer_authenticated && !shot.channel_still_active);
        assert!(!shot.remote_jobs_enabled && !shot.remote_read_only_dispatch);
        assert_eq!(
            restart_closed(&mut MeshLeaseMachine::default(), &f.0),
            Ok(Startup::RevokedOrPoisoned)
        );
    }
    #[test]
    fn foreign_signer_and_wrong_owner_device_session_or_rc66k_digest_never_mutate_live_lease() {
        for i in 0..7 {
            let f = Temp::new();
            let at = Instant::now();
            let mut m = live(at);
            let mut n = signed();
            let mut expected = scope();
            if i == 0 {
                n.signature = [33; 64];
            } else {
                match i {
                    1 => expected.binding.owner_id = [99; 16],
                    2 => expected.binding.peer_ed25519 = [99; 32],
                    3 => expected.binding.tls_session_nonce = [99; 32],
                    4 => expected.consent = [99; 16],
                    5 => expected.owner_session = [99; 16],
                    _ => expected.rc66k_ack_sha256 = [99; 32],
                }
            }
            assert!(apply_test_only_verified_revoke(
                &mut m,
                &n,
                expected,
                &signer().verifying_key(),
                &f.0,
                T
            )
            .is_err());
            assert!(m.snapshot(at).live_peer_authenticated);
            assert!(!f.0.join(MARKER).exists());
        }
    }
    #[test]
    fn duplicate_signed_revoke_is_sticky_and_never_reopens_mesh() {
        let f = Temp::new();
        let mut m = live(Instant::now());
        let n = signed();
        assert_eq!(
            apply_test_only_verified_revoke(
                &mut m,
                &n,
                scope(),
                &signer().verifying_key(),
                &f.0,
                T
            ),
            Ok(())
        );
        assert_eq!(
            apply_test_only_verified_revoke(
                &mut m,
                &n,
                scope(),
                &signer().verifying_key(),
                &f.0,
                T
            ),
            Err(Denial::StaleOrReplay)
        );
        assert_eq!(m.state, MeshLinkState::Revoked);
        assert!(!m.locally_approved());
    }
    #[test]
    fn absent_marker_restart_stays_closed_pending_fresh_server_authority() {
        let f = Temp::new();
        let mut m = live(Instant::now());
        assert_eq!(
            restart_closed(&mut m, &f.0),
            Ok(Startup::ClosedPendingServerReconciliation)
        );
        assert_eq!(m.state, MeshLinkState::Revoked);
    }
    #[test]
    fn expired_signature_or_untrusted_directory_cannot_restart_an_active_lease() {
        let f = Temp::new();
        let mut m = live(Instant::now());
        assert_eq!(
            apply_test_only_verified_revoke(
                &mut m,
                &signed(),
                scope(),
                &signer().verifying_key(),
                &f.0,
                T + 40_000
            ),
            Err(Denial::StaleOrReplay)
        );
        assert!(m.session.is_some());
        let bad = f.0.join("missing");
        assert_eq!(restart_closed(&mut m, &bad), Err(Denial::UnsafeJournal));
        assert_eq!(m.state, MeshLinkState::Revoked);
        assert!(m.session.is_none());
    }
}
