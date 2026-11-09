# Mesh Stage1A identity preparation – two-Mac QA blocker (27 October 2026)

M2 and M3 real isolated KatoSync Mesh QA GUIs received a manual Geräte­schlüssel vorbereiten button press under Vision > Mesh readiness. Both displayed the generic keychain/account verification error and no device fingerprint.
Keychain attribute-only inspection confirmed KATOOS-session and GitHub-App entries on both hosts, but zero mesh-ed25519-v1 key entries. No secrets, UID, or tokens were retrieved.
Prior UI did not distinguish auth re-verification from Keychain read/write/readback errors. The new native command maps only whitelisted nonsecret error categories, which the UI translates to DE/EN/ES/RU. No new trust, device listeners, remote dispatch, unsafe credentials, permission bypasses, or ACL weakening.
Tests: TypeScript, Node, Rust, native QA Mac app. Next: isolated M2 upgrade with rollback, real UX classified error, fix verified cause, M3 afterwards. Physical two-device signed SAS comparison, mutual approval, and TLS still blocked until both identity operations succeed. Writer gate #76 remains closed.
