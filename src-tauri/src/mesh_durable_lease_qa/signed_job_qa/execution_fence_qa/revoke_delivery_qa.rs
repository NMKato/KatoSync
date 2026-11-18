// NMKato Solutions — Stage4AH test-only signed revocation delivery.
// This is a PRIVATE synthetic native contract, NOT RC66K wire compatibility.
// No production listener, no owner-device access or public Tauri command.
use super::super::{Action, SignedTask};
use super::{Denial, QaLocalRevocationGate};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

const DOMAIN: &[u8] = b"KatoSync-Stage4AH-private-revoke-QA-v1";
const MAX_EVENT_AGE_MS: u64 = 30_000;

#[derive(Clone, Debug)]
struct QaSignedRevokeNotice {
    owner_id: [u8; 16],
    tenant_id: [u8; 16],
    owner_session_id: [u8; 16],
    client_id: [u8; 16],
    local_device_key: [u8; 32],
    peer_device_key: [u8; 32],
    project_id: [u8; 16],
    task_id: [u8; 16],
    event_id: [u8; 16],
    sequence: u64,
    issued_at_ms: u64,
    expires_at_ms: u64,
    signature: [u8; 64],
}

impl QaSignedRevokeNotice {
    fn canonical_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(300);
        out.extend_from_slice(DOMAIN);
        for item in [
            self.owner_id,
            self.tenant_id,
            self.owner_session_id,
            self.client_id,
            self.project_id,
            self.task_id,
            self.event_id,
        ] {
            out.extend_from_slice(&item);
        }
        out.extend_from_slice(&self.local_device_key);
        out.extend_from_slice(&self.peer_device_key);
        for n in [self.sequence, self.issued_at_ms, self.expires_at_ms] {
            out.extend_from_slice(&n.to_be_bytes());
        }
        out
    }
}

#[derive(Debug, PartialEq, Eq)]
enum QaDeliveryDenial {
    BadPermit,
    BadSignature,
    WrongScope,
    StaleOrMalformed,
    ReplayOrClosed,
}

// The signer keys are supplied by the TRUSTED local QA fixture; neither
// key may be taken from the notice or a model/tool request in production.
// A revoke is accepted even if the Mesh socket is offline: revocation must
// not require a currently functioning command channel.
fn accept_pinned_signed_revoke(
    notice: &QaSignedRevokeNotice,
    signed_task: &SignedTask,
    pinned_permit_issuer: &VerifyingKey,
    pinned_control_plane: &VerifyingKey,
    local_revoke: &QaLocalRevocationGate,
    now_ms: u64,
) -> Result<(), QaDeliveryDenial> {
    pinned_permit_issuer
        .verify(
            &signed_task.task.canonical_bytes(),
            &Signature::from_bytes(&signed_task.signature),
        )
        .map_err(|_| QaDeliveryDenial::BadPermit)?;
    pinned_control_plane
        .verify(
            &notice.canonical_bytes(),
            &Signature::from_bytes(&notice.signature),
        )
        .map_err(|_| QaDeliveryDenial::BadSignature)?;
    let task = &signed_task.task;
    if notice.owner_id != task.owner_id
        || notice.tenant_id != task.tenant_id
        || notice.owner_session_id != task.owner_session_id
        || notice.client_id != task.client_id
        || notice.local_device_key != task.local_device_public_key
        || notice.peer_device_key != task.peer_device_public_key
        || notice.project_id != task.project_id
        || notice.task_id != task.task_id
        || task.action != Action::GitHead
    {
        return Err(QaDeliveryDenial::WrongScope);
    }
    if notice.event_id.iter().all(|v| *v == 0)
        || notice.sequence == 0
        || notice.issued_at_ms > now_ms
        || notice.expires_at_ms <= now_ms
        || notice.expires_at_ms <= notice.issued_at_ms
        || notice.expires_at_ms - notice.issued_at_ms > MAX_EVENT_AGE_MS
        || now_ms.saturating_sub(notice.issued_at_ms) > MAX_EVENT_AGE_MS
    {
        return Err(QaDeliveryDenial::StaleOrMalformed);
    }
    local_revoke
        .apply_signed_server_revocation(notice.sequence)
        .map_err(|_| QaDeliveryDenial::ReplayOrClosed)
}

