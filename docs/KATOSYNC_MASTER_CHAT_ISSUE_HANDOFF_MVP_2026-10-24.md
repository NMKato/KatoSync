# KatoSync Master Chat MVP — local, project-scoped and explicit GitHub handoff

## Context
The operator accepted GitHub App UI and read-only inventory, verified 43 NMKato repositories and real GENXLine issues, then accepted the responsive grid in native macOS. Their next requested MVP step is central issue-to-chat handoff ahead of the two-node mesh.

## Reuse existing implementation
- Existing `ContinuityLocalChatPanel` already stores project-scoped conversations in Memory Fabric, uses local Gemma and refuses to fabricate answers from a missing index (`NOT_IN_MEMORY`).
- New sidebar `Master-Chat` in Agent Sync is a navigation entry into that existing component. It is **not** a parallel chat database, cloud chat, job runner or general autonomous AI agent.
- Explicit project selection is available for ordinary local chat. GitHub handoffs match **only by canonical repository remote**, with a single unambiguous local registered project. Display name matches are never trusted. If no exact registered project exists, users are directed to Projects and no chat draft is injected.
- GitHub Issues remain source metadata, not instructions. Operator may append a note in Provider > GitHub Issues and choose `Im Master-Chat vorbereiten`. This does not send the message; it navigates to the project's local chat and pre-fills the textarea with a bounded read-only request.
- Draft discarded => composer cleared, account logout/change => handoff discarded. No GitHub write scope change, no issue mutation, no queue submit/autostart or client-side exposure of App token.
- Existing Provider GitHub connection/local Brain/CLI integrations are unchanged.

## Acceptance criteria
1. A plain sidebar Master Chat opens with list of registered local projects.
2. Choosing a registered Memory-Fabric-indexed project loads existing local chat history and accepts manual messages.
3. `Für Chat vormerken` + `Im Master-Chat vorbereiten` transfers note and Issue ref only if normalized remote matches a single registry entry; no send until operator clicks Send.
4. Missing/unmatched registry refuses the transfer safely and offers to navigate to Projects.
5. Clear handoff clears the prefill rather than silently leaving a stale instruction. Account logout/change clears the pending handoff.
6. Provider/GitHub Issues remain GET-only; Autonomous writes still blocked by issue #76.
7. Real macOS preview and native keychain consent tested separately from green unit/Rust/TypeScript.

## Limitations / gates
- The existing Memory Fabric local chat is project grounded only. If an Issue has not been indexed it may return `NOT_IN_MEMORY`; this is correct, not an invitation to hallucinate a plan.
- KatoSync's project registry / local Memory Fabric are separate from its cross-project KATOOS web authentication (issue #114). Cross-device/account tenant isolation and more general Chat orchestration need explicit hardening before release.
- No claim that arbitrary GitHub issues can be automatically scheduled, approved, merged or executed; that requires secure writer #76.
- Keep feature on stacked Draft branch, do not merge to main without real native and account-switch QA.
