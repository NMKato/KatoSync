# Stage4AI — RC66K wire verification and crash-sticky revocation (source-only QA)

Date: 16 November 2026. Developer: NMKato Solutions. Base: Stage4AH local commit `eed7eebea658aae1b4955412e51bd2e8264d36e8`.

## RC66K source contract, verified directly

Reference: `NMKato/KatoSync-Remote-MCP` Draft PR #52, branch `qa/rc66k-signed-revoke-outbox-delivery-20261116`, source `src/auth/rc66k-private-signed-outbox.mjs` and `docs/RC66K_PRIVATE_SIGNED_OUTBOX_LEASE_QA.sql`.

RC66K currently signs a synthetic **CONTROL-PLANE invalidation ACK**, not a device receipt. Its JWS payload binds auditId, leaseToken, workerId, ownerId, grantId, consentId, deviceId, action and timestamps. It **does not** bind owner Mesh session, client, project, native task ID, recipient hardware key or a durable device revocation sequence. Thus a valid control-plane ACK cannot attest device cancellation or authorize any Mesh command.

New private Rust QA verifier validates the concrete RC66K compact JWS structure, pinned EdDSA key/kid/typ, byte-exact JWS payload and SHA-256, original outbox claim, lease time and 30-second signed receipt TTL. It produces `VerifiedControlPlaneAck`, deliberately without task or device-delivered fields. No production key is present; the tests use a synthetic pinned Ed25519 signer.

## Synthetic device-notice durability

The independently signed Stage4AH task-scoped QA revocation now has a separate private crash-sticky journal. Only a valid issuer signature plus a pinned control-plane QA signature may poison a local gate and persist a marker. The journal requires an existing canonical private root and atomically creates a mode-0600, fsynced marker with directory sync. Duplicate, truncated, corrupt or symlink marker paths remain closed.

On restart the explicit `restore_gate_fail_closed` entry poisons the in-memory gate. Existing marker => `RevokedOrPoisoned`; missing marker => `ClosedPendingAuthoritativeReconciliation`. A missing marker **does not** reopen an execution lease. Persistence failure leaves the current process revoked; recovery still requires independent server reconciliation.

## Productive NO-GO

Neither the RC66K control-plane ACK nor the Stage4AH synthetic signed device notice is a real ChatGPT-to-M2/M3 transport delivery. No RC66K production DB, Cloudflare route, actual OAuth MFA, Tauri IPC, public MCP device method, device Keychain or real remote Git execution was changed. The code remains compiled solely in native `#[cfg(test)]` QA. No GitHub Actions run was triggered.

Further Stage4AJ acceptance requires a new **server-authorized RC66K-to-device delivery envelope** with exact grant/consent/owner/device and signed task/session/client/project/key binding, monotonically persisted recipient sequence, authenticated physical Mesh transport, actual device-ACK and final server-side consent check. Only then is a read-only remote Git task eligible for separate approval.

## Local test commands

```bash
node --test tests/meshStage4ACSignedJobContract.test.mjs tests/meshStage4ADJournalContract.test.mjs tests/meshStage4AESignedReceiptContract.test.mjs tests/meshStage4AFExecutorFenceContract.test.mjs tests/meshStage4AGRevocationFenceContract.test.mjs tests/meshStage4AHRevocationDeliveryContract.test.mjs tests/meshStage4AIRc66kBoundaryContract.test.mjs
cargo test --offline --locked --manifest-path tests/native/stage4af/Cargo.toml
git diff --check
```

Keep Stage4AI on an isolated local branch, no push/merge/deploy.
