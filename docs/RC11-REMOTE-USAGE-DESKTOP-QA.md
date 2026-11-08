# RC-11 – Remote Commander Usage UI (KatoSync Desktop)

Date: 2026-11-08. Status: **isolated UI Draft / no live KatoOS API**.

A distinct "Remote Commander – Nutzung" panel is added to the existing
**Einstellungen** screen, after the existing "API-Kontingent" panel. This
deliberately avoids conflating Mistral/API rate limits with Remote MCP
Tool Calls. The panel supports KatoSync's DE/EN/ES/RU language setting,
Dark/Light color tokens and a responsive six-month bar chart.

## Current behavior
- The UI defaults to "No live usage data available yet" and a clear
  explanation that protected Remote MCP identity + Usage API are disabled.
- NO default zeros, Remote Desktop Commander screenshot values or
  fictitious Pro account/usage data.
- Future data props require an owner-scoped, authenticated,
  schema-validated `RemoteUsageOverview` and `RemoteUsageHistory`.
- With actual data it renders total calls, daily mean, Free/Pro quota,
  remaining calls, UTC month, quota denials, 6-month history and safe
  breakdowns by tool, client and device. Raw device IDs are not shown
  until the authorized KatoSync naming directory is wired.
- All frontend data contracts in `src/lib/remoteUsage.ts`. Their
  standalone tests deny fake live snapshots and malformed quota data.

## Explicitly NOT connected yet
- No KatoOS OAuth 2.1 sign-in/token acquisition and no live Usage API
  request; this branch makes no remote calls and stores no new credentials.
- No URL/browser override, no cross-tenant filtering in the client.
  The server is authoritative for identity, tenant, tier and counts.
- No automatic update to notarized Stage35 production/QA app.
  Rebase carefully onto current Stage35+ UI before merge; this branch is
  based on the currently checked-out KatoSync main at commit 8bbdc1a.

## Test commands
- `npm ci --ignore-scripts --no-audit --no-fund`
- `npm run test:remote-usage`
- `npm run build` (TypeScript + Vite)

Next: connect to the reviewed authenticated owner-only Gateway API,
refresh on account switch, reject stale responses and support an honest
offline/error state. Roadmap #242.
