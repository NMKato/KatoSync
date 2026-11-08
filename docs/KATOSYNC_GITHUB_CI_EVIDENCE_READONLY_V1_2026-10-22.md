# KatoSync Continuity — authenticated GitHub CI evidence (read-only) v1

Date: 2026-10-22. Developer candidate stacked on Draft PR #103.
Not merged into dev/main or installed in production.

## Delivered

Inside the selected project's MVP detail dossier, the operator can open
"GitHub CI evidence" and explicitly click "Check CI". The feature then
performs an authenticated, read-only GitHub provider query for the EXACT
repository and HEAD currently registered with KatoSync. It displays up to
15 matching workflow attempts and jobs for the first three recent runs.
This view never auto-refreshes or starts a background service.

The native command continuity_github_ci(projectId) determines the local
project root exclusively from the persisted Project Registry, validates
indexed Memory Fabric project binding and live Git HEAD, and rechecks the
same HEAD after requests finish. If the HEAD changes mid-query, the
operation fails closed instead of showing stale success.

## Provider source and trust

- Native Git remote origin must be an HTTPS github.com or scp-style
  git@github.com owner/repo address. Other protocols, domains, credentials,
  extra path segments and user-input URLs are rejected.
- GitHub CLI gh is used only with literal GET endpoints under
  repos/{verifiedOwner}/{verifiedRepo}/actions/runs and selected run jobs,
  with exact head_sha, paged/bounded results and strict response size/time
  bounds. GH_HOST is pinned to github.com; prompts are disabled. Credentials
  are never inspected, copied, logged or stored by KatoSync.
- API workflow records must report the SAME repository full_name and
  exact commit SHA as the registered checkout, else they are excluded.
- Job status and conclusion are displayed alongside run ID and workflow.
  Results may be queued, in-progress, successful, failed or cancelled.
- No GitHub CLI / no sign-in / no internet / insufficient GitHub permission
  yields an explicit unavailable state, never invented green checkmarks.
- Provider facts prove ONLY that GitHub reports a workflow/job status for
  a repository and commit. They do NOT establish whether a particular
  feature's acceptance criteria were exercised or whether an owner reviewed
  and approved it.
- featureAcceptanceVerified remains FALSE. The existing verifiedPercent
  remains NULL, with no auto-merge, auto-release or increased agent rights.

## UX

The top-three project summary stays compact. CI jobs/results appear ONLY
inside the selected project's expanded dossier, and only after pressing
Check CI. Localizations DE/EN/ES/RU, existing theme and neutral progress
presentation. No always-on cloud worker or costly CI polling.

## Acceptance evidence

- Full macOS Rust library regression, Node suite, TypeScript, Vite build
  and Cargo formatter/whitespace checks run before shipping this PR.
- 3 native provider/parser tests reject fake cross-repo/cross-SHA successes,
  spoofed GitHub URLs and preserve job failed/pending states.
- Separate IGNORE-BY-DEFAULT live integration test (manually executed)
  connected to the user's authenticated GitHub account, fetched the actual
  KatoSync private repository workflow/jobs for its exact HEAD, and passed.
  This is a read-only network smoke, NOT a packaged GUI smoke.
- GitHub Linux/Web + Windows Node Fast Gate and Attribution Policy must be
  green for the final commit. Current Fast Gate does NOT compile Rust.

## Remaining release gates

Next: provider-verified exact job name plus featureId and acceptance criteria
map; owner-reviewed per-feature test matrix and change/revocation handling;
only then consider a separately verified MVP acceptance figure.

Need independent native Windows/macOS GUI, actual offline/no-network
fallback, screenreader/keyboard, installer package and security review.
Issue #76 blocks authorized multi-device/autonomous writer operations.
