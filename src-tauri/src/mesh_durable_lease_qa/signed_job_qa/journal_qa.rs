// NMKato Solutions – Stage4AD private crash-sticky QA journal.
// Reserves signed read-only task IDs; does not authorize or execute commands.
use super::{Candidate, SignedTask};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
const MAX_RECORD_BYTES: usize = 512;
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Denial {
    InsecureRoot,
    InvalidCandidate,
    Duplicate,
    Storage,
}
pub(super) struct Journal {
    root: PathBuf,
}
fn hex(data: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut x = String::with_capacity(data.len() * 2);
    for b in data {
        x.push(H[(b >> 4) as usize] as char);
        x.push(H[(b & 15) as usize] as char);
    }
    x
}
fn marker(dir: &Path, prefix: &str, id: &[u8; 16]) -> PathBuf {
    dir.join(format!("{}-{}.lock", prefix, hex(id)))
}
impl Journal {
    pub(super) fn open_existing(root: &Path) -> Result<Self, Denial> {
        let m = fs::symlink_metadata(root).map_err(|_| Denial::InsecureRoot)?;
        if !m.is_dir() || m.file_type().is_symlink() {
            return Err(Denial::InsecureRoot);
        }
        #[cfg(unix)]
        if m.permissions().mode() & 0o077 != 0 {
            return Err(Denial::InsecureRoot);
        }
        let c = root.canonicalize().map_err(|_| Denial::InsecureRoot)?;
        if c != root {
            return Err(Denial::InsecureRoot);
        }
        Ok(Self { root: c })
    }
    fn write_once(&self, path: &Path, data: &[u8]) -> Result<(), Denial> {
        if data.is_empty() || data.len() > MAX_RECORD_BYTES {
            return Err(Denial::Storage);
        }
        let mut opts = OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        opts.mode(0o600);
        let mut f = opts.open(path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                Denial::Duplicate
            } else {
                Denial::Storage
            }
        })?;
        // A partial record is an irrevocable poison marker until owner review.
        f.write_all(data)
            .and_then(|_| f.sync_all())
            .map_err(|_| Denial::Storage)?;
        File::open(&self.root)
            .and_then(|d| d.sync_all())
            .map_err(|_| Denial::Storage)
    }
    /// Store a terminal record only after both reserved markers exist.
    /// The parent MUST verify the receipt signature first. This routine is
    /// a private storage primitive, not an attestation or an executor.
    pub(super) fn store_verified_terminal_record(
        &self,
        task_id: &[u8; 16],
        nonce: &[u8; 16],
        record: &[u8],
    ) -> Result<(), Denial> {
        if record.is_empty() || record.len() > MAX_RECORD_BYTES {
            return Err(Denial::Storage);
        }
        for path in [
            marker(&self.root, "task", task_id),
            marker(&self.root, "nonce", nonce),
        ] {
            let m = fs::symlink_metadata(path).map_err(|_| Denial::InvalidCandidate)?;
            if !m.is_file() || m.file_type().is_symlink() {
                return Err(Denial::InvalidCandidate);
            }
            #[cfg(unix)]
            if m.permissions().mode() & 0o077 != 0 {
                return Err(Denial::InvalidCandidate);
            }
        }
        self.write_once(&marker(&self.root, "receipt", task_id), record)
    }
    // Must only be called AFTER the canonical signed permit and live lease gate.
    // Never interpret this durable reservation as OS/device execution authority.
    pub(super) fn reserve(&self, c: &Candidate, s: &SignedTask) -> Result<(), Denial> {
        if c.execution_authorized
            || !c.requires_native_executor_recheck
            || c.task_id != s.task.task_id
            || c.action != s.task.action
            || c.maximum_output_bytes > 4096
        {
            return Err(Denial::InvalidCandidate);
        }
        let task = marker(&self.root, "task", &s.task.task_id);
        let nonce = marker(&self.root, "nonce", &s.task.nonce);
        if task.exists() || nonce.exists() {
            return Err(Denial::Duplicate);
        }
        let mut h = Sha256::new();
        h.update(b"KatoSync-Stage4AD-qa-local-reservation-v1");
        h.update(s.task.canonical_bytes());
        h.update(s.signature);
        let digest: [u8; 32] = h.finalize().into();
        let record = format!("reserved-qa-v1:{}\n", hex(&digest));
        self.write_once(&task, record.as_bytes())?;
        // If this second creation fails, task stays poisoned (fail closed).
        self.write_once(&nonce, record.as_bytes())
    }
}
#[cfg(test)]
mod tests {
    use super::super::{Action, ReadOnlyTask};
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::{
        sync::{Arc, Barrier},
        thread,
    };
    fn sample() -> (Candidate, SignedTask) {
        let t = ReadOnlyTask {
            owner_id: [1; 16],
            tenant_id: [2; 16],
            owner_session_id: [3; 16],
            client_id: [4; 16],
            local_device_public_key: [5; 32],
            peer_device_public_key: [6; 32],
            project_id: [7; 16],
            task_id: [8; 16],
            nonce: [9; 16],
            expected_head: [10; 32],
            expected_head_len: 32,
            action: Action::GitHead,
            issued_at_ms: 1_800_000_000_000,
            expires_at_ms: 1_800_000_010_000,
            owner_step_up_at_ms: 1_799_999_999_000,
        };
        let key = SigningKey::from_bytes(&[11; 32]);
        let signed = SignedTask {
            signature: key.sign(&t.canonical_bytes()).to_bytes(),
            task: t,
        };
        let cand = Candidate {
            task_id: t.task_id,
            action: t.action,
            maximum_output_bytes: 4096,
            execution_authorized: false,
            requires_native_executor_recheck: true,
        };
        (cand, signed)
    }
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!("katosync-ad-{}", uuid::Uuid::new_v4()));
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
    #[test]
    fn survives_restart_and_rejects_same_ticket() {
        let p = Temp::new();
        let (c, s) = sample();
        Journal::open_existing(&p.0)
            .unwrap()
            .reserve(&c, &s)
            .unwrap();
        let j = Journal::open_existing(&p.0).unwrap();
        assert_eq!(j.reserve(&c, &s), Err(Denial::Duplicate));
        assert!(marker(&p.0, "task", &s.task.task_id).exists());
        assert!(marker(&p.0, "nonce", &s.task.nonce).exists());
    }
    #[test]
    fn reused_nonce_or_task_id_denied_after_restart() {
        let p = Temp::new();
        let j = Journal::open_existing(&p.0).unwrap();
        let (c, s) = sample();
        j.reserve(&c, &s).unwrap();
        let mut changed = s;
        changed.task.nonce = [12; 16];
        assert_eq!(j.reserve(&c, &changed), Err(Denial::Duplicate));
        changed.task.task_id = [13; 16];
        changed.task.nonce = [9; 16];
        let mut c2 = c;
        c2.task_id = [13; 16];
        assert_eq!(j.reserve(&c2, &changed), Err(Denial::Duplicate));
    }
    #[test]
    fn concurrently_only_one_reserves() {
        let p = Temp::new();
        let barrier = Arc::new(Barrier::new(4));
        let mut handles = Vec::new();
        for _ in 0..4 {
            let root = p.0.clone();
            let barrier = barrier.clone();
            handles.push(thread::spawn(move || {
                let j = Journal::open_existing(&root).unwrap();
                let (c, s) = sample();
                barrier.wait();
                j.reserve(&c, &s)
            }));
        }
        let out: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        assert_eq!(out.iter().filter(|x| x.is_ok()).count(), 1);
        assert_eq!(
            out.iter().filter(|x| **x == Err(Denial::Duplicate)).count(),
            3
        );
    }
    #[test]
    fn invalid_candidate_creates_no_records() {
        let p = Temp::new();
        let j = Journal::open_existing(&p.0).unwrap();
        let (mut c, s) = sample();
        c.execution_authorized = true;
        assert_eq!(j.reserve(&c, &s), Err(Denial::InvalidCandidate));
        c.execution_authorized = false;
        c.task_id = [33; 16];
        assert_eq!(j.reserve(&c, &s), Err(Denial::InvalidCandidate));
        assert_eq!(fs::read_dir(&p.0).unwrap().count(), 0);
    }
    #[test]
    fn orphaned_marker_fail_closed_after_crash() {
        let p = Temp::new();
        let j = Journal::open_existing(&p.0).unwrap();
        let (c, s) = sample();
        j.write_once(&marker(&p.0, "task", &s.task.task_id), b"partial")
            .unwrap();
        assert_eq!(j.reserve(&c, &s), Err(Denial::Duplicate));
    }
    #[test]
    fn symlink_and_insecure_directory_rejected() {
        let p = Temp::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let alias = p.0.with_extension("link");
            symlink(&p.0, &alias).unwrap();
            assert!(matches!(
                Journal::open_existing(&alias),
                Err(Denial::InsecureRoot)
            ));
            fs::remove_file(&alias).unwrap();
            fs::set_permissions(&p.0, fs::Permissions::from_mode(0o777)).unwrap();
            assert!(matches!(
                Journal::open_existing(&p.0),
                Err(Denial::InsecureRoot)
            ));
        }
    }
}
