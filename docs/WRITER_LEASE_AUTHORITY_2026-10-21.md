# KatoSync #76 — fenced writer lease authority (isolated prototype)

_2026-10-21 — stacked security Draft. Not a production rollout, agent permission grant, merge approval or release._

## Scope and evidence

- Base: PR #82 (registered Git project **read-only** preflight); PR #75 is still a separate Draft integration candidate.
- This slice adds a **private PostgreSQL** table and four transactional, invoker-context functions: acquire, renew, check, release.
- The migration was generated through the Supabase CLI but is tested **only against ephemeral local PostgreSQL**, not deployed to any Supabase project.
- Mac PostgreSQL 17 local synthetic regression: sequential validation, identity/approval/head binding, re-acquire after release, monotonically increasing fence tokens, stale device denial, expiry, missing permissions and **12 two-session simultaneous acquire races** passed.
- The test script starts and stops an isolated socket-only PostgreSQL instance, creates synthetic local roles and removes the QA database afterward. It never opens a TCP listener or uses production credentials.

## Trust boundaries — essential

1. A registered Project Registry ID + current SHA is necessary for preflight but **not** sufficient to start an agent.
2. A backend must authenticate the real account/session and independently verify device enrollment, project membership, human approval scope, expected Git SHA, and resource entitlements **before calling acquire**. Client-provided UUID values are not authorization.
3. The private schema must be absent from exposed Supabase Data API schemas; **only a trusted backend/service role** has table/function grants. Desktop builds must never embed service-role credentials, passwords or reusable private keys.
4. A successful acquire returns a random lease UUID, strictly increasing per-account/project fence integer and short server-side deadline (15–120 seconds). Lease records must not be deleted or fence counters reset.
5. Each renewal, check and release binds account + project + device + task + human approval ID + issued lease/fence. Stale or mismatched callers fail closed.
6. The worker and deterministic tool broker MUST validate current lease and approval **before each mutating operation**, and fence downstream outputs (Git branches/receipts/checkpoints) by the same generation. On coordinator unavailability, loss/expiry/revocation, or changed HEAD: **stop and fail closed**. Existing subprocesses must be cancelable.
7. A database lease is **not** an OS sandbox. Local shell/Git permissions, owned isolated worktree, path allowlists, safe CLI invocation, network consent, and irreversible publish/merge gates are still missing.
8. No automatic Git push, provider credential transfer, production THEORG write, unattended node work or privilege escalation is authorized by this migration.

## Why these constraints matter

- A local mutex or filesystem lock is not sufficient for two devices; this prototype relies on PostgreSQL unique-row conflict locking.
- A task prompt, KUAS rules, model-generated node name or signed-in account cannot grant write authority.
- Expiry alone does not physically stop an already-running process. The executor must recheck the fence and approval and forcibly stop/reconcile stale processes.
- Backend authorization is still pending; the SQL alone cannot verify external project ownership, signed per-task approval or device identity.
- Application-level idempotency keys and trace IDs are required when queuing/retrying tasks; a stale duplicated request may not perform a second mutation.

## Next integration gates (not implemented in this slice)

- Backend narrow RPC with actual account/session/authenticated registered device and validated approval record; audit log, quotas, rate limits.
- Native client/service adapter with strict TLS, signed/short-lived per-task capability, operation-scoped allowlists, cancel-on-lost-lease.
- Owned Git worktrees with canonicalized registered root, clean HEAD, unique task path, cleanup and rollback receipts; no legacy checkout/branch edits.
- Two real devices racing one project, network partition, force-offline, revoke, reordered responses, clock skew, stale/fabricated fence, restart/crash and resumed job tests.
- Windows/macOS packaged GUI plus native Rust/Node regression and independent code/security review.
- Deployment requires a reviewed migration plan, backups, RLS/advisors, migration history and a controlled feature flag.

## Files

- SQL migration: generated versioned file in supabase/migrations, draft only
- Test: tests/writer-lease-atomic.sql
- Repeatable synthetic test runner: scripts/test-writer-lease-postgres.sh

Status: **backend lease invariant candidate verified locally; full Issue #76 is still OPEN and release-blocking**.
