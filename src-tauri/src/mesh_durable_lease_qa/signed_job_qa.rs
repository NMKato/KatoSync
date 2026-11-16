// Created by NMKato Solutions
//! Stage4AC – signed, per-device, read-only task ADMISSION candidate on the
//! single canonical Stage4AB.1 live TLS lease. This module NEVER invokes Git,
//! opens sockets, reads Keychain, grants rights or creates a public endpoint.
//! A trusted runtime signer, active RC66 owner session, server revocation
//! revalidation, durable replay ledger, and Stage4L executor remain separate.
use super::MeshLeaseMachine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use std::{collections::HashSet, time::Instant};

const GRANT_MAX_DURATION_MS: u64 = 20_000;
const GRANT_MAX_ISSUED_AGE_MS: u64 = 30_000;
const OWNER_STEPUP_MAX_AGE_MS: u64 = 120_000;
const REVOCATION_CHECK_MAX_AGE_MS: u64 = 5_000;
const MAX_RECEIPT_BYTES: usize = 4096;
const MAX_LEDGER_ITEMS: usize = 128;
const DOMAIN: &[u8] = b"KatoSync-Stage4AC-signed-readonly-permit-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Action {
    GitHead = 1,
    GitStatusShort = 2,
}
#[derive(Debug, Clone, Copy)]
struct ReadOnlyTask {
    owner_id: [u8; 16],
    tenant_id: [u8; 16],
    owner_session_id: [u8; 16],
    client_id: [u8; 16],
    local_device_public_key: [u8; 32],
    peer_device_public_key: [u8; 32],
    project_id: [u8; 16],
    task_id: [u8; 16],
    nonce: [u8; 16],
    expected_head: [u8; 32],
    expected_head_len: u8,
    action: Action,
    issued_at_ms: u64,
    expires_at_ms: u64,
    owner_step_up_at_ms: u64,
}
impl ReadOnlyTask {
    fn canonical_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(320);
        bytes.extend_from_slice(DOMAIN);
        for val in [
            self.owner_id,
            self.tenant_id,
            self.owner_session_id,
            self.client_id,
            self.project_id,
            self.task_id,
            self.nonce,
        ] {
            bytes.extend_from_slice(&val);
        }
        bytes.extend_from_slice(&self.local_device_public_key);
        bytes.extend_from_slice(&self.peer_device_public_key);
        bytes.extend_from_slice(&self.expected_head);
        bytes.push(self.expected_head_len);
        bytes.push(self.action as u8);
        for val in [
            self.issued_at_ms,
            self.expires_at_ms,
            self.owner_step_up_at_ms,
        ] {
            bytes.extend_from_slice(&val.to_be_bytes());
        }
        bytes
    }
    fn valid(&self, now: u64) -> bool {
        for value in [
            self.owner_id,
            self.tenant_id,
            self.owner_session_id,
            self.client_id,
            self.project_id,
            self.task_id,
            self.nonce,
        ] {
            if value.iter().all(|v| *v == 0) {
                return false;
            }
        }
        if !matches!(self.expected_head_len, 20 | 32)
            || self.expected_head[..self.expected_head_len as usize]
                .iter()
                .all(|x| *x == 0)
            || self.expected_head[self.expected_head_len as usize..]
                .iter()
                .any(|x| *x != 0)
        {
            return false;
        }
        if self.local_device_public_key.iter().all(|v| *v == 0)
            || self.peer_device_public_key.iter().all(|v| *v == 0)
            || self.local_device_public_key == self.peer_device_public_key
            || self.expected_head.iter().all(|v| *v == 0)
        {
            return false;
        }
        self.issued_at_ms <= now
            && now.saturating_sub(self.issued_at_ms) <= GRANT_MAX_ISSUED_AGE_MS
            && self.expires_at_ms > now
            && self.expires_at_ms.saturating_sub(self.issued_at_ms) <= GRANT_MAX_DURATION_MS
            && self.owner_step_up_at_ms <= self.issued_at_ms
            && self.issued_at_ms.saturating_sub(self.owner_step_up_at_ms) <= OWNER_STEPUP_MAX_AGE_MS
    }
}
struct SignedTask {
    task: ReadOnlyTask,
    signature: [u8; 64],
}

