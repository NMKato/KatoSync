# KatoSync — Durable Offline Chat / Multi-turn Context v1

Date: 2026-10-22. Developer candidate, stacked on PRs #91–#96.
NOT installed or packaged; final GUI and disconnected-network test pending.

## What is implemented

KatoSync Projects & Focus loads up to 20 latest saved turns from the
EXISTING Memory Fabric SQLite database, including after app restart.
Questions and model answers save after each successful local reply.
A follow-up receives up to three previous Q&A turns as conversational
reference. For every new answer, verified project sources are retrieved afresh.
A single default project conversation exists; the underlying table caps
history at 1,000 turns per project until archiving is added.

## Native schema / migration

Version 1 → 3: create event journal plus local chat history.
Version 2 → 3: add chat table only, retaining all previous journal events.
Changes are additive and transactional; previous indexed project sources,
FTS5, verified memory and canonical promotions are unaffected. Read-only
overview accepts v1/v2/v3; historical chat view against v1/v2 stays empty
without database migration until the user actually sends a new question.

Table continuity_chat_turns uses a registered project FK and composite
(project_id, sequence) primary key. One BEGIN IMMEDIATE transaction performs
compare-and-append against expected prior sequence. A concurrent writer
causes a conflict, never silent overwriting. Question cap 1,200 characters,
answer cap 4,000, up to eight citations. Data values are redacted before
persistence. Retrieved RAG blocks are not stored in transcripts.

Storage uses the existing local SQLite file and host protections, not
a new app-level encryption layer.

## Model and safety boundary

- Root is derived from saved Project Registry, not IPC or user prompt.
- Git HEAD, Memory Fabric root fingerprint and indexed source freshness
  are verified before querying; HEAD is checked again before persisting.
- Only canonical/verified, non-stale RAG facts are passed to the local model.
- Previous MODEL answers never become retrieval facts. Previous messages
  provide reference only, and confer no permissions or tool calls.
- No eligible citations → NOT_IN_MEMORY without any model request.
- Actual inference uses the existing pinned localhost model alias
  (kato-local-brain, 127.0.0.1:17842), with redirect policy disabled.
  No cloud fallback, no model autostart and no paid warm worker.
- Unverified Blueprint or journal suggestions stay outside trusted RAG.
- No issue mutations, commits, merges or agent commands allowed.

## UI

- Four existing localizations DE/EN/ES/RU and glass-card theme.
- Explicit Reload after stale write conflict; user text retained on failure.
- Prevents answering until local history is loaded and verified.
- No end-user Cost Guard; cloud spend rules remain internal.

## Verification

Local macOS Rust library: 114 PASS, 3 intentionally ignored.
Node suite: 148 PASS. TypeScript, Vite build and Rust formatting: PASS.
Tests include legacy schema migration, SQLite restart persistence,
cross-project isolation, concurrent writers, sensitive text redaction
and chat content remaining outside canonical project memory.

GitHub Linux/Windows Fast Gate and attribution checks remain required.
The GitHub Fast Gate does NOT compile Rust. Packaged macOS/Windows GUI,
actual multi-turn inference through the newly installed app and a true
no-network offline test have NOT been completed.

A separate live localhost RAG acceptance test was manually run on the M2:
verified source question answered correctly, missing-fact question returned
NOT_IN_MEMORY, 1/1 live Rust test PASS in about 14 seconds (model already running).
This proves grounded inference but is NOT packaged KatoSync GUI acceptance. Temporary ignored Poppler/Typst
resources used for native library tests are not installer assets.

## Next gated work

Native UI / migration smoke with no internet, optional manual chat delta
handoff, cross-device conflict reconciliation, authenticated writers and
fenced lease (Issue #76), then full UI/UX/accessibility/installer QA.

No cloud workers or additional persistent paid services were started.
