// NMKato Solutions – Stage4AF native source-only execution-time gate.
// This private module does NOT execute Git outside #[cfg(test)] and has no
// public IPC/MCP/browser endpoint. All authorities here are synthetic QA.
// A non-test production executor MUST independently verify server grants,
// immutable project registry, Keychain pins, live socket and revocation.
// IMPORTANT: a pre-execution gate alone cannot eliminate the TOCTOU window.
use super::{Action, Candidate, RevocationRecheck, SignedTask};
use crate::mesh_durable_lease_qa::MeshLeaseMachine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

const MAX_EXECUTION_RECHECK_AGE_MS: u64 = 2_000;

#[derive(Clone, Debug)]
struct TrustedNativeProject {
    project_id: [u8; 16],
    canonical_root: PathBuf,
}
#[derive(Clone, Copy, Debug)]
struct TrustedExecutionRecheck {
    owner_id: [u8; 16],
    tenant_id: [u8; 16],
    owner_session_id: [u8; 16],
    client_id: [u8; 16],
    local_device_key: [u8; 32],
    peer_device_key: [u8; 32],
    project_id: [u8; 16],
    owner_session_active: bool,
    client_device_project_grant_active: bool,
    independent_mfa_bound: bool,
    no_pending_revoke: bool,
    checked_at_ms: u64,
}
#[derive(Debug, PartialEq, Eq)]
enum Denial {
    NoLiveChannel,
    WrongSignedPermit,
    RevokedOrStale,
    UnregisteredProject,
    UnsupportedAction,
    UnsafeFixtureRoot,
    GitFailed,
    ReceiptFailed,
    RevokedDuringExecution,
}
#[derive(Debug)]
struct QaExecutionFence {
    registered_root: PathBuf,
    task_id: [u8; 16],
    project_id: [u8; 16],
    checked_at_ms: u64,
}
fn registered_root_matches(root: &Path) -> bool {
    let Ok(meta) = fs::symlink_metadata(root) else {
        return false;
    };
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return false;
    }
    let Ok(canonical) = root.canonicalize() else {
        return false;
    };
    canonical == root
}
fn validate_before_qa_read(
    mesh: &MeshLeaseMachine,
    signed: &SignedTask,
    candidate: &Candidate,
    issuer: &VerifyingKey,
    authority: RevocationRecheck,
    refreshed: TrustedExecutionRecheck,
    registered: &TrustedNativeProject,
    now: Instant,
    now_ms: u64,
) -> Result<QaExecutionFence, Denial> {
    // Do not trust the earlier admission's stale state. Check canonical
    // native live channel and heartbeat from the still-open session now.
    if !mesh.snapshot(now).live_peer_authenticated {
        return Err(Denial::NoLiveChannel);
    }
    let session = mesh.session.as_ref().ok_or(Denial::NoLiveChannel)?;
    if session.last_sequence == 0 {
        return Err(Denial::NoLiveChannel);
    }
    let task = &signed.task;
    if task.action != Action::GitHead || candidate.action != Action::GitHead {
        return Err(Denial::UnsupportedAction);
    }
    if candidate.execution_authorized
        || !candidate.requires_native_executor_recheck
        || candidate.task_id != task.task_id
        || candidate.maximum_output_bytes > 4096
        || !task.valid(now_ms)
        || issuer
            .verify(
                &task.canonical_bytes(),
                &Signature::from_bytes(&signed.signature),
            )
            .is_err()
        || task.owner_id != session.binding.owner_id
        || task.local_device_public_key != session.binding.local_ed25519
        || task.peer_device_public_key != session.binding.peer_ed25519
    {
        return Err(Denial::WrongSignedPermit);
    }
    // Every field from the second independently sourced current-state
    // response has to match the ORIGINAL signed permit and session.
    if !refreshed.owner_session_active
        || !refreshed.client_device_project_grant_active
        || !refreshed.independent_mfa_bound
        || !refreshed.no_pending_revoke
        || !authority.owner_session_active
        || !authority.client_device_project_grant_active
        || authority.owner_session_id != task.owner_session_id
        || authority.tenant_id != task.tenant_id
        || authority.client_id != task.client_id
        || authority.project_id != task.project_id
        || refreshed.owner_id != task.owner_id
        || refreshed.tenant_id != task.tenant_id
        || refreshed.owner_session_id != task.owner_session_id
        || refreshed.client_id != task.client_id
        || refreshed.local_device_key != task.local_device_public_key
        || refreshed.peer_device_key != task.peer_device_public_key
        || refreshed.project_id != task.project_id
        || refreshed.checked_at_ms > now_ms
        || now_ms.saturating_sub(refreshed.checked_at_ms) > MAX_EXECUTION_RECHECK_AGE_MS
        || authority.checked_at_ms > now_ms
        || now_ms.saturating_sub(authority.checked_at_ms) > MAX_EXECUTION_RECHECK_AGE_MS
    {
        return Err(Denial::RevokedOrStale);
    }
    if registered.project_id != task.project_id
        || !registered_root_matches(&registered.canonical_root)
    {
        return Err(Denial::UnregisteredProject);
    }
    Ok(QaExecutionFence {
        registered_root: registered.canonical_root.clone(),
        task_id: task.task_id,
        project_id: task.project_id,
        checked_at_ms: now_ms,
    })
}

