# RC151 integration candidate – KatoSync 4.0 + Mesh onto current main

**2026-11-08: PRIVATE QA CANDIDATE, NOT RELEASE APPROVED. DO NOT MERGE OR DEPLOY.**

This branch merges current main (including Remote Commander Usage RC11/12
and the 151-PR audit) with the latest KatoSync 4.0 Gate-9 draft
d0d15b97c1eb07e44ee2b6b2e6b0e4428c5f7f60.

Source PR #240 explicitly requires an independent signed reviewer attestation
and forbids merging/releasing as 4.0 Beta without it. Those requirements remain.

## Five conflicts resolved manually
- src/App.tsx: preserve both RemoteCommanderUsagePanel and all 4.0 workspace imports.
- src/styles.css: preserve the Remote Commander panel and 4.0 workspace styles.
- tsconfig.json: preserve semantically identical latest main settings.
- .github/workflows/pr-fast-gate.yml: retain stricter 4.0 broad PR,
  security, npm audit, native formatting and Windows gates.
- AGENTS.md: retain attribution plus added security rules.

The initial complete Node test showed 729 pass/1 fail due to a two-second
child-process startup deadline under parallel load. Isolated denied-start
security tests passed 3/3. A bounded 10-second deadline now retains the
required MESH_E2E_BLOCKED denial assertion without false timeout failures.
Full rerun: **730/730 Node**, **16/16 Remote Usage**, and TypeScript/Vite
1,910-module build all PASS (arm64 isolated QA, Node 22).

## Still blocked for main
- Independent Gate9 reviewer signature, owner authorization and native receipt.
- Security/RLS audit of all 15 Supabase migration SQL files, including installed
  versus proposed and QA-only. NO migration was applied.
- Native signed M2/M3 Mesh hardware, revocation and cross-account smoke tests.
- Final macOS/Windows/KatoOS OAuth login, UI and permission acceptance.
- GitHub PR Fast Gate, Windows CI, native Rust formatting and npm audit must
  pass on this exact integration candidate commit.
- Independent branches (#88 security, #223 SAS fix and some dev-root PRs)
  must be reconciled separately, not silently assumed merged.
- No terminal/device access, Remote MCP activation or production deployment.

The new integration branch is for **review and tests only**. It does not
authorize a 4.0 release. The original working directory is unchanged.
Details: docs/PR-BACKLOG-INTEGRATION-AUDIT-2026-11-08.md.
