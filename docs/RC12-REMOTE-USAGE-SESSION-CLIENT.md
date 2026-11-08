# RC-12 – Desktop Remote Usage session client (private QA only)

Date: 2026-11-08. **Not connected, not shipped, not enabled.**

## Scope

- New `src/lib/remoteUsageClient.ts` imports strict RC-11 response validators.
- Before any request, the calling KatoOS session manager must attach an authenticated, current session with an opaque per-login identifier and an asynchronous access-token provider.
- `refresh()` makes **only** `GET /api/usage/summary` and `GET /api/usage/history?months=6` requests against a reviewed HTTPS resource root (`https://host/mcp`). No client-provided owner, tenant, tier or device selector.
- Temporary OAuth bearer is used only in an Authorization header. It is not stored, exposed via API state, logged or persisted.
- Requests prohibit cookies, redirect following, caching and referrer leakage; cap JSON response size and strictly validate both payloads and month alignment.
- A failed/missing token, 401/403, malformed payload, non-JSON response, network failure or partial response displays no usage. A 503 is unavailable, **not** zero usage.
- `disconnect()` aborts pending fetches, clears prior UI state and invalidates delayed replies. `attach()` also invalidates old responses; generation checks protect against transports that ignore abort.
- Manual `refresh()` only. No polling, auto retry or hidden traffic before live KatoOS consent and reviewed gateway release.
- No new Tauri permissions, endpoint binding, deployment, secrets, payment configuration or mutations.

## QA

Run `npm run test:remote-usage` then `npm run build`; CI job remains no-deploy.
New tests include: no spontaneous network calls, only fixed endpoints, ephemeral bearer, no token, denied grant, invalid payload, logout during in-flight reads, account switching while in-flight, invalid resource URLs, and listener isolation.

## Mandatory remaining release gates

1. Integrate the **real** KatoOS account/session manager only after OAuth 2.1 resource-specific, asymmetrically signed JWT validation, verified account membership and active `usageReadApproved` grant exist server-side. **No synthetic accounts or token providers in production.**
2. Confirm the Cloudflare internal gateway routes and namespace binding are owner-authorized and supported by immutable audit, rate limiting and revocation tests.
3. Connect this client to the existing `RemoteCommanderUsagePanel` with a scoped React hook, invalidation on logout/account switch, visible loading/re-auth/error messages, and real macOS/Windows QA. Do not mount the client automatically before these gates pass.
4. Confirm actual `tools/call` metering, retention, quota thresholds, no double dispatch, operational costs and legal/privacy requirements.
5. Reconcile branch with current Stage35+ UX before any merge or notarized release.

Stacked on [KatoSync RC-11 UI Draft PR #243](https://github.com/NMKato/KatoSync/pull/243). The backend read-only adapter remains private in [Remote-MCP RC-11 Draft PR #13](https://github.com/NMKato/KatoSync-Remote-MCP/pull/13).

No public /mcp or /api endpoint is activated by this work.
