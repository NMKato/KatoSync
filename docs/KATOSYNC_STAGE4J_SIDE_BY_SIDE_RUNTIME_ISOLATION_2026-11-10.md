# Stage4J — side-by-side runtime isolation before app-backed Mesh QA

**Date:** 2026-11-10 · **Scope:** source-only security correction; no device trust, no database updates, no app launch.

## Confirmed pre-launch blocker

The 2026-11-09 notarized Stage4J resource candidate has a distinct macOS `CFBundleIdentifier`, **but** it was compiled with the inherited Cargo `stage35-qa` feature. That feature also selects the installed Stage35 namespace for:

- KatoSync/mesh/SAS/github/session and provider **Keychain service** `com.nmkato.katosync.katoos.stage35.qa`;
- app support config and session-email folder `KatoSync Mesh QA Stage35`;
- log folder with the same Stage35 name;
- LaunchAgent ID `com.nmkato.katosync.meshqa.stage35.sync`.

The Tauri application context was also generated from the Stage35 QA configuration, notwithstanding the post-build `Info.plist` change. **Binary confirmation:** on both physical M2 and M3, read-only `strings` inspection of the notarized candidate\'s main executable exposes `com.nmkato.katosync.katoos.stage35.qa` while `Info.plist` reports `com.nmkato.katosync.meshqa.stage4j-candidate`. This independently confirms the runtime namespace mismatch; no Keychain secret was read. Consequently the old notarized Stage4J package is **not cleared for side-by-side startup**. A valid Apple notarization ticket authenticates the archive but does not prove namespace isolation, enrollment safety or Mesh readiness.

**Containment:** do not launch the prior Stage4J Candidate.app on M2/M3. The existing Stage35 apps remain installed, notarized and running; their Keychain/session/mesh-trust stores were not touched by this source-only correction. The previous Stage4J resource acceptance evidence remains valid as a package/document-tool test, not as an app-start safety pass.

## Corrected Stage4J source-only design

- Add Cargo `stage4j-qa` inheriting `stage35-qa` to retain guarded native functionality but override runtime namespace precedence.
- Allocate separate Keychain service `com.nmkato.katosync.katoos.stage4j.qa` in both Rust application core and GitHub authentication.
- Allocate distinct LaunchAgent ID `com.nmkato.katosync.meshqa.stage4j.sync`, app-support/config and logs directories `KatoSync Mesh QA Stage4J`.
- Add a distinct *embedded* Tauri configuration `tauri.mesh-qa-stage4j.conf.json` using bundle identifier `com.nmkato.katosync.meshqa.stage4j-isolated`, not merely a post-compile `Info.plist` override.
- New opt-in signed QA output path `~/Applications/.KatoSync-Mesh-Stage4J-Isolated-Candidate` is collision-protected and cannot overwrite the earlier archived Stage4J package or installed Stage35.
- Set frontend `VITE_STAGE35_AUTO_RESUME_QA=0` and `VITE_STAGE35_HEARTBEAT_QA=0`. No automatic workspace restoration or remote presence write as a side effect of startup.
- Preserve the signed native resource verification and existing user-initiated enrollment/SAS gates. New Stage4J keys start empty; no secret copying, no trust migration and no unauthorized duplication of devices in K2S.

## Verification and next steps

Current targeted source-level contracts: **12/12 PASS**, including compiled binary namespace-audit contracts and Tauri embedded-ID isolation. Full Node regression before the subsequent configuration/test-only gate addition: **855/855 PASS**. Static TypeScript typecheck: **PASS**. Rust formatting: **PASS**. Pre-build no-approval and wrong-commit denials: **PASS**. The read-only native binary audit rejects the old signed Stage4J candidate with exit **5**, as intended. Native Rust feature test/build must still be independently confirmed; passing source contracts alone is insufficient to call the new build ready.

Next:
1. Build and sign a **new** isolated Stage4J bundle from exact reviewed source and genuine resources, with immutable provenance and no installation.
2. Notarize/staple it; Gatekeeper on physical M2 and M3 must independently accept that **new** bundle.
3. Test side-by-side local app boot with a *fresh, empty* Stage4J session and independently verify Stage35 Keychain/session and running process remain unchanged; no automatic Cloud enrollment/presence.
4. Only with explicit owner-driven authentication on both devices should SAS and registry reconciliation proceed. Do not auto-create Keychain identities or accept peers.
5. No native TLS client/server, relay dispatch, remote job, merge/deploy, cloud schema change or public release based on this source patch.

**Decision:** `STAGE4J_ORIGINAL_SIGNED_CANDIDATE_NO_LAUNCH`. New isolated build pending native compile, review, signing, notarization and controlled runtime test.

Created by NMKato Solutions

**Post-build hardware result (2026-11-10):** A NEW isolated Stage4J application from this source was signed, Apple-notarized, stapled, accepted by Gatekeeper on physical M2/M3 and booted alongside the unchanged Stage35 apps. See [isolated two-Mac startup QA](KATOSYNC_STAGE4J_ISOLATED_TWO_MAC_APP_LAUNCH_QA_2026-11-10.md). Original 2026-11-09 Stage4J candidate remains NO-LAUNCH. Owner login/SAS/Mesh trust remain unproven.
