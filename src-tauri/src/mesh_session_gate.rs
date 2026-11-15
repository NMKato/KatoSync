// Created by NMKato Solutions
//! Stage4AB – native typed session / read-only job admission contract.
//!
//! This is a QA-only, non-network, non-executing policy module. The real
//! Stage4AA mTLS transport remains one-shot, drops its socket, and does
//! NOT create this session or authorize remote jobs.
//!
//! Callers must derive all Evidence values from trusted native mTLS and
//! separately verified server-side owner/device/client/project grants.
//! This module does not parse HTTP or untrusted model-generated JSON.
//! Returning Candidate is not a permission to call Local Control.

use std::collections::HashSet;

const MAX_SESSION_MS: u64 = 60_000;
const MAX_AUTH_AGE_MS: u64 = 30_000;
const MAX_HEARTBEAT_AGE_MS: u64 = 15_000;
const MAX_JOB_MS: u64 = 20_000;
const MAX_RESULT_BYTES: usize = 4096;
const MAX_REPLAY_ENTRIES: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Status {
    Disconnected,
    Authenticated,
    Revoked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReadAction {
    GitHead,
    GitStatusShort,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Reason {
    UnverifiedPeer,
    ExpiredSession,
    LostConnection,
    WrongOwner,
    MissingConsent,
    Revoked,
    WrongSequence,
    DuplicateJob,
    InvalidJob,
    LimitedCapacity,
}

#[derive(Debug, Clone)]
pub(crate) struct AdmissionEvidence {
    // Construct only from a pinned, presently ACTIVE mTLS transport. Do not
    // deserialize arbitrary caller input into this type.
    pub owner_id: String,
    pub local_device_id: String,
    pub remote_device_id: String,
    pub remote_key_fingerprint: String,
    pub owner_session_active: bool,
    pub peer_cert_pin_verified: bool,
    pub enrollment_verified: bool,
    pub peer_transport_open: bool,
    pub authorized_at_ms: u64,
    pub consent_expires_at_ms: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct ReadOnlyGrantEvidence {
    // Must come from a separate server-side owner/client/device/project grant.
    // Having an mTLS peer never supplies this authorization.
    pub owner_id: String,
    pub client_id: String,
    pub device_id: String,
    pub project_id: String,
    pub requested_action: ReadAction,
    pub server_approved: bool,
    pub owner_step_up_verified: bool,
    pub revoked: bool,
    pub granted_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct ProposedReadJob {
    pub task_id: String,
    pub nonce: String,
    pub expected_head: String,
    pub action: ReadAction,
    pub requested_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct CandidateReceipt {
    pub task_id: String,
    pub action: ReadAction,
    pub bounded_output_bytes: usize,
    pub execution_authorized: bool,
    pub requires_native_executor_recheck: bool,
}

#[derive(Debug)]
pub(crate) struct PeerSession {
    status: Status,
    owner_id: String,
    local_device_id: String,
    remote_device_id: String,
    remote_key_fingerprint: String,
    authorized_at_ms: u64,
    session_expires_at_ms: u64,
    last_heartbeat_ms: u64,
    last_sequence: u64,
    known_jobs: HashSet<String>,
}

fn safe_id(s: &str) -> bool {
    (4..=96).contains(&s.len())
        && s.bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == b'-' || ch == b'_' || ch == b':')
}
fn safe_sha(s: &str) -> bool {
    (s.len() == 40 || s.len() == 64)
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn valid_evidence(e: &AdmissionEvidence, now_ms: u64) -> bool {
    e.owner_session_active
        && e.peer_cert_pin_verified
        && e.enrollment_verified
        && e.peer_transport_open
        && safe_id(&e.owner_id)
        && safe_id(&e.local_device_id)
        && safe_id(&e.remote_device_id)
        && e.local_device_id != e.remote_device_id
        && safe_id(&e.remote_key_fingerprint)
        && e.authorized_at_ms <= now_ms
        && now_ms - e.authorized_at_ms <= MAX_AUTH_AGE_MS
        && e.consent_expires_at_ms > now_ms
}

impl PeerSession {
    /// An active, pinned mTLS socket + independently verified owner evidence
    /// must be supplied by a separate native adapter; Stage4AA does not.
    pub(crate) fn from_verified_transport(
        evidence: &AdmissionEvidence,
        now_ms: u64,
    ) -> Result<Self, Reason> {
        if !valid_evidence(evidence, now_ms) {
            return Err(Reason::UnverifiedPeer);
        }
        let deadline = now_ms.saturating_add(MAX_SESSION_MS);
        Ok(Self {
            status: Status::Authenticated,
            owner_id: evidence.owner_id.clone(),
            local_device_id: evidence.local_device_id.clone(),
            remote_device_id: evidence.remote_device_id.clone(),
            remote_key_fingerprint: evidence.remote_key_fingerprint.clone(),
            authorized_at_ms: now_ms,
            session_expires_at_ms: deadline.min(evidence.consent_expires_at_ms),
            last_heartbeat_ms: now_ms,
            last_sequence: 0,
            known_jobs: HashSet::new(),
        })
    }

    /// Heartbeats only prove one still-present socket when the trusted
    /// adapter checks actual mTLS state and rechecks owner/roster/revocation.
    pub(crate) fn heartbeat(
        &mut self,
        evidence: &AdmissionEvidence,
        sequence: u64,
        now_ms: u64,
    ) -> Result<(), Reason> {
        self.ensure_active(now_ms)?;
        if now_ms < self.last_heartbeat_ms {
            self.status = Status::Disconnected;
            return Err(Reason::WrongSequence);
        }
        if !valid_evidence(evidence, now_ms)
            || evidence.owner_id != self.owner_id
            || evidence.remote_device_id != self.remote_device_id
            || evidence.local_device_id != self.local_device_id
            || evidence.remote_key_fingerprint != self.remote_key_fingerprint
        {
            self.status = Status::Revoked;
            return Err(Reason::UnverifiedPeer);
        }
        if sequence == 0 || sequence <= self.last_sequence {
            self.status = Status::Disconnected;
            return Err(Reason::WrongSequence);
        }
        self.last_sequence = sequence;
        self.last_heartbeat_ms = now_ms;
        self.session_expires_at_ms = self
            .session_expires_at_ms
            .min(evidence.consent_expires_at_ms);
        Ok(())
    }

    pub(crate) fn ensure_active(&mut self, now_ms: u64) -> Result<(), Reason> {
        match self.status {
            Status::Revoked => return Err(Reason::Revoked),
            Status::Disconnected => return Err(Reason::LostConnection),
            Status::Authenticated => {}
        }
        if now_ms >= self.session_expires_at_ms || now_ms < self.authorized_at_ms {
            self.status = Status::Disconnected;
            return Err(Reason::ExpiredSession);
        }
        if now_ms.saturating_sub(self.last_heartbeat_ms) > MAX_HEARTBEAT_AGE_MS {
            self.status = Status::Disconnected;
            return Err(Reason::LostConnection);
        }
        Ok(())
    }

    /// Important: never executes a command. A future native executor still
    /// needs a server-signed one-time permit, canonical project registry,
    /// expected HEAD and device/client token scope before any Git operation.
    pub(crate) fn propose_read_only_job(
        &mut self,
        grant: &ReadOnlyGrantEvidence,
        task: &ProposedReadJob,
        now_ms: u64,
    ) -> Result<CandidateReceipt, Reason> {
        self.ensure_active(now_ms)?;
        if self.last_sequence == 0 {
            return Err(Reason::LostConnection); // require at least one fresh heartbeat
        }
        if !safe_id(&grant.owner_id)
            || grant.owner_id != self.owner_id
            || grant.device_id != self.local_device_id
        {
            return Err(Reason::WrongOwner);
        }
        if !safe_id(&grant.project_id)
            || !safe_id(&grant.client_id)
            || !grant.server_approved
            || !grant.owner_step_up_verified
            || grant.revoked
            || grant.granted_at_ms > now_ms
            || grant.expires_at_ms <= now_ms
            || grant.expires_at_ms > self.session_expires_at_ms
        {
            return Err(Reason::MissingConsent);
        }
        if grant.requested_action != task.action {
            return Err(Reason::MissingConsent);
        }
        if !safe_id(&task.task_id)
            || !safe_id(&task.nonce)
            || !safe_sha(&task.expected_head)
            || task.requested_at_ms > now_ms
            || task.expires_at_ms <= now_ms
            || task.expires_at_ms.saturating_sub(task.requested_at_ms) > MAX_JOB_MS
            || task.expires_at_ms > grant.expires_at_ms
        {
            return Err(Reason::InvalidJob);
        }
        if self.known_jobs.len() >= MAX_REPLAY_ENTRIES {
            return Err(Reason::LimitedCapacity);
        }
        // Binding the nonce to client/device/project prevents a duplicate
        // request from being run twice by this session in future integrations.
        let id = format!(
            "{}:{}:{}:{}:{}",
            grant.client_id, grant.device_id, grant.project_id, task.task_id, task.nonce
        );
        if !self.known_jobs.insert(id) {
            return Err(Reason::DuplicateJob);
        }
        Ok(CandidateReceipt {
            task_id: task.task_id.clone(),
            action: task.action,
            bounded_output_bytes: MAX_RESULT_BYTES,
            execution_authorized: false,
            requires_native_executor_recheck: true,
        })
    }

    pub(crate) fn disconnect(&mut self) {
        self.status = Status::Disconnected;
    }
    pub(crate) fn revoke(&mut self) {
        self.status = Status::Revoked;
    }
    pub(crate) fn status(&self) -> Status {
        self.status
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const T: u64 = 1_800_000_000_000;
    fn admitted() -> AdmissionEvidence {
        AdmissionEvidence {
            owner_id: "owner-0001".into(),
            local_device_id: "device-m2".into(),
            remote_device_id: "device-m3".into(),
            remote_key_fingerprint: "approved-pin-0001".into(),
            owner_session_active: true,
            peer_cert_pin_verified: true,
            enrollment_verified: true,
            peer_transport_open: true,
            authorized_at_ms: T - 1000,
            consent_expires_at_ms: T + 50_000,
        }
    }
    fn grant() -> ReadOnlyGrantEvidence {
        ReadOnlyGrantEvidence {
            owner_id: "owner-0001".into(),
            client_id: "chatgpt-owner-client".into(),
            device_id: "device-m2".into(),
            project_id: "katosync".into(),
            requested_action: ReadAction::GitHead,
            server_approved: true,
            owner_step_up_verified: true,
            revoked: false,
            granted_at_ms: T - 1000,
            expires_at_ms: T + 18_000,
        }
    }
    fn job() -> ProposedReadJob {
        ProposedReadJob {
            task_id: "task-0001".into(),
            nonce: "nonce-0001".into(),
            expected_head: "a".repeat(40),
            action: ReadAction::GitHead,
            requested_at_ms: T - 1000,
            expires_at_ms: T + 5000,
        }
    }
    fn active() -> PeerSession {
        let mut s = PeerSession::from_verified_transport(&admitted(), T).unwrap();
        s.heartbeat(&admitted(), 1, T + 1).unwrap();
        s
    }

    #[test]
    fn pinned_live_trust_required_even_to_create_session() {
        for toggle in 0..5 {
            let mut e = admitted();
            match toggle {
                0 => e.owner_session_active = false,
                1 => e.peer_cert_pin_verified = false,
                2 => e.enrollment_verified = false,
                3 => e.peer_transport_open = false,
                _ => e.consent_expires_at_ms = T,
            }
            assert_eq!(
                PeerSession::from_verified_transport(&e, T).err(),
                Some(Reason::UnverifiedPeer)
            );
        }
    }
    #[test]
    fn no_job_before_fresh_heartbeat_even_after_tls_admission() {
        let mut s = PeerSession::from_verified_transport(&admitted(), T).unwrap();
        assert_eq!(
            s.propose_read_only_job(&grant(), &job(), T + 1).err(),
            Some(Reason::LostConnection)
        );
    }
    #[test]
    fn granted_readonly_candidate_is_never_execution_permission() {
        let result = active()
            .propose_read_only_job(&grant(), &job(), T + 2)
            .unwrap();
        assert_eq!(result.task_id, "task-0001");
        assert_eq!(result.action, ReadAction::GitHead);
        assert_eq!(result.bounded_output_bytes, 4096);
        assert!(!result.execution_authorized);
        assert!(result.requires_native_executor_recheck);
    }
    #[test]
    fn duplicate_job_nonce_is_rejected() {
        let mut s = active();
        assert!(s.propose_read_only_job(&grant(), &job(), T + 2).is_ok());
        assert_eq!(
            s.propose_read_only_job(&grant(), &job(), T + 3).err(),
            Some(Reason::DuplicateJob)
        );
    }
    #[test]
    fn missing_owner_client_device_or_step_up_grants_fail() {
        for toggle in 0..5 {
            let mut g = grant();
            match toggle {
                0 => g.owner_id = "foreign-owner".into(),
                1 => g.device_id = "foreign-device".into(),
                2 => g.server_approved = false,
                3 => g.owner_step_up_verified = false,
                _ => g.revoked = true,
            }
            assert!(active().propose_read_only_job(&g, &job(), T + 2).is_err());
        }
    }
    #[test]
    fn mtls_key_replacement_or_owner_change_kills_session() {
        for toggle in 0..3 {
            let mut e = admitted();
            match toggle {
                0 => e.remote_key_fingerprint = "rotated-key".into(),
                1 => e.owner_id = "different-owner".into(),
                _ => e.enrollment_verified = false,
            }
            let mut s = active();
            assert_eq!(
                s.heartbeat(&e, 2, T + 5).err(),
                Some(Reason::UnverifiedPeer)
            );
            assert_eq!(s.status(), Status::Revoked);
            assert_eq!(
                s.propose_read_only_job(&grant(), &job(), T + 6).err(),
                Some(Reason::Revoked)
            );
        }
    }
    #[test]
    fn heartbeat_replay_disables_transport() {
        let mut s = active();
        assert_eq!(
            s.heartbeat(&admitted(), 1, T + 5).err(),
            Some(Reason::WrongSequence)
        );
        assert_eq!(s.status(), Status::Disconnected);
    }
    #[test]
    fn disconnected_or_expired_session_never_dispatches() {
        let mut s = active();
        s.disconnect();
        assert_eq!(
            s.propose_read_only_job(&grant(), &job(), T + 3).err(),
            Some(Reason::LostConnection)
        );
        let mut s = active();
        assert_eq!(
            s.ensure_active(T + MAX_HEARTBEAT_AGE_MS + 5).err(),
            Some(Reason::LostConnection)
        );
        let mut s = active();
        assert_eq!(
            s.ensure_active(T + 50_000).err(),
            Some(Reason::ExpiredSession)
        );
    }
    #[test]
    fn explicit_revocation_is_terminal() {
        let mut s = active();
        s.revoke();
        assert_eq!(
            s.heartbeat(&admitted(), 2, T + 2).err(),
            Some(Reason::Revoked)
        );
        assert_eq!(s.status(), Status::Revoked);
    }
    #[test]
    fn no_mutating_git_or_arbitrary_command_surface() {
        assert_ne!(ReadAction::GitHead, ReadAction::GitStatusShort);
        let mut t = job();
        t.action = ReadAction::GitStatusShort;
        assert_eq!(
            active().propose_read_only_job(&grant(), &t, T + 2).err(),
            Some(Reason::MissingConsent)
        );
    }
    #[test]
    fn expiring_consent_never_extends_the_session() {
        let mut s = active();
        let mut e = admitted();
        e.consent_expires_at_ms = T + 100;
        s.heartbeat(&e, 2, T + 50).unwrap();
        assert_eq!(s.ensure_active(T + 101).err(), Some(Reason::ExpiredSession));
    }
    #[test]
    fn invalid_nonce_head_and_overlong_job_ttl_are_denied() {
        for toggle in 0..4 {
            let mut t = job();
            match toggle {
                0 => t.task_id = "../escape".into(),
                1 => t.nonce = "../bad".into(),
                2 => t.expected_head = "not-a-sha".into(),
                _ => t.expires_at_ms = T + 50_000,
            }
            assert_eq!(
                active().propose_read_only_job(&grant(), &t, T + 2).err(),
                Some(Reason::InvalidJob)
            );
        }
    }
    #[test]
    fn grant_must_expire_no_later_than_underlying_session() {
        let mut g = grant();
        g.expires_at_ms = T + 65_000;
        assert_eq!(
            active().propose_read_only_job(&g, &job(), T + 2).err(),
            Some(Reason::MissingConsent)
        );
    }
    #[test]
    fn rollback_in_heartbeat_clock_fails_closed() {
        let mut s = active();
        assert_eq!(
            s.heartbeat(&admitted(), 2, T).err(),
            Some(Reason::WrongSequence)
        );
        assert_eq!(s.status(), Status::Disconnected);
    }
    #[test]
    fn stale_owner_admission_cannot_be_renewed_by_heartbeat() {
        let mut s = active();
        let mut e = admitted();
        e.consent_expires_at_ms = T + 50_000;
        assert_eq!(
            s.heartbeat(&e, 2, T + MAX_AUTH_AGE_MS + 2).err(),
            Some(Reason::LostConnection)
        );
        assert_eq!(s.status(), Status::Disconnected);
    }

    #[test]
    fn transport_session_cannot_bypass_project_scope() {
        let mut g = grant();
        g.project_id = "../../foreign".into();
        assert_eq!(
            active().propose_read_only_job(&g, &job(), T + 2).err(),
            Some(Reason::MissingConsent)
        );
    }
}
