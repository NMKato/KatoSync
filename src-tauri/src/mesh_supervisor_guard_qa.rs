// Created by NMKato Solutions
//! Stage4AB.3.2B - QA-only supervisor guard combining admission rechecks,
//! the existing pinned TLS heartbeat and passive macOS deny-only events.
//! No production wiring, remote jobs, persistence, OS mutations, or IPC.

use crate::{
    mesh_durable_lease_qa::LiveTlsLease, mesh_os_event_channel_qa::heartbeat_or_fail_closed,
    mesh_os_event_fence_qa::OsEventLeaseFence,
};
use std::{future::Future, time::Instant};
use tokio::sync::mpsc;

/// The caller supplies independently validated owner/enrollment checks and
/// the existing TLS-supervisor heartbeat. NO lease renewal occurs unless:
///   1) current owner + both enrollments are valid BEFORE transport I/O;
///   2) the authenticated pinned TLS heartbeat ACK succeeds;
///   3) owner + enrollments are still valid AFTER transport I/O;
///   4) no native OS-event denial is queued or delivered meanwhile.
/// On any failure the original lease is permanently invalidated; the
/// caller then drops the original pinned TLS stream. Tests must NOT treat
/// this gate as a new authority or device admission source.
pub(crate) async fn guarded_supervisor_cycle<Pre, PreFuture, Heartbeat, Post, PostFuture>(
    lease: &mut LiveTlsLease,
    fence: &mut OsEventLeaseFence,
    events: &mut mpsc::Receiver<String>,
    sequence: u64,
    precheck: Pre,
    heartbeat: Heartbeat,
    postcheck: Post,
) -> Result<(), String>
where
    Pre: FnOnce() -> PreFuture,
    PreFuture: Future<Output = Result<(), String>>,
    Heartbeat: Future<Output = Result<(), String>>,
    Post: FnOnce() -> PostFuture,
    PostFuture: Future<Output = Result<(), String>>,
{
    if !lease.is_live(Instant::now()) {
        lease.on_owner_or_peer_revoked();
        return Err("MESH_STAGE4AB32B_SUPERVISOR_OLD_LEASE_DENIED".into());
    }

    let checked_heartbeat = async move {
        precheck()
            .await
            .map_err(|_| "MESH_STAGE4AB32B_OWNER_ENROLLMENT_PRECHECK_DENIED".to_string())?;
        heartbeat.await?;
        postcheck()
            .await
            .map_err(|_| "MESH_STAGE4AB32B_OWNER_ENROLLMENT_POSTCHECK_DENIED".to_string())
    };
    let result = heartbeat_or_fail_closed(lease, fence, events, checked_heartbeat).await;
    if result.is_err() {
        // Rechecks, heartbeat and OS-events all terminally deny the old
        // channel; never leave a stale, renewable lease on an Err branch.
        lease.on_owner_or_peer_revoked();
    }
    result?;
    // Only the same original (already-authenticated) lease can be renewed;
    // this method does not mint a new TLS identity or new connection.
    lease.verified_in_channel_heartbeat(sequence, Instant::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
        time::Duration,
    };
    use tokio::{
        io::{duplex, AsyncReadExt, AsyncWriteExt},
        sync::oneshot,
        time::timeout,
    };

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
    fn frame(name: &str) -> String {
        format!("KATOSYNC_OS_QA_EVENT_V1:{name}")
    }

    #[tokio::test]
    async fn valid_rechecks_and_ready_heartbeat_renew_only_existing_lease() {
        let mut lease = live();
        let mut fence = OsEventLeaseFence::default();
        let (_sender, mut receiver) = mpsc::channel::<String>(4);
        let order = Arc::new(std::sync::Mutex::new(Vec::<&'static str>::new()));
        let pre = Arc::clone(&order);
        let hb = Arc::clone(&order);
        let post = Arc::clone(&order);
        let outcome = guarded_supervisor_cycle(
            &mut lease,
            &mut fence,
            &mut receiver,
            2,
            || async move {
                pre.lock().unwrap().push("owner-pre");
                Ok(())
            },
            async move {
                hb.lock().unwrap().push("pinned-tls-ack");
                Ok(())
            },
            || async move {
                post.lock().unwrap().push("owner-post");
                Ok(())
            },
        )
        .await;
        assert_eq!(outcome, Ok(()));
        assert_eq!(
            *order.lock().unwrap(),
            vec!["owner-pre", "pinned-tls-ack", "owner-post"]
        );
        assert!(lease.is_live(Instant::now()));
        lease.close();
        assert!(!lease.is_live(Instant::now()));
    }

    #[tokio::test]
    async fn revoked_owner_before_heartbeat_never_sends_or_renews() {
        let mut lease = live();
        let mut fence = OsEventLeaseFence::default();
        let (_sender, mut events) = mpsc::channel::<String>(2);
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&calls);
        let outcome = guarded_supervisor_cycle(
            &mut lease,
            &mut fence,
            &mut events,
            2,
            || async { Err("OWNER_REVOKED".to_string()) },
            async move {
                observed.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
            || async { Ok(()) },
        )
        .await;
        assert_eq!(
            outcome.err().as_deref(),
            Some("MESH_STAGE4AB32B_OWNER_ENROLLMENT_PRECHECK_DENIED"),
        );
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(!lease.is_live(Instant::now()));
        assert!(lease
            .verified_in_channel_heartbeat(2, Instant::now())
            .is_err());
    }

    #[tokio::test]
    async fn revoked_enrollment_after_valid_tls_ack_still_denies_renewal() {
        let mut lease = live();
        let mut fence = OsEventLeaseFence::default();
        let (_sender, mut events) = mpsc::channel::<String>(2);
        let checks = Arc::new(AtomicUsize::new(0));
        let hb = Arc::clone(&checks);
        let outcome = guarded_supervisor_cycle(
            &mut lease,
            &mut fence,
            &mut events,
            2,
            || async { Ok(()) },
            async move {
                hb.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
            || async { Err("ENROLLMENT_REVOKED".to_string()) },
        )
        .await;
        assert_eq!(
            outcome.err().as_deref(),
            Some("MESH_STAGE4AB32B_OWNER_ENROLLMENT_POSTCHECK_DENIED"),
        );
        assert_eq!(checks.load(Ordering::SeqCst), 1);
        assert!(!lease.is_live(Instant::now()));
        assert!(lease
            .verified_in_channel_heartbeat(2, Instant::now())
            .is_err());
    }

    #[tokio::test]
    async fn queued_sleep_preempts_valid_owner_checks_and_ready_heartbeat() {
        let mut lease = live();
        let mut fence = OsEventLeaseFence::default();
        let (sender, mut events) = mpsc::channel::<String>(3);
        sender.send(frame("SLEEP_BEGIN")).await.unwrap();
        let invoked = Arc::new(AtomicUsize::new(0));
        let hb = Arc::clone(&invoked);
        let outcome = guarded_supervisor_cycle(
            &mut lease,
            &mut fence,
            &mut events,
            2,
            || async { Ok(()) },
            async move {
                hb.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
            || async { Ok(()) },
        )
        .await;
        assert_eq!(
            outcome.err().as_deref(),
            Some("MESH_STAGE4AB32B_OS_OBSERVER_LEASE_DENIED"),
        );
        assert_eq!(invoked.load(Ordering::SeqCst), 0);
        assert!(!lease.is_live(Instant::now()));
    }

    #[tokio::test]
    async fn native_link_loss_interrupts_pending_real_io_and_postcheck_never_runs() {
        let mut lease = live();
        let mut fence = OsEventLeaseFence::default();
        let (sender, mut events) = mpsc::channel::<String>(4);
        let (mut socket, _silent) = duplex(128);
        let (started, waiting) = oneshot::channel::<()>();
        let postchecks = Arc::new(AtomicUsize::new(0));
        let post = Arc::clone(&postchecks);
        let heartbeat = async move {
            socket.write_all(b"PING").await.unwrap();
            started.send(()).unwrap();
            let mut ack = [0u8; 4];
            socket
                .read_exact(&mut ack)
                .await
                .map(|_| ())
                .map_err(|_| "READ_IO_FAILED".to_string())
        };
        let producer = async move {
            waiting.await.unwrap();
            sender.send(frame("WIFI_PATH_LOST")).await.unwrap();
        };
        let (outcome, ()) = timeout(Duration::from_secs(3), async {
            tokio::join!(
                guarded_supervisor_cycle(
                    &mut lease,
                    &mut fence,
                    &mut events,
                    2,
                    || async { Ok(()) },
                    heartbeat,
                    || async move {
                        post.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    },
                ),
                producer
            )
        })
        .await
        .expect("link loss must cancel in-flight QA work promptly");
        assert_eq!(
            outcome.err().as_deref(),
            Some("MESH_STAGE4AB32B_OS_OBSERVER_LEASE_DENIED"),
        );
        assert_eq!(postchecks.load(Ordering::SeqCst), 0);
        assert!(!lease.is_live(Instant::now()));
    }

    #[tokio::test]
    async fn vanished_native_event_producer_denies_even_with_fresh_owner_checks() {
        let mut lease = live();
        let mut fence = OsEventLeaseFence::default();
        let (sender, mut events) = mpsc::channel::<String>(1);
        drop(sender);
        let outcome = guarded_supervisor_cycle(
            &mut lease,
            &mut fence,
            &mut events,
            2,
            || async { Ok(()) },
            async { Ok(()) },
            || async { Ok(()) },
        )
        .await;
        assert_eq!(
            outcome.err().as_deref(),
            Some("MESH_STAGE4AB32B_OS_EVENT_SOURCE_GONE"),
        );
        assert!(!lease.is_live(Instant::now()));
    }

    #[tokio::test]
    async fn old_denied_lease_cannot_resume_after_wifi_available() {
        let mut lease = live();
        lease.on_owner_or_peer_revoked();
        let mut fence = OsEventLeaseFence::default();
        let (sender, mut events) = mpsc::channel::<String>(2);
        sender.send(frame("WIFI_PATH_AVAILABLE")).await.unwrap();
        let outcome = guarded_supervisor_cycle(
            &mut lease,
            &mut fence,
            &mut events,
            2,
            || async { Ok(()) },
            async { Ok(()) },
            || async { Ok(()) },
        )
        .await;
        assert_eq!(
            outcome.err().as_deref(),
            Some("MESH_STAGE4AB32B_SUPERVISOR_OLD_LEASE_DENIED"),
        );
        assert!(!lease.is_live(Instant::now()));
    }
}