#[cfg(test)]
#[path = "revoke_delivery_qa/durable_qa.rs"]
mod durable_qa;

#[cfg(test)]
pub(super) mod tests {
    use super::super::super::{ReadOnlyTask, SignedTask};
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::{
        process::{Command, Stdio},
        sync::Arc,
        thread,
        time::{Duration, Instant},
    };

    pub(super) const T: u64 = 1_800_000_000_000;
    pub(super) fn permit_issuer() -> SigningKey {
        SigningKey::from_bytes(&[61; 32])
    }
    pub(super) fn control_signer() -> SigningKey {
        SigningKey::from_bytes(&[62; 32])
    }

    pub(super) fn permit() -> SignedTask {
        let task = ReadOnlyTask {
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
            issued_at_ms: T - 100,
            expires_at_ms: T + 10_000,
            owner_step_up_at_ms: T - 1000,
        };
        SignedTask {
            signature: permit_issuer().sign(&task.canonical_bytes()).to_bytes(),
            task,
        }
    }

    pub(super) fn signed_notice(p: &SignedTask, sequence: u64) -> QaSignedRevokeNotice {
        let t = &p.task;
        let mut notice = QaSignedRevokeNotice {
            owner_id: t.owner_id,
            tenant_id: t.tenant_id,
            owner_session_id: t.owner_session_id,
            client_id: t.client_id,
            local_device_key: t.local_device_public_key,
            peer_device_key: t.peer_device_public_key,
            project_id: t.project_id,
            task_id: t.task_id,
            event_id: [12; 16],
            sequence,
            issued_at_ms: T - 100,
            expires_at_ms: T + 8_000,
            signature: [0; 64],
        };
        notice.signature = control_signer().sign(&notice.canonical_bytes()).to_bytes();
        notice
    }

    fn accept(
        n: &QaSignedRevokeNotice,
        p: &SignedTask,
        gate: &QaLocalRevocationGate,
    ) -> Result<(), QaDeliveryDenial> {
        accept_pinned_signed_revoke(
            n,
            p,
            &permit_issuer().verifying_key(),
            &control_signer().verifying_key(),
            gate,
            T,
        )
    }

    #[test]
    fn signed_server_notice_revokes_exact_scoped_task_even_without_live_mesh_socket() {
        let task = permit();
        let gate = QaLocalRevocationGate::default();
        let generation = gate.snapshot().unwrap();
        assert_eq!(accept(&signed_notice(&task, 1), &task, &gate), Ok(()));
        assert_eq!(
            gate.require(generation),
            Err(Denial::RevokedDuringExecution)
        );
        assert_eq!(gate.snapshot(), Err(Denial::RevokedDuringExecution));
    }

    #[test]
    fn forged_control_plane_signature_and_unpinned_key_are_rejected() {
        let task = permit();
        let gate = QaLocalRevocationGate::default();
        let mut notice = signed_notice(&task, 1);
        notice.signature = SigningKey::from_bytes(&[77; 32])
            .sign(&notice.canonical_bytes())
            .to_bytes();
        assert_eq!(
            accept(&notice, &task, &gate),
            Err(QaDeliveryDenial::BadSignature)
        );
        let bad_key = SigningKey::from_bytes(&[88; 32]).verifying_key();
        assert_eq!(
            accept_pinned_signed_revoke(
                &signed_notice(&task, 1),
                &task,
                &permit_issuer().verifying_key(),
                &bad_key,
                &gate,
                T,
            ),
            Err(QaDeliveryDenial::BadSignature),
        );
        assert_eq!(gate.snapshot(), Ok(0));
    }

