// Created by NMKato Solutions
//! Stage4M: separate process liveness from verified model inference readiness.
//! This pure gate cannot start, stop, claim or attach to external model servers.

/// Only a verified installed package AND a healthy, correctly aliased loopback
/// server may be reported as a locally running model.
/// An owned-but-starting child or a foreign 1B service never satisfies this.
pub(crate) fn inference_ready(
    runtime_installed: bool,
    model_installed: bool,
    healthy_pinned_alias: bool,
) -> bool {
    runtime_installed && model_installed && healthy_pinned_alias
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn healthy_pinned_alias_with_verified_package_is_ready() {
        assert!(inference_ready(true, true, true));
    }
    #[test]
    fn owned_child_liveness_never_implies_inference_ready() {
        assert!(!inference_ready(true, true, false));
    }
    #[test]
    fn running_foreign_service_without_own_package_is_never_ready() {
        assert!(!inference_ready(false, false, true));
        assert!(!inference_ready(true, false, true));
        assert!(!inference_ready(false, true, true));
    }
    #[test]
    fn no_runtime_or_no_model_must_never_be_ready() {
        for runtime in [false, true] {
            for model in [false, true] {
                if !runtime || !model {
                    for alias in [false, true] {
                        assert!(!inference_ready(runtime, model, alias));
                    }
                }
            }
        }
    }
}
