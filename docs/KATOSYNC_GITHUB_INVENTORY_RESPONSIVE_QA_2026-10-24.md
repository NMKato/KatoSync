# KatoSync GitHub Provider — responsive grid and targeted review (2026-10-24)

## Native operator report
Screenshots showed GitHub App connected to NMKato and inventory loaded. Repository cards were being clipped horizontally: e.g. an “Offene Issues” button from the preceding tile leaked over Chatbot, and some tile labels were cut at the left border. The provider dashboard also left a large unused right column after loading repositories.

## Root cause
- Old shared CSS selector `.github-app-inventory-list li` used `flex-wrap: wrap`. The newer tiles used `flex-direction: column` but had not reset the inherited wrapping. With constrained card dimensions, the browser placed the button in another flex column and it overflowed the tile.
- The GitHub provider occupied only one of two provider-dashboard columns even when the child inventory was loaded. The nested two-column grid therefore had inadequate space.

## Focused implementation
- Repository tiles now use explicit single-column CSS Grid for title, ownership/visibility, and issue button. This avoids inherited flex wrapping and keeps button/link geometry inside its own tile.
- After GitHub inventory is loaded, `.provider-cards > .github-provider-card:has(.github-app-inventory-result)` spans the entire available provider grid. Before loading, the card remains compact, preserving the existing provider overview.
- Inventory tiles now use auto-fit/minmax(220px) at desktop widths and one column at narrow widths. Internal size limits and overflow guards prevent horizontal navigation and cross-card overlays.
- No changes to Github App scopes, authentication, Supabase issuer, keychain, repository canonical name, Rust commands, issue read pagination, project creation, agent queue or remote write permissions.

## Review / verification
- Actual Chromium+production CSS layout checks passed for 375, 550, 780, 1030, 1140 and 1510px, each with loaded and unloaded inventories: **12/12**. Measured card/button/link bounding boxes and horizontal overflow (0 failures).
- The test originally reproduced exactly the sideways button overflow at 375px. The grid correction removed it.
- 186 Node regression tests passed, including three new explicit tests for full-width expansion, intrinsic tile grid and disabled Autostart.
- 160 Rust library tests passed; 7 intentionally ignored. TypeScript + Vite pass; rustfmt and git diff check pass.
- Native Tauri macOS bundle and re-signed test app are the remaining package QA steps; UI should be re-checked on M2 after operator handles any macOS Keychain permission prompt.

## Security gates unchanged
- GitHub remains a read-only App user access path, with original canonical owner/repo passed to backend and no token sent to frontend; this fix changes CSS and layout assertions only.
- PR #121 remains Draft; no merge to dev/main and no autonomous writes. SSO issue #114 and secure writer gate #76 are still open.
- Master Chat injection/handoff and M2/M3 mesh are outside the scope of this visual hotfix.
