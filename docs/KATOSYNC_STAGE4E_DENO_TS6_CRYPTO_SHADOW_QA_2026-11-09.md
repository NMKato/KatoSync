# KatoSync 4.0 — Stage4E Deno TS6 Crypto Shadow QA

**2026-11-09 — QA only. No deploy, release, review signoff or database mutation.**

## Verified baseline

PR #247 commit `3924d1246485437b323535eeaf2f7ef4a1a917de`
has five new `*-entitled-qa` endpoints and SHA-pinned historic
Ed25519 Inbox/Relay handlers. Deno 2.9.6's TypeScript checker finds
five `TS2345/TS2769` WebCrypto `BufferSource` mismatches in
the Inbox-Send and Relay protocol and a sixth upon including the
Presence heartbeat. TypeScript 5.9's DOM/ArrayBuffer typing change
explains the static mismatch. It is not proof of a runtime signature
verification failure or of an exploitable live endpoint.

## New isolated crypto compatibility experiment

The fully offline test `scripts/qa-deno-ts6-crypto-shadow.mjs`:

1. Verifies source SHA-256 fingerprints before any transformation.
2. Copies only repository-local `supabase/functions/` to a 0700
   temporary `/tmp/katosync-deno-ts6-shadow-*` directory.
3. Replaces precisely six known WebCrypto call sites **in those copies**
   with a copied `Uint8Array<ArrayBuffer>` helper rather than
   an unsafe TypeScript type assertion. Touches only QA shadows of
   `mesh-inbox-send/send.ts`, `mesh-pairing-relay/protocol.ts`
   and `mesh-device-presence-qa/heartbeat.ts`.
4. Runs a strict `deno check --no-config --no-remote` of
   **all five entire QA entrypoint import graphs**, without
   `--no-check`; proves the TS6 error is addressable.
5. Generates a fresh ephemeral Ed25519 keypair and executes genuine
   positive/negative signature verification via **both ORIGINAL
   and shadow** implementations of `verifyRelayListProof` and
   `verifyStoredSignedMeshInvite`. Denies wrong owner,
   wrong origin, wrong recipient, nonce tamper, bad signature,
   and expired envelope; compares outcomes to ground truth.
6. Rechecks original hashes and removes temporary shadow sources
   under `finally`. No private key or test secret is persisted.

Local command:
```sh
npm exec --yes --package deno@2.9.6 -- bash scripts/qa-deno-mesh-stage4e.sh
```

The existing 12 native Deno QA runtime tests run without network access.
The new shadow test runs after them using Node 22's TypeScript stripping
and the temporary Deno 2.9.6 binary. In CI,
`pr-fast-gate.yml` adds Node 22 to the existing
**no-deploy** Deno job, without modifying other workflows.

### Observed proof markers (M2)

- `KATOSYNC_DENO_TS6_SHADOW_FIVE_ENTRYPOINT_TYPECHECK_PASS`
- `KATOSYNC_DENO_TS6_SHADOW_RELAY_REAL_ED25519_PARITY_PASS`
- `KATOSYNC_DENO_TS6_SHADOW_INBOX_REAL_ED25519_PARITY_PASS`
- `KATOSYNC_DENO_TS6_ORIGINAL_PINNED_BYTES_UNTOUCHED_PASS`
- `KATOSYNC_STAGE4E_NATIVE_DENO_QA_PASS_NO_DEPLOY`

All five observed in actual local execution.

## Remaining explicitly blocked issues

- **Not a live crypto source patch.** The original SHA-pinned
  Inbox, Relay and Presence source files are byte-identical; their
  production equivalents require separate security review,
  provenance update and independent release validation.
- **Inbox lifecycle unresolved:** the existing reviewed
  `mesh_inbox_resolution_guard` accepts only
  `accepted`/`rejected` transitions, not
  `cancelled` or `expired`. A newly added regression
  makes this outstanding limitation explicit; it does not
  circumvent the existing trigger or enable cancellations.
- **Atomic Mesh write guard QA only.** Its verified SQL and
  concurrent-revocation tests are not deployed to KATOOS.
- **Production blockers:** second real independent reviewer,
  trusted Native Ed25519 pin, Stage4E/Stage4F entitlement-billing
  rollout, actual Supabase Edge staging acceptance, M2/M3
  SAS/mTLS/revoke/account-switch, remote-job safety and an
  evidence-backed Accepted Ledger.

The QA run is not evidence that the real production Deno Edge
environment or Billing/Trial infrastructure has been certified.
PR #247 must remain **Draft**; no deployment or main merge.
