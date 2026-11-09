# KatoSync MVP — Git-committed feature acceptance policy audit v1
Date: 2026-10-22. Isolated developer slice stacked on Draft PR #105.
No production installation, Git merge, deployment or scheduled worker.

## Goal

Prevent an imported Blueprint from secretly assigning irrelevant green CI jobs
to MVP features. A CI job name in the Blueprint is an *unverified proposal*.
A separate project-local, Git-committed acceptance policy provides a second
auditable source that can be compared with the proposed mapping.

This first slice identifies features **READY FOR HUMAN COVERAGE REVIEW**.
It does NOT claim that a feature passed a test, was reviewed by the owner,
is release-ready or has verified/canonical status.

## Where the policy lives

Each project owner may commit one file to its own registered Git repository:

`.katosync/mvp-acceptance-policy-v1.json`

The example in `docs/examples/mvp-acceptance-policy-v1.example.json`
is illustrative and is NOT installed automatically in any project.
The caller cannot supply a policy path, URL or alternative Git repository.
Native code reads the **exact commit object** using
`git show <registered HEAD>:.katosync/mvp-acceptance-policy-v1.json`,
after ensuring that the object is a regular tracked blob. Uncommitted
working-tree edits are ignored. No filesystem write or network call occurs
during this policy check; user has already pressed the explicit CI button.

## Required policy fields

- schemaVersion exactly `katosync.mvp-acceptance-policy/v1`
- projectId exactly the persisted Project Registry ID
- features: max 24 unique stable feature IDs
- each feature: featureId, acceptanceCriteria (1..400), ciChecks (1..4
  pairs of workflow/job exact names), testSource (safe project-relative
  Git-tracked regular test source path)

No `ownerApproved`, `completed`, `releaseReady`, shell command,
absolute filesystem path, URL, `../` traversal, arbitrary extra fields
or duplicate IDs/checks are accepted.

The native check reads project ID, live Git HEAD and source binding from
registered project + Memory Fabric preflight. Test source is checked only
at the *same exact HEAD* via read-only `git ls-tree`. The policy must match
the currently indexed Blueprint feature ID, acceptance criterion and exact
workflow/job pairs; the matching provider-signed GitHub workflow/jobs must
have been reported successful on that HEAD. Otherwise the policy reports
its reason, not green.

## What "ready for coverage review" means

All of these separate checks have passed:
1. Exact repository, project ID and HEAD consistency in native registry.
2. File is present in the Git object tree and passes strict schema checks.
3. Feature ID / criteria / proposed job pairs agree with the policy.
4. A candidate test source is Git-tracked as a regular file.
5. GitHub's verified API response says the specified workflow/jobs succeeded
   on that commit according to the latest run already inspected.

**It still does not prove that the committed test source executed within
that CI job or that the test assertions cover the feature.** Repository
commit authors are also not authenticated as human approvers by this step.
Status is **REVIEW READY, NOT APPROVED**; `ownerApproved=false`,
`featureAcceptanceVerified=false` and `verifiedPercent=null` always.

If a policy is missing, invalid, from another project, not committed, refers
to a missing test file, has mismatched criteria/jobs, or if CI is not green,
the feature is NOT ready. No retroactive pass or automated release.

## UX

Nested under each selected project's manual GitHub CI evidence check:
- policy committed/missing/invalid status
- per-feature review readiness or specific mismatch
- relative Git test source file path, when present
- explicit owner approval still missing

The default Top-3 Dashboard stays uncluttered; no global scanning,
provider model calls, always-on workers, cost UI or data synchronization.

## Tests and release conditions

- Rust strict parser tests for fake approval, cross-project identity,
  duplicates and unsafe test paths.
- Native temp-Git-repo tests that prove HEAD object is used (not uncommitted
  edits); missing, moved or removed test sources fail; revised/missing
  policy, mismatched acceptance criterion, changed CI job and non-green
  provider status do not become review ready.
- Full Rust/Node/TS/build/format checks on isolated Mac.
- GitHub Fast Gate/Attribution required separately; Fast Gate does not
  compile native Rust or test packaged desktop GUIs.
- Real packaged Windows/macOS GUI, screenreader/keyboard, offline mode,
  signed installers and security Issue #76 remain release blockers.

## Roadmap after this slice

1. Owner-authenticated, revocable coverage policy approval bound to exact
   Git HEAD, feature ID, policy object hash and verified test execution logs.
2. Actual test-case-to-workflow execution evidence, not merely file existence.
3. Human acceptance and revision audit trail, then conservative verified MVP
   progress with explicit blockers and release readiness.
4. Native multi-device GUI/offline smoke and fenced writer security gates.
