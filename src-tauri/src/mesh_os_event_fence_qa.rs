// Created by NMKato Solutions
//! Stage4AB.3.2B: QA-only parser and fail-closed lease fence for passive
//! macOS event observation. A sidecar line NEVER authenticates a peer.
//! The Objective-C observer is bounded and not wired to the live supervisor.
//! No Tauri command, networking, Keychain, remote jobs, or enrollment writes.

use crate::mesh_durable_lease_qa::LiveTlsLease;

const FRAME_PREFIX: &str = "KATOSYNC_OS_QA_EVENT_V1:";
const DENIED: &str = "MESH_STAGE4AB32B_OS_OBSERVER_LEASE_DENIED";
const MALFORMED: &str = "MESH_STAGE4AB32B_OS_OBSERVER_FRAME_DENIED";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OsEvent {
    Observing,
    WifiPathAvailable,
    WifiPathLost,
    SleepBegin,
    Wake,
    Stopped,
}

fn parse_event(frame: &str) -> Result<OsEvent, &'static str> {
    if frame.len() > 80 || !frame.is_ascii() || frame.contains('\r') {
        return Err(MALFORMED);
    }
    let frame = frame.strip_suffix('\n').unwrap_or(frame);
    let Some(event) = frame.strip_prefix(FRAME_PREFIX) else {
        return Err(MALFORMED);
    };
    match event {
        "OBSERVING" => Ok(OsEvent::Observing),
        "WIFI_PATH_AVAILABLE" => Ok(OsEvent::WifiPathAvailable),
        "WIFI_PATH_LOST" => Ok(OsEvent::WifiPathLost),
        "SLEEP_BEGIN" => Ok(OsEvent::SleepBegin),
        "WAKE" => Ok(OsEvent::Wake),
        "STOPPED" => Ok(OsEvent::Stopped),
        _ => Err(MALFORMED),
    }
}

#[derive(Default)]
pub(crate) struct OsEventLeaseFence {
    sticky_invalid: bool,
}

impl OsEventLeaseFence {
    /// Only a CURRENT same-process pinned TLS lease can be invalidated here.
    /// A line is untrusted: false positives can deny a QA session; no line
    /// can construct TLS proof, issue a job, or authorize a reconnect.
    pub(crate) fn accept(
        &mut self,
        line: &str,
        lease: &mut LiveTlsLease,
    ) -> Result<(), &'static str> {
        let event = match parse_event(line) {
            Ok(event) => event,
            Err(error) => {
                self.sticky_invalid = true;
                lease.on_network_loss();
                return Err(error);
            }
        };
        match event {
            OsEvent::WifiPathLost | OsEvent::Stopped => {
                self.sticky_invalid = true;
                lease.on_network_loss();
            }
            OsEvent::SleepBegin | OsEvent::Wake => {
                self.sticky_invalid = true;
                lease.on_sleep_or_wake();
            }
            OsEvent::Observing | OsEvent::WifiPathAvailable => {}
        }
        if self.sticky_invalid {
            Err(DENIED)
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn live() -> LiveTlsLease {
        let now = Instant::now();
        let mut lease =
            LiveTlsLease::after_verified_open_channel([1; 16], [2; 32], [3; 32], [4; 32], now)
                .unwrap();
        lease.verified_in_channel_heartbeat(1, now).unwrap();
        assert!(lease.is_live(Instant::now()));
        lease
    }

    #[test]
    fn observer_ready_and_wifi_available_do_not_mint_authority() {
        let mut fence = OsEventLeaseFence::default();
        let mut lease = live();
        assert!(fence
            .accept("KATOSYNC_OS_QA_EVENT_V1:OBSERVING\n", &mut lease)
            .is_ok());
        assert!(fence
            .accept("KATOSYNC_OS_QA_EVENT_V1:WIFI_PATH_AVAILABLE", &mut lease)
            .is_ok());
        assert!(lease.is_live(Instant::now()));
        // Merely emitting readiness is NOT a separate authenticated proof.
    }

    #[test]
    fn wifi_path_loss_revokes_and_wifi_return_cannot_reenable() {
        let mut fence = OsEventLeaseFence::default();
        let mut lease = live();
        assert_eq!(
            fence.accept("KATOSYNC_OS_QA_EVENT_V1:WIFI_PATH_LOST", &mut lease),
            Err(DENIED)
        );
        assert!(!lease.is_live(Instant::now()));
        assert_eq!(
            fence.accept("KATOSYNC_OS_QA_EVENT_V1:WIFI_PATH_AVAILABLE", &mut lease),
            Err(DENIED)
        );
        assert!(lease
            .verified_in_channel_heartbeat(2, Instant::now())
            .is_err());
    }

    #[test]
    fn sleep_begin_and_wake_are_individually_terminal() {
        for signal in ["SLEEP_BEGIN", "WAKE"] {
            let mut fence = OsEventLeaseFence::default();
            let mut lease = live();
            let line = format!("{FRAME_PREFIX}{signal}");
            assert_eq!(fence.accept(&line, &mut lease), Err(DENIED));
            assert!(!lease.is_live(Instant::now()));
            assert_eq!(
                fence.accept("KATOSYNC_OS_QA_EVENT_V1:OBSERVING", &mut lease),
                Err(DENIED)
            );
        }
    }

    #[test]
    fn observer_exit_denies_an_existing_tls_lease() {
        let mut fence = OsEventLeaseFence::default();
        let mut lease = live();
        assert_eq!(
            fence.accept("KATOSYNC_OS_QA_EVENT_V1:STOPPED", &mut lease),
            Err(DENIED)
        );
        assert!(!lease.is_live(Instant::now()));
    }

    #[test]
    fn malformed_untrusted_frames_fail_closed_with_no_reconnect() {
        for input in [
            "",
            "KATOSYNC_OS_QA_EVENT_V1:RECONNECT",
            "KATOSYNC_OS_QA_EVENT_V1:WIFI_PATH_AVAILABLE\nFORGED",
            "KATOSYNC_OS_QA_EVENT_V1:WIFI_PATH_AVAILABLE\r",
            "KATOSYNC_OS_QA_EVENT_V1:WIFI_PATH_AVAILABLE:OWNER",
        ] {
            let mut lease = live();
            let mut fence = OsEventLeaseFence::default();
            assert_eq!(fence.accept(input, &mut lease), Err(MALFORMED));
            assert!(!lease.is_live(Instant::now()));
        }
    }

    #[test]
    fn strict_parser_cannot_be_tricked_by_prefix_or_suffix() {
        for invalid in [
            "KATOSYNC_OS_QA_EVENT_V2:OBSERVING",
            " xKATOSYNC_OS_QA_EVENT_V1:OBSERVING",
            "KATOSYNC_OS_QA_EVENT_V1:OBSERVING:EXTRA",
        ] {
            assert!(parse_event(invalid).is_err());
        }
        assert_eq!(
            parse_event("KATOSYNC_OS_QA_EVENT_V1:SLEEP_BEGIN"),
            Ok(OsEvent::SleepBegin)
        );
    }
}
