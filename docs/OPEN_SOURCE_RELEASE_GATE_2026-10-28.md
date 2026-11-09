# KatoSync — Open-source release gate (28 October 2026)

This checklist reports work in the stacked QA development branch.
It is **not** a public release authorization.

## Verified code-review findings

- The GitHub auth regression (403 + exact `bad_jwt`) is fixed and
  physically verified on M2 and M3 QA builds. PR #164 remains draft.
- The PR fast workflow matched only `dev/main/security/integration`;
  stacked Mesh/Auth PRs with feature-branch bases therefore lacked a
  guaranteed Node/Windows fast gate. The workflow must cover all PR bases.
- A live npm advisory audit found four high-severity dependency
  findings, including Vite, nanoid, PostCSS and source-map-js.
  Refresh the locked dependency graph and rerun the advisory audit,
  tests and native QA before accepting the fix.
- No repository-root LICENSE, SECURITY.md or CONTRIBUTING.md existed on
  the audited branch. This patch supplies disclosure/contribution
  guidelines, **not** a legal license.
- The **Git history still contains internal files** although they are
  now excluded from the index: MEMORY.md (14 historical commits),
  PROJECT_STATUS_FLOW.md (33), and RELEASE_OWNER_RUNBOOK.md (2).
  Inspect content privately and prefer a separately curated, clean-history
  public source release rather than making the entire private development
  history public. Do not destructively rewrite the active shared history.
- A bounded keyword scan of 1,715 reachable text blob objects found no
  recognized PEM private keys, GitHub PAT formats, AWS access key IDs,
  Supabase sb_secret keys or live Stripe keys. This is **not**
  comprehensive secret/history/privacy clearance: other formats,
  personal information and artifacts remain outside the scan.
- The large native `src-tauri/src/lib.rs` and frontend `src/App.tsx`
  and `useKatoSyncViewModel.ts` remain maintainability risks;
  refactoring is a separate behavioral-preserving workstream.

## Required before making the source publicly reusable

1. The copyright holders **choose** an SPDX-compatible open-source
   license. Do not assume MIT, Apache-2.0 or any other permission;
   inspect third-party code/model/data obligations independently.
2. Scan the **entire Git history**, releases and GitHub Actions
   artifacts for credentials and personal information; scan only
   from an authorized environment. A current-worktree scan is not
   sufficient. Rotate exposed credentials before publication.
3. Independently review the enrollment service's service-role
   boundaries, atomic challenge handling, replay protection,
   revocation and per-owner quota under concurrency.
4. Obtain macOS and Windows **native** CI/hardware results for the
   exact intended release commit; fast Node checks do not compile
   native Rust.
5. Verify all staged SQL migrations against a disposable/staging
   project including RLS negatives, public Realtime settings, and
   least-privilege grants. Do not deploy draft migrations as an
   unintended side effect of CI.
6. Exercise actual two-machine consent, Ed25519 verification, mTLS,
   device revocation, stale session handling, offline recovery and
   fencing before enabling Mesh remote execution.
7. Review pinned GitHub Action commit SHAs, build provenance,
   reproducible release packaging, notarization and update signing.

No production database changes, trust grants, remote dispatch
or stable-app release are implied by this checklist.
