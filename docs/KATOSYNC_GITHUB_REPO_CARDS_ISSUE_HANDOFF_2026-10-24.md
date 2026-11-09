# KatoSync GitHub repo tiles and safe issue-to-chat handoff (2026-10-24)

## Operator feedback
Real macOS screenshots from the normal Github App provider card show that 43 authorized repositories load successfully via App credentials, and GENXLine's open issues can be fetched. The full owner/repo strings are visually noisy; the operator requested a compact connected tile/grid, clear project title, small owner and visibility marker, and an intuitive route from Issue to chat or automated execution.

## MVP implementation
- Exactly the same GitHub App credential and verified KatoSync user boundary; no added GitHub permissions or account migration.
- Two-column repo tile grid within the existing provider card; secondary owner and Private/Public metadata, repo title enlarged and humanized for display only. Original canonical full owner/repo continues to power all API commands and links.
- Manual search over already-loaded local repo metadata; no extra network requests, no new database.
- Issue results remain read-only. The operator can explicitly request page 2-10 (30 Github API items per page). Each call rechecks the App installation, canonical repo membership and user-token. GitHub issue endpoint also returns pull requests, so displayed issue counts may be fewer than HTTP page size. 10-page bound, no background crawl.
- Each Issue can be selected for a *preview-only* chat draft with an editable operator note. Copy to clipboard only after a direct button click; no automatic master-chat send and no task execution. Source issue metadata is untrusted and the draft explicitly requests safety review before writes.
- Autostart is rendered disabled with an explanation. Existing writer authorization Issue #76 remains a hard gate.

## Verified and outstanding
- 183 Node regression tests, TypeScript and Vite build PASS.
- Rust lib 160 PASS and 7 intentionally ignored; rustfmt check PASS.
- Native macOS packaging plus actual UI screenshot acceptance still required.
- Existing KATOOS federation issue #114, real chat routing and writer execution #76 remain; do not claim end-to-end master chat or mesh from the draft UI.
- Change is stacked on PR #120 and is review-only, not a main/dev production merge.
