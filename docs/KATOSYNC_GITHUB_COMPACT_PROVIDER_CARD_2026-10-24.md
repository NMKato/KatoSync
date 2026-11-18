# KatoSync GitHub provider card — MVP UX correction (2026-10-24)

## User-observed native evidence
- Real screenshots: initially GitHub App device-connect button was hidden inside collapsed optional details; after user GitHub consent, UI reported connected GitHub account NMKato and displayed local disconnect control.
- This demonstrates successful user flow and local connected status, not that the app OAuth credential is yet used for repository inventory; legacy GitHub CLI remains.
- Requested UX: no full-width button/long prose, GitHub card adjacent to OpenAI/Claude provider cards, show code steps only after clicking, help behind expandable info.

## Implementation
- Normal Agent Sync provider grid includes GithubAppConnectionPanel variant provider before Local Model; explicit authenticated KatoSync session gate remains.
- Compact heading, connected status, intrinsic-width primary action, details-based help closed by default; approved Device Flow code/check/cancel only after intentional Connect.
- The existing project kickoff and isolated QA nested variants remain unchanged.
- DE/EN/ES/RU labels. No changes to Rust OAuth, keychain, account issuer, scopes, GitHub writers, queue or local brain.

## Verification and gates
- 175 Node tests passed, including card placement/width contract; TypeScript, Vite and diff checks passed. Native macOS Tauri bundle built successfully.
- Side-by-side M2 QA app updated, old preview retained under target/qa-backups; original /Applications/KatoSync.app unchanged.
- On native relaunch macOS requested Documents folder permission. Human must choose; do not auto-grant. Provider card screenshot validation is pending until dialog cleared.
- Draft/stacked only: no main/dev production merge. KATOOS SSO issue #114 and autonomous writer issue #76 remain open.

## Next
1. Operator handles macOS Documents permission prompt.
2. Verify connected GitHub account NMKato after restart and optional info collapsed.
3. Inspect account logout/restore and app-backed read-only GitHub repository inventory, without adding writer scopes.
4. Persistent Master Chat is separate MVP integration/test lane.
