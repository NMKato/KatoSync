# RC70 – Desktop outbound WSS supervisor (QA, 17 November 2026)

**Scope:** Real native WebSocket transport code, with TLS/WebSocket client and reconnect handling. Source is **QA-only**, requires `katoos-auth-qa`, is **not auto-started**, and is **not yet a genuine authenticated Device session**. The live connector still reports `meshConnected=false` and `deviceAccessEnabled=false`.

## Verified Desktop implementation

- `src-tauri/src/mesh_rc70_outbound_wss_qa.rs` is a native Rust/Tokio outbound client using `tokio-tungstenite` and Rustls WebPKI roots; it uses **no listener** on M2/M3 and never opens router ports.
- Hard allowlist: remote `wss://remote-mcp.katoos.de` (default HTTPS/TLS port 443), with explicit path supplied by the separately versioned Connector contract. No credentials in URL or query, no arbitrary hostname, HTTP, insecure WS or nonstandard remote port. A `ws://127.0.0.1` exception exists only in `#[cfg(test)]` for an actual ephemeral WebSocket test server.
- Connection timeout 7s, challenge window 5s, max inbound frame/message 24,576 bytes, bounded exponential reconnect 2→4→8→16s, cancellation during connect/challenge/backoff. No device presence claim is produced by a successful TLS/WebSocket upgrade.
- Before the missing Connector RC69 server-signed challenge/Owner/Tenant/Grant/Device/Session verification is implemented, the supervisor **quarantines all application frames**, closes with policy error and does not forward data to `mesh_rc69_readonly_qa`, `mesh_rc69_result_qa`, Keychain or Tauri IPC. Transport `TransportOpenUnverified` means only the network handshake succeeded, never `connected_authenticated`.
- Existing source-level RC69 key and Git result modules remain independent: `mesh_rc67_presence_qa.rs` / `mesh_rc69_result_qa.rs`. **Do not sign/send** a heartbeat or `tool.result` until the external verified owner+grant+device+session+challenge state is bound, server key pinned and request replay watermark atomically advanced.

## Cross-platform offline QA

The existing `qa/rc69-presence-harness` imports the **exact native Desktop source** and runs native Rust tests on macOS and Windows in the existing matrix. RC70 tests start a real local TCP WebSocket server on `127.0.0.1:0`, verify the transport handshake, ensure an unverified application payload is rejected and closed, and test disconnect/reconnect cancellation. Endpoint allowlist/backoff tests are also included. This is an actual **local socket** test, not a Cloudflare or M2/M3 authentication test.

Command: `cargo test --locked --manifest-path qa/rc69-presence-harness/Cargo.toml --lib`.

## Connector RC69 contract required before actual device activation

1. Published and deployed pinned WSS endpoint path and device-side authentication/upgrade mechanism; no token in URL, no arbitrary client-provided `kid`/Owner values.
2. Server-issued signed challenge/nonce, key rotation policy, device registration and consent/Owner/Tenant/ClientGrant/Session validation, timed challenge and fail-closed rejection.
3. Durable-Object per-device session and atomic monotonic sequence/ACK protocol; signed `presence.heartbeat`, signed `tool.request` and signed `tool.result` exact body schemas plus reconnect/revocation rules.
4. Physical QA of both MacBook M2/M3 using the **existing** Stage4AB Keychain Ed25519 identities, with wrong-key/replay/expiry/owner change/revoke/offline tests; only then enable real `katosync_devices_list` and `katosync_device_status` in ChatGPT.

**No automatic app deployment or productive WSS connection.** No source-only QA result is a live device proof. The independent Web Build / npm high-severity advisory remains an unrelated release gate and must not be skipped.
