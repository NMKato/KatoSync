# KatoSync — GitHub OAuth in existing signed-in account provider screen
Date: 2026-10-23 | isolated Draft stacked on PR #113

## User intent
KatoSync is an optional GitHub-enabled project-manager service. Every
customer must be able to authorize their **own** GitHub account while
already signed into KatoSync, like other provider connections. No
extra KatoSync username/password popup should be required, and the
operator's GitHub account must never be shared with customers.

## Implemented here
The native OAuth backend from earlier Draft PRs remains isolated by
verified Supabase user UUID, GitHub App identity and OS keychain entry.
The existing `GithubAppConnectionPanel` is now displayed in the normal
KatoSync **agentProviders** screen *below ProviderManager* (where Codex
and Claude provider connections already live).

The normal app has an app-wide `vm.sessionStatus.loggedIn` gate,
and the new optional GitHub panel adds a second explicit session gate.
It contains no KatoSync password inputs and offers the existing
user-triggered GitHub Device Flow sign-in, account status and disconnect.
Users still must approve GitHub access at `github.com/login/device`.
No automatic GitHub authorization occurs when signing in to KatoSync.

The existing nested optional Project Kickoff GitHub integration also
remains accessible within registered projects. Top-3 Dashboard
density is unchanged; translations DE/EN/ES/RU provided.

No GitHub repository, board, issue or collaborator is created.
GitHub inventory from older slices remains read-only and still uses
the pre-existing developer machine `gh` CLI until App-token backed
inventory and installation scoping are implemented separately.

## Critical auth discovery — do NOT silently change projects

During isolated QA the user confirmed they had an existing KATOOS
account, not a separately registered KatoSync account. Source
inspection found the original KatoSync login labels claim KATOOS SSO,
but the native `supabase_password_login` uses a **different Supabase
Auth project** from the KATOOS website's configured project ref.

This is verified source/config inconsistency and explains why a
KATOOS-only credential might not work in the standalone QA login.
It is NOT safe to assume the user account exists or does not exist
in either tenant solely from a login failure. Do NOT silently change
the Auth issuer, switch the Supabase client key or link accounts by
unverified matching email. Existing users and data could be orphaned,
or wrongly associated.

A dedicated blocker exists as
https://github.com/NMKato/KatoSync/issues/114
for product-owner decisions and a tested, explicit federated SSO/
migration plan preserving tenant boundaries and identity proof.
The current PR does NOT implement KATOOS-Website SSO. It only reuses
a **valid existing KatoSync session** rather than inventing a second
QA login.

## Regression gates
- Static integration-contract Node tests ensure provider page is
  gated by KatoSync login, uses no extra login/password fields,
  and still performs separate GitHub OAuth.
- npm test, TypeScript typecheck, production frontend build,
  Rust library regression, cargo fmt and staged diff check.
- GitHub Web/Windows Node CI and attribution on pushed SHA.
- Native manual acceptance requires actual signed-in KatoSync session,
  GitHub consent and keychain verification; not inferred from CI.
- No production app replacement or main merge in this slice.
- Security Issue #76, account isolation, future token expiry,
  Windows GUI, and standalone KATOOS SSO #114 remain release gates.

## Next
Confirm KATOOS SSO mechanism and canonical identity with the owner,
implement explicit trusted federation if required (not password reuse),
test sign-in on both account types, then App-token scoped read-only
repo/Project inventory, and only after user approval optional
idempotent GitHub writes.

Created by NMKato Solutions.
