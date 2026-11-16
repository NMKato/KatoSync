# KatoSync Stage4AJ – Physical Two-Mac Signed Revocation Receipt (QA only)

**Date:** 16 November 2026. **Devices:** Mac.fritz.box (Apple M2 Pro, test sender) and MacBook-Air-von-Nikolas.fritz.box (Apple M3, test recipient). **Parent:** Stage4AI commit `2d60e9a`. **Branch:** `qa/stage4aj-physical-signed-revoke-20261116`.

## Physical test results

Both authorized physical Macs ran a separate, temporary **TLS 1.3 mutual-authentication QA channel** over their existing private Tailscale connection. The direct Wi-Fi LAN could not establish neighbor connectivity; the Tailscale path was verified reachable, without changing local network settings.

- M2 Pro generated a **synthetic**, strictly scoped revocation for a specified Owner, Tenant, grant, consent, client, session, project, task, recipient device ID, device public-key digests, sequence and an explicitly **synthetic** RC66K-correlation SHA-256. The notice was independently signed with an ephemeral QA Ed25519 issuer key.
- M3 authenticated the sender's temporary TLS certificate against an ephemeral local QA certificate authority, verified the **separately pinned Ed25519 application-level signature** and all exact local manifest bindings, then exclusively created and synchronized a private 0600 `revoked.lock` marker in its disposable QA directory.
- M3 independently signed a device-specific Ed25519 receipt binding the original notice's digest, task, recipient and sequence. M2 verified that signature against a previously exchanged, pinned device public key.
- M2 repeated the **same** signed notice. M3 denied it as a replay, returned a separately signed `replay_denied` receipt; M2 verified the negative receipt.
- Both processes exited cleanly with `STAGE4AJ_REAL_TWO_MAC_MTLS_SIGNED_REVOKE_REPLAY_PASS_NO_REMOTE` (sender) and `STAGE4AJ_M3_DEVICE_REVOKED_DURABLE_REPLAY_DENIED_PASS` (recipient). M3 marker checked as regular file, mode `600`, 102 bytes, expected QA marker prefix. A fresh, independent M3 process then reopened the marker and confirmed `STAGE4AJ_M3_FRESH_PROCESS_REOPEN_PERSISTENT_REVOKE_PASS_NO_REMOTE`.
- The test listener used an OS-assigned high port, mutually authenticated TLS 1.3 with `rejectUnauthorized:true`, a one-day synthetic certificate authority and a single accepted connection. No permanent listener or public endpoint was provisioned.

The test source is `scripts/qa-stage4aj-physical-revoke.mjs` and its offline unit/security contracts are in `tests/meshStage4AJPhysicalRevokeContract.test.mjs`.

## Crucial security boundary

**This is a genuinely executed two-device delivery test of a synthetic revocation, but NOT production RC66K→KatoSync Mesh integration.** The private QA harness is separate from the signed canonical Mesh lease and does not issue, execute, cancel or authorize any remote Git/OS command. No production key, secret, database row, OAuth session, MFA step-up or Cloudflare route is accessed.

The `rc66kAckSha256` field is a **synthetic correlation digest**, not a cryptographically verified RC66K signed ACK. A real server-to-device revocation envelope must be minted by the authorized control plane only after RC66I/J/K grant/consent reconciliation, must bind the canonical active Mesh lease, and needs authoritative device receipt persistence. Passing this physical QA cannot substitute for those checks.

The on-disk marker persists across **process exits/reopens**, but a reboot/recovery exercise and a durable ordered sequence journal have **not** yet been proven on the production KatoSync runtime. Do not interpret a missing synthetic marker as permission. The test root is only an ephemeral `/tmp` fixture, not production application storage.

## QA regression and next stage

- Native Rust Stage4AI chain: **56/56** tests passed locally (no changes in production Rust code in Stage4AJ).
- Node Stage4AC–Stage4AJ combined: **43/43** tests passed locally.
- `git diff --check`: required before commit.
- No remote device permissions, public MCP tools, Tauri IPC or production routing enabled.

**Stage4AK / still NO-GO:** integrate the recipient verification into the *existing* canonical authenticated Mesh transport, replace synthetic correlation with a real pinned server-authorized RC66K event and persistent revocation sequence, bind exact task/owner/session/consent to the device's verified identity, and collect device-signed ACK with authoritative reconciliation and controlled recovery tests. Only then consider a separately authorized read-only task.

## Source-only local verification

```bash
node --test tests/meshStage4ACSignedJobContract.test.mjs tests/meshStage4ADJournalContract.test.mjs tests/meshStage4AESignedReceiptContract.test.mjs tests/meshStage4AFExecutorFenceContract.test.mjs tests/meshStage4AGRevocationFenceContract.test.mjs tests/meshStage4AHRevocationDeliveryContract.test.mjs tests/meshStage4AIRc66kBoundaryContract.test.mjs tests/meshStage4AJPhysicalRevokeContract.test.mjs
cargo test --offline --locked --manifest-path tests/native/stage4af/Cargo.toml
git diff --check
```

The physical transport fixture is **not** runnable just by invoking the script: it also requires independently generated temporary CA and per-device signing keys, independently pinned public keys, locally approved manifest and certificate exchange. Never check in those fixture keys or use production credentials. Test-only artifacts live outside the Git worktree.
