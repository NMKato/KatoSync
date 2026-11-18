// Created by NMKato Solutions
#![forbid(unsafe_code)]
#![allow(dead_code)]
// Tests the exact production-source modules. Platform/network boundaries fail
// closed. Complete Tauri/HTTP/WSS composition is covered by native-library CI.
#[path = "../../../src-tauri/src/mesh_rc67_presence_qa.rs"]
mod mesh_rc67_presence_qa;
#[path = "../../../src-tauri/src/mesh_rc69_readonly_qa.rs"]
mod mesh_rc69_readonly_qa;
#[path = "../../../src-tauri/src/mesh_rc69_result_qa.rs"]
mod mesh_rc69_result_qa;
#[path = "../../../src-tauri/src/mesh_rc72_signed_server_qa.rs"]
mod mesh_rc72_signed_server_qa;
#[path = "relay_boundary.rs"]
mod remote_mcp_relay;
#[path = "../../../src-tauri/src/remote_mcp_terminal.rs"]
mod remote_mcp_terminal;

pub(crate) fn native_owner_session_generation() -> u64 {
    0
}
pub(crate) async fn verify_remote_mcp_totp_native(_: &str, _: &str, _: &str) -> Result<(), String> {
    Err("OFFLINE_HARNESS_AUTH_UNAVAILABLE".into())
}
mod project_registry {
    use std::path::Path;
    pub(crate) fn project_registry_load() -> Result<Option<serde_json::Value>, String> {
        Err("OFFLINE_HARNESS_REGISTRY_UNAVAILABLE".into())
    }
    pub(crate) fn run_git(_: &Path, _: &[&str]) -> Option<Vec<u8>> {
        None
    }
}
mod remote_mcp_owner_review {
    use uuid::Uuid;
    pub(crate) struct OwnerContext {
        pub generation: u64,
        pub uid: String,
    }
    pub(crate) struct ClientGrant {
        pub id: Uuid,
        pub status: String,
    }
    pub(crate) struct TargetClient {
        pub id: Uuid,
    }
    pub(crate) struct Factor {
        pub id: Uuid,
    }
    pub(crate) struct Snapshot {
        pub allowed_tools: Vec<String>,
        pub client_grant: Option<ClientGrant>,
        pub target_client: TargetClient,
        pub factors: Vec<Factor>,
    }
    pub(crate) fn now_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("test system clock")
            .as_millis()
            .try_into()
            .expect("safe clock")
    }
    pub(crate) async fn context() -> Result<OwnerContext, String> {
        Err("OFFLINE_HARNESS_AUTH_UNAVAILABLE".into())
    }
    pub(crate) async fn recheck(_: &OwnerContext) -> Result<(), String> {
        Err("OFFLINE_HARNESS_AUTH_UNAVAILABLE".into())
    }
    pub(crate) fn check_generation(_: &OwnerContext) -> Result<(), String> {
        Err("OFFLINE_HARNESS_AUTH_UNAVAILABLE".into())
    }
    pub(crate) async fn snapshot_for(_: &OwnerContext) -> Result<Snapshot, String> {
        Err("OFFLINE_HARNESS_AUTH_UNAVAILABLE".into())
    }
    pub(crate) async fn request(
        _: &OwnerContext,
        _: &str,
        _: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        Err("OFFLINE_HARNESS_NETWORK_UNAVAILABLE".into())
    }
}
mod remote_mcp_device_review {
    use uuid::Uuid;
    pub(crate) struct LocalDevice {
        pub id: Uuid,
        pub hash: String,
        pub signer: ed25519_dalek::SigningKey,
    }
    pub(crate) async fn local_device(
        _: &super::remote_mcp_owner_review::OwnerContext,
    ) -> Result<LocalDevice, String> {
        Err("OFFLINE_HARNESS_DEVICE_UNAVAILABLE".into())
    }
    pub(crate) async fn actor_session(
        _: &super::remote_mcp_owner_review::OwnerContext,
    ) -> Result<Uuid, String> {
        Err("OFFLINE_HARNESS_AUTH_UNAVAILABLE".into())
    }
}
