# Stage4AB – Native Mesh session / read-only job admission gate (QA)

Date: 15 November 2026
Developer: NMKato Solutions
Project: KatoSync
Source branch: qa/stage4ab-native-session-readonly-job-gate-20261115
Base: Stage4AA Draft #268, pinned SHA 8291280bfa59136a92112babd19f4e87f1d2a7c3.

## Proven physical predecessor, not a synthetic guess

Stage4AA already proved a genuine one-shot, two-way pinned Ed25519 TLS 1.3 connection using existing Keychain identities and live KatoOS enrollment on two real Macs at different internet locations, over the pre-existing Tailscale overlay. Both hosts returned the one-shot PASS receipt in both directions. Wrong pins, unknown peers, non-overlay targets and missing manual QA flags were rejected. The connections were closed afterward and no remote jobs were enabled. See PR #268 and issue #267 for SHA, Apple signing/notarization, physical positive and negative evidence.

## Stage4AB source delivered

1. Native Rust, standard-library-only module src-tauri/src/mesh_session_gate.rs, included ONLY when building isolated stage4j-qa. Not a Tauri IPC route, not a CLI exposed to users, and not part of the default stable application.
2. Session starts only from externally supplied, independently verified native mTLS peer transport AND active owner, approved local Keychain pin, live enrollment, matching local/remote identity, expiry and non-revocation evidence. No account login or heartbeat by itself makes a session connected.
3. Bounded heartbeat sequence: monotonically increasing sequence, matching same authenticated peer owner/keys, recent server authorization and explicit consent expiry, clock rollback rejection, session TTL and closed-session failover. Wrong pin, changed owner, stale session, time rollback, replay or cancelled connection permanently removes the current session.
4. Exact user-level local agent request vocabulary is limited to two read-only Git probes: GitHead or GitStatusShort. There is no string shell command or general code execution argument.
5. A read-only job cannot be proposed without *independent* owner, OAuth client, machine, project and tool grant, fresh owner step-up, unrevoked expiry, expected SHA, bounded per-job TTL, idempotency nonce and a live heartbeat. No automatic grant from mTLS.
6. Receipt is a **candidate only**: execution_authorized=false and requires_native_executor_recheck=true. The native executor must independently recheck real client+device grant, signed one-time task, canonical project registry, current Git HEAD, Stage4L local-control capability, and valid owner session BEFORE calling any Git process. Maximum permitted proposed output is 4,096 bytes; real transport still needs enforcement and signing.
7. Replay cache here is **in-memory per-session only**. An authoritative durable cross-restart job journal/idempotency ledger remains mandatory before a real job can run; cache must never be used to imply exactly-once delivery.
8. This module **does not create a persistent mTLS network socket**. It does not send or receive a job, start or execute local_control, alter permissions, read application secrets, modify Keychain, run model inference, or change Cloudflare/Supabase. It is the typed authorization/session foundation for the upcoming durable native transport.

## Verification

- Standard Rust compiler tests on the physical M2 Pro: 16/16 passed (includes missing/expired consent, wrong owner/device/project, stale heartbeat, replay, clock rollback, wrong peer pin, revoke and read-only candidate non-execution).
- Script scripts/qa-stage4ab-readonly-session-gate.sh uses rustfmt and rustc --test in a temporary directory with automatic cleanup. No root privileges, no network or KatoOS mutation.
- PR Fast Gate now executes that exact native test script as a separate step; native release/physical transport is still gated.

## Next implementation and acceptance steps

1. Security-review the Stage4AA transport and Stage4AB gate together. Make the Rust transport create a session ONLY from a validated, currently live TLS stream, and recheck actual server owner/revocation state on every heartbeat. Do not supply unchecked booleans from UI, webhook or MCP JSON.
2. Implement bounded secure long-lived session lifecycle over the existing verified overlay or an explicitly reviewed KatoSync relay, with genuine heartbeat, reconnect, sleep/wake, expiry and emergency revocation; isolate QA-only flags and never remove the existing private-LAN policy.
3. Connect an explicit owner-authorized read-only job to the existing Stage4L strict local Git runner, with persistent signed job ID/receipt and exactly one executor, task statuses, cancel and storage limits. First real job: safely return the registered KatoSync project HEAD from M2 to M3. Test positive and missing-consent/wrong-owner/replayed/expired/offline negatives on physical hosts.
4. Integrate RC66 verified owner session/step-up and exact client/device/project grants before enabling RC65 ChatGPT MCP read-only device tools. Keep terminal/file/GUI rights separate until explicit owner-workstation acceptance.
5. Distinguish only-paired, one-shot TLS verified, durable connected, grant approved, and executor authorized in Desktop UI. Never show true 'Connected' based on this pure Rust module or prior Stage4AA one-shot proof.
6. Build/sign/notarize an isolated candidate from exact source head; test both Macs (different sites) and Windows parity. Keep all Draft PRs unmerged until independent safety acceptance.

## Runtime release decision

NO-GO for remote execution, live device controls, permanent connection, cross-device writers or production MCP tool grants. This PR strictly adds a checked, independent native QA gate; the existing ChatGPT KatoSync plugin remains OAuth-authenticated-ping-only.

Reference:
- https://github.com/NMKato/KatoSync/pull/268
- https://github.com/NMKato/KatoSync/issues/267
- https://github.com/NMKato/KatoSync/issues/261
- https://github.com/NMKato/KatoSync/issues/224
- https://github.com/NMKato/KatoSync/pull/249
