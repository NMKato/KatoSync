//! Stage4AF native module smoke harness against REAL Git and REAL Ed25519.
//! Only the canonical transport lease is synthetic here; this harness does
//! NOT prove an open two-site TLS channel, live RC66 grant or owner approval.
#![allow(dead_code)]
pub(crate) mod mesh_durable_lease_qa {
    use std::time::{Duration, Instant};

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(crate) struct ChannelBinding {
        pub(crate) owner_id: [u8; 16],
        pub(crate) local_ed25519: [u8; 32],
        pub(crate) peer_ed25519: [u8; 32],
        pub(crate) tls_session_nonce: [u8; 32],
    }
    pub(crate) struct ValidatedOpenTlsSocket {
        pub(crate) binding: ChannelBinding,
    }
    pub(crate) struct VerifiedInChannelHeartbeat {
        pub(crate) binding: ChannelBinding,
        pub(crate) sequence: u64,
    }
    pub(crate) struct LeaseSnapshot {
        pub(crate) live_peer_authenticated: bool,
    }
    pub(crate) struct SyntheticSession {
        pub(crate) binding: ChannelBinding,
        pub(crate) last_sequence: u64,
        pub(crate) last_beat: Instant,
    }
    #[derive(Default)]
    pub(crate) struct MeshLeaseMachine {
        pub(crate) session: Option<SyntheticSession>,
        approved: bool,
        verifying: bool,
    }
    impl MeshLeaseMachine {
        pub(crate) fn locally_approved(&mut self) -> bool {
            self.approved = true;
            true
        }
        pub(crate) fn begin_verification(&mut self) -> bool {
            if !self.approved {
                return false;
            }
            self.verifying = true;
            true
        }
        pub(crate) fn on_still_open_tls_socket(
            &mut self,
            s: ValidatedOpenTlsSocket,
            now: Instant,
        ) -> bool {
            if !self.verifying {
                return false;
            }
            self.session = Some(SyntheticSession {
                binding: s.binding,
                last_sequence: 0,
                last_beat: now,
            });
            true
        }
        pub(crate) fn on_verified_channel_heartbeat(
            &mut self,
            h: VerifiedInChannelHeartbeat,
            now: Instant,
        ) -> bool {
            let Some(s) = self.session.as_mut() else {
                return false;
            };
            if s.binding != h.binding || h.sequence <= s.last_sequence {
                return false;
            }
            s.last_sequence = h.sequence;
            s.last_beat = now;
            true
        }
        pub(crate) fn socket_closed(&mut self) {
            self.session = None
        }
        pub(crate) fn snapshot(&self, now: Instant) -> LeaseSnapshot {
            LeaseSnapshot {
                live_peer_authenticated: self.session.as_ref().is_some_and(|s| {
                    s.last_sequence > 0
                        && now.saturating_duration_since(s.last_beat) < Duration::from_secs(10)
                }),
            }
        }
    }
    #[path = "../../../../../src-tauri/src/mesh_durable_lease_qa/signed_job_qa.rs"]
    mod signed_job_qa;
}
