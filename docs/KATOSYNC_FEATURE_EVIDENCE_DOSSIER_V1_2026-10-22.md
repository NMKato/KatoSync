# KatoSync Continuity — Feature ↔ Evidence Dossier v1

Date: 2026-10-22. Isolated development step **stacked on Draft PR #99**.
No change to installed KatoSync or live projects. No cloud workers, model startup or provider calls.

## User story

Open the project-specific Blueprint Feature Index. Click **Review feature evidence**
for one indexed decision or milestone. A read-only dossier connects all versions
under the stable feature ID, including associated milestones with the SAME exact ID.

Example: decision:ADR-10 and milestone:ADR-10 share feature ID ADR-10.
An unrelated name like "phone assistant" is NOT silently merged with ADR-10.
No cross-project lookups, untrusted paths or automatic imports.

## Actual verified capabilities

- Bounded lookup of up to 20 matching Blueprint decisions and structured milestone
  versions from existing SQLite schema v4 via exact composite feature section keys.
  Every version preserves the original project, journal sequence, Git baseline,
  original excerpt and imported evidence claims.
- Native Tauri feature trace command uses persisted Project Registry to determine
  actual project root, checks current Git HEAD and Memory Fabric root fingerprint,
  and independently probes live source hashes.
- Bounded evidence claims up to 20; only FULL literal 40/64 hex SHAs of kind
  git_commit undergo read-only Git checks against the registered local repo.
  They can establish "commit not present", "present but not in current HEAD
  history", or "present and ancestor of HEAD". Unrecognized refs remain UNVERIFIED.
  No network fetch, no checkout, no Git write and no arbitrary command arguments.
- Separately searches the existing FTS5 Memory Fabric for at most 6 matching
  project sources whose truth level is verified/canonical AND whose live
  content is fresh or unchanged despite moving HEAD.
  Textual similarity is explicitly a *candidate linkage*, never a proof of
  implementation, automated owner approval or a passing integration test.
- UI displays both claim lineage and candidate sources under the project-tagged
  Blueprint Search card. The dossier remains user-triggered and read-only.
  DE/EN/ES/RU labels, existing glass-card design.

## Trust contract

The overall feature status is ALWAYS:
unknown_requires_feature_specific_tests_and_owner_review.

- Existing local Git commit ancestry proves source repository *history only*.
- Existing local source file hashes prove the exact source bytes have not
  changed since index, not that they satisfy feature requirements.
- An imported milestone saying "completed" is still UNVERIFIED.
- A source Git baseline matching current HEAD is not a test result.
- GitHub Actions results or PR statuses are NOT fetched or inferred at this stage.
- Imported evidence strings never grant shell, code-write, agent invocation,
  canonical promotion or cloud-worker permissions.

## Offline and operational considerations

All lookups are on-demand, no cloud provider involved. The exact project ID,
stable feature key and current Git HEAD are rechecked on each native request.
Explicit file/commit provenance is kept apart from candidate matches.
No second SQLite store, new daemon, scheduled worker or cost-control UI.

## Tests

MacOS local Rust suite including:
- Two Blueprint revisions plus milestone with shared stable feature ID.
- A different project's records excluded even if the name matches.
- Verified FTS source candidates and changed/stale hash exclusion.
- Git object/ancestry test in a temporary local repository.
- Reject malformed/SQL operator feature IDs and unknown keys.

Full Rust / Node / TypeScript / Vite / formatting checks and GitHub Linux +
Windows Node CI + Attribution required. The existing GitHub fast gate does
NOT compile Rust. Windows native packaged GUI smoke still a release gate.

## Next development gates

1. Explicit test/CI evidence record by stable feature ID, grounded from actual
   GitHub workflow run checks and reproducible local test results (no inference
   from screenshots, note texts, or commit presence alone).
2. Owner-reviewed milestone status transitions with audit trail and scoped
   conflict handling, never auto-promote imported states.
3. Feature-specific QA matrix, project Queue linkage, deletion/export,
   offline multi-device sync and explicit device writer leasing (Issue #76).
4. Full UI/UX consistency review, signed Windows/macOS beta release tests.
