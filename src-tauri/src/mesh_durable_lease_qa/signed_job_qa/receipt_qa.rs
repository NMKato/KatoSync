// Created by NMKato Solutions
//! Stage4AE native QA: bounded device-signed Git HEAD receipt. NO remote
//! executor, no socket, no model command, no real Keychain/device signing.
//! Only ephemeral test Git repos are read by the #[cfg(test)] fixture.
//! Real Stage4L attestation and owner signed permissions remain release gates.
use super::{Action, Candidate, ReadOnlyTask, SignedTask};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};

const DOMAIN: &[u8] = b"KatoSync-Stage4AE-device-git-head-receipt-v1";
const MAX_HEAD_OUTPUT: usize = 65;
const MAX_RECEIPT_BYTES: usize = 4096;

#[derive(Clone, Debug, PartialEq, Eq)]
struct Receipt {
    owner_id: [u8; 16],
    tenant_id: [u8; 16],
    owner_session_id: [u8; 16],
    client_id: [u8; 16],
    project_id: [u8; 16],
    task_id: [u8; 16],
    nonce: [u8; 16],
    device_key: [u8; 32],
    expected_head: [u8; 32],
    measured_head: [u8; 32],
    expected_head_len: u8,
    action: Action,
    stdout_len: u16,
    stdout_digest: [u8; 32],
    permit_digest: [u8; 32],
    exit_code: u8,
    finished_at_ms: u64,
}
impl Receipt {
    fn canonical_bytes(&self) -> Vec<u8> {
        let mut v = Vec::with_capacity(384);
        v.extend_from_slice(DOMAIN);
        for item in [
            self.owner_id,
            self.tenant_id,
            self.owner_session_id,
            self.client_id,
            self.project_id,
            self.task_id,
            self.nonce,
        ] {
            v.extend_from_slice(&item);
        }
        for item in [
            self.device_key,
            self.expected_head,
            self.measured_head,
            self.stdout_digest,
            self.permit_digest,
        ] {
            v.extend_from_slice(&item)
        }
        v.extend_from_slice(&[self.expected_head_len, self.action as u8, self.exit_code]);
        v.extend_from_slice(&self.stdout_len.to_be_bytes());
        v.extend_from_slice(&self.finished_at_ms.to_be_bytes());
        v
    }
}
#[derive(Clone)]
pub(super) struct SignedReceipt {
    receipt: Receipt,
    signature: [u8; 64],
}
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Denial {
    UntrustedCandidate,
    WrongDevice,
    UnverifiedGitHead,
    Expired,
    InvalidSignature,
    DifferentTask,
    Oversize,
    Storage,
}

