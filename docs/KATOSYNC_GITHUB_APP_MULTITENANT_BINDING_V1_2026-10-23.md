# KatoSync GitHub App — multi-user identity binding and registered app setup
Date: 2026-10-23 | Isolated Draft PR stacked on PR #111

## Verified operator setup
Public GitHub App: https://github.com/apps/katosync-project-manager
App ID: 5442312; owner: NMKato. The public OAuth Client ID is
compiled as a default so desktop users share the same *application identity*.
This Client ID is NOT a private key, client secret or bearer credential.

App metadata returned by the authenticated read-only GitHub CLI API:
contents:read, issues:read, metadata:read, pull_requests:read,
organization_projects:read. No write scopes. User's screenshot confirms an
installation on NMKato currently configured for all repositories. The
normal gh CLI access token is not a GitHub App user access token; requesting
/user/installations through it returns 403. That does NOT imply the App
installation failed.

Direct public GitHub device endpoint checked on 2026-10-23 returned
`device_flow_disabled` for the real Client ID.
Owner must enable "Enable Device Flow" in the registered App's General
settings and press "Save changes" before a real KatoSync device login can
work. No secret/private key should be copied into KatoSync.

## Security revision: one KatoSync user, one GitHub connection

The original device flow in PR #111 had ONE global per-device keychain
entry. That is inadequate for a desktop client used by multiple KatoSync
accounts. This slice makes the OS keychain entry
`github-app-user-device-v2:<KatoSync-Supabase-UUID>`.

Every identity-sensitive command (status, start, polling, cancel, disconnect)
checks the current authenticated KatoSync account by calling the Supabase
Auth `GET /auth/v1/user` endpoint using the app's existing backend-held
access token. The caller CANNOT submit its own KatoSync UUID/email in IPC.
Only a UUID from the verified identity response is accepted.

The GitHub Device Flow's in-memory pending session is bound to the
verified KatoSync UID. A different current user cannot poll or cancel it.
A new KatoSync login clears pending sessions. The code re-verifies the
Supabase account after the GitHub network roundtrip and before storing
secrets; an account switch during GitHub OAuth fails closed.

Stored credentials include both a KatoSync-Supabase owner UUID and a
GitHub provider `user.id`/login. Loading credentials requires the verified
KatoSync UID, checks both the client ID and owner UUID and current token
expiry, and returns only username, not tokens. App tokens are stored only
in user-specific OS keychain accounts, not project files/Memory Fabric,
the web frontend, Supabase profile JSON or local LLM context.

KatoSync logout and profile removal clear pending GitHub authorization
and best-effort delete the currently verified user's local App token.
They never delete or read another KatoSync user's keychain token.
If the current owner isn't cached (for example after a cold restart),
a previously stored credential may persist until that user signs in
and explicitly disconnects. This cleanup gap remains a privacy
hardening item and must be resolved before general public release.

A user changing to a different KatoSync account must authorize GitHub
separately even if the other account uses the same operating-system
login. Connected users do not automatically inherit NMKato's repository
rights. GitHub OAuth user tokens are restricted by app permissions,
per-installation repository grants and the signed-in GitHub user's
actual account access.

## Device Flow compatibility
GitHub-issued App Client IDs can appear as `Iv1.<suffix>` or
`Iv23<suffix>`. Validation supports both forms and rejects URLs,
path separators, whitespace, numeric App IDs and invented formats.
The public ID from GitHub settings is built into the desktop binary;
no GitHub private key or client secret is packaged.

## Checks
- Real GitHub provider metadata API confirms public App identity.
- Public device-code endpoint identified one outstanding owner action:
  `device_flow_disabled`.
- 154/154 Rust lib tests PASS; 6 intentionally ignored.
- 170/170 Node tests PASS. TypeScript, Vite production build,
  cargo fmt, git whitespace checks PASS.
- New tests cover rejecting GitHub credentials from another
  KatoSync account, foreign email as keychain account, and real GitHub
  App Client ID syntax.
- Fast Gate checks Linux/Web and Windows Node but does not compile native
  Rust; native packaged Mac/Windows Login, Keychain and offline QA remain
  required.

## Next
1. Owner checks GitHub App General > Enable Device Flow > Save.
2. Build isolated native QA using the public App Client ID. User signs
   into *their own KatoSync account*, clicks "GitHub verbinden", enters
   temporary code on github.com/login/device, and checks connection.
3. Exercise second KatoSync account with a different GitHub identity:
   no shared token, no mixed data, disconnection and offline failure cases.
4. Do not add GitHub writes until explicit owner approval, idempotency,
   installation scope tests, and security Issue #76 are resolved.
5. For browser-enabled desktop clients, evaluate GitHub App OAuth
   Authorization Code + PKCE as a later alternative to Device Flow.

Docs:
https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app
https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app

Created by NMKato Solutions.

## Operator follow-up: Device Flow now enabled and independently confirmed (2026-10-23)

The App owner subsequently enabled **Enable Device Flow** and saved the
GitHub App settings. An explicit provider GET-less POST preflight to
`https://github.com/login/device/code` with the PUBLIC app client ID
returned `verification_uri=https://github.com/login/device`, a device
and user code, `expires_in=899` and `interval=5`. The prior
`device_flow_disabled` error is resolved.

The new ignored-by-default NATIVE Rust live test
`manual_live_github_app_device_flow_preflight` was run explicitly:
**PASS**. It used KatoSync's own reqwest client, hard-coded GitHub
endpoint, compiled public App Client ID, JSON deserialization and
device-session validation. It does not expose either code, exchange
an access token, persist any GitHub credential or require owner consent.

After adding this live regression, all **154 Rust lib tests passed;
7 deliberately ignored** (including this manually successful smoke).
Previous Node, TypeScript and Vite checks remain green; the code
addition only touches native test logic.

Remaining: a user-confirmed full OAuth login in a separately isolated,
properly resourced native KatoSync QA app, with a valid KatoSync/Supabase
session and keychain; verification of per-user account binding on two
distinct identities; expired token handling, offline behavior and logout.
A successful device CODE REQUEST does not constitute a completed login.

Never substitute the GitHub CLI token or ChatGPT connector for this
App-specific user authorization.
