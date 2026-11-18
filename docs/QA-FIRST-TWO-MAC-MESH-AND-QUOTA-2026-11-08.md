# KatoSync first two-Mac and quota QA – 2026-11-08

**PASS: real private-LAN transport with synthetic cryptography, plus isolated PostgreSQL security gate. NOT a production Mesh release.**

## Hardware evidence

M2 Pro and M3 already had the isolated Stage35 QA app installed and running. Both bundles have identifier com.nmkato.katosync.meshqa.stage35, version 2.0.0. Both passed codesign verification, macOS Gatekeeper approval (Notarized Developer ID), and stapler validation. No installed app, Keychain item or owner account was changed.

The original signed-invite test source had the same SHA-256 on both hosts: f4e98562aa29713791b3811ed8ebdf208ae69d449e1415470aa0cf8f26ced4b2.

The M2 Pro hosted a one-shot pinned-TLS1.3 listener with disposable synthetic Ed25519 identity material; M3 received the signed invite, verified the dispatch and sender signatures, and returned its synthetic signed ACK. Both processes finished with exit code 0:
- M2: MESH_TWO_HOST_QA_SERVER_READY
- M3: MESH_TWO_HOST_QA_SIGNED_INVITE_RECEIVED
- M2: MESH_TWO_HOST_SYNTHETIC_ED25519_ACK_VERIFIED
- M3: MESH_TWO_HOST_QA_RECEIPT_VERIFIED

An independent negative M3 run deliberately changed the expected server certificate SHA-256 and correctly reported MESH_TWO_HOST_WRONG_CERT_PIN_REJECTED. No real KATOOS credentials or Keychain private keys were used.

## Database evidence

On M2 Pro, bash scripts/qa-mesh-postgres-local.sh quota-stage4e successfully created a fresh isolated PostgreSQL-17 Unix-socket-only, TCP-disabled cluster, installed the staged Stage4E function in that throwaway DB, and performed actual server-role SQL inserts.

Verified: missing policy means Free 0, two-device trial policy blocks a third device, expired policy denies, deleted policy denies, Pro 10 accepts precisely ten devices and blocks an eleventh, and anon/authenticated client direct writes/EXECUTE remain denied.

The exact success markers were KATOSYNC_STAGE4E_DISPOSABLE_QUOTA_FREE0_PRO10_EXPIRY_DENY_PASS and MESH_QA_ALL_SQL_ASSERTIONS_PASSED.

## Outstanding release gates

- Production PostgreSQL still has coalesce(allowed,2) in the old quota trigger. The Stage4E correction was NOT deployed.
- The live KATOOS registry includes four macOS devices, all discovered and none trusted; the owner's product and opt-in gates must not be inferred from this count.
- An independent real human Gate9 reviewer signature and verified KATOOS owner challenge are absent from live DB; no one was auto-enrolled or self-approved.
- Full native signed peer-trust acceptance, witnessed SAS comparison, revocation/account switch and live billing/entitlement are NOT proven.
- Keep GitHub integration PR #247 as Draft until all above gates pass.

Next safe physical test: user-witnessed native M2/M3 signed device challenge after separate owner + independent reviewer onboarding; no auto-pairing or remote jobs.