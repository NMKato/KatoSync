# KatoSync — GitHub repository to Projects v2 linkage verification

Date: 2026-10-23. Read-only development slice 20, stacked on Draft PR #109.

## What changed

KatoSync's optional GitHub Kickstarter now differentiates three states:
- A **provider-confirmed link** returned by GitHub's repository.projectsV2
  GraphQL connection for the EXACT repository derived from the persisted
  local Project Registry and allowlisted git origin.
- An owner-board candidate found by name/readme/description heuristics
  (UNVERIFIED relation, no automatic reuse or creation).
- A link check that is unavailable or only partially paginated (UNKNOWN
  completeness; never equivalent to an empty Project association).

Native code queries read-only GitHub GraphQL through the existing local
gh CLI login, using a fixed query with separate owner/name/cursor
variables. No tokens are copied/stored, no model-supplied URL is accepted,
no mutation is sent, and no owner/team permission is modified.

Validation rules:
- Exact GraphQL repository name must match requested registered repo.
- Provider Project ID/number and owner type/login must be well formed.
- Project URL must exactly match the provider owner plus number
  github.com/users/.../projects/N or github.com/orgs/.../projects/N.
- GraphQL errors, denied scopes, missing data, malformed cursors,
  repeated IDs and contradictory pagination fail closed.
- Page size 50, at most 4 pages. Only a full and internally consistent
  connection is marked VERIFIED for collection completeness.
- When a page is missing, already returned direct links remain valid
  as individual link facts while the overall list is PARTIAL.
- A review plan prefers confirmed existing board reuse over weak
  title matches, with human verification and approval still REQUIRED.
- Non-Project boards from the owner scan are still shown as weak
  candidates and do not become provider-linked just because their names
  resemble the repository.
- No GitHub App auth sign-in is implemented in this slice; existing
  local gh is used for development read access only.

## User experience

The expanded project-level GitHub inventory has its own section
"Von GitHub direkt mit dem Repository verknüpfte Boards" showing
provider-confirmed boards, each linked to its official GitHub page.
Errors and partial results are labeled separately. The board reuse
proposal in the existing nested review plan now prioritizes confirmed
links. All global Top-3 dashboard layout remains untouched.
DE/EN/ES/RU translations included.

## Real-world verification

Verified via authenticated read-only GitHub GraphQL API for
NMKato/KatoSync: repository.projectsV2 reports **board #12**,
"KatoSync — Agent Mode & Automation", provider ID
PVT_kwHODDE5ds4BldNp, with project URL
https://github.com/users/NMKato/projects/12.
The new manually-invoked ignored-by-default native live test passed
on that exact repository.

Unit tests reject cross-repo GraphQL identity and spoofed Project
URLs, invalid cursors/GraphQL errors, and assert that partial
pagination does not grant board-creation permission or discard
already-confirmed board links.

## Authentication and safety roadmap

To enable in-app GitHub connection for end users, a GitHub App must
first be registered and its client ID/device flow enabled by the
operator. The user must explicitly install/authorize it, choose
repository access and review permissions. Native implementation then
needs a correctly rate-limited device flow, token refresh and
revocation, OS keychain protection and strict separation of read
versus write permission. No App private key should ship with
the client; don't conflate an existing gh login with GitHub App auth.

After this, add true multi-repo board membership/issue coverage
verification and fully paginated issue inventory, then preview
exact write batches (new issue/board or reuse existing), owner approval,
idempotency and provider ID reconciliation with project memory.

No repo, board or issue creation is authorized by this slice.
Security Issue #76 and macOS/Windows native GUI/offline tests remain
open release gates; the Web/Windows Node Fast Gate does not compile Rust.

Sources:
- https://docs.github.com/en/graphql/reference/projects
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user

Created by NMKato Solutions.
