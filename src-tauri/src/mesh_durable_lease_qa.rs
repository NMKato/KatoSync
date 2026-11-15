// Created by NMKato Solutions
//! Stage4AB.1: purely local, monotonic, fail-closed peer-session lease logic.
//!
//! This module has no sockets, CLI, Tauri IPC, persistence, background work,
//! remote commands, or Keychain/DB writes. The *cloud device-presence* receipt
//! and the Stage4AA *closed one-shot* mTLS probe must NEVER issue a lease.
//! A future, separately reviewed Stage4AB.2 supervisor must own a CURRENT,
//! OPEN, pinned mutual-TLS stream before it can mint ValidatedOpenTlsSocket.
//! None of those constructors or a production caller exists in Stage4AB.1.

use serde::Serialize;
use std::time::{Duration, Instant};

const HEARTBEAT_LEASE: Duration = Duration::from_secs(25);
const MAX_SESSION_AGE: Duration = Duration::from_secs(300);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum MeshLinkState {
    NotPaired,
    LocallyPaired,
    Verifying,
    ConnectedAuthenticated,
    Reconnecting,
    Unreachable,
    Revoked,
}

/// Internal, non-exported channel binding. Raw account/device identifiers and
/// public key digests are never included in serializable snapshots or logs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ChannelBinding {
    owner_id: [u8; 16],
    local_ed25519: [u8; 32],
    peer_ed25519: [u8; 32],
    tls_session_nonce: [u8; 32],
}

impl ChannelBinding {
    fn valid(&self) -> bool {
        self.owner_id.iter().any(|b| *b != 0)
            && self.local_ed25519.iter().any(|b| *b != 0)
            && self.peer_ed25519.iter().any(|b| *b != 0)
            && self.local_ed25519 != self.peer_ed25519
            && self.tls_session_nonce.iter().any(|b| *b != 0)
    }
}

/// SEALED: no constructor outside this private module, and deliberately
/// not instantiated in non-test code until Stage4AB.2's live TLS supervisor
/// passes independent owner, pin, enrollment and open-channel revalidation.
struct ValidatedOpenTlsSocket {
    binding: ChannelBinding,
}

/// SEALED: stage4AB.2 will accept this type only from an authenticated
/// heartbeat frame read on the *same* still-open mutual TLS stream.
struct VerifiedInChannelHeartbeat {
    binding: ChannelBinding,
    sequence: u64,
}

#[derive(Clone, Copy, Debug)]
struct Session {
    binding: ChannelBinding,
    opened_at: Instant,
    last_heartbeat_at: Instant,
    deadline: Instant,
    last_sequence: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct MeshLinkSnapshot {
    state: MeshLinkState,
    live_peer_authenticated: bool,
    channel_still_active: bool,
    remote_read_only_dispatch: bool,
    remote_jobs_enabled: bool,
    cross_device_writes: bool,
}

struct MeshLeaseMachine {
    state: MeshLinkState,
    session: Option<Session>,
}

impl Default for MeshLeaseMachine {
    fn default() -> Self {
        Self {
            state: MeshLinkState::NotPaired,
            session: None,
        }
    }
}

impl MeshLeaseMachine {
    fn locally_approved(&mut self) -> bool {
        if self.state != MeshLinkState::NotPaired {
            return false;
        }
        self.state = MeshLinkState::LocallyPaired;
        true
    }

    fn begin_verification(&mut self) -> bool {
        if !matches!(
            self.state,
            MeshLinkState::LocallyPaired | MeshLinkState::Reconnecting
        ) {
            return false;
        }
        self.session = None;
        self.state = MeshLinkState::Verifying;
        true
    }

    // Stage4AA's successful one-shot result is intentionally not accepted
    // here: the socket had already closed. This transition remains uncalled
    // by the runtime in Stage4AB.1.
    fn on_still_open_tls_socket(&mut self, proof: ValidatedOpenTlsSocket, now: Instant) -> bool {
        if self.state != MeshLinkState::Verifying || !proof.binding.valid() {
            return false;
        }
        self.session = Some(Session {
            binding: proof.binding,
            opened_at: now,
            last_heartbeat_at: now,
            deadline: now + HEARTBEAT_LEASE,
            last_sequence: 0,
        });
        self.state = MeshLinkState::ConnectedAuthenticated;
        true
    }

    /// A cloud presence or unauthenticated heartbeat has no matching sealed
    /// proof type; forged bindings, replayed sequence numbers and stale leases
    /// never refresh authentication.
    fn on_verified_channel_heartbeat(
        &mut self,
        receipt: VerifiedInChannelHeartbeat,
        now: Instant,
    ) -> bool {
        if self.state != MeshLinkState::ConnectedAuthenticated {
            return false;
        }
        let Some(session) = self.session.as_mut() else {
            self.state = MeshLinkState::Unreachable;
            return false;
        };
        if now < session.last_heartbeat_at
            || now >= session.deadline
            || now >= session.opened_at + MAX_SESSION_AGE
        {
            self.drop_channel(MeshLinkState::Reconnecting);
            return false;
        }
        if receipt.binding != session.binding || receipt.sequence <= session.last_sequence {
            // A mismatch on an authenticated stream is a fatal security event,
            // not a retryable heartbeat.
            self.drop_channel(MeshLinkState::Unreachable);
            return false;
        }
        session.last_heartbeat_at = now;
        session.last_sequence = receipt.sequence;
        session.deadline = (now + HEARTBEAT_LEASE).min(session.opened_at + MAX_SESSION_AGE);
        true
    }

