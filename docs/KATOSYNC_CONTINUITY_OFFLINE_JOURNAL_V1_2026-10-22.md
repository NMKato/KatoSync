# KatoSync Continuity Journal — native store foundation

Date: 2026-10-22. **Developer-only draft, not exposed through the GUI, MCP or cloud.**

## What this slice does

The existing Memory Fabric SQLite file is upgraded additively from schema user_version 1 to 2.
There is **no second database**. The migration creates the STRICT `continuity_events` table,
scoped by the existing `projects` table. The previous sources, chunks, search index,
identity, evidences and manual canonical promotions remain untouched.

An event captures the project and originating device ID, stable event ID, sequence,
previous event hash, its own SHA-256 hash, type, source/baseline Git HEAD, timestamp,
summary and bounded JSON payload. Allowed event kinds: checkpoint, decision_proposal,
work_note, handoff and test_result. This supports why an architectural decision was
proposed, alternatives and the context in later slices. The event carries no permissions.

### Guarantees at this stage

- Append uses SQLite BEGIN IMMEDIATE transactions (one serialized writer per SQLite database).
- Idempotent replays of a byte-equivalent event ID return the existing event; changed
  content on a reused event ID fails closed.
- The caller must supply the previous event's exact hash. Offline forks or competing
  writers against the same store hit a conflict instead of silent last-write-wins.
- Unknown projects, malformed device/event IDs, invalid hashes, unsupported events,
  overly large or non-object JSON payloads fail before any append.
- Each list read requires a registered project ID and bounded sequence/limit; it
  does not permit cross-project browsing.
- Indexed project truth, manually approved canonical ADRs and existing Memory Fabric
  search remain separate from this journal's unverified candidate events.
- Schema upgrades are transactional; a v1 database is still readable via the read-only
  overview before any write-migration.

### Important limits — deliberately NOT claimed

- Local SQLite transaction locking **does not** provide a multi-device fencing lease.
  Offline M2/M3/Windows replicas need signed device identity, branch/conflict reconciliation,
  and verified lease on reconnect before any shared writes (security issue #76).
- Journal event hashes can detect accidental drift when replayed, but without an external
  root/signature are not tamper-proof against a compromised device.
- Data at rest uses the existing Memory Fabric SQLite storage, not a new encryption
  layer. Device/disk encryption is not verified by these unit tests.
- No authenticated human approval, GUI save action, automatic Blueprint promotion,
  chat sync, cloud network request, server deployment, model warm-up or autonomous agent.
- Source/actor metadata and model-generated claims are unverified until later gates.

## Verification

Focused Rust tests cover isolated project scopes, idempotency, stale predecessor
conflicts, malformed inputs, persistence through re-index, and v1-to-v2 migration.
Run `cargo test --manifest-path src-tauri/Cargo.toml --lib journal_`.
Also run the complete Rust/Node suites, typecheck, build, format and GitHub CI.
The GitHub fast gate presently checks Node/Linux/Windows but **does not compile Rust**,
so a native macOS Rust test is additional evidence rather than replaced by CI.

## Next steps

1. Review migration and database-lock edge cases; add independent Rust CI Windows/macOS.
2. Native registry-scoped API for **explicit** journal append with owner-session checks.
3. UI approve/reject proposals; do not infer authorization from imported JSON.
4. Integrate the Blueprint candidate workflow into Fabric with source provenance.
5. Safe offline context deltas and local Gemma chat, followed by mesh reconciliation.
6. Signed installers and unified UI/UX review; no production deploy before gates.

Operational rule: no paid cloud workers or warmed models are started by this implementation.
Infrastructure spend controls are internal development policy, not an end-user KatoSync screen.
