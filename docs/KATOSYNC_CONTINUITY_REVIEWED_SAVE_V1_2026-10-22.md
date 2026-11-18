# KatoSync Continuity — explicit local Blueprint proposal save

Date: 2026-10-22. Development candidate stacked on #91, #92 and #93.
**Not deployed; no automatic agent writes or promotion to canonical project truth.**

## User flow

On Projects & Focus, choose a Project Registry entry, import or paste a Blueprint,
inspect the original reasons for the decisions and press Review. KatoSync may
then run a **read-only native preflight** (Tauri desktop only) against the
registered Git repository and the already indexed Memory Fabric project.
It displays the real HEAD and whether the imported Blueprint baseline differs.
No external service is contacted or paid warm worker started.

If the preflight succeeds and the Blueprint is not stale, the user may check a
separate review acknowledgement and click **Save proposal to offline journal**.
A valid import is saved as an UNVERIFIED event, never as a canonical ADR, task
approval or executable agent request. The browser-only demo cannot save events.
The save payload limit is 8 KiB; a 32 KiB Blueprint can still be previewed.

The native save command independently rejects mismatched project IDs, invalid
schema, extra "approved" fields, oversized payloads and mismatched Git HEADs.
It reads the persisted Project Registry, resolves the Git root itself,
verifies the indexed Memory Fabric root fingerprint and verifies HEAD again.
The SQLite compare-and-append transaction rejects concurrent/stale tails.
Exact retransmissions use deterministic Blueprint hash and source timestamp.

The preflight opens the existing Memory Fabric **read-only** and remains
compatible with schema v1; v1→v2 migration occurs only on explicit Save.
It does not create a new journal database or alter canonical memory.

## Security notes

- UI acknowledgement is **not cryptographic owner authentication**.
- IPC can be invoked by compromised renderers; only unverified local DATA may
  be created. No arbitrary file path is accepted by the native command.
- Imported suggestions are always treated as untrusted; never instructions
  for Gemma, OpenClaw, Codex or shell runners.
- Model conversation history is NOT fetched from ChatGPT/Claude automatically.
- No shared multi-device lease/fencing exists at this stage: Issue #76 remains
  a release blocker for autonomous writers.
- Local SQLite inherits host disk encryption/security, not independently
  encrypted by this extension. No cloud worker lifecycle changes.

## Acceptance

- Local macOS Rust full library tests, Node tests, TypeScript, production web
  build and Cargo formatting are mandatory.
- GitHub Linux and Windows Node fast gates plus attribution are mandatory.
- GitHub PR fast gate currently does not compile Rust; native macOS/Windows
  packaged GUI smoke and Windows Rust CI remain separate gates.
- Draft PR for review; do NOT merge into main or ship live.

## Next

Build a reviewable event-history timeline and conflict/resume UI, then
connect local Gemma chat to verified read-only context deltas. Human approval
of architectural truth remains a separate authenticated process.
