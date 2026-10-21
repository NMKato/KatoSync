# KatoSync Local Brain — runtime-verified GPU backend selection

Date: 21 October 2026. Status: stacked DRAFT on PR #72 (System Resource Monitor). No production release or automatic model start.

## Runtime-owned capability evidence

KatoSync queries the binary from its already installed, manifest-pinned llama.cpp runtime folder, NOT just the hardware vendor name from system_profiler, WMI, nvidia-smi, or a user prompt.

Before a user-triggered Local Brain start:
1. Identify the managed runtime binary through the existing package manifest and scoped runtime directory.
2. Invoke that binary with fixed argument --list-devices (no model weights, shell expansion, code execution or network). Capture at most 8 KiB stdout, bound to five seconds, kill it on timeout.
3. Parse only recognized llama.cpp device identifiers: Apple MTL0 on macOS; CUDA0 and VK/Vulkan devices on Windows/Linux. BLAS/CPU and platform-incompatible identifiers never authorize GPU offload.
4. Require reported FREE GPU-address-space to meet the conservative model+runtime+context estimate of 7 GiB (7168 MiB). If missing or lower, choose CPU.
5. A compatible, adequately provisioned device selects -ngl 99; otherwise explicitly -ngl 0. Windows CPU-only bundled runtime cannot become CUDA-capable solely through NVIDIA hardware.
6. Dashboard displays selected backend, runtime status, device-enumeration result and reported free GPU-address-space, with inferenceVerified=false because GPU enumeration is NOT proof of successful Gemma inference.
7. Cache display-only enumeration up to 60 seconds to avoid costly 12-second polling. Actual manual start ALWAYS probes afresh.

Kato AI start still requires an explicit user action. No foreign LLM process is killed, no automatic model prewarming is enabled, and no model preference is persisted from inferred hardware facts.

## Read-only physical hardware checks (21 October 2026)

**Authorized Apple M2 Pro Mac, 16 GB unified RAM:**
- The actual installed Kato llama-server --list-devices succeeded (exit code 0), listing MTL0: Apple M2 Pro (12124 MiB, 12123 MiB free) alongside BLAS/Accelerate.
- The selected Metal device clears the conservative 7168 MiB budget. Apple shared/unified GPU memory is NOT a separate 12 GB VRAM chip.
- No actual Gemma token inference, peak-memory benchmark, model launch, or signed desktop GUI smoke was executed. inferenceVerified=false remains correct.
- macOS GPU metadata probe now supports system_profiler _name fallback when sppci_model is absent.

**Authorized Windows 11 Home laptop:**
- Physical RAM approximately 16 GB, free RAM varied from about 4.2 GiB to 5.0 GiB across two read-only samples.
- Intel UHD Graphics detected; nvidia-smi.exe was absent and the pinned Kato llama-server.exe was not found in its expected AppData runtime folder.
- No CUDA-capable Kato runtime or successful GPU inference can be claimed. This device illustrates why total RAM is not available RAM.
- Windows packaged GUI smoke and a real CUDA-equipped Windows test remain outstanding.

## Verification and constraints

- npm test: 164/164 PASS.
- npm run typecheck and npm run build: PASS; existing Vite chunk-size warning only.
- cargo test --manifest-path src-tauri/Cargo.toml --lib: 117 PASS, three intentionally ignored; includes pure backend-selection tests for real-style Metal/CUDA device strings, low-memory fallback and platform isolation.
- cargo fmt --check and git diff --check: PASS.
- Only locally ignored placeholder folders for absent Poppler/Typst bundling assets are used in this Rust test worktree, not release artifacts.

## Follow-up gates

1. Signed macOS and Windows GUI smoke with real Poppler/Typst resources and actual installed runtime packages.
2. User-approved post-load model inference smoke and effective GPU layer/offload evidence, without leaking model prompts or customer content.
3. Calibrate quantization/context budgets to real memory pressure, GPU allocations and peak RSS; 7 GiB is a conservative estimate, not a guarantee.
4. Verify and package appropriate signed CUDA/Vulkan backends for Windows before offering accelerated Windows Kato AI; Intel UHD cannot use CUDA.
5. Adaptive automatic warm-up ONLY after explicit owner opt-in and battery/thermal/memory/sleep-resume gates, with a post-start watchdog; never auto-stop third-party models.
6. Consider smaller context or verified partial GPU offload only after tests. Current low-device-memory policy deliberately selects CPU fallback.

Created by NMKato Solutions
