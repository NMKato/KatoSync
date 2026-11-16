// Created by NMKato Solutions
//! Stage4AB.3.2B: QA-only conservative sleep/clock-gap guard on an open TLS lease.
//!
//! On macOS some monotonic clocks can pause during sleep; a short heartbeat
//! lease based solely on Instant is not an OS sleep/wake notification.
//! Compare an independent wall clock with monotonic elapsed time and FAIL
//! CLOSED on discontinuities. NTP changes may also disconnect conservatively.
//! The guard is NOT a production OS observer, wake event hook, or daemon.
//! No IPC, persistence, keys, network commands or remote-job permissions.

use crate::mesh_durable_lease_qa::LiveTlsLease;
use std::time::{Duration, Instant, SystemTime};

const MAX_CLOCK_DIVERGENCE: Duration = Duration::from_secs(2);
const FAIL_CLOSED: &str = "MESH_STAGE4AB32B_CLOCK_OR_SLEEP_GAP_DENIED";

pub(crate) struct ClockGapMonitor {
    previous_monotonic: Instant,
    previous_wall: SystemTime,
    poisoned: bool,
}

impl ClockGapMonitor {
    pub(crate) fn capture() -> Self {
        Self {
            previous_monotonic: Instant::now(),
            previous_wall: SystemTime::now(),
            poisoned: false,
        }
    }

    fn observe(&mut self, monotonic: Instant, wall: SystemTime) -> bool {
        if self.poisoned {
            return false;
        }
        let Some(mono_elapsed) = monotonic.checked_duration_since(self.previous_monotonic) else {
            self.poisoned = true;
            return false;
        };
        let Ok(wall_elapsed) = wall.duration_since(self.previous_wall) else {
            self.poisoned = true;
            return false;
        };
        // Both forward wall jumps (sleep, NTP correction) and backward
        // wall jumps (NTP/manual adjustment) deny reuse of an old lease.
        // Equal to the threshold also fails; this is a safety cutoff.
        if wall_elapsed.abs_diff(mono_elapsed) >= MAX_CLOCK_DIVERGENCE {
            self.poisoned = true;
            return false;
        }
        self.previous_monotonic = monotonic;
        self.previous_wall = wall;
        true
    }

    pub(crate) fn check_or_invalidate(
        &mut self,
        lease: &mut LiveTlsLease,
    ) -> Result<(), &'static str> {
        if !self.observe(Instant::now(), SystemTime::now()) {
            lease.on_sleep_or_wake();
            return Err(FAIL_CLOSED);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_lease(now: Instant) -> LiveTlsLease {
        LiveTlsLease::after_verified_open_channel(
            [1u8; 16],
            [2u8; 32],
            [3u8; 32],
            [4u8; 32],
            now,
        )
        .expect("synthetic test-only authenticated lease")
    }

    fn fixture(now: Instant, wall: SystemTime) -> ClockGapMonitor {
        ClockGapMonitor {
            previous_monotonic: now,
            previous_wall: wall,
            poisoned: false,
        }
    }

    #[test]
    fn equal_elapsed_clocks_remain_eligible_but_grant_no_remote_rights() {
        let start = Instant::now();
        let wall = SystemTime::UNIX_EPOCH + Duration::from_secs(123_000);
        let mut monitor = fixture(start, wall);
        assert!(monitor.observe(start + Duration::from_secs(5), wall + Duration::from_secs(5)));
        assert!(monitor.observe(start + Duration::from_secs(10), wall + Duration::from_secs(10)));
        let lease = new_lease(start);
        assert!(lease.is_live(start));
    }

    #[test]
    fn wall_advance_without_corresponding_monotonic_time_detects_sleep() {
        let start = Instant::now();
        let wall = SystemTime::UNIX_EPOCH + Duration::from_secs(123_000);
        let mut monitor = fixture(start, wall);
        assert!(!monitor.observe(start + Duration::from_secs(2), wall + Duration::from_secs(22)));
        assert!(monitor.poisoned);
        assert!(!monitor.observe(start + Duration::from_secs(25), wall + Duration::from_secs(25)));
    }

    #[test]
    fn threshold_and_backward_wall_adjustment_fail_closed() {
        let start = Instant::now();
        let wall = SystemTime::UNIX_EPOCH + Duration::from_secs(123_000);
        let mut exact = fixture(start, wall);
        assert!(!exact.observe(start + Duration::from_secs(5), wall + Duration::from_secs(7)));
        let mut rollback = fixture(start, wall);
        assert!(!rollback.observe(start + Duration::from_secs(1), wall - Duration::from_secs(1)));
        let mut monotonic_jump = fixture(start, wall);
        assert!(!monotonic_jump.observe(start + Duration::from_secs(8), wall + Duration::from_secs(2)));
    }

    #[test]
    fn jitter_below_cutoff_does_not_false_disconnect() {
        let start = Instant::now();
        let wall = SystemTime::UNIX_EPOCH + Duration::from_secs(123_000);
        let mut monitor = fixture(start, wall);
        assert!(monitor.observe(
            start + Duration::from_secs(5),
            wall + Duration::from_millis(5_400)
        ));
        assert!(monitor.observe(
            start + Duration::from_secs(10),
            wall + Duration::from_millis(10_050)
        ));
    }

    #[test]
    fn detected_discontinuity_clears_canonical_live_lease_and_is_sticky() {
        let start = Instant::now();
        let wall = SystemTime::UNIX_EPOCH + Duration::from_secs(123_000);
        let mut lease = new_lease(start);
        assert!(lease.is_live(start));
        let mut monitor = fixture(start, wall);
        assert!(!monitor.observe(start + Duration::from_secs(3), wall + Duration::from_secs(13)));
        // check_or_invalidate is the SAME runtime hook used in AB2 supervisor.
        assert_eq!(monitor.check_or_invalidate(&mut lease), Err(FAIL_CLOSED));
        assert!(!lease.is_live(Instant::now()));
        assert!(lease.verified_in_channel_heartbeat(1, Instant::now()).is_err());
        assert_eq!(monitor.check_or_invalidate(&mut lease), Err(FAIL_CLOSED));
    }

    #[test]
    fn backwards_monotonic_input_is_terminal_and_cannot_recover() {
        let start = Instant::now();
        let wall = SystemTime::UNIX_EPOCH + Duration::from_secs(123_000);
        let mut monitor = fixture(start + Duration::from_secs(10), wall);
        assert!(!monitor.observe(start, wall + Duration::from_secs(5)));
        assert!(monitor.poisoned);
        assert!(!monitor.observe(start + Duration::from_secs(11), wall + Duration::from_secs(11)));
    }
}
