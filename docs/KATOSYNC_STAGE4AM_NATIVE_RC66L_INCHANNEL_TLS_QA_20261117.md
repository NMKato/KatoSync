# KatoSync Stage4AM — native pinned rustls in-channel RC66L revoke QA

**Date:** 17 November 2026 · **Repository:** `NMKato/KatoSync` · **Branch:** `qa/stage4am-native-rc66l-inchannel-20261117` · **Parent:** Stage4AL `681fb08`.

## Scope

This is a private, non-production **source-only native QA** extension of the pre-existing Stage4AB.2 Mesh `inchannel_qa.rs` implementation, under **`#[cfg(test)]`** only.

- Original native `mesh_tls.rs` generates test-only Ed25519 device TLS certificates and configures mutually authenticated TLS **1.3** using its existing peer fingerprint + public key + certificate pins. Original native `inchannel_qa.rs` establishes a paired TLS handshake and its in-channel heartbeat with `ChannelBinding` and `MeshLeaseMachine` from the real source. There is **no production caller**, public listener, remote command or Keychain read.
- After a successfully admitted heartbeat **on the same still-open mutually pinned rustls stream**, the test-only sender emits a bounded `KAMREV01` frame carrying the exact compact Ed25519 RC66L revoke JWS (15-second lease). The device tests the pinned issuer public key and `kid`, domain-separated `typ`, exact 20 claim keys, UUID identities, Owner identity tied to the native `ChannelBinding.owner_id`, both actual device public-key hashes tied to the live TLS binding, the expected tenant/client/grant/consent/session/project/task/sequence and synthetic RC66K receipt SHA.
- The client transitions the **real** native `MeshLeaseMachine` into `Revoked` and only then writes an exclusive mode-0600, fsynced and directory-synced local QA marker. A second delivery with the same signed digest and sequence is idempotent; different signed bytes/sequence, symlinks and torn markers are rejected without reauthorization.
- The client signs a separate bounded `KAMACK01` response JWS with the authenticated **device's own** Ed25519 key, containing the exact audit/device/task/sequence/notice hash and `persisted=true`. The test-only sender verifies the receipt with the independently pinned recipient verification key before considering the local QA exchange successful.
- Negative native scenarios cover forged issuer, cross-task or cross-Owner binding, incomplete authenticated TLS frame, altered replay sequence and poisoned persisted marker. All operations remain confined to a temporary private test directory and loopback socket.

**The native fixture uses the original pinned `mesh_tls.rs` and canonical state machine source, but a minimal test-only `ApprovedPeer`/fingerprint stub in place of the real macOS Keychain owner registry.** It therefore does not establish real owner consent, current RC66K outbox records, Cloudflare data delivery or authorization to perform device commands.

## Verified local QA results (17 November 2026)

- **Native Rust: 30/30 PASS**, including original Mesh state machine tests, original pinned rustls/mTLS tests and five new Stage4AM native scenarios. The new RC66L-shaped signed frame was sent on the same locally opened, mutually authenticated TLS 1.3 loopback stream that carried the original in-channel heartbeat. The receiver's real canonical Mesh lease became revoked before its private 0600 journal was fsynced; an independently device-signed JWS receipt then crossed the same TLS socket and was verified by its sender.
- **Node contract and regression: 69/69 PASS**, including the Stage4AL cross-repository RC66L JWS contract, with zero skipped tests.
- Source-only Rust probe uses test-held ephemeral Ed25519 signer keys and a synthetic RC66K correlation digest; none originates from a current KatoOS authority, real RC66K outbox or physical remote Mac. The application is not running this test receiver as a production service.
- Native parser accepts RC66L's JSON.stringify insertion-order payload while cryptographically verifying the exact signed input bytes. Rust's own map ordering is never treated as the server's canonical wire order.

## QA harness

`src-tauri/src/mesh_durable_lease_qa/inchannel_qa/stage4am_rc66l_native_qa.rs` is included ONLY from the production-source `inchannel_qa.rs` through `#[cfg(test)]`.

`tests/native/stage4am` builds the original modules in an independent Cargo test crate. Only the unrelated signed-job child module is omitted from a build-script-generated temporary copy of the original Mesh state-machine source. Neither the original TLS configuration, in-channel handshake, canonical state machine nor Stage4AM receiver implementation is replaced or mocked.

```bash
CARGO_TARGET_DIR=/path/to/local-cached-target cargo test --offline --locked --manifest-path tests/native/stage4am/Cargo.toml
node --test tests/meshStage4AMNativeRc66lInchannelContract.test.mjs
```

The test leaves no new public MCP/Tauri/Worker route, no production lease, no production credentials and no remote Git/OS capability. `git push` applies only to the isolated source branch and does not deploy code.

## Remaining production NO-GO

1. Replace the synthetic independent issuer/RC66K digest with **actual KatoOS verified server-authoritative** owner, consent, grant and revoked-device record; persist and reconcile a signed monotonic revocation epoch.
2. Integrate the receiver into an explicitly approved native Mesh supervisor on devices **without relying on test-only `cfg(test)`**, retaining immutable Keychain owner and recipient pins and never exposing generic remote actions.
3. Exercise the actual protocol on **two physical Macs** with live native rustls on the existing device Mesh, detached/reconnected or rebooted peer, and a durable signed delivery/receipt ledger acknowledged by the private RC66L server.
4. Conduct separate owner-approved, scoped, continuously rechecked read-only admission tests before considering any execution. This stage **does not** authorize remote commands.

**Release state: source-only QA; production RC66K→native Mesh delivery and remote execution remain NO-GO.**
