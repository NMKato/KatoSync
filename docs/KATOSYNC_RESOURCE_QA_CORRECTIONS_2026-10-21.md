# KatoSync resource dashboard — real-device UX acceptance fixes

Date: 21 October 2026. Stacked review patch dependent on PR #73; does not modify the installed production app.

## Real UI evidence
- User granted the GPU Test app's macOS Keychain access locally.
- Live native Agent Sync Overview GUI showed CPU 19%, RAM 48%, 8.3 GiB available of 16.0 GiB, GPU 60% and runtime-verified Metal device. This is actual total Apple device GPU load; not llama.cpp-specific telemetry.
- Kato AI was already running and local /health reported OK. Existing provider/orchestrator work must not be interrupted.
- Two user-facing false positives were found: (1) an already-running managed llama-server from a prior KatoSync app session was labeled as a foreign llama.cpp model; (2) an already loaded Kato AI displayed an additional 9 GiB startup budget warning even though it needed no second model load.

## Fixes
- sysinfo local process discovery now excludes managed Kato runtime binaries by **canonical executable path beneath the currently pinned local-brain runtime directory**, not by executable name alone. It still recognizes and reports other users' Ollama, LM Studio and unrelated llama.cpp processes. No new process control, command-line exposure, remote calls or filesystem writes in this check.
- Dashboard + startup advisory now distinguish an already-loaded model from a new prewarm request. For a running model with caution-level available RAM, no fake new-load warning is shown; with critically low available RAM, a general host memory-pressure warning remains. Without the model running, conservative 7 GiB+2 GiB new-start budget remains active.
- When OS process-memory accounting gives zero/unavailable, show 'RAM nicht messbar' instead of implying zero memory consumption.
- Functional tests verify path-based managed executable inclusion/exclusion across app restarts and safe memory warning behavior for running vs stopped model.

## Verification
- npm ci, 165/165 Node tests PASS.
- npm run typecheck, npm run build PASS (existing chunk-size warning).
- 119 Rust library tests PASS, 3 intentionally ignored.
- cargo fmt --check and git diff --check PASS. Rust test worktree uses ignored test-only Poppler/Typst placeholders; no distributable package has been created by this patch.
- Manual GUI confirmed the **previous** test build and exposed its defects. Corrected UI is source/test verified but requires another packaged app smoke before claiming current deployed GUI contains the fixes.

## Release gates
- Parent PR chain #69 -> #70 -> #71 -> #72 -> #73 must be independently reviewed and validated with real native packaged resources.
- Current 'GPU Test.app' remains unmodified by this branch; its source-level fixes are available here only until a deliberate follow-up test build.
- The user's local Gemma server and third-party LLM processes were not stopped.
- Remote Orchestrator and project Supervisor 'stale' health statuses are separate operational problems and need their own investigation; this resource fix does not silently reset them.
- Do not automatically merge, update installed production binaries, restart models or trigger unattended project-code changes.

Created by NMKato Solutions
