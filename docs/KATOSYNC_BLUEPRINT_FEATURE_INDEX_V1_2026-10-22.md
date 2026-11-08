# KatoSync Continuity: Blueprint Feature Index / Milestone Search v1

Date: 2026-10-22. Isolated developer feature stacked on Draft PR #98.
NOT merged, installed or released. No cloud workers or model inference required.

## User requirement

A Blueprint should not need full rereading to find one relevant feature.
Parse previously validated JSON into feature-sized sections, and index these
locally inside the existing Memory Fabric SQLite database:

- Searchable overview for each import: title, intent, next steps.
- Independent decision sections: ID, title, choice, WHY, alternatives,
  consequences and evidence reference strings.
- Structured milestone sections from journal checkpoints with projectId,
  featureKey, title, rationale, summary, status and evidence.
- Immutable projectId, original journal sequence, section ID, Git baseline
  and unverified source status preserved in each section.
- Multiple Blueprint revisions coexist. The first remains pinned as origin.
  The separate first-3/latest-20 chat context is unaffected.

## Storage/index design

Additive SQLite v4 migration creates blueprint_sections plus an external-content
Unicode FTS5 index and synchronized insert/delete/update triggers.
Blueprint sections reference journal events by (project_id,sequence), with
foreign-key cascade, in the existing Memory Fabric DB. NO second database.

The journal event and all indexed sections are inserted atomically in one
SQLite transaction; an indexing error cancels the entire journal append.
v3-to-v4 upgrade deterministically backfills historical event records in
one transaction. Read-only search never migrates, writes or starts a worker.

Native continuity_search_blueprint(projectId,query) checks registered project
identity and live Git HEAD, constructs a bounded literal-word query (no raw
FTS operators or SQL injection), returns up to 12 project-scoped sections
and unverified source references. The UI is native-only in DE/EN/ES/RU.

## What "compare with current project" currently means

Source Git baseline is compared with CURRENT registered repository HEAD:
same, changed, or unknown. **Matching Git SHA does NOT prove a feature
is implemented, reviewed or tested.** Mismatching SHA likewise does not
prove incomplete functionality. A checkpoint author's word 'completed' is
unverified until confirmed by actual commits, CI and owner approval.

The future deeper diff should join separately VERIFIED project files, actual
Git and CI outcomes to stable feature/ADR IDs, with explicit unknown and
conflict states. No automatic promotion of claims into canonical Memory RAG.

## Security and privacy

The indexed Blueprint is untrusted proposal DATA, never runnable instructions,
owner approval, shell permissions or verified source truth. Strong per-project
query isolation, bounded FTS, local-only reading, no network calls, warm Cloud
worker or end-user Cost Guard. Pinned material remains eligible for correction,
export and deletion; there is no implied perpetual personal-data retention.

## Verification

Local macOS Rust full tests including FTS, project isolation, revision source,
Git-baseline comparison and v3-to-v4 backfill. Node, TypeScript, Vite and format.
GitHub Linux/Windows Node Fast Gate and Attribution required, but the existing
Fast Gate does not compile native Rust. Desktop packaged GUI and Windows Rust
acceptance, including actual indexing on an existing database, remain pending.
Security Issue #76 still blocks unattended agent writes.

Future milestones UI, feature-scoped verified code/CI diff, owner-reviewed
summary checkpoints, retention and erasure controls, signed beta and final
design-system accessibility audit still outstanding.
