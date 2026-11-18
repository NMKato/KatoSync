# RC73 – Ticketed WSS + pinned signed challenge: first real native handshake integration

**18 November 2026 · Desktop Beta Draft PR #281 · SOURCE/LOOPBACK QA ONLY · no live M2/M3 or Cloudflare DO**

## Existing contract

The upstream [Connector RC70 Draft #55](https://github.com/NMKato/KatoSync-Remote-MCP/pull/55), SHA `0b8c7a84bde003c9bd7e26e05f97e50cdef4c912`, defines `rc70-katosync-private-beta0-signed-relay-v1`. The actual device WSS route `/private/rc69/device-wss` is still only available inside synthetic Workerd QA. The public MCP endpoint remains a separate OAuth route and has no live device tools.

RC71 already supplied a ticket-only outbound WebSocket upgrade, and RC72 supplied a strict out-of-band pinned Ed25519 server proof verifier, but neither was previously called by the other.

## RC73 integrated implementation

`src-tauri/src/mesh_rc71_rc69_ticket_qa.rs` now additionally exports `probe_private_rc70_pinned_upgrade` reusing the existing RC70 TLS endpoint allowlist, bounded native websocket, RC71 64-character/30s one-time header ticket, and the exact RC72 `verify_rc70_challenge_packet` source.

Only an **independently provisioned** `PinnedServerContext` and independently provided `challengeId` and `revokeEpoch` are accepted. The received 14-field `rc69.challenge` is a mere transport wrapper; it cannot choose the trusted server public key. Ed25519 proof verification binds owner/tenant/grant/device/session/challenge, expires at 15s and rejects stale/replayed server sequences.

**Crucial fail-closed QA boundary:** after a cryptographically valid server challenge the QA socket is **still closed with WebSocket policy code 1008**. No heartbeat, no Keychain device identity read, no online status, no native Git status, no remote job, no Tauri command and no automatic network startup. The function only returns proof of the signed notice from its one-time QA socket, not an authenticated KatoSync session.

## Native and source QA

- The original unsigned RC71 `rc69.challenge` probe remains unchanged and refuses unsigned payloads.
- Added actual TCP/WebSocket loopback Rust test verifying a valid signed RC70 challenge over an RC69 one-time-ticket upgrade with out-of-band pinned Ed25519 public key; test asserts policy close and **no device application frame**.
- Added negative real-socket test cases with wrong signing key pin, replayed server sequence, mismatched signed session, and unsigned challenge; all must close with policy code 1008.
- The existing `qa/rc69-presence-harness` imports the **exact app Rust file**, while `tests/meshRc73PinnedWssInterop.test.ts` guards source isolation. The GitHub macOS/Windows native matrix includes both.

## Remaining genuine private Beta GO gates

1. Connector KatoOS independently verified production Owner/ClientGrant/DeviceConsent → one-time ticket admission and controlled live DO route, without synthetic fixture attributes.
2. Durable out-of-band server Ed25519 key pin/key rotation (never self-proclaimed via `serverKid`).
3. Authenticated and persisted session/sequence/revoke/consent state plus live Keychain-bound M2/M3 device signed heartbeats and signed ACKs.
4. Authorized real `katosync_devices_list` / `katosync_device_status` through ChatGPT MCP, then separately approved project-scoped Git read.
5. Fix or properly remediate the independently tracked upstream [picomatch security audit blocker #282](https://github.com/NMKato/KatoSync/issues/282) before general Beta release.

No production Worker deploy, app install, or Git merge has been authorized by this source QA.
