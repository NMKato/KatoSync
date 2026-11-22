//! Startup OS reads may wait for an explicit system permission decision.
//! Keep that wait off both the native event loop and async runtime workers.

pub async fn read<T: Send + 'static>(
    operation: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        // A join/panic detail may contain private OS data. Return a fixed code.
        .map_err(|_| "KATOSYNC_STARTUP_READ_UNAVAILABLE".to_string())
}

/// Reject a read started before a logout/account transition, even if its OS
/// permission prompt only completes after that transition.
pub async fn read_guarded<T: Send + 'static>(
    operation: impl FnOnce() -> T + Send + 'static,
    is_current: impl Fn() -> bool + Send + 'static,
) -> Result<Option<T>, String> {
    if !is_current() {
        return Ok(None);
    }
    let result = read(operation).await?;
    Ok(is_current().then_some(result))
}

#[cfg(test)]
mod tests {
    use super::{read, read_guarded};
    use std::{
        sync::{
            atomic::{AtomicBool, AtomicU64, Ordering},
            mpsc, Arc,
        },
        time::Duration,
    };

    #[tokio::test(flavor = "current_thread")]
    async fn pending_os_read_leaves_the_async_caller_responsive() {
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let pending = tokio::spawn(read(move || {
            let _ = started_tx.send(());
            release_rx.recv_timeout(Duration::from_secs(2)).is_ok()
        }));
        started_rx.await.expect("worker started");
        // Only the async caller can release the worker. A direct blocking call
        // instead times out and returns false, so this checks actual liveness.
        release_tx
            .send(())
            .expect("caller ran while OS read waited");
        assert!(pending.await.expect("task").expect("read"));
    }

    async fn delayed_read_is_discarded(logout: bool) {
        let generation = Arc::new(AtomicU64::new(7));
        let logged_out = Arc::new(AtomicBool::new(false));
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let current_generation = generation.clone();
        let current_logout = logged_out.clone();
        let pending = tokio::spawn(read_guarded(
            move || {
                let _ = started_tx.send(());
                release_rx
                    .recv_timeout(Duration::from_secs(2))
                    .expect("release");
                true
            },
            move || {
                current_generation.load(Ordering::Acquire) == 7
                    && !current_logout.load(Ordering::Acquire)
            },
        ));
        started_rx.await.expect("worker started");
        if logout {
            logged_out.store(true, Ordering::Release);
        } else {
            generation.store(8, Ordering::Release);
        }
        release_tx.send(()).expect("release");
        assert_eq!(pending.await.expect("task").expect("read"), None);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn account_transition_during_os_wait_discards_stale_result() {
        delayed_read_is_discarded(false).await;
    }

    #[tokio::test(flavor = "current_thread")]
    async fn logout_during_os_wait_discards_stale_result() {
        delayed_read_is_discarded(true).await;
    }

    #[tokio::test(flavor = "current_thread")]
    async fn already_invalid_session_does_not_start_os_read() {
        assert_eq!(
            read_guarded(|| panic!("must not read"), || false).await,
            Ok(None::<()>)
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn successful_read_preserves_its_result() {
        assert_eq!(read(|| false).await, Ok(false));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn worker_failure_returns_only_a_fixed_public_error() {
        let result = read(|| -> bool { panic!("synthetic private detail") }).await;
        assert_eq!(result, Err("KATOSYNC_STARTUP_READ_UNAVAILABLE".to_string()));
    }
}
