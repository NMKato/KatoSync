# Stage4AE – Device-signed bounded Git HEAD receipt (native QA)

Date: 16 November 2026. Developer: **NMKato Solutions**. Product: **KatoSync**.

## Problem and target

The owner's target workflow is tablet / ChatGPT -> KatoSync Remote MCP -> owner-authorized M3 -> native pinned Mesh -> M2 local agent -> bounded Git HEAD result -> signed verified receipt, without needing a remote desktop window.

The existing technical proof must not be overstated:
- Stage4AA #268: real physical 2-site M2/M3 one-shot pinned TLS 1.3, no job.
- Stage4AB1 #270 and AB2 #273: one canonical Mesh lease and native CI-tested TLS 1.3 in-channel heartbeat, not a persistent physical device relay.
- Stage4AC #275: native CI-green domain-separated Ed25519 signed Git read-only *candidate*, exact owner/tenant/client/device/project/expected HEAD/TTL and server recheck. No remote executor.
- Stage4AD #276: native CI-green crash-sticky local task ID/nonce reservation, with later integration guaranteeing verified signature and current Mesh lease BEFORE touching disk. This is not server-global exactly-once delivery.

## Stage4AE implemented – source-only QA

- New private native module src-tauri/src/mesh_durable_lease_qa/signed_job_qa/receipt_qa.rs, nested in the existing QA-only Cargo feature stage4j-qa. **No public IPC, MCP tool, native background service, external CLI, remote shell or production route.**
- A typed, successful Git HEAD receipt binds owner, tenant, owner session, OAuth client, registered project ID, task ID, nonce, device Ed25519 public key, expected and measured SHA-1 or SHA-256 commit ID, action, permit digest, exact bounded standard-output digest/length, success exit code and completion time. All fields are Ed25519-signed using a device-specific signing key.
- The local output parser only accepts exactly 40 or 64 lowercase hex Git commit characters, optionally followed by one newline, with no extra data, and checks it against the signed expected HEAD. Reject wrong Git HEAD, wrong device key, expired permits, wrong action, oversized output, tampering or signature mismatch.
- The receipt verifier independently checks the stored signed receipt against the exact originally signed job permit, source output digest, device public key and expiry. A result is not trusted merely because it carries a status flag.
- After signature verification and existing task-ID plus nonce reservation, the private Stage4AD journal stores one bounded terminal record through exclusive creation and durable file/directory sync. A second record for the same task is rejected, including after reopening the journal. Missing reservation or tampered signature cannot create a terminal record.
- The native **unit tests** create their own isolated temporary Git repository and invoke fixed Git commands locally only in the test fixture: Git init, empty commit, and git rev-parse HEAD. They then sign the observed HEAD, verify the receipt, test tampering and wrong device/HEAD, and persist/reopen it. They never open or modify a real owner project.
- Git may be invoked in the #[cfg(test)] module **only**; there is no way for ChatGPT, a remote peer or the runtime application to call this fixture.

## Threat model and strict limitations

This proves a real bounded local Git fixture can be represented by a verifiable, durable device-signed result. **It does not prove that Stage4L has executed a real owner-authorized remote job.** The test uses synthetic keys; the production signer must be device-local, Keychain-backed and unable to sign arbitrary caller-supplied evidence. Stage4L's strict local-only source=local registry/expected-HEAD check stays unchanged.

A signed receipt attests to the bytes a signing key signed; without a trusted on-device executor, it is NOT proof of who executed an action. A persistent local journal is not a globally atomic cross-device server replay ledger. The native TLS controller still needs a running supervisor, current owner approval, direct grant and revocation checking, offline handling, peer failure/cancellation and bounded receipt transport.

## QA and release gates

- Targeted Node source-contract tests prohibit non-test shell/network/IPC authority; assert signature and output bindings, real isolated Git fixture, persistence and no-deploy workflow.
- Native macOS Cargo workflow stage4ae-native-macos-qa.yml performs existing Stage4AA/AB1/AB2/AC/AD regressions and actual fixed-Git fixture/Ed25519 signature and persistent journal tests. It does not package, sign or notarize the app or access production infrastructure.
- Production NO-GO until owner-issued verified RC66 session, step-up and exact tenant/client/device/project grants, pinned device signer/peer Keychain checks, continuous Mesh supervisor, an independent Stage4L allowlisted execution adapter and global journal/revocation controls pass real 2-site physical M3-to-M2 positive/negative tests.
- Only then activate read-only KatoSync MCP device tools; separately owner-granted terminal/files/GUI Computer Use come later.

**Release: Draft / source-only QA.** KatoSync Remote MCP remains authenticated synthetic ping with meshConnected=false and deviceAccessEnabled=false. No device access was enabled and no production settings, Supabase grants or OS permissions were changed.

Related: https://github.com/NMKato/KatoSync/pull/268 ; https://github.com/NMKato/KatoSync/pull/270 ; https://github.com/NMKato/KatoSync/pull/273 ; https://github.com/NMKato/KatoSync/pull/275 ; https://github.com/NMKato/KatoSync/pull/276 ; https://github.com/NMKato/KatoSync/issues/241
