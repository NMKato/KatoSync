# KatoSync 4.0 — Stage4E separate Supabase staging admission (non-deploy)

**Date:** 2026-11-09
**Status:** CONFIGURATION PREFLIGHT ONLY; Cloud acceptance **NOT** performed; PR #247 remains **DRAFT**.

## Read-only project inventory and cost guard

Connected Supabase inventory includes only the following four active projects:
KatoOS (old Cirqa), NMKato's Project, foodtracker-pignick, and GenXLine.
None is formally dedicated to KatoSync Stage4E staging. They are
all explicitly prohibited as testing targets by the static preflight.

The existing organization `NMKato's Org` is **Pro**, based on an
authorized read-only organization lookup. Supabase public pricing
indicates an extra continuously running paid Micro project may
incur approximately **US$10 per month** compute, with hourly
metering and possible additional charges. The Spend Cap does not
cover Compute. **Do not create or bill a new project without
the owner's explicit acceptance of the organization-specific
cost quoted by the Supabase tool.**

A separate *isolated* project is preferable to an unreviewed
branch of KatoOS production because branches may clone customer
data, carry secrets or share production integration assumptions.
Existing project identifiers do not imply permission to repurpose.

## New artifacts (all offline)

- `release-candidates/stage4e/staging/edge-functions.toml`:
  **non-active** template with
  `[functions.mesh-inbox-terminal-owner-qa]`
  and explicit `verify_jwt = true`. There is no
  `supabase/config.toml` at the project root; a future
  operator must separately review and merge the configuration.
- `release-candidates/stage4e/staging/preflight.mjs`:
  strict, **offline** project/tenant eligibility and
  SHA-pinned source-admission check. It neither looks up a
  cloud project nor calls any Supabase API.
- `tests/meshStage4EStagingStaticPreflight.test.ts`:
  ten negative-input and provenance tests; **10/10 passed on M3**.
  It cannot generate a deployment or billing confirmation.
  The full Node suite is **816/816 passing** locally on M3,
  including the ten new tests. The cross-platform CI on the
  final commit is the independent release-hold evidence.

The preflight manifest contains only project **public metadata**
(no JWT, password, connection URL, secret key, customer identifiers
or real test accounts). It permits a *synthetic* 20-character
Supabase project ref only if different from **every one of the
four currently protected projects**, in the expected EU region
and organization. The input is **not trusted as proof that a new
project exists**.

CLI usage, only **after** a real separate project has been approved
and its reference verified by read-only Supabase discovery:

```sh
node release-candidates/stage4e/staging/preflight.mjs \
  --manifest /path/to/PRIVATE_NON_SECRET_STAGING_MANIFEST.json \
  --offline-static-only
```

The CLI never accepts `--deploy` or `--approve`, rejects
unexpected manifest fields and disallows `Bearer`, private API
key strings or database URLs in the supplied input. A passing
result explicitly prints:

- `staticOnly: true`
- `actualProjectExistenceVerified: false`
- `actualJWTGatewayVerified: false`
- `billingApprovalGranted: false`
- `cloudDeploymentAuthorized: false`
- `productionReleaseAuthorized: false`.

This is **proof that the candidate remains isolated**, not an
authorization for anyone to deploy it.

## Required real cloud staging gates (NOT performed)

1. **Billing/ownership:** Obtain a Supabase tool quote for the
   designated organization, get explicit cost approval, create
   one named `KatoSync Stage4E Staging` project only then,
   in EU Central. Confirm its unique project ref via live
   project inventory. Record budget alerts and intended
   destruction date; avoid carrying over production data.
2. **Auth configuration and algorithm:** On that new project
   identify whether it issues legacy HS256 or modern asymmetric
   signed access tokens. Confirm the actual Edge gateway
   `verify_jwt` semantics for that **specific** signing-key
   configuration with valid, missing, malformed, expired,
   wrong-project and revoked-session test tokens. Supabase's
   current published JWT signing-key and Edge authorization
   guides discuss asymmetric tokens differently; do **not**
   assume either behavior without real integration evidence.
   **Never disable gateway JWT checks solely to clear 401**
   or silently permit API keys as user identities.
3. **User-session fidelity:** Real Auth login, `getUser` verification
   and sensitive-operation session revocation must be proven
   against server-side current session state. Logout can leave
   previously issued JWTs valid until expiry; relying on
   a bearer token and two membership lookups alone does
   not prove immediate session invalidation.
4. **Database provenance:** Independently review all Stage4E
   and terminal-lifecycle migrations before constructing a
   **new** staged migration history. Test table/trigger
   availability, owner indexes, RLS and function grants;
   service-only writes and `SECURITY INVOKER` by default;
   no `anon` or `authenticated` execution of the terminal
   RPC. Do not copy the QA override directly into the
   production migration directory.
5. **Atomic behavior:** Stage signed `pending→accepted/rejected`
   with recipient-key proof; `pending→cancelled`
   owner-only; `pending→expired` admin-only. Test
   Free0, Pro10/11th device rejection, 14-day trial
   expiry, membership revoke, concurrent cancel vs accept,
   same-owner replay, wrong-owner denial, and exactly one
   transactional audit per successful closure.
6. **Rollback is fail-closed:** The emergency response must
   stop **new** Mesh enrollment and pending write/accept
   requests, while allowing safe device revocation and
   already-verified non-mutating views. Never revert to
   `coalesce(allowed,2)` or grant a default two peers,
   and never re-enable remotely executed jobs on rollback.
   Independently verify snapshot/restore and orphan cleanup.
7. **Native release:** Require a real independent human reviewer
   with an Ed25519 public-key pin plus genuine M2↔M3
   trust/SAS/Keychain and revocation tests. Synthetic
   signatures and CI green are not a substitute.
8. **Promotion:** Require second-person security review,
   exact deployed Edge code/content hashes, exact Postgres
   migration list, signed Accepted Ledger evidence and
   explicit owner authorization before any production
   promotion or merger of PR #247 into `main`.

## Already proven and not to be confused with cloud acceptance

The source-locked local test in
`tests/qa/meshInboxOwnerLocalStackStage4E.mjs`
has already passed on physical M2, M3 and GitHub's
isolated PostgreSQL17/Node22 container at commit
`5650377ee2066547b0a222e703c0d4d17eddfa73`.
The Linux GitHub exact-head manual and PR Fast Gate were
both **4/4 success**. Those runs cover cryptographic
synthetic ES256 JWT verification in a LOCAL service,
actual local owner-scoped PostgreSQL RPC and
single-use transaction audit, NOT the Supabase-hosted
Auth service, JWT gateway, session table or migrations.

## Decision

**Prepare only. DO NOT spend, create Supabase project,
create customer/Auth accounts, deploy Edge or SQL,
issue reviewer keys, merge `main`, or enable Mesh jobs
under the authority of this document.**
