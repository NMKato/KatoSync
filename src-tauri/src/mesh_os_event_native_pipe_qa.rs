// Created by NMKato Solutions
//! Stage4AB.3.2B QA-only end-to-end path:
//! real, bounded Apple AppKit/NWPathMonitor observer -> its stdout ->
//! same-process Rust event cancellation channel -> canonical lease denial.
//!
//! The source is a one-shot, 5-second *passive* program built from the exact
//! checked-out repository source on the native CI runner. Its untrusted text
//! is DENY ONLY: it cannot grant peer/owner authority or reconnect.
//! NO real device sleep, Wi-Fi toggle, remote network or production listener.

use crate::{
    mesh_durable_lease_qa::LiveTlsLease, mesh_os_event_channel_qa::heartbeat_or_fail_closed,
    mesh_os_event_fence_qa::OsEventLeaseFence,
};
use std::{
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::{
    io::{duplex, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::mpsc,
    time::timeout,
};

const OBSERVER_PATH_ENV: &str = "KATOSYNC_STAGE4AB32B_OS_OBSERVER_BIN";
const OPT_IN_ENV: &str = "KATOSYNC_STAGE4AB32B_OS_EVENT_QA_READ_ONLY";
const OPT_IN_VALUE: &str = "OWNER_LAUNCHED_PASSIVE_OS_OBSERVER_ONLY";
const LEASE_DENIED: &str = "MESH_STAGE4AB32B_OS_OBSERVER_LEASE_DENIED";
const FRAME_PREFIX: &str = "KATOSYNC_OS_QA_EVENT_V1:";

fn observer_bin() -> std::ffi::OsString {
    std::env::var_os(OBSERVER_PATH_ENV)
        .expect("native QA must compile a fresh bounded observer and set the exact binary path")
}

fn live_qa_lease() -> LiveTlsLease {
    let now = Instant::now();
    let mut lease =
        LiveTlsLease::after_verified_open_channel([1u8; 16], [2u8; 32], [3u8; 32], [4u8; 32], now)
            .expect("synthetic QA mTLS lease");
    lease.verified_in_channel_heartbeat(1, now).unwrap();
    assert!(lease.is_live(Instant::now()));
    lease
}

#[tokio::test]
#[ignore = "owner-isolated native observer binary provided by CI only"]
async fn native_observer_refuses_execution_without_exact_owner_opt_in() {
    let mut command = Command::new(observer_bin());
    command
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = timeout(Duration::from_secs(4), command.output())
        .await
        .expect("unauthorized observer must terminate promptly")
        .expect("spawn native QA binary");
    assert_eq!(output.status.code(), Some(64));
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr)
        .contains("MESH_STAGE4AB32B_OS_EVENT_QA_OPT_IN_REQUIRED"));
}

#[tokio::test]
#[ignore = "owner-isolated native observer binary provided by CI only"]
async fn genuine_bounded_apple_observer_termination_cancels_pending_rust_heartbeat() {
    let mut command = Command::new(observer_bin());
    command
        .env_clear()
        .env(OPT_IN_ENV, OPT_IN_VALUE)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().expect("native macOS observer started");
    let stdout = child.stdout.take().expect("observer stdout must be piped");
    // Bounded channel: no process may inject an authorization or a remote job.
    let (tx, mut rx) = mpsc::channel::<String>(8);
    let lines_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut frames = Vec::new();
        for _ in 0..8 {
            let mut frame = Vec::new();
            let count = reader
                .read_until(b'\n', &mut frame)
                .await
                .expect("real native observer output must be readable");
            if count == 0 {
                break;
            }
            assert!(count <= 80, "native observer event must be bounded");
            let frame = String::from_utf8(frame).expect("ASCII-only event frames");
            assert!(
                frame.starts_with(FRAME_PREFIX),
                "no arbitrary stdout content"
            );
            frames.push(frame.clone());
            if tx.send(frame.clone()).await.is_err() {
                break;
            }
            if frame == format!("{FRAME_PREFIX}STOPPED\n") {
                break;
            }
        }
        frames
    });

    let mut lease = live_qa_lease();
    let mut fence = OsEventLeaseFence::default();
    let (mut transport, _silent_peer) = duplex(128);
    let pending_heartbeat = async move {
        transport
            .write_all(b"PING")
            .await
            .map_err(|_| "HEARTBEAT_WRITE_DENIED".to_string())?;
        let mut ack = [0u8; 4];
        transport
            .read_exact(&mut ack)
            .await
            .map(|_| ())
            .map_err(|_| "HEARTBEAT_READ_DENIED".to_string())
    };
    // The observer has no fault injection: it simply ends after five seconds.
    // Its real STOPPED event must cancel a pending real Tokio stream read and
    // invalidate the synthetic QA lease before any new heartbeat can succeed.
    let result = timeout(
        Duration::from_secs(14),
        heartbeat_or_fail_closed(&mut lease, &mut fence, &mut rx, pending_heartbeat),
    )
    .await
    .expect("bounded observer must terminate waiting heartbeat");
    assert_eq!(result.err().as_deref(), Some(LEASE_DENIED));
    assert!(!lease.is_live(Instant::now()));
    assert!(lease
        .verified_in_channel_heartbeat(2, Instant::now())
        .is_err());

    let exit = timeout(Duration::from_secs(3), child.wait())
        .await
        .expect("native passive observer must end within its deadline")
        .expect("observer wait");
    assert_eq!(exit.code(), Some(0));
    let frames = timeout(Duration::from_secs(2), lines_task)
        .await
        .expect("reader task must stop")
        .expect("reader task must not panic");
    assert!(frames
        .iter()
        .any(|v| v == &format!("{FRAME_PREFIX}OBSERVING\n")));
    assert!(frames
        .iter()
        .any(|v| v == &format!("{FRAME_PREFIX}STOPPED\n")));
}
