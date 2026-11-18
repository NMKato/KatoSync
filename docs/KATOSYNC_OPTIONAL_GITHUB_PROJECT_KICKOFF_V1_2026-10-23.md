# KatoSync: Optional GitHub Project Kickoff Preview — v1
Date: 2026-10-23. Isolated development worktree, stacked on Draft PR #106.

## Product decision

GitHub is OPTIONAL. A user with no GitHub account can still plan an MVP,
use local project memory, keep local task IDs and use KatoSync offline.
The default is GitHub OFF, with no sign-in, token, network request or API call.

GitHub-enabled projects should normally use ONE repository per product or
deployable codebase, and ONE appropriate GitHub Projects v2 board per product
(or a shared organization board if the owner explicitly chooses it).
A new feature should generally create an ISSUE in the existing repository,
rather than spawning a new repository and board for every feature.
Boards can also track issues/PRs from multiple repositories.

## Implemented in this first guarded slice

- A collapsed Project Kickoff Wizard under Projects & Focus, including new
  not-yet-Git-registered project names and goals.
- A second entry point in the EXISTING Blueprint preview; if a Blueprint
  supplies an explicit MVP scope, each feature ID, track (MVP/side), task
  weight and acceptance criterion become a bounded, reviewable issue draft.
  Otherwise it uses architecture decisions, next steps, or 3 generic startup
  milestones. Every draft remains unverified.
- Explicit optional GitHub checkbox, OFF by default, and exact
  owner/repository field for reusing an existing repository.
- In product mode with GitHub enabled and no repo specified, PREVIEW a new
  private repository name. In feature mode without a repo, request that the
  user pick one; DO NOT generate a new repository per feature.
- Suggested Kanban columns: Backlog, Ready, In Progress, In Review, Done,
  Blocked. A ticket may only move to Done after tests and owner review in
  the future trusted sync, not based on an unverified LLM assertion.
- At most 12 ticket drafts displayed with scrollable list; extra MVP
  tasks reported as deferred, not lost or implicitly published.
- Structured setup checklist for Blueprint review, reuse/dedup checks,
  privacy, board planning, ticket review, CI and explicit approval.
- A deterministic, machine-readable proposal with safety policy flags:
  planOnly, reuseBeforeCreate, defaultPrivate,
  publicSharingRequiresApproval, remoteWritesRequireApproval,
  mustVerifyCiBeforeClosing. An explicit Copy JSON button is the only
  data-export action in this slice.
- DE/EN/ES/RU text and existing neutral UI theme. Both wizard instances
  are collapsed by default to preserve the Top-3 Dashboard density.

## Boundaries

These flags and any generated LLM prompt are ADVICE, not access control.
When we eventually add GitHub provisioning, actual authorization must be
enforced by the native backend and GitHub App permission grants:
  1. The user explicitly opts in and signs in or installs a GitHub App.
  2. KatoSync reads existing repositories, Projects and issues and
     proposes REUSE instead of creating duplicates.
  3. The user reviews actual repo name, PRIVATE visibility, board scope,
     issue drafts, assignees and label/permission changes.
  4. After explicit per-batch approval, backend performs idempotent,
     least-privileged GitHub API writes; returns actual provider IDs.
  5. Reconcile provider IDs into the local project registry, the
     immutable journal, feature-to-Issue and project board references.
  6. Only provider-verified GitHub status, real feature CI evidence
     and owner approval may move a ticket into Done and contribute
     to a VERIFIED MVP acceptance figure.
  7. Offline access remains available; remote writes are queued for
     review and are NEVER silently retried without conflict checks.

No login has been implemented in this slice. No actual repo, issue or GitHub
Project is created, no hidden agent shell commands or cloud services execute.
GitHub credentials from connected ChatGPT tools are NOT implicitly available
inside KatoSync; a dedicated, securely designed GitHub App authorization is
necessary. Project Status Flow and Memory remain available with GitHub OFF.

## Security and collaboration requirements

GitHub App, not broad persistent PAT, with fine-grained installed-repository
permissions; scoped user tokens when acting on behalf of a user.
Separate read scopes from issue/project write scopes. Store tokens in OS
credential storage, not project SQLite or copied Blueprint data.
Owner-controlled privacy, approval, team access and public visibility.
Avoid exposing sensitive private Blueprints or patient/project data in
GitHub issue bodies; redaction is defense in depth only, and user review
before publication is mandatory.

GitHub Projects v2 create/update may use GraphQL APIs; linking existing
issues, setting status fields and Project access are distinct operations.
Do not assume that repo creation automatically creates a Project board
or that adding an issue automatically sets the correct Kanban status.

Native multi-device writer leasing (Issue #76), owner authentication,
idempotency, retries, conflict review, project-privacy erase/export and
actual native macOS/Windows installer smoke remain release gates.

## Test and review expectations

- Pure Node tests: local/no-GitHub, private proposal, reuse existing repo,
  reject feature repo proliferation, bounded issues, stable feature identity,
  no remote execution and invalid inputs.
- Full Node, TS check, frontend build, Rust lib regression and formatter.
- GitHub Attribution and Linux/Web + Windows Node CI on exact commit.
- Does NOT compile Rust in GitHub Fast Gate or validate packaged GUI.

Created by NMKato Solutions.
