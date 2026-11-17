//! Isolated native QA: real canonical MeshLeaseMachine + original pinned
//! rustls/TLS configuration and existing heartbeat + test-only RC66L frame.
//! Only Keychain-backed account registry is a source-only test stub.
#![allow(dead_code)]
use ed25519_dalek::VerifyingKey;
pub(crate) mod mesh_identity {
    use ed25519_dalek::VerifyingKey;
    use sha2::{Digest, Sha256};
    // Exact original mesh_identity.rs fingerprint implementation.
    pub(crate) fn fingerprint(key: &VerifyingKey) -> String {
        let h = Sha256::digest(key.as_bytes());
        h[..16]
            .iter()
            .map(|byte| format!("{byte:02X}"))
            .collect::<Vec<_>>()
            .join("-")
    }
}
pub(crate) mod mesh_trust {
    // The real TLS module validates all fields and the embedded public key.
    // Fixture is independently pinned, no Keychain access or owner permissions.
    #[derive(Clone)]
    pub(crate) struct ApprovedPeer {
        pub fingerprint: String,
        pub public_key: String,
        pub approved_at: i64,
        pub status: String,
    }
}
#[path = "../../../../src-tauri/src/mesh_tls.rs"]
mod mesh_tls;
mod mesh_durable_lease_qa {
    include!(concat!(env!("OUT_DIR"), "/stage4am_core.rs"));
}