// Stage4AG is a synthetic, process-local revocation epoch. This is NOT
// proof that server revocations are delivered or a live child is cancellable.
// The local lock serializes revocation against durable receipt commit only.
#[cfg(test)]
#[derive(Debug, Default)]
struct QaLocalRevocationGate {
    state: std::sync::Mutex<QaRevocationState>,
}

#[cfg(test)]
#[derive(Debug, Default)]
struct QaRevocationState {
    generation: u64,
    revoked: bool,
    last_server_sequence: u64,
}

#[cfg(test)]
impl QaLocalRevocationGate {
    fn snapshot(&self) -> Result<u64, Denial> {
        let state = self
            .state
            .lock()
            .map_err(|_| Denial::RevokedDuringExecution)?;
        if state.revoked {
            return Err(Denial::RevokedDuringExecution);
        }
        Ok(state.generation)
    }

    fn require(&self, generation: u64) -> Result<(), Denial> {
        self.commit_if_current(generation, || Ok(()))
    }

    fn revoke(&self) -> Result<(), Denial> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| Denial::RevokedDuringExecution)?;
        state.revoked = true;
        state.generation = state
            .generation
            .checked_add(1)
            .ok_or(Denial::RevokedDuringExecution)?;
        Ok(())
    }

    // QA-only, strictly increasing revocation delivery sequence. A true
    // runtime implementation must persist this across device restarts.
    fn apply_signed_server_revocation(&self, sequence: u64) -> Result<(), Denial> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| Denial::RevokedDuringExecution)?;
        if sequence == 0 || sequence <= state.last_server_sequence {
            return Err(Denial::RevokedDuringExecution);
        }
        state.last_server_sequence = sequence;
        state.revoked = true;
        state.generation = state
            .generation
            .checked_add(1)
            .ok_or(Denial::RevokedDuringExecution)?;
        Ok(())
    }

    fn commit_if_current<T>(
        &self,
        generation: u64,
        commit: impl FnOnce() -> Result<T, Denial>,
    ) -> Result<T, Denial> {
        let state = self
            .state
            .lock()
            .map_err(|_| Denial::RevokedDuringExecution)?;
        if state.revoked || state.generation != generation {
            return Err(Denial::RevokedDuringExecution);
        }
        // Hold local QA lock through durable journal commit. No production
        // server-grant authority or cancellation is inferred from this lock.
        commit()
    }
}

