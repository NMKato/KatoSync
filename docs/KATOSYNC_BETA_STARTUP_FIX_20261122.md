# Beta startup: Keychain wait and recoverable loading

## Verified cause of #284

A native sample of the blank macOS QA window captured 1,313 main-thread samples waiting inside the same call chain:

`WebKit URLSchemeTask → Tauri IPC → command scope guard → command handler → load_supabase_refresh_token → keyring::Entry::get_password → SecKeychainFindGenericPassword → SecurityServer decrypt → mach_msg`

`supabase_session_status` was a synchronous Tauri command. macOS could wait for an explicit Keychain access decision while the native event loop was blocked. This explains why HTML was present, painting/interaction stalled, and the very same process subsequently rendered after the access decision. The prior CSP/cache/JavaScript-execution hypothesis was not established; do not weaken CSP or delete user storage as a workaround.

## Change

- Make only the startup session preflight asynchronous, running the blocking OS credential read in `spawn_blocking`.
- Preserve the existing requirement for both the saved account marker and credential; no grant, pairing, MFA, license acceptance or credential migration is added.
- Preserve credential zeroization and return a fixed public error for worker failure.
- Keep startup visibly responsive while waiting for an OS decision.
- Show a readable startup error and keyboard-operable Retry when a read fails. A slow-start hint appears after eight seconds.
- Deduplicate startup and disable Retry until all original reads have settled, including an outstanding OS prompt after another read failed.
- Use theme-aware text/background and a minimum 44px Retry button.

## Verification

- TypeScript and Vite production build: PASS.
- Built React application with synthetic native IPC, network restricted to its local fixture server: PASS for both cases:
  1. A config read fails while session preflight is still pending. Error is visible, Retry remains disabled, then keyboard Retry reaches the signed-out login after the first preflight settles. Exactly one credential preflight per attempt.
  2. A pending preflight leaves the loading screen responsive, displays the delayed OS-decision hint, and proceeds when the synthetic decision returns.
- Reproduce browser checks: `npm run build` then `node --experimental-strip-types scripts/qa-startup-recovery-20261122.mjs`. Set `KATOSYNC_CHROMIUM_PATH` if Chrome is elsewhere.
- Rust tests in `startup_blocking::tests` exercise actual async caller liveness while the blocking worker waits, preserve a false preflight result, and redact worker-failure details. Run with `cargo test --lib --features ux4-mesh-qa startup_blocking::tests`.
- The native candidate must still be checked after rebuilding: first paint, OS prompt wait/decline, successful saved-session continuation, readable terms, native buttons, and restart. Source/browser checks alone do not close that acceptance gate.

No diagnostic screenshots, machine paths, raw samples, credentials or personal account data are included in this document.
