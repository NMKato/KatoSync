# KatoSync Stage4J — isolated Apple-notarized application booted beside Stage35 on M2 and M3

**Date:** 2026-11-10, Europe/Berlin
**Branch:** `qa/stage4j-resources-20261109`, source/build commit `6d1ee22b5e379cb01e40eba3e417a27d171e82bb`.
**Scope:** private, side-by-side on-device app startup and packaged-resource QA; no Mesh pairing, authenticated cross-device job, deployment, or customer distribution.

## Source and runtime isolation gate

Original signed/Apple-notarized Stage4J (2026-11-09) was **not** started: it retained the Stage35 Keychain/config/LaunchAgent identities despite an outer unique `Info.plist`. Its original resource-only proof remains valid but it is **NO-LAUNCH**.

Rebuilt new candidate with `stage4j-qa` feature, embedded Tauri identifier `com.nmkato.katosync.meshqa.stage4j-isolated`, Stage4J-specific Keychain service `com.nmkato.katosync.katoos.stage4j.qa`, logs/app data namespace `KatoSync Mesh QA Stage4J`, LaunchAgent `com.nmkato.katosync.meshqa.stage4j.sync`, and disabled implicit auto-resume/heartbeat. Production and older QA feature behavior are not changed.

- Source contracts: 12/12 targeted Node checks PASS (independently re-run after deployment preparation).
- Full Node suite in this source evolution: 855/855 PASS (before subsequent two targeted source-only test additions); TypeScript typecheck PASS.
- Rust `stage4j-qa` compile + targeted native namespace test PASS; Rust format check PASS.
- Exact source and opt-in QA gates fail closed on missing authorization or wrong source SHA.
- **Compiled executable** `STAGE4J_NATIVE_NAMESPACE_AUDIT_PASS`: correct Stage4J application/Keychain/LaunchAgent identifiers present and the obsolete Stage35 credential/LaunchAgent identities absent.
- Native ARM64 application and all real Poppler/Typst/speech resources signed by existing MK Heartbeat UG developer identity, Team `T8SB89JPX7`; 29 bundled Poppler dylibs; no `.test-only` placeholders.
- New signed main executable SHA-256 `ec93cb6f2bb5bcb85ce6cd4f1e8f34995f298846bcf56502637ffbb95bb250fc`.

## Apple and two-host distribution QA

- New internal QA archive submitted to Apple; notarization **Accepted**. Ticket stapled and validated. Both M2 and M3 independently reported `spctl accepted / Notarized Developer ID`, valid deep code signature and exactly the new Stage4J ID.
- **Post-staple** archive was distributed M2→M3 using a *one-shot private-LAN HTTPS server*, source-IP and path restricted, with an ephemeral pinned server public key. Receiver independently verified exact 52,786,784-byte length, ZIP integrity, and SHA-256 `91b7e61b3a453a7031c91022a864bbad5ff4a57b2666aeedb26939211a51b2c2`.
- The one-shot server closed and ephemeral TLS private-key/certificate were removed. No persistent transfer service was enabled.
- M3 independently confirmed signed executable SHA-256 exactly matches M2; all 29 real Poppler dylibs present, Poppler `26.09.0`, Typst `0.15.1`, successful disposable Typst→PDF→Poppler marker extraction.

## Controlled side-by-side startup

- The corrected Stage4J app was opened on both M2 and M3 after notarization. Independent process checks showed **both the older Stage35 app and the new Stage4J app alive simultaneously** on each physical Mac.
- Native Stage4J app support/config files were created under the **new Stage4J-specific** directory; existing Stage35 app packages retained valid code signatures.
- This is a **process-level launch smoke test**, not visual confirmation that every UI view renders correctly or that all session-dependent actions succeed.
- No Stage4J LaunchAgent was registered; no TCP listening socket owned by the newly launched Stage4J process was detected in the checks.
- The QA operator did **not manually invoke** `mesh_device_identity_prepare`, `mesh_local_approve_peer`, explicit device discovery/enrollment, relay dispatch, any Mesh remote job, or any migration. The embedded app may perform authenticated **read-only roster fetches** after login; this startup check does not independently audit all network calls. Automatic Stage35 presence heartbeat was disabled in this build.
- A `supabase-session.email` **marker exists** in the separate Stage4J app-support directory on both Macs after startup. A display marker is **not evidence** of authenticated owner identity or a valid refresh token. The origin and authorization of the associated session was **not determined** by this test; no session email content, Keychain token, signing secret or other credential was extracted. An explicit, independently verified account session remains a prerequisite for pairing.

## Unfinished release/security gates

1. Owner explicitly authenticates and verifies the exact intended account/session on both Stage4J apps. Reconcile any already-existing Stage35/Stage4J device roster records; do not assume equality of users, peers, or Keychain identities.
2. Generate fresh on-device signed challenge/response in both directions, compare exact SAS **in person**, and only accept a peer via the existing explicit user confirmation. No automatic self-pairing or unconditional trust from a public roster.
3. After approval, prove app-backed native mTLS/Keychain bound transport, key rotation/revocation and restart/reconnect. Preserve `paired=false`, `transportReady=false`, `remoteJobsEnabled=false` as **verified Mesh claims** until actually established.
4. Live speech dictation remains untested and requires operator-controlled macOS TCC permission; third-party Poppler/GPL source and notice obligations remain under release review. No public beta/production enablement, autonomous merge/deploy or cross-device jobs.

**Decision:** `STAGE4J_NEW_ISOLATED_APP_TWO_MAC_LAUNCH_PASS`; owner session, trust establishment, native app-bound Mesh transport and public release **NOT yet approved**.

Created by NMKato Solutions
