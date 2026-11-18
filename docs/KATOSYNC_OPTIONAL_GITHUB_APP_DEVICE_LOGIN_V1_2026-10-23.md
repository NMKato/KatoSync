# KatoSync Continuity — Optional GitHub App Device Login v1
Date: 2026-10-23. Isolated development slice stacked on Draft PR #110.

## Scope

GitHub is OPTIONAL and defaults to OFF. Local Git, project memory,
Blueprints and MVP tracking work without a GitHub account. This stage
prepares an optional in-app GitHub App device sign-in. It does NOT create
repositories, issues, Kanban boards or grant agent write access.

The prior local GitHub CLI inventory (PR #108-110) remains unchanged.
A verified App login is NOT yet wired to the inventory. This is
intentionally a separate, auditable next step.

## Configuration needed from the owner

1. Register an official GitHub App under Developer Settings on GitHub.
2. Enable Device Flow in the App settings.
3. Enable expiring user-to-server tokens and grant only necessary,
   initially read-only repository/organization permissions.
4. Compile the desktop app with a client ID set by the build-time variable:
   KATOSYNC_GITHUB_APP_CLIENT_ID=<actual GitHub App CLIENT ID>
   The client ID is not the numeric app ID; do not invent it.
   No App secret or App private key is ever compiled into the desktop.
5. Unless the verified Client ID exists, the UI explains that the
   app isn't configured and cannot start a login.
6. The user must explicitly opt into GitHub and authorize by entering
   the temporary user code on https://github.com/login/device.

## Implemented native commands

- github_app_connection_status: config and connected metadata only.
- github_app_device_begin: requests a device code from fixed GitHub HTTPS
  endpoint and validates the exact verification URL, code and expiry.
- github_app_device_poll: verifies nonce, expiry, minimum polling interval,
  extended slow_down delay; exchanges for short-lived access+refresh token,
  verifies account via authenticated GitHub GET /user, saves secrets
  exclusively in per-user OS keychain, never frontend/Memories/Blueprint.
- github_app_device_cancel: aborts pending login.
- github_app_disconnect: deletes local credential; user may separately
  revoke server-side App authorization in GitHub account settings.
- Full KatoSync account-data purge also clears the local App credential.

HTTP requests are limited to three hardcoded HTTPS endpoints:
POST https://github.com/login/device/code
POST https://github.com/login/oauth/access_token
GET https://api.github.com/user

Redirects denied, timeouts bounded, user code only returned to UI.
Client ID is allowlisted at build time. User text, remote Git branches,
Blueprint and local LLM cannot inject an arbitrary App ID or endpoint.
Device code stays transient in process RAM and is zeroized on Drop.
Credentials are never logged or returned through IPC.
No token is passed to project automation, git CLI or model calls.

## Current limitations

A connected Github username means identity only, not the
installation/repository permissions. Permission grants are the
intersection of App installation, configured App permissions and
user access. No authorized GitHub writing endpoint exists in this
module; permissionsChecked=false, writeAccessGranted=false.
Manual poll buttons avoid background workers. Refresh rotation is
NOT yet implemented. When access token expires, account is shown
disconnected until a new authorization is performed; refresh token
stays in the OS keychain until disconnected and can be used only in
a separately reviewed future refresh implementation.

Live login cannot be tested until the actual KatoSync GitHub App
is registered with device flow enabled. Do not substitute an
existing local GitHub CLI login for the App auth handshake.

## Testing and future gates

Run Rust native library suite, Node tests, TypeScript, Vite build,
cargo fmt and whitespace checks. Provider end-to-end tests,
OS-keychain behavior, authorization cancellation, revocation and
offline/Windows/macOS GUI tests still require the registered App
and real native builds. GitHub Fast Gate does not compile Rust.
Security Issue #76 remains blocking for multi-device writer mode.
Next implement App-token-backed read-only GitHub inventory and
installation checks, then owner-approved idempotent write batches.

References:
https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens
https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app

Created by NMKato Solutions.