    fn tick(&mut self, now: Instant) {
        if self.state == MeshLinkState::ConnectedAuthenticated {
            let still_valid = self
                .session
                .is_some_and(|s| now < s.deadline && now < s.opened_at + MAX_SESSION_AGE);
            if !still_valid {
                self.drop_channel(MeshLinkState::Reconnecting);
            }
        }
    }

    fn socket_closed(&mut self) {
        if matches!(
            self.state,
            MeshLinkState::Verifying | MeshLinkState::ConnectedAuthenticated
        ) {
            self.drop_channel(MeshLinkState::Reconnecting);
        }
    }

    fn network_lost(&mut self) {
        if matches!(
            self.state,
            MeshLinkState::Verifying | MeshLinkState::ConnectedAuthenticated
        ) {
            self.drop_channel(MeshLinkState::Reconnecting);
        }
    }

    fn sleep_or_wake(&mut self) {
        if self.state != MeshLinkState::Revoked {
            self.drop_channel(MeshLinkState::Unreachable);
        }
    }

    fn revoked_or_owner_changed(&mut self) {
        self.drop_channel(MeshLinkState::Revoked);
    }

    fn drop_channel(&mut self, next: MeshLinkState) {
        self.session = None;
        self.state = next;
    }

    fn snapshot(&self, now: Instant) -> MeshLinkSnapshot {
        let live = self.state == MeshLinkState::ConnectedAuthenticated
            && self.session.is_some_and(|s| {
                now >= s.opened_at && now < s.deadline && now < s.opened_at + MAX_SESSION_AGE
            });
        // Even an authenticated transport CANNOT grant jobs. That requires
        // a separate owner-scoped RC65 capability and consent gate.
        MeshLinkSnapshot {
            state: if self.state == MeshLinkState::ConnectedAuthenticated && !live {
                MeshLinkState::Reconnecting
            } else {
                self.state
            },
            live_peer_authenticated: live,
            channel_still_active: live,
            remote_read_only_dispatch: false,
            remote_jobs_enabled: false,
            cross_device_writes: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding() -> ChannelBinding {
        ChannelBinding {
            owner_id: [1; 16],
            local_ed25519: [2; 32],
            peer_ed25519: [3; 32],
            tls_session_nonce: [4; 32],
        }
    }
    fn ready(now: Instant) -> MeshLeaseMachine {
        let mut machine = MeshLeaseMachine::default();
        assert!(machine.locally_approved());
        assert!(machine.begin_verification());
        assert!(
            machine.on_still_open_tls_socket(ValidatedOpenTlsSocket { binding: binding() }, now)
        );
        machine
    }
    fn heartbeat(sequence: u64) -> VerifiedInChannelHeartbeat {
        VerifiedInChannelHeartbeat {
            binding: binding(),
            sequence,
        }
    }

    #[test]
    fn a_local_pin_or_stage4aa_closed_one_shot_never_implies_online_mesh() {
        let now = Instant::now();
        let mut machine = MeshLeaseMachine::default();
        assert_eq!(machine.snapshot(now).state, MeshLinkState::NotPaired);
        assert!(machine.locally_approved());
        assert!(!machine.snapshot(now).live_peer_authenticated);
        assert!(machine.begin_verification());
        assert!(!machine.snapshot(now).channel_still_active);
        assert!(!machine.snapshot(now).remote_jobs_enabled);
    }

    #[test]
    fn sealed_live_tls_proof_issues_short_lease_without_remote_rights() {
        let now = Instant::now();
        let machine = ready(now);
        let receipt = machine.snapshot(now);
        assert_eq!(receipt.state, MeshLinkState::ConnectedAuthenticated);
        assert!(receipt.live_peer_authenticated);
        assert!(receipt.channel_still_active);
        assert!(!receipt.remote_read_only_dispatch);
        assert!(!receipt.remote_jobs_enabled);
        assert!(!receipt.cross_device_writes);
    }

    #[test]
    fn expired_heartbeat_lease_disappears_without_polling_or_ui_updates() {
        let now = Instant::now();
        let mut machine = ready(now);
        let future = now + HEARTBEAT_LEASE;
        // Snapshot is fail-closed even when tick() was not scheduled.
        assert!(!machine.snapshot(future).live_peer_authenticated);
        assert_eq!(machine.snapshot(future).state, MeshLinkState::Reconnecting);
        assert!(!machine.on_verified_channel_heartbeat(heartbeat(1), future));
        machine.tick(future);
        assert!(machine.session.is_none());
    }

    #[test]
    fn only_monotonic_in_channel_heartbeat_of_same_bound_identity_renews() {
        let now = Instant::now();
        let mut machine = ready(now);
        assert!(machine.on_verified_channel_heartbeat(heartbeat(1), now + Duration::from_secs(10)));
        let new_deadline = now + Duration::from_secs(35);
        assert!(
            machine
                .snapshot(new_deadline - Duration::from_millis(1))
                .live_peer_authenticated
        );
        assert!(!machine.on_verified_channel_heartbeat(heartbeat(2), new_deadline));
        assert!(!machine.snapshot(new_deadline).live_peer_authenticated);
    }

    #[test]
    fn replayed_heartbeat_is_fatal_and_clears_authentication() {
        let now = Instant::now();
        let mut machine = ready(now);
        assert!(machine.on_verified_channel_heartbeat(heartbeat(1), now + Duration::from_secs(1)));
        assert!(!machine.on_verified_channel_heartbeat(heartbeat(1), now + Duration::from_secs(2)));
        assert_eq!(machine.state, MeshLinkState::Unreachable);
        assert!(machine.session.is_none());
    }

    #[test]
    fn wrong_peer_or_owner_channel_binding_fails_closed() {
        let now = Instant::now();
        let mut machine = ready(now);
        let mut wrong = heartbeat(1);
        wrong.binding.owner_id = [8; 16];
        assert!(!machine.on_verified_channel_heartbeat(wrong, now + Duration::from_secs(1)));
        assert_eq!(machine.state, MeshLinkState::Unreachable);
        assert!(machine.session.is_none());
        let mut machine = ready(now);
        let mut wrong = heartbeat(1);
        wrong.binding.peer_ed25519 = [9; 32];
        assert!(!machine.on_verified_channel_heartbeat(wrong, now + Duration::from_secs(1)));
        assert!(machine.session.is_none());
    }

    #[test]
    fn sleep_wake_and_socket_closure_never_leave_a_connected_session() {
        let now = Instant::now();
        let mut a = ready(now);
        a.sleep_or_wake();
        assert_eq!(a.state, MeshLinkState::Unreachable);
        assert!(!a.snapshot(now).live_peer_authenticated);
        let mut b = ready(now);
        b.socket_closed();
        assert_eq!(b.state, MeshLinkState::Reconnecting);
        assert!(b.session.is_none());
        let mut c = ready(now);
        c.network_lost();
        assert_eq!(c.state, MeshLinkState::Reconnecting);
        assert!(c.session.is_none());
    }

    #[test]
    fn revocation_and_owner_swap_are_terminal_until_explicit_new_consent() {
        let now = Instant::now();
        let mut machine = ready(now);
        machine.revoked_or_owner_changed();
        assert_eq!(machine.state, MeshLinkState::Revoked);
        assert!(machine.session.is_none());
        assert!(!machine.begin_verification());
        assert!(!machine.locally_approved());
        machine.sleep_or_wake();
        assert_eq!(machine.state, MeshLinkState::Revoked);
        assert!(
            !machine.on_still_open_tls_socket(ValidatedOpenTlsSocket { binding: binding() }, now)
        );
    }

    #[test]
    fn invalid_zero_self_or_duplicate_key_proofs_never_connect() {
        let now = Instant::now();
        for variant in 0..4 {
            let mut invalid = binding();
            match variant {
                0 => invalid.owner_id = [0; 16],
                1 => invalid.local_ed25519 = [0; 32],
                2 => invalid.peer_ed25519 = invalid.local_ed25519,
                _ => invalid.tls_session_nonce = [0; 32],
            }
            let mut machine = MeshLeaseMachine::default();
            assert!(machine.locally_approved());
            assert!(machine.begin_verification());
            assert!(
                !machine.on_still_open_tls_socket(ValidatedOpenTlsSocket { binding: invalid }, now)
            );
            assert!(!machine.snapshot(now).live_peer_authenticated);
        }
    }

    #[test]
    fn renewal_can_never_extend_beyond_absolute_session_maximum() {
        let now = Instant::now();
        let mut machine = ready(now);
        for second in (10..300).step_by(10) {
            assert!(
                machine.on_verified_channel_heartbeat(
                    heartbeat(second as u64),
                    now + Duration::from_secs(second)
                ),
                "second={second}"
            );
        }
        assert_eq!(
            machine.snapshot(now + MAX_SESSION_AGE).state,
            MeshLinkState::Reconnecting
        );
        assert!(
            !machine
                .snapshot(now + MAX_SESSION_AGE)
                .live_peer_authenticated
        );
    }

    #[test]
    fn connected_state_cannot_be_obtained_by_improper_transitions() {
        let now = Instant::now();
        let mut machine = MeshLeaseMachine::default();
        assert!(!machine.begin_verification());
        assert!(
            !machine.on_still_open_tls_socket(ValidatedOpenTlsSocket { binding: binding() }, now)
        );
        assert!(!machine.on_verified_channel_heartbeat(heartbeat(1), now));
        assert_eq!(machine.state, MeshLinkState::NotPaired);
    }
}
