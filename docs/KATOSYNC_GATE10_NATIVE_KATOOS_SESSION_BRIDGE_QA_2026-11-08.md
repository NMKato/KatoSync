# Gate 10 — native KATOOS owner-review readback (QA only)

**Status: isolated, compile-/test-only, NOT deployed. 2026-11-08.**

## Existing KATOOS session reused

A source-level audit of `src-tauri/src/lib.rs`,
`github_app_auth.rs`, `mesh_identity.rs` and
`mesh_katoos_shared_preflight.rs` confirms that the desktop already
maintains its KATOOS login in the **native Rust process / macOS Keychain**.
The correct architecture does **not** create a second WebView OAuth login,
does not export the existing JWT, and does not use user-editable metadata
as an authorization source.

## New QA bridge

- `src-tauri/src/mesh_owner_review_readback.rs` registers Tauri command
  `mesh_owner_review_readback_qa`. It is compiled with KatoSync, but
  disabled unless the existing `katoos-auth-qa` build feature is enabled,
  the canonical KATOOS project is selected and local environment
  `KATOSYNC_FEATURE_APPROVAL_STAGE=qa` is explicitly set.
- Command arguments: only `decisionId`, `grantId`, `expectedOwnerUid`.
  All are canonical UUIDs. The last one is a **match constraint**, not
  authorization by itself.
- The native command reuses
  `github_app_auth::verified_katosync_user()` to fetch the current
  identity through KATOOS `/auth/v1/user`, then checks the exact
  caller account, obtains the access token using the already protected
  `ensure_supabase_access_token()` and wraps it in `Zeroizing`.
- A single fixed, POST-only URL
  `/functions/v1/feature-owner-readback-qa` is called using the existing
  native public KATOOS project key and user JWT.
  Redirects are forbidden, requests time out after 8 seconds, and
  responses are strict JSON with `Cache-Control: no-store`, limited
  to 8192 bytes. Neither endpoint nor request body accepts a URL,
  shell command, device identifier, database credential or token.
- The native response shape is directly deserialized with strict Serde
  models, which **reject unknown, missing and duplicate JSON fields**.
  It requires exact owner UID, decision ID, grant scope, freshness,
  key ID formats, valid signer public key shape, and no grant/percentage
  elevation. It then calls
  `mesh_identity::same_account_still_verified()` to reject an account
  switch during the network request.
- The response to the frontend is **ONLY**:
  `server_attested_unverified`, `ownerAuthenticated:true`,
  `serverAttestationReceived:true`,
  `independentReviewerVerified:false`, `grantsRights:false`,
  `verifiedPercent:null`, `remoteJobsEnabled:false`.
  **No JWT, signature, signer key, access token or decision is returned.**

`src/lib/ownerReviewReadbackClient40.ts` is a prepared, **not mounted**
frontend adapter that invokes this native Tauri command. It never
accepts/stores a token or API key; it discards late responses after
logout or account switches, clears stale state on 401/403 and refuses
any native response implying approval or device rights.

## Important trust boundary

The native bridge currently checks the **shape, ownership, freshness
and scope** of a KATOOS server readback. The signer public key in
that returned server record is NOT yet independently pinned by native
authority. It must therefore never mark the reviewer
`independentReviewerVerified:true`. The pure Rust Gate9 verifier in
`acceptance_ledger/reviewer_attestation.rs` already supports the actual
independent Ed25519 check, but only with an independently authenticated
trusted reviewer authority argument — that second native authority
retrieval is not yet wired and must be separately reviewed.

A signed reviewer `rejected` outcome remains non-authorizing.
Historical signatures older than 60 seconds remain rejected by the
existing native signer-age gate. Replaying old approvals is NOT an
acceptable workaround.

## QA and go-live blockers

- Synthetic native tests verify exact owner/decision scope, expiry,
  duplicate JSON fields, untrusted signer key formats, rejection, no
  rights and no OAuth token leakage.
- Synthetic frontend tests verify manual invocation only, never a
  user-JWT in JavaScript, fixed command, account switching, logout,
  independent approval never inferred, and no response cached.
- New Edge function `feature-owner-readback-qa` is still **NOT
  deployed**. The native command is disabled without explicit QA
  feature + environment switch.
- Gate9 approval registry in the existing KATOOS database remains
  empty; no independent human reviewer has enrolled or approved.
- Native independent signer authority read + witnessed human SAS,
  Stage4E quota migration rollout/rollback, and real device revocation
  testing remain release blockers.

**Never mark the KatoSync 4.0 PR ready or merge it into main on the
basis of this QA bridge. No production SQL, worker, OAuth or device
state is changed in this task.**
