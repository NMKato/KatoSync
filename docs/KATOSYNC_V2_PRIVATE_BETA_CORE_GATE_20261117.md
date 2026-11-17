# KatoSync 2.0 Private Beta – Core Release Gate (17 Nov 2026)

Status: **INTEGRATION CANDIDATE / NOT RELEASED**. Owner priority: ship a usable local-first desktop beta, not new Mesh stages.

## Source and boundaries

- Baseline: `fix/p0-readonly-chat-diag-20261029` (Draft PR #175, SHA `d76c9397`).
- This gate is a separate stacked branch. It does not merge #175, #75 or any Mesh QA draft into `dev`/`main`.
- Mainline does not yet contain the beta chat/dispatch sources. **Do not claim a public beta release from green branch CI.**
- Existing M2/M3 installations, device trust, Keychain, sessions, remote access and signed bundles remain untouched.

## Evidence already obtained (not a new test claim)

1. **M2 local Gemma project chat (29 Oct):** persisted answer and source citations; history survived navigation; unknown source claim returned `NOT_IN_MEMORY`. See Issue #130 and PR #175.
2. **M2 read-only agent runs (29 Oct):** Codex and Claude produced distinct durable owner-scoped receipts, exit 0, unchanged Git before/after. See Issue #125 and PR #175.
3. **M2/M3 mutual TLS:** one-shot, mutually pinned TLS 1.3 proven; it does not provide a sustained production Mesh. See Issue #269 / QA Draft #279.

## Repeatable beta-core source gate

`npm run test:beta-core` invokes eight existing test suites together, with the local Node binary:
- Chat error classification and safe memory recovery
- Local multimodal chat and persistent history UI contracts
- Continuity context/recovery, handoff, master-chat
- Read-only Codex/Claude dispatch and platform-safe resume

The command **does not** log in, run model providers, mutate Git projects, install binaries, launch listeners or publish anything. It is regression evidence, not a real device or GUI acceptance.

## Beta release blocking gates

| Gate | Condition for PASS | Current |
| --- | --- | --- |
| B0: Branch integration | Reconcile stacked beta branch to supported target with reviewed diff and green tests | OPEN |
| B1: Native chat | Signed isolated QA app: local Gemma, persisted context, restart/reopen, negative unknown-source result on M2 and M3 | PARTIAL (M2 past pass) |
| B2: Provider jobs | Codex and Claude one-shot read-only receipts, authenticated user, visible errors, no repository mutation on M2/M3 | PARTIAL (M2 past pass) |
| B3: Core stability | Current queue state truthful, retry/recovery, owner approval cards; no dead-end or false DONE, bounded endurance test | OPEN (#39) |
| B4: Cross-platform | Windows clean install + login + chat/dispatch smoke, no macOS-only assumption | OPEN |
| B5: Installer/rollback | macOS Developer-ID signed and notarized app, exact SHA and rollback; upgrade + clean install | OPEN |
| B6: Scope/safety | No remote jobs or autonomous writers without distinct reviewed gates; no token or Keychain migration | PRESERVED ON THIS BRANCH |

## Delivery decision

- **Beta 2.0 scope:** project registry, local context/chat, Codex/Claude read-only tasks, local AI model management, clear statuses, basic authenticated device status.
- **Deferred beyond private beta:** persistent unattended Mesh, multi-node writer execution, auto-reconnect fault injection, full autonomous Auto-Lane, public marketplace or billing.
- Preserve all existing QA/feature branches and their evidence. No force push, no main/dev merge without review.
- Release GO needs fresh signed binary + M2/M3/Windows owner-accepted E2E evidence, not source-only tests.

Next integration unit: run core regression; review #175 ancestry and resolve small, explicit beta slices for integration, then native installer smoke. Keep README and PR evidence in sync.
