// Created by NMKato Solutions
#![forbid(unsafe_code)]
// Use the production-source bytes, never a duplicate or reimplementation.
// This does not grant native MCP permissions or open a WebSocket.
#[path = "../../../src-tauri/src/mesh_rc67_presence_qa.rs"]
#[allow(dead_code)]
mod mesh_rc67_presence_qa;
// Tiny offline QA substitute only; production binds the registered local
// project registry and the existing bounded native Git reader.
#[allow(dead_code)]
mod project_registry {
    use std::path::Path;
    pub(crate) fn project_registry_load() -> Result<Option<serde_json::Value>, String> {
        Err("RC69_QA_ONLY_NOT_ACTIVE".to_owned())
    }
    pub(crate) fn run_git(_root: &Path, _args: &[&str]) -> Option<Vec<u8>> {
        None
    }
}
#[path = "../../../src-tauri/src/mesh_rc69_readonly_qa.rs"]
#[allow(dead_code)]
mod mesh_rc69_readonly_qa;
#[path = "../../../src-tauri/src/mesh_rc69_result_qa.rs"]
#[allow(dead_code)]
mod mesh_rc69_result_qa;
#[path = "../../../src-tauri/src/mesh_rc70_outbound_wss_qa.rs"]
#[allow(dead_code)]
mod mesh_rc70_outbound_wss_qa;
