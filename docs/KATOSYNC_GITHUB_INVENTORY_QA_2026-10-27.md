# KatoSync GitHub App Read-only Inventory — real M2/M3 QA

## Live evidence (27 October 2026)
- The user confirmed authenticated GitHub App in the M2 isolated KatoSync Mesh QA, with issuer-verified KATOOS Family badge, working Codex and Claude Code local READY checks.
- On M2, Desktop Commander accessibility automation pressed the actual "Repositories abrufen" button inside the running KatoSync Mesh QA process (read-only; no repo or credentials changed). The UI returned "GitHub-Projekte konnten nicht geladen werden".
- The same read-only button was pressed on M3 in its still-running isolated Mesh QA; the same failure was displayed. Thus OAuth connection succeeded, but no GitHub App repo inventory end-to-end is verified on either node.
- The existing frontend suppressed all inventory errors behind a generic status; a successful GitHub login or a CLI login alone does NOT verify access to the user-scoped app installations and their repositories.
- Official GitHub API documentation confirms GET /user/installations accepts GitHub App user tokens, and GET /user/installations/{installation_id}/repositories needs repo metadata read access. Version 2026-03-10 is supported. See https://docs.github.com/en/rest/apps/installations?apiVersion=2026-03-10.

## Safe diagnostic change
- The native API returns only a whitelisted endpoint category (installations/repositories/issues) and a whitelisted HTTP status (401/403/404/429), never token, raw response body, account info or URL.
- The UI maps these to localised (DE/EN/ES/RU), actionable categories and never renders raw arbitrary exceptions.
- Diagnosing whether the failure is token rejection, installation permissions, missing installation or rate limit requires a fresh read-only click in the new M2 QA build. No guessing, no unauthorized GitHub permission edits, no credential deletion, no automatic account linking or open external ports.
- M3 stays unchanged while the diagnostic is validated on M2.

## Next steps
1. Sign/build and update only isolated M2 QA with rollback; native and frontend tests green.
2. Click real M2 GitHub App read-only repository inventory, inspect specific sanitized error category; fix verified root and retest.
3. Mesh pairing must still be user-approved on both Macs with signed handshakes/SAS and real pinned mTLS before any remote job. No mesh connectivity or writer trust implied by working GitHub.
