// Created by NMKato Solutions
//! Stage4P: Do not classify explicitly headless KatoSync modes as GUI instances.

pub(crate) fn is_headless_process_args(command_suffix: &str) -> bool {
    command_suffix
        .split_ascii_whitespace()
        .any(|flag| matches!(flag, "--local-control-daemon" | "--run-sync"))
}

#[cfg(test)]
mod tests {
    use super::is_headless_process_args;

    #[test]
    fn actual_gui_is_not_ignored() {
        assert!(!is_headless_process_args(""));
        assert!(!is_headless_process_args("   "));
        assert!(!is_headless_process_args(" --foreground"));
    }
    #[test]
    fn daemon_started_before_gui_is_not_a_duplicate_gui() {
        assert!(is_headless_process_args(" --local-control-daemon"));
        assert!(is_headless_process_args(" --qa --local-control-daemon"));
    }
    #[test]
    fn batch_sync_does_not_block_gui() {
        assert!(is_headless_process_args(" --run-sync"));
    }
    #[test]
    fn arbitrary_keyword_is_not_a_headless_mode() {
        assert!(!is_headless_process_args(" --local-control-daemon-enabled"));
        assert!(!is_headless_process_args(" --run-sync-more"));
    }
}
