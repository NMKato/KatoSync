# Stage4W – private LAN mTLS proof with real device keys (QA)
11 November 2026 | NMKato Solutions

Objective: A single physical M2/M3 TLS 1.3 handshake authenticated against each machine's already owner-approved, account-scoped Keychain Ed25519 identity. This is not a persistent live Mesh link or remote control.

Implementation:
- stage4j-qa build gate plus runtime flag KATOSYNC_STAGE4W_LAN_QA_ONCE=OWNER_LAUNCHED_QA_ONLY.
- Manual button and explicit confirmation in Advanced QA UI only when VITE_STAGE4W_LAN_QA=1.
- Exact same-/24 RFC1918 addresses, port above 1024, one accepted TCP peer, timeout bounded and one concurrent QA operation per app.
- Exchange public bounded DER certificates only. Never export private keys or OAuth tokens.
- Use native Keychain-derived pin and live KATOOS owner/enrollment/revocation checks BEFORE and AFTER the TLS exchange.
- Existing pinned TLS 1.3 AES-256-GCM and fresh random nonce echo verify the live peer.
- The ephemeral socket is closed at the end. Result explicitly forbids permanent connected status, file/terminal access and remote jobs.

Security test plan: wrong/revoked/cross-owner pin, malformed/oversize DER, public/wildcard/cross-subnet source, unexpected client, simultaneous request, expired session, invalid nonce or TLS version, dropout. Confirm no automatic or background service appears.

Build gates: source review, Rust native compiler/tests, TypeScript and Node regression, CI, signed and notarized QA apps, physical M2/M3 positive and negative tests. Do not merge to main or deploy remote authorization.

Current status: SOURCE-ONLY QA candidate. Not installed; real-key physical test not performed. Earlier synthetic identity mTLS LAN tests were separately successful.