fn decode_head_bytes(raw: &[u8], len: u8) -> Result<[u8; 32], Denial> {
    if !matches!(len, 20 | 32) {
        return Err(Denial::UnverifiedGitHead);
    }
    let n = (len as usize) * 2;
    if raw.len() != n && !(raw.len() == n + 1 && raw.last() == Some(&b'\n')) {
        return Err(Denial::UnverifiedGitHead);
    }
    let mut out = [0u8; 32];
    for i in 0..len as usize {
        let a = raw[2 * i];
        let b = raw[2 * i + 1];
        fn nibble(c: u8) -> Option<u8> {
            match c {
                b'0'..=b'9' => Some(c - b'0'),
                b'a'..=b'f' => Some(c - b'a' + 10),
                _ => None,
            }
        }
        out[i] = nibble(a)
            .zip(nibble(b))
            .map(|(x, y)| x * 16 + y)
            .ok_or(Denial::UnverifiedGitHead)?;
    }
    Ok(out)
}
pub(super) fn sign_git_head_result(
    signed_task: &SignedTask,
    candidate: &Candidate,
    actual_stdout: &[u8],
    finished_ms: u64,
    device_key: &SigningKey,
) -> Result<SignedReceipt, Denial> {
    let task = &signed_task.task;
    if task.action != Action::GitHead
        || candidate.action != Action::GitHead
        || candidate.task_id != task.task_id
        || candidate.execution_authorized
        || !candidate.requires_native_executor_recheck
        || candidate.maximum_output_bytes > MAX_RECEIPT_BYTES
    {
        return Err(Denial::UntrustedCandidate);
    }
    if task.local_device_public_key != device_key.verifying_key().to_bytes() {
        return Err(Denial::WrongDevice);
    }
    if actual_stdout.len() > MAX_HEAD_OUTPUT {
        return Err(Denial::Oversize);
    }
    if finished_ms < task.issued_at_ms || finished_ms >= task.expires_at_ms {
        return Err(Denial::Expired);
    }
    let actual = decode_head_bytes(actual_stdout, task.expected_head_len)?;
    if actual != task.expected_head {
        return Err(Denial::UnverifiedGitHead);
    }
    let mut h = Sha256::new();
    h.update(actual_stdout);
    let stdout_digest: [u8; 32] = h.finalize().into();
    let mut h = Sha256::new();
    h.update(b"KatoSync-Stage4AE-request-v1");
    h.update(task.canonical_bytes());
    h.update(signed_task.signature);
    let permit_digest: [u8; 32] = h.finalize().into();
    let receipt = Receipt {
        owner_id: task.owner_id,
        tenant_id: task.tenant_id,
        owner_session_id: task.owner_session_id,
        client_id: task.client_id,
        project_id: task.project_id,
        task_id: task.task_id,
        nonce: task.nonce,
        device_key: task.local_device_public_key,
        expected_head: task.expected_head,
        measured_head: actual,
        expected_head_len: task.expected_head_len,
        action: task.action,
        stdout_len: actual_stdout.len() as u16,
        stdout_digest,
        permit_digest,
        exit_code: 0,
        finished_at_ms: finished_ms,
    };
    let signature = device_key.sign(&receipt.canonical_bytes()).to_bytes();
    Ok(SignedReceipt { receipt, signature })
}
pub(super) fn verify_receipt(
    signed: &SignedReceipt,
    task: &SignedTask,
    expected_device: &VerifyingKey,
    original_stdout: &[u8],
) -> Result<(), Denial> {
    let r = &signed.receipt;
    let t = &task.task;
    if r.device_key != expected_device.to_bytes() || r.device_key != t.local_device_public_key {
        return Err(Denial::WrongDevice);
    }
    let mut h = Sha256::new();
    h.update(original_stdout);
    let stdout_digest: [u8; 32] = h.finalize().into();
    let actual = decode_head_bytes(original_stdout, r.expected_head_len)?;
    let mut h = Sha256::new();
    h.update(b"KatoSync-Stage4AE-request-v1");
    h.update(t.canonical_bytes());
    h.update(task.signature);
    let expected_permit: [u8; 32] = h.finalize().into();
    if r.owner_id != t.owner_id
        || r.tenant_id != t.tenant_id
        || r.owner_session_id != t.owner_session_id
        || r.client_id != t.client_id
        || r.project_id != t.project_id
        || r.task_id != t.task_id
        || r.nonce != t.nonce
        || r.action != Action::GitHead
        || r.action != t.action
        || r.expected_head != t.expected_head
        || r.measured_head != actual
        || r.expected_head_len != t.expected_head_len
        || r.stdout_len as usize != original_stdout.len()
        || r.stdout_digest != stdout_digest
        || r.permit_digest != expected_permit
        || r.exit_code != 0
        || r.finished_at_ms < t.issued_at_ms
        || r.finished_at_ms >= t.expires_at_ms
    {
        return Err(Denial::DifferentTask);
    }
    expected_device
        .verify(
            &r.canonical_bytes(),
            &Signature::from_bytes(&signed.signature),
        )
        .map_err(|_| Denial::InvalidSignature)
}

