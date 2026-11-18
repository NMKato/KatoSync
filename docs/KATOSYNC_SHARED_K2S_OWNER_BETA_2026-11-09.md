# KatoSync 4.0 — Shared K2S private owner beta, no separate staging

**Date:** 2026-11-09
**Decision:** User explicitly rejected an additional Supabase staging project.
KatoSync uses the existing isolated `katosync` schema on the shared
EU-central KatoOS/K2S project, not a new database. Private pilot:
physical M2 → physical M3 → existing Windows machine. No external customers
or paid plans during this owner self-test.

## Verified current state (read-only K2S inventory)

- Shared Supabase project reference: `xbnnlyyxiilklsygxcof`; region EU Central.
- `katosync` schema is already present: 15 tables, RLS enabled for all.
- Existing KatoSync records, aggregate only: 1 active membership,
  1 explicit policy at 10 device slots (manual opt-in still
  not verified), 4 discovered devices and 2 accepted invitations.
  This does **not** prove trusted pairing, SAS/mTLS or remote jobs.
- Mesh enrollment/presence/inbox/relay Edge functions are already
  installed with platform `verify_jwt=true`, but earlier
  Stage4E entitled-qa endpoints and the owner-cancel RPC are NOT live.
- **Important pre-beta defect:** the *live* legacy
  `mesh_device_quota_guard()` uses fallback `coalesce(allowed,2)`
  and the policy column defaults to 2; the original roster's
  immutable identity update trigger is absent.
  No further device-write activation until this is fail-closed.

## Release candidate: minimal in-schema security hardening

`release-candidates/stage4e/shared-k2s/20261109145621_katosync_shared_beta_failclosed_device_quota.sql`
was generated via the Supabase migration CLI as a **review candidate**.
It alters only `katosync` objects, not KatoOS tables or user accounts.

The prepared candidate:
1. Drops the default implicit two-device policy; requires an
   explicitly server-provisioned 1–10 device quota.
2. Requires a currently active KatoSync membership in the same
   transaction, with locks on the policy and membership rows.
3. Preserves the per-owner transaction-level advisory lock, counts
   revoked identities toward quota and checks expiry using
   `clock_timestamp()`.
4. Prevents owner, key and fingerprint rewriting of an existing
   registered device, and prevents silent undoing of revocation.
5. Retains the current explicit private owner policy without
   assigning any new billing, customer, reviewer or remote-job rights.
6. Adds no KatoOS Auth/table mutation, unsafe public grants,
   Supabase function deployment, device enrollment or invitation
   mutation to the migration.

**Executed QA, fresh PostgreSQL 17 isolated Unix socket:**

```sh
bash scripts/qa-mesh-postgres-local.sh shared-beta-failclose
```

Observed: `KATOSYNC_SHARED_BETA_DEFAULT_OFF_AND_ROLES_PASS`,
`KATOSYNC_SHARED_BETA_FREE0_EXPIRED_MEMBER_PRO10_IDENTITY_PASS`,
`KATOSYNC_SHARED_BETA_LOCAL_PG17_NO_KATOOS_DATA_PASS` and
`MESH_QA_ALL_SQL_ASSERTIONS_PASSED`.

The exact same test is added to the existing GitHub CI
nondeploying PostgreSQL17/Node22 container with `--network none`
and an ephemeral read-only filesystem. Full CI conclusions
must be checked on the final commit.

## Safe route to actual self-testing on shared K2S

**Gate A — schema admission (currently prepared only):**
Verify the exact live functions/default/RLS/triggers immediately
before applying DDL, confirm a usable recent backup/restore
procedure, get a human-reviewed atomic migration/lock budget,
then apply only the minimal quota/identity hardening.
Record exact migration version and re-read object/grant metadata.
Never run the historic local QA overlay on live K2S.

**Gate B — private device inventory:** Using the actual owner
KatoOS login, verify M2 device identity and real API token,
then M3. Existing `discovered` entries should be reconciled,
not blindly doubled. Provide a refresh/retry button, visible
connection states and signing-key continuity. No automatic
trust or remote executions.

**Gate C — private signed pairing:** With genuine M2↔M3
SAS/Ed25519 pins and authenticated WebSocket/mTLS transport,
prove accept, replay rejection, account switch, revoke,
disconnect and reconnect. Until then, `paired=false`,
`transportReady=false`, `remoteJobsEnabled=false`.
No autonomous GitHub merge or deployment.

**Gate D — Windows:** Build/package/sign Windows separately,
verify owner login, distinct key identity, refresh, revocation
and 3-device behavior; no assumption that another "discovered"
row is the Windows machine until proven.

**Gate E — readiness to invite outside beta users:** Independent
security/reviewer acceptance, Stage4F real entitlement/trial
and billing, crash/error/backup telemetry, audited recovery,
verified project-progress reporting and secure remote-job
contract. These remain blocked until proven.

## Rollback/kill-switch strategy

- First disable KatoSync enrollment and remote-job requests,
  not the whole shared K2S project.
- Keep `verify_jwt`, RLS and signed message verification on.
- Do not roll back to the historical implicit two-device
  `coalesce(allowed,2)` logic.
- Preserve existing audit rows, signed inviter data and
  device identities; never purge current users to reset tests.
- Verify per-feature rollback and real restore point before
  applying any live-schema migration.

## Tracking

The prior offline staging preflight is now **superseded for the
private pilot** and remains historical audit evidence only.
It must not be reused as justification to create a paid
Supabase project. No new Supabase expenses or hosted staging.
PR #247 remains Draft until an independently checked, controlled
deployment decision; `main` must not be merged as a substitute
for the private installation.

**No live K2S data or schema was modified by writing this runbook
and local-only migration test.**
