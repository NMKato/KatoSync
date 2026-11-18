# KatoSync Stage4I — owner-scoped native Mesh admission preflight (QA only)

**Date:** 2026-11-09 (Europe/Berlin)
**Base:** Stage4H hardware-proven native Rust mTLS on M2↔M3, Draft PR #247.
**Scope:** existing shared K2S `katosync` schema; **no additional staging project** and **no live DDL/deployment**.

## Existing capabilities reused (not reimplemented)

- `mesh_identity` already provisions per-account Ed25519 signing seeds through the OS credential store, and `existing_identity` refuses to create a missing identity.
- `mesh_handshake` already builds signed offers/responses and a human-verifiable SAS; `mesh_trust` already manages locally approved/revocable public peer pins.
- `mesh_enrollment_gate::require_both_devices_enrolled` already performs an owner-scoped JWT/RLS `GET` for exact enrolled public keys on the shared K2S project's `katosync.mesh_devices` table.
- `mesh_admission::authorize` checks the QA feature gate, verified online owner session, existing local key, exact local peer approval, both registered identities and account continuity. `recheck_after_probe` repeats admission checks against account/key/approval/registry drift.
- Stage4H physical M2↔M3 native pinned TLS 1.3 was successful in both directions with synthetic fixture keys, including the deliberate incorrect-peer-pin denial. That success does **not** imply real paired devices.

## Stage4I first deploy-independent implementation slice

1. Add `mesh_native_peer_preflight(requestedFingerprint)`, a **manual** Tauri command reusing `authorize` and `recheck_after_probe` with strict uppercase hex fingerprint format checks. Returns one bounded result only if all checks succeed. Known-safe error categories only; no account ID, tokens, private signing seed, peer public key or raw service responses.
2. Result is specifically `admissionEligible: true`, `paired: false`, `transportReady: false`, `remoteJobsEnabled: false`, `verifiedPeers: 0`. **No TCP listener, TLS probe, worktree command, remote job, trust write or SaaS entitlement grant** is wired to this command.
3. The normal KatoSync **selected-device guide** shows a manual *connection prerequisites* button only in the isolated QA Auth variant and only for non-revoked entries. An old/legacy build cannot claim support. Failed gate is shown as **not ready**, never connected.
4. UI result must match exact version and all deny-by-default fields. It is associated with exact device ID + fingerprint, cleared on new selection, roster refresh, reauthentication, local pin inventory update, and automatically expired after **30 seconds**. Asynchronous older responses cannot resurrect stale account/device state.
5. All four supported QA language locales (DE/EN/ES/RU) explicitly distinguish eligibility from pairing and remote execution.
6. The read-only K2S registration lookup may invoke normal authentication/session renewal; it never writes mesh devices, approvals, Cloudflare functions, billing state or Supabase schema.

## Security acceptance checklist

- Rust tests: invalid/changed fingerprint rejected before any account/Keychain/network work; serialized positive report explicitly forbids trust, transport and remote jobs; stable builds without `katoos-auth-qa` stay blocked.
- Node security contracts: exact Tauri command registration, manual-only UI invocation, common preexisting admission gates and exact RLS `GET`, result flags, stale-state invalidation, localization and no remote-job functions.
- Existing Node, Rust, TypeScript and CI must remain green. The new command **does not execute against the actual owner session or write any Keychain entry** during hermetic tests.
- A future installer **must** have genuine audited resources, Developer-ID signature and Apple notarization. Synthetic `.test-only` build placeholders can only appear in isolated compiler QA worktrees, never an installer.

## Completed local QA results

- Stage4I eight new static security contracts **8/8 PASS**, existing Mesh guide contracts **5/5 PASS**.
- M2 full Node regression **845/845 PASS**.
- TypeScript/Vite production frontend build **PASS**.
- Remote Usage UI security tests **16/16 PASS**.
- Native Rust `mesh_admission::tests` **4/4 PASS**, including invalid peer fingerprint, immutable trust denies and stage4i boolean status denial. Native Rust format **PASS**.
- This is a **developer QA build**, not a signed/notarized installer; no real owner login or Keychain changes were made by the new QA tests.

## Next P0 milestones

1. On existing M2/M3 QA apps, operator performs **actual** account verification and compares fresh, signed SAS on both devices before local approval. Use real unique Keychain-protected identities, not prior fixed-seed mTLS QA fixtures. Existing discovered records must be reconciled, never duplicated arbitrarily.
2. Produce current signed, notarized QA build with real bundled resources and verify the manual preflight for both actual peers. If blocked, diagnose missing session, exact local approval, or mismatched enrollment without bypassing the gate.
3. Only after explicit signed device authorization and real transport confirmation, add the UI-triggered **one-shot** native TLS check, reconnect, replay/expiry, revocation and lost-session tests. All remote jobs remain disabled.
4. Only then allow one owner-approved **read-only** agent task with signed receipt, idempotency, cancel and lease-fencing. No unattended merge/deploy or external beta permission.
5. Add Windows after the two Macs' persistent trust survives restarts.

**No claim of real native Keychain/SAS device pairing, production Mesh enrollment or functioning remote tasks at Stage4I.**
