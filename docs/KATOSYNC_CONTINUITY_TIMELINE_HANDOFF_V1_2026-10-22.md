# KatoSync Continuity Timeline + Manual Handoff (v1)

Date: 2026-10-22. Developer-only stacked candidate after PR #94.
Not deployed, no signed installer or graphical acceptance completed.

## What changed

- A read-only native Tauri command `continuity_timeline(projectId)` checks
  **persisted Project Registry, live Git HEAD, and indexed Memory Fabric root fingerprint**.
  It fails closed for unrelated/unregistered/mismatched project roots.
- Opens existing Memory Fabric SQLite **read-only**. A v1 schema returns an empty
  timeline without triggering migrations, filesystem indexing or writer operations.
- Existing journal store can retrieve **20 newest events** by single project.
  Internal query limit 1..30, scoped to the caller-provided, validated Project ID.
- Project UI displays reverse chronological events and source Git baseline.
  Mismatches are labelled stale. Expand a proposed decision to see choice,
  original rationale ("why"), alternatives and evidence. Imported text is rendered
  as escaped React data; no HTML or script execution.
- An explicit **Copy handoff** action exports a limited context packet of at most
  8 recent local events and 4 decisions per event. Every decision is marked
  **unverified**, carries a Git-head match flag and requires independent review.
  No implicit access to ChatGPT/Claude private chat histories or memory.
- Handoff is JSON text, not executable instructions. The UI also shows a
  read-only selectable textarea for copying when browser clipboard permission fails.
- The existing DE/EN/ES/RU localization and glass/theme tokens are reused.

## Safety and verification

- No network request, cloud worker start, warm service, Git write, commit, merge,
  canonical memory promotion, agent job or synchronization to a provider.
- The read API creates no database and preserves the previous v1 read boundary.
- No trusted architecture statement is inferred from model-generated content.
- The handoff is an **excerpt**, not a full chat transcript or complete project history.
- The user must inspect the packet before sharing; copying to clipboard is
  local and explicit.
- Prompt injection inside imported notes remains **untrusted JSON string data**:
  downstream AI clients must not promote it to instructions or automatic tool access.

### Tests

- Full macOS Rust library suite: 109 PASS, 3 intentionally ignored.
- Node/TS suite: 148 PASS, including cross-project exclusion, explicit
  unverified/no-execution flags, prompt-injection text stays data, and size limits.
- `npm run typecheck`, Vite build, `cargo fmt --check`, `git diff --check`: PASS.
- Native test build used local ignored placeholders for optional Poppler/Typst
  resources; this is NOT a packaging validation.
- GitHub Linux/Windows Node CI and Attribution must pass before review acceptance;
  Rust/desktop installer smoke is separate and still outstanding.

## Future

- Offline context delta and native scoped history cursor/pagination.
- Verified event-hash lineage reporting (hashes alone are not signatures).
- Local Gemma chat with explicit operator-selected project context.
- Opt-in MCP transfer and mesh conflict reconciliation after device and
  owner authorization model review; Issue #76 remains blocking.
- Final UI/UX consistency and macOS/Windows signed beta acceptance.

Cloud-cost policy applies **only to our development infrastructure**,
not to an end-user Cost Guard feature of KatoSync.
