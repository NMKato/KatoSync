# RC72 – Desktop pins Connector RC70 Ed25519 server notices (source-only QA)

**Date:** 17 Nov 2026 · **no application runtime, no Cloudflare deployment, no live M2/M3 access.**

## Pinned upstream contract
- Connector [Draft #55](https://github.com/NMKato/KatoSync-Remote-MCP/pull/55), commit `0b8c7a84bde003c9bd7e26e05f97e50cdef4c912`.
- Canonical [`contracts/rc70-desktop-relay-signed-gate.json`](https://github.com/NMKato/KatoSync-Remote-MCP/blob/feat/rc70-signed-katoos-admission-20261117/contracts/rc70-desktop-relay-signed-gate.json), protocol `rc70-katosync-private-beta0-signed-relay-v1`.
- Server public key **must be pinned from an independently verified KatoOS enrollment**. The `serverKid` value received over the WebSocket is never evidence of trust, and no JWK/jwksUri from a device response may establish authority.

## Implemented Desktop verifier
- Source `src-tauri/src/mesh_rc72_signed_server_qa.rs` compiles with existing `ed25519-dalek`, Base64url and `serde_json` dependencies; it uses the **exact RC67 Compact JWS** `alg=EdDSA`, `typ=katosync-rc67-duplex-relay+jws`.
- Verifies the original JWS protected bytes with the out-of-band pinned Ed25519 public key **before parsing the signed payload**. Denies modified body/signature, mismatched pinned kid, unknown JSON fields, duplicate protected headers and malformed tokens.
- Requires `cloud_to_device/mesh.notice`, version 1, exact owner/tenant/grant/device/session IDs, strictly advancing server sequence, safe JavaScript number bounds, and exact 15-second signature expiry with limited clock skew.
- Exact notice bodies: `rc70.challenge` (challengeId, protocol, transport, revokeEpoch), `rc70.presence.accepted` (challengeId, acceptedSequence), and `rc70.result.accepted` (requestId, acceptedSequence). Result ACK request ID is bound to its signed outer frame.
- Companion `verify_rc70_challenge_packet` parses the 14-field RC69 WebSocket message with `serverProofJws` and `serverKid` and rejects a mismatched signed challenge, pinned key, revocation epoch or session ID. All outer plaintext fields are only compatibility markers, never an independent grant.
- Native real Ed25519 signature, wrong key, foreign tenant, replay, expired TTL, modified signature, unknown or missing proof and signed presence/result ACK tests are imported from the **same source** into the small `qa/rc69-presence-harness` and run on GitHub macOS and Windows.

## Non-negotiable NO-GO
This is a **verifier building block**, deliberately included only under `katoos-auth-qa`. It has **no Tauri IPC or runtime caller**, touches **no Keychain** and does **not** emit a heartbeat, device presence, native tool call, or `tool.result`. The existing RC71 no-pin QA WebSocket route remains quarantined/fail-closed.

Before the first real M2/M3 connection, Connector #55 must be promoted from private synthetically backed DO QA to securely provisioned KatoOS-owner-authorized device tickets, stable rotated server key distribution, persistent server signed ACK state and a genuinely deployed but access-controlled DO WSS route. Desktop must then bind this verifier to the real RC70 WSS supervisor with stored sequence watermark, actual Keychain identity and project-approved read-only grants, then test physical M2/M3 presence/revocation/reconnect and ChatGPT `katosync_devices_list/status`.

Separately, [Desktop security blocker #282](https://github.com/NMKato/KatoSync/issues/282) tracks upstream unpatched `picomatch` ReDoS audit failure, without suppressing the build gate.

**Do not merge or advertise a live device Beta on source-only proof.**
