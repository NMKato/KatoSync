# KatoSync #76 — server-side task approval ledger, review-only

_2026-10-21. Third-party review REQUIRED. Branch security/approved-task-lease-gate-20261021, stacked on Draft #84 → #83 → #82 → #75._

## Objective
The earlier private PostgreSQL lease functions in PR #83 accepted an arbitrary caller-supplied approval UUID. This isolated SQL slice closes that **database-level gap**: acquire and renew refuse any call unless a matching, unexpired, unrevoked approval **row** has been issued by the trusted backend. A lease check joins the approval table, so a revoked approval immediately invalidates subsequent checks. Revocation also expires its matching writer-lease row without deleting the row or resetting fencing generations.

This is **NOT an authenticated end-user approval workflow** yet. A test-only privileged process inserted synthetic approvals directly. A production backend must independently validate the user session, active account membership, owned project, enrolled device identity, registered HEAD, exact operation scope and actual consent BEFORE inserting one. A client-supplied `approved_by` or proof digest is **not itself cryptographic proof**. No public-client or desktop access to the private schema is allowed.

## Implementation
- New private `katosync_private.task_approvals` relation: immutable account/project/device/task/HEAD/approver/proof digest/scope, time-bounded to <= 1 hour; one-way revocation only. Supported proposed scope is exactly `edit_worktree`.
- Invoker-context functions `acquire_writer_lease` and `renew_writer_lease` require a valid matching approval and use row locks against revocation. `check_writer_lease` joins the approval row for live validity. `revoke_task_approval` atomically revokes and expires any matched active lease.
- Existing monotonically increasing project fence, random lease UUID and bounded 15–120 second TTL from #83 remain in place.
- RLS enabled, no `anon`/`authenticated` grants. All functions remain in a nonexposed schema. Backend-only `service_role` may access them, but this does **not** make an unverified backend request safe.
- SQL changes are proposed as an ordered migration *after* #83. No cloud Supabase project schema has been changed.

## Reproducible local QA
Run `bash scripts/test-task-approval-postgres.sh` on an isolated macOS test host with PostgreSQL 17, `uuidgen`, and `psql`. Creates a fresh socket-only test PostgreSQL instance with synthetic roles and destroys it on exit.

Test evidence:
- No matching approval → denied. Forged account, project, device, task or HEAD → denied.
- Valid approved writer → one live lease; valid second writer to same project → denied.
- Wrong-account revoke, incorrect renewal and duplicate revoke → denied.
- Revocation makes old lease check and renewal fail; new approved device can acquire with strictly increased fence.
- Approval metadata modification rejected; expired approval rejected; client-role ACL denied.
- **12 two-session competing valid approval acquisitions**: exactly one lease winner on every trial.
- **8 acquire-versus-revoke concurrent races**: after both settle, no live lease and no re-acquisition through the revoked approval.

## Unresolved blockers — do NOT release
1. Trusted backend API route that verifies actor session, registered cryptographic device, account/project membership, explicit scope and audit provenance. A DB caller with service-role privileges can insert arbitrary approvals and should never receive unverified requests.
2. Native renderer/service bridge must never contain service-role credentials or accept model-generated proof claims; design authenticated short-lived broker interactions and an independent policy enforcement point.
3. Native owned task worktree (#84) still has NO production permit constructor and NO agent runner wiring.
4. Runtime must check both live server approval and fence **before every mutating operation**, and terminate subprocesses on lease/network loss. Losing a DB lease is not an OS sandbox or proof of stopped shell/Git activity.
5. No production CI / cloud deployment, no complete signed installers, no real cross-device connection and no unattended THEORG/Git writes. Independent review and multi-device failure/race tests remain mandatory.

## Artifacts
- `supabase/migrations/20261021173010_trusted_task_approval_gate_v1.sql` — generated using Supabase CLI
- `tests/trusted-task-approval.sql` — synthetic database invariants and negative tests
- `scripts/test-task-approval-postgres.sh` — disposable local QA and concurrency races

The implementation is a **DB-level authorization-reference invariant**, not an already verified user authorization channel. Issue #76 remains open and release-blocking.
