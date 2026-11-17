# RC71 – RC69 private Durable Object ticket / challenge interoperability (Desktop QA)

**Date:** 17 November 2026. **Scope:** private QA protocol interop only. Never deploy, auto-start a socket, expose MCP native commands or claim M2/M3 authenticated.

## Pinned Connector authority

- Connector repository: [NMKato/KatoSync-Remote-MCP, Draft PR #54](https://github.com/NMKato/KatoSync-Remote-MCP/pull/54), SHA `fca38c3cf5e57768cba40b81bfc5c61d41852e69`.
- Normative published compatibility contract: [`contracts/rc69-beta0-handshake.json`](https://github.com/NMKato/KatoSync-Remote-MCP/blob/feat/rc69-beta0-private-wss-branding-20261117/contracts/rc69-beta0-handshake.json), schema `rc69-private-beta0-wss-qa-v1`.
- DO QA admission route `/private/rc69/device-wss`; `GET` with `Upgrade: websocket`, one-time `X-KatoSync-Relay-Ticket` of 64 lowercase hexadecimal digits. 256-bit ticket, 30-second TTL; the DO stores SHA256 and consumes tickets once.
- DO responds with **unsigned** JSON `rc69.challenge`, including `sessionId`, `challengeId`, `revokeEpoch`, `nonceIssuedAtMs`, `challengeExpiresAtMs`, `expiresAtMs`, `frameTtlMs:15000`. This is **not a cryptographic server-authenticated session**. It is intentionally only used for QA compatibility.

## Desktop work delivered

- `src-tauri/src/mesh_rc71_rc69_ticket_qa.rs` reuses the existing RC70 endpoint allowlist, TLS-WebSocket connector and bounded WebSocket buffer. Requires exact RC69 route; refuses query tokens, non-approved hosts and non-TLS remote endpoints.
- Ephemeral ticket is constrained to **64 lowercase hex** characters and short TTL, injected only in a WebSocket upgrade header. **No automatic retry of consumed tickets, no secret logging, no Tauri IPC and no app auto-start.**
- Strict parser confirms *shape only* of the 12-field RC69 QA challenge. Even a correctly formatted challenge results in `RC71_UNSIGNED_QA_CHALLENGE_REJECTED` and **WebSocket policy close 1008**. No Keychain keys, signed device heartbeats, native Git reads or `tool.result` are invoked.
- A real loopback native Rust test upgrades over `ws://127.0.0.1` (available ONLY in `#[cfg(test)]`), verifies exact ticket header, receives an RC69-shaped unsigned challenge and asserts policy close. Negative tests cover bad/expired ticket, wrong path, malformed frame and injected privilege claims. **This is a protocol-level local QA test, not Cloudflare Workerd or WAN E2E.**
- `tests/meshRc71TicketedRelayContract.test.ts` tests source isolation, and the existing native macOS + Windows CI matrix compiles and executes the *exact* Rust source in `qa/rc69-presence-harness`.

## Hard NO-GO for live integration

The Connector RC69 QA-only DO is **not publicly routed** and uses synthetic Owner/Tenant/Grant/Device consent data. Its challenge and result acknowledgements are not independently server-signed. Production/Private-Beta GO still requires:

1. A version-pinned, production-authorized WSS route and secure ticket *provisioning* from a verified KatoOS Owner/Device/Grant/Consent authority; no self-asserted device data.
2. Separately signed server challenge **and signed ACK** with pinned server Ed25519 public key ID and rotation, bound to exact ticket/session/tenant/device and server sequence.
3. Real Stage4AB OS-Keychain device Ed25519 signing, 15-second signed heartbeat, server replay/CAS confirmation and native scoped read-only result, with wrong-key/owner/revoke/replay/expiry/abort negatives.
4. Physical M2/M3 and ChatGPT `katosync_devices_list/status` E2E confirmation, without external Remote Desktop Commander proxy.
5. Independent Web Build audit remediation for `picomatch` before general Beta release. Do not disable audit.

**Current live connector:** `authenticated_synthetic_qa`, `meshConnected=false`, `deviceAccessEnabled=false`. No delivery promise; no production environment changes.
