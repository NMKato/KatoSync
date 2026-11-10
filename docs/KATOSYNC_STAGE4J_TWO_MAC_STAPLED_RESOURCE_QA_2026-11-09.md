# KatoSync Stage4J — two physical Macs, notarized resource package staged and independently verified

**Date:** 2026-11-09 (Europe/Berlin)
**Scope:** internal no-install/no-launch/no-autonomous-jobs resource distribution QA, distinct from native Mesh trust/pairing testing.
**Source SHA:** `9f98ae1b33fe187f0de7fd77305ac4dc43046cd2`.
**App ID:** `com.nmkato.katosync.meshqa.stage4j-candidate`.

## Two-Mac distribution and identity verification

1. On physical M2, the Developer-ID signed application was confirmed already **Apple-notarized**, **stapled**, Gatekeeper-accepted, and runnable as arm64 resources. A **new archive was produced after stapling**; an earlier pre-stapling notarization submission ZIP was not reused for this transfer.
2. Final stapled archive size **52,785,759 bytes**, SHA-256 `0936d5c7c72bbf1232c3eea9ab16106e8805da4c674a26bd1c44133d67efa6d9`. `unzip -tqq` passed on M2.
3. Physical M2 transmitted the exact ZIP to physical M3 on the private LAN with a one-shot, short-lived TLS endpoint, restricted to the M3 IP and a single fixed read-only URL. M3 pinned the ephemeral server public key (`curl --pinnedpubkey`) and independently validated transfer size, SHA-256 and ZIP integrity.
4. M2 server closed after that single transfer; listening-port closure was checked. The ephemeral TLS private key/certificate and temporary service script were deleted. **No cloud drive, source repository, secret storage, K2S API, account enrollment or production credentials were used for transfer.**
5. M3 unpacked the ZIP **only into a private QA directory**. It did not replace, launch, register, or authorize a KatoSync application.

## Physical M3 independent application checks

- Apple Gatekeeper: **accepted / Notarized Developer ID**.
- Embedded Apple notarization ticket: `xcrun stapler validate` **PASS**.
- Deep strict signature: **PASS**. Team: `T8SB89JPX7`.
- Bundle ID: `com.nmkato.katosync.meshqa.stage4j-candidate`.
- M3 main app SHA-256 exactly matches the previously tested M2 signed binary: `ad38ab3a13707eb8106c847b86b6bd257421b2c4e345b764b3bce94435e46b80`.
- Bundled Poppler executable: `f430fcd3bb6f2edad683e0261c0cf657d7f9d4cdc19179c38382dc63efa070a4`, `pdftotext 26.09.0`.
- Bundled Typst executable: `03bd304973497a9b88ceffd0973cac4ba190b48974496d9d811e6137ff59ed9b`, `typst 0.15.1`.
- Bundled speech helper executable: `e8664b44c75785cc27392e38ce118dc4aaa74c96fe85e5748a9b59e18b884069`.
- Poppler dependency library inventory: **29 dylibs**.
- M3 functional smoke test: bundled Typst generated a disposable PDF and bundled Poppler recovered the marker `STAGE4J_M3_TYPST_POPPLER_PASS`: **PASS**.
- M3 speech-helper `--preflight` returned `needs_permission` without requesting microphone access or recording speech. **Actual dictation untested**, controlled consent required.
- The existing M3 Stage35 application was still running and remained signed. The previous M2 Stage35 build was also not altered. The QA files were **not launched as an app**.
- M3 saved a private local receipt `m3-local-stage4j-qa-receipt.json` with hashes and exact limitations; it is **not uploaded or committed**.

## Separation of evidence from security authorization

This verifies transport of one previously notarized file **and** locally executable document utilities on both Macs. It does **not** demonstrate actual M2↔M3 application startup, owner-confirmed SAS, OS-protected persistent per-device keys, Keychain enrollment, owner-bound K2S registration, app-backed mTLS trust, replay/revocation, authorized cross-device dispatch, agent task routing, reliable progress accounting, or any customer release.

The earlier native Rust two-device mTLS proof [Stage4H hardware QA](KATOSYNC_STAGE4H_NATIVE_TWO_MAC_MTLS_HARDWARE_QA_2026-11-09.md) remains a separate synthetic-key transport subgate and must not be conflated with persistent owner-approved pairing.

## Release status and next gate

**Result:** `STAGE4J_M2_M3_NOTARIZED_RESOURCE_QA_PASS` (pre-launch, internal only).

**Still blocked:** `paired=false`, `transportReady=false` as an app trust claim, `remoteJobsEnabled=false`, no automatic merge/deploy, no public distribution. Keep main protected. Complete a separately controlled side-by-side app-start / SAS & TCC user-consent test and legal review of third-party Poppler notices/source obligations before external beta.

Created by NMKato Solutions
