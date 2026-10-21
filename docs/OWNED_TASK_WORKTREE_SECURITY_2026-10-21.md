# KatoSync Issue #76 — isolated task worktrees (review-only prototype)

Date: 21 October 2026. Stacked branch `security/owned-task-worktrees-20261021` on SQL lease prototype PR #83, which in turn depends on native read-only preflight PR #82 and integration PR #75.

## Implemented and verified

- Rust-only internal module `src-tauri/src/owned_worktree.rs` for synthetic/isolated tests. It has **no Tauri command**, no production `VerifiedWorkPermit` constructor and no connection to the existing `run_codex_task` command or remote authorization broker.
- Worktree creation repeats registered-project + expected HEAD + clean worktree preflight before writing anything and refuses an existing/unsafe worktree root; it creates a unique detached worktree at the pinned SHA, outside the original checkout. It does not switch user branches, fetch/push or execute providers.
- Rejects checkout filter attributes active on tracked files, even when global Git LFS is harmlessly installed. Hooks and fsmonitor are disabled for worktree Git commands. Note: Git and the OS do not themselves provide full sandbox isolation; filter-related races and unusual Git configurations need an independent security audit.
- Worktree cleanup refuses a dirty/moved/unresolved workspace; no force remove or recursive delete is used by the candidate production code. Synthetic fixture teardown cleans its own temporary test directories only.
- Focused tests: eight synthetic cases for unchanged original branch/content, safe cleanup, dirty preservation, wrong HEAD, invalid/suspicious task scopes, unsupported target root, distinct detached worktrees and malicious active filter rejection.

## Still release-blocked

- No authenticated backend verified permit source; `VerifiedWorkPermit` is deliberately not constructible in production. Passing a forged local boolean or an agent prompt must never grant write rights.
- No integration with the private PostgreSQL lease authority (PR #83), scoped human approval records, per-mutating-operation lease/fence checks, durable task receipts, provider process cancellation, secret-sensitive tool restrictions, cross-device collision handling or deployment.
- No autonomous local/remote execution. The legacy native writer can still change the checkout/branch and is unchanged. Do not claim Issue #76 is closed.
- No merge to `dev` or `main`; release packaging requires actual Poppler/Typst binaries, signed installers, OS GUI smoke, independent review and explicit merge approval.

## Next milestone

1. Build a narrow trusted backend approval/broker contract, verifying account membership, device identity, project SHA, explicit operation scope and active SQL fencing lease without ever exposing service-role credentials to the desktop.
2. Only after those checks and independent review create a production-only constructor for a short-lived verified permit, then connect the owned worktree lifecycle.
3. Test the actual provider subprocess writes in an isolated worktree and cancel on lease loss; simulate M2 vs M3/Windows races and crash/recovery with no two writers succeeding.
4. Update ignored local `PROJECT_STATUS_FLOW.md` and `MEMORY.md` on every verified handoff.

This is a **prototype and regression evidence**, not a safe unattended writer release.