    #[test]
    fn wrong_owner_session_project_task_and_device_are_rejected() {
        let task = permit();
        let gate = QaLocalRevocationGate::default();
        for variant in 0..8 {
            let mut notice = signed_notice(&task, 1);
            match variant {
                0 => notice.owner_id = [99; 16],
                1 => notice.tenant_id = [99; 16],
                2 => notice.owner_session_id = [99; 16],
                3 => notice.client_id = [99; 16],
                4 => notice.project_id = [99; 16],
                5 => notice.task_id = [99; 16],
                6 => notice.local_device_key = [99; 32],
                _ => notice.peer_device_key = [99; 32],
            }
            notice.signature = control_signer().sign(&notice.canonical_bytes()).to_bytes();
            assert_eq!(
                accept(&notice, &task, &gate),
                Err(QaDeliveryDenial::WrongScope)
            );
        }
        assert_eq!(gate.snapshot(), Ok(0));
    }

    #[test]
    fn expired_future_and_malformed_events_cannot_assert_server_authority() {
        let task = permit();
        let gate = QaLocalRevocationGate::default();
        for variant in 0..5 {
            let mut n = signed_notice(&task, 1);
            match variant {
                0 => {
                    n.issued_at_ms = T + 1;
                    n.expires_at_ms = T + 10;
                }
                1 => {
                    n.expires_at_ms = T;
                }
                2 => {
                    n.issued_at_ms = T - 31_000;
                }
                3 => {
                    n.event_id = [0; 16];
                }
                _ => {
                    n.sequence = 0;
                }
            }
            n.signature = control_signer().sign(&n.canonical_bytes()).to_bytes();
            assert_eq!(
                accept(&n, &task, &gate),
                Err(QaDeliveryDenial::StaleOrMalformed)
            );
        }
        assert_eq!(gate.snapshot(), Ok(0));
    }

    #[test]
    fn tampered_original_job_signature_never_becomes_a_revoke_authority() {
        let mut task = permit();
        let notice = signed_notice(&task, 1);
        task.signature = [0; 64];
        let gate = QaLocalRevocationGate::default();
        assert_eq!(
            accept(&notice, &task, &gate),
            Err(QaDeliveryDenial::BadPermit)
        );
        assert_eq!(gate.snapshot(), Ok(0));
    }

    #[test]
    fn replayed_signed_delivery_is_denied_and_local_revoke_stays_sticky() {
        let task = permit();
        let gate = QaLocalRevocationGate::default();
        let notice = signed_notice(&task, 42);
        assert_eq!(accept(&notice, &task, &gate), Ok(()));
        assert_eq!(
            accept(&notice, &task, &gate),
            Err(QaDeliveryDenial::ReplayOrClosed)
        );
        assert_eq!(
            accept(&signed_notice(&task, 41), &task, &gate),
            Err(QaDeliveryDenial::ReplayOrClosed)
        );
        assert_eq!(gate.snapshot(), Err(Denial::RevokedDuringExecution));
    }

    #[cfg(unix)]
    #[test]
    fn in_flight_local_test_child_is_killed_after_verified_signed_revoke() {
        // This fixed sleep fixture is not Git, a shell or an owner workload.
        // It only proves that the local process watcher can cancel a child.
        let task = permit();
        let notice = signed_notice(&task, 1);
        let gate = Arc::new(QaLocalRevocationGate::default());
        let generation = gate.snapshot().unwrap();
        let child = Command::new("sleep")
            .arg("4")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let receiving_gate = Arc::clone(&gate);
        let delivery = thread::spawn(move || {
            thread::sleep(Duration::from_millis(70));
            accept(&notice, &task, &receiving_gate).unwrap();
        });
        let start = Instant::now();
        let result = super::super::qa_wait_with_revocation(child, &gate, generation);
        delivery.join().unwrap();
        assert_eq!(result.unwrap_err(), Denial::RevokedDuringExecution);
        assert!(start.elapsed() < Duration::from_secs(2));
        assert_eq!(gate.snapshot(), Err(Denial::RevokedDuringExecution));
    }
}
