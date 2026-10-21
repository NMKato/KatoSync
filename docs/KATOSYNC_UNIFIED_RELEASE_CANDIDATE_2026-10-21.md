# KatoSync — Unified Project Work Hub + Kato AI GPU Preview

Date: 21 October 2026. **Integration CI candidate** on canonical dev; not a merge approval or production installer.

## Goal
Validate the entire functional stack together using the dev-target GitHub PR Fast Gate, since individually stacked feature PRs did not trigger that workflow.

Included underlying changes, preserved in the full Git ancestry:
- PR #69: Project Registry + Project Work Resume + KUAS shared rules and native Codex/Claude policy runner.
- PR #70: non-destructive, explicit local project creation (scaffold and first Git commit, NOT a fully generated iOS/Android app).
- PR #71: read-only local MCP/CLI Project Registry context bridge with per-project allowlist.
- PR #72: CPU/RAM/GPU live resource card and nonblocking RAM advisory.
- PR #73: runtime-verified Metal/CUDA device enumeration, memory-safe CPU fallback, macOS device-wide IOAccelerator utilization and macOS GPU Test build QA.
- PR #74: corrective Kato AI already-running headroom UX + managed llama.cpp process classification across app restarts.

## Checked locally
- Real running KatoSync GPU Test UI: CPU 19%, RAM 48%, GPU 60% OS-wide, Kato AI running Metal. Kato AI /health is OK.
- macOS Device IOAccelerator GPU counters sampled during synthetic local Gemma request. Device GPU utilization correlated with inference load but not attributable uniquely to model layers. Prior short synthetic text completion produced TEST_OK.
- PR #74 source tests: 165 Node PASS, 119 Rust library PASS (3 ignored), TypeScript/Vite build/Rustfmt PASS.
- Rust worktree tests require ignored test-only Poppler/Typst placeholder directories due to missing distribution binaries; not packaged for public release.

## Must NOT be inferred
- A dev-target full GitHub green CI result is necessary for code-level integration, but still NOT sufficient for production.
- Native Codex/Claude runner's older checkout/branch writer has not yet been proven to enforce isolated worktrees and a distributed one-writer lease. Unattended code writes remain restricted.
- Model installer on Windows remains CPU-only in the current package. Windows 16 GB Intel UHD had only ~4–5 GiB free RAM in earlier read-only smoke. No Windows packaged app/smoke passed.
- macOS GPU Test app is ad-hoc signed, omits Poppler/Typst assets, not notarized, and cannot be published as the general release.
- Guest/provider-specific cloud credentials, licenses, full private memories and source documents are not automatically consented for transfer. The official MCP bridge remains read-only.
- KatoSync live Project Supervisor/Remote Orchestrator appeared stale in GUI; that is not fixed by this integration preview.

## Merge/release gates
1. Complete independent code/security review of this combined 52+ file change, especially native codewriters, allowed paths, auth and provenance.
2. Ensure full dev-target GitHub PR Fast Gate and Attribution Policy PASS, with TypeScript/Rust/Tauri tests as required by workflows.
3. Rebase or reconcile other concurrent security worktrees/PRs without overwriting them.
4. Coordinate API/client contract change (KUAS version mandatory in native runner) across desktop app upgrade.
5. Bundle REAL Poppler/Typst native resources, sign/notarize macOS release, and verify Windows signed/unsigned staging package separately.
6. Complete the true end-to-end project handoff and protected agent work/checkpoint lifecycle before unattended operation.
7. No merge to main, auto-update or production THEORG writes until all relevant safety gates are satisfied.

This PR serves solely as a consolidated **CI and review target**; it does not supersede the owners' active feature PRs without an explicit merge plan.

Created by NMKato Solutions
