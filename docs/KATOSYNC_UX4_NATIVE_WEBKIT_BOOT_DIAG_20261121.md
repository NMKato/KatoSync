# UX4 macOS WebKit – Native Bootstrap-Blocker (21.11.2026)

Created by NMKato Solutions. **P0 for private UX4 native beta; not a production outage.**
Tracker: [KatoSync issue #284](https://github.com/NMKato/KatoSync/issues/284)

## Reproducible baseline

- Reviewed source: `qa/ux4-mesh-composition-20261121` @ `165ed11c0671ce7ae3e48aff55f6373571a1d74f`.
- macOS 27.2 ARM on M3, Xcode 27, Rust 1.95.0. The external-SSD build uses `--features ux4-mesh-qa`, `VITE_KATOOS_AUTH_QA=1`, sender/receiver QA opt-ins unset or `0`, `CARGO_PROFILE_RELEASE_STRIP=none`, locked Cargo deps. No external accounts or grants added by build.
- **Known-good fallback:** previously locally signed `KatoSync 4.0 KATOOS QA.app`; its WebKit native gateway and authenticated Agent Sync visibly render. Its embedded JS entry is `main-BJSrSTEU.js`. It was restored after every diagnostic test.
- **Failing update:** locally signed 93-MB native build; `main-fBa1g83C.js` was embedded and matches the Vite dist's hashed entry filename. Mac process and window exist; content appears blank and accessibility window contents are not available. Exit 0 build and valid codesign are **not** native acceptance.

## Read-only findings / isolated diagnostics

| Check | Verified result |
|---|---|
| Source Node tests | **1053/1053 PASS**; no failures/skips |
| Synthetic Chromium UX QA | **4/4 PASS**, no external requests or unwanted auth |
| npm audit | **0 known vulnerabilities** |
| Native updated WebKit QA | **FAIL** – blank content |
| Fresh copied binary, different macOS bundle identifier | Still blank; simple reused WebKit cache not sufficient explanation |
| External `boot-diagnostic.js` added before Vite module | Diagnostic overlay did not render; asset name present in native binary |
| Static HTML marker in `index.html` | **PASS** – actual WebKit page shows static text, so HTML is served |
| Explicit local Tauri script CSP origins in diagnostic only | **No improvement**; blank white page; **do not relax production CSP** |
| macOS WebKit parent-process logs | No observed `didFail`; both working and failing app show some sandbox messages. Lower resource completion count on failing app is a clue, not a proven cause |
| Last known-good QA process after rollback | Started and visible, with separate KatoOS QA Keychain intact |
| Developer ID notarization / beta installer | **NOT RELEASED** |

**Interpretation:** HTML reaches WKWebView. The external boot indicator and React do not execute/render in the failing branch. Cause remains **unresolved**; CSP, asset response Content-Type, module load, embedded asset mapping and release resource caching must be examined through an actual inspector. Do not claim the specific root cause yet.

## Next controlled engineering test

1. Build a separately signed and isolated **Tauri v2 WebKit-inspectable QA candidate**, *never* the production/Stage4J app. Follow the official [Tauri debug guide](https://v2.tauri.app/develop/debug/). Tauri's Web Inspector is enabled by default in debug builds; a release inspector requires the explicit `devtools` feature.
2. Compare actual WKWebView resource requests and response statuses/MIME/CSP for `index.html`, `main-*.js` and `jsx-runtime-*.js`; inspect the JavaScript console, boot lifecycle and asset resolver; capture only non-sensitive error categories.
3. Fix a **proven** cause. Rebuild the guarded read-only UX4/Stage4J candidate on DevSSD, retaining existing Owner/Session/MFA/Ed25519 gates.
4. Add native launch smoke: visible gateway or signed-in Agent Sync, correctly rendered 1040px sidebar, clear disabled initial pairing CTA, no secret/log leakage. Re-check a full normal rollback.
5. After native acceptance, proceed separately to owner-confirmed Pairing and ChatGPT-MCP signed read-only Git-status pilot; never infer these from registration or an OAuth ping.

## Protection boundaries

- Candidate11 on M2 remains untouched. Good UX4 QA package on M3 remains installed on external SSD and is the active fallback.
- Diagnostic apps and screenshots are not distributed, committed or used as native acceptance; ephemeral local build changes under `dist-boot-diagnostic/` and local diagnostic Tauri config are Git-ignored.
- No access tokens, passwords, MFA codes, private keys, app-local data, Supabase grants or production settings were copied or altered.
- No merge to `main`, no PR, no paid GitHub Actions and no public installer by this investigation.

**Status:** source-level UX4 Beta logic ready for continued QA, but **native candidate release NO-GO** pending issue #284.
