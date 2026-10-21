# KatoSync Security #76 — live-session verifier (review-only)

21 October 2026. Candidate stacked on Draft PR #86, no deployment.

## Purpose

Add `server/security/supabaseLiveSessionVerifier.ts` as a backend-only AuthPort implementation for `TrustedApprovalBroker`. This replaces the *in-principle* test-only token check with a concrete verification design, while still requiring a future trusted production server and private database adapter.

To validate a supplied bearer token:

1. Require trusted server-configured HTTPS Supabase project origin (single `*.supabase.co` hostname, no path, port, credentials or redirect). The project key MUST be a nonsecret modern `sb_publishable_` key; no privileged key or legacy secret is accepted.
2. Ask the project Supabase Auth service `GET /auth/v1/user` to validate the token, with a bounded timeout, no caching or redirects. Never infer validity by decoding JWT bytes locally.
3. Only AFTER a valid Auth response, compare the returned user ID against the JWT sub claim and validate issuer, audience, role, session UUID and expiration.
4. Use a **server-only, parameterized** SQL reader to check the corresponding `auth.sessions` row still exists for that user. If signed out/revoked/session inactive, or database/network unavailable, reject even a JWT that has not cryptographically expired.
5. The resulting verified user ID, session ID, and expiry are passed to the existing backend approval contract. The broker now ALSO requires an explicit trusted policy lookup `canUseApproverDevice(userId, accountId, deviceId)` to bind the signing device to the actual owner, not simply to their account. Both the approving device and target executor must still be enrolled/trusted/not revoked.

## What is actually validated

- Verified macOS synthetic tests: expired session, wrong account/user, incorrect JWT claims, untrusted host, redirects/HTTP failures, anonymous Auth identity, DB-revoked session, malformed tokens, unknown signer ownership, simulated valid signed cross-device approval.
- Full `npm test` and `npm run typecheck:server`/frontend typechecks exercised against an isolated source checkout. No live user records or service-role key accessed.
- Current KatoSync desktop login already uses the Supabase Auth service but the new backend verifier is **not wired** to that login or a live backend. Authenticated sessions are verified only through injected synthetic Auth HTTP and DB mocks in tests.

## Important trust and deployment boundaries

- `SqlSessionReader` is a privileged server-only interface, NOT a PostgREST or frontend client. A future read-only database connection must be strictly limited to checking `auth.sessions` and must never be exposed to the desktop, agent, logs or model.
- `GET /auth/v1/user` verifies the bearer token, but an access token may remain valid after logout. This is why the separate live session check is mandatory.
- The token payload is only parsed AFTER Supabase Auth has independently accepted the same bearer token; parsing is **not a cryptographic verifier**. Do not replace the Auth API call with a plain JWT decode.
- A logged-in user's access does **not** authorize writes: the downstream authorization provider must check real owner/project membership and per-user signing-device affiliation. Never rely on mutable user_metadata or a friendly node name.
- Exact human intent/UI/user-presence requirements, durable atomic nonce storage, private task-approvals SQL insertion, backend audit/rate limits, per-operation fenced lease checks and native runner cancellation are NOT implemented here.
- No existing runner command is changed, no production DB migration is performed, no credentials shared, no automatic Git push/merge and no unattended production THEORG writes. Stacked security PRs remain Draft; Issue #76 release-blocking.

## Next milestone

Implement the trusted backend policy and storage adapters for account membership, registered device-to-user binding, and atomic challenge consumption using durable, tenant-scoped private tables; then wire a user-confirmation UI and live fenced worktree guard behind explicit flags. Require cross-device race, revocation, offline and crash tests, independent security review and native installer acceptance before release.
