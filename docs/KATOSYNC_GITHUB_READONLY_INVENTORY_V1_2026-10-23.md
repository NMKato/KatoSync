# KatoSync optional GitHub read-only Inventory — v1
Date: 2026-10-23. Isolated draft stacked on PR #107.

## What this slice provides

Only when a human selects GitHub **and** explicitly clicks
"GitHub-Bestand prüfen" in the project kickoff wizard, KatoSync:
1. Resolves project root from the persisted LOCAL Project Registry.
2. Confirms the root is the actual Git worktree root and reads HEAD and
   origin using bounded, read-only Git operations without shell execution.
3. Allows ONLY an exact github.com HTTPS/scp remote (the existing native
   origin allowlist), not arbitrary user-provided URLs/blueprint text.
4. Reuses the local machine's already-authenticated GitHub CLI for a
   bounded, read-only GET of repository metadata and recent issues.
5. Tries read-only GitHub Projects v2 owner listing. A missing project
   scope, no token, malformed API response or network failure yields
   an explicit **UNAVAILABLE**, never "there are zero Projects".
6. Shows project board candidates with provider ID, visibility, open/closed
   flag, GitHub link and weak match hint from title/description/readme.
   A weak match is NOT proven membership/association to the repo.
7. Finds possible issue duplicates using an exact stable Feature-ID
   marker in the first 50 issue/PR records; PRs are excluded. If this
   bounded scan fills the page, the result is PARTIAL, and lack of
   candidates does not mean the proposed issues are novel.
8. Rechecks HEAD and origin after the network calls; rejects changed
   repository identity. Rechecks saved Registry root after the return.

Privacy warning: this KatoSync GitHub repo is publicly visible according
to its provider response. Other repos may be private/public. No Blueprint
or proposed issue body is sent to GitHub in this slice. Only bounded feature
IDs remain local and are compared locally against fetched metadata.

## Who may use it

- GitHub option OFF: no GitHub request, no token/access needed, local
  project start and optional local task plan remain functional.
- GitHub option ON but repo not locally registered: the read-only
  provider button is disabled. User can still draft and copy a plan.
- GitHub option ON with a registered GitHub repo and matching entry:
  the read-only discovery button is available in the installed native app.
- Changing the selected repo input to a different owner/repo disables
  discovery, rather than fetching an unregistered target.
- A registered repo with Git remote other than exact github.com forms
  fails closed and can still be planned locally.
- No token management, login wizard or GitHub App authorization is
  shipped yet. Existing GitHub CLI authentication belongs to the local
  machine. A future opt-in GitHub App flow is a separate milestone and
  requires platform-secure token storage and owner authorization.

## No-dedup proof from empty scans

Capped inventory, pagination, search ranking and Projects-v2 permissions
make true absence of a board or issue hard to prove. DO NOT infer a new
Project or Issue is safe merely because it is not shown.
Before future provisioning, enumerate all owner boards/linked repo Projects
and search all project issues with stable IDs and provider GraphQL/REST
pagination, including any org-shared boards. A human must review each
operation and its permissions and privacy visibility.

## GitHub docs / scopes

Projects v2 can be read/listed via GitHub CLI gh project list or GraphQL,
separate from ordinary REST issue metadata. GitHub CLI documentation
requires an appropriate Projects auth scope. A denied Projects operation
must not block other read-only repository and issue findings.
References:
- https://cli.github.com/manual/gh_project
- https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects

## Security invariants

- No new repo, board, issue, collaborator, label or workflow is created.
- No agent is authorized to use a write endpoint.
- Never accept a GitHub API host, repository URL, credential, arbitrary
  query path or repo name from an imported Blueprint.
- No autosync, token written to disk, cloud worker, scheduler or cloud model.
- Provider user-controlled titles/readmes/issue bodies are untrusted data.
  They only become displayed text or a possible duplicate candidate.
- The returned flags remoteWritesPerformed=false and
  automaticCreationAllowed=false are explicit. Host-side write API has no
  route in this slice.
- Project-specific identities and canonical path checks prevent
  accidental cross-project lookups. Head/remote are rechecked for drift.
- A public repository triggers an explicit warning; no automatic
  publication is possible anyway.
- UI only loads the inventory after explicit click, not in the global
  Top-3 dashboard. Other items remain nested and scrollable.

## Validation

- New native Rust tests: repo identity and visibility, project board
  candidate classification, incomplete pagination handling, strict
  issue marker and PR filtering, stable feature ID validation.
- Real live authenticated GitHub CLI read-only smoke on existing
  KatoSync repo exercised repository GET, issue GET and Project listing
  (test ignored by default; explicitly run).
- Full Rust/Node/TypeScript/Vite/formatter checks before pull request.
- GitHub Linux/Web + Windows Node + Attribution CI should independently
  pass on new commit. Fast Gate does not compile Rust. Packaged native
  app on macOS/Windows, actual offline UI failure states, keyboard
  navigation and signed beta are still pending release gates.

## Next step

Read-only comprehensive paginated duplicate search and board/repo link
verification, then secure optional GitHub App authorization in native
desktop with least-privileged installation grants. Provisioning only
after a separate, human-confirmed write plan with idempotent operations
and server-returned provider IDs; reconcile those into local Memory
Fabric and project status flow. Never treat a Local LLM's prompt as
authorization for remote writes.

Created by NMKato Solutions.
