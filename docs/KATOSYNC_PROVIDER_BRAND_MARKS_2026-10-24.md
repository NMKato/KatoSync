# KatoSync Provider brand marks — 2026-10-24

## Intent
- Use recognizable provider identities in the Agent Sync OpenAI Codex, Anthropic Claude Code, and GitHub cards and in the visible provider route.
- Preserve all provider auth, account tokens, connection status, priorities, fallback and queue behavior.

## Scope
- Reuse locally bundled KatoSync assets public/agent-openai.png and public/agent-claude.png (already used in AgentJobViews).
- Add static GitHub mark based on the Simple Icons GitHub brand SVG (Simple Icons project CC0 icon collection). The mark is embedded locally as white path and styled against a dark tile; GitHub trademarks remain with GitHub.
- Add shared ProviderBrandMark React display component with image selection and existing CPU / shield fallback for local model and Local Control.
- In provider cards and in priority route, replace placeholder Bot/Cloud renderings with the new mark component. GitHub card uses the GitHub mark.
- All images are decorative because the textual provider label remains. No network image requests.

## Verification and rollout
- UI tests verify brand assets, provider grid, route and GitHub logo are present; no provider credential behavior changed.
- Verified local M2: 178/178 Node tests, TypeScript check and frontend build passed. Native macOS release bundle built and side-by-side QA app updated. On launch macOS displayed a system Keychain Access permission dialog before the provider screen could render. The operator must choose access; no password or consent was entered by the agent. Full visual proof remains pending.
- Keep the code on a stacked Draft PR until macOS native visual QA and cross-device package checks succeed.
- No app release, main/dev merge, GitHub write scope or SSO issuer changes.
