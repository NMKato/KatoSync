# KUAS v1 — Native Codex/Claude runner integration

19.10.2026 | Stacked review branch based on KUAS contract PR #66. This is **not** a production rollout and does not enable issue auto-fixes.

## What actually executes

- KatoSync TypeScript desktop adapter adds `agentPolicyVersion=kuas/v1` to each `run_codex_task` invocation; the call can also select a trusted static `agentPolicyProfile`, defaulting to `community`.
- The native Rust `run_codex_task` entry **rejects missing/unknown policy versions and unsupported profile identifiers before filesystem writes or provider probes**. Earlier desktop clients lacking the new contract will fail safely until updated together.
- The same native policy text is **prepended** to Codex and Claude prompts before either process starts. It is stored in compiled assets and cannot be deleted by the caller's ordinary task text, Issue body or model-specific request.
- Six known profiles: community, mvvm_r, ios_swiftui, android_kotlin, web_typescript, tauri_rust.
- Each .txt policy is deterministically generated from `src/lib/agentStandards.ts` and cross-checked byte-for-byte with the TS policy generator during Node tests.
- Each runner task stores an `agent_policy_receipt.json` containing version, selected profile, **sha256 of the exact policy text**, actual Git HEAD on the newly checked-out task branch, runner identity and request trigger.
- The prompt.md saved in the protected run directory now reflects the **actual sanitized, versioned instructions sent to the provider** (rather than only the raw user-provided prompt).
- Rust CI independently checks version validation, profile acceptance, policy ordering and the receipt structure.

## Safety and compatibility boundaries

- This is a **policy identity/preflight and model-context guarantee**, not an assertion that any LLM will obey every instruction. The Rust authority guarantees a pinned version, known profile and policy provenance.
- **Existing Codex/Claude branch workflow remains a legacy checkout/branch workflow, not yet an isolated worktree.** It still relies on existing clean-git and manual-action protections. Do not call it a fully KUAS-compliant isolated repair worker until the worktree migration is implemented and tested.
- The current `runner_connector_mode` can bypass some Claude CLI prompts by explicit configuration. Its permissions, external service access and side effects require a separate hardened authorization gate before unattended repair jobs.
- The Local Control daemon, background queues, existing idle/auto-mode jobs and other remote providers were deliberately **not modified** here. It would be unsafe to impose the new contract on their old job envelopes without migration and replay tests.
- The optional profiles are accepted by the native boundary, but **there is not yet an organization/project profile picker or signed persisted approval**. Desktop currently defaults to community rules; the user's MVVM+R profile can be selected when the settings UI is implemented.
- User-facing Issue Inbox PR #65, KUAS base #66, and this stacked PR must be reviewed/rebased in that order. No automatic merge or app build publication.

## Test evidence

- `npm test`: 146 / 146 PASS.
- `npm run typecheck`: PASS.
- `npm run build`: PASS; pre-existing bundle-size warning only.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 104 PASS, 3 intentionally ignored.
- `cargo fmt --check`, `git diff --check`: PASS.
- Rust tests use **ignored, local temporary placeholder resource directories** for missing Poppler/Typst assets in the isolated worktree. They are not committed and are not valid for creating a distributable installer. Native packaged-app and Windows smoke tests remain outstanding.

## Required next actions

1. Reconcile parent PR #66 and dependent #65; do not run package installer with test placeholders.
2. Migrate the actual Codex/Claude writer to an isolated Git worktree and enforce repo/commit matching, explicit human approval for high-risk actions and **one writer per worktree** at runtime (not in prompt).
3. Add policy digest and profile provenance to ActionTask Handoff/Local Control job queues, central approval storage, signed device lease/heartbeat, timeout and retry policy. Recheck on resume after offline work.
4. Wire the same native rules into local Gemma, API adapters, secured multi-machine scheduler and independent testing agents.
5. Add trusted organization/project profile UI; defaults remain general for public community installations.
6. End-to-end test a **synthetic** project + GitHub Issue through preview → approval → branch/worktree → tests → review → PR, without touching production data.

Created by NMKato Solutions
