# RC66 – Owner-visible Remote MCP consent & revocation
Date: 14 November 2026. QA-only desktop implementation, no production change.

## Intent and separation
ChatGPT OAuth login (RC64) is verified, but OAuth login is not Remote-MCP device consent.
RC65B provides *default-off*, independently scoped tools, not a production device API.
KatoSync Stage4V locally paired Mesh is not signed continuous network presence.
RC66 must visibly distinguish those states and never promise remote control.

## Delivered on Desktop QA branch
- Settings panel `RemoteCommanderPermissionsPanel` in four existing UI locales (DE, EN, ES, RU), separate from Remote Commander usage statistics.
- Live data is only displayed when `parseRc66ConsentSnapshot` accepts a recent, strictly shaped, server-provided snapshot.
- No synthetic clients/devices and no default API connector. The panel says permissions are unavailable until real owner-verified server data exists.
- When a trusted `onRequest` handler is supplied in a later release, the panel supports a two-step review: select exact client/device operation, then check explicit confirmation and submit a revision-bound **review intent**.
- A submitted intent does not mean the grant changed: owner must wait for a fresh verified server snapshot.
- No direct access to Supabase, no secrets, no local Mesh scan, no background grants, no terminal/file/GUI tools.
- Old usage panel text is updated to avoid falsely claiming ChatGPT OAuth login remains disabled when only its independent desktop statistics API is missing.

## Existing production schema (read-only verified)
- `katosync.remote_mcp_client_grants`: 0 rows.
- `katosync.remote_mcp_device_consents`: 0 rows.
- `katosync.mesh_devices`: 6 rows (not authorization).
- Grant tables have RLS and FORCE RLS enabled; DB constraints require valid status, receipt hash for approved grants, expiry, correct owner/grant/device relationships.
- A legacy RC5 grant-reader expects `approved_by_user_id` even though the current table does not have this column. Server-side adapter must be reconciled against production schema before integration.

## Required backend authority – NOT IMPLEMENTED HERE
1. Read server-signed OAuth identity, unexpired session, exact client and tenant, eligibility and entitlement; do not trust client-supplied owner/tenant or JWT user_metadata.
2. Owner-scope approved client grant and per-device consent, with exact revision and expiry. Require fresh step-up/MFA confirmation for approval and a separate, explicit owner-revocation action.
3. Atomic transaction with serializable version/expected revision, replay-safe nonce/idempotency and SHA-256 receipt of signed approval context. Status transitions must not be expressible solely by browser JSON. Explicitly enforce least-privilege `devices.list` and `device.status` only.
4. Reject foreign/cross-tenant devices, revoked/unsigned or expired presence. A local pairing or old heartbeat is not an online session.
5. On revoke, invalidate authorized client/device cache and deny future MCP tool calls even if access token is still valid; client access and device grants are independently verified per request.
6. Audit only bounded metadata/correlation ID; no token, passphrase, local path, IP, signature key, sensitive content or user details in the UI or logs.
7. Test with two different owners, different clients, stale revision, expired grants, replay, concurrent approval vs revoke, offline/revoked devices, new session and cross-device M2/M3 negative E2E before any production rollout.

## Release gate
This is a source-only QA contract, not permission to add the tables to the Data API or grant `authenticated` UPDATE privileges. Never deploy approval/revocation UI handlers until the server adapter, step-up gate, audit and rollback are independently verified.
