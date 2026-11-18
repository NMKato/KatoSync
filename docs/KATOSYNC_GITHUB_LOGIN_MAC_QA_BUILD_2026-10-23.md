# KatoSync — Isolated macOS GitHub Login QA (2026-10-23)

**Development-only**, stacked on Draft PR #112. This is NOT a general
release, does not update the installed production KatoSync app, and
is not an acceptance for multi-user security or GitHub write operations.

## Verified local QA packaging

Built with the public, registered KatoSync GitHub App client ID embedded
in the parent branch. GitHub Device Flow was independently verified with
the real GitHub code endpoint and a native ignored-by-default Rust
preflight; no token was obtained during preflight.

Source worktree:
`~/Projects/.katosync-github-login-qa-20261023`
Target Mac application:
`~/Applications/KatoSync GitHub Login QA.app`

Bundle ID: `com.nmkato.katosync.github-login-qa`

QA build:
```sh
cd "$HOME/Projects/.katosync-github-login-qa-20261023"
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
CARGO_TARGET_DIR="$HOME/Projects/KatoSync/src-tauri/target" \
  cargo test --manifest-path src-tauri/Cargo.toml --lib --features github-login-qa
CARGO_TARGET_DIR="$HOME/Projects/KatoSync/src-tauri/target" VITE_GITHUB_LOGIN_QA=1 \
  npx tauri build --debug --features github-login-qa \
  --config src-tauri/tauri.github-login-qa.conf.json \
  --bundles app --no-sign --ci
```

The app bundle is copied into the user's personal Applications folder,
then **ad-hoc signed** for local development only. It is not a signed,
notarized, or publicly distributable release. The original
`/Applications/KatoSync.app`, separate project-preview application,
and GPU-test application are left untouched.

### Native isolation

The explicit Rust `github-login-qa` build feature switches:
- OS keychain service from `com.nmkato.katosync` to
  `com.nmkato.katosync.github.login.qa` for BOTH the preexisting
  Supabase session and the new GitHub App user connection
- Support directory from `~/Library/Application Support/KatoSync`
  to `~/Library/Application Support/KatoSync GitHub Login QA`
- Log directory from `~/Library/Logs/KatoSync` to
  `~/Library/Logs/KatoSync GitHub Login QA`
- LaunchAgent ID to an isolated QA-only name, with explicit runtime
  refusal to install an agent
- Explicit runtime refusal to execute normal project sync.

The frontend is a dedicated and clearly labeled QA-only screen with
ONLY KatoSync account sign-in, GitHub App connection, and sign-out.
No regular dashboard/agent/sync UI is offered. The bundled frontend
is selected by `VITE_GITHUB_LOGIN_QA=1` (this is NOT a production
configuration). The QA binary contains no packaged Poppler/Typst
production tools; temporary placeholder resource folders are strictly
local/ignored and the dedicated test frontend does not use PDF features.

These settings prevent normal login, sync and file workflows from
touching the usual production data paths. They do NOT alone prove
complete security isolation from every component; QA only.

### Operator-driven manual smoke

1. Find/open **KatoSync GitHub Login QA** on the authorized Mac.
2. In the QA-only panel, sign in to an existing KatoSync account.
   Do NOT give passwords or GitHub user codes to the assistant.
3. Expand **GitHub App verbinden**. Click "Mit GitHub verbinden".
4. Copy the code into the real GitHub page
   `https://github.com/login/device`; approve authorization.
5. Return to the QA app; click **Autorisierung prüfen** respecting
   the provider's requested interval. Confirm account name shown.
6. Disconnect the GitHub connection, then sign out of KatoSync.
   Observe that the QA keychain connection is removed.
7. Sign in with a SECOND, authorized KatoSync account only if one is
   already available. It must NOT inherit the first user's GitHub
   identity. The local native tests already reject cross-user
   keychain credential reuse but UI evidence is still required.
8. Check expired code, cancel, network-offline, reconnect, OS keychain
   errors and explicit server-side revocation as separate QA gates.
9. Observe that no repository, board or issue has been modified.
   GitHub read-only inventory still uses the local `gh` CLI pending
   App-token-backed provider queries.

No device-code exchange or login is initiated automatically by this
test build. Login requires user consent. No app private key, client
secret, bearer token, KatoSync password or GitHub verification code
should be sent to this chat.

### Release gates still open

- Real manual GitHub authorization with valid KatoSync account.
- KatoSync user-token expiry/refresh and GitHub user-token rotation.
- Production-grade cleanup of dormant per-user keychain entries.
- Multi-user/cross-device/manual macOS & Windows GUI tests.
- GitHub App installed-repository scope checks and native token-backed
  inventory; no authenticated GitHub write endpoints.
- Security Issue #76: fenced multi-device writers.
- Full PR stack integration, code review, native packaging/signing and
  installer acceptance. The normal GitHub CI gate alone doesn't compile
  native Rust.

Created by NMKato Solutions.
