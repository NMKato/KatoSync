# Stage4AF isolated Rust execution-fence QA

Run from the KatoSync repository root:

cargo test --locked --manifest-path tests/native/stage4af/Cargo.toml --lib

This harness compiles the EXACT existing Stage4AC signed job permit, Stage4AD persistent reservation, Stage4AE signed Git HEAD receipt and Stage4AF fresh execution fence source modules under a small, separate native test crate. It invokes a real fixed Git HEAD read in an isolated temporary fixture repository only and uses real Ed25519 signing/verification.

IMPORTANT: The canonical MeshLeaseMachine is replaced here by a deliberately simplified synthetic QA fixture that mimics the published lease API. A passing test DOES NOT prove real TLS, device identity, server grant, production Owner MFA, Keychain signer, authenticated remote job execution or installed app operation. Those require separate feature-enabled full Tauri native tests and physical M2↔M3 end-to-end testing.

The entire executable Git fixture is under #[cfg(test)], so no non-test native executor is emitted. Nothing grants a remote OS command, CLI/API rights or permission to use existing local owner repositories.

The Cargo.lock file must be committed and used with --locked to make the QA dependencies reproducible. No deployment.
