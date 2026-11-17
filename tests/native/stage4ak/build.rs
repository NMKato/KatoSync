// Test-only source bridge: never modifies or builds a production binary.
use std::{env, fs, path::PathBuf};
fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let root = manifest.join("../../..").canonicalize().unwrap();
    let source = root.join("src-tauri/src/mesh_durable_lease_qa.rs");
    let stage4ak = root.join("src-tauri/src/mesh_durable_lease_qa/stage4ak_revoke_qa.rs");
    println!("cargo:rerun-if-changed={}", source.display());
    println!("cargo:rerun-if-changed={}", stage4ak.display());
    let mut text = fs::read_to_string(&source).unwrap();
    // Only remove unrelated network and job submodules from this temporary
    // isolated compilation; ALL canonical MeshLeaseMachine logic is retained.
    for module in ["mod inchannel_qa;", "mod signed_job_qa;"] {
        assert_eq!(text.matches(module).count(), 1);
        text = text.replacen(module, "", 1);
    }
    // Rust include! accepts no inner module doc comments after expansion.
    text = text.replace("//!", "//");
    let relative = "#[path = \"mesh_durable_lease_qa/stage4ak_revoke_qa.rs\"]";
    assert_eq!(text.matches(relative).count(), 1);
    text = text.replace(
        relative,
        &format!("#[path = {:?}]", stage4ak.to_string_lossy()),
    );
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("mesh_durable_lease_qa_stage4ak.rs"),
        text,
    )
    .unwrap();
}
