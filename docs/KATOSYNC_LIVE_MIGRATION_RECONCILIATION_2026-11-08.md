# KatoSync / KATOOS live migration reconciliation — 2026-11-08

**READ-ONLY AUDIT. NEVER APPLY THESE QA FIXTURES TO A LIVE DATABASE.**
**PR #247 remains Draft: independent signed reviewer and native hardware review required.**

Live database: shared KATOOS Supabase, Germany/EU region. Verified from
read-only migration history, database objects, RLS metadata and SQL hashes.

## Verified facts

- Seven exact-version migrations were installed. Their stored executable
  SQL bytes match the local source after accounting for a trailing newline
  and (in one case) three non-executed introductory SQL comments.
- Five historical Mesh SQL migration files were applied LIVE under other
  Supabase migration version numbers on 2026-11-02, with byte-identical
  SQL source/MD5. The old versions must NEVER be replayed as migrations.
- Three planned SQL changes are NOT registered as applied:
  20261103162300 mesh_one_time_trial_claims (trial ledger);
  20261103162500 mesh_entitlement_expiry_guard (quota expiry);
  20261103164548 katosync_billing_product_scoped (billing/webhooks).
  They need independent approval and a genuine Stripe/webhook/RLS audit.
  No corresponding Mesh Trial or Billing subscription/event tables
  exist in the live database. The quota guard function exists but its
  expiry semantics are not yet proven equivalent to the planned SQL.
- Seven live Gate-9 Feature Approval tables exist. All inspected Mesh
  and Feature Approval tables have RLS enabled. No anon SELECT grants
  were found and ordinary authenticated users lack SELECT/INSERT grants
  on feature approval tables. Forced RLS was not enabled and privileged
  grants require separate security review.
- Gate-9 has zero projects, reviewers, reviewer signing keys, grants,
  owner challenges, review decisions, and audit records. No real
  independent reviewer signature or owner approval has been issued.

## Historical alias map with identical installed content

| QA file version | LIVE Supabase version | Name |
|---|---|---|
| 20261029211243 | 20261102143138 | mesh_inbox_signed_send_guard |
| 20261030072543 | 20261102143254 | mesh_recipient_signed_inbox_atomic_decisions |
| 20261030074910 | 20261102143424 | mesh_resolution_proof_binding |
| 20261030093323 | 20261102143501 | mesh_inbox_recipient_key_continuity |
| 20261031213900 | 20261102143529 | mesh_pairing_relay_staged |

## Safeguarded QA source layout

- supabase/migrations now contains just the SEVEN migrations already
  installed under identical version/semantics.
- tests/fixtures/migrations contains FIVE already-executed, old-version
  Mesh SQL source fixtures plus THREE unapplied Trial/Billing proposals.
  They retain their original SQL bytes and pinned SHA-256 fingerprints,
  and can be used by isolated PostgreSQL and Edge QA tests.
- tests/releaseMigrationSafety.test.ts fails the native CI if one of
  these eight files returns to production migration discovery.
- No CLI migration was applied, no OAuth/Cloudflare/Edge service was
  activated, and no production database row was modified by this audit.
- NOTE: This source-level protection does NOT prove a future Supabase
  migration push is safe. The live registry has remote-only migration
  versions that require a separately reviewed reconciliation plan.
- Existing historical offline baseline preflight tests may model an
  old not-yet-deployed scenario; they are not live authorization.

**Production remains BLOCKED until independent signed reviewer approval,
native M2/M3 hardware acceptance, and all deployment safeguards have
been verified against the exact future release candidate.**
