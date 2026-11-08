# KatoSync PR backlog integration audit — 2026-11-08

> **Read-only GitHub and isolated Git merge-tree audit. Not a release approval.** Source snapshot: `NMKato/KatoSync`, all 151 open PR heads and all 480 available recent GitHub Actions workflow runs at audit time. The local merge-tree checks wrote no working-tree files or commits.

## Executive result
- **151 open PRs**: **148 drafts** and **3 marked ready for review**.
- PR target bases: **118 on other open PR branches**, **28 on `dev`**, **4 on `main`**, **1 on an older non-open base**. Only **34 graph leaves**; multiple long chains are not separate product releases.
- Snapshot CI on exact PR HEAD SHA: **145** with only successful *reported* workflows, **5 failures** (#183–187), **1 with no matching run** (#10). **43** heads had **Attribution Policy only**, which does **not** test the application; success must not be counted as a functional release gate. Report coverage includes the 480 runs returned from the Actions history as of the snapshot.
- `main` SHA at audit start: `435995ed890607e577dc99e83c3b0de0e491c81e`. `dev` SHA: `9c4f1948fbe56f599b67d0d30b71d7e50b67e53d`. At comparison, **65 commits ahead / 6 behind** when comparing `main...dev`. The branches have diverged.
- Actual **conflicts when trying to merge `dev` into current main**: `.github/workflows/pr-fast-gate.yml`, `AGENTS.md`, `src/App.tsx`, `src/styles.css`, `tsconfig.json`. Exactly these five names were also conflicted in a `main` + latest #240 Gate 9 merge-tree dry-run. The #88 security branch had seven conflicts, including `README.md` and `attribution-policy.yml`.
- **No feature PR was automatically merged.** No complete main-relative product QA or owner release approval exists for these stacked branches as a group. An isolated release integration branch, conflict reconciliation and end-to-end validation are required before a safe merge.

## Why the PRs accumulated
1. **Stacked drafts:** about 78 PRs are on the path ending at #240 (starting from #159, whose base is a previously closed branch). #223 shares much of that ancestry, not a second unrelated release. Another chain of about 34 ends at #158. Long histories were never collapsed into one reviewed integration PR.
2. **Split `dev` and `main`:** an old `dev` source lineage contains many features absent from current `main`; current `main` also has recent RC11/12 additions which must not be overwritten by older UI code.
3. **Explicit review / release holds:** #19 says not to auto-merge until a human verifies login and visuals. #240 says it is **QA-only, do not merge/release as KatoSync 4.0 beta** pending independent signing/approval. #88 introduces private security migrations that require dedicated review and rollout controls. Most other PRs remain intentionally marked Draft.
4. **Non-uniform CI coverage:** 43 heads have only the attribution check; other success reports test only the code on the PR's historical base, **not merged with today's main**.
5. **Five historical Windows red heads (#183–187):** logs show `D:\\D:\\...` duplicated path resolution, Bash-only test assumptions and CRLF drift on SHA-pinned SQL migrations. #188 describes and implements `fileURLToPath()`, POSIX-only execution restrictions, and exact `.gitattributes` LF rules; its newer **Windows Node Regression, Rust Format and Web Build jobs all succeeded**. Keep failures as immutable historical evidence, do not rewrite the old commits.
6. **200 registered local Git worktrees** were counted on one authorized Mac; several were prunable. They were not deleted, moved, or changed. The working tree had existing untracked files and local main was behind GitHub main, so it was left untouched. Worktree cleanup should be a separate backed-up, non-destructive inventory.

## Controlled integration rules
- **Never equate GitHub green with approval.** Require the exact current head SHA, complete native/macOS/Windows/node/web/Rust tests relevant to the changed code, security review for auth/mesh migrations, a conflict-free commit on current `main`, and named owner/reviewer approval where specified.
- Do not merge, deploy, execute or enable queued production Supabase migrations merely because tests apply them in an isolated QA database.
- Preserve the latest safe Remote Commander Usage UI/Client on `main` (RC11/12 already merged). Keep OAuth, Mesh, native process execution and device grants separately gated.
- **Suggested release plan:** (A) frozen `main` snapshot + restore point; (B) isolated QA integration of `dev` and the long Mesh/4.0 chain, replaying RC11/12 UI and resolving five known conflicts; (C) separately bring in GitHub/Continuity and #88 security branch after reviewing migrations; (D) full CI plus native hardware smoke, owner UI/auth acceptance, signed QA receipts; (E) one reviewed squash/merge per independently releasable cohort, then close all superseded PRs with links.
- Keep PRs open until a verified replacement includes their code. Do not dismiss an open security hold merely to reduce the PR count. Avoid forced `-X ours/theirs` merges on security or UI files.
- Future work: after a tested release PR merges, immediately close only superseded stacked drafts, attach evidence, and regularly sync `dev` to `main`.

## Complete open-PR inventory

Legend: `FAST_GATE_GREEN` = latest matched PR head run includes successful Fast Gate and no failed workflows in available history (still NOT release-approved); `ATTRIBUTION_ONLY` = no functional CI proof; `OTHER_GREEN` = successful other workflows but no Fast Gate; `FAILED` = one or more failed workflows; `NO_RUN` = no matching GitHub Actions run. `D` means Draft, `R` means marked ready. `STACKED` = base is another open PR branch.

| PR | Title | Base class | Review | Head CI | Explicit hold |
|---|---|---|---|---|---|
| [#10](https://github.com/NMKato/KatoSync/pull/10) | Provider failover: Codex → Claude → RDC queue | MAIN | R | NO_RUN | NO_CI_AND_CONFLICT |
| [#19](https://github.com/NMKato/KatoSync/pull/19) | Agent Sync: provider manager for Codex, Claude Code & local models (#11) | MAIN | R | ATTRIBUTION_ONLY | HUMAN_LOGIN_VISUAL_GATE |
| [#42](https://github.com/NMKato/KatoSync/pull/42) | feat: multi-API lane with cost-aware project planning | DEV | R | FAST_GATE_GREEN | MAIN_DEV_DIVERGENCE |
| [#59](https://github.com/NMKato/KatoSync/pull/59) | release: integrate Vision/Live Control and modern API lane | DEV | D | FAST_GATE_GREEN | — |
| [#62](https://github.com/NMKato/KatoSync/pull/62) | fix(control): bounded Claude auth-status probe for daemon health | MAIN | D | ATTRIBUTION_ONLY | — |
| [#63](https://github.com/NMKato/KatoSync/pull/63) | fix(continuation): visible failure recovery with explicit human gates | MAIN | D | ATTRIBUTION_ONLY | — |
| [#65](https://github.com/NMKato/KatoSync/pull/65) | feat(sbc): Secure Beta Check UI + read-only GitHub Issue Inbox | DEV | D | FAST_GATE_GREEN | — |
| [#75](https://github.com/NMKato/KatoSync/pull/75) | integration: validate unified Project Work Hub and Kato AI GPU dashboard on dev | DEV | D | FAST_GATE_GREEN | — |
| [#82](https://github.com/NMKato/KatoSync/pull/82) | security(#76): read-only registered Git project preflight with fail-closed tests | STACKED | D | FAST_GATE_GREEN | — |
| [#83](https://github.com/NMKato/KatoSync/pull/83) | security(#76): isolated fenced writer-lease PostgreSQL contract with race regression | STACKED | D | FAST_GATE_GREEN | — |
| [#84](https://github.com/NMKato/KatoSync/pull/84) | test(#76): isolated task-worktree regression candidate | STACKED | D | FAST_GATE_GREEN | — |
| [#85](https://github.com/NMKato/KatoSync/pull/85) | security(#76): private task-approval gate for fenced writer leases | STACKED | D | FAST_GATE_GREEN | — |
| [#86](https://github.com/NMKato/KatoSync/pull/86) | security(#76): backend approval broker contract and signed challenge tests | STACKED | D | FAST_GATE_GREEN | — |
| [#87](https://github.com/NMKato/KatoSync/pull/87) | security(#76): verify active Supabase sessions and signer-device ownership | STACKED | D | FAST_GATE_GREEN | — |
| [#88](https://github.com/NMKato/KatoSync/pull/88) | security(#76): private device ownership, project roles and atomic approval nonce | STACKED | D | FAST_GATE_GREEN | SECURITY_MIGRATION_APPROVAL |
| [#91](https://github.com/NMKato/KatoSync/pull/91) | feat(continuity): safe offline blueprint and decision import preview contract | DEV | D | FAST_GATE_GREEN | — |
| [#92](https://github.com/NMKato/KatoSync/pull/92) | feat(continuity): scoped Blueprint preview in Projects UI (DE/EN/ES/RU) | DEV | D | FAST_GATE_GREEN | — |
| [#93](https://github.com/NMKato/KatoSync/pull/93) | feat(continuity): native append-only offline journal in Memory Fabric (v2) | DEV | D | FAST_GATE_GREEN | — |
| [#94](https://github.com/NMKato/KatoSync/pull/94) | feat(continuity): explicit reviewed Blueprint → local journal proposal | DEV | D | FAST_GATE_GREEN | — |
| [#95](https://github.com/NMKato/KatoSync/pull/95) | feat(continuity): offline project timeline and manual ChatGPT context handoff | DEV | D | FAST_GATE_GREEN | — |
| [#96](https://github.com/NMKato/KatoSync/pull/96) | feat(continuity): local Gemma Q&A grounded in verified project Memory Fabric | DEV | D | FAST_GATE_GREEN | — |
| [#97](https://github.com/NMKato/KatoSync/pull/97) | feat(continuity): durable per-project offline Gemma chat with bounded follow-up context | DEV | D | FAST_GATE_GREEN | — |
| [#98](https://github.com/NMKato/KatoSync/pull/98) | feat(continuity): per-project pinned Blueprint + first 3 + last 20 context | DEV | D | FAST_GATE_GREEN | — |
| [#99](https://github.com/NMKato/KatoSync/pull/99) | feat(continuity): index Blueprint decisions and milestone checkpoints per project | DEV | D | FAST_GATE_GREEN | — |
| [#100](https://github.com/NMKato/KatoSync/pull/100) | feat(continuity): project-bound Feature Evidence Dossier with live source and Git checks | DEV | D | FAST_GATE_GREEN | — |
| [#101](https://github.com/NMKato/KatoSync/pull/101) | feat(continuity): per-project weighted MVP tracking with separate side tasks | DEV | D | FAST_GATE_GREEN | — |
| [#102](https://github.com/NMKato/KatoSync/pull/102) | feat(ui): compact Top 3 project MVP overview with nested details and scrolling overflow | DEV | D | FAST_GATE_GREEN | — |
| [#103](https://github.com/NMKato/KatoSync/pull/103) | feat(continuity): correlate project MVP tasks with bounded local test receipt claims | DEV | D | FAST_GATE_GREEN | — |
| [#104](https://github.com/NMKato/KatoSync/pull/104) | feat(continuity): authenticated GitHub workflow/job evidence for project MVP dossiers | DEV | D | FAST_GATE_GREEN | — |
| [#105](https://github.com/NMKato/KatoSync/pull/105) | feat(continuity): exact MVP-feature CI gate matrix with fail-closed evidence checks | DEV | D | FAST_GATE_GREEN | — |
| [#106](https://github.com/NMKato/KatoSync/pull/106) | feat(continuity): validate MVP CI coverage against immutable project Git policy | DEV | D | FAST_GATE_GREEN | — |
| [#107](https://github.com/NMKato/KatoSync/pull/107) | feat(projects): optional local-first kickoff with Blueprint-to-Issue preview | DEV | D | FAST_GATE_GREEN | — |
| [#108](https://github.com/NMKato/KatoSync/pull/108) | feat(projects): optional read-only GitHub repository/Projects/Issue inventory | DEV | D | FAST_GATE_GREEN | — |
| [#109](https://github.com/NMKato/KatoSync/pull/109) | feat(projects): paginated GitHub inventory and guarded kickoff review plan | DEV | D | FAST_GATE_GREEN | — |
| [#110](https://github.com/NMKato/KatoSync/pull/110) | feat(projects): attest repository-linked GitHub Projects v2 with read-only GraphQL | DEV | D | FAST_GATE_GREEN | — |
| [#111](https://github.com/NMKato/KatoSync/pull/111) | feat(github): optional GitHub App device sign-in with native OS keychain | DEV | D | FAST_GATE_GREEN | — |
| [#112](https://github.com/NMKato/KatoSync/pull/112) | fix(github): bind GitHub App credentials to verified KatoSync users | DEV | D | FAST_GATE_GREEN | — |
| [#113](https://github.com/NMKato/KatoSync/pull/113) | test(github): isolated native macOS QA app for optional GitHub login | DEV | D | FAST_GATE_GREEN | — |
| [#115](https://github.com/NMKato/KatoSync/pull/115) | feat(github): connect optional GitHub App from existing signed-in KatoSync session | DEV | D | FAST_GATE_GREEN | — |
| [#117](https://github.com/NMKato/KatoSync/pull/117) | fix(auth): refresh expired KatoSync access token for GitHub OAuth | STACKED | D | ATTRIBUTION_ONLY | — |
| [#118](https://github.com/NMKato/KatoSync/pull/118) | feat(github): compact direct GitHub card alongside AI providers | STACKED | D | ATTRIBUTION_ONLY | — |
| [#119](https://github.com/NMKato/KatoSync/pull/119) | feat(providers): use branded OpenAI, Claude and GitHub icons in KatoSync | STACKED | D | ATTRIBUTION_ONLY | — |
| [#120](https://github.com/NMKato/KatoSync/pull/120) | feat(github): read authorized GitHub App repositories and open issues | STACKED | D | ATTRIBUTION_ONLY | — |
| [#121](https://github.com/NMKato/KatoSync/pull/121) | feat(github): readable repository cards and safe issue-to-chat drafts | STACKED | D | ATTRIBUTION_ONLY | — |
| [#122](https://github.com/NMKato/KatoSync/pull/122) | fix(github): stop repository button overlap; expand loaded grid to available width | STACKED | D | ATTRIBUTION_ONLY | — |
| [#123](https://github.com/NMKato/KatoSync/pull/123) | feat(chat): project-scoped Master Chat and review-only GitHub issue handoff | STACKED | D | ATTRIBUTION_ONLY | — |
| [#124](https://github.com/NMKato/KatoSync/pull/124) | feat(mvp): safe per-user Codex/Claude read-only dispatch and durable receipts | STACKED | D | ATTRIBUTION_ONLY | — |
| [#128](https://github.com/NMKato/KatoSync/pull/128) | fix(beta): isolate and display safe read-only dispatch preflight failures | STACKED | D | ATTRIBUTION_ONLY | — |
| [#131](https://github.com/NMKato/KatoSync/pull/131) | fix(chat): verified recovery for legacy Memory Fabric and moved Git roots | STACKED | D | ATTRIBUTION_ONLY | — |
| [#134](https://github.com/NMKato/KatoSync/pull/134) | feat(local-brain): verified offline Gemma Vision, richer chat and macOS dictation | STACKED | D | ATTRIBUTION_ONLY | — |
| [#135](https://github.com/NMKato/KatoSync/pull/135) | fix(chat): stoppable local STT, macOS permission helper bundle and Calm Glass UX | STACKED | D | ATTRIBUTION_ONLY | — |
| [#136](https://github.com/NMKato/KatoSync/pull/136) | fix(chat): reliable repeated offline dictation and compact glass composer | STACKED | D | ATTRIBUTION_ONLY | — |
| [#137](https://github.com/NMKato/KatoSync/pull/137) | feat(chat): readable grounded Gemma responses, safe JSON adapter and ephemeral visual previews | STACKED | D | ATTRIBUTION_ONLY | — |
| [#138](https://github.com/NMKato/KatoSync/pull/138) | feat(chat): adaptive human-readable answers, tables and source-gated charts | STACKED | D | ATTRIBUTION_ONLY | — |
| [#139](https://github.com/NMKato/KatoSync/pull/139) | fix(chat): recover one-line Gemma Markdown comparison tables | STACKED | D | ATTRIBUTION_ONLY | — |
| [#140](https://github.com/NMKato/KatoSync/pull/140) | feat(mesh): local read-only readiness, truthful device trust status (stage 0) | STACKED | D | ATTRIBUTION_ONLY | — |
| [#141](https://github.com/NMKato/KatoSync/pull/141) | feat(mesh): verified Ed25519 device identity and five-minute signed invitations (stage 1A) | STACKED | D | ATTRIBUTION_ONLY | — |
| [#142](https://github.com/NMKato/KatoSync/pull/142) | feat(mesh): offline mutual key possession proof with one-time challenge and SAS (stage 1B) | STACKED | D | ATTRIBUTION_ONLY | — |
| [#143](https://github.com/NMKato/KatoSync/pull/143) | feat(mesh): explicit persistent per-user peer pins and revoke (stage 1C) | STACKED | D | ATTRIBUTION_ONLY | — |
| [#144](https://github.com/NMKato/KatoSync/pull/144) | feat(mesh): strict TLS 1.3 AES-256 mTLS crypto core with approved Ed25519 peer pins (stage 2A) | STACKED | D | ATTRIBUTION_ONLY | — |
| [#145](https://github.com/NMKato/KatoSync/pull/145) | fix(auth): verify existing KATOOS identity in isolated KatoSync Mesh QA; display non-privileged Family badge | STACKED | D | ATTRIBUTION_ONLY | — |
| [#146](https://github.com/NMKato/KatoSync/pull/146) | fix(github): recover from missing M2 App status with safe diagnosis and retry | STACKED | D | ATTRIBUTION_ONLY | — |
| [#147](https://github.com/NMKato/KatoSync/pull/147) | fix(github): automatically finish Device Flow and safely rotate expiring GitHub App tokens | STACKED | D | ATTRIBUTION_ONLY | — |
| [#148](https://github.com/NMKato/KatoSync/pull/148) | fix(github): safe GitHub App inventory API diagnostics after real M2/M3 read-only QA | STACKED | D | ATTRIBUTION_ONLY | — |
| [#149](https://github.com/NMKato/KatoSync/pull/149) | fix(mesh): safe account/keychain diagnosis after physical M2/M3 device-key preparation fails | STACKED | D | ATTRIBUTION_ONLY | — |
| [#150](https://github.com/NMKato/KatoSync/pull/150) | fix(mesh): diagnose KATOOS session verification failure safely on M2 QA | STACKED | D | ATTRIBUTION_ONLY | — |
| [#153](https://github.com/NMKato/KatoSync/pull/153) | feat(mesh): guided one-click invitation UI without implicit trust | STACKED | D | ATTRIBUTION_ONLY | — |
| [#154](https://github.com/NMKato/KatoSync/pull/154) | feat(mesh): account-scoped Auto-Mesh enrollment policy groundwork | STACKED | D | ATTRIBUTION_ONLY | — |
| [#155](https://github.com/NMKato/KatoSync/pull/155) | feat(mesh): fail-closed account device registry and read-only discovery | STACKED | D | ATTRIBUTION_ONLY | — |
| [#156](https://github.com/NMKato/KatoSync/pull/156) | fix(mesh): recover isolated KATOOS QA session without clearing GitHub or device keys | STACKED | D | ATTRIBUTION_ONLY | — |
| [#157](https://github.com/NMKato/KatoSync/pull/157) | fix(mesh/auth): serialize KATOOS refresh rotation and prevent stale QA success | STACKED | D | ATTRIBUTION_ONLY | — |
| [#158](https://github.com/NMKato/KatoSync/pull/158) | feat(mesh): compact one-click Vision controls with truthful disconnect status | STACKED | D | ATTRIBUTION_ONLY | — |
| [#159](https://github.com/NMKato/KatoSync/pull/159) | refactor(ui): centralize Mesh, GitHub and AI connections in Provider | EXTERNAL_PARENT | D | ATTRIBUTION_ONLY | — |
| [#160](https://github.com/NMKato/KatoSync/pull/160) | feat(mesh): signed account-bound device discovery with server-only enrollment | STACKED | D | ATTRIBUTION_ONLY | — |
| [#161](https://github.com/NMKato/KatoSync/pull/161) | feat(mesh): safe local preferred-hub setting for Hybrid Mesh | STACKED | D | ATTRIBUTION_ONLY | — |
| [#162](https://github.com/NMKato/KatoSync/pull/162) | feat(mesh): private owner-scoped Realtime signaling policy and strict public envelopes | STACKED | D | ATTRIBUTION_ONLY | — |
| [#163](https://github.com/NMKato/KatoSync/pull/163) | feat(connections): safe one-click refresh for AI, GitHub and Mesh status | STACKED | D | ATTRIBUTION_ONLY | — |
| [#164](https://github.com/NMKato/KatoSync/pull/164) | fix(auth): recover 403 bad_jwt KATOOS sessions — M2/M3 live QA verified | STACKED | D | ATTRIBUTION_ONLY | — |
| [#165](https://github.com/NMKato/KatoSync/pull/165) | fix(security): dependency advisories, stacked-PR CI coverage and OSS readiness | STACKED | D | FAST_GATE_GREEN | — |
| [#166](https://github.com/NMKato/KatoSync/pull/166) | feat(mesh): strict pinned TLS 1.3 probe over real TCP — Stage 2B | STACKED | D | FAST_GATE_GREEN | — |
| [#167](https://github.com/NMKato/KatoSync/pull/167) | test(mesh): two-Mac pinned TLS 1.3 LAN E2E QA — Stage 2C | STACKED | D | FAST_GATE_GREEN | — |
| [#168](https://github.com/NMKato/KatoSync/pull/168) | feat(mesh): owner-scoped Keychain admission gate before real-peer mTLS (Stage 2D) | STACKED | D | FAST_GATE_GREEN | — |
| [#169](https://github.com/NMKato/KatoSync/pull/169) | feat(mesh): enforce same-owner two-device enrollment before mTLS (Stage 2E) | STACKED | D | FAST_GATE_GREEN | — |
| [#170](https://github.com/NMKato/KatoSync/pull/170) | test(mesh): isolated PostgreSQL 17 RLS QA + revoked-key enrollment defense (Stage 2F) | STACKED | D | FAST_GATE_GREEN | — |
| [#171](https://github.com/NMKato/KatoSync/pull/171) | feat(mesh): live KatoSync-only Supabase schema, owner RLS and API routing | STACKED | D | FAST_GATE_GREEN | — |
| [#172](https://github.com/NMKato/KatoSync/pull/172) | feat(mesh): live Edge enrollment with KatoSync account allowlist (Stage 2H) | STACKED | D | FAST_GATE_GREEN | — |
| [#173](https://github.com/NMKato/KatoSync/pull/173) | build(mesh): signed isolated QA app on M2/M3 + real enrollment E2E (Stage 2I) | STACKED | D | FAST_GATE_GREEN | — |
| [#174](https://github.com/NMKato/KatoSync/pull/174) | fix(branding): centered 3D KatoSync app icon + duplicate-install cleanup (Stage 2J) | STACKED | D | FAST_GATE_GREEN | — |
| [#175](https://github.com/NMKato/KatoSync/pull/175) | fix(readonly): recover CLI lookup and persist categorized job receipts (P0 QA) | STACKED | D | FAST_GATE_GREEN | — |
| [#176](https://github.com/NMKato/KatoSync/pull/176) | fix(release): Windows bundled PDF tools + fail-closed release resource QA (Stage 2K) | STACKED | D | FAST_GATE_GREEN | — |
| [#177](https://github.com/NMKato/KatoSync/pull/177) | feat(mesh): signed recipient-bound inbox delivery foundation (Stage 2L) | STACKED | D | FAST_GATE_GREEN | — |
| [#178](https://github.com/NMKato/KatoSync/pull/178) | feat(mesh): native recipient-bound invite signing and QA preparation UI (Stage 2M) | STACKED | D | FAST_GATE_GREEN | — |
| [#179](https://github.com/NMKato/KatoSync/pull/179) | feat(mesh): QA-gated native inbox send and strict non-trust receipt (Stage 2N) | STACKED | D | FAST_GATE_GREEN | — |
| [#180](https://github.com/NMKato/KatoSync/pull/180) | feat(mesh): device-attested inbox and atomic recipient decisions (Stage 2O) | STACKED | D | FAST_GATE_GREEN | — |
| [#181](https://github.com/NMKato/KatoSync/pull/181) | fix(mesh): require target-device proof for inbox decisions (Stage 2O.1) | STACKED | D | FAST_GATE_GREEN | — |
| [#182](https://github.com/NMKato/KatoSync/pull/182) | test(mesh): two-Mac synthetic pinned mTLS and wrong-pin rejection (Stage 2P) | STACKED | D | FAST_GATE_GREEN | — |
| [#183](https://github.com/NMKato/KatoSync/pull/183) | test(mesh): fail-closed inbox schema and Edge predeployment gate (Stage 2Q) | STACKED | D | FAILED | — |
| [#184](https://github.com/NMKato/KatoSync/pull/184) | fix(mesh): verify sender roster and both signatures before inbox LIST (Stage 2R) | STACKED | D | FAILED | — |
| [#185](https://github.com/NMKato/KatoSync/pull/185) | fix(mesh): enforce recipient public-key continuity across inbox proof and decision (Stage 2S) | STACKED | D | FAILED | — |
| [#186](https://github.com/NMKato/KatoSync/pull/186) | test(mesh): run signed sender/recipient Edge E2E against real ephemeral PostgreSQL (Stage 2T) | STACKED | D | FAILED | — |
| [#187](https://github.com/NMKato/KatoSync/pull/187) | test(mesh): real M2↔M3 signed invite/recipient proof over pinned TLS 1.3 (Stage 2U) | STACKED | D | FAILED | — |
| [#188](https://github.com/NMKato/KatoSync/pull/188) | fix(ci): preserve pinned SQL SHA-256 and cross-platform Mesh QA subprocess paths (Stage 2V) | STACKED | D | FAST_GATE_GREEN | — |
| [#189](https://github.com/NMKato/KatoSync/pull/189) | test(mesh): immutable offline Edge bundle/source review before shared-Supabase QA rollout (Stage 2W) | STACKED | D | FAST_GATE_GREEN | — |
| [#190](https://github.com/NMKato/KatoSync/pull/190) | test(mesh): execute fail-closed Edge entrypoints and require shared-DB recovery gate (Stage 2X) | STACKED | D | FAST_GATE_GREEN | — |
| [#191](https://github.com/NMKato/KatoSync/pull/191) | test(mesh): verify live physical backup inventory & PITR safely before shared Supabase rollout (Stage 2Y) | STACKED | D | FAST_GATE_GREEN | — |
| [#192](https://github.com/NMKato/KatoSync/pull/192) | test(mesh): real disposable PostgreSQL signed Inbox restore drill and clone side-effect gate (Stage 2Z) | STACKED | D | FAST_GATE_GREEN | — |
| [#193](https://github.com/NMKato/KatoSync/pull/193) | test(mesh): isolate synthetic Cloud-QA fixture and deny cron/net side effects (Stage 3A) | STACKED | D | FAST_GATE_GREEN | — |
| [#194](https://github.com/NMKato/KatoSync/pull/194) | test(mesh): run real Deno loopback HTTP for both Edge inbox handlers (Stage 3B) | STACKED | D | FAST_GATE_GREEN | — |
| [#195](https://github.com/NMKato/KatoSync/pull/195) | test(mesh): real native two-Mac mTLS hardware and wrong-pin negative QA (Stage 3C) | STACKED | D | FAST_GATE_GREEN | — |
| [#196](https://github.com/NMKato/KatoSync/pull/196) | test(mesh): join signed SAS, explicit two-sided peer approval, native mTLS and revoke (Stage 3D) | STACKED | D | FAST_GATE_GREEN | — |
| [#197](https://github.com/NMKato/KatoSync/pull/197) | feat(mesh): guided device selection and visible QA inbox in Connections card (Stage 3E) | STACKED | D | FAST_GATE_GREEN | — |
| [#198](https://github.com/NMKato/KatoSync/pull/198) | fix(mesh): fail-closed Inbox double-click, expiry and stale account race (Stage 3F) | STACKED | D | FAST_GATE_GREEN | — |
| [#199](https://github.com/NMKato/KatoSync/pull/199) | feat(mesh): verified Inbox offer handoff to explicit signed device challenge (Stage 3G) | STACKED | D | FAST_GATE_GREEN | — |
| [#200](https://github.com/NMKato/KatoSync/pull/200) | feat(mesh): staged signed two-way Challenge/Response relay with isolated PostgreSQL QA (Stage 3H) | STACKED | D | FAST_GATE_GREEN | — |
| [#201](https://github.com/NMKato/KatoSync/pull/201) | feat(mesh): connect signed pairing relay to QA-gated Tauri IPC and Mesh UI (Stage 3I) | STACKED | D | FAST_GATE_GREEN | — |
| [#202](https://github.com/NMKato/KatoSync/pull/202) | test(mesh): cross-language Rust Ed25519 → Edge WebCrypto relay QA (Stage 3J) | STACKED | D | FAST_GATE_GREEN | — |
| [#203](https://github.com/NMKato/KatoSync/pull/203) | test(mesh): Rust Ed25519 → Edge → real disposable PostgreSQL E2E (Stage 3K) | STACKED | D | FAST_GATE_GREEN | — |
| [#204](https://github.com/NMKato/KatoSync/pull/204) | test(mesh): synthetic signed JWT over loopback HTTP into Rust→Edge→Postgres (Stage 3L) | STACKED | D | FAST_GATE_GREEN | — |
| [#205](https://github.com/NMKato/KatoSync/pull/205) | test(mesh): fail-closed Supabase tenant/origin boundary for isolated relay QA (Stage 3M) | STACKED | D | FAST_GATE_GREEN | — |
| [#206](https://github.com/NMKato/KatoSync/pull/206) | test(mesh): tenant-bound Relay LIST v2 protocol QA (Stage 3N) | STACKED | D | FAST_GATE_GREEN | — |
| [#207](https://github.com/NMKato/KatoSync/pull/207) | test(mesh): isolated read-only preview readiness for Inbox and Enrollment (Stage 3O) | STACKED | D | FAST_GATE_GREEN | — |
| [#208](https://github.com/NMKato/KatoSync/pull/208) | test(mesh): tenant-bound Enrollment v2 Rust-to-Edge QA (Stage 3P) | STACKED | D | FAST_GATE_GREEN | — |
| [#209](https://github.com/NMKato/KatoSync/pull/209) | test(mesh): tenant-origin Inbox v2 Rust-to-Edge verification (Stage 3Q) | STACKED | D | FAST_GATE_GREEN | — |
| [#210](https://github.com/NMKato/KatoSync/pull/210) | feat(mesh): native issuer boundary diagnostics on M2/M3 QA (Stage 3R) | STACKED | D | FAST_GATE_GREEN | — |
| [#211](https://github.com/NMKato/KatoSync/pull/211) | feat(mesh): isolated Preview GoTrue auth + dedicated Keychain in native QA (Stage 3S) | STACKED | D | FAST_GATE_GREEN | — |
| [#212](https://github.com/NMKato/KatoSync/pull/212) | test(mesh): Rust GoTrue HTTP loopback and per-project Preview keychain isolation (Stage 3T) | STACKED | D | FAST_GATE_GREEN | — |
| [#213](https://github.com/NMKato/KatoSync/pull/213) | feat(mesh): KATOOS SSO → existing katosync schema read-only preflight (Stage 3U) | STACKED | D | FAST_GATE_GREEN | — |
| [#214](https://github.com/NMKato/KatoSync/pull/214) | test(mesh): shared KATOOS schema migration compatibility and offline rollout gate (Stage 3V) | STACKED | D | FAST_GATE_GREEN | — |
| [#215](https://github.com/NMKato/KatoSync/pull/215) | test(mesh): shared KATOOS eight-table recovery rehearsal (Stage 3W) | STACKED | D | FAST_GATE_GREEN | — |
| [#216](https://github.com/NMKato/KatoSync/pull/216) | feat(mesh): record approved KATOOS production migrations and isolated Stage3X QA app | STACKED | D | FAST_GATE_GREEN | — |
| [#217](https://github.com/NMKato/KatoSync/pull/217) | fix(mesh): isolate Stage3X macOS QA Keychain, app data and LaunchAgent before signing | STACKED | D | FAST_GATE_GREEN | — |
| [#218](https://github.com/NMKato/KatoSync/pull/218) | fix(mesh): secure timestamp, Apple notarization gate and signed Stage3X QA verification (Stage 3Z) | STACKED | D | FAST_GATE_GREEN | — |
| [#219](https://github.com/NMKato/KatoSync/pull/219) | fix(mesh): Apple notarization nested STT helper inside-out signing (Stage 4A) | STACKED | D | FAST_GATE_GREEN | — |
| [#220](https://github.com/NMKato/KatoSync/pull/220) | fix(mesh): distinguish device quota from KATOOS registry outage (Stage 4B) | STACKED | D | FAST_GATE_GREEN | — |
| [#221](https://github.com/NMKato/KatoSync/pull/221) | feat(mesh): Free zero, Pro ten devices with server-side enrollment gates (Stage 4C) | STACKED | D | FAST_GATE_GREEN | — |
| [#222](https://github.com/NMKato/KatoSync/pull/222) | feat(mesh): signed Stage 3.5 agents and verified two-Mac cloud presence | STACKED | D | FAST_GATE_GREEN | — |
| [#223](https://github.com/NMKato/KatoSync/pull/223) | fix(mesh): explicit SAS approval after signed Stage35 relay | STACKED | D | FAST_GATE_GREEN | — |
| [#225](https://github.com/NMKato/KatoSync/pull/225) | docs: KatoSync 4.0 Agent Birth & Activation release roadmap | STACKED | D | ATTRIBUTION_ONLY | — |
| [#227](https://github.com/NMKato/KatoSync/pull/227) | feat(katosync40): one-click local setup and secure movable widget preview | STACKED | D | FAST_GATE_GREEN | — |
| [#228](https://github.com/NMKato/KatoSync/pull/228) | feat(widget): approved Kato AI emblem and amber-glass desktop design | STACKED | D | FAST_GATE_GREEN | — |
| [#230](https://github.com/NMKato/KatoSync/pull/230) | feat(katosync40): smart roadmap progress, live job evidence and cautious ETA | STACKED | D | FAST_GATE_GREEN | — |
| [#231](https://github.com/NMKato/KatoSync/pull/231) | feat(katosync40): trust-gated feature acceptance ledger foundation | STACKED | D | FAST_GATE_GREEN | — |
| [#232](https://github.com/NMKato/KatoSync/pull/232) | feat(katosync40): native append-only staging for signed acceptance receipts | STACKED | D | FAST_GATE_GREEN | — |
| [#233](https://github.com/NMKato/KatoSync/pull/233) | feat(katosync40): read-only GitHub CI and Git ancestry corroboration for pending acceptance | STACKED | D | FAST_GATE_GREEN | — |
| [#234](https://github.com/NMKato/KatoSync/pull/234) | feat(katosync40): native scope digest and exact feature-CI acceptance gate | STACKED | D | FAST_GATE_GREEN | — |
| [#235](https://github.com/NMKato/KatoSync/pull/235) | feat(katosync40): issuer-signed project owner approval authority gate | STACKED | D | FAST_GATE_GREEN | — |
| [#236](https://github.com/NMKato/KatoSync/pull/236) | feat(katosync40): fail-closed KATOOS project approver authority backend | STACKED | D | FAST_GATE_GREEN | — |
| [#237](https://github.com/NMKato/KatoSync/pull/237) | feat(katosync40): pin QA issuer Ed25519 key and verify owner key possession | STACKED | D | FAST_GATE_GREEN | — |
| [#238](https://github.com/NMKato/KatoSync/pull/238) | feat(katosync40): one-time owner challenge with independent admin review gate | STACKED | D | FAST_GATE_GREEN | — |
| [#239](https://github.com/NMKato/KatoSync/pull/239) | feat(katosync40): append-only native verified acceptance ledger v6 (QA-gated) | STACKED | D | FAST_GATE_GREEN | — |
| [#240](https://github.com/NMKato/KatoSync/pull/240) | feat(katosync40): require independently signed reviewer attestation (Gate 9) | STACKED | D | FAST_GATE_GREEN | EXPLICIT_QA_NO_MERGE |

## Audit scope limits

All 151 PRs were enumerated from the GitHub open-PR API and correlated by exact `head.sha` with the available workflow-run history. The audit did **not** claim to perform line-by-line review of every diff or an independent native test against `main` for all 151 branches. GitHub can report `mergeable=true` *relative to each historical target*, which cannot establish conflict freedom against the current `main`. Targeted real Git `merge-tree` checks identify concrete conflicts for the main integration candidates. No production DB or worker was accessed for mutation.
