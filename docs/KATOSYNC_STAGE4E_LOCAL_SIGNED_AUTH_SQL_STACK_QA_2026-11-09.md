# KatoSync 4.0 — Stage4E local signed Auth → Edge → PostgreSQL 17 QA

**9 November 2026 | Non-production | No cloud deployment | PR #247 remains Draft**

## Why this candidate is local

A read-only inventory of Supabase projects showed four active projects:
KatoOS, NMKato's Project, foodtracker-pignick and GenXLine. None was
explicitly designated KatoSync staging. Their active status does not
authorize treating a different project's records as disposable.
**No new cloud project was purchased or created. No existing project,
API key, user record, Edge function or DB was mutated.**

A real staging release still requires a separate approved Supabase
project, actual `verify_jwt=true` platform authentication,
real dedicated test users, a reviewed migration with RLS/grants
and rollback, and independent reviewer approval. This local QA
**is not a substitute for those checks**.

## What was actually executed

The new runner:

```sh
bash scripts/qa-mesh-postgres-local.sh inbox-lifecycle-localstack
```

creates a fresh PostgreSQL 17 cluster in a private
`/tmp/ksmeshqa.XXXXXX` directory, listens **only on a Unix
socket**, and refuses a TCP DB listener. The existing SHA-verified
original lifecycle migrations, Stage4E atomic entitlement trigger,
recipient proof invariants and QA-only terminal RPC are installed
as disposable SQL. The cluster is fully removed on completion.

Within the same disposable cluster, the new
`tests/qa/meshInboxOwnerLocalStackStage4E.mjs` starts a synthetic
Auth/Data API on an **ephemeral loopback port (127.0.0.1)**.
Its synthetic project origin never targets the real KatoOS project.
An isolated, freshly generated ES256/P-256 JWT signer issues
short-lived user tokens. The local Auth endpoint **cryptographically
verifies the JWT signature** and checks an in-memory live session
registry, expiration, issuer, role and session UUID, rather than
simply decoding the token. No real user/password or private
key is loaded or persisted.

The test invokes the ACTUAL, unchanged
`handleInboxTerminalOwnerQA` handler from
`mesh-inbox-terminal-owner-qa/handler.ts`; its fetch adapter
forwards only three permitted URL paths to this localhost gateway:

1. `GET /auth/v1/user`: cryptographically verified synthetic
   ES256 user and session.
2. `GET /rest/v1/account_memberships`: fresh, owner-scoped reads
   from the actual disposable PostgreSQL table, twice per call.
3. `POST /rest/v1/rpc/mesh_inbox_terminal_close_qa`: actual
   PostgreSQL `SET ROLE service_role` invoking the reviewed
   owner/request-scoped, row-locking terminal RPC. Service access
   requires the private API key as `apikey`; the
   public client key cannot issue an RPC.

**Observed successful independent on-device runs:** Physical M2
and M3 both passed this local integration test with genuine PG17
transactions, not mocks for the SQL layer. The complete M3 Node
regression passed **806/806** cases, including five new local-stack
contract tests; full build, Rust-format and remote-usage checks
are separately recorded in the CI/M3 audit.

The assertions prove:
- Bad ES256 signature, expired token and signed-out session
  never reach the privileged cancellation RPC.
- A revoked KatoSync member (even with a valid session) is
  denied before RPC.
- An independently authenticated, *active* user cannot close
  another owner's pending invitation. The SQL result is
  `not_found` without leaking owner or row details.
- With paid `mesh_owner_policy` removed, the correct owner
  can safely perform a **restrictive** `pending→cancelled`
  close; the returned response explicitly denies pairing,
  transport readiness and remote jobs.
- A replay returns `alreadyClosed` without a second audit.
- The older recipient proof cannot accept an invitation
  after the terminal closure.
- The test never fetches another project origin, follows
  a redirect to production or exposes the service-role key.

The *separate earlier test* `inbox-lifecycle` still proves
real two-session simultaneous `cancel` versus `accept`
serialisation, and the previous Stage4E atomic write test
proves entitlement revocation is transactionally serialized.

## Reproducible non-deploy GitHub CI

The existing `.github/workflows/pr-fast-gate.yml` Deno Mesh
Stage4E QA job adds an extra two-step integration test. It builds
`tests/qa/pg17-node22-localstack.Dockerfile` using the official
`postgres:17-alpine3.22` image plus Alpine's Node 22 and Bash.

The test container uses:
- `--network none`: **no network egress or ingress**, except
  the loopback device inside the isolated namespace.
- `--read-only` plus ephemeral restricted `--tmpfs /tmp`;
  no durable database or filesystem writes.
- All Linux capabilities dropped, `no-new-privileges`,
  non-root `postgres` OS user.
- Read-only source mount. Only the freshly created
  Unix socket directory and localhost Auth service are used.
- Existing Node/Deno crypto and contract suites run as before.
- No Supabase deployment credentials, no production secrets,
  no payment actions, no customer/user data.

The image **build** may download official image/package layers,
but the integration **execution** is explicitly offline.
GitHub workflow success must be verified on the precise PR commit.
A green GitHub test is **not** a production Edge or
Supabase platform JWT acceptance.

## Outstanding P0 barriers

- Create and separately approve an actual KatoSync Supabase
  Staging project before ANY hosted integration. Do not reuse
  a different live tenant as scratch space.
- Verify real Supabase JWT gateway semantics, session
  invalidation/signout, rate limiting and actual
  non-anonymous KatoSync account admission.
- Review user-authenticated terminal SQL grant/RLS/audit,
  migration ordering and rollback; the SQL function
  currently exists only in disposable QA.
- Independently enroll a second human reviewer and pin
  their Ed25519 key in native release policy.
- Finish Stage4E Free0/Pro10 policy rollout, Stage4F billing
  and expiry synchronization, and actual M2/M3 SAS/mTLS,
  Windows and signed Mesh remote-job execution tests.

**No production SQL, Edge function, customer rights, main merge
or release were made. PR #247 remains Draft.**
