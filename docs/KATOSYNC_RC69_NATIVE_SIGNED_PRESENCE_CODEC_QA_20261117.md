# KatoSync Desktop RC69 – RC67/RC68 signed presence codec (source QA, 17.11.2026)

**No WSS connection, no device access, no live Cloudflare DO, no ChatGPT device tool.** This slice only prepares an additive native JOSE compact-EdDSA codec compatible with [Connector RC68](https://github.com/NMKato/KatoSync-Remote-MCP/pull/53), as part of [Desktop private Beta #281](https://github.com/NMKato/KatoSync/pull/281).

## Existing desktop code / new code

- Existing `mesh_identity::existing_identity(uid)` loads a registered *existing* account-scoped Ed25519 signing key from protected OS Keychain. Never call `ensure_identity` from an unsolicited relay event; creating new keys changes trust.
- Existing `mesh_directory::mesh_account_devices_list` returns an owner-filtered **discovery** roster with `transport_ready=false` and remote jobs disabled. Do not present this as live devices.
- New `src-tauri/src/mesh_rc67_presence_qa.rs` is compiled only when `katoos-auth-qa` feature is selected. **No Tauri invocation, socket, session refresh, background runner or remote-work permission.**
- The signer accepts a verified-session **input contract** (not a trust proof): server-owned Owner/Tenant/Grant/Device/Session/Challenge UUIDs, pinned `kid`, monotonic sequence and revoke epoch, timestamp and **currently registered read-only** native tool names. Emits RC67 `device_to_cloud / presence.heartbeat`, 15,000ms TTL, JOSE `EdDSA` with exact RC67 `typ` and compact JWS signature.
- Invalid UUIDs, `kid`, time/sequence bounds, unknown/duplicate/write/execute tools fail before signing; no private key or auth token serialized. All device trust/consent/atomic replay checks MUST happen server-side in RC68.
- Tests: native Ed25519 signature verification / wrong-key and tamper rejection / capability and identity negatives; Node contract checks. These **are not a real KatoSync Mesh online or app runtime test**.
- Focused native QA from exact production-source file: `cargo test --locked --manifest-path qa/rc69-presence-harness/Cargo.toml --lib`. This tiny harness avoids unrelated Tauri/macOS dependencies and is independently checked on macOS and Windows by `.github/workflows/rc69-native-presence-qa.yml`. Source-only tests never construct a live socket.

## RC69 Connector dependency – required before runtime WSS client

The Connector team needs to publish a version-pinned, implemented and independently tested QA DO WebSocket handshake contract, including:

1. QA URL, HTTP WSS upgrade + authenticated routing, trusted service signing key and rotation, expected close/reject codes.
2. Server-issued session/challenge response schema, verified grant/device owner and consent preconditions, challenge TTL, revoke-epoch source, durable session/sequence allocation and reconnect/epoch restart handling.
3. Transport-bound RC67 `tool.request`, `tool.result` and ACK schemas (max payloads, signed key IDs, idempotent request IDs); server-owned **atomic** sequence/CAS and signed-result verification.
4. Native event lifecycle (connected, verified signed heartbeat <=15s, TTL expiry, sleep/reconnect/offline/revoke), capability discovery with deny-by-default behavior.

Only after those contracts exist can the Desktop safely call `sign_presence_jws` inside a verified outgoing WSS supervisor with the exact existing Keychain key, then implement actual native handler dispatch to owner-approved projects. A successful TLS WebSocket alone is **not** mutual TLS or Owner approval.

## Release gates

- RC69 Codec source QA: bounded Rust/Node test PASS + full CI (record exact SHA).
- RC69 transport: physical M2 and M3 positive WSS, signed heartbeat, server-side admitted authenticated presence and negative wrong-key/owner/grant/replay/expiry/revoke tests.
- Beta-0 tool: first genuine ChatGPT `devices.list/status` through DO native device result; no synthetic device readback, no hidden external Remote Desktop Commander proxy.
- No automatic merge or app installation while the WSS handshake and native E2E remain open.
