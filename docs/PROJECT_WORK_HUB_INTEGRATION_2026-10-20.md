# KatoSync Project Work Hub – controlled integration preview

Date: 20 October 2026. Status: review-only integration branch, not yet merged to dev/main, not a released app.

## Core intent

KatoSync is the project lifecycle hub, not primarily an issue fixer. Main flow: create/import a project, understand current code and decisions, start approved work, checkpoint, provider/device handoff. Issue Inbox, Secure Beta Check, Echo Box and autonomous repair are optional consumers of the same Registry / Memory / Handoff state.

## Integrated sources

- Current origin/dev, including existing Project Registry and Memory Fabric groundwork.
- Project Registry/Local Brain preview PR #44: merged ancestry after verifying current dev already contained the substantive Registry functionality; no novel filesystem changes were required from this preview during reconciliation.
- Read-only project resumption PR #68: current native Git scan scoped by registered logical ID, relative document refs, Git HEAD drift, Project Capsule, verified findings, JSON preview.
- Universal Agent Standards PR #66 and native Codex/Claude runner follow-up PR #67: versioned immutable constraints, platform profiles, launch-time policy gate and per-run provenance receipt.

## New integration seam

Read-only project resume packet includes the same deterministic KUAS community policy produced by the canonical TS policy module:
- policy.version is kuas/v1
- policy.profile is community
- policy.provenance is bundled_unpersonalized_defaults
- policy.ownerApproved is false
- policy.instructions is the full shared provider-neutral baseline.

The packet explicitly reports that code writes, effective policy authorization, cloud forwarding and writer lease are NOT verified/authorized. A user must authorize sharing context with a cloud provider. The app performs no such transmission.

## Test evidence

- 153 / 153 Node tests PASS, including TS/Rust KUAS profile parity, Project Registry, Handoff, Project Resume and the new joint KUAS/Resume boundary test.
- TypeScript typecheck PASS and Vite build PASS (pre-existing large-chunk warning).
- Full Rust library suite: verify result from local test log and GitHub CI. Rust tests in this isolated worktree use ignored test-only Poppler/Typst resource placeholders, NOT a distributable app.
- cargo fmt check and git diff --check required.
- No packaged macOS/Windows GUI smoke test yet.

## Safety and release limitations

- New Rust runner rejects old clients that omit agentPolicyVersion=kuas/v1. This branch includes the matching desktop adapter, but a coordinated rollout is required.
- Codex/Claude writer is still a legacy checkout/branch process, not an enforced isolated Git worktree. Do not enable unattended writes until native writer-lease and task authorization are implemented.
- Local Gemma, API adapters, Remote Desktop Commander bridge, Local Control daemon, fleet coordination and cloud privacy controls are NOT yet end-to-end integrated.
- This Project Work Resume is a manual READ-ONLY preview. The Git facts are fresh; status/memory claims are lower-trust and may be stale.
- Project-status durable checkpoints, source-by-source evidence, proper policy profile selection and native authorization are future milestones.
- Issue Inbox PR #65 is a separate feature. No second memory store, automatic issue execution, production change or merge.
- The user-supplied private skill archive and personal data are NOT copied to this public integration branch.

## Next ordered milestones

1. Review the integration PR and complete CI, then packaged desktop macOS/Windows smoke tests with actual binary resources.
2. First-class non-destructive project creation from templates, preserving import.
3. Scoped KatoSync MCP/CLI/API for project.create, project.import and project.context.get with path/privacy identity checks.
4. Append-only work.start, work.checkpoint and work.complete with Git SHA, KUAS digest, provenance and conflict-aware device synchronization.
5. Migrate writers to isolated worktrees, one-writer leases and approval-gated actions; synthetic ChatGPT -> Claude -> Gemma resume test.
6. Connect Issue Inbox and optional overnight workflows only after common lifecycle is verified.

Created by NMKato Solutions
