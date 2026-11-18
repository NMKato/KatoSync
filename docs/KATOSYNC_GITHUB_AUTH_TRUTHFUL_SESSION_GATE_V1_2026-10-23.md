# KatoSync – corrected Auth identity text and local session guard

2026-10-23. Source-only draft. No account, token or issuer migrated.

## Review finding

KatoSync uses its own Supabase Auth issuer. KATOOS Website/KSP uses
a different Supabase project. KatoSync previously claimed working
KATOOS SSO in its login copy, but this was not implemented.

GitHub App connections in the standard provider view use the verified
KatoSync Supabase UUID and per-user native OS keychain records. This
change does NOT automatically merge two Auth tenants.

## Changes

1. Correct misleading KATOOS SSO assertions in DE/EN/ES/RU login copy.
   Users are not prompted for a second KatoSync login inside GitHub.
   The UI cautions against creating an unnecessary duplicate account.
2. Local resume status now requires both a nonempty display-email
   marker and a nonempty native keychain refresh credential.
   A left-behind email file alone is no longer treated as a session.
   Credential contents never reach frontend/logs and are zeroized
   after the presence test.
3. Local resume is explicitly only OFFLINE/local status, not full
   online authorization. GitHub native actions independently verify
   issuer-pinned KatoSync session via the Auth server before reading
   or writing per-user secrets.
4. No automatic account re-enrollment, no Auth URL switch, no cloud
   profile encryption migration or GitHub write scopes added.

## Evidence

Frontend Node tests (including two new session/copy regressions),
TypeScript, Vite production build, native Rust unit tests and fmt
are required before commit. Actual cross-tenant KATOOS SSO, packaged
Mac/Windows GUI, full user GitHub consent and second-account OS
keychain isolation remain UNVERIFIED release gates.

Issue #114 tracks safe SSO federation. Never match accounts by email
alone, transfer passwords or repurpose tokens across tenant issuers.
Keep PR #115 Draft until the verified authorization and security
review are complete.

Created by NMKato Solutions.
