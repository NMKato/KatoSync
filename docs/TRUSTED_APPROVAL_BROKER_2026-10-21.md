# KatoSync #76 — trusted approval broker contract (review-only)

_21 October 2026. Branch security/trusted-approval-broker-20261021, stacked on Draft PR #85. Not deployed, no backend API route and no autonomous agent privileges._

## What this slice provides

A **backend-only, testable TypeScript policy module**, `server/security/trustedApprovalBroker.ts`, for a future explicit approval flow. It intentionally contains **no Supabase credentials, HTTP listener, live database connector, Tauri command, OS-keychain access or automatic approval behavior**.

An approval challenge is issued only after a user session has been validated via a trusted Auth port, user/account/project approval rights checked, and both the **approving device** and the **target execution device** independently checked as enrolled/trusted/not revoked. This permits a user on the M2 to approve a scoped task assigned to a Windows node without transferring credentials.

The challenge has a server-stored nonce and 90-second maximum lifetime. The displayed challenge contains no user or session identifier. A separate, explicit approval action must supply an Ed25519 signature from the approving device over the domain-separated challenge, and a one-time nonce is atomically consumed. The server revalidates privileges/device state before issuing a record. Only `edit_worktree` is accepted; the approval is limited to 20 minutes or the user session expiry. A proof digest and exact account/project/task/executor/head/scope bind the approval for future insertion into the private table specified by PR #85.

## Security boundary: what it is NOT

- The port implementations in tests are **synthetic fakes**. There is **no production auth or user-consent service deployed** and no actual account/device membership storage bound to this broker.
- The string `APPROVE_THIS_TASK` is merely a handler input gate. It does **not** prove the user physically clicked approve. The production app must implement a trusted, human-visible confirmation dialog and ensure OS-protected signing keys require appropriate user presence where possible.
- The approving device must sign its *own* challenge; its private key must never be exported to or shared with the worker node, a local model, another node, or the cloud service.
- The trusted Auth port must verify the access token with the identity provider (not locally decode unverified claims); must confirm session is still active, including logout/revocation sensitivity, and reject anonymous users. The authorization port must read server-owned project/device membership and access controls. Any user-editable metadata is **not** an authorization source.
- The Challenge port MUST implement atomic, persistent compare-and-consume; a process-local Map does not satisfy multi-instance replay safety. Approval storage MUST authenticate server authority, enforce immutable DB records, recheck scoped access inside its database transaction and maintain auditable receipts.
- Never embed a Supabase service-role key in the desktop app. No public `anon` or `authenticated` write grants to private schema. The private schema migrations are still review-only and not deployed.
- Approval records/leases remain independent of the old `run_codex_task` command. The agent runner is NOT wired or allowed to write by this module. Future executor must check the live lease/fence before every mutation and cancel runaway child processes on lost lease or network unavailability.
- No implicit Git push, merge, production deployment, THEORG edits, unsafe shell or cross-device credential transfer.

## Tests and commands

`node --experimental-strip-types --test tests/trustedApprovalBroker.test.ts`

`npm run typecheck:server`, `npm run typecheck`, `npm test`.

Checks include valid cross-device approval, invalid/anonymous sessions, foreign project, unknown devices, revoked/disabled devices, missing/forged confirmation or signature, wrong task/SHA/target/scope, expired or changed-session challenge, revocation after issue, persistence failure (fail closed), nonce replay and concurrent consumption, and non-disclosure of actor/session IDs in the public challenge.

The test runner uses generated ephemeral Ed25519 signing keys; **no real user, Supabase session or production device data is used**.

## Next required implementation

1. Build a dedicated, hardened server auth/device/account adapter with active sessions, owner consent, durable nonce store, rate limiting, audit receipts, correct tenant scope, short-lived signed device keys and only server-held privileged DB credentials.
2. Integrate the explicit approval UI and user-presence-protected signer; never infer consent from an agent prompt or a background task.
3. Validate the exact approved record against PR #85 lease in the trusted backend. Verify the fence and registered HEAD at the native execution boundary before each edit, with cancellation and rollback on lost lease.
4. Test real simultaneous M2/M3/Windows requests, offline/network partitions, changing device trust, retries and crash recovery; independent security review and native packaged acceptance before enabling a writer feature.

All stacked PRs remain Draft and release blocker #76 stays **OPEN**.