#[derive(Debug, Clone, Copy)]
struct RevocationRecheck {
    // Value must be sourced from *trusted server-side* owner/grant authority.
    // Never parse this directly from a model, request or untrusted peer.
    owner_session_active: bool,
    client_device_project_grant_active: bool,
    owner_session_id: [u8; 16],
    tenant_id: [u8; 16],
    client_id: [u8; 16],
    project_id: [u8; 16],
    checked_at_ms: u64,
}

#[derive(Debug, PartialEq, Eq)]
enum Denial {
    ClosedLease,
    StaleAuthority,
    MalformedPermit,
    InvalidSignature,
    WrongBoundPeer,
    Replay,
    CapacityExceeded,
}
#[derive(Debug, PartialEq, Eq)]
struct Candidate {
    task_id: [u8; 16],
    action: Action,
    maximum_output_bytes: usize,
    execution_authorized: bool,
    requires_native_executor_recheck: bool,
}
#[derive(Default)]
struct ReplayLedger {
    task_ids: HashSet<[u8; 16]>,
    nonces: HashSet<[u8; 16]>,
}

impl ReplayLedger {
    fn propose(
        &mut self,
        lease: &MeshLeaseMachine,
        signed: &SignedTask,
        pinned_signer: &VerifyingKey,
        authority: RevocationRecheck,
        now: Instant,
        now_ms: u64,
    ) -> Result<Candidate, Denial> {
        // The canonical live Mesh lease is the ONLY authority for current transport.
        // Pairing, an earlier Stage4AA one-shot, or cloud presence cannot pass.
        if !lease.snapshot(now).live_peer_authenticated {
            return Err(Denial::ClosedLease);
        }
        let session = lease.session.as_ref().ok_or(Denial::ClosedLease)?;
        if session.last_sequence == 0 {
            return Err(Denial::ClosedLease);
        }
        let task = &signed.task;
        if !task.valid(now_ms) {
            return Err(Denial::MalformedPermit);
        }
        if authority.tenant_id != signed.task.tenant_id
            || authority.owner_session_id != signed.task.owner_session_id
            || authority.client_id != signed.task.client_id
            || authority.project_id != signed.task.project_id
        {
            return Err(Denial::StaleAuthority);
        }
        if authority.checked_at_ms > now_ms
            || now_ms.saturating_sub(authority.checked_at_ms) > REVOCATION_CHECK_MAX_AGE_MS
            || !authority.owner_session_active
            || !authority.client_device_project_grant_active
        {
            return Err(Denial::StaleAuthority);
        }
        let signature = Signature::from_bytes(&signed.signature);
        pinned_signer
            .verify(&task.canonical_bytes(), &signature)
            .map_err(|_| Denial::InvalidSignature)?;
        if task.owner_id != session.binding.owner_id
            || task.local_device_public_key != session.binding.local_ed25519
            || task.peer_device_public_key != session.binding.peer_ed25519
        {
            return Err(Denial::WrongBoundPeer);
        }
        if self.task_ids.contains(&task.task_id) || self.nonces.contains(&task.nonce) {
            return Err(Denial::Replay);
        }
        if self.task_ids.len() >= MAX_LEDGER_ITEMS || self.nonces.len() >= MAX_LEDGER_ITEMS {
            return Err(Denial::CapacityExceeded);
        }
        self.task_ids.insert(task.task_id);
        self.nonces.insert(task.nonce);
        Ok(Candidate {
            task_id: task.task_id,
            action: task.action,
            maximum_output_bytes: MAX_RECEIPT_BYTES,
            execution_authorized: false,
            requires_native_executor_recheck: true,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh_durable_lease_qa::{
        ChannelBinding, ValidatedOpenTlsSocket, VerifiedInChannelHeartbeat,
    };
    use ed25519_dalek::{Signer, SigningKey};
    use std::time::Duration;
    const WALL: u64 = 1_800_000_000_000;
    fn signer() -> SigningKey {
        SigningKey::from_bytes(&[14u8; 32])
    }
    fn task() -> ReadOnlyTask {
        ReadOnlyTask {
            owner_id: [1; 16],
            tenant_id: [21; 16],
            owner_session_id: [11; 16],
            client_id: [12; 16],
            local_device_public_key: [2; 32],
            peer_device_public_key: [3; 32],
            project_id: [4; 16],
            task_id: [5; 16],
            nonce: [6; 16],
            expected_head: [7; 32],
            expected_head_len: 32,
            action: Action::GitHead,
            issued_at_ms: WALL - 100,
            expires_at_ms: WALL + 10_000,
            owner_step_up_at_ms: WALL - 1_000,
        }
    }
    fn sign(p: ReadOnlyTask) -> SignedTask {
        let signature = signer().sign(&p.canonical_bytes()).to_bytes();
        SignedTask { task: p, signature }
    }
    fn fresh() -> RevocationRecheck {
        RevocationRecheck {
            owner_session_active: true,
            client_device_project_grant_active: true,
            owner_session_id: [11; 16],
            tenant_id: [21; 16],
            client_id: [12; 16],
            project_id: [4; 16],
            checked_at_ms: WALL - 100,
        }
    }
    fn live() -> (MeshLeaseMachine, Instant) {
        let t = Instant::now();
        let binding = ChannelBinding {
            owner_id: [1; 16],
            local_ed25519: [2; 32],
            peer_ed25519: [3; 32],
            tls_session_nonce: [8; 32],
        };
        let mut m = MeshLeaseMachine::default();
        assert!(m.locally_approved());
        assert!(m.begin_verification());
        assert!(m.on_still_open_tls_socket(ValidatedOpenTlsSocket { binding }, t));
        assert!(m.on_verified_channel_heartbeat(
            VerifiedInChannelHeartbeat {
                binding,
                sequence: 1
            },
            t + Duration::from_millis(1)
        ));
        (m, t + Duration::from_millis(2))
    }
    fn attempt(
        m: &MeshLeaseMachine,
        when: Instant,
        p: &SignedTask,
        auth: RevocationRecheck,
        l: &mut ReplayLedger,
    ) -> Result<Candidate, Denial> {
        l.propose(m, p, &signer().verifying_key(), auth, when, WALL)
    }
    #[test]
    fn valid_signed_owner_scoped_readonly_task_is_never_an_execution_permit() {
        let (m, now) = live();
        let mut l = ReplayLedger::default();
        let candidate = attempt(&m, now, &sign(task()), fresh(), &mut l).unwrap();
        assert_eq!(candidate.action, Action::GitHead);
        assert_eq!(candidate.maximum_output_bytes, 4096);
        assert!(!candidate.execution_authorized);
        assert!(candidate.requires_native_executor_recheck);
    }
    #[test]
    fn wrong_signer_and_modified_action_both_fail() {
        let (m, now) = live();
        let mut l = ReplayLedger::default();
        let mut bad = sign(task());
        bad.signature = SigningKey::from_bytes(&[99; 32])
            .sign(&task().canonical_bytes())
            .to_bytes();
        assert_eq!(
            attempt(&m, now, &bad, fresh(), &mut l),
            Err(Denial::InvalidSignature)
        );
        let mut tampered = sign(task());
        tampered.task.action = Action::GitStatusShort;
        assert_eq!(
            attempt(&m, now, &tampered, fresh(), &mut l),
            Err(Denial::InvalidSignature)
        );
    }
    #[test]
    fn different_owner_or_peer_or_local_device_never_dispatches() {
        let (m, now) = live();
        for variant in 0..3 {
            let mut p = task();
            match variant {
                0 => p.owner_id = [9; 16],
                1 => p.peer_device_public_key = [9; 32],
                _ => p.local_device_public_key = [9; 32],
            }
            let mut l = ReplayLedger::default();
            assert_eq!(
                attempt(&m, now, &sign(p), fresh(), &mut l),
                Err(Denial::WrongBoundPeer)
            );
        }
    }
    #[test]
    fn closed_or_expired_mesh_lease_cannot_dispatch_even_with_signed_grant() {
        let (m, now) = live();
        let mut l = ReplayLedger::default();
        assert_eq!(
            attempt(
                &m,
                now + Duration::from_secs(30),
                &sign(task()),
                fresh(),
                &mut l
            ),
            Err(Denial::ClosedLease)
        );
        let (mut m, now) = live();
        m.socket_closed();
        assert_eq!(
            attempt(&m, now, &sign(task()), fresh(), &mut l),
            Err(Denial::ClosedLease)
        );
        let (m, t) = live();
        let mut l = ReplayLedger::default();
        assert_eq!(
            attempt(&m, t, &sign(task()), fresh(), &mut l)
                .unwrap()
                .execution_authorized,
            false
        );
    }
    #[test]
    fn stale_or_revoked_owner_authority_fails_even_if_signature_is_valid() {
        let (m, now) = live();
        for auth in [
            RevocationRecheck {
                owner_session_active: false,
                ..fresh()
            },
            RevocationRecheck {
                client_device_project_grant_active: false,
                ..fresh()
            },
            RevocationRecheck {
                checked_at_ms: WALL - 6_000,
                ..fresh()
            },
            RevocationRecheck {
                checked_at_ms: WALL + 1,
                ..fresh()
            },
        ] {
            let mut l = ReplayLedger::default();
            assert_eq!(
                attempt(&m, now, &sign(task()), auth, &mut l),
                Err(Denial::StaleAuthority)
            );
        }
    }
    #[test]
    fn permit_expiry_future_issuance_malformed_head_or_stale_step_up_fail() {
        let (m, now) = live();
        for variant in 0..7 {
            let mut p = task();
            match variant {
                0 => p.expires_at_ms = WALL - 1,
                1 => p.issued_at_ms = WALL + 1,
                2 => p.issued_at_ms = WALL - 40_000,
                3 => p.expires_at_ms = WALL + 100_000,
                4 => p.owner_step_up_at_ms = WALL - 200_000,
                5 => p.expected_head = [0; 32],
                _ => p.project_id = [0; 16],
            }
            let mut l = ReplayLedger::default();
            assert_eq!(
                attempt(&m, now, &sign(p), fresh(), &mut l),
                Err(Denial::MalformedPermit)
            );
        }
    }
    #[test]
    fn refreshed_grant_must_match_exact_session_client_project() {
        let (m, now) = live();
        for i in 0..4 {
            let mut a = fresh();
            match i {
                0 => a.owner_session_id = [50; 16],
                1 => a.client_id = [60; 16],
                2 => a.project_id = [70; 16],
                _ => a.tenant_id = [80; 16],
            }
            let mut ledger = ReplayLedger::default();
            assert_eq!(
                attempt(&m, now, &sign(task()), a, &mut ledger),
                Err(Denial::StaleAuthority)
            );
        }
    }
    #[test]
    fn duplicate_task_id_or_nonce_is_denied_within_single_session() {
        let (m, now) = live();
        let mut l = ReplayLedger::default();
        assert!(attempt(&m, now, &sign(task()), fresh(), &mut l).is_ok());
        assert_eq!(
            attempt(&m, now, &sign(task()), fresh(), &mut l),
            Err(Denial::Replay)
        );
        let mut new_task = task();
        new_task.nonce = [99; 16];
        assert_eq!(
            attempt(&m, now, &sign(new_task), fresh(), &mut l),
            Err(Denial::Replay)
        );
        let mut other_task = task();
        other_task.task_id = [88; 16];
        assert_eq!(
            attempt(&m, now, &sign(other_task), fresh(), &mut l),
            Err(Denial::Replay)
        );
    }
    #[test]
    fn required_fresh_heartbeat_is_not_inferred_from_tls_alone() {
        let t = Instant::now();
        let binding = ChannelBinding {
            owner_id: [1; 16],
            local_ed25519: [2; 32],
            peer_ed25519: [3; 32],
            tls_session_nonce: [8; 32],
        };
        let mut m = MeshLeaseMachine::default();
        assert!(m.locally_approved());
        assert!(m.begin_verification());
        assert!(m.on_still_open_tls_socket(ValidatedOpenTlsSocket { binding }, t));
        let mut l = ReplayLedger::default();
        assert_eq!(
            attempt(&m, t, &sign(task()), fresh(), &mut l),
            Err(Denial::ClosedLease)
        );
    }
    #[test]
    fn signed_readonly_git_status_is_separate_exact_action() {
        let (m, now) = live();
        let mut p = task();
        p.action = Action::GitStatusShort;
        let mut ledger = ReplayLedger::default();
        assert_eq!(
            attempt(&m, now, &sign(p), fresh(), &mut ledger)
                .unwrap()
                .action,
            Action::GitStatusShort
        );
    }
    #[test]
    fn canonical_signed_payload_has_domain_and_fixed_length() {
        let mut p = task();
        assert!(p.canonical_bytes().starts_with(DOMAIN));
        assert_eq!(
            p.canonical_bytes().len(),
            DOMAIN.len() + 7 * 16 + 2 * 32 + 32 + 2 + 3 * 8
        );
        p.expected_head_len = 20;
        p.expected_head = [0; 32];
        p.expected_head[..20].fill(7);
        assert!(p.valid(WALL));
        let v = p.canonical_bytes();
        p.project_id = [33; 16];
        assert_ne!(v, p.canonical_bytes());
    }
}
