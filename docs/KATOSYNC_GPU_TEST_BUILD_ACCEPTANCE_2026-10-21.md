# KatoSync GPU Test — macOS candidate build and acceptance evidence
Date: 21 October 2026. Related Draft PR #73, nested under #72 → #71 → #70 → #69.

## Exact scope and binary
- Built from PR #73 commit e8988a34277c0300524c50adb85c21384873a1f2, unmerged feature branch.
- Platform: macOS arm64, local **test only**; Tauri app bundle with product name KatoSync GPU Test. No main/dev merge.
- Local destinations on the authorized Mac: ~/Applications/KatoSync GPU Test.app and ~/Downloads/KatoSync-GPU-Test-2026-10-21-macOS-arm64.zip.
- SHA-256 of ZIP: 09e855951ee487f7d4f5f4d3e459e8590bed65677ab0478ab52d55f2463bd5f8.
- Bundle signature: explicit local ad-hoc codesign, verified with codesign --verify --deep --strict on installed app **and** app extracted from ZIP. Archive passed unzip integrity test.
- Build Tauri override excludes unavailable Poppler/Typst binary resources. These are required for a complete general-purpose distribution. This test ZIP is **not** a signed/notarized commercial installer or full PDF/Typst-capable release and is not published to GitHub Releases.

## Automated verification completed
- npm ci, npm test: 164/164 PASS.
- TypeScript typecheck PASS.
- Rust library suite: 117 PASS, 3 intentionally ignored.
- Release-optimized macOS arm64 Tauri binary built and bundled.
- Existing Kato AI localhost health: HTTP OK, model id kato-local-brain present.
- Synthetic-only localhost Gemma request, max_tokens=128, temperature=0: nonempty response TEST_OK., stop finish reason, 5 completion tokens, **0.43 seconds**. An initial underbudgeted max_tokens=16 request had returned an empty visible message, so it is **not** counted as an inference pass.
- Existing server command includes -ngl 99 and installed llama.cpp binary enumerates MTL0 Apple M2 Pro (~12 GiB free shared GPU-address-space at device-probe time). GPU was detected and offload requested, but **effective GPU layer residency/peak memory/real GPU load were not independently measured**.
- Native new KatoSync GPU Test.app process launched. Existing Kato AI server was deliberately left running and responding.
- Separate **local test-only sandbox build** was created with isolated application identifier and independent keychain namespace to avoid granting private user credentials. The sandbox launches and displays the license agreement; acceptance was **not** performed on the user's behalf. Sandbox code changes are NOT part of PR #73 and are NOT shipped in the test ZIP.

## Remaining blockers / explicit user action
- The real test app's new ad-hoc signature triggered the macOS login Keychain consent prompt for preexisting KatoSync credentials. The assistant did not enter, retrieve or circumvent the user's password or grant persistent access. Full GUI account use requires the user to approve this prompt locally after verifying the test app.
- The sandbox UI reaches a KatoSync license acceptance screen. The assistant did not agree to legal terms or authorize external Mistral cloud uploads; only the user can review and consent.
- As a result, **no complete GUI walkthrough of Agent Sync > Dashboard's new CPU/RAM/GPU card** nor consented model restart using PR #73's modified start path has been performed. The model smoke uses the *already running* older server, not a new runtime launched by PR #73.
- Previous installed KatoSync.app and Preview.app bundles were not overwritten. A separate old Preview process remains running; avoid treating the test ZIP as an in-place production upgrade.

## Next actions after owner approval
1. User opens the local test app, grants macOS Keychain access locally (do not share password with anyone), reviews and personally accepts any displayed license.
2. Verify compact resource dashboard in real native UI, actual measured CPU/memory/GPU and proper state when local Gemma is already loaded.
3. Plan a controlled, user-approved stop/start of the **Kato-owned** local model (not any foreign Ollama/LM Studio instance), check that this PR's runtime backend selection chose Metal, and perform synthetic inference plus measured backend resource logging. Record rollback and reactivate previous model as needed.
4. Package required Poppler/Typst resource binaries correctly and obtain independent security review + Developer ID signing/notarization before providing a public downloadable release.
5. Run a complete Windows packaged-app build and hardware smoke. Current Windows machine has Intel UHD and limited free RAM; CUDA cannot be inferred.

## UX/legal copy review
The first-run license currently describes KatoSync mainly as a Mistral project memory uploader, while the product is expanding to a provider-neutral Project Work Hub. Any revisions to legal terms require separate owner/legal review, not assistant-side silent acceptance or rewrite.

Created by NMKato Solutions

## Consent-driven GUI and Apple GPU telemetry follow-up — 21 October 2026
- After user approved the Keychain prompt, the previously built test app reached the REAL Agent Sync Overview; display captured locally. CPU measured 24%, RAM 41% used, approximately 9.4 GiB available / 16 GiB installed, Kato AI running and native Metal backend detected. Earlier GPU metric was correctly shown as unavailable.
- Read-only macOS IOAccelerator PerformanceStatistics were sampled during a SYNTHETIC Gemma workload:
  - GPU device-wide baseline: 5 samples, mean 56.2%, min 32%, max 64%.
  - GPU device-wide during inference: 58 samples, mean 73.1%, min 33%, max 99%.
  - Device-wide allocated unified memory range about 8.20 to 8.54 GiB, NOT exclusive Kato model memory.
  - Request generated 180 tokens in 15.13 seconds, stopped due to output-length limit and had no visible answer. This is a load observation, NOT a semantic generation pass. An earlier short synthetic request returned TEST_OK. correctly.
  - These device-wide counters CANNOT isolate GPU load to llama-server; Metal libraries and the existing -ngl 99 command are corroborating, but no effective GPU-layer residency count is established.
- Implemented native device-wide GPU utilization in System Resource Monitor by bounded, read-only ioreg -r -c IOAccelerator (3-second timeout, 1 MiB response cap), strict percent parsing and evidence flag macos_ioreg_device_wide_utilization. If absent/malformed, UI still displays unavailable. UI explicitly describes that GPU-% measures the entire device, not Kato-AI alone.
- Additional Rust counter parser tests passed. Latest regression: 164/164 Node tests, 118 Rust library tests (3 intentionally ignored), TypeScript/typecheck, optimized macOS arm64 build, cargo fmt and diff-check PASS.
- Rebuilt local test app with this telemetry; backed up the previous test app and pre-telemetry ZIP. The production KatoSync.app and the healthy existing Kato AI server remained unchanged. Updated app code signature verified; ZIP passed integrity check.
- Updated ZIP path on authorized Mac: ~/Downloads/KatoSync-GPU-Test-2026-10-21-macOS-arm64.zip
- Updated ZIP SHA256: 0e841ae5106040bbf79d7dba03fea96ebf8c77df38d13f9182d4078cd4262406
- Outstanding USER CONSENT: macOS asked for Keychain confirmation again after the binary was rebuilt/re-signed. Assistant neither retrieved password nor granted access; the NEW GPU-% GUI display remains awaiting that local approval. The earlier version's GUI was verified, the updated parser is covered by unit tests and native build.
- This macOS test build still excludes real Poppler/Typst package resources, is ad-hoc signed (not notarized) and is NOT a release or a proof of Windows GPU performance.

Created by NMKato Solutions
