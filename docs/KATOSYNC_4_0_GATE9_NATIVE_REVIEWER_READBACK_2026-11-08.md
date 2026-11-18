# KatoSync 4.0 — Native Gate-9 Reviewer Signature Readback (QA)

**8 November 2026. Security-development artifact only. NOT a signed human approval or release authorization.**

## Why this was needed

The KATOOS Edge route for Gate 9 verifies Ed25519 from a separately
registered reviewer before storing a signed decision. The native Rust
acceptance ledger previously did **not** independently verify that stored
reviewer's 14-field attestation. The existing Gate-9 documentation explicitly
requires a second readback before release of any verified-accepted score.

## Added native behavior

Pure Rust module
`src-tauri/src/memory_fabric/acceptance_ledger/reviewer_attestation.rs`
under the existing acceptance ledger.

- Parses only the exact 14 supported fields and rejects extra fields,
  oversized messages, malformed UUIDs, noncanonical Ed25519 base64url and
  invalid decision/reason/timestamps.
- Recreates the same domain-separated bytes as the Edge TypeScript
  `reviewerSigningBytes40` implementation.
- Verifies the signature against a **separately trusted, currently authorized
  Ed25519 reviewer public key**; refuses a key merely supplied by the decision.
- Requires exact grant, project, owner, consumed challenge, reviewer identity,
  key ID and both revisions; rejects self-review and stale signatures.
- Requires external proof of active reviewer, active project, pending grant and
  consumed owner challenge. These flags are **not trusted merely because the
  signed review itself says so**.
- Returns an explicit **typed Approved or Rejected** verdict, never an
  ambiguous signed-OK Boolean. A cryptographically valid rejection is NOT an
  owner approval and must not increment any verified feature progress.
- **No Tauri command, no network call, no DB DML, no rights, no Mesh
  activation, no accepted ledger update.**
- Does not read any real user credential, native Keychain private key or
  production reviewer status.

## Independent reference vector

The cross-language test `tests/nativeReviewerCrossLanguageGate9.test.ts`
uses a **public deterministic synthetic test seed [41; 32]** and the actual
production TypeScript byte builder; it checks SHA-256
`d0942d714bed03bf4192288172d5a3737edafdd1a2bc26c3ca4c18fff1b9f82d`
and the corresponding fixed Ed25519 signature. The native Rust test uses
its own serializer and separately pins those exact values.

This is a synthetic **cryptographic compatibility and failure-mode test**,
not a claim that an independent human has consented.

## Outstanding production gates

1. Reviewer key must be enrolled through an independently authorized
   human workflow. A user cannot enroll their own reviewer key.
2. Native application must independently fetch and validate current
   reviewer identity, active key/revision, owner/subject and grant
   from its authenticated KATOOS identity before calling this verifier.
3. Native readback must fetch the persisted decision and verify its
   signature again independently of PostgreSQL's service-role authority.
4. Two distinct authenticated KATOOS people must complete a real
   positive end-to-end review, including owner proof possession, replay
   denial, revocation, and reviewer key rotation.
5. A successful signature alone must never change `verifiedPercent`,
   permit autonomous merge/deploy, or grant remote terminal or Mesh access.
6. Signer/reviewer private keys must stay outside Git, logs, frontend,
   and application bundles; QA test fixtures are intentionally public.

Until independently witnessed live acceptance, **PR #247 remains DRAFT**.

## Verified isolated QA evidence

- **300/300 native Rust library tests passed**, eight explicitly ignored hardware tests,
  after the final typed Approved/Rejected result implementation.
- **744/744 Node tests**, **16/16 Remote Usage** and complete TypeScript/Vite
  build passed on the M2 Pro QA worktree.
- The synthetic TypeScript/Node to Rust Ed25519 canonical-bytes cross-check
  passed **2/2** targeted Node tests; targeted native reviewer checks **4/4**.
- Temporary Rust Tauri build-only resource placeholders were created only
  in an isolated disposable worktree, not in installed applications.
- GitHub Windows CI must still pass on the new exact commit.
