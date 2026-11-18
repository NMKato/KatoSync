# Native terminal-profile focused tests

This small crate includes the real production consent, signed request/result,
server proof, and bounded Git runner sources by path. It exercises the exact
Connector-generated fixture, single-use receipts, cancellation races, replay,
scope/expiry failures, and an actual fixed git --version process.

Owner authentication, registered devices, live registry lookup and the WSS
session boundary fail closed in this offline harness. They never mint a
credential, contact a service, or grant a native operation. The complete
Tauri/HTTP/WSS composition and IPC registration remain the responsibility of
the existing Beta4 native library and package workflow.

Run from the repository root with the pinned Rust toolchain:

~~~sh
cargo test --locked --manifest-path qa/terminal-profile-harness/Cargo.toml --lib -- --test-threads=2
~~~
