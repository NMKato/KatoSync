# KatoSync Stage4J — real macOS resource admission, isolated QA candidate

**Post-build update (2026-11-09):** The originally unnotarized signed candidate subsequently passed isolated PDF/Typst functional QA, Apple notarization (`Accepted`), stapling and Gatekeeper assessment. The historical pre-notarization status and outstanding gates below describe the initial build state only. Current internal status and explicit public/Mesh release HOLD are documented in [Stage4J notarized functional QA](KATOSYNC_STAGE4J_NOTARIZED_FUNCTIONAL_QA_2026-11-09.md).

**Date:** 2026-11-09 (Europe/Berlin)
**Input:** Draft PR #247 at `9f98ae1b33fe187f0de7fd77305ac4dc43046cd2`, Stage4I owner-scoped manual peer preflight.
**Goal:** an internal, side-by-side signed macOS QA candidate carrying real Poppler, Typst and speech-helper resources, instead of inherited `.test-only` placeholders.

## Verified prerequisite observations

- The existing Stage35 QA apps on physical M2 and M3 remain Apple Developer-ID signed and notarized, but their `Contents/Resources/resources/poppler` and `typst` subdirectories contain **only `.test-only` markers**, not usable tools. Prior notarization proves package authenticity **not** resource completeness.
- The root integration Git checkout itself contains no populated release resources and no `src-tauri/release-resources.lock.json`.
- Existing Poppler **26.09.0** full arm64 runtime found in a local, preexisting KatoSync development checkout. `pdftotext` is an arm64 Mach-O; the corresponding `libs` directory has **29 native dylibs**. Full transitive `otool -L` inventory of all dylibs and the tool revealed **0 missing `@loader_path` dependencies**. Pre-sign `pdftotext` SHA-256: `6d22fb6ed78fa1d7789b79f1e823436c66f875f96d4e7928a8d82c90c1c1f5ee`.
- Official Homebrew Typst **0.15.1** `arm64_tahoe` bottle fetched **into cache only**, *without installing Typst system-wide*. Bottle SHA-256 `37bfa441d1641d246e8663d742f940811688b7cd56b50b29a6177928ed949beb`; the extracted `typst` is a genuine Mach-O and responds to `--version`.
- Existing notarized Stage35 `KatoSyncSpeechHelper.app` is signed by **MK Heartbeat UG (Team T8SB89JPX7)**; its executable pre-sign SHA-256: `faa734b1ace5aa36c55469728d04bb4fc0be771ffbe00c2aa2bd8794a8228f66`.
- Licenses copied into local resource staging: Poppler COPYING/COPYING3 and Typst LICENSE/NOTICE. **Legal distribution and third-party-source/notice obligations must be reviewed before external beta/customer release**; including license copies alone does not prove GPL compliance.
- The three real resources and 29 dylibs were assembled **only in the isolated M2 QA worktree**, not committed as application binaries. A local per-resource SHA lock (including all dylibs) was generated and confirmed through the existing release gate, then a stricter Stage4J macOS resource audit. **Initial pre-sign lock SHA-256:** `ba90cbc4911791bc1aaa8fba9a7511e35c7a5b4fb49617c01f971635e88cbc85`.

## New reproducible fail-closed QA controls

`scripts/qa-stage4j-macos-resource-audit.mjs` is read-only:
1. Applies existing `verifyReleaseResources()`: Mach-O magic, required executables, SHA-256 lock, no symlinks or `.test-only` anywhere in resource trees.
2. Requires exact dylib file set matching its lock, each hashed; recursively checks `@loader_path` references and refuses `@rpath`, `@executable_path` or Homebrew/other non-system absolute dynamic dependencies.
3. Requires all Poppler/Typst legal notices and verifies the nested speech app has a valid code signature and expected developer team.
4. Never writes to the file system, authenticates to K2S, opens ports, signs code or uploads binaries.

`scripts/build-mesh-qa-stage4j-candidate-macos.sh` is an **explicit opt-in, no-install, no-upload** developer build:
- Requires `KATOSYNC_STAGE4J_LOCAL_CANDIDATE_APPROVED=YES_ISOLATED_QA_ONLY` and a pinned exact commit in `KATOSYNC_STAGE4J_EXPECT_SHA`.
- Validates the previous Stage35 notarized base and the new resource audit before compiling.
- Builds QA frontend with `VITE_KATOOS_AUTH_QA=1` and Tauri with `--features stage35-qa`; signs the **real** helper, Poppler dylibs and tools, native binary and outer app with Developer ID.
- Writes only to a new isolated folder `~/Applications/.KatoSync-Mesh-Stage4J-Candidate/` using the distinct bundle ID `com.nmkato.katosync.meshqa.stage4j-candidate`. Existing installed Stage35 apps remain untouched.
- Refuses missing/changed inputs, an existing candidate output, failed signatures, `.test-only` leftovers and failed Poppler/Typst executable smoke tests.
- **Never notarizes, installs, launches, deploys, authorizes Mesh peers, merges GitHub code or activates remote agent jobs automatically.**

