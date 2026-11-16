// Created by NMKato Solutions
//! Stage4AB.3 part 1: manual re-authentication of two independent
//! pinned TLS1.3 sessions with fresh nonces, owner and enrollment checks.
//! This is NOT an always-on daemon, automatic failure retry, permanent
//! listener, device command channel, or production connection indicator.

use crate::{mesh_live_supervisor_qa, mesh_private_lan_qa::SingleQaPermit};
use std::time::Duration;
use tokio::time::{sleep, timeout};

const GATE_NAME: &str = "KATOSYNC_STAGE4AB3_RECONNECT_QA_TWICE";
const GATE_VALUE: &str = "OWNER_LAUNCHED_REAUTH_TWICE_QA_ONLY";
const MAX_TEST_DURATION: Duration = Duration::from_secs(235);
const CLIENT_INITIAL_DELAY: Duration = Duration::from_secs(12);
const CLIENT_REAUTH_DELAY: Duration = Duration::from_secs(12);
const SERVER_REBIND_DELAY: Duration = Duration::from_secs(3);

fn extra_gate(feature_enabled: bool, value: Option<&str>) -> bool {
    feature_enabled && value == Some(GATE_VALUE)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RetryDecision {
    ReauthenticateAfter(Duration),
    StopRevoked,
    StopBudgetExceeded,
    StopPermissionDenied,
}

// A read-only fail-closed policy for Stage4AB3.2 future runtime review.
// NOT yet a background retry loop. Every subsequent connect must recheck
// real owner login, both enrolled keys and the existing Keychain approval.
fn classify_retry(
    failed_connect_attempts: u8,
    identity_or_owner_revoked: bool,
    current_owner_and_peer_approved: bool,
    remaining: Duration,
) -> RetryDecision {
    if identity_or_owner_revoked {
        return RetryDecision::StopRevoked;
    }
    if !current_owner_and_peer_approved {
        return RetryDecision::StopPermissionDenied;
    }
    let delay = match failed_connect_attempts {
        0 => Duration::from_secs(2),
        1 => Duration::from_secs(4),
        2 => Duration::from_secs(8),
        _ => return RetryDecision::StopBudgetExceeded,
    };
    if remaining <= delay {
        return RetryDecision::StopBudgetExceeded;
    }
    RetryDecision::ReauthenticateAfter(delay)
}

// A manual hardware proof for re-establishing two successive sessions:
// each mTLS channel authenticates afresh, exchanges fresh nonces and
// completes all three AB2 in-channel heartbeat rounds. The old stream
// has closed before the next channel opens. No automatic retry on a
// failed or denied attempt, no background tasks or remote commands.
pub(crate) async fn run_twice(args: Vec<String>) -> Result<(), String> {
    if !extra_gate(
        cfg!(feature = "stage4j-qa"),
        std::env::var(GATE_NAME).ok().as_deref(),
    ) {
        return Err("MESH_STAGE4AB3_EXPLICIT_RECONNECT_QA_OPT_IN_REQUIRED".into());
    }
    if args.len() != 5 || !matches!(args[0].as_str(), "listen" | "connect") {
        return Err("MESH_STAGE4AB3_ARGUMENTS_DENIED".into());
    }
    // Own the original AB2 SingleQaPermit across BOTH sessions and the
    // gap. No other QA tool in the same process can overlap.
    let _permit =
        SingleQaPermit::acquire().map_err(|_| "MESH_STAGE4AB3_CONCURRENT_QA_DENIED".to_string())?;
    timeout(MAX_TEST_DURATION, async {
        for cycle in 0..2 {
            if args[0] == "connect" {
                sleep(if cycle == 0 {
                    CLIENT_INITIAL_DELAY
                } else {
                    CLIENT_REAUTH_DELAY
                })
                .await;
            } else if cycle > 0 {
                sleep(SERVER_REBIND_DELAY).await;
            }
            // Recheck ALL AB2 upstream owner opt-ins on every cycle, and
            // new live owner, Keychain, TLS and both enrolled devices.
            // Any failure closes the socket and stops WITHOUT fallback.
            mesh_live_supervisor_qa::run_once_under_existing_qa_permit(&_permit, args.clone())
                .await?;
            if cycle == 0 {
                println!("MESH_STAGE4AB3_FIRST_MTLS_SESSION_CLOSED_VERIFIED");
            }
        }
        Ok(())
    })
    .await
    .map_err(|_| "MESH_STAGE4AB3_TEST_DEADLINE_EXCEEDED".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fourth_explicit_owner_opt_in_is_independent() {
        assert!(!extra_gate(false, Some(GATE_VALUE)));
        assert!(!extra_gate(true, None));
        assert!(!extra_gate(true, Some("true")));
        assert!(extra_gate(true, Some(GATE_VALUE)));
    }

    #[test]
    fn revoked_or_switched_owner_stops_retry_without_fallback() {
        assert_eq!(
            classify_retry(0, true, true, Duration::from_secs(100)),
            RetryDecision::StopRevoked
        );
        assert_eq!(
            classify_retry(0, false, false, Duration::from_secs(100)),
            RetryDecision::StopPermissionDenied
        );
        assert_eq!(
            classify_retry(0, true, false, Duration::from_secs(100)),
            RetryDecision::StopRevoked
        );
    }

    #[test]
    fn future_reconnect_policy_is_bounded_and_exponential() {
        for (n, secs) in [(0, 2), (1, 4), (2, 8)] {
            assert_eq!(
                classify_retry(n, false, true, Duration::from_secs(100)),
                RetryDecision::ReauthenticateAfter(Duration::from_secs(secs))
            );
        }
        assert_eq!(
            classify_retry(3, false, true, Duration::from_secs(100)),
            RetryDecision::StopBudgetExceeded
        );
        assert_eq!(
            classify_retry(2, false, true, Duration::from_secs(8)),
            RetryDecision::StopBudgetExceeded
        );
    }

    #[test]
    fn explicit_hardware_test_is_finite_and_released_after_completion() {
        assert!(MAX_TEST_DURATION <= Duration::from_secs(235));
        assert!(CLIENT_INITIAL_DELAY < Duration::from_secs(35));
        assert!(CLIENT_REAUTH_DELAY < Duration::from_secs(35));
        assert!(SERVER_REBIND_DELAY < Duration::from_secs(35));
    }
}
