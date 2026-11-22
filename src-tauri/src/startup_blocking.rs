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

#[cfg(test)]
mod tests {
    use super::read;
    use std::{sync::mpsc, time::Duration};

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
        release_tx.send(()).expect("caller ran while OS read waited");
        assert!(pending.await.expect("task").expect("read"));
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
