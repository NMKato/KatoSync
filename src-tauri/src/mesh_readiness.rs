// Created by NMKato Solutions
//! Fleet Mode stage 0: a truthful, read-only LOCAL readiness report.
//! No network listener, discovery, pairing token, hidden device enrolment,
//! private address, identifier, local path, credential or external job dispatch.

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::Serialize;

const MAX_HEARTBEAT_AGE_SECS: i64 = 90;
const MAX_CLOCK_SKEW_SECS: i64 = 5;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshLocalReadiness {
    protocol: &'static str,
    platform: &'static str,
    architecture: &'static str,
    local_control: &'static str,
    device_identity: &'static str,
    peer_transport: &'static str,
    verified_peers: u8,
    remote_read_only_dispatch: bool,
    cross_device_writes: bool,
}

/// A local daemon heartbeat is NOT a remotely authenticated peer heartbeat.
fn local_daemon_state(now: DateTime<Utc>, heartbeat: Option<(&str, &str)>) -> &'static str {
    let Some((status, raw_timestamp)) = heartbeat else {
        return "unknown";
    };
    let Ok(timestamp) = DateTime::parse_from_rfc3339(raw_timestamp) else {
        return "unknown";
    };
    let age = now.signed_duration_since(timestamp.with_timezone(&Utc));
    if age < ChronoDuration::seconds(-MAX_CLOCK_SKEW_SECS) {
        return "unknown";
    }
    if age > ChronoDuration::seconds(MAX_HEARTBEAT_AGE_SECS) {
        return "stale";
    }
    if !matches!(status, "idle" | "busy" | "running" | "ready") {
        return "unknown";
    }
    "fresh"
}

#[tauri::command]
pub fn mesh_local_readiness() -> MeshLocalReadiness {
    let local = crate::local_control::daemon_heartbeat();
    let local_control = local_daemon_state(
        Utc::now(),
        local
            .as_ref()
            .map(|(status, timestamp)| (status.as_str(), timestamp.as_str())),
    );
    MeshLocalReadiness {
        protocol: "mesh-readonly-v0",
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        local_control,
        device_identity: "not_paired",
        peer_transport: "not_connected",
        verified_peers: 0,
        remote_read_only_dispatch: false,
        cross_device_writes: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_valid_local_daemon_does_not_imply_authenticated_mesh_peer() {
        let now = Utc::now();
        let recent = (now - ChronoDuration::seconds(20)).to_rfc3339();
        assert_eq!(local_daemon_state(now, Some(("idle", &recent))), "fresh");
        let snapshot = mesh_local_readiness();
        assert_eq!(snapshot.device_identity, "not_paired");
        assert_eq!(snapshot.peer_transport, "not_connected");
        assert_eq!(snapshot.verified_peers, 0);
        assert!(!snapshot.remote_read_only_dispatch);
        assert!(!snapshot.cross_device_writes);
    }

    #[test]
    fn missing_invalid_and_unknown_heartbeats_fail_closed() {
        let now = Utc::now();
        let recent = now.to_rfc3339();
        assert_eq!(local_daemon_state(now, None), "unknown");
        assert_eq!(local_daemon_state(now, Some(("ready", "bogus"))), "unknown");
        assert_eq!(
            local_daemon_state(now, Some(("unknown", &recent))),
            "unknown"
        );
    }

    #[test]
    fn stale_heartbeat_does_not_show_ready() {
        let now = Utc::now();
        let older = (now - ChronoDuration::seconds(91)).to_rfc3339();
        assert_eq!(local_daemon_state(now, Some(("idle", &older))), "stale");
    }

    #[test]
    fn future_clock_skew_never_implies_trust() {
        let now = Utc::now();
        let future = (now + ChronoDuration::seconds(60)).to_rfc3339();
        assert_eq!(
            local_daemon_state(now, Some(("running", &future))),
            "unknown"
        );
    }
}
