# Native GitHub App inventory — MVP read-only slice (2026-10-24)

## Scope
- Existing verified KatoSync session and per-user OS keychain GitHub App token only, never GitHub CLI credentials or user-supplied network host/token.
- Explicit user-triggered listing of authorized App installations and bounded repository and issue metadata from native GitHub API GET calls.
- Full-name path and installation ID are checked before fetching issues; result excludes PRs from issue list; no write operations or mutations.
- UI shows only public metadata from authorized repositories, no credential fields; bounded list, manual refresh and partial-result notice.

## Verified
- 178 Node regression tests passed, TypeScript and frontend production build passed.
- Rust library regression 159 passed / 7 ignored; cargo fmt check passed; native macOS release-mode Tauri .app bundle built.
- Replaced only the side-by-side M2 GitHub MVP Test app; previous test app backed up; original /Applications/KatoSync.app unchanged.

## Remaining gates
- Operator must confirm native macOS keychain permission if requested and click Repositories laden in Provider GitHub App panel.
- Verify real returned repositories/issue list and permission/empty/expired behavior; do not equate local tests with successful live GitHub inventory.
- Existing GitHub token refresh when access token expires is not automatic in this slice; user may need explicit reconnection.
- Not safe to merge to main: keep stacked Draft PR, issue #114 SSO, #76 unattended writer gating, Windows packaging pending.
