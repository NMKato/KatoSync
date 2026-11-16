# Stage4AD – Persistent read-only job reservation (private QA)

Date: 16 November 2026. Developer: NMKato Solutions. Repository: NMKato/KatoSync.

## Baseline

Stage4AA PR #268 passed real two-site M2/M3 pinned TLS 1.3 one-shot tests. Stage4AB.1 #270 is the sole native fail-closed session lease. Stage4AB.2 #273 passed real pinned TLS loopback heartbeat tests, but no durable installed link. Stage4AC #275 provides narrowly signed owner, tenant, session, client, device and project-scoped read-only Git job candidates. Its first native CI exposed an ordering mismatch in a malformed-permit negative test, corrected in fdcc53a; a new native CI is running.

A volatile replay set alone does not stop the same task being admitted after process restart. This Stage4AD QA adds local crash-sticky task reservations, not an executor.

## Implementation

New private module: src-tauri/src/mesh_durable_lease_qa/signed_job_qa/journal_qa.rs, a child of Stage4AC and compiled only under the stage4j-qa feature. It has no live runtime caller, Tauri IPC, MCP tool, network listener, background agent, OS command or production grant.

- Trusted local agent config must supply an already existing canonical owner-private journal directory. Reject symlinks, non-directory paths and Unix mode bits accessible by group/others. Never accept an arbitrary journal path from a model, chat or remote request.
- Input must be a non-executing Stage4AC candidate with matching typed task ID, action and output limit. It never creates execution authority.
- Exclusively reserve two names under the private root: one for fixed-size hexadecimal task ID and one for hexadecimal nonce. Both use atomic create_new, 0600 file permissions, bounded SHA-256 metadata and fsync of file and parent directory.
- A crash or failed second write leaves the first task marker present and permanently blocks automatic replay until independent owner review; no cleanup silently unlocks it.
- Concurrent proposals on one local host cannot both reserve the same task marker. Reused task IDs and nonces are blocked across process reopen.
- No source content, access credentials, user email, private keys, host IP, shell output or remotely provided paths appear in journal metadata.

## Explicit non-claims

- This is a local reservation journal only, NOT an atomic server-wide replay ledger, cross-device consensus, completed-job receipt or proof of any remote action.
- A signed completed result, source HEAD verification, per-device state reconciliation, transactionally recorded revocation, physical agent execution and owner visible job lifecycle remain future components.
- Existing Stage4L local-only runner does not accept remote grants; no shortcut to OS privileges was introduced.

## Verification

Node static-contract suite checks the isolation, secure filesystem primitives, no OS execution and dedicated macOS no-deploy workflow. Native Rust unit suite exercises actual private temporary directories, reopen/replay denial, concurrent exclusive reservation, partial marker poisoning, malformed candidate and unsafe permissions/symlink rejection.

## Next release gates

1. Complete exact-head native macOS CI and security review.
2. Implement server-owned RC66 issuer, session and owner step-up, tenant/client/device/project grant and revocation; use persistent global idempotency before any remote job.
3. Connect a native persistent Keychain-pinned TLS supervisor, actual signed task envelope and a separate trusted executor adapter that retains Stage4L canonical registered-root/expected-HEAD checks.
4. Sign and durably store a bounded real result receipt; compare device key, task ID, source HEAD, result digest, timestamps and current owner/grant.
5. Two-site signed and notarized M3-to-M2 QA including accepted read-only Git HEAD and negative owner, replay, revoked, wrong repo, expired, offline and reconnect tests. Windows parity follows.
6. Only after successful independent release gates may ChatGPT KatoSync MCP expose device read-only tools. Full terminal/file/GUI rights require separate owner permission.

Release: Draft QA, no production Cloudflare/Supabase change, no device grants or real Mesh execution.

References:
https://github.com/NMKato/KatoSync/pull/268
https://github.com/NMKato/KatoSync/pull/270
https://github.com/NMKato/KatoSync/pull/273
https://github.com/NMKato/KatoSync/pull/275
https://github.com/NMKato/KatoSync/issues/241
