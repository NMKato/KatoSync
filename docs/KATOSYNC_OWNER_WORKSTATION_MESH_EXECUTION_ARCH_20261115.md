# KatoSync Owner Workstation + Local Agent Mesh – Architecture Decision (RC68)

**Date:** 15 November 2026
**Brand:** NMKato Solutions | **Product:** KatoSync | **MCP:** KatoSync Remote Commander | **GitHub:** NMKato | **Legal publisher:** MK Heartbeat UG, separately identified.

## Product invariant

KatoSync is an owner-operated, distributed AI development workspace, not merely a remote desktop, chat wrapper or conventional IDE. An installed Mac/Windows/Linux host can act simultaneously as a persistent local-agent home, execution workspace, compute node and verified Mesh peer.

Example: M2 remains at home with a signed KatoSync background agent, local Gemma 4 E4B and optionally original developer CLIs installed. The owner travels with M3 and selects M2 as an agent execution host. ChatGPT/Claude/Codex may submit tasks via a separately authenticated remote MCP. The native agent handles owner-approved tasks, makes durable checkpoints, reports receipts and synchronizes status. Cloudflare/MCP is the authenticated routing/control plane, not the physical executor.

The owner CAN explicitly delegate broad user-level computer/terminal/file rights to a named machine for unattended tasks. Installing the app or linking an OAuth client never implies an unconditional grant. Even an owner-controlled physical computer is not a reason to discard isolated per-job Git worktrees, server-verified authorization, safe checkpoints or revocation. No automatic root/admin escalation.

## Local-first agent orchestration

- **Gemma lane:** verified local Gemma 4 E4B (the official 4B-effective-parameter model), selected after checking real available memory, disk, GPU/CPU, hardware health, runtime integrity and a real local model/tool inference probe. Historical model weights on disk do not establish readiness. Routine indexing, summaries, project-memory lookup, diffs, planning and narrow tools remain local where possible.
- **Official provider CLI:** user-installed, unmodified provider CLI on an owner-controlled host can be scheduled subject to each vendor's terms. Do not intercept, extract, proxy, pool or resell subscription tokens as a generic API.
- **API/Cloud escalation:** only when separately enabled for the owner, data egress approved and usage budget sufficient. ChatGPT and OpenAI API billing are distinct; Claude Code subscription tokens cannot generally be repackaged as third-party SDK authentication.
- **Resource scheduler:** monitor available CPU/GPU/unified RAM, disk, user activity, battery/AC, thermals, model-load conflicts, jobs, per-project writer leases and network quality. Prefer the most suitable authorized node; never treat a model name or online heartbeat as proof of capability.
- **Cost claim:** local inference avoids paid provider API tokens for those requests, but consumes electricity and compute resources. ChatGPT itself still has plan-based usage limits. Local-first planning and context compaction may reduce provider costs; zero or unlimited provider cost is not guaranteed.

## Five independent trust states

1. **Installed:** signed local KatoSync app and user-level native agent. No Mesh trust or remote execution.
2. **Paired:** pinned device identity and human-approved Mesh enrollment. Same-account login is discovery, not peer trust.
3. **Connected:** fresh signed peer presence and authenticated transport; not merely last-seen timestamp.
4. **Delegated:** owner-approved, device-bound, scope-bound, expiry-bound client/device/project grant, separate from OAuth identity.
5. **Authorized to execute:** native agent independently verifies signed job, owner/session authorization, capability and target constraints, consent, required cross-device writer lease and per-operation revocation before acting.

## Execution modes

