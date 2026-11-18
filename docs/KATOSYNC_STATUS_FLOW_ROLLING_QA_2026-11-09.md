# KatoSync 4.0 — Rolling Project Status & Agent Mailbox, QA slice

**Date:** 2026-11-09. **Scope:** No-deploy, no-autonomous-write, no additional Supabase project. Child of roadmap [#12](https://github.com/NMKato/KatoSync/issues/12), [#30](https://github.com/NMKato/KatoSync/issues/30) and [#33](https://github.com/NMKato/KatoSync/issues/33).

## First verifiable engineering slice

Implemented `scripts/qa-project-memory-rolling.mjs`, a **pure, read-only projector** that translates synthetic examples of project-scoped journal events into a bounded `PROJECT_STATUS_FLOW.md` Markdown view and a sequence of indexed, content-addressed archive projections.

- The projector accepts only bounded, contiguous, unique sequence IDs with one project ID, strict event kinds, agent IDs, timestamps, commit SHA syntax, scoped task/target-agent references and short sanitized summaries. **It must not be used as a trusted ingest path**; its inputs are untrusted until checked against existing canonical SQLite Memory Fabric and live Git data.
- Rotation triggers at a configurable event count or UTF-8 size, with ceiling safeguards; the current projection retains the latest synthetic event and a supplied checkpoint, plus a pointer to the most recent `.katosync/archive/status-flow/000NNN.md`.
- Archive segments contain sequence spans, predecessor SHA-256 digest and content digest. The exportable in-memory search index maps each event ID, agent, task and Git SHA back to its archive path. The index survives projection rotation and can be reproduced from the full canonical journal.
- The agent mailbox selects only project-matched `handoff` and `agent_note` entries, optionally addressed to the requesting agent, since a bounded sequence.
- `verifyProjectionIntegrity` checks the internal archive digest chain, contiguous coverage, index/segment agreement and exact active-file regeneration. **SHA-256 alone does not prove cryptographic authorship or trusted device state**.
- Secrets or external links are rejected in display summaries, and Markdown/HTML is rendered as non-authoritative data.
- Every projection returns `authoritative:false`, `automaticMergeAllowed:false`, `remoteJobsEnabled:false`, `writerAuthorized:false`, `requiresCanonicalJournalAndLeaseValidation:true`. No live K2S schema, data or Auth mutation; no Git push or filesystem write. The named file paths are proposed logical exports only.

The focused Node suite `tests/rollingProjectMemoryStage4F.test.ts` validates 600-event rotation, complete no-loss history, deterministic archive content, broken hash and changed-index detection, old-history search, agent mailbox, foreign-project denial, forged/unverified context, injection redaction, resource caps and no disk mutation.

## P0 mesh situation (independent hardware check)

On physical M2 (192.168.178.97) and M3 (192.168.178.162), 2026-11-09, reciprocal private-LAN ICMP probes each transmitted 2 packets and received 2, with **0% loss**. This verifies LAN reachability **only**, not mTLS, Ed25519, SAS, a trusted enrollment, secure shared writer, agent context sync or live job delivery. Those remain gated by the real two-host test and explicit user consent.

## Remaining P0 and later integration

1. **P0:** M2↔M3 authenticated signed identities, SAS confirmation, mutual TLS/session continuity, replay/revocation checks, owner session and trusted enrollment. No assumed trust from ICMP or two accepted invites.
2. **Canonical data source:** Feed a *verified* project-bound range from existing Memory Fabric SQLite `continuity_events`, preserving event hashes, verified Git ancestry, authoritative owner approvals and one fenced writer per project. Do not invent a second canonical journal.
3. **Atomic archive writer:** Only after checked writer permissions and trust, implement durable manifest + temp-file/fsync/atomic rename + crash recovery, archive receipt, SQLite index/FTS rebuild, project quota, export and restore. Concurrent offline forks must be reconciled explicitly, never last-write-wins.
4. **Cross-agent collaboration:** Add ABM/ACG worktree task branch ownership, Code provenance, SCL handoff packets (#30), author authenticated note mailbox, bounded notification/ack and device-synced graph (#33).
5. **UI:** Status, Archive History, Agent Mailbox and linked Git commit/PR view; use one shared canonical source and ensure reduced-motion accessible experience.

The working module deliberately does **NOT** write `PROJECT_STATUS_FLOW.md` to actual user projects, auto-create branches, auto-merge, mutate K2S or claim current real Memory Fabric integration. It is an independently testable no-deploy proof of the user's architecture, suitable for later integration after security gates.
