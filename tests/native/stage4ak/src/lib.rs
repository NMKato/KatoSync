//! Stage4AK — isolated QA of the REAL canonical MeshLeaseMachine source.
//! Build script removes unrelated Tauri network submodules only in a temp copy.
//! The included canonical state machine and stage4ak test module are unchanged.
#![allow(dead_code)]
mod mesh_durable_lease_qa {
    include!(concat!(
        env!("OUT_DIR"),
        "/mesh_durable_lease_qa_stage4ak.rs"
    ));
}
