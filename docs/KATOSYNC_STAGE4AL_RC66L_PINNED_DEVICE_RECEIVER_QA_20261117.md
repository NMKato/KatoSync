# KatoSync Stage4AL — RC66L signed device revoke recipient (source-only QA)

**Date:** 17 November 2026 · **Branch:** `qa/stage4al-rc66l-pinned-device-receiver-20261117` · **Base:** Stage4AK commit `2f08ef5`.

## Cross-repository contract

The independently developed RC66L server-private QA barrier is in `NMKato/KatoSync-Remote-MCP`, branch `qa/rc66l-device-receipt-barrier-20261117`, commit `09b03880c72b5fb36f1b3442d4904fbf9fd03f28`. It verifies a synthetic RC66K control-plane EdDSA/JWS ACK, requires a fresh **committed revocation with an inactive device grant** and produces a *separate* task/session/device-bound EdDSA/JWS revoke notice. Its outbox-ack adapter cannot be invoked before an independently device-signed persisted receipt has been verified and the private revocation authority rechecked.

Stage4AL adds the corresponding **test-only** device receiver `scripts/qa-stage4al-rc66l-device-recipient.mjs`. It verifies the actual RC66L JWS wire format independently using Node crypto against an out-of-band pinned issuer public key and `kid`. The required signature covers exact audit/worker/lease/Owner/tenant/grant/consent/device/client/session/project/task/local-and-peer public-key hashes/ordered sequence/the hashed RC66K ACK/15-second timestamps.

Before accepting the signed notice, the receiver checks an **independent synthetic current Mesh-session proof** containing TLS 1.3, mutual peer authorization, live socket, owner and exact two device-key pins, a nonzero hashed session nonce, fresh heartbeat and deadline. This synthetic proof must eventually be replaced with the canonical native `ChannelBinding` from the *existing still-open rustls socket*. Peer/model-originated proof is not an acceptable production substitute.

Only after full signature and exact-scope validation does the QA receiver create and fsync a mode-0600, exclusive private `/tmp/katosync-stage4al-.../rc66l-device-revoked.lock` journal entry. A repeated **byte-identical** valid revoke produces an idempotent signed persisted receipt; a different sequence/digest, torn or symlinked journal entry blocks receipt creation. Missing journal on restart always means `CLOSED_PENDING_SERVER_RECONCILIATION`, never execution authority. The resulting Ed25519-signed recipient JWS has `typ=katosync-rc66l-qa-device-persisted+jws` and binds audit/device/task/sequence/notice hash and the persistence assertion.

The server-side RC66L module independently verified an actual receiver-produced JWS in a **cross-repository test** without hardcoding its fixture signature. The sender and recipient implementations therefore agree on the signed wire format.

## Evidence

- Remote-MCP RC66L branch: **484/484 npm tests PASS**, package typecheck PASS, source-only, committed and pushed.
- KatoSync Stage4AL recipient: **9/9 new tests PASS including 1 cross-repository JWS validation**, local cryptographic signing/verification, durable marker/idempotence and multiple fail-closed negative paths.
- KatoSync existing Stage4AC–Stage4AL Node regression: **64/64 PASS (no skipped tests)** when the RC66L Remote-MCP QA checkout is supplied via `RC66L_REMOTE_QA_REPO`.
- The canonical native `MeshLeaseMachine` Stage4AK tests (**16/16 Rust**) and Stage4AF executor fences (**56/56 Rust**) passed on the previous source stage; those native sources are unmodified by Stage4AL.
- Stage4AJ's earlier physical **M2 Pro ↔ M3 mutual TLS 1.3** revoke delivery was a separate *synthetic* QA transport demonstration. This new RC66L format has **not** yet been delivered on the original native Mesh rustls in-channel transport.

## Execution boundaries and Stage4AM

This receiver is **not registered as a production Tauri IPC, native command, MCP tool or operating-system service**. Its TLS-session evidence is a passed-in trusted QA fixture, not a live socket token. The journal is QA-only /tmp storage, not approved device persistence. Private fixture signing keys are generated in tests, not obtained from macOS Keychain. No actual Supabase/GoTrue/KatoOS authority, production RC66K outbox transaction, Cloudflare Worker route, real device permission or remote Git/OS task was used.

**Before production release:**

1. Native canonical Mesh in-channel framing on the still-open pinned rustls connection, with real sender/receiver keys, separate receipt and checked lease-epoch/sequence journal.
2. Server-signed authorization sourced from actual KatoOS verified tenant/owner/grant/consent data; committed revocations must remain deliverable without fresh owner login.
3. Server outbox ACK only after independently verified device fsync/ACK and final authority recheck; authoritative server durable receipt ledger and offline/reconnect/reboot replay handling.
4. Secure API, device review, code merge, deployment and separate user-approved read-only execution admission.

**Decision: Stage4AL inter-repository signed-format QA PASS; live production RC66K-to-native-Mesh delivery NO-GO.**

## Reproduce without production access

```bash
RC66L_REMOTE_QA_REPO=/absolute/path/to/pinned-qa-remote-repo node --test tests/meshStage4ALRc66lDeviceRecipient.test.mjs
node --test tests/meshStage4ACSignedJobContract.test.mjs tests/meshStage4ADJournalContract.test.mjs tests/meshStage4AESignedReceiptContract.test.mjs tests/meshStage4AFExecutorFenceContract.test.mjs tests/meshStage4AGRevocationFenceContract.test.mjs tests/meshStage4AHRevocationDeliveryContract.test.mjs tests/meshStage4AIRc66kBoundaryContract.test.mjs tests/meshStage4AJPhysicalRevokeContract.test.mjs tests/meshStage4AKRc66kMeshBridge.test.mjs tests/meshStage4AKCanonicalMeshContract.test.mjs tests/meshStage4ALRc66lDeviceRecipient.test.mjs
```

A missing `RC66L_REMOTE_QA_REPO` causes only the explicit cross-repo test to skip; it must be present for a 64/64 certification.
