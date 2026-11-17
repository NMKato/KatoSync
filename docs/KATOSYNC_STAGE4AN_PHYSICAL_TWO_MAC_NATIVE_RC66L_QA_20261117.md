# Stage4AN — Physical two-Mac native Mesh RC66L revoke QA

**Date:** 17 November 2026 · **Repository:** `NMKato/KatoSync` · **Base:** Stage4AM `a4dd1c0` · **Branch:** `qa/stage4an-two-mac-native-revoke-20261117`.

## Verified physical topology

- **M2 Pro — sender:** `Mac.fritz.box`; ephemeral, private Tailnet-only native rustls/TLS 1.3 server. It uses the original KatoSync `mesh_tls.rs` and `inchannel_qa.rs` certificate pinning and sends the RC66L-shaped signed frame only after the normal authenticated Mesh `OPEN/ACCEPT/BEAT/REPLY` heartbeat.
- **M3 Air — recipient:** `MacBook-Air-von-Nikolas.fritz.box`; another actual Apple Silicon machine, executing the same exact native test binary over the private Tailnet with its own freshly generated local Ed25519 device key.
- Only public certificate/verification-key manifests and a **synthetic**, independently copied Owner/tenant/grant/consent/device/task scope were exchanged. Each machine generated its own mode-0600 private device signing seed; the M2 generated a **separate** temporary issuer seed. **No private keys were transferred.** No KatoOS/MFA/RC66K production authority was used.
- The 11 MB macOS ARM64 QA executable was copied on a temporary Tailnet-only, IP-bound HTTP server, verified against an exact SHA-256 on the M3 and the transfer server stopped. The executable has no provisioned credentials; the actual key seeds were generated locally only AFTER transfer.

## Physically observed native results

All below used **two different computers** and a genuine pinned mutually authenticated TLS 1.3 socket, not an in-process loopback.

| Scenario | M3 | M2 |
|---|---|---|
| Server revoke signed by an unpinned foreign issuer | **DENY, no device ACK** | **No valid ACK** |
| Valid signer, wrong task ID | **DENY, no device ACK** | **No valid ACK** |
| Authenticated sender closes halfway through the framed revoke | **DENY, no device ACK** | **Negative delivery** |
| Valid, bound, domain-separated Ed25519 revoke | **Durable fsynced marker, canonical Mesh `Revoked`** | **Pinned device-signed JWS receipt verified** |
| Byte-exact second delivery on the **same TLS session** | **Idempotent marker, second signed ACK** | **Second independently verified device ACK** |
| M3 recipient restarted as an entirely new process (not full OS reboot) | **Previously fsynced marker independently verified; no remote execution** | Not applicable |

Positive terminal evidence (sensitive payloads omitted):

```text
M3 STAGE4AN_M3_NOTICE_VERIFIED_TURN=0
M3 STAGE4AN_M3_JOURNAL_FSYNC_PASS_TURN=0
M3 STAGE4AN_M3_SIGNED_DEVICE_ACK_SENT_TURN=0
M3 STAGE4AN_M3_NOTICE_VERIFIED_TURN=1
M3 STAGE4AN_M3_JOURNAL_FSYNC_PASS_TURN=1
M3 STAGE4AN_M3_SIGNED_DEVICE_ACK_SENT_TURN=1
M3 STAGE4AN_M3_NATIVE_MTLS_REVOKED_FSYNC_SIGNED_ACK_REPLAY_PASS
M2 STAGE4AN_M2_RECEIPT_CRYPTO_VERIFIED_TURN=0
M2 STAGE4AN_M2_RECEIPT_CRYPTO_VERIFIED_TURN=1
M2 STAGE4AN_M2_NATIVE_TLS_TWO_SIGNED_DEVICE_RECEIPTS_PASS
M3 STAGE4AN_M3_NEW_PROCESS_PERSISTENT_REVOKE_PASS_NO_REMOTE
```

The success marker on M3 is a mode-0600 synthetic QA file. Observed marker SHA-256: `ea71b7470981a7a39153d32607dca94cca9d64b3c079c11c488c7c28e7b2f5bf`. This is not a production device/grant state or a real server ACK ledger.

