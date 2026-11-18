# KatoSync Stage4J — notarized internal macOS QA and functional resource evidence

**Safety update (2026-11-10):** This notarized resource candidate must not be launched beside Stage35: its original native Stage35 feature still shared Keychain/config/LaunchAgent namespaces. This finding does not invalidate the resource and Apple-notarization checks below. See [Stage4J runtime isolation review](KATOSYNC_STAGE4J_SIDE_BY_SIDE_RUNTIME_ISOLATION_2026-11-10.md) for source-level correction and remaining gates.

**Date:** 2026-11-09 · **Scope:** isolated ARM64 internal QA; not a production or public-beta release.
**Build origin:** pinned source commit `9f98ae1b33fe187f0de7fd77305ac4dc43046cd2`.
**QA bundle ID:** `com.nmkato.katosync.meshqa.stage4j-candidate`.

## Independently rechecked after signing

- Apple Developer ID signature valid, expected developer Team `T8SB89JPX7`.
- Poppler `pdftotext 26.09.0`, Typst `0.15.1`, bundled speech helper, and main Tauri executable are all native `arm64`.
- Exact post-sign SHA-256 receipts for the 4 native binaries and **all 29 Poppler dylibs** matched the private local signed-bundle inventory.
- The Poppler dependency closure resolved against bundled `@loader_path` libraries and allowed operating-system libraries; no missing or outside-Homebrew library detected.
- No `.test-only` markers remain in this package; four third-party license / notice files are packaged.
- Signatures rechecked after the functional tests; no installed Stage35 package was modified.

## Functional checks performed using disposable generated files

1. A new, synthetic 1-page PDF containing `PDF_TO_TEXT_PROBE_20261109` was generated in a private temporary QA directory; the **bundled** Poppler executable extracted the exact marker. **PASS**.
2. The **bundled** Typst generated a valid 1-page PDF from a new synthetic `.typ` document; the bundled Poppler executable subsequently extracted `TYPST_TO_PDF_PROBE_20261109`. **PASS**.
3. The bundled, developer-signed speech helper's `--preflight` returned `needs_permission` without recording audio or requesting permissions. This verifies its preflight path **only**, not speech recognition itself. **LIVE DICTATION NOT TESTED**.

The test files were deleted on completion. No customer data, microphone input, staging database, Mesh authorization, background agent task, or network access is required for these tests.

## Apple distribution checks for this private QA candidate

- Signed application was submitted to Apple's notarization service through an existing authorized keychain profile. Apple verdict: **Accepted**.
- Apple notarization ticket was successfully stapled to the private QA app. `xcrun stapler validate` passed.
- `codesign --verify --deep --strict` passed again after stapling.
- `spctl --assess --type execute` reported **accepted / Notarized Developer ID**.
- The main executable's signed SHA-256 remained `ad38ab3a13707eb8106c847b86b6bd257421b2c4e345b764b3bce94435e46b80`.
- The notary submission ID and full local proof remain in **private** QA receipts; do not commit local paths, archives, certificates, or secret credentials.

## Explicit remaining NO-GO conditions

- Stage4J is **not installed on M2 or M3** and has not passed a genuine M2/M3 app-start, owner-scoped SAS pairing, local Keychain enrollment, encrypted direct Mesh transport, or authorization test.
- The speech helper has **not** completed real user-consented dictation. macOS TCC permissions remain an explicit user-controlled step.
- No remote agent jobs may run on the basis of this notarization alone. Preserve `paired=false` and `remoteJobsEnabled=false` until independent physical-device proof.
- Apple notarization does not establish Poppler/GPL redistribution compliance, third-party source/notice requirements, or license clearance. External beta and customer distribution remain **HOLD** pending legal and release review.
- Stage4E database rollout controls and protected main branch remain unchanged. No K2S rollout, merge, deployment, or live security-state change.

**Decision:** `INTERNAL_NOTARIZED_QA_CANDIDATE_READY`. Not a public release or proof of operational Mesh pairing.

Created by NMKato Solutions

**Further physical M3 checks (separate, still no app launch):** [Stage4J two-Mac notarized resource QA](KATOSYNC_STAGE4J_TWO_MAC_STAPLED_RESOURCE_QA_2026-11-09.md).
