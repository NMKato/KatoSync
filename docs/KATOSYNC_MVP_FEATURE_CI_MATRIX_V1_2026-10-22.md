# KatoSync Continuity — MVP feature CI gates matrix v1
Date: 2026-10-22. Development branch stacked on Draft PR #104.
No merge to dev/main, no production install, no cloud worker.

## Why

GitHub can confirm the provenance of workflow/job statuses for a registered
project's HEAD. That alone is not a feature-specific acceptance test.
We need an explicit, scoped, inspectable contract that says WHICH workflow
and WHICH job should be reviewed for a particular MVP task.

## Backwards-compatible Blueprint fields

Within each existing mvpScope entry, optional:
  "ciChecks": [
    {"workflow": "KatoSync PR Fast Gate", "job": "Windows Node Regression"},
    {"workflow": "KatoSync PR Fast Gate", "job": "Web Build"}
  ]

A maximum of FOUR pairs per feature. The TS review and native Rust save path
both reject empty workflow/job strings, strings over 120 characters, duplicate
pairs, unknown fields and forged owner approvals. Older Blueprints without
ciChecks remain valid. The original project-Blueprint stays pinned.

## Read-only matrix and fail-closed rules

1. Explicit user press "CI prüfen" inside selected project detail.
2. Native command validates persisted registry project root, live Git HEAD and
   indexed Memory Fabric project binding. GitHub CLI reads only allowed
   github.com owner/repo actions endpoints, then checks provider-reported
   repository and exact HEAD.
3. Native reads current project-specific mvpScope from existing journal,
   without DB migration, write, polling or warmed cloud service. Each
   feature receives its *proposed* required workflow/job pairs.
4. For each workflow, compare against its latest fetched run (by run ID and
   attempt) on the HEAD. An older green run cannot cover a later failed,
   queued, incomplete or cancelled one. Both run AND exact job must have
   completed with GitHub's "success". Missing, ambiguous, failed, still
   running or unfetched jobs fail closed (no provider CI pass).
5. Show the explicit provider status of each required job inside a collapsed
   per-feature detail area. Side tasks are identified separately.
6. The signal ciRequirementsSatisfied denotes ONLY "declared GitHub jobs all
   reported success on the current HEAD". It is not test-coverage proof,
   verified human acceptance or approval to merge/release.
7. featureAccepted stays false. The preexisting verifiedPercent stays NULL.
   Project status notes, model text and uploaded Blueprint data never grant
   permissions or authorize a code-writing agent.

The mapping itself is imported unverified proposal; a malicious author
could name irrelevant green CI jobs. To establish feature-level acceptance
we still require owner-reviewed coverage policies, exact test identity,
trusted CI run/attempt/job IDs, log/coverage evidence and review of actual
acceptance criteria before any verified percent or release-ready flag.

## UX

The Top 3 Dashboard remains unchanged. The matrix is displayed ONLY in
the selected project's expanded GitHub CI evidence dossier after pressing
the check button. DE, EN, ES, RU labels; no automatic network requests.

## Verification

- TS/Rust strict field validation and backward compatibility.
- Native deterministic tests for exact job pairing, later bad/pending workflow
  override, ambiguous/missing job denial, no implicit feature approval,
  project-scope and persistence across SQLite restart.
- Full native Rust, Node, typecheck, Vite build, formatting and Git diff.
- GitHub Fast Gate: Linux/Web, Windows Node and Attribution need green on PR;
  fast gate does not compile native Rust.
- Packaged Windows/macOS GUI, real offline error states, operator/owner
  approval identity and security audit still pending. Security Issue #76
  remains blocking for multi-device autonomous writers.

Next: reviewed feature-to-test coverage policy with signed approval/revocation,
real native/CI test execution receipts, full release-readiness gate and
cross-device evidence reconciliation. No end-user Cost Guard.
