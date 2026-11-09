# KatoSync MVP Feature Test-Receipt Correlation v1
Date: 2026-10-22. Separate isolated candidate stacked on Draft PR #102.
NOT installed, published, or merged to dev/main. No cloud workers started.

## Objective and trust distinction

Connect a project's existing MVP Scope (Blueprint) to the corresponding
project's structured test_result events in the append-only Continuity Journal.

This does NOT certify CI or mark a feature complete by itself:
- Reports from agents, code generators and imported files are UNTRUSTED CLAIMS.
- A SHA matching today's HEAD does not prove that the tests actually ran or
  that the tested implementation met independent acceptance criteria.
- verifiedPercent is intentionally still NULL and every task.verified=false.
- The future authoritative bridge must pull provider-issued CI run status and
  executed test logs through a trusted, owner-authorized workflow, independently
  correlate repo+commit+feature ID and check the full feature acceptance gate.
  No arbitrary imported 'passed' word may grant owner approval.

## Data flow

No new SQLite schema. Read existing Memory Fabric schema v4 locally.
Native continuity_mvp_progress obtains registered project/real current Git
HEAD, then project_mvp_progress(projectId,currentHead) derives:
1. Latest explicitly scoped Blueprint mvpScope tasks (up to 24, side separate)
2. Latest structured checkpoint status after the selected scope revision
3. Latest structured test_result event after that revision for each exact
   featureKey, matching its declared projectId, status passed|failed,
   bounded testName, and observed journal event base_git_head.

Only one most recent receipt per feature ID is shown; duplicates/retried
events are already handled by the journal's stable event identity. A subsequent
failed/stale/unbound receipt supersedes an earlier reported PASS.
A matching HEAD is labelled 'reported pass/fail at current Git baseline';
a mismatch or missing baseline is 'stale or unbound', never fresh.
The summary counts only MVP-lane tasks and excludes side tasks.

## UI

Inside expanded project MVP details only, show:
- Counts of claimed current-HEAD PASS / FAIL and stale/unbound reports
- Each feature's latest testName and claimed test status
- Explicit warning: results not independently verified

The Top 3 Dashboard remains compact. There is no misleading additional
verified-progress bar; reported MVP completion is still independent from
unverified test claims, and release readiness remains unknown.
DE/EN/ES/RU labels and existing design tokens only.

## Read-only and privacy boundaries

All events are project-specific, after the selected Blueprint's immutable
journal sequence. No cross-project joins, third-party request or model call.
No arbitrary command or executable test code from imported records.
Neither model-generated test claims nor filenames are authoritative.

No new always-on cloud worker, GitHub paid runner, daemon, user-facing cost
monitor, remote write permission or product installation.

## Local acceptance

- 130 Rust library tests PASS, 3 intentionally ignored.
- 153 Node tests PASS.
- TypeScript, Vite production build, cargo fmt check, git diff whitespace PASS.
- Added tests: exact project and feature linking; current Git HEAD and stale
  mismatch handling; side-task exclusion; new receipt revokes older pass;
  unbound latest test prevents a false green; never sets verifiedPercent.

## Open gates

- GitHub Linux/Web Build, Windows Node Regression and Attribution checks for
  this exact new commit.
- Existing Node-based Fast Gate does NOT compile the native Rust layer.
- Full packaged native GUI and offline/no-network smoke, keyboard focus,
  Windows Rust acceptance and release UI review remain outstanding.
- Trusted CI receipt/provider verification, owner-approved feature acceptance
  and fenced distributed writer lease (security Issue #76) remain separate.
