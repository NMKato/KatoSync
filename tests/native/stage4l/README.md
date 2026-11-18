# Stage4L native source QA

Run from the repository root:

    cargo test --offline --locked --manifest-path tests/native/stage4l/Cargo.toml --lib

To reuse an existing Cargo build cache, set CARGO_TARGET_DIR to its exact target path
before invoking the command. No Tauri packaging resources or signed app are needed.

This compiles the actual Stage4L src-tauri/src/local_control/agent_scope.rs source
without Tauri app/package resources. Its stub project_registry_load() denies by default
and is not an authentication implementation. It verifies module-level fail-closed
logic and real temporary Git branch/HEAD behavior. It does NOT prove the full
Tauri Local Control integration, real owner registry/auth, signed Mesh or a release binary.
Do not ship this harness as a desktop application.


Current test scope: 8 native Rust tests, including one QA-stubbed project registry and
real temporary Git worktree/commit/HEAD checks. The registry returns an error by
default; its positive fixture only uses the test-created temporary repository root.
This is source-module evidence, NOT a KatoOS owner authentication claim.
