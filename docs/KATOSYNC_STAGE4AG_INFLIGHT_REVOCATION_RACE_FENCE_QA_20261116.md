# Stage4AG — Local in-flight revocation race fence (native source-linked QA)

Date: 16 November 2026. Developer: NMKato Solutions. Base: [Stage4AF Draft #280](https://github.com/NMKato/KatoSync/pull/280).

## Scope

Stage4AF rechecks a signed permit, canonical Mesh lease, server-grant snapshot, owner MFA and registered Git root immediately before a **test-only** Git HEAD read. It does not, by itself, protect the time between recheck, command, and persistent receipt.

Stage4AG adds a **synthetic process-local revocation epoch** within the same isolated `stage4j-qa` Rust module. A monotonic, sticky local revoke changes the generation. The test-created Git reader creates the OS child **under a local mutex that serializes spawning with revocation**, then checks the same generation again **under a mutex held through device-signature verification and durable Stage4AD result-journal commit**. No stale result receipt can be committed after a locally observed revoke wins the lock.

Deterministic native test hooks inject revocation (1) after Stage4AF succeeds but before the fixed Git command starts, and (2) after the temporary Git read but before any device-signed receipt can be persisted. A third test verifies sticky revocation and refusal of a stale generation. All denied cases leave only the pre-existing two journal reservation records.

## Crucial limits — production NO-GO

- This gate is **only in Rust tests**, with synthetic grant/MFA inputs. No new Tauri IPC, MCP method, socket, process executor, device privilege or production capability is introduced.
- It does **not** deliver real RC66K server revocation events, obtain live GoTrue MFA, use pinned Keychain signing identities, cancel a live child, or establish an atomic distributed lease with the owner authority.
- A remote revoke may still occur between a local check and OS command launch. The local commit lock defines only a local ordering, **not** a trustworthy cross-device or server-authorized execution fence.
- A real execution path must acquire an owner- and project-scoped server lease, keep an actively revocable transport/supervisor, cancel child processes on lease loss, and obtain an independent final server-side consent verdict before delivering any result.

Verification is limited to `cargo test --offline --locked --manifest-path tests/native/stage4af/Cargo.toml`, the Stage4AF/AG source contracts, `rustfmt`, and `git diff --check`. No production or billing-impacting GitHub Actions triggered by local work. Keep Draft / NO-GO.
