# KatoSync Stage4AH – Signed revoke admission and cancellable QA child

**Date:** 16 November 2026. **Developer:** NMKato Solutions. **Branch:** `qa/stage4ah-signed-revoke-cancel-20261116`. **Base:** local Stage4AG `d07a751`.

## What is implemented

Stage4AG prevented a locally observed revoke from racing with test-only Git process creation or durable receipt persistence. Stage4AH extends that isolated Rust QA boundary:

- A **domain-separated Ed25519 signed revocation notice** is authenticated by a **pinned synthetic control-plane public key**. The original read-only task permit is separately verified by its pinned synthetic issuer. The notice must match the original Owner, Tenant, session, client, local/peer device keys, project, task ID and strictly increasing sequence; timestamp window and event ID are checked.
- Valid event delivery sets a **sticky, in-memory** local revocation state even if the Mesh session is offline. Replays and older sequences are refused, and the revoked gate never rearms.
- The native **test-only** Git HEAD fixture is now polled for local revocation and uses bounded wait, kill and reap on revoked generation or timeout. A separate fixed `sleep` QA child proves that a signed revocation delivered during a running process terminates that child rather than allowing completion. The durable Stage4AE result receipt remains protected by Stage4AG's local lock.

The isolated code never exposes a Tauri IPC command, public MCP tool, remote OS command, server endpoint, or production Git executor. All signing keys and grants in tests are synthetic; the `sleep` process is a disposable child created by the QA test.

## Non-goals and risks

**Not a live RC66K integration.** RC66K Draft PR #52 defines a private leased SQL outbox, JWS signed acknowledgements and claim/ACK semantics. Stage4AH uses its own synthetic domain-separated binary notice, not the RC66K wire JWS or production signature keys. No Supabase, Cloudflare, ChatGPT MCP or device-side notification was fetched or sent.

**Not a durable revocation state.** Stage4AH sequence tracking lives in a process-local mutex. A fresh process or device restart has no persisted epoch. Production must persist the most recent verified revocation sequence, reconcile from the authoritative server before reopening any lease, and treat unavailable or conflicting authority as closed.

**Not a distributed atomic revoke.** A remote revoke may not reach the device; a child can complete before the message arrives. Native cancellation can only react to a *locally verified* event. Delivery retries, persistent acknowledgements, Keychain-pinned production identities, live GoTrue MFA, RC66I/J/K guard binding, signed Mesh transport, server-side final consent and cross-device race tests are still missing.

## Verification and handoff

Run locally on Mac.fritz.box (Apple M2 Pro) without CI billing:

```bash
node --test tests/meshStage4ACSignedJobContract.test.mjs tests/meshStage4ADJournalContract.test.mjs tests/meshStage4AESignedReceiptContract.test.mjs tests/meshStage4AFExecutorFenceContract.test.mjs tests/meshStage4AGRevocationFenceContract.test.mjs tests/meshStage4AHRevocationDeliveryContract.test.mjs
cargo test --offline --locked --manifest-path tests/native/stage4af/Cargo.toml
git diff --check
```

Next **Stage4AI** requires a real RC66K-to-native wire adapter with pinned production trust keys, durable sequence/recovery and controlled physical two-Mac delivery QA, then explicit owner approval for any live read-only task. **Keep Draft / NO-GO** for production remote execution.