## Completed private M2 Stage4J build — verified results

**Build provenance:** exact Stage4I parent SHA `9f98ae1b33fe187f0de7fd77305ac4dc43046cd2`. `VITE_KATOOS_AUTH_QA=1` + `--features stage35-qa`; the M2 existing Rust build cache was reused, with no second Rust installation on M3.

**Local real-resource admission: PASS.** `RELEASE_RESOURCES_VERIFIED darwin-arm64 3` and `STAGE4J_LOCAL_RESOURCE_AUDIT_PASS`: all 29 Poppler dylibs present and hash-locked, 0 missing/absolute Homebrew dynamic dependencies, 4 copyright/license files and signer-verified STT helper. The source-input SHA lock exists **only in the isolated M2 worktree**, not in Git. Re-signing changes executable SHA hashes, so it must not be confused with the post-sign bundle's integrity receipt.

**Developer-ID signing: PASS.** Side-by-side private candidate exists at:
`~/Applications/.KatoSync-Mesh-Stage4J-Candidate/KatoSync Mesh QA Stage4J Candidate.app`

- 128 MB native arm64 app, unique bundle ID `com.nmkato.katosync.meshqa.stage4j-candidate`.
- Verified `codesign --verify --deep --strict`, timestamped **Developer ID Application: MK Heartbeat UG**, Team `T8SB89JPX7`.
- Verified **real** packaged Poppler `pdftotext version 26.09.0` and Typst `0.15.1` run from the signed app, along with exactly **29** bundled Poppler dylibs.
- **Zero `.test-only` markers** in the candidate; all 4 copied license files present.
- Existing installed Stage35 retained, verified as still signed and notarized. No candidate installed or launched.
- Post-sign app `Contents/MacOS/katosync` SHA-256 `ad38ab3a13707eb8106c847b86b6bd257421b2c4e345b764b3bce94435e46b80`.
- Post-sign Typst SHA-256 `03bd304973497a9b88ceffd0973cac4ba190b48974496d9d811e6137ff59ed9b`.
- Post-sign Poppler executable SHA-256 `f430fcd3bb6f2edad683e0261c0cf657d7f9d4cdc19179c38382dc63efa070a4`.
- Locally stored `stage4j-local-qa-receipt.json` contains the exact 29 dylib SHA-256 values and source/build provenance. Receipt file SHA-256 `2e7dcf88cdf1847a5c799a400d7e631ba6ed5a2fc26e8d112d46ed651a757b5f`. This audit log is intentionally **not** a cloud upload or replacement for an Apple notarization receipt.

**Regression:** full M2 **851/851 Node tests**, **16/16 Remote Usage**, **6/6 new resource admission contracts**, frontend TypeScript/Vite build and native Tauri debug build all PASS.

**Outstanding gates:** app is **NOT Apple-notarized**, NOT Gatekeeper-accepted for distribution, NOT installed on M2 or M3, NOT used for real SAS/Keychain pairing, NOT cleared for external beta. Apple submission needs separate explicit authorization. Third-party distribution compliance remains subject to legal review; copied license texts alone do not prove it. No live K2S schema or Mesh job changes.

## QA and release distinction

**Real resource preflight on M2:** PASS: 3 executable resources, all 29 dylibs, 4 license/notice files, valid developer-signed speech helper; live `typst --version` and `pdftotext -v` passed.

**New platform-neutral QA contracts:** `tests/meshStage4JRealResourceGate.test.ts` includes six fail-closed checks.

A Developer-ID signed *candidate* is not a notarized, distributed or installed app. Before the owner's first genuine M2↔M3 SAS flow, review build provenance, actual final bundle contents and signature, then explicitly authorize Apple notarization and a separate installation on each device. Validate local Keychain authorization + real owner K2S enrollment without confusing that result with current Stage4H synthetic mTLS proof. Preserve `paired=false`, `remoteJobsEnabled=false` until the real app-backed encrypted session is positively confirmed.

Stage4E K2S database guard remains a separate live-data rollout HOLD; no new Supabase staging project is required. `main` must stay protected.
