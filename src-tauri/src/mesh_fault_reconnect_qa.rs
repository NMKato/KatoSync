// Created by NMKato Solutions
//! Stage4AB.3.2A, isolated QA: physically drop the same mutually pinned,
//! open TLS1.3 stream after one real authenticated heartbeat, observe its
//! closure on the other Mac, then establish a NEW authenticated channel.
//! No OS/Wi-Fi/Tailscale disruption, no production key revocation, no jobs,
//! persistent listener, background supervisor, or public IPC.

use crate::{
    mesh_live_supervisor_qa::{self, QaFault},
    mesh_private_lan_qa::SingleQaPermit,
};
use std::time::Duration;
use tokio::time::{sleep, timeout};

const GATE_NAME: &str = "KATOSYNC_STAGE4AB32_DROP_RECONNECT_QA_ONCE";
const GATE_VALUE: &str = "OWNER_LAUNCHED_DROP_RECONNECT_QA_ONLY";
const REQUIRED_AB3_GATE_NAME: &str = "KATOSYNC_STAGE4AB3_RECONNECT_QA_TWICE";
const REQUIRED_AB3_GATE_VALUE: &str = "OWNER_LAUNCHED_REAUTH_TWICE_QA_ONLY";
const MAX_TEST_DURATION: Duration = Duration::from_secs(175);
const INITIAL_CLIENT_DELAY: Duration = Duration::from_secs(12);
const SERVER_REAUTH_DELAY: Duration = Duration::from_secs(2);
const CLIENT_REAUTH_DELAY: Duration = Duration::from_secs(5);

fn special_opt_in(compiled: bool, supplied: Option<&str>) -> bool {
    compiled && supplied == Some(GATE_VALUE)
}

fn observed_expected_drop(role: &str, error: &str) -> bool {
    matches!(
        (role, error),
        (
            "listen",
            "MESH_STAGE4AB32_VERIFIED_TLS_STREAM_INTENTIONALLY_DROPPED"
        ) | (
            "connect",
            "MESH_STAGE4AB32_REMOTE_TLS_CLOSED_AFTER_AUTHENTICATED_HB"
        )
    )
}

/// The expected fault cannot be a successful heartbeat, a remote consent
/// denial, or a different TLS/certificate error. There is exactly ONE retry
/// after the first authenticated open stream is observably closed.
///
/// Every new attempt re-enters the original Stage4AB2 native admission and
/// full Keychain/owner/both-enrollment preflight with freshly random nonces.
pub(crate) async fn run_drop_then_reconnect(args: Vec<String>) -> Result<(), String> {
    if !cfg!(feature = "stage4j-qa")
        || std::env::var(REQUIRED_AB3_GATE_NAME).ok().as_deref() != Some(REQUIRED_AB3_GATE_VALUE)
    {
        return Err("MESH_STAGE4AB32_PREVIOUS_REAUTH_QA_OPT_IN_REQUIRED".into());
    }
    if !special_opt_in(
        cfg!(feature = "stage4j-qa"),
        std::env::var(GATE_NAME).ok().as_deref(),
    ) {
        return Err("MESH_STAGE4AB32_EXPLICIT_FAULT_QA_OPT_IN_REQUIRED".into());
    }
    if args.len() != 5 || !matches!(args[0].as_str(), "listen" | "connect") {
        return Err("MESH_STAGE4AB32_ARGUMENTS_DENIED".into());
    }
    // Even a completed Stage4AB3.1 verification does NOT grant an automatic
    // retry. A fresh QA opt-in and exclusive process-level permit are required.
    let permit = SingleQaPermit::acquire()
        .map_err(|_| "MESH_STAGE4AB32_CONCURRENT_QA_DENIED".to_string())?;

    timeout(MAX_TEST_DURATION, async {
        if args[0] == "connect" {
            sleep(INITIAL_CLIENT_DELAY).await;
        }
        let injected = match args[0].as_str() {
            "listen" => QaFault::ServerDropAfterFirstAuthenticatedHeartbeat,
            "connect" => QaFault::ClientRequireUnexpectedTlsClose,
            _ => return Err("MESH_STAGE4AB32_ROLE_DENIED".into()),
        };
        let fault_result = mesh_live_supervisor_qa::run_fault_under_existing_qa_permit(
            &permit,
            args.clone(),
            injected,
        )
        .await;

        // Fail CLOSED: admission denial, pin/revoke/network mismatch, timeout,
        // fake confirmation or anything other than the real expected stream
        // closure cannot become a reconnect authorization.
        match fault_result {
            Err(error) if observed_expected_drop(&args[0], &error) => {
                println!("MESH_STAGE4AB32_FIRST_AUTHENTICATED_TLS_STREAM_CLOSED");
            }
            Err(error) => return Err(error),
            Ok(()) => return Err("MESH_STAGE4AB32_MISSING_EXPECTED_STREAM_DROP".into()),
        }

        if args[0] == "listen" {
            sleep(SERVER_REAUTH_DELAY).await;
        } else {
            sleep(CLIENT_REAUTH_DELAY).await;
        }

        // Exactly one independent new mTLS session with 3 good heartbeats.
        // No existing channel, nonce or lease is reused.
        mesh_live_supervisor_qa::run_once_under_existing_qa_permit(&permit, args).await?;
        Ok(())
    })
    .await
    .map_err(|_| "MESH_STAGE4AB32_ABSOLUTE_QA_DEADLINE".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fifth_qa_gate_denies_absent_or_uncompiled_authority() {
        assert!(!special_opt_in(false, Some(GATE_VALUE)));
        assert!(!special_opt_in(true, None));
        assert!(!special_opt_in(true, Some("true")));
        assert!(special_opt_in(true, Some(GATE_VALUE)));
        assert_ne!(REQUIRED_AB3_GATE_NAME, GATE_NAME);
        assert_ne!(REQUIRED_AB3_GATE_VALUE, GATE_VALUE);
    }

    #[test]
    fn only_the_expected_real_stream_drop_allows_one_reauthentication() {
        assert!(observed_expected_drop(
            "listen",
            "MESH_STAGE4AB32_VERIFIED_TLS_STREAM_INTENTIONALLY_DROPPED"
        ));
        assert!(observed_expected_drop(
            "connect",
            "MESH_STAGE4AB32_REMOTE_TLS_CLOSED_AFTER_AUTHENTICATED_HB"
        ));
        for denied in [
            "MESH_STAGE4AB2_ADMISSION_REVOKED",
            "MESH_STAGE4AB2_TLS_REJECTED",
            "MESH_STAGE4AB2_HEARTBEAT_TIMEOUT",
            "MESH_STAGE4AB2_CERT_PIN_DENIED",
            "MESH_STAGE4AB32_MISSING_EXPECTED_STREAM_DROP",
        ] {
            assert!(!observed_expected_drop("connect", denied));
            assert!(!observed_expected_drop("listen", denied));
        }
        assert!(!observed_expected_drop(
            "listen",
            "MESH_STAGE4AB32_REMOTE_TLS_CLOSED_AFTER_AUTHENTICATED_HB"
        ));
    }

    #[test]
    fn QA_has_hard_stop_no_unbounded_backoff_or_idle_auto_restart() {
        assert!(MAX_TEST_DURATION <= Duration::from_secs(175));
        assert!(INITIAL_CLIENT_DELAY < Duration::from_secs(35));
        assert!(SERVER_REAUTH_DELAY < Duration::from_secs(35));
        assert!(CLIENT_REAUTH_DELAY < Duration::from_secs(35));
    }
}
