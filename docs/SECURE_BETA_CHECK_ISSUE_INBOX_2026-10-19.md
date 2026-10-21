# Secure Beta Check – Read-only GitHub Issue Inbox (19.10.2026)

## Implemented in KatoSync dev (draft PR #65)
- New **Secure Beta Check** section inside Agent Sync > Projekte.
- Select 1–8 repositories already linked in the canonical Project Registry.
- **Native Tauri/Rust** command checks the registered project IDs again on the backend. It does not accept arbitrary repo names or external binaries from the UI.
- Uses the locally installed GitHub CLI and its pre-existing login; no GitHub token, email or password is requested/stored by KatoSync.
- CLI command uses only fixed arguments: gh issue list --repo OWNER/REPO --state open --limit 100 --json number,title,url,updatedAt,state,labels. No shell.
- Bounded command (20-second timeout per repository), disabled interactive prompts and fixed sanitized errors. Existing /opt/homebrew/bin/gh and /usr/local/bin/gh GUI paths supported on macOS; Windows invokes gh.exe from PATH.
- Deterministic TypeScript IssueInbox core maps only known repo remotes, blocks ambiguous/foreign routes/URLs, deduplicates, sorts by severity, redacts and bounds titles, and displays open issues.
- Each finding explicitly requires human approval; no issue body is passed to an LLM and **no code execution, issue mutation or agent dispatch** happens.
- Partial failures are visibly marked. No Issues observed is **not** a beta-ready claim, and selection changes invalidate the previous report.
- Opening a validated GitHub Issue uses the existing Tauri opener plugin.

## How to use
1. Open **KatoSync Desktop**, switch to **Agent Sync > Projekte** and add/scan local GitHub projects.
2. If GitHub CLI is not installed, install it from the official GitHub CLI distribution. Sign in through the CLI's official flow via gh auth login; KatoSync never reads credentials.
3. Tick the projects, press **GitHub-Issues prüfen**, and inspect the read-only findings.
4. Next-stage remediation jobs will require a separate explicit approval workflow.

Browser preview deliberately cannot fetch live GitHub data; no fake "online" results.

## Verified
- Actual authenticated gh issue list read-only schema/response test against KatoSync repository: PASS (fields labels,number,state,title,updatedAt,url).
- TypeScript static type check and Vite production build: PASS.
- Full Node test suite: 142/142 PASS.
- Rust unit tests include remote validation and Project Registry ID allowlist.
- Rust tests run with ignored temporary placeholders for missing local Poppler/Typst binary packaging resources, **test only**, not a shippable Tauri distribution.
- git diff --check and cargo fmt --check.
- GitHub CI results are tracked on draft PR #65.

## Still outstanding (explicit non-goals of this PR)
- In-app GitHub App OAuth onboarding, independent of the user's GitHub CLI; Windows app smoke test.
- Persistent encrypted offline Issue cache + multi-device coordination.
- Full Secure Beta Check scanners, checkpoint contracts, browser/synthetic test agents and morning briefing.
- Grounded issue-to-Memory Fabric context capsules and explicit approved Issue → Agent Sync repair jobs.
- Independent PR review/CI, branch/lease limits and human safety gates; optional n8n workflow.
- Existing drafts #44 (Project Registry and Local Brain preview) and #63 must not be merged or overwritten automatically.
- Public repository requires appropriate OSI-compatible license and dependency notices before claiming unrestricted open-source distribution.

Created by NMKato Solutions
