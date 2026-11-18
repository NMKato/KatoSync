// Created by NMKato Solutions
#[path = "../../../src-tauri/src/remote_mcp_relay/git_status.rs"]
mod git_status;
#[path = "../../../src-tauri/src/remote_mcp_relay/terminal_profile.rs"]
mod terminal_profile;

pub(crate) fn terminal_review_scope(_: &str) -> Result<crate::remote_mcp_terminal::Scope, String> {
    Err("OFFLINE_HARNESS_RELAY_UNAVAILABLE".into())
}