- **Read-only:** status, registered project/Repo reads, search and safe local model work. No files.write or terminal by default.
- **Project writer:** isolated owned Git worktree, canonical project root, expected HEAD, explicit task capability, time-limited cross-device fenced writer lease (KatoSync issue #76). No implicit push, merge or deployment.
- **Owner workstation:** consciously opt-in for the owner's own named machine; longer unattended work allowed within approved user-level OS account, path/network/tool constraints and session expiry. Fresh owner step-up and bounded grants; any long-running plan rechecks those limits and requires separately defined renewal. OS credentials remain on host, never copied into chat or shared Mesh memory.
- **Computer Use:** additional independent window capture and mouse/keyboard capabilities. macOS Accessibility/Screen Recording and Windows desktop session/privacy controls remain OS-governed. Visible active-session indicator, app/window allowlist, manual override and emergency stop. GUI permission does not follow from terminal permission.

The owner may select an otherwise idle PC as a fully featured remote coding workspace, subject to explicit owner control. The remote MCP receives job instructions and bounded results, not an invisible permanent superuser session.

## Execution contract / source-only QA

The new pure planner (src/lib/ownerWorkstationPlanner.ts) checks task owner, project, optional exact target machine, resource headroom, fresh signed presence, agent/model readiness, non-expired device-specific delegated capabilities, verified writer lease and optional OS Computer Use permissions. It proposes local Gemma or a separately approved provider escalation.

**Every output explicitly sets executionAuthorized=false and requiresFreshServerAuthorization=true.** This planner is advisory: a signed-capability broker and native executor must perform fresh independent checks. Synthetic passing tests are not proof of installed functional Gemma, running persistent agent or authorized remote command.

All active jobs should use the state machine:
QUEUED -> OWNER_AUTHORIZED -> ASSIGNED -> RECEIVED -> RUNNING -> CHECKPOINTED -> DONE / FAILED / CANCELLED.
EXPIRED / REVOKED / LOST_LEASE / UNKNOWN_DEVICE fail closed; cancel processes on lease loss. Attach signed owner/device/agent/task/project IDs, capability digest, sequence/nonce, TTL, expected repo SHA, lease fence, cost budget, audit trace and bounded output. Offline work may continue only under pre-approved offline-capable grants that have not expired; no hidden grant extension during network loss.

## One project truth

Reuse the existing Project Registry, KatoSync project-memory, agent episodic memory and Project Status Flow, and GitHub/n8n synchronization. Agent/persona memory must remain separate from project truth, device keys and private user conversations. Single-writer lease, conflict resolution, idempotent receipts and independent test gates prevent two Macs from modifying the same source concurrently. Do not build a second parallel orchestrator or replicate Keychain contents, tokens or private model credentials.

## Dependencies / next gates

Existing roadmap and security contracts:
- https://github.com/NMKato/KatoSync/issues/224 – native Gemma local agent birth/activation; M2 model weights need integrity/inference proof and M3 capacity needs recheck.
- https://github.com/NMKato/KatoSync/issues/241 – Remote Commander and client-neutral MCP.
- https://github.com/NMKato/KatoSync/issues/152 – owner-approved LAN/Mesh pairing.
- https://github.com/NMKato/KatoSync/issues/76 – cross-device fenced lease and isolated writer worktrees.

1. **RC66:** verify active owner session, tenant, client+device consent, fresh step-up; signed native peer and permanent transport (no guessed online state).
2. **RC68 local runner:** real Gemma 4 E4B on M2 then M3, user-login signed background service, safe resume/offline queue, on-device read-only job receipt and resource sampler; Windows parity.
3. **RC67/RC68 full workspace:** owner-authorized terminal/files and bounded user-level workstation mode, fenced writer worktrees, separately gated Computer Use; physical M2↔M3↔Windows positive and negative E2E before public release.

**Current truth:** RC64 ChatGPT MCP is authenticated; KatoSync remote Mesh is not yet confirmed connected and device execution remains disabled. No production database, Worker, OAuth, owner grant or local executor is changed by this ADR.

## Sources (checked 15 November 2026)

- https://ai.google.dev/gemma/docs/core/model_card_4
- https://ai.google.dev/gemma/docs/releases
- https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform
- https://code.claude.com/docs/en/legal-and-compliance
