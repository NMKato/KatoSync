# Beta UI and agreement hardening — 2026-11-22

## Changes

- The agreement is a separately testable React component. It places focus on the title, keeps Tab and Shift+Tab inside the active dialog, makes the background inert, and restores the invoking control and previous inert state on close. An already accepted agreement closes with Escape; an unaccepted agreement retains the explicit accept-or-quit choice.
- Agreement version `4.0.0-beta.1` describes Project Memory/RAG, Agent Sync, optional local models, external providers and Mesh. The product/data-flow sections and acceptance sentence are updated in German, English, Spanish and Russian. Provider, contact and the existing warranty/liability clauses are retained.
- The agreement version is separate from the application package version. Stored acceptance of `2.0.0` does not accept this revision. There is no consent migration, automatic acceptance, native permission call or device grant.
- The dialog explains that accepting terms leaves project, provider, device, MCP and operating-system access under their separate authorization.
- The light theme's primary action and secondary text had insufficient text contrast. Updated colors, visible keyboard outlines and solid dialog surfaces make the relevant states measurable.
- Dialog text uses spaced sections instead of nested cards. The original short-height whole-dialog scroll remains. Actions are at least 44 CSS pixels high, the checkbox is 24 by 24, and translated close buttons do not overlap the title.

## Verification

`node scripts/qa-beta-license-ui.mjs` renders the actual React component with actual CSS and the bundled logo. Callbacks and local storage are isolated test fixtures; no native or external requests occur.

Passed 24 combinations: DE/EN/ES/RU, light/dark, and 1380×860 / 1550×390 / 390×600. An additional accepted-dialog case verifies Escape and close-button placement.

Measured minimum text contrast in the sampled dialog/control states: **5.21:1 light**, **6.55:1 dark**. Measured keyboard-outline contrast: **5.54:1 light**, **8.83:1 dark**. The test waits for real CSS transitions to finish before measuring.

Checks cover initial focus, both tab directions, checkbox-controlled acceptance, focus stability after React rerender, footer reachability by keyboard, no header/body/footer overlap, no horizontal overflow, preserved background inert state and focus restoration. Test acceptance invokes only a synthetic callback and does not persist agreement acceptance.

- Node suite: **1056 passed, 0 failed**.
- TypeScript and Vite build: **passed**; existing large-chunk warning remains.
- Native WKWebView acceptance: separate required verification; Chromium does not establish native startup, actual signing, screen-reader support or complete WCAG conformance.

## Standards used for these bounded checks

- [WCAG 2.2 — Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [WCAG 2.2 — Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- [WCAG 2.2 — Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [WAI-ARIA — Modal Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

These checks are evidence for the changed controls, not a declaration of complete legal or accessibility compliance.

## Packaging findings

The existing private beta macOS builder validates a Developer ID signing team against the notarized fallback, checks bundled resource integrity, preserves the fallback, and optionally uses an existing Keychain notary profile. Its current native feature and provenance are Stage4J-specific; a UX4 integration build must accurately record its different feature set.

The selected source worktree has no generated `release-resources.lock.json`. Real resources and their integrity receipt must be prepared before the release resource gate can pass. A local ad-hoc signature is not a distributable Developer ID signature or Apple notarization. Windows Authenticode and native installer acceptance are separate gates.

Created by NMKato Solutions.
