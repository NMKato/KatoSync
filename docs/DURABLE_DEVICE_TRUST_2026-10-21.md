# KatoSync #76 — durable private device trust and single-use approval challenges

_2026-10-21. Review-only stacked Draft branch security/durable-device-trust-and-challenge-20261021, based on Draft #87. Never deploy automatically._

## What was added

- A Supabase-CLI-generated *private-schema* SQL migration defining `project_memberships`, `trusted_devices`, and `approval_challenges`.
- Memberships scope an authenticated user to an account and registered project, with `owner` or `approver` eligibility. A `viewer` is not allowed to approve edits. Revocation is one-way, and identity/role cannot be quietly reassigned.
- Devices have an immutable owner/user/account association and signing public key. Revocation is one-way; replacing a key must go through separate verified enrollment. **Inserting a trusted device is privileged and requires real backend enrollment and ownership verification**, not a client flag.
- An approval challenge is tied to account, project, task, authorizing device, executor device, expected Git SHA, current user/session and `edit_worktree` scope. Nonce uniqueness and 90-second expiry enforced by database constraints. A consumed challenge cannot be restored or rewritten.
- `consume_approval_challenge(challenge, actor, session)` uses a single atomic `UPDATE ... RETURNING` so only one concurrent actor/session can consume it.
- Enabled RLS and private grants: no `anon` or `authenticated` table/function exposure. Keep the `katosync_private` schema out of the Supabase Data API. No client-side privileged keys.
- New **backend-only TypeScript adapter** `server/security/durableAuthorizationPorts.ts` supplies the existing broker policy and challenge storage ports with fixed parameterized SQL. When creating a challenge, the SQL simultaneously verifies eligible project membership, signing-device-to-user ownership, worker-device enrollment and existence of the Auth session, then fails closed on zero inserted rows. Consumption uses only the atomic DB function.

## QA evidence

`bash scripts/test-device-trust-postgres.sh` runs strictly in a disposable, socket-only local PostgreSQL 17 instance. It applies the earlier #83 and #85 migrations, then this candidate. Synthetic SQL tests verify membership/owner role, foreign-user device rejection, immutable key/identity, one-way revocation, session binding, expiry/replay defense, non-public ACLs and **12 two-process atomic nonce-consumption races** (exactly one win per challenge). All passed on macOS QA.

`npm test`, `npm run typecheck:server` and `npm run typecheck` cover this new adapter as well as existing code. Adapter tests verify parameterized project and device lookups, durable challenge insertion requiring server-owned authorization, fail-closed database errors, and function-bound nonce consumption.

All identities/signing keys in these tests are **synthetic**. No real Supabase project, login, service key, THEORG data, or production KatoSync app was modified.

## Important remaining limitations

1. **Not a completed identity system.** These tables are candidate authorization metadata and cannot on their own prove a human approved a task. A real trusted backend must verify login/session, cryptographic device enrollment and account/project access before accepting inserts or approving claims. Never accept arbitrary client claims as ownership or enrollment evidence.
2. A service-role connection can still insert arbitrarily into private tables. The production server must limit privileges, validate actor/session, ensure auditable user intent, rate-limit, and transact safely; native clients must never hold that credential. Real multi-instance nonce persistence is untested on a deployed database.
3. The final private approval receipt insertion path (from #85) still requires a backend-owned, tenant-bound authorization transaction. This candidate only handles project/device policy and nonce storage, not the actual final consent and writer launch.
4. The server contract still has no live HTTPS endpoint or protected confirmation dialog. GUI presence/user action plus OS-protected signing keys are release gates.
5. No native code-writing runner change, end-to-end live lease fence at each mutation, forced subprocess termination on network/lease loss, two-real-device collision and offline replay, security review or installer release. Existing #76 blocker remains OPEN.
6. No main/dev merge, no Supabase live migration and no automatic task/production THEORG writing. Do not treat SQL QA or a Draft PR as production-ready SmartMesh.

## Follow-on

Build tenant-scoped audited approval persistence and a narrow authenticated server adapter, then a user-initiated signing UI with owner-visible task details. Only once fully verified, connect a restricted native worker in an isolated worktree and enforce active fenced lease before **every** mutation, including crash/network partition and 2+ device stress tests.

Project handoff also lives in gitignored `PROJECT_STATUS_FLOW.md` and `MEMORY.md`.
