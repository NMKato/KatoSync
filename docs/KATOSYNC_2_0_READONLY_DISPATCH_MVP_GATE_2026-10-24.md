# KatoSync 2.0 — single-job read-only dispatch MVP gate (2026-10-24)

## Implementation
- Dedicated native Tauri commands: `readonly_dispatch_probe` and `readonly_probe_history`.
- Agent Sync → Jobs & Queue offers registered local project, Codex or Claude, explicit operator click and local job receipts.
- Native KatoSync Supabase verified UUID scopes job-history access by account. Native Registry maps project ID to a unique canonical git root, not an arbitrary supplied path.
- Only branch, SHA and clean/dirty metadata enter the agent prompt; no source content, filesystem path or GitHub/Supabase tokens.
- Codex uses ephemeral read-only sandbox from neutral folder, Claude plan mode with no tools/MCP and no session persistence. No shell interpolation or connector mode.
- Git snapshot before and after uses no optional locks; no checkout, fetch, staging, commit, push or source modifications in this separate path.
- Atomic one-job guard, 95s timeout, strict three-line reply parser; durable per-account job receipt with trace ID, provider, machine, elapsed time, status, exit code and before/after Git proof.
- Previous writable run_codex_task still exists and is NOT approved for unattended writes: safety issue #76 is open.

## Verified and remaining
- Previous independently verified direct Codex CLI test on 2026-10-24 used disposable git clone, finished exit 0 in 9.2s, no Git change. This was NOT a KatoSync queue dispatch.
- New Rust tests cover result parsing, allowed providers, Git fixture clean/dirty and nested root rejection. Frontend tests enforce read-only/one-job service and UI.
- Native selected-project dispatch and account switch/logout behavior still require interactive app QA.
- KatoSync website SSO issuer differs from KatoOS website issuer (issue #114); do not silently join users.
- Preview package includes test-only Poppler/Typst placeholders; public macOS signing/notarization and Windows packaging are not yet cleared.
- GitHub stacked draft PRs await full CI and controlled merge, and mesh/writer gates await independent QA.

## Release order
1. Verify exactly one native KatoSync Codex diagnostic, persisted receipt and source Git unchanged.
2. Verify Claude in same controlled mode and failed/cancelled login, then per-account history.
3. Finalize native packages and account federation explicitly. Only then candidate 2.0 stable.
4. Read-only M2/M3 mesh health and job receipts, followed by safe writer leases and approvals (#76) before any parallel writes.