// Stage4AH: bounded cancellation of a test-only child after a locally
// verified revocation arrives; the final signed receipt remains separately
// fenced. A real dispatcher needs independent server-side lease authority.
#[cfg(test)]
fn qa_wait_with_revocation(
    mut child: std::process::Child,
    local_revoke: &QaLocalRevocationGate,
    generation: u64,
) -> Result<std::process::Output, Denial> {
    let started = Instant::now();
    loop {
        if let Err(reason) = local_revoke.require(generation) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(reason);
        }
        match child.try_wait() {
            Ok(Some(_)) => {
                local_revoke.require(generation)?;
                return child.wait_with_output().map_err(|_| Denial::GitFailed);
            }
            Ok(None) => {}
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(Denial::GitFailed);
            }
        }
        if started.elapsed() >= std::time::Duration::from_secs(2) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Denial::GitFailed);
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

// The ONLY Git child in this module remains inside #[cfg(test)], and
// may inspect ONLY a disposable fixture root. No owner Git repository.
#[cfg(test)]
fn qa_execute_git_head_and_store_receipt(
    fence: &QaExecutionFence,
    signed: &SignedTask,
    candidate: &Candidate,
    journal: &super::journal_qa::Journal,
    device_signer: &ed25519_dalek::SigningKey,
    local_revoke: &QaLocalRevocationGate,
    now_ms: u64,
) -> Result<Vec<u8>, Denial> {
    qa_execute_git_head_and_store_receipt_with_hooks(
        fence,
        signed,
        candidate,
        journal,
        device_signer,
        local_revoke,
        now_ms,
        || {},
        || {},
    )
}

// Hooks only exist in source-linked Rust tests. They make the two critical
// revocation windows deterministic without touching any real remote device.
#[cfg(test)]
fn qa_execute_git_head_and_store_receipt_with_hooks<BeforeGit, AfterGit>(
    fence: &QaExecutionFence,
    signed: &SignedTask,
    candidate: &Candidate,
    journal: &super::journal_qa::Journal,
    device_signer: &ed25519_dalek::SigningKey,
    local_revoke: &QaLocalRevocationGate,
    now_ms: u64,
    before_git: BeforeGit,
    after_git: AfterGit,
) -> Result<Vec<u8>, Denial>
where
    BeforeGit: FnOnce(),
    AfterGit: FnOnce(),
{
    use std::process::Command;
    let generation = local_revoke.snapshot()?;
    if fence.task_id != signed.task.task_id
        || fence.project_id != signed.task.project_id
        || fence.checked_at_ms != now_ms
        || !registered_root_matches(&fence.registered_root)
        || !fence
            .registered_root
            .join(".stage4af-temporary-qa-only")
            .is_file()
    {
        return Err(Denial::UnsafeFixtureRoot);
    }
    before_git();
    // Serialize local revocation with OS child creation, not only a prior
    // boolean check; release the lock while the bounded test child runs.
    let child = local_revoke.commit_if_current(generation, || {
        Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&fence.registered_root)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|_| Denial::GitFailed)
    })?;
    let result = qa_wait_with_revocation(child, local_revoke, generation)?;
    if !result.status.success()
        || result.stdout.is_empty()
        || result.stdout.len() > 65
        || !result.stderr.is_empty()
    {
        return Err(Denial::GitFailed);
    }
    after_git();
    local_revoke.commit_if_current(generation, || {
        let receipt = super::receipt_qa::sign_git_head_result(
            signed,
            candidate,
            &result.stdout,
            now_ms,
            device_signer,
        )
        .map_err(|_| Denial::ReceiptFailed)?;
        super::receipt_qa::verify_receipt(
            &receipt,
            signed,
            &device_signer.verifying_key(),
            &result.stdout,
        )
        .map_err(|_| Denial::ReceiptFailed)?;
        super::receipt_qa::persist_verified_receipt(
            journal,
            &receipt,
            signed,
            &device_signer.verifying_key(),
            &result.stdout,
        )
        .map_err(|_| Denial::ReceiptFailed)?;
        Ok(result.stdout)
    })
}

