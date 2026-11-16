# Stage4AF – Native Git HEAD execution-time fence (source-only QA)

Date: 16 November 2026. Developer: NMKato Solutions. Product: KatoSync.

## Problem

The owner needs tablet/ChatGPT → Remote MCP → signed M3/M2 Mesh → a registered read-only Git HEAD task → a signed, durable receipt. Existing Stage4AA/AB2 proves pinned TLS and synthetic in-channel heartbeats; Stage4AC signs read-only task candidates; Stage4AD holds a persistent replay journal; Stage4AE signs exact bounded local Git HEAD results. None of these, alone, constitutes a live owner-authorized Remote MCP job.

## New integration in this Draft

Native file: src-tauri/src/mesh_durable_lease_qa/signed_job_qa/execution_fence_qa.rs.

The execution-time QA check refuses an earlier admitted job unless:
1. The single canonical Mesh lease still reports a live peer and actual verified heartbeat.
2. The original, domain-separated Ed25519 task signature is verified again using the pinned issuer, with matching Owner, local/remote device keys, task ID, GitHead action and expiry.
3. A second, independent, current server-grant and MFA/Owner/tenant/session/client/project/device recheck matches the original signed permit, confirms no pending revocation and is no more than 2 seconds old.
4. A trusted native registry root and project ID exactly match the signed permit. Missing, noncanonical and symlink roots are denied.
5. The only Git command lives inside #[cfg(test)] and requires a test-only marker in an isolated temporary Git repository. It invokes the exact git binary with separated arguments rev-parse and HEAD, never a shell or arbitrary caller command.
6. Exact current Git HEAD must equal signed expected HEAD. Stage4AE signs, independently verifies and persists the bounded device receipt with Stage4AD journal. A duplicate terminal record is rejected after reopen.

The existing Stage4L production source=local project-registry boundary stays unchanged. Stage4AE helper functions have only sibling-private QA visibility, not public IPC/API export.

## Scope and tests

Eight native Rust tests cover: actual fixed read-only Git HEAD in a temporary repository and durable device receipt, subsequent duplicate denial, post-admission Owner/Client/Device/MFA/revoke denial, expired or closed Mesh lease, changed signed Owner/tenant/session/client/project/device/issuer, stale current authority, unknown or symlink registry root, changed HEAD, missing QA marker and stale fence.

Six Node contract tests assert that the runtime portion has no process execution, socket or public Tauri command, and that the fixed command remains inside Rust test configuration only.

**Important limits:** The recheck is not yet an execution-atomic revoke fence. Even a very fresh server-grant snapshot may change between verification and command start. Production needs a revocation-aware, cancellable execution lease and final server-side consent check before accepting results; a test boolean cannot be taken from ChatGPT request inputs. There is no live OAuth-bound GoTrue MFA integration, Keychain private device signer, always-on supervisor, cross-site KatoSync signed Mesh job, or enabled Remote MCP device tool in this change.

Release: DRAFT / SOURCE-ONLY / NO-GO for productive OS/device access or remote execution. No production Supabase, Cloudflare, GitHub billing or machine permission changes.

References:
https://github.com/NMKato/KatoSync/pull/275
https://github.com/NMKato/KatoSync/pull/276
https://github.com/NMKato/KatoSync/pull/277
https://github.com/NMKato/KatoSync/issues/224
https://github.com/NMKato/KatoSync/issues/241
https://github.com/NMKato/KatoSync-Remote-MCP/pull/52
