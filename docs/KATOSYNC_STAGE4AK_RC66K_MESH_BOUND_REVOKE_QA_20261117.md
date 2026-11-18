# KatoSync Stage4AK — RC66K / canonical Mesh revoke integration boundary (source-only QA)

**Date:** 17 November 2026 · **Repository:** `NMKato/KatoSync` · **Branch:** `qa/stage4ak-rc66k-mesh-revoke-boundary-20261117` · **Base:** Stage4AJ `042b321`

## Purpose and verified interfaces

Stage4AI verified the actual RC66K **synthetic control-plane** EdDSA/JWS ACK format. Stage4AJ separately proved a physically delivered Ed25519-signed revoke and signed device receipt across two authorized Macs over a private, mutually authenticated TLS 1.3 Tailscale QA channel.

Stage4AK binds those prerequisites through **two independent, isolated QA contracts**:

1. `scripts/qa-stage4ak-rc66k-mesh-bridge.mjs` validates an RC66K *synthetic control-plane ACK* with a pinned Ed25519 JWS verifier, exact lease/worker/audit/Owner/grant/consent/device/action binding, SHA-256 of the exact compact JWS payload, receipt TTL and leased claim deadline. It only accepts `revoke_device`. A separately pinned Stage4AJ signed task-scoped notice must match a locally trusted exact session/project/task/recipient/device-key/sequence/RC66K-ACK digest. Only after both checks does the isolated QA device create its private irreversible `revoked.lock` marker and generate a separately signed device receipt. Forgery, cross-tenant/session/grant mismatch, wrong key, stale message and replay fail closed.
2. `src-tauri/src/mesh_durable_lease_qa/stage4ak_revoke_qa.rs` is attached with **`#[cfg(test)]` only** to the **actual** `MeshLeaseMachine` in `src-tauri/src/mesh_durable_lease_qa.rs`. A domain-separated, pinned Ed25519 synthetic server notice is independently verified against immutable Owner/tenant/client/session/grant/consent/project/task and the *current sealed local/peer/TLS session binding* when a socket is live. The canonical machine transitions to `MeshLinkState::Revoked` before attempting a private, fsynced `create_new` journal write. On restart it revokes first, including when the journal root is unsafe or unavailable. No remote read-only dispatch or cross-device write permission can emerge from this transition.

## Tests and exact scope

- **55/55 Node tests:** Stage4AC–Stage4AK contracts, including Stage4AK real Ed25519 control-plane ACK + independent device notice/receipt + wrong-key/wrong-scope/replay/TTL negatives.
- **16/16 native Rust tests:** standalone Stage4AK harness compiles the **actual canonical Mesh state machine source**, using a build-script-created *temporary copy* that omits only unrelated Tauri network and signed-job child modules. Five new Stage4AK tests cover signed revocation of a live canonical session, forgery and scope mismatch, duplicate revokes, restart with absent journal, and unsafe journal failure. Other canonical lease regressions remain included.
- **56/56 Stage4AF native Rust regression PASS in Stage4AK** (re-run locally with `cargo test --offline --locked --manifest-path tests/native/stage4af/Cargo.toml`), preserving signed read-only execution-time safety fences without enabling any runtime remote command.
- Stage4AJ's physical Tailscale mTLS transfer remains a **separate prior result**. Stage4AK itself has **not** yet delivered a live RC66K event over the regular KatoSync Mesh runtime.

The isolated native QA compilation is:

```bash
CARGO_TARGET_DIR=/path/to/reused/local-target cargo test --offline --locked --manifest-path tests/native/stage4ak/Cargo.toml
```

The build harness does **not** redefine or mock the production `MeshLeaseMachine`: it reads the genuine source and retains the state transitions. It does remove child module declarations in a temporary compile copy, so **this does not establish a full production Tauri/inchannel build**.

## Still blocked / NO-GO

**A verified RC66K ACK alone remains insufficient** for a signed native device revoke. The Stage4AK Node bridge and Rust canonical-state QA are **not** joined into a production cross-language interface, and no live RC66K server outbox event was consumed. The JWS fixture keys, device signatures and immutable local manifest are all QA fixtures; actual production pinned keys, KatoOS/GoTrue MFA, Keychain device identity, authoritative RC66J/K consent, lease/epoch persistence across OS restart, in-channel framed transport and server receipt reconciliation have **not** been integrated.

There is no public Tauri command, CLI executor, MCP device tool, production Cloudflare route, DB mutation, code merge, deployment or enabled remote Git/OS execution.

### Stage4AL gate

Implement and review a server-issued signed device-revocation envelope from **real** authoritative KatoOS consent and RC66K outbox records, consumed on the **existing** authenticated Mesh in-channel transport, with durable ordered recipient state, pinned owner/device identity, signed ACK returned to RC66K and a negative-testable real M2 Pro/M3 trial. A future read-only Git task still requires its **own explicit scoped owner admission and final server-side consent recheck**.

**Decision: Stage4AK source-only QA PASS, production remote execution NO-GO.**

## Relevant source

- KatoSync Remote MCP RC66K Draft PR #52: `https://github.com/NMKato/KatoSync-Remote-MCP/pull/52`
- KatoSync Stage4AJ physical result: `docs/KATOSYNC_STAGE4AJ_PHYSICAL_TWO_MAC_SIGNED_REVOKE_RECEIPT_QA_20261116.md`
- KatoSync Stage4AI RC66K binary verifier: `docs/KATOSYNC_STAGE4AI_RC66K_WIRE_DURABLE_REVOKE_QA_20261116.md`
