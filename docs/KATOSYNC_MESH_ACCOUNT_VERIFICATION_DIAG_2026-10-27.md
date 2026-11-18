# KatoSync Mesh QA – verified account preflight, 27 October 2026

## Physically observed
- Isolated **M2 Pro** `KatoSync Mesh QA` was confirmed running with the PR #149 native identity-diagnostic codes in its binary. The normal KatoSync app was not modified; M3 was not modified.
- Owner-approved real UI press of **Vision → Gerätekennung und Pairing-Vorbereitung → Geräteschlüssel vorbereiten** yielded the specific redacted message: `KATOOS-Konto konnte nicht online verifiziert werden`.
- The result persisted after **Erneut prüfen** and a second explicit Prepare press. No device fingerprint was obtained; this did not reach local Ed25519 key storage.
- Canonical KATOOS Auth endpoint was reachable via HTTPS from M2 (unauthenticated health request returned HTTP 401). This **does not prove that a logged-in user session is valid**.
- No password/token/refresh token, device signing seed, private account UUID, or OS Keychain secret was read or recorded by this QA.

## Narrow fix
Existing PR #149 grouped all identity-verification failures into one account category. This follow-up maps only exact known **already normalized** Rust failure strings into fixed UI codes: missing/failed-to-renew session, failed refresh/issuer rejection, network failure, invalid user identity and concurrent account switch. Unknown text fails closed to a generic response, never raw error display.

German/English/Spanish/Russian localized messages and frontend/native regressions added. No new permission, browser login, forced logout, keychain reset, bearer tokens or network listeners are introduced.

## Remaining release gates
1. Verify native macOS QA build and update **only M2 isolated QA** with rollback.
2. Press Prepare again, identify exact fixed failure code and repair **only** the observed session problem. Never copy tokens between QA and regular app identities.
3. Confirm M2 Ed25519 identity persists securely across restart; then validate M3 in its isolated QA identity.
4. Physically compare one-time SAS on both Macs and explicitly approve the peer on both sides, followed by mTLS LAN, reconnect/revoke and a first remote read-only operation.
5. Keep GitHub repository API inventory and any writer operations separate; GitHub Writer Gate #76 remains closed.

PR is stacked on Draft #149. No automatic main merge.
