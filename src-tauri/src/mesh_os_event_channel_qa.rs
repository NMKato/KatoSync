// Created by NMKato Solutions
//! Stage4AB.3.2B – a QA-only in-process event/heartbeat cancellation bridge.
//!
//! A passive observer event is untrusted DENIAL INPUT ONLY. No event may
//! authenticate an owner, open TLS, mint a lease or grant a remote command.
//! This test-only bridge demonstrates immediate cancellation of an in-flight
//! heartbeat on loss/sleep/wake; it does NOT yet source OS events at runtime.
//! No sockets, subprocess, network controls, persistence, IPC or key changes.

use crate::{mesh_durable_lease_qa::LiveTlsLease, mesh_os_event_fence_qa::OsEventLeaseFence};
use std::future::Future;
use tokio::sync::mpsc::{self, error::TryRecvError};

const PRODUCER_STOPPED: &str = "MESH_STAGE4AB32B_OS_EVENT_SOURCE_GONE";

/// Keeps the authenticated TLS heartbeat future and the event guard on the
/// same task. On a denial signal, returning drops (cancels) the heartbeat
/// future immediately; callers must then drop the associated open TLS stream.
/// This is NOT a reconnect source, and never creates a new LiveTlsLease.
pub(crate) async fn heartbeat_or_fail_closed<F>(
    lease: &mut LiveTlsLease,
    fence: &mut OsEventLeaseFence,
    events: &mut mpsc::Receiver<String>,
    heartbeat: F,
) -> Result<(), String>
where
    F: Future<Output = Result<(), String>>,
{
    tokio::pin!(heartbeat);
    loop {
        tokio::select! {
            biased;
            frame = events.recv() => {
                match frame {
                    Some(frame) => fence.accept(&frame, lease).map_err(str::to_string)?,
                    None => {
                        lease.on_network_loss();
                        return Err(PRODUCER_STOPPED.to_string());
                    }
                }
            }
            result = &mut heartbeat => {
                // A ready heartbeat must not bypass an already queued denial.
                // Bounded queue sizes belong to the future OS producer.
                loop {
                    match events.try_recv() {
                        Ok(frame) => fence.accept(&frame, lease).map_err(str::to_string)?,
                        Err(TryRecvError::Empty) => break,
                        Err(TryRecvError::Disconnected) => {
                            lease.on_network_loss();
                            return Err(PRODUCER_STOPPED.to_string());
                        }
                    }
                }
                return result;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;
    use tokio::io::{duplex, AsyncReadExt, AsyncWriteExt};
    use tokio::sync::oneshot;

    fn live() -> LiveTlsLease {
        let now = Instant::now();
        let mut lease = LiveTlsLease::after_verified_open_channel(
            [1u8; 16], [2u8; 32], [3u8; 32], [4u8; 32], now,
        )
        .unwrap();
        lease.verified_in_channel_heartbeat(1, now).unwrap();
        assert!(lease.is_live(Instant::now()));
        lease
    }

    #[tokio::test]
    async fn real_pending_io_read_is_cancelled_by_link_loss_event() {
        let mut lease = live();
        let mut fence = OsEventLeaseFence::default();
        let (tx, mut rx) = mpsc::channel::<String>(4);
        let (mut socket, _unresponsive_peer) = duplex(128);
        let (read_started, wait_for_read) = oneshot::channel::<()>();
        let heartbeat = async move {
            socket.write_all(b"PING").await.unwrap();
            read_started.send(()).unwrap();
            let mut pong = [0u8; 4];
            socket
                .read_exact(&mut pong)
                .await
                .map(|_| ())
                .map_err(|_| "READ_FAILED".to_string())
        };
        let trigger = async move {
            wait_for_read.await.unwrap();
            tx.send("KATOSYNC_OS_QA_EVENT_V1:WIFI_PATH_LOST".to_string())
                .await
                .unwrap();
        };
        let (result, ()) = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            tokio::join!(
                heartbeat_or_fail_closed(&mut lease, &mut fence, &mut rx, heartbeat),
                trigger
            )
        })
        .await
        .expect("in-flight event must cancel a pending read promptly");
        assert_eq!(
            result.as_deref(),
            Err("MESH_STAGE4AB32B_OS_OBSERVER_LEASE_DENIED")
        );
        assert!(!lease.is_live(Instant::now()));
        assert!(lease
            .verified_in_channel_heartbeat(2, Instant::now())
            .is_err());
    }

    #[tokio::test]
    async fn benign_wifi_available_event_cannot_authenticate_or_grant_remote_jobs() {
        let mut lease = live();
        let mut fence = OsEventLeaseFence::default();
        let (tx, mut rx) = mpsc::channel(4);
        tx.send("KATOSYNC_OS_QA_EVENT_V1:WIFI_PATH_AVAILABLE".into())
            .await
            .unwrap();
        let result =
            heartbeat_or_fail_closed(&mut lease, &mut fence, &mut rx, async { Ok(()) }).await;
        assert_eq!(result, Ok(()));
        assert!(lease.is_live(Instant::now()));
        // This method cannot create a new TLS identity or a new channel.
        drop(tx);
        lease.close();
        assert!(!lease.is_live(Instant::now()));
    }

    #[tokio::test]
    async fn already_queued_denial_preempts_successful_heartbeat() {
        let mut lease = live();
        let mut fence = OsEventLeaseFence::default();
        let (tx, mut rx) = mpsc::channel(4);
        tx.send("KATOSYNC_OS_QA_EVENT_V1:OBSERVING".into())
            .await
            .unwrap();
        tx.send("KATOSYNC_OS_QA_EVENT_V1:WAKE".into())
            .await
            .unwrap();
        let result =
            heartbeat_or_fail_closed(&mut lease, &mut fence, &mut rx, async { Ok(()) }).await;
        assert!(result.is_err());
        assert!(!lease.is_live(Instant::now()));
    }

    #[tokio::test]
    async fn disconnected_producer_invalidates_and_stops_inflight_work() {
        let mut lease = live();
        let mut fence = OsEventLeaseFence::default();
        let (tx, mut rx) = mpsc::channel::<String>(1);
        drop(tx);
        let result = heartbeat_or_fail_closed(&mut lease, &mut fence, &mut rx, async {
            std::future::pending::<Result<(), String>>().await
        })
        .await;
        assert_eq!(result.as_deref(), Err(PRODUCER_STOPPED));
        assert!(!lease.is_live(Instant::now()));
    }

    #[tokio::test]
    async fn malformed_event_denies_even_with_success_ready() {
        let mut lease = live();
        let mut fence = OsEventLeaseFence::default();
        let (tx, mut rx) = mpsc::channel(2);
        tx.send("KATOSYNC_OS_QA_EVENT_V1:REAUTH_GRANTED".into())
            .await
            .unwrap();
        let result =
            heartbeat_or_fail_closed(&mut lease, &mut fence, &mut rx, async { Ok(()) }).await;
        assert!(result.is_err());
        assert!(!lease.is_live(Instant::now()));
    }

    #[tokio::test]
    async fn revoked_lease_never_reopens_on_wifi_return_event() {
        let mut lease = live();
        let mut fence = OsEventLeaseFence::default();
        let (tx, mut rx) = mpsc::channel(4);
        tx.send("KATOSYNC_OS_QA_EVENT_V1:SLEEP_BEGIN".into())
            .await
            .unwrap();
        tx.send("KATOSYNC_OS_QA_EVENT_V1:WIFI_PATH_AVAILABLE".into())
            .await
            .unwrap();
        let result =
            heartbeat_or_fail_closed(&mut lease, &mut fence, &mut rx, async { Ok(()) }).await;
        assert!(result.is_err());
        assert!(!lease.is_live(Instant::now()));
        // A new owner/session/mTLS proof must be obtained by a separate gate.
        assert!(lease
            .verified_in_channel_heartbeat(2, Instant::now())
            .is_err());
    }
}
