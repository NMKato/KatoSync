# Contributing to KatoSync

Thank you for your interest. KatoSync currently uses stacked draft
branches for significant changes. Until an explicit open-source license is
chosen and published, contributions from third parties should be limited
to issue discussion and review, not unlicensed code submissions.

## Development and review

1. Open an issue for architectural or behavioral changes before creating
   a large PR. Keep PRs focused and based on the current reviewed branch.
2. Never include API tokens, user records, OS Keychain content, private
   keys, screenshots containing personal information, or local QA logs.
3. Run `npm ci --ignore-scripts`, `npm test`, `npm run typecheck`,
   `npm run build`, and `npm audit --audit-level=high`.
4. For native changes, run `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` and the relevant `cargo test --lib` feature set on an approved development machine.
5. Native platform integration, Tauri permissions, device enrollment,
   Keychain, and GitHub OAuth changes require a separately documented
   QA run. Tests must prove that failed authorization does not become
   a successful UI state.
6. PRs must describe trust boundaries, rollback, tests, open release
   gates, and whether any remote deployment or database migration is
   required. No remote writer rights are introduced by UI changes.

## Responsible security reports

See [SECURITY.md](SECURITY.md). Do not post vulnerability details or
credentials in public issues.