## Clock-skew issue found and fixed

The first real physical positive run persisted the M3 revoke and delivered its signed device ACK but the M2 rejected the otherwise correctly signed ACK. The root cause was **approximately 2–3 seconds of positive wall-clock skew on the M3** while the receipt verifier rejected *any* future timestamp.

The test-only native device ACK verifier and the private source-only RC66L server verifier now allow **at most 5 seconds positive clock skew**, retaining the **15-second receipt age bound**, exact pinned-device signature verification, original signed notice hash, Owner/Grant/Task/Consent scoping and fresh final server revocation read before committing an outbox ACK. A test explicitly permits a +4s device clock and **rejects +6s**, plus stale timestamps. This is *not* an extension of command lease or authorization. Keep the 5s drift ceiling when designing production time synchronization; timestamps alone are not an anti-replay epoch.

Cross-repository server QA branch: `NMKato/KatoSync-Remote-MCP` → `qa/rc66l-device-receipt-barrier-20261117`, 485/485 Node regression, package typecheck PASS, NO-GO.

## Source-only safety boundaries

- All new physical functionality resides in `src-tauri/src/mesh_durable_lease_qa/inchannel_qa/stage4am_rc66l_native_qa/stage4an_physical_qa.rs`, a **child of the existing `#[cfg(test)]`-only Stage4AM receiver**. Its entry requires deliberate `STAGE4AN_ACTION` and a private, local `STAGE4AN_ROOT`; the listener accepts a literal IP in the **private Tailscale 100.64.0.0/10 range** only.
- The native transport, `ChannelBinding` and `MeshLeaseMachine` are from the original repo source, compiled in the isolated Stage4AM Cargo harness. Keychain `ApprovedPeer` and verified KatoOS account credentials are **not** wired in this harness; pins are manually exchanged public QA fixtures.
- Full native Rust offline tests: **33/33 PASS**, including additional signed-ACK clock-skew fixture; Node security/contract regression: **74/74 PASS**, including Stage4AL cross-repository verification. Additional independent regressions re-run in this stage: **56/56 Stage4AF native Rust PASS** and **16/16 Stage4AK canonical Rust PASS**. The ordinary Rust suite's physical-test function is **inactive when `STAGE4AN_ACTION` is unset**; only the separate explicit runs listed above prove the physical result.
- Previous synthetic source-only security fences, Stage4AF and Stage4AK, are not modified by this stage. There is no production Tauri IPC route, Worker endpoint, real DB write, Keychain secret export, general-purpose terminal, GUI or Git device command.
- **Private QA key-file cleanup completed on both M2 and M3:** the M2's locally created device and issuer seed files were removed; the M3's local device seed copies in all four isolated QA roots were removed. The temporary M3 test executable and M2 HTTP-served binary were removed, and the binary HTTP transfer listener was verified stopped. File deletion is not claimed to constitute forensic secure erasure on APFS. Only the synthetic public metadata and the mode-0600 persistent M3 marker remain for QA evidence. Nothing was exported to a production key store. A retained marker must never be interpreted as a grant.

## Remaining production blockers — strict NO-GO

1. **Actual KatoOS/GoTrue authoritative issuer** (fresh, signed and tenant-scoped grant/consent/revocation state) and a real private RC66L/RC66K outbox dispatch; the correlation hash in this test is explicitly SYNTHETIC.
2. Deploy a controlled, long-lived, authenticated native Mesh supervisor only after proper Owner approval; Keychain-backed native peer pin, durable monotonic revoke epoch, offline/reconnect/reboot and rollback protection, and server-authoritative final execution rechecks.
3. Return an independently verified physical device ACK to the **actual RC66L private server ledger** and only then acknowledge the real SQL outbox event; maintain fail-closed behavior if M3 offline or ACK missing.
4. Separate owner-approved scoped read-only task admission; **no remote Git/OS execution by this test**.

**Decision:** Stage4AN physical **native mTLS + signed revoke + two device ACKs + sticky new-process reopen QA PASS**. Productive RC66K→KatoSync delivery, client permissions and remote actions **NO-GO**.
