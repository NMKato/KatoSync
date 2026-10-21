# KatoSync System Resource Monitor & Kato AI Memory Advisor

Date: 2026-10-21
Status: Stacked DRAFT branch based on Project MCP/CLI Draft PR #71. No release or production mutation.

## User story
On opening KatoSync Desktop, check CPU and available RAM and show a non-blocking warning when the preferred local Gemma/Q4 model has poor projected headroom. Display a compact CPU, RAM, GPU, and Kato AI status card on Agent Sync > Dashboard, refreshed conservatively. Notify if known third-party local LLM processes are present but **NEVER stop them automatically**.

## Implemented
- Native read-only Tauri command `system_resource_snapshot` in `src-tauri/src/system_resources.rs` via sysinfo 0.39.6.
- Available RAM and total RAM are **actual host measurements** (not simply total installed physical RAM). CPU usage is sampled across at least 200 ms. Known process names (Ollama, LM Studio, Jan, KoboldCpp, llama.cpp) are aggregated by **name + number of instances + reported RAM**, excluding the owned Kato AI server PID. Full process command lines, other users' process paths and PIDs are not exposed.
- On macOS, a bounded one-time `system_profiler SPDisplaysDataType -json` probe identifies GPU name; Apple Silicon GPU memory is clearly marked as **unified**, not double-counted as dedicated VRAM. Metal backend is identified as supported on Apple Silicon, not claimed verified for the individual installed model.
- On Windows/Linux when the supported official NVIDIA CLI is present, `nvidia-smi` provides real GPU utilization plus dedicated VRAM; a candidate CUDA device is shown, but no CUDA runtime support is *assumed*. On Windows without NVIDIA, bounded read-only WMI provides a GPU name if available. Unknown metrics always remain null/"not available"; no invented percentages, GPU memory or GPU allocation.
- Guidance uses a **conservative configurable-in-code heuristic** for the current Gemma E4B Q4 (7 GiB model+context budget + 2 GiB OS reserve, hence 9 GiB free as comfortable heuristic). This is NOT an actual model peak-memory benchmark. Model source currently has a ~4.59 GB GGUF package and min 12 GB / preferred 16 GB *total* RAM; these are not synonymous with 9 GiB *available* RAM at every moment.
- React hook gathers a snapshot at app launch and refreshes about every 12 seconds; it does not block app navigation. On warning state, a dismissible notice appears inside the app. Agent Sync Dashboard adds compact CPU/RAM/GPU cards with actual measured percentages (or "—"), Kato AI running/installed/not-installed state, a memory-headroom explanation and any detected known local-model processes.
- There is **no kill button and no automatic process termination**. Resource warning does not block the user's work or manually-started Local Brain.
- Existing Kato Local Brain service is **not restarted or reconfigured**. Apple runtime already requests GPU offload through llama.cpp (`-ngl 99`) but it must be checked at actual runtime; the Windows package in the current Local Brain manifest is CPU-only and can't activate CUDA merely because a discrete GPU was detected.

## Additional smart follow-ups
1. Before **automatic** prewarm, enforce the real RAM/thermal/battery pressure gate with a model-profile-specific estimate and post-start measured memory, allow CPU fallback when GPU backend is unsupported. Keep manual opt-in and no foreign process kills.
2. Verify Metal/CUDA/Vulkan availability against the actually packaged llama.cpp runtime and model before selecting GPU; do not confuse NVIDIA telemetry with CUDA model acceleration. Prefer dedicated VRAM only when the runtime+driver combination is verified, and separately budget system RAM.
3. Add support for Apple memory pressure, Windows dedicated GPU engine counters and AMD/Intel GPU telemetry via verified platform APIs. Do not imitate utilization from CPU percentages.
4. Cross-platform packaged installer smoke tests on representative hardware: Apple Silicon 8/16/32 GB, macOS Intel, Windows with/without dedicated NVIDIA GPU, low-memory machines. Test simultaneous Ollama + Kato local brain under pressure.
5. Future non-destructive quick actions: open system task manager and user-guided shutdown of OWNED runtime only. Never terminate a third-party process without an explicit user action and safe identity verification.
6. Provide battery/thermal/load trend/sleep-resume checks and memory reserve per actual selected Gemma quantization/context size. Stronger GPU memory heuristic can materially reduce CPU RAM consumption, but only after runtime compatibility verification.

## Verification
- `npm test`: 163/163 PASS.
- `npm run typecheck` and `npm run build`: PASS, with pre-existing Vite large bundle warning.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 115 PASS, 3 intentionally ignored. Includes CPU/RAM classification, known-process identification, NVIDIA telemetry input validation and an actual read-only host RAM sample.
- `cargo fmt --check` and `git diff --check`: PASS.
- Current Rust test worktree contains ignored local placeholder directories for absent Poppler/Typst bundle resources. They are NOT part of this PR and are NOT a shippable binary resource set.
- No packaged desktop GUI/manual hardware telemetry smoke test, independent review, merge, release, provider changes or auto-warm actions are included.

Created by NMKato Solutions
