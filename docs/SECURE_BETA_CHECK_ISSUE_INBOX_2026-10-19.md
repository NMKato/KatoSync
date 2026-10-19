# Secure Beta Check – GitHub Issue Inbox foundation (19.10.2026)

## Scope
This change introduces the first pure, deterministic, read-only normalization layer for GitHub Issue snapshots in KatoSync dev.

- Receives untrusted JSON from a future GitHub adapter.
- Maps only registered GitHub remotes in the current Project Registry.
- Rejects foreign Issue URLs, closed Issues, ambiguous repo ownership and invalid data.
- De-duplicates by canonical repository and Issue number, retaining newest observation.
- Does NOT read Issue bodies. Titles are limited and redacted; Issue content never becomes an executable agent instruction.
- Classifies priority and security labels (unlabelled P2 is provisional).
- Binds findings to a known project SHA if available, otherwise forces human review.
- No auto-writer, code execution, network call, issue creation, PR merge or customer data mutations.
- Works without any LLM, n8n or cloud service.

## Verification
- Node focused issueInbox tests: six passing.
- Full npm test, npm run typecheck, npm run build and git diff --check passing.

## Next slices – explicitly not implemented yet
1. Least-privilege read-only GitHub authentication/metadata adapter with actual retrieval timestamps, errors and per-repo choice.
2. Secure Beta Check / Issue Inbox UI in Project Registry; absence of data must not imply Beta-ready.
3. Issue → verified context capsule using existing Memory Fabric and Git/CI sources, with provenance and prompt-injection defense.
4. Explicitly approved Issue → Agent Sync task in a protected worktree/branch; independent CI/review, no auto-merge.
5. Offline issue snapshot cache and optional n8n / multi-device scheduler / morning briefing.

## Integration
- Project Registry and Local Brain preview PR #44 is still draft; reconcile before UI integration.
- This PR does NOT fetch real GitHub Issues, process a real Issue automatically or certify any project Beta-ready.
- The public repository needs verified OSI licensing/dependency notices before making Open Source redistribution promises.

Created by NMKato Solutions
