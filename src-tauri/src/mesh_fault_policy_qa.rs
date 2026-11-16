// Created by NMKato Solutions
//! Stage4AB.3.2B – QA-only, deterministic negative fault-policy model.
//!
//! This is a MODEL and a test surface, not runtime authorization evidence.
//! A future native supervisor must verify the real owner session, local pin,
//! both enrolled devices, TLS peer certificate, nonces and consent itself.
//! No network adapter control, Keychain/DB mutations, IPC, CLI or remote jobs.

use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TransportFault {
    NetworkLost,
    SleepOrWake,
    PeerRevoked,
    OwnerChanged,
    CertificateOrPinMismatch,
    HeartbeatReplay,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SimulatedRevalidation {
    pub owner_session_current: bool,
    pub exact_local_keychain_pin_current: bool,
    pub both_enrollments_current: bool,
    pub user_consent_current: bool,
    pub network_reachable: bool,
}

impl SimulatedRevalidation {
    fn all_current(self) -> bool {
        self.owner_session_current
            && self.exact_local_keychain_pin_current
            && self.both_enrollments_current
            && self.user_consent_current
            && self.network_reachable
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AttemptDecision {
    AttemptNewFullTlsAfter(Duration),
    StopSecurityEvent,
    StopNoValidRevalidation,
    StopBudgetExceeded,
}

/// Pure QA policy: a possible attempt is NOT proof of a connected peer.
/// No automatic daemon, attempt launcher, privileged OS call or socket here.
/// In particular, a revoke may never be reclassified as transient packet loss.
pub(crate) fn classify_attempt(
    fault: TransportFault,
    check: SimulatedRevalidation,
    failures: u8,
    budget_remaining: Duration,
) -> AttemptDecision {
    if !matches!(
        fault,
        TransportFault::NetworkLost | TransportFault::SleepOrWake
    ) {
        return AttemptDecision::StopSecurityEvent;
    }
    if !check.all_current() {
        return AttemptDecision::StopNoValidRevalidation;
    }
    let delay = match failures {
        0 => Duration::from_secs(2),
        1 => Duration::from_secs(4),
        2 => Duration::from_secs(8),
        _ => return AttemptDecision::StopBudgetExceeded,
    };
    if budget_remaining <= delay {
        return AttemptDecision::StopBudgetExceeded;
    }
    AttemptDecision::AttemptNewFullTlsAfter(delay)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SimulatedFreshTlsProof {
    pub mutually_pinned_tls13: bool,
    pub owner_and_keychain_rechecked: bool,
    pub both_enrollments_rechecked: bool,
    pub current_consent_rechecked: bool,
    pub verified_in_channel_heartbeat: bool,
}

/// A second separate QA check: never let the previous authenticated TLS
/// session, nonce or an inventory/overlay presence marker act as new proof.
pub(crate) fn new_session_may_be_reported_authenticated(
    previous_session_nonce: [u8; 32],
    candidate_session_nonce: [u8; 32],
    candidate: SimulatedFreshTlsProof,
) -> bool {
    previous_session_nonce.iter().any(|x| *x != 0)
        && candidate_session_nonce.iter().any(|x| *x != 0)
        && previous_session_nonce != candidate_session_nonce
        && candidate.mutually_pinned_tls13
        && candidate.owner_and_keychain_rechecked
        && candidate.both_enrollments_rechecked
        && candidate.current_consent_rechecked
        && candidate.verified_in_channel_heartbeat
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh_durable_lease_qa::LiveTlsLease;
    use std::time::Instant;

    fn valid() -> SimulatedRevalidation {
        SimulatedRevalidation {
            owner_session_current: true,
            exact_local_keychain_pin_current: true,
            both_enrollments_current: true,
            user_consent_current: true,
            network_reachable: true,
        }
    }

    fn fresh() -> SimulatedFreshTlsProof {
        SimulatedFreshTlsProof {
            mutually_pinned_tls13: true,
            owner_and_keychain_rechecked: true,
            both_enrollments_rechecked: true,
            current_consent_rechecked: true,
            verified_in_channel_heartbeat: true,
        }
    }

    fn lease(now: Instant) -> LiveTlsLease {
        LiveTlsLease::after_verified_open_channel([1; 16], [2; 32], [3; 32], [4; 32], now)
            .expect("synthetic QA lease")
    }

    #[test]
    fn actual_lease_drops_live_state_immediately_on_each_fault_class() {
        let now = Instant::now();
        let mut link = lease(now);
        assert!(link.is_live(now));
        link.on_network_loss();
        assert!(!link.is_live(now));
        assert!(!link.is_live(now + Duration::from_secs(1)));

        let mut link = lease(now);
        assert!(link.is_live(now));
        link.on_sleep_or_wake();
        assert!(!link.is_live(now));
        assert!(!link.is_live(now + Duration::from_secs(1)));

        let mut link = lease(now);
        assert!(link.is_live(now));
        link.on_owner_or_peer_revoked();
        assert!(!link.is_live(now));
        assert!(!link.is_live(now + Duration::from_secs(1)));
    }

    #[test]
    fn no_revoked_owner_changed_mismatch_or_replay_event_can_retry() {
        for fault in [
            TransportFault::PeerRevoked,
            TransportFault::OwnerChanged,
            TransportFault::CertificateOrPinMismatch,
            TransportFault::HeartbeatReplay,
            TransportFault::Unknown,
        ] {
            assert_eq!(
                classify_attempt(fault, valid(), 0, Duration::from_secs(100)),
                AttemptDecision::StopSecurityEvent,
                "{fault:?}"
            );
        }
    }

    #[test]
    fn incomplete_revalidation_never_permits_reconnect() {
        for fault in [TransportFault::NetworkLost, TransportFault::SleepOrWake] {
            for missing in 0..5 {
                let mut evidence = valid();
                match missing {
                    0 => evidence.owner_session_current = false,
                    1 => evidence.exact_local_keychain_pin_current = false,
                    2 => evidence.both_enrollments_current = false,
                    3 => evidence.user_consent_current = false,
                    _ => evidence.network_reachable = false,
                }
                assert_eq!(
                    classify_attempt(fault, evidence, 0, Duration::from_secs(100)),
                    AttemptDecision::StopNoValidRevalidation,
                );
            }
        }
    }

    #[test]
    fn bounded_reconnect_attempts_are_not_a_background_loop() {
        for fault in [TransportFault::NetworkLost, TransportFault::SleepOrWake] {
            for (attempt, seconds) in [(0, 2), (1, 4), (2, 8)] {
                assert_eq!(
                    classify_attempt(fault, valid(), attempt, Duration::from_secs(100)),
                    AttemptDecision::AttemptNewFullTlsAfter(Duration::from_secs(seconds)),
                );
                assert_eq!(
                    classify_attempt(fault, valid(), attempt, Duration::from_secs(seconds)),
                    AttemptDecision::StopBudgetExceeded,
                );
            }
            assert_eq!(
                classify_attempt(fault, valid(), 3, Duration::from_secs(100)),
                AttemptDecision::StopBudgetExceeded,
            );
        }
    }

    #[test]
    fn only_fully_revalidated_new_nonce_and_tls_proof_may_claim_authenticated() {
        let previous = [10; 32];
        let next = [11; 32];
        assert!(new_session_may_be_reported_authenticated(
            previous,
            next,
            fresh()
        ));
        assert!(!new_session_may_be_reported_authenticated(
            previous,
            previous,
            fresh()
        ));
        assert!(!new_session_may_be_reported_authenticated(
            [0; 32],
            next,
            fresh()
        ));
        assert!(!new_session_may_be_reported_authenticated(
            previous,
            [0; 32],
            fresh()
        ));
        for missing in 0..5 {
            let mut proof = fresh();
            match missing {
                0 => proof.mutually_pinned_tls13 = false,
                1 => proof.owner_and_keychain_rechecked = false,
                2 => proof.both_enrollments_rechecked = false,
                3 => proof.current_consent_rechecked = false,
                _ => proof.verified_in_channel_heartbeat = false,
            }
            assert!(!new_session_may_be_reported_authenticated(
                previous, next, proof
            ));
        }
    }
}
