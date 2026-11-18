# KatoSync 4.0 – physical native M2/M3 Mesh QA, 2026-11-08

**PASS: Native Rust TLS 1.3 tested between TWO real Macs, both valid-pinned-peer and deliberately wrong-peer-pin. SYNTHETIC ONLY. Not a production pairing or permission approval.**

## Traceable evidence

- Exact Git integration head: fe759ef20b75743c4fbe2329dea976244a8fd502.
- Built the native arm64 Rust test executable from that source using existing M2 Cargo artifacts.
- Executable SHA-256: 63d0ac4fb0bc5d9ae1d688a3f01b25203b5fd626580d4157a2b0c3b1d1b9631d.
- One-shot, recipient-IP-restricted local transfer from M2 to M3; SHA-256 independently verified on M3 BEFORE execution; transfer server closed after the single GET.
- The file is a local ad-hoc-signed test executable, NOT a notarized distributable. It uses synthetic fixed Rust test seeds 41/42/43 and explicit private-LAN, role and port safety gates. No production app bundle or Keychain was changed.

## Native physical two-host test

Both hosts ran mesh_transport::tests::manual_two_host_private_lan_pinned_tls_probe via the same arm64 executable from the exact QA head.

| Scenario | M2 native server | M3 native client |
|---|---|---|
| Correct mutual pinned TLS 1.3 certificate | 1 passed / exit 0 | 1 passed / exit 0 |
| Deliberately wrong peer key pin | 1 passed / exit 0 (negative expectation) | 1 passed / exit 0 (expected rejection) |

The source checks exact private IP peer, pinned Ed25519-derived device TLS identity and strictly denies wrong-device pins. The test asserts that success **never** creates a real account trust, transport-authorization or remote-job grant: verifiedPeers=0, remoteReadOnlyDispatch=false, crossDeviceWrites=false.

## Corroborating regression checks

- Full synthetic signed SAS/two-sided-approval/native mTLS/revocation Rust integration: 1 passed.
- Complete Rust library on M2: **296 passed, 0 failed, 8 explicitly ignored**. Manual physical two-Mac cases were run separately above.
- All GitHub workflows at the original head green: Windows Node Regression, Web Build, Rust Format, Attribution and Remote Commander Usage.
- Existing full integration test results: 742/742 Node and 16/16 Remote Usage.
- Disposable Unix-socket-only PostgreSQL Stage4E policy checks passed Free=0, Pro=10, policy expiry/removed policy rejection, no client writer. Signed Mesh relay SQL security assertions also passed.

## Production state and release restrictions

Read-only live KATOOS DB: zero registered Gate9 approval projects, reviewers, reviewer signing keys, owner challenges, owner decisions and approver grants; zero trusted Mesh device rows. Four relevant protected Edge endpoints each returned HTTP 401 to unauthenticated POSTs (owner challenge, reviewer review, grant and device enrollment).

The productive quota function still has the old 2-device fallback without expiry; Stage4E fix remains unapplied. This QA test made no changes to production tables, app Keychains, device identities or credentials.

**NO-GO for production pairing/release until**: (1) real KATOOS owner login and valid membership; (2) genuine independent human reviewer enrollment and Ed25519-signed Gate9 approval independently read back natively; (3) user-witnessed SAS comparison on BOTH apps and explicit consent; (4) audited product entitlement / quota migration with rollback; (5) actual live revocation, session expiry and cross-account denial acceptance.

Both Mac applications remained installed and unmodified. Available space is approximately 40 GiB M2, 37 GiB M3; larger packaging should wait for storage readiness.

Retain Draft status for GitHub PR #247. This evidence is a hardware QA receipt, never a release authorization.
