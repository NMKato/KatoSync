// NMKato Solutions – Stage4AI synthetic revocation journal, source-only QA.
// Invariant: neither a missing marker nor a malformed marker grants authority.
// A process restart ALWAYS requires fresh trusted server reconciliation.
use super::super::super::SignedTask;
use super::super::{Denial as FenceDenial, QaLocalRevocationGate};
use super::{accept_pinned_signed_revoke, QaSignedRevokeNotice};
use ed25519_dalek::VerifyingKey;
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

const MARKER: &str = "stage4ai-qa-revoked.lock";
const DOMAIN: &[u8] = b"KatoSync-Stage4AI-permanent-revoke-qa-v1";
#[derive(Debug, PartialEq, Eq)]
enum StartupDecision {
    RevokedOrPoisoned,
    ClosedPendingAuthoritativeReconciliation,
}
#[derive(Debug, PartialEq, Eq)]
enum StoreDenial {
    UnsafeDirectory,
    VerificationFailed,
    AlreadyRevoked,
    StorageFailure,
}
struct QaDurableRevocationJournal {
    root: PathBuf,
}
impl QaDurableRevocationJournal {
    fn open_existing(root: &Path) -> Result<Self, StoreDenial> {
        let m = fs::symlink_metadata(root).map_err(|_| StoreDenial::UnsafeDirectory)?;
        if !m.is_dir() || m.file_type().is_symlink() {
            return Err(StoreDenial::UnsafeDirectory);
        }
        #[cfg(unix)]
        if m.permissions().mode() & 0o077 != 0 {
            return Err(StoreDenial::UnsafeDirectory);
        }
        let c = root
            .canonicalize()
            .map_err(|_| StoreDenial::UnsafeDirectory)?;
        if c != root {
            return Err(StoreDenial::UnsafeDirectory);
        }
        Ok(Self { root: c })
    }
    fn path(&self) -> PathBuf {
        self.root.join(MARKER)
    }
    fn on_restart(&self) -> StartupDecision {
        // Any existing marker, including zero-length/corrupt/symlinked, poisons.
        // If marker is absent, never self-authorize: obtain a fresh grant & MFA.
        match fs::symlink_metadata(self.path()) {
            Ok(_) => StartupDecision::RevokedOrPoisoned,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                StartupDecision::ClosedPendingAuthoritativeReconciliation
            }
            Err(_) => StartupDecision::RevokedOrPoisoned,
        }
    }
    // Required startup entry: poison the default in-memory gate BEFORE
    // inspection. A runtime must NOT call snapshot on a default gate first.
    fn restore_gate_fail_closed(
        &self,
        gate: &QaLocalRevocationGate,
    ) -> Result<StartupDecision, StoreDenial> {
        gate.revoke().map_err(|_| StoreDenial::StorageFailure)?;
        Ok(self.on_restart())
    }

    fn apply_verified_notice_and_persist(
        &self,
        notice: &QaSignedRevokeNotice,
        task: &SignedTask,
        pinned_permit_issuer: &VerifyingKey,
        pinned_control_plane: &VerifyingKey,
        gate: &QaLocalRevocationGate,
        now_ms: u64,
    ) -> Result<(), StoreDenial> {
        // A failed disk write keeps the in-memory gate revoked. A crash before
        // this write still leaves a restarted process CLOSED pending reconcile.
        accept_pinned_signed_revoke(
            notice,
            task,
            pinned_permit_issuer,
            pinned_control_plane,
            gate,
            now_ms,
        )
        .map_err(|_| StoreDenial::VerificationFailed)?;
        let mut digest = Sha256::new();
        digest.update(DOMAIN);
        digest.update(notice.canonical_bytes());
        digest.update(notice.signature);
        let bytes: [u8; 32] = digest.finalize().into();
        let mut opts = OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        opts.mode(0o600);
        let mut f = opts.open(self.path()).map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                StoreDenial::AlreadyRevoked
            } else {
                StoreDenial::StorageFailure
            }
        })?;
        // Marker is irreversible even if partially written on a crash.
        f.write_all(DOMAIN)
            .and_then(|_| f.write_all(&bytes))
            .and_then(|_| f.sync_all())
            .map_err(|_| StoreDenial::StorageFailure)?;
        File::open(&self.root)
            .and_then(|d| d.sync_all())
            .map_err(|_| StoreDenial::StorageFailure)
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{control_signer, permit, permit_issuer, signed_notice, T};
    use super::*;
    use std::fs;
    struct TemporaryRoot(PathBuf);
    impl TemporaryRoot {
        fn create() -> Self {
            let root =
                std::env::temp_dir().join(format!("katosync-stage4ai-{}", uuid::Uuid::new_v4()));
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
            }
            #[cfg(not(unix))]
            fs::create_dir(&root).unwrap();
            Self(root.canonicalize().unwrap())
        }
    }
    impl Drop for TemporaryRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn record(
        store: &QaDurableRevocationJournal,
        gate: &QaLocalRevocationGate,
    ) -> Result<(), StoreDenial> {
        let task = permit();
        store.apply_verified_notice_and_persist(
            &signed_notice(&task, 11),
            &task,
            &permit_issuer().verifying_key(),
            &control_signer().verifying_key(),
            gate,
            T,
        )
    }
    #[test]
    fn cold_start_without_server_reconciliation_is_closed_not_authorized() {
        let root = TemporaryRoot::create();
        let store = QaDurableRevocationJournal::open_existing(&root.0).unwrap();
        assert_eq!(
            store.on_restart(),
            StartupDecision::ClosedPendingAuthoritativeReconciliation
        );
    }
    #[test]
    fn restart_entry_poison_gate_even_if_marker_was_never_written() {
        let root = TemporaryRoot::create();
        let store = QaDurableRevocationJournal::open_existing(&root.0).unwrap();
        let fresh = QaLocalRevocationGate::default();
        assert_eq!(
            store.restore_gate_fail_closed(&fresh),
            Ok(StartupDecision::ClosedPendingAuthoritativeReconciliation)
        );
        assert_eq!(fresh.snapshot(), Err(FenceDenial::RevokedDuringExecution));
    }
    #[test]
    fn signed_revocation_persists_across_reopen_and_never_rearms() {
        let root = TemporaryRoot::create();
        let store = QaDurableRevocationJournal::open_existing(&root.0).unwrap();
        let gate = QaLocalRevocationGate::default();
        assert_eq!(record(&store, &gate), Ok(()));
        assert_eq!(gate.snapshot(), Err(FenceDenial::RevokedDuringExecution));
        let reopened = QaDurableRevocationJournal::open_existing(&root.0).unwrap();
        assert_eq!(reopened.on_restart(), StartupDecision::RevokedOrPoisoned);
        assert_eq!(
            record(&reopened, &QaLocalRevocationGate::default()),
            Err(StoreDenial::AlreadyRevoked)
        );
        assert_eq!(reopened.on_restart(), StartupDecision::RevokedOrPoisoned);
    }
    #[test]
    fn torn_marker_and_symlinked_marker_both_keep_restart_closed() {
        let root = TemporaryRoot::create();
        let p = root.0.join(MARKER);
        fs::write(&p, b"partial-corrupt").unwrap();
        let journal = QaDurableRevocationJournal::open_existing(&root.0).unwrap();
        assert_eq!(journal.on_restart(), StartupDecision::RevokedOrPoisoned);
        fs::remove_file(&p).unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("missing", &p).unwrap();
            assert_eq!(journal.on_restart(), StartupDecision::RevokedOrPoisoned);
        }
    }
    #[cfg(unix)]
    #[test]
    fn symlinked_or_world_readable_storage_root_fails_closed() {
        let root = TemporaryRoot::create();
        let link = root
            .0
            .parent()
            .unwrap()
            .join(format!("katosync-stage4ai-link-{}", uuid::Uuid::new_v4()));
        std::os::unix::fs::symlink(&root.0, &link).unwrap();
        assert!(matches!(
            QaDurableRevocationJournal::open_existing(&link),
            Err(StoreDenial::UnsafeDirectory)
        ));
        fs::remove_file(link).unwrap();
        fs::set_permissions(&root.0, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(matches!(
            QaDurableRevocationJournal::open_existing(&root.0),
            Err(StoreDenial::UnsafeDirectory)
        ));
    }
    #[test]
    fn unsigned_or_wrongly_signed_revoke_never_creates_durable_marker() {
        let root = TemporaryRoot::create();
        let store = QaDurableRevocationJournal::open_existing(&root.0).unwrap();
        let task = permit();
        let mut notice = signed_notice(&task, 5);
        notice.signature = [0; 64];
        let gate = QaLocalRevocationGate::default();
        assert_eq!(
            store.apply_verified_notice_and_persist(
                &notice,
                &task,
                &permit_issuer().verifying_key(),
                &control_signer().verifying_key(),
                &gate,
                T
            ),
            Err(StoreDenial::VerificationFailed)
        );
        assert_eq!(gate.snapshot(), Ok(0));
        assert_eq!(
            store.on_restart(),
            StartupDecision::ClosedPendingAuthoritativeReconciliation
        );
    }
}
