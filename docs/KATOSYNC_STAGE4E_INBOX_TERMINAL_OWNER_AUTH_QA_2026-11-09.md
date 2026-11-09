# KatoSync 4.0 — Stage4E authenticated owner Inbox cancellation (QA only)

**09 November 2026 · NON-DEPLOY · security-review HOLD · PR #247 Draft**

## Scope and provenance

The existing Stage4E `inbox-lifecycle` disposable PostgreSQL 17 QA
proved `pending→cancelled` and `pending→expired`, the legacy signed
recipient accept/reject path, immutable signed payload and owner/device
identity, serializable accept-vs-cancel row locking, idempotence and a
single atomic audit entry. The DB lifecycle QA function
`katosync.mesh_inbox_terminal_close_qa(p_owner,p_request,p_terminal)`
**is not deployed**. The DB `service_role` does **not** prove
the human identity of the requestor.

This new, separate **`mesh-inbox-terminal-owner-qa`** Edge candidate
provides the missing OWNER-facing authentication boundary. It does
**not** change historic signing handlers, original SQL migrations,
the production KatoOS database, stage flags or any live Edge endpoint.

## Owner-only cancellation API

`POST` body: `{"action":"cancel","requestId":"<UUID>"}`.
These are the **only** accepted fields. The request cannot supply
`ownerId`, `targetDeviceId`, a tier, SQL state, admin role,
trust flag or remote-job permission. The handler derives `p_owner`
exclusively from a server-side KatoOS Supabase Auth
`GET /auth/v1/user` check using the caller's USER JWT and
the anon/public key. A service-role secret or publishable key
is not accepted as a bearer credential. The authenticated
profile must be a canonical UUID, `role="authenticated"` and
not anonymous.

The server verifies `katosync.account_memberships` against
that same verified UID twice and refuses revoked, suspended,
unregistered, malformed or unavailable membership before any RPC.
The membership registry is queried with a private service-role
key only from the Edge server; secrets are NEVER forwarded to
the browser. There is no user-editable metadata or client
tier decision. A Free plan may still cancel a pending invitation,
because cancellation grants **no** Mesh capability, unlike
device registration or signed recipient acceptance.

Only after those checks, the privileged server sends
`{"p_owner":"<verified UID>","p_request":"<UUID>","p_terminal":"cancelled"}`
to `/rest/v1/rpc/mesh_inbox_terminal_close_qa` with
`Content-Profile: katosync`. The database RPC additionally
requires exact matching owner/request, locks the pending row
inside one transaction, prevents any changed signed content,
and records the terminal audit. This QA handler cannot send
`expired`, `accepted` or `rejected`; later automatic expiry
must have its own separately approved service-auth contract.

Responses: `closed` and `already_closed` map to HTTP 200
with `paired:false`, `transportReady:false`,
`remoteJobsEnabled:false`; `not_found` → 404;
`not_pending` / `wrong_deadline` → 409;
anything unexpected or offline → 503.
No CORS wildcard; other methods are denied.

## Deployment-isolation controls

The function is a **NEW, UNDEPLOYED alternate QA endpoint**.
It is disabled unless all of these are independently true:

1. `KATOSYNC_INBOX_TERMINAL_OWNER_STAGE=qa-cancel-only`;
2. `SUPABASE_URL` is a canonical 20-character Supabase
   project URL and is **not** the existing production
   `xbnnlyyxiilklsygxcof` project;
3. `KATOSYNC_INBOX_TERMINAL_OWNER_PROJECT_REF` exactly
   matches that QA project URL;
4. distinct nonempty server-side public/privileged keys;
5. the platform eventually enables `verify_jwt=true`
   and independent reviewers accept the staged SQL provenance.

All outbound HTTP targets are constructed from the verified
project URL, without redirect following (`redirect:error`),
with `cache:no-store` and an 8-second upstream timeout.
JSON input and upstream bodies have small hard size limits.
No source includes a deploy instruction or a user-accessible
service-role value.

## Observed QA

- **12/12** new Node synthetic authorization and negative-contract
  checks (disabled QA, LIVE origin forbidden, malformed and
  oversized body, direct service-key/JWT impersonation,
  anonymous and foreign roles, absent/revoked/malformed account
  membership, concurrent membership change before RPC,
  signed-out/auth failure, owner-bound RPC arguments, idempotence,
  negative SQL outcomes and no remote-job rights).
- **3/3** new real native Deno 2.9.6 tests: actual `index.ts`
  captured without opening a listener, default-off rejection,
  production KatoOS origin forbidden even with QA flag,
  and service-role bearer rejected.
- Full `deno check` for the new QA entrypoint module graph
  without `--no-check` passes. The prior 12 Deno tests and
  their SHA-pinned original-vs-shadow Ed25519 comparison remain
  in the same CI runner. This new code does not alter
  the historical signing primitives.
- The new server-side credential adapter supports legacy service-role
  JWTs as Bearer and modern `sb_secret_*` keys as `apikey`
  **only**, never converting a secret key into a forged JWT.
  A `sb_publishable_*` key in a privileged slot disables QA.
- Existing disposable PostgreSQL lifecycle race and Stage4E
  atomic write QA remain separate, not production DDL.
- **Physical M2 local regression:** Node **801/801** (including
  all 12 new synthetic owner-auth tests), Remote Usage **16/16**,
  full TypeScript/Vite build, Rust formatting, Bash syntax and
  Git diff clean. Native Deno 2.9.6 **15/15** tests passed
  (12 previous + 3 new), plus full typecheck of new
  handler/entrypoint and existing Ed25519 shadow-signature parity.
- The **real disposable PostgreSQL-17 inbox-lifecycle**
  acceptance and concurrent accept-vs-cancel race were re-run:
  all success markers observed; no live database touched.
- GitHub Windows/Web/Deno/Rust CI must be verified
  on the final exact-head commit separately.

## Remaining release blockers

**This QA proves no real KATOOS login or owner consent.**
A mock Auth response cannot substitute for a platform-signed
JWT; the actual staging deployment and its `verify_jwt`
platform gate have not been tested. Before promoting this
endpoint, bind actual user session validity (including
sign-out/revocation semantics), rate limits, audit actor and
request correlation as independently reviewed release
requirements. The SQL RPC is deliberately absent from
production, so calling the current live project would fail.

A suspended/revoked KatoSync member is denied an
OWNER-facing cancellation call, even though separate
administrator-initiated safety cleanup in the disposable
SQL gate can close a pending invitation after revocation.
That administrative cleanup must never be silently exposed
through this user endpoint.

Unresolved: independent human reviewer/key pin, actual
Supabase staging schema/migration and rollback, Stage4F
billing/expiry/revoke synchronization, authenticated
M2/M3 SAS and mTLS, remote-job acceptance/execution,
and evidence-backed verified progress.

**PR #247 stays Draft. No live SQL/Edge changes, no
permissions granted, no merge and no release.**
