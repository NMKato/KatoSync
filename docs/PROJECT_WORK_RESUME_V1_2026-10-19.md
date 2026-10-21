# KatoSync Project Work Hub – Resume Snapshot v1

2026-10-19 | Independent, read-only core slice from the canonical dev branch.
Direction: project creation/import and everyday cross-provider continuation are the PRODUCT CORE; Issue Inbox, Secure Beta Check, Echo Box and overnight execution are optional consumers.

## Implemented
1. The existing Project Registry still owns project import, stable project identity, scan history and registration state. No duplicate storage or background workflow.
2. New Tauri command project_work_resume(projectId) accepts a registered LOGICAL project ID only, validates unique registry membership and invokes the existing read-only Rust repo scanner. Never accepts an arbitrary path, shell expression or token.
3. The adapter returns actual live SHA/branch and read-only document and framework metadata together with the previous known Registry SHA.
4. The pure TypeScript packet builder reuses Project Verification and Project Capsule. It exports a bounded provider-neutral JSON record of source observations, previous HEAD drift, repo status, documented architecture, relative status/memory references, next-step CLAIMS and explicit readiness limits.
5. A Project Registry card now includes "Projekt weiterarbeiten – Übergabekontext". Click triggers a fresh native scan; result is copyable locally. Nothing is automatically transmitted to a cloud provider.
6. Export omits absolute device paths, raw doc contents, secret-named or excluded documents and remote URL credentials. It explicitly marks tests/CI/policy/writer-lease not verified and code writes not authorized.

## Test evidence
- Six focused TypeScript tests cover fresh source, drifted SHA, dirty worktree, missing status, secret/path exclusions, invalid Git head.
- Full Node suite 142/142, TypeScript check and Vite build passing.
- Rust tests cover logical project ID, duplicate membership, relative root rejection and unknown projects.
- Missing Poppler/Typst resource directories in the isolated worktree are replaced by ignored, LOCAL TEST-ONLY placeholders; no distributable installer created.
- GitHub checks will be visible on draft PR.

## Deliberate boundaries
- This is NOT a full agent handoff with approved writes. No lease, no authorizations, no code edits, no automated issue processing and no persistent cross-device checkpoint.
- The current UI imports existing Git repositories. First-class creation of a new template-based project is a next slice.
- Personal project documentation is lower-trust data and could be stale or prompt-injection-bearing. Exported claims are not system instructions.
- Manual copying to a provider requires the user's consent and project privacy policy; nothing is silently uploaded.
- KUAS Core #66 and native Codex/Claude gate #67 are still separate drafts. A complete authorized cross-provider handoff must reconcile them and verify the exact policy digest.
- This source-based read-only scan does not claim code quality, test PASS, runtime correctness or beta-readiness.

## Next steps
1. Create/import UX + provider-neutral scoped local MCP/CLI adapter with project.create, project.context.get and status.next.
2. Append-only work.start/checkpoint/complete records using verified Git SHA, provider identity, source evidence and next action; no second memory store.
3. One-writer leased worktree and approvals, then independent CI; synthetic ChatGPT → Claude → Gemma handoff with stale-HEAD and conflicting writer tests.
4. Reuse this core for Issue Inbox #65, Secure Beta #64, Echo Box and optional night mode.

Roadmap: #12 Project Memory, #30 Zero-Orientation Handoff, #33 REX Knowledge Fabric.
Created by NMKato Solutions