/// QA-only durable receipt: verify exact device signature and output BEFORE
/// writing, and only after the journal has reserved task ID and nonce.
pub(super) fn persist_verified_receipt(
    journal: &super::journal_qa::Journal,
    signed: &SignedReceipt,
    task: &SignedTask,
    device: &VerifyingKey,
    stdout: &[u8],
) -> Result<(), Denial> {
    verify_receipt(signed, task, device, stdout)?;
    let mut payload = signed.receipt.canonical_bytes();
    payload.extend_from_slice(&signed.signature);
    journal
        .store_verified_terminal_record(&task.task.task_id, &task.task.nonce, &payload)
        .map_err(|_| Denial::Storage)
}
#[cfg(test)]
mod tests {
    use super::super::{journal_qa::Journal, ReplayLedger, RevocationRecheck};
    use super::*;
    use crate::mesh_durable_lease_qa::{
        ChannelBinding, MeshLeaseMachine, ValidatedOpenTlsSocket, VerifiedInChannelHeartbeat,
    };
    use std::{fs, path::PathBuf, process::Command, time::Instant};
    const T: u64 = 1_800_000_000_000;
    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let p =
                std::env::temp_dir().join(format!("katosync-stage4ae-{}", uuid::Uuid::new_v4()));
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
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn run_git(path: &std::path::Path, args: &[&str]) -> std::process::Output {
        // Fixed git binary/argv and ephemeral QA repository ONLY. No shell.
        Command::new("git")
            .args(args)
            .current_dir(path)
            .output()
            .unwrap()
    }
    fn fixture() -> (
        Scratch,
        Vec<u8>,
        SigningKey,
        SignedTask,
        Candidate,
        MeshLeaseMachine,
        Instant,
    ) {
        let p = Scratch::new();
        let repo = p.0.join("fixture-repo");
        fs::create_dir(&repo).unwrap();
        assert!(run_git(&repo, &["init", "-q"]).status.success());
        assert!(run_git(
            &repo,
            &[
                "-c",
                "user.name=NMKato QA",
                "-c",
                "user.email=qa@example.invalid",
                "commit",
                "--allow-empty",
                "-q",
                "-m",
                "isolated signed receipt fixture"
            ]
        )
        .status
        .success());
        let out = run_git(&repo, &["rev-parse", "HEAD"]);
        assert!(out.status.success());
        let output = out.stdout;
        let len = if output.len() == 41 { 20u8 } else { 32u8 };
        let head = decode_head_bytes(&output, len).unwrap();
        let device = SigningKey::from_bytes(&[42; 32]);
        let issuer = SigningKey::from_bytes(&[43; 32]);
        let t = ReadOnlyTask {
            owner_id: [1; 16],
            tenant_id: [21; 16],
            owner_session_id: [11; 16],
            client_id: [12; 16],
            local_device_public_key: device.verifying_key().to_bytes(),
            peer_device_public_key: [3; 32],
            project_id: [4; 16],
            task_id: [5; 16],
            nonce: [6; 16],
            expected_head: head,
            expected_head_len: len,
            action: Action::GitHead,
            issued_at_ms: T - 100,
            expires_at_ms: T + 10_000,
            owner_step_up_at_ms: T - 1000,
        };
        let signed = SignedTask {
            signature: issuer.sign(&t.canonical_bytes()).to_bytes(),
            task: t,
        };
        let bind = ChannelBinding {
            owner_id: t.owner_id,
            local_ed25519: t.local_device_public_key,
            peer_ed25519: t.peer_device_public_key,
            tls_session_nonce: [8; 32],
        };
        let now = Instant::now();
        let mut mesh = MeshLeaseMachine::default();
        assert!(mesh.locally_approved());
        assert!(mesh.begin_verification());
        assert!(mesh.on_still_open_tls_socket(ValidatedOpenTlsSocket { binding: bind }, now));
        assert!(mesh.on_verified_channel_heartbeat(
            VerifiedInChannelHeartbeat {
                binding: bind,
                sequence: 1
            },
            now
        ));
        let a = RevocationRecheck {
            owner_session_active: true,
            client_device_project_grant_active: true,
            owner_session_id: t.owner_session_id,
            tenant_id: t.tenant_id,
            client_id: t.client_id,
            project_id: t.project_id,
            checked_at_ms: T - 1,
        };
        let journal_dir = p.0.join("journal");
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            fs::DirBuilder::new()
                .mode(0o700)
                .create(&journal_dir)
                .unwrap();
        }
        #[cfg(not(unix))]
        fs::create_dir(&journal_dir).unwrap();
        let journal = Journal::open_existing(&journal_dir.canonicalize().unwrap()).unwrap();
        let c = ReplayLedger::default()
            .propose_and_reserve(&mesh, &signed, &issuer.verifying_key(), a, now, T, &journal)
            .unwrap();
        (p, output, device, signed, c, mesh, now)
    }
    #[test]
    fn actual_isolated_git_head_is_signed_and_verifiable() {
        let (_p, out, key, task, c, _mesh, _now) = fixture();
        let signed = sign_git_head_result(&task, &c, &out, T + 2, &key).unwrap();
        assert_eq!(signed.receipt.exit_code, 0);
        assert_eq!(signed.receipt.expected_head, signed.receipt.measured_head);
        assert!(verify_receipt(&signed, &task, &key.verifying_key(), &out).is_ok());
    }
    #[test]
    fn changed_output_and_tampered_receipt_fail_closed() {
        let (_p, out, key, task, c, _mesh, _now) = fixture();
        let signed = sign_git_head_result(&task, &c, &out, T + 2, &key).unwrap();
        let mut wrong = out.clone();
        wrong[0] = b'0' + ((wrong[0] != b'0') as u8);
        assert!(verify_receipt(&signed, &task, &key.verifying_key(), &wrong).is_err());
        let mut forged = signed.clone();
        forged.receipt.exit_code = 1;
        assert!(verify_receipt(&forged, &task, &key.verifying_key(), &out).is_err());
        forged = signed;
        forged.signature = [0; 64];
        assert_eq!(
            verify_receipt(&forged, &task, &key.verifying_key(), &out),
            Err(Denial::InvalidSignature)
        );
    }
    #[test]
    fn wrong_device_never_signs_nor_verifies() {
        let (_p, out, key, task, c, _mesh, _now) = fixture();
        let outsider = SigningKey::from_bytes(&[70; 32]);
        assert!(matches!(
            sign_git_head_result(&task, &c, &out, T + 2, &outsider),
            Err(Denial::WrongDevice)
        ));
        let signed = sign_git_head_result(&task, &c, &out, T + 2, &key).unwrap();
        assert_eq!(
            verify_receipt(&signed, &task, &outsider.verifying_key(), &out),
            Err(Denial::WrongDevice)
        );
    }
    #[test]
    fn expiry_or_wrong_expected_head_fails_even_if_git_stdout_valid() {
        let (_p, out, key, mut task, c, _mesh, _now) = fixture();
        assert!(matches!(
            sign_git_head_result(&task, &c, &out, T + 11_000, &key),
            Err(Denial::Expired)
        ));
        task.task.expected_head = [8; 32];
        assert!(matches!(
            sign_git_head_result(&task, &c, &out, T + 2, &key),
            Err(Denial::UnverifiedGitHead)
        ));
    }
    #[test]
    fn signed_receipt_persists_once_and_cannot_be_replayed_after_reopen() {
        let (p, out, key, task, c, _mesh, _now) = fixture();
        let root = p.0.join("journal").canonicalize().unwrap();
        let j = Journal::open_existing(&root).unwrap();
        let receipt = sign_git_head_result(&task, &c, &out, T + 2, &key).unwrap();
        assert!(persist_verified_receipt(&j, &receipt, &task, &key.verifying_key(), &out).is_ok());
        let record = root.join(format!("receipt-{}.lock", "05".repeat(16)));
        assert!(record.is_file());
        let saved = fs::read(&record).unwrap();
        let mut expected = receipt.receipt.canonical_bytes();
        expected.extend_from_slice(&receipt.signature);
        assert_eq!(saved, expected);
        drop(j);
        let reopened = Journal::open_existing(&root).unwrap();
        assert_eq!(
            persist_verified_receipt(&reopened, &receipt, &task, &key.verifying_key(), &out),
            Err(Denial::Storage)
        );
    }
    #[test]
    fn altered_signature_or_missing_reservation_cannot_persist_completion() {
        let (p, out, key, task, c, _mesh, _now) = fixture();
        let root = p.0.join("journal").canonicalize().unwrap();
        let j = Journal::open_existing(&root).unwrap();
        let mut tampered = sign_git_head_result(&task, &c, &out, T + 2, &key).unwrap();
        tampered.signature = [0; 64];
        assert_eq!(
            persist_verified_receipt(&j, &tampered, &task, &key.verifying_key(), &out),
            Err(Denial::InvalidSignature)
        );
        assert!(!root
            .join(format!("receipt-{}.lock", "05".repeat(16)))
            .exists());
        let empty = p.0.join("unreserved");
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            fs::DirBuilder::new().mode(0o700).create(&empty).unwrap();
        }
        #[cfg(not(unix))]
        fs::create_dir(&empty).unwrap();
        let ej = Journal::open_existing(&empty.canonicalize().unwrap()).unwrap();
        let verified = sign_git_head_result(&task, &c, &out, T + 2, &key).unwrap();
        assert_eq!(
            persist_verified_receipt(&ej, &verified, &task, &key.verifying_key(), &out),
            Err(Denial::Storage)
        );
        assert_eq!(fs::read_dir(&empty).unwrap().count(), 0);
    }
    #[test]
    fn typed_status_or_mutating_command_never_produces_head_receipt() {
        let (_p, out, key, mut task, mut c, _mesh, _now) = fixture();
        task.task.action = Action::GitStatusShort;
        c.action = Action::GitStatusShort;
        assert!(matches!(
            sign_git_head_result(&task, &c, &out, T + 2, &key),
            Err(Denial::UntrustedCandidate)
        ));
        assert!(decode_head_bytes(b"abc; rm -rf /\\n", 20).is_err());
        assert!(decode_head_bytes(b"deadbeef\\n", 20).is_err());
    }
}
