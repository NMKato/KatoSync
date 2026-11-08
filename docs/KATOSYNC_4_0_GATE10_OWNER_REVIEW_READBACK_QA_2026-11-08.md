# KatoSync Gate 10 – owner-scoped signed Gate9 review READBACK (QA only)

**2026-11-08. No production deployment. No live grants or reviewer enrollment.**

The native Gate9 Rust module at
`src-tauri/src/memory_fabric/acceptance_ledger/reviewer_attestation.rs`
has a pure signature verifier, but the existing KATOOS reviewer Edge route
cannot securely serve the stored decision to its subject owner. This PR
adds a separate **READ-ONLY** server endpoint and an offline mock test.

## Source: `feature-owner-readback-qa`

- `handler.ts`: self-contained, restricted POST `readback` taking exactly
  `decisionId` and `grantId`. Strongly gated by
  `KATOSYNC_FEATURE_APPROVAL_STAGE=qa`; the canonical KATOOS origin must
  match; anonymous, malformed or other-role calls get no data.
- Every request verifies the fresh caller identity via the existing
  KATOOS `/auth/v1/user` path. User-editable metadata is never used.
- `account_memberships` must be active and unrevoked.
- The sensitive `feature_approver_grants` and
  `feature_owner_review_decisions` reads are BOTH filtered by that
  exact authenticated subject owner UID and the target grant/decision.
  Privileged `service_role` is used **only inside the server handler**.
  No client receives a service-role key, and every data read has a
  `limit=2` + exact-one-row check.
- Independently re-reads **current** reviewer membership, admin-enrolled
  reviewer role, active enrolled key and revision, project state, the
  original consumed owner proof and grant status. All must match the
  stored signed 14-field decision and the current owner. A revoked
  reviewer/key, changed version, missing proof or wrong owner fails closed.
- Rechecks Ed25519 cryptographic signature against current enrolled
  reviewer key. Returns a restricted no-cache JSON with signed
  attestation and signature for a separate native re-verification.
- The response explicitly states `grantsRights:false`,
  `verifiedPercent:null`, and identifies itself as a
  **server assertion untrusted until native verification**.
- **No** database writes, DDL, owner activation, enrollments, reviewer
  provisioning, CORS, arbitrary URL/redirect, or secret output.

## Tests and limitations

`tests/featureOwnerReviewReadbackGate10.test.ts` exercises signed
synthetic Ed25519 persisted decisions, positive scoped owner read,
wrong-account reads, stale/revoked reviewer and signer, wrong key,
missing consumed challenge, invalid request/auth, signature tampering,
and disabled stage. All network calls are deterministic in-memory mocks.
Tests assert the privileged backend performs **GET only**, with no writes.

The endpoint is **not yet deployed**, and no real KATOOS owner access
token, reviewer private key or live decision was obtained.

A successful server review readback must **NOT** be treated as a native
trust anchor: Native must fetch/pin the reviewer key by a distinct,
trusted, independently authorized mechanism and verify the persisted
decision cryptographically. This endpoint does **not** yet connect a
native app to a stored live Gate9 record.

The currently implemented native verifier requires signed decisions
younger than 60 seconds. Long-term historical re-read and a separately
signed fresh authority statement require additional design, testing
and security review before production use. Do not weaken the existing
freshness gate to make a historic signature appear valid.

**Go-live remains blocked** until two independently authorized human
accounts have actually approved the owner challenge and native reviewer
key trust, M2/M3 SAS was witnessed, Stage4E quota is securely installed
with rollback and native readback/expiry tests pass. Keep PR #247 Draft.
