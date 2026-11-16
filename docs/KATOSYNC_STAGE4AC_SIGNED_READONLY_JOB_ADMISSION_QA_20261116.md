# Stage4AC – Signed read-only task candidate on canonical Mesh lease (QA)

Date: 16 November 2026. Developer: **NMKato Solutions**. Product: KatoSync. Repository: NMKato/KatoSync.

## Baseline verified

The owner wants to control workstations from a tablet through ChatGPT MCP, with authorized native KatoSync agents executing tasks on M2/M3/Windows.

- Stage4AA PR #268: physical two-site bidirectional pinned Ed25519 TLS 1.3 one-shot between real M2/M3; connections were closed and no jobs were enabled.
- Stage4AB.1 PR #270: **only canonical** native fail-closed in-memory Mesh lease/state machine; no live runtime producer.
- Stage4AB.2 PR #273: actual pinned TLS loopback application heartbeats proven by native macOS CI 43832317147 after correction, but not a durable installed service.
- Stage4AB PR #271: independent typed read-only job candidate with a *simulated* session model. This Stage4AC change implements its security constraints on the **canonical Stage4AB.1 live lease**, not a duplicate heartbeat authority.
- Stage4L native local Git executor is explicitly local-only; it rejects remote provider scopes. Stage4AC does not weaken that protection.

## New QA-only code

Native source: src-tauri/src/mesh_durable_lease_qa/signed_job_qa.rs. Compiled only under stage4j-qa; no native IPC, CLI, MCP endpoint, network listener, OS command or production executor.

- Only GitHead and GitStatusShort typed read-only task proposals. There is no arbitrary shell or file path.
- Signed Ed25519 task payload with domain separation binds exactly: owner, tenant, owner session, OAuth client, local and remote pinned device public keys, project, task ID, nonce, expected Git commit HEAD, action, issue time, expiry and owner step-up time.
- The issuer public key must come from a trusted pinned server-side grant-signing configuration. Do NOT accept an issuer key supplied by ChatGPT or by the untrusted task.
- The canonical Mesh lease must be live at the moment of proposal, have seen a verified heartbeat, and be bound to the exact same owner/local/peer device keys. Independent current server authority recheck also binds exact tenant, Owner session, client and project.
- An additional independently rechecked current server authority for owner session and client/device/project grant must be fresher than five seconds, and a signed permit expires within twenty seconds; issuance can be at most thirty seconds old. A recent owner step-up must have been verified upstream.
- An in-memory replay ledger rejects repeated task IDs and nonces and is bounded to 128 entries. **This is not durable or exactly-once protection**. Actual execution requires an atomic, persisted cross-reboot task journal, revocation state and a native executor-side recheck.
- Every result is a non-executing candidate with execution_authorized=false and requires_native_executor_recheck=true, output bound 4096 bytes. This contract cannot invoke Git or grant remote execution.

## Tests and integration

- Native Rust tests with real Ed25519 signature verification cover valid candidate, wrong signer, modified signed action, wrong owner/device, expired/closed lease, missing heartbeat, stale/revoked grant recheck, expired or malformed permit, missing recent step-up, duplicate job/nonce and separation of two Git read actions.
- Node contract tests check QA-only source, exact action vocabulary, native existing Local Control remote-provider prohibition, no public bridge and no deployment.
- Dedicated stage4ac-native-macos-qa.yml workflow recompiles Stage4J and runs Stage4AA/AB1/AB2 regressions plus Stage4AC cryptographic tests. No signing, notary, deploy, Supabase or Cloudflare changes.

## Still blocked before physical M3 -> M2 Git HEAD

1. Implement a server-controlled signer keyed to real RC66 verified active Owner session, actual MFA step-up, exact client/device/project grant and revocation checks.
2. Implement a native long-lived supervisor on a truly open authenticated TLS channel, with revocation, sleep-wake, graceful termination and bounded reconnect.
3. Connect one-time task permit through an **independently reviewed** Stage4L restricted registered-project Git runner adapter. Do not lift its source=local constraint merely by converting a remote request to JSON. It must verify registered canonical repo root, expected HEAD and isolated worktree under native policy.
4. Implement durable atomic idempotency ledger and signed bounded result receipt. Verify wrong-owner, revoked, replay, offline, wrong SHA and disconnected-peer negatives.
5. Build sign/notarize exact QA app; test M2 and M3 physically at separate sites. Only then enable ChatGPT KatoSync MCP read-only device tools and move onward to owner-consented workstation/Computer Use capabilities.

**Release:** Draft only, NO production device access, no permission grants, no real Mesh job, no operation on production Mac/Windows through KatoSync native connector.

References:
- https://github.com/NMKato/KatoSync/pull/268
- https://github.com/NMKato/KatoSync/pull/270
- https://github.com/NMKato/KatoSync/pull/271
- https://github.com/NMKato/KatoSync/pull/273
- https://github.com/NMKato/KatoSync/issues/241
