# KatoSync Project Context Anchors v1 — original Blueprint + first 3 + latest 20

Date: 2026-10-22. Developer-only feature stacked on Continuity PR #97.
This is not a released / installed version.

## Objective

Every Project Registry project ID owns its own local conversation, journal and
verified Memory Fabric. Project switching, Queue multitasking or device
reconnect must not accidentally concatenate unrelated projects.

Provide local Gemma with both the beginning and end of each project's story:

- Original imported Blueprint (earliest journal decision_proposal event with
  blueprint event ID). This original provenance marker stays stable as later
  Blueprint proposals arrive. Imported Blueprint intent is UNVERIFIED; it is
  not human approval, a project instruction or canonical architectural fact.
- First 3 chat rounds (earliest sequence per registered project) as fixed
  starting anchors, independently queried from SQLite.
- Latest 20 chat rounds (latest sequence per project) describing current
  trajectory. They remain visible as the main UI transcript.
- Only verified/canonical fresh Memory Fabric RAG determines factual answers.

### Performance and "weighting"

No full transcript scans, background worker or cloud API:
1. Indexed per-project SQL LIMIT 1, LIMIT 3 and LIMIT 20 reads.
2. Blueprint intent gets a compact, pinned orientation slot.
3. Three starting turns get slightly larger per-turn budgets.
4. Recent twenty get individual, shorter Q/A budgets and maintain sequence.
5. Duplicate sequences appearing in both groups appear only once.
6. Fixed total user-scope orientation cap before invoking local Gemma; each
   new question still refreshes real Git/source verification and trusted RAG.

These are deterministic token-slot priorities, not a trained ranking model.
Longer histories remain in the project SQLite database, up to the existing
1000-turn safety cap; they are not automatically deleted after 20 turns.

## Security

- All database queries require the exact registered project ID. Prompt-supplied
  project tags, URLs or local paths cannot override the native project scope.
- Project name and ID are shown together as a visible tag in local chat.
- The original Blueprint/previous model turns are deliberately kept as
  lower-trust JSON DATA in a USER-SCOPED model message, not the system prompt.
- The independently verified RAG stays in the system's fact source.
- Previous model answers are not used as retrieval facts and are never
  promoted to Memory Fabric verified/canonical or code/agent permissions.
- No automatic ChatGPT chat-history export or upload occurs.
- No cloud worker start, resource warm-up, Git writer or production change.

## Test results

Local macOS (isolated worktree):
- 118 Rust library tests PASS; 3 intentionally ignored.
- 148 Node tests PASS.
- TypeScript, production build, Rust formatting, git diff check PASS.
- New Rust tests verify persisted first three and latest twenty after restart,
  Blueprint origin unchanged by later imports, cross-project isolation, strict
  per-group deduplication, bounded imported content and unverified trust label.

GitHub Linux/Windows Node CI & attribution pending submission. GitHub CI does
not compile the native Rust layer. No packaged macOS/Windows GUI offline
smoke or complete network-disconnect test is claimed.

## Smart next enhancements (NOT implemented)

1. Explicitly approved Blueprint revisions: show original versus currently
   approved intent; never silently overwrite the original or infer approval
   from incoming data.
2. Project milestones, owner-approved durable summaries, verified completion
   signals and last stable Git/CI checkpoint to bridge the middle of long
   histories (what changed WHY, not only what was said).
3. Archive after 1000 turns and provide per-project correction, export,
   delete/forget and sensitive-data retention controls. "Pinned" must never
   mean that personal information cannot be deleted.
4. Queue project tags and sub-task branches; handoff across a multi-device
   Mesh only with source identity, conflict review, signed approvals and
   fencing per security Issue #76.
5. Actual offline/no-network model+GUI restart smoke, Linux/Windows native
   tests, full UI/UX/design system consistency and packaged release gates.
