# KatoSync — per-project MVP Progress Dashboard (candidate v1)
Date: 2026-10-22. Draft development on top of Continuity PR #100.
No production deployment, Git merge, or cloud worker activation.

## User story

Every registered project can have its own MVP definition, independent of
Side Tasks, stored in an existing, reviewed local Blueprint handoff.
KatoSync Projects & Focus cards and Agent Sync Dashboard display a compact
progress bar for each registered project. No global blended progress:
all reads are strictly scoped to one Project Registry project ID.

## Backward-compatible Blueprint extension

Optional top-level mvpScope with max 24 records. Records contain:
featureId (stable unique ID within Blueprint), title, lane ('mvp' or
'side'), weight (integer 1..5), acceptanceCriteria (non-empty string).
Both TypeScript import preview and native Rust handoff validate the same
bounds, reject duplicate IDs, unsupported fields and forged approvals.
Older Blueprints without mvpScope remain valid; the dashboard shows
'no explicit MVP plan' instead of a guessed percent.

Illustrative addition to a valid Blueprint:
  "mvpScope": [
    {
      "featureId": "ADR-10",
      "title": "Local assistant booking flow",
      "lane": "mvp",
      "weight": 5,
      "acceptanceCriteria": "End-to-end booking acceptance test green"
    },
    {
      "featureId": "PLANET-POLISH",
      "title": "Visual animation polish",
      "lane": "side",
      "weight": 1,
      "acceptanceCriteria": "Designer review"
    }
  ]

## Semantics: separate plan and evidence

MVP denominator: sum of explicit MVP-lane weights only; Side Tasks are
listed but excluded, so side-work cannot inflate/dilute a minimal release.
A task is reported done ONLY when its latest structured, matching-project
checkpoint after the selected Blueprint scope says done/completed.
Later blocked/in_progress/pending reopens its reported status.
The dashboard reports (reported completed weight / total MVP weight) × 100,
rounded down. The dashboard explicitly labels it 'REPORTED / UNVERIFIED'.

Important: Structured checkpoint text is NOT verified test evidence.
verifiedPercent remains NULL, not 0 or an invented percentage, until feature-
specific test/CI receipts plus trusted owner acceptance are implemented.
A reported 100% is not an MVP-release authorization.

The source is the newest saved Blueprint containing an explicit MVP scope.
Multiple Blueprint versions coexist in the journal; the older pinned origin
remains unchanged. Tasks and claims live in the existing local Memory Fabric
SQLite and are read on demand without migration or writes.

At this stage, Project Status Flow Markdown and arbitrary project MEMORY
files are NOT implicitly parsed into progress, to prevent arbitrary prose
or model-generated claims from becoming authoritative status. A later,
reviewed connector will map feature IDs to verified document hashes and CI
receipts, using explicit acceptance gates.

## UX and privacy

- Project cards display MVP progress, task counts, Side Task counts,
  expandable task list with weight, criteria, and claimed state.
- Agent Sync Dashboard shows the same per-project compact bar for portfolio.
- No plan -> neutral indeterminate track, not a fake 0% number.
- Four UI localizations (DE, EN, ES, RU), existing design tokens.
- Dashboard lookup checks persisted Registry project identity and Git root
  binding via existing native Memory Fabric preflight. Browser demo never
  invents live status.
- No autonomous code writes, Git operations, network requests, new cloud
  workers or end-user Cost Guard.

## Test and release gates

Native tests cover weighted 3:1 MVP tasks, Side Task weight exclusion,
100% claimed (never verified), later 'blocked' reopening, unknown legacy
plans, project isolation, invalid/duplicate/smuggled Blueprint MVP fields.
Node validates backwards compatibility, scope bounds and fake approvals.
Run full Rust/Node/TypeScript/production bundle/format checks before PR.
GitHub Linux/Windows Node CI + attribution must independently turn green.
Native Windows/macOS packaged GUI and disconnected-internet smoke remain
release gates; CI Fast Gate does not compile Rust.

Future: accepted feature-level CI/test receipts, reviewed MVP eligibility,
critical-path blockers, revised targets + target dates, project milestones
linked to Queue tasks, explicit progress-to-release gate, erasure/export,
and security Issue #76 for multi-device writer fencing.