#[cfg(test)]
mod tests {
    use super::super::{journal_qa::Journal, ReadOnlyTask, ReplayLedger};
    use super::*;
    use crate::mesh_durable_lease_qa::{
        ChannelBinding, ValidatedOpenTlsSocket, VerifiedInChannelHeartbeat,
    };
    use ed25519_dalek::{Signer, SigningKey};
    use std::{fs, process::Command, time::Duration};

    const T: u64 = 1_800_000_000_000;

    struct QaRoot(PathBuf);
    impl QaRoot {
        fn create() -> Self {
            let base =
                std::env::temp_dir().join(format!("katosync-stage4af-{}", uuid::Uuid::new_v4()));
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                fs::DirBuilder::new().mode(0o700).create(&base).unwrap();
            }
            #[cfg(not(unix))]
            fs::create_dir(&base).unwrap();
            Self(base.canonicalize().unwrap())
        }
    }
    impl Drop for QaRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn git(root: &Path, args: &[&str]) -> Vec<u8> {
        let r = Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            r.status.success(),
            "Git fixture failure: {}",
            String::from_utf8_lossy(&r.stderr)
        );
        r.stdout
    }
    struct Fixture {
        _root: QaRoot,
        repository: TrustedNativeProject,
        journal: Journal,
        mesh: MeshLeaseMachine,
        now: Instant,
        signed: SignedTask,
        candidate: Candidate,
        issuer: SigningKey,
        device: SigningKey,
        authority: RevocationRecheck,
        refresh: TrustedExecutionRecheck,
        expected_stdout: Vec<u8>,
        local_revoke: QaLocalRevocationGate,
    }
    fn setup() -> Fixture {
        let root = QaRoot::create();
        let project = root.0.join("project");
        fs::create_dir(&project).unwrap();
        git(&project, &["init", "-q"]);
        git(
            &project,
            &[
                "-c",
                "user.name=NMKato QA",
                "-c",
                "user.email=qa@example.invalid",
                "commit",
                "--allow-empty",
                "-q",
                "-m",
                "Stage4AF QA fixture",
            ],
        );
        fs::write(project.join(".stage4af-temporary-qa-only"), b"QA").unwrap();
        let stdout = git(&project, &["rev-parse", "HEAD"]);
        let expected_head_len = if stdout.len() == 41 { 20 } else { 32 };
        let mut expected_head = [0u8; 32];
        for i in 0..expected_head_len as usize {
            let s = std::str::from_utf8(&stdout[i * 2..i * 2 + 2]).unwrap();
            expected_head[i] = u8::from_str_radix(s, 16).unwrap();
        }
        let device = SigningKey::from_bytes(&[42; 32]);
        let issuer = SigningKey::from_bytes(&[43; 32]);
        let task = ReadOnlyTask {
            owner_id: [1; 16],
            tenant_id: [21; 16],
            owner_session_id: [11; 16],
            client_id: [12; 16],
            local_device_public_key: device.verifying_key().to_bytes(),
            peer_device_public_key: [3; 32],
            project_id: [4; 16],
            task_id: [5; 16],
            nonce: [6; 16],
            expected_head,
            expected_head_len,
            action: Action::GitHead,
            issued_at_ms: T - 100,
            expires_at_ms: T + 10_000,
            owner_step_up_at_ms: T - 1000,
        };
        let signed = SignedTask {
            signature: issuer.sign(&task.canonical_bytes()).to_bytes(),
            task,
        };
        let binding = ChannelBinding {
            owner_id: task.owner_id,
            local_ed25519: task.local_device_public_key,
            peer_ed25519: task.peer_device_public_key,
            tls_session_nonce: [8; 32],
        };
        let now = Instant::now();
        let mut mesh = MeshLeaseMachine::default();
        assert!(mesh.locally_approved());
        assert!(mesh.begin_verification());
        assert!(mesh.on_still_open_tls_socket(ValidatedOpenTlsSocket { binding }, now));
        assert!(mesh.on_verified_channel_heartbeat(
            VerifiedInChannelHeartbeat {
                binding,
                sequence: 1
            },
            now
        ));
        let auth = RevocationRecheck {
            owner_session_active: true,
            client_device_project_grant_active: true,
            owner_session_id: task.owner_session_id,
            tenant_id: task.tenant_id,
            client_id: task.client_id,
            project_id: task.project_id,
            checked_at_ms: T - 10,
        };
        let refresh = TrustedExecutionRecheck {
            owner_id: task.owner_id,
            tenant_id: task.tenant_id,
            owner_session_id: task.owner_session_id,
            client_id: task.client_id,
            local_device_key: task.local_device_public_key,
            peer_device_key: task.peer_device_public_key,
            project_id: task.project_id,
            owner_session_active: true,
            client_device_project_grant_active: true,
            independent_mfa_bound: true,
            no_pending_revoke: true,
            checked_at_ms: T - 10,
        };
        let dir = root.0.join("journal");
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            fs::DirBuilder::new().mode(0o700).create(&dir).unwrap();
        }
        #[cfg(not(unix))]
        fs::create_dir(&dir).unwrap();
        let journal = Journal::open_existing(&dir.canonicalize().unwrap()).unwrap();
        let candidate = ReplayLedger::default()
            .propose_and_reserve(
                &mesh,
                &signed,
                &issuer.verifying_key(),
                auth,
                now,
                T,
                &journal,
            )
            .unwrap();
        Fixture {
            _root: root,
            repository: TrustedNativeProject {
                project_id: task.project_id,
                canonical_root: project.canonicalize().unwrap(),
            },
            journal,
            mesh,
            now,
            signed,
            candidate,
            issuer,
            device,
            authority: auth,
            refresh,
            expected_stdout: stdout,
            local_revoke: QaLocalRevocationGate::default(),
        }
    }
    fn fence(
        f: &Fixture,
        when: Instant,
        wall: u64,
        recheck: TrustedExecutionRecheck,
    ) -> Result<QaExecutionFence, Denial> {
        validate_before_qa_read(
            &f.mesh,
            &f.signed,
            &f.candidate,
            &f.issuer.verifying_key(),
            f.authority,
            recheck,
            &f.repository,
            when,
            wall,
        )
    }
    #[test]
    fn real_temporary_git_head_requires_fresh_fence_and_signed_durable_result() {
        let f = setup();
        let v = fence(&f, f.now, T, f.refresh).unwrap();
        let actual = qa_execute_git_head_and_store_receipt(
            &v,
            &f.signed,
            &f.candidate,
            &f.journal,
            &f.device,
            &f.local_revoke,
            T,
        )
        .unwrap();
        assert_eq!(actual, f.expected_stdout);
        assert_eq!(v.task_id, f.signed.task.task_id);
        let stored = fs::read_dir(f._root.0.join("journal"))
            .unwrap()
            .filter_map(|x| x.ok())
            .count();
        assert_eq!(stored, 3);
        assert_eq!(
            qa_execute_git_head_and_store_receipt(
                &v,
                &f.signed,
                &f.candidate,
                &f.journal,
                &f.device,
                &f.local_revoke,
                T
            ),
            Err(Denial::ReceiptFailed)
        );
    }
    #[test]
    fn revoked_owner_or_device_or_queued_revoke_after_admission_denies_execution() {
        let f = setup();
        for variant in 0..4 {
            let mut a = f.refresh;
            match variant {
                0 => a.owner_session_active = false,
                1 => a.client_device_project_grant_active = false,
                2 => a.independent_mfa_bound = false,
                _ => a.no_pending_revoke = false,
            };
            assert_eq!(fence(&f, f.now, T, a).unwrap_err(), Denial::RevokedOrStale);
        }
        assert_eq!(
            fs::read_dir(f._root.0.join("journal"))
                .unwrap()
                .filter_map(|x| x.ok())
                .count(),
            2
        );
    }
    #[test]
    fn closed_lease_and_expired_heartbeat_stay_closed_even_with_valid_signature() {
        let mut f = setup();
        f.mesh.socket_closed();
        assert_eq!(
            fence(&f, f.now, T, f.refresh).unwrap_err(),
            Denial::NoLiveChannel
        );
        let f = setup();
        assert_eq!(
            fence(&f, f.now + Duration::from_secs(30), T, f.refresh).unwrap_err(),
            Denial::NoLiveChannel
        );
    }
    #[test]
    fn mismatched_owner_session_peer_project_or_issuer_never_pass() {
        let f = setup();
        for variant in 0..6 {
            let mut a = f.refresh;
            match variant {
                0 => a.owner_id = [99; 16],
                1 => a.tenant_id = [99; 16],
                2 => a.owner_session_id = [99; 16],
                3 => a.client_id = [99; 16],
                4 => a.local_device_key = [99; 32],
                _ => a.project_id = [99; 16],
            };
            assert_eq!(fence(&f, f.now, T, a).unwrap_err(), Denial::RevokedOrStale);
        }
        let wrong = SigningKey::from_bytes(&[91; 32]);
        assert_eq!(
            validate_before_qa_read(
                &f.mesh,
                &f.signed,
                &f.candidate,
                &wrong.verifying_key(),
                f.authority,
                f.refresh,
                &f.repository,
                f.now,
                T
            )
            .unwrap_err(),
            Denial::WrongSignedPermit
        );
    }
    #[test]
    fn stale_or_future_recheck_and_expired_signed_job_denied() {
        let f = setup();
        let mut a = f.refresh;
        a.checked_at_ms = T - 2_001;
        assert_eq!(fence(&f, f.now, T, a).unwrap_err(), Denial::RevokedOrStale);
        a.checked_at_ms = T + 1;
        assert_eq!(fence(&f, f.now, T, a).unwrap_err(), Denial::RevokedOrStale);
        assert_eq!(
            fence(&f, f.now, T + 10_001, f.refresh).unwrap_err(),
            Denial::WrongSignedPermit
        );
    }
    #[test]
    fn unknown_registry_root_or_symlink_never_read() {
        let f = setup();
        let mut reg = f.repository.clone();
        reg.project_id = [99; 16];
        assert_eq!(
            validate_before_qa_read(
                &f.mesh,
                &f.signed,
                &f.candidate,
                &f.issuer.verifying_key(),
                f.authority,
                f.refresh,
                &reg,
                f.now,
                T
            )
            .unwrap_err(),
            Denial::UnregisteredProject
        );
        let mut reg = f.repository.clone();
        reg.canonical_root = f._root.0.join("missing");
        assert_eq!(
            validate_before_qa_read(
                &f.mesh,
                &f.signed,
                &f.candidate,
                &f.issuer.verifying_key(),
                f.authority,
                f.refresh,
                &reg,
                f.now,
                T
            )
            .unwrap_err(),
            Denial::UnregisteredProject
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let link = f._root.0.join("foreign-link");
            symlink(&f.repository.canonical_root, &link).unwrap();
            reg.canonical_root = link;
            assert_eq!(
                validate_before_qa_read(
                    &f.mesh,
                    &f.signed,
                    &f.candidate,
                    &f.issuer.verifying_key(),
                    f.authority,
                    f.refresh,
                    &reg,
                    f.now,
                    T
                )
                .unwrap_err(),
                Denial::UnregisteredProject
            );
        }
    }
    #[test]
    fn changed_git_head_after_admission_cannot_create_receipt() {
        let f = setup();
        let v = fence(&f, f.now, T, f.refresh).unwrap();
        git(
            &f.repository.canonical_root,
            &[
                "-c",
                "user.name=NMKato QA",
                "-c",
                "user.email=qa@example.invalid",
                "commit",
                "--allow-empty",
                "-q",
                "-m",
                "new QA head",
            ],
        );
        assert_eq!(
            qa_execute_git_head_and_store_receipt(
                &v,
                &f.signed,
                &f.candidate,
                &f.journal,
                &f.device,
                &f.local_revoke,
                T
            ),
            Err(Denial::ReceiptFailed)
        );
        assert_eq!(
            fs::read_dir(f._root.0.join("journal"))
                .unwrap()
                .filter_map(|x| x.ok())
                .count(),
            2
        );
    }
    #[test]
    fn fixture_runner_never_accepts_missing_qa_marker_or_changed_fence_time() {
        let f = setup();
        let mut v = fence(&f, f.now, T, f.refresh).unwrap();
        fs::remove_file(
            f.repository
                .canonical_root
                .join(".stage4af-temporary-qa-only"),
        )
        .unwrap();
        assert_eq!(
            qa_execute_git_head_and_store_receipt(
                &v,
                &f.signed,
                &f.candidate,
                &f.journal,
                &f.device,
                &f.local_revoke,
                T
            ),
            Err(Denial::UnsafeFixtureRoot)
        );
        v.checked_at_ms = T + 1;
        assert_eq!(
            qa_execute_git_head_and_store_receipt(
                &v,
                &f.signed,
                &f.candidate,
                &f.journal,
                &f.device,
                &f.local_revoke,
                T
            ),
            Err(Denial::UnsafeFixtureRoot)
        );
    }
    #[test]
    fn stage4ag_revoke_between_fence_and_git_launch_denies_without_receipt() {
        let f = setup();
        let v = fence(&f, f.now, T, f.refresh).unwrap();
        assert_eq!(
            qa_execute_git_head_and_store_receipt_with_hooks(
                &v,
                &f.signed,
                &f.candidate,
                &f.journal,
                &f.device,
                &f.local_revoke,
                T,
                || f.local_revoke.revoke().unwrap(),
                || {},
            ),
            Err(Denial::RevokedDuringExecution)
        );
        assert_eq!(fs::read_dir(f._root.0.join("journal")).unwrap().count(), 2);
    }

    #[test]
    fn stage4ag_revoke_after_git_read_denies_device_receipt_and_durable_commit() {
        let f = setup();
        let v = fence(&f, f.now, T, f.refresh).unwrap();
        assert_eq!(
            qa_execute_git_head_and_store_receipt_with_hooks(
                &v,
                &f.signed,
                &f.candidate,
                &f.journal,
                &f.device,
                &f.local_revoke,
                T,
                || {},
                || f.local_revoke.revoke().unwrap(),
            ),
            Err(Denial::RevokedDuringExecution)
        );
        assert_eq!(fs::read_dir(f._root.0.join("journal")).unwrap().count(), 2);
    }

    #[test]
    fn stage4ag_revocation_generation_is_monotonic_sticky_and_cannot_rearm() {
        let f = setup();
        let generation = f.local_revoke.snapshot().unwrap();
        f.local_revoke.revoke().unwrap();
        assert_eq!(
            f.local_revoke.require(generation),
            Err(Denial::RevokedDuringExecution)
        );
        assert_eq!(
            f.local_revoke.snapshot(),
            Err(Denial::RevokedDuringExecution)
        );
        f.local_revoke.revoke().unwrap();
        assert_eq!(
            f.local_revoke.require(generation),
            Err(Denial::RevokedDuringExecution)
        );
        let v = fence(&f, f.now, T, f.refresh).unwrap();
        assert_eq!(
            qa_execute_git_head_and_store_receipt(
                &v,
                &f.signed,
                &f.candidate,
                &f.journal,
                &f.device,
                &f.local_revoke,
                T,
            ),
            Err(Denial::RevokedDuringExecution)
        );
        assert_eq!(fs::read_dir(f._root.0.join("journal")).unwrap().count(), 2);
    }
}

#[cfg(test)]
#[path = "execution_fence_qa/revoke_delivery_qa.rs"]
mod revoke_delivery_qa;
