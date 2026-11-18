# KatoSync: Top 3 MVP Portfolio & Nested Project Dossier (v1)
Date: 2026-10-22 — isolated candidate stacked on Draft PR #101.
NOT merged to dev/main, installed, packaged or production-deployed.

## UX intent

When a user has many projects, avoid rendering an unbounded wall of progress
bars and checklists. The Agent Sync Dashboard initially shows **only three
ranked projects**, each with one neutral, reported-only MVP progress bar.
Focus ranking is deliberately existing deterministic portfolio order:
active before parked before archived; P0 before P1 before P2; stable name,
then registered ID. No AI score or completion-claim score changes priority.
Users can change an individual project's Focus priority in Projects & Focus.

A closed `Weitere Projekte anzeigen (N)` expander contains the remainder.
Opening it reveals a bounded, keyboard-scrollable list (max 290px desktop,
240px mobile), not a second dashboard full of heavy progress indicators.
List rows include project name, priority and focus status and can open that
project's dossier. Additional per-project data is loaded on demand only
when the user explicitly opens the project.

The project detail section displays:
- Full per-project MVP scope, weighted tasks and acceptance criteria, reported
  but UNVERIFIED checkpoints, with requested side tasks kept separate.
- Collapsible current work wave / scanner and finding summary (including
  when last scanned, with explicit snapshot caveat).
- Collapsible existing Project Capsule: purpose, up to eight next safe steps,
  and source count. No raw private memory files or unverified narrative
  promoted into verified project truth.
- One quiet warning about unresolved warn/danger verification findings in
  each of the top-3 cards; full findings only in detail.

Projects & Focus cards likewise show a **compact** bar by default and
expand to the detailed task breakdown only when that existing card's
Details control is opened.

## Privacy / correctness

- No project can appear twice: list partition deduplicates by stable project ID.
- Project scope remains native Project Registry identity; no cross-project
  Memory Fabric lookup or metadata mixing.
- The MVP percentage is **reported/unverified**, never automatically
  accepted based on arbitrary MEMORY.md or Project Status Flow prose.
- Missing MVP plan is neutral 'not configured', never assumed to be 0%.
- No new daemon, provider/model inference, cloud worker, database table,
  Git write, GitHub merge, cloud billing telemetry or extra paid instance.
- The worktree never modifies the running KatoSync installation.

## Verification

Pure Node tests cover deterministic priority ranking, top=3 cap, scroll
overflow membership, two-or-fewer projects, duplicate project IDs and
nonmutation of input data. Native Rust library suite is unchanged and
should be rerun for regression. TypeScript and production Vite build,
Rust formatting and diff whitespace checks are release hygiene gates.
GitHub Linux/Web Build, Windows Node Regression and Attribution must
finish green for the exact commit before merge review.
The GitHub Fast Gate does NOT compile native Rust.

Native desktop mouse/keyboard, full mobile viewport, screenreader semantics,
true offline/disconnected Windows/macOS GUI smoke, signing and accessibility
review are still outstanding. Existing security Issue #76 remains blocking
for cross-device autonomous agent writers.

## Smart next improvement

Separate per-project **operational progress**, **verified MVP acceptance**
and **release readiness**, each grounded in explicit evidence receipts.
Add pinned release blockers and a user-adjustable "Top Projects" pin policy
only after the underlying owner-approved task and evidence model is ready.
Do not let unverifiable model summaries fabricate approval percentages.
