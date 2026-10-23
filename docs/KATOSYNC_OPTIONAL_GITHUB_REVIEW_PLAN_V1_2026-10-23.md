# KatoSync — optional GitHub review-only provisioning plan v1

Date: 2026-10-23. Separate isolated draft stacked on PR #108.

## What this slice does

GitHub remains OPTIONAL and OFF by default. The local project kickoff wizard
creates tickets and MVP plans without an account or network connection.
When the operator enables GitHub and explicitly clicks "GitHub-Bestand prüfen"
for an EXISTING registered GitHub repo, this slice creates a read-only review
plan before any possible external creation.

1. Native issue scan: up to four authenticated REST GET pages of 100
   issue/PR records each (400 max), preserving pagination completeness.
   The first short page ends the scan; a full fourth page is INCOMPLETE.
   Pull requests are excluded from issue candidates.
2. Projects v2 owner listing: limit raised to 100, completeness checked
   against the provider totalCount, permissions errors displayed as
   unavailable rather than incorrectly claiming zero boards. A weak title
   or description match is a candidate, NOT verified repo-board association.
3. Exact stable Feature-ID markers in issue bodies permit read-only dedup
   candidates. Multiple matches need manual reconciliation.
4. Review plan distinguishes: reuse existing issue candidate; ambiguous
   candidates; incomplete search; or propose new issue after review.
   Existing boards similarly prefer manual reuse candidates.
5. Review plan JSON includes repository, current HEAD, privacy status,
   candidate matches and blocking reasons. It ALWAYS states
   requiresHumanApproval=true, writesAuthorized=false,
   remoteWritesPerformed=false, appAuthorizationState=not_connected.
6. Public and archived repositories display warnings. No Blueprint body,
   issue draft, credential or PAT is uploaded or stored.
7. The global Top-3 dashboard stays compact; everything appears only
   inside the explicitly opened project's kickoff details.

## Security / authentication

This development step uses the existing authenticated local GitHub CLI.
It does NOT provide an internal GitHub App login, installation or OAuth
flow. A dedicated GitHub App with explicit install/user permissions,
secure OS keychain storage, revocation and separate per-batch approval
is still needed for production. Native access checks, not model prompts,
must enforce write authorization.

No repo, project, issue, label or collaborator is created. No new
cloud worker, scheduler, database schema or automatic provider polling.

## Limits and next steps

The 400-entry issue search remains incomplete in larger repositories.
Owner Projects listing alone cannot prove a real Project↔Repository link.
Future work: GitHub GraphQL authoritative linking, full cursor-based
pagination, safe optional App sign-in and human-reviewed idempotent writes.
Even a complete scan is NOT an authorization to create remotely.
Offline support and local version control remain independent from GitHub.

## Verification

- Rust tests cover issue-page completion, provider identity, feature
  markers and cross-repo exclusions.
- Node tests cover reuse, ambiguity, partial inventory, privacy blockers,
  app-not-connected and no authorized writes.
- Manual authenticated live GitHub smoke is read-only and separate from
  the default test suite.
- GitHub Fast Gate Linux/Windows Node and Attribution must pass for SHA.
- Native packaged GUI/Windows Rust, offline UX, signer and security
  Issue #76 remain separate release blockers.

GitHub REST pagination: https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api
GitHub CLI pagination: https://cli.github.com/manual/gh_api
GitHub App auth: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user

Created by NMKato Solutions.
