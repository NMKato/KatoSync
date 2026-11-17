// Test-only build harness reads real Rust sources and preserves their code.
// Only unrelated signed-job module is omitted from temporary compilation.
use std::{env, fs, path::PathBuf};
fn main() {
    let dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let root = dir.join("../../..").canonicalize().unwrap();
    let source = root.join("src-tauri/src/mesh_durable_lease_qa.rs");
    let inchannel = root.join("src-tauri/src/mesh_durable_lease_qa/inchannel_qa.rs");
    let revoke = root.join("src-tauri/src/mesh_durable_lease_qa/stage4ak_revoke_qa.rs");
    let new_module =
        root.join("src-tauri/src/mesh_durable_lease_qa/inchannel_qa/stage4am_rc66l_native_qa.rs");
    for item in [&source, &inchannel, &revoke, &new_module] {
        println!("cargo:rerun-if-changed={}", item.display());
    }
    let mut text = fs::read_to_string(source).unwrap().replace("//!", "//");
    assert_eq!(text.matches("mod signed_job_qa;").count(), 1);
    text = text.replacen("mod signed_job_qa;", "", 1);
    assert_eq!(text.matches("mod inchannel_qa;").count(), 1);
    text = text.replacen(
        "mod inchannel_qa;",
        &format!(
            "#[path = {:?}] mod inchannel_qa;",
            inchannel.to_string_lossy()
        ),
        1,
    );
    let rel = "#[path = \"mesh_durable_lease_qa/stage4ak_revoke_qa.rs\"]";
    assert_eq!(text.matches(rel).count(), 1);
    text = text.replace(rel, &format!("#[path = {:?}]", revoke.to_string_lossy()));
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("stage4am_core.rs"),
        text,
    )
    .unwrap();
}
